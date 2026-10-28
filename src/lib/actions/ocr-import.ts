"use server";

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_ERROR } from "@/lib/constants";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdmin } from "@/lib/session";
import { extractTextFromImage } from "@/lib/ocr";
import { parseOcrTimesheetText, validateOcrRow } from "@/lib/ocr-parse";
import { isAiReadingEnabled, readTimesheetWithClaude, toParsedLines, AiParsedLine } from "@/lib/ai-timesheet";
import { matchEmployeeByName } from "@/lib/name-match";
import { nowInAppTimeZone } from "@/lib/date";
import { notifyAdminsOcrScan } from "@/lib/notifications";
import {
  createDocument,
  createOcrDraftRows,
  findProfileById,
  listEmployees,
  listOcrDrafts,
  updateOcrDraft,
  setOcrDraftStatus,
  addHoursToTimeEntry,
  getOcrDraftById,
} from "@/lib/queries";
import { OcrDraftRow } from "@/lib/types";
import { generateId } from "@/lib/db";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface OcrAnalyzeResult {
  success: true;
  batch_id: string;
  rows: OcrDraftRow[];
  engine: "claude" | "google_vision" | "tesseract";
  rawText: string;
  /** Message à afficher quand la lecture par IA a échoué et que l'OCR classique a pris le relais. */
  warning?: string;
}

/**
 * Étape 1 : OCR + analyse du document envoyé (photo/scan d'une feuille de présence papier).
 * Les lignes détectées (valides ou non) sont directement enregistrées comme brouillons
 * ("ocrDrafts", statut "pending") pour ne rien perdre, et un administrateur est alerté ;
 * rien n'est encore fusionné dans l'historique des heures.
 */
export async function analyzeOcrScanAction(formData: FormData): Promise<{ error: string } | OcrAnalyzeResult> {
  await requireAdmin();

  const file = formData.get("file") as File | null;
  const defaultProfileId = String(formData.get("default_profile_id") || "").trim() || null;

  if (!file || file.size === 0) return { error: "Veuillez sélectionner une photo ou un scan (JPG, PNG ou WEBP)." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: MAX_UPLOAD_ERROR };
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return { error: "Format non pris en charge pour l'OCR : utilisez une photo ou un scan JPG, PNG ou WEBP." };
  }

  let defaultProfile: { id: string; full_name: string } | null = null;
  if (defaultProfileId) {
    const found = await findProfileById(defaultProfileId);
    defaultProfile = found ? { id: found.id, full_name: found.full_name } : null;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const employees = (await listEmployees()).filter((e) => e.active);

  // 1. Lecture par IA (Claude) si une clé est configurée ; 2. sinon, ou en cas d'échec, OCR classique.
  let engine: OcrAnalyzeResult["engine"];
  let text: string;
  let warning: string | undefined;
  let parsedLines: (Omit<AiParsedLine, "employee_name" | "confidence"> & Partial<AiParsedLine>)[] | null = null;
  let sheetEmployeeName = "";

  if (isAiReadingEnabled()) {
    try {
      const ai = await readTimesheetWithClaude(buffer, file.type, {
        today: nowInAppTimeZone().date,
        employeeNames: employees.map((e) => e.full_name),
      });
      parsedLines = toParsedLines(ai);
      sheetEmployeeName = ai.employee_name;
      engine = "claude";
      text = ai.rows.map((r) => r.raw_text).join("\n") + (ai.notes ? `\n\nRemarques de l'IA : ${ai.notes}` : "");
    } catch (err) {
      console.error("[ocr] lecture IA impossible, repli sur l'OCR classique :", err);
      warning = "La lecture par IA n'a pas abouti : les lignes ci-dessous viennent de l'OCR classique, vérifiez-les avec attention.";
    }
  }
  if (!parsedLines) {
    const ocr = await extractTextFromImage(buffer);
    engine = ocr.engine;
    text = ocr.text;
    parsedLines = parseOcrTimesheetText(ocr.text);
  }

  if (parsedLines.length === 0) {
    return {
      error:
        "Aucune date n'a pu être reconnue sur ce document. Vérifiez la netteté de la photo, ou saisissez les heures manuellement.",
    };
  }

  // Le document original est conservé (photo/scan) pour que l'admin puisse le comparer
  // aux lignes extraites pendant la relecture, s'il est déjà associé à un employé.
  const engineLabel = { claude: "lecture IA Claude", google_vision: "Google Vision", tesseract: "Tesseract local" }[engine!];
  const document = defaultProfile
    ? await createDocument({
        profile_id: defaultProfile.id,
        original_name: file.name,
        mime_type: file.type,
        size: file.size,
        buffer,
        category: "employe",
        note: `Scan de feuille de présence (${engineLabel})`,
      })
    : null;

  const sheetMatch = sheetEmployeeName ? matchEmployeeByName(employees, sheetEmployeeName) : null;
  const batchId = generateId();
  const toCreate = parsedLines.map((row) => {
    // Priorité : l'employé choisi par l'admin, puis le nom lu sur la ligne, puis le nom de la feuille.
    const rowMatch = row.employee_name ? matchEmployeeByName(employees, row.employee_name) : null;
    const profile = defaultProfile ?? rowMatch ?? sheetMatch;
    const profile_id = profile?.id ?? null;
    const { issues } = validateOcrRow({
      entry_date: row.entry_date,
      start_time: row.start_time,
      end_time: row.end_time,
      hours: row.hours,
      profile_id,
    });
    if (!profile && row.employee_name) issues.push(`Nom lu « ${row.employee_name} » : aucun employé correspondant, à choisir.`);
    if (row.confidence === "low") issues.push("Lecture incertaine : comparez avec la photo avant de valider.");
    return {
      batch_id: batchId,
      document_id: document?.id ?? null,
      profile_id,
      full_name: profile?.full_name ?? null,
      entry_date: row.entry_date,
      start_time: row.start_time,
      end_time: row.end_time,
      break_minutes: row.break_minutes,
      hours: row.hours,
      raw_line: row.raw_line,
      valid: issues.length === 0,
      issues,
    };
  });

  const created = await createOcrDraftRows(toCreate);
  const validRows = created.filter((r) => r.valid).length;

  after(() =>
    notifyAdminsOcrScan({
      totalRows: created.length,
      validRows,
      invalidRows: created.length - validRows,
      fileName: file.name,
    })
  );

  revalidatePath("/admin/ocr-import");
  return { success: true, batch_id: batchId, rows: created, engine: engine!, rawText: text!, warning };
}

export async function listOcrDraftsAction(): Promise<OcrDraftRow[]> {
  await requireAdmin();
  return listOcrDrafts("pending");
}

/** Permet de corriger une ligne (employé, date, heures) avant de la confirmer. */
export async function updateOcrDraftAction(
  id: string,
  fields: {
    profile_id?: string | null;
    full_name?: string | null;
    entry_date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    hours?: number;
  }
): Promise<{ error?: string; success?: true; valid?: boolean; issues?: string[] }> {
  await requireAdmin();

  const draft = await getOcrDraftById(id);
  if (!draft) return { error: "Ligne introuvable." };

  const merged = { ...draft, ...fields };
  const { valid, issues } = validateOcrRow({
    entry_date: merged.entry_date,
    start_time: merged.start_time,
    end_time: merged.end_time,
    hours: merged.hours,
    profile_id: merged.profile_id,
  });

  await updateOcrDraft(id, { ...fields, valid, issues });
  revalidatePath("/admin/ocr-import");
  return { success: true, valid, issues };
}

export interface ConfirmOcrDraftsSummary {
  imported: number;
  skipped: number;
}

/** Étape 2 : fusionne (en additionnant les heures) les lignes sélectionnées et valides
 * avec l'historique existant, puis marque les brouillons correspondants comme confirmés. */
export async function confirmOcrDraftsAction(ids: string[]): Promise<{ error: string } | ({ success: true } & ConfirmOcrDraftsSummary)> {
  await requireAdmin();
  if (!Array.isArray(ids) || ids.length === 0) return { error: "Aucune ligne sélectionnée." };

  let imported = 0;
  let skipped = 0;
  const confirmedIds: string[] = [];

  for (const id of ids) {
    const draft = await getOcrDraftById(id);
    if (!draft || draft.status !== "pending" || !draft.valid || !draft.profile_id || !draft.entry_date) {
      skipped++;
      continue;
    }
    await addHoursToTimeEntry(draft.profile_id, draft.entry_date, {
      start_time: draft.start_time,
      end_time: draft.end_time,
      break_minutes: draft.break_minutes,
      hours: draft.hours,
    });
    confirmedIds.push(id);
    imported++;
  }

  await setOcrDraftStatus(confirmedIds, "confirmed");

  revalidatePath("/admin/ocr-import");
  revalidatePath("/dashboard");
  revalidatePath("/admin/employees");
  revalidatePath("/admin/salaries");

  return { success: true, imported, skipped };
}

/** Rejette (sans les importer) les lignes sélectionnées, par exemple des lignes reconnues
 * par erreur ou qui ne correspondent à aucun jour réellement travaillé. */
export async function rejectOcrDraftsAction(ids: string[]): Promise<{ error: string } | { success: true }> {
  await requireAdmin();
  if (!Array.isArray(ids) || ids.length === 0) return { error: "Aucune ligne sélectionnée." };
  await setOcrDraftStatus(ids, "rejected");
  revalidatePath("/admin/ocr-import");
  return { success: true };
}
