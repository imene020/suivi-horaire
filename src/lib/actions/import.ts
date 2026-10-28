"use server";

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_ERROR } from "@/lib/constants";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { parseHoursCsv, parseHoursXlsx, CsvParseResult } from "@/lib/csv-import";
import {
  findProfileByEmail,
  findProfileById,
  listEmployees,
  bulkImportTimeEntries,
  getEntryByDate,
  isAlreadyImported,
  HistoricalHourRow,
} from "@/lib/queries";
import { DayType, WorkMode } from "@/lib/types";


export interface ImportSummary {
  imported: number;
  /** Lignes ignorées car déjà importées à l'identique (même fichier importé deux fois). */
  skipped: number;
  errors: string[];
}

/** Ligne affichée à l'admin pour relecture/filtrage avant confirmation. `profile_id` est
 * vide tant que la ligne n'a pas encore été associée à un employé (fichier sans colonne
 * email et sans employé par défaut) : elle reste visible pour être assignée manuellement
 * dans l'aperçu, plutôt que d'être rejetée d'emblée. */
export interface ImportPreviewRow {
  line: number;
  profile_id: string;
  email: string;
  full_name: string;
  /** Nom d'employé tel qu'écrit dans le fichier (colonne nom/employé), vide si absente. */
  source_name: string;
  entry_date: string;
  day_type: DayType;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  work_mode: WorkMode;
  /** Heures calculées pour cette ligne seule. */
  hours: number;
  /** Heures déjà enregistrées pour le même employé et la même date. */
  existing_hours: number;
  /** Total après ajout (existing_hours + hours). */
  total_hours: number;
  /** Ligne déjà importée à l'identique pour ce jour : elle sera ignorée à la confirmation. */
  already_imported: boolean;
  tasks: string | null;
  remarks: string | null;
}

async function parseFile(file: File): Promise<CsvParseResult | { error: string }> {
  if (!file || file.size === 0) return { error: "Veuillez sélectionner un fichier CSV ou Excel." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: MAX_UPLOAD_ERROR };

  const fileName = file.name.toLowerCase();
  const isExcel = fileName.endsWith(".xlsx");
  const isCsv = fileName.endsWith(".csv");
  if (fileName.endsWith(".xls")) {
    return { error: "Le format .xls (Excel 97-2003) n'est pas supporté. Réenregistrez le fichier au format .xlsx." };
  }
  if (!isExcel && !isCsv) {
    return { error: "Le fichier doit être au format CSV (.csv) ou Excel (.xlsx)." };
  }

  return isExcel
    ? await parseHoursXlsx(Buffer.from(await file.arrayBuffer()))
    : parseHoursCsv(await file.text());
}

export interface AnalyzeImportResult {
  success: true;
  rows: ImportPreviewRow[];
  errors: string[];
  detectedHeaders: string[];
  sampleRows: string[][];
  needsDefaultEmployee: boolean;
  /** Employé suggéré par défaut si son nom a été repéré dans le fichier (ex. modèle
   * "Suivi horaire" avec "Nom d'employé : ..."), pour pré-remplir le sélecteur côté UI. */
  suggestedEmployee: { id: string; full_name: string; email: string } | null;
}

/** Étape 1 : analyse le fichier et renvoie un aperçu filtrable, sans rien écrire en base.
 * Si le fichier n'a pas de colonne email reconnaissable (ex. fichier mensuel propre à un
 * seul employé), `default_profile_id` permet d'appliquer un employé à toutes les lignes. */
export async function analyzeImportAction(
  formData: FormData
): Promise<{ error: string } | AnalyzeImportResult> {
  await requireAdmin();

  const file = formData.get("file") as File | null;
  const defaultProfileId = String(formData.get("default_profile_id") || "").trim() || null;

  const parsed = file ? await parseFile(file) : { error: "Veuillez sélectionner un fichier CSV ou Excel." };
  if ("error" in parsed) return parsed;
  const { rows, errors, detectedHeaders, sampleRows, needsDefaultEmployee, detectedEmployeeName } = parsed;

  let defaultProfile: { id: string; full_name: string; email: string } | null = null;
  if (defaultProfileId) {
    const found = await findProfileById(defaultProfileId);
    defaultProfile = found ? { id: found.id, full_name: found.full_name, email: found.email } : null;
  }

  const employees = await listEmployees();
  const normalizeName = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");

  /** Associe un nom libre du fichier à un compte employé : égalité normalisée,
   * puis correspondance par inclusion ("Fatma Zalila" ≈ "Zalila Fatma" partiel). */
  const matchByName = (name: string) => {
    const target = normalizeName(name);
    if (!target) return null;
    return (
      employees.find((e) => normalizeName(e.full_name) === target) ??
      employees.find(
        (e) => normalizeName(e.full_name).includes(target) || target.includes(normalizeName(e.full_name))
      ) ??
      null
    );
  };

  // Si le fichier indique un nom d'employé (ex. modèle "Suivi horaire") et qu'aucun employé
  // par défaut n'a été choisi explicitement, on suggère la correspondance la plus proche.
  let suggestedEmployee: { id: string; full_name: string; email: string } | null = null;
  if (!defaultProfile && detectedEmployeeName) {
    const match = matchByName(detectedEmployeeName);
    if (match) {
      suggestedEmployee = { id: match.id, full_name: match.full_name, email: match.email };
      defaultProfile = match;
    }
  }

  // Résout chaque ligne vers un profil existant, par ordre de priorité :
  // 1. email de la ligne, 2. nom d'employé de la ligne (colonne nom/employé),
  // 3. employé par défaut choisi. Les lignes dont l'email est introuvable sont
  // rejetées ; les lignes sans email ni correspondance de nom restent visibles,
  // non assignées, pour association manuelle dans l'aperçu.
  const emailCache = new Map<string, { id: string; full_name: string } | null>();
  const nameCache = new Map<string, { id: string; full_name: string; email: string } | null>();
  const preview: ImportPreviewRow[] = [];
  const allErrors = [...errors];

  for (const row of rows) {
    let profile: { id: string; full_name: string; email?: string } | null;
    let email = row.email;

    if (row.email) {
      const cached = emailCache.get(row.email);
      if (cached !== undefined) {
        profile = cached;
      } else {
        const found = await findProfileByEmail(row.email);
        profile = found ? { id: found.id, full_name: found.full_name } : null;
        emailCache.set(row.email, profile);
      }
    } else if (row.employee_name) {
      const key = normalizeName(row.employee_name);
      if (nameCache.has(key)) {
        profile = nameCache.get(key) ?? null;
      } else {
        const match = matchByName(row.employee_name);
        nameCache.set(key, match);
        profile = match;
      }
      email = profile?.email ?? "";
    } else if (defaultProfile) {
      profile = defaultProfile;
      email = defaultProfile.email;
    } else {
      profile = null;
    }

    // Une ligne avec un email présent mais introuvable est une vraie erreur (compte
    // inexistant) : elle est rejetée. En revanche, l'absence d'email (fichier mensuel
    // sans colonne email et sans employé par défaut choisi) n'est plus bloquante : la
    // ligne reste dans l'aperçu, non assignée, pour être associée manuellement ensuite.
    if (row.email && !profile) {
      allErrors.push(`Ligne ${row.line} : aucun compte trouvé pour "${row.email}".`);
      continue;
    }

    const existing = profile ? await getEntryByDate(profile.id, row.entry_date) : null;
    const existing_hours = existing?.hours ?? 0;
    const already_imported = isAlreadyImported(existing, row);
    const total_hours = already_imported ? existing_hours : existing_hours + row.hours;

    preview.push({
      line: row.line,
      profile_id: profile?.id ?? "",
      email: profile ? email : "",
      full_name: profile?.full_name ?? "",
      source_name: row.employee_name,
      entry_date: row.entry_date,
      day_type: row.day_type,
      start_time: row.start_time,
      end_time: row.end_time,
      break_minutes: row.break_minutes,
      work_mode: row.work_mode,
      hours: row.hours,
      existing_hours,
      total_hours,
      already_imported,
      tasks: row.tasks,
      remarks: row.remarks,
    });
  }

  return { success: true, rows: preview, errors: allErrors, detectedHeaders, sampleRows, needsDefaultEmployee, suggestedEmployee };
}

/** Étape 2 : écrit en base les lignes sélectionnées par l'admin après relecture.
 * Chaque ligne fusionne avec l'entrée existante du même jour (mise à jour partielle),
 * les autres jours/employés déjà en base ne sont pas affectés. */
export async function confirmImportAction(
  rows: ImportPreviewRow[]
): Promise<{ error: string } | ({ success: true } & ImportSummary)> {
  await requireAdmin();

  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "Aucune ligne sélectionnée à importer." };
  }

  const resolvedRows = rows.filter((row) => row.profile_id);
  if (resolvedRows.length === 0) {
    return { error: "Aucune ligne sélectionnée n'est associée à un employé : assignez un employé avant de confirmer." };
  }

  const toImport: HistoricalHourRow[] = resolvedRows.map((row) => ({
    profile_id: row.profile_id,
    entry_date: row.entry_date,
    day_type: row.day_type,
    start_time: row.start_time,
    end_time: row.end_time,
    break_minutes: row.break_minutes,
    work_mode: row.work_mode,
    hours: row.hours,
    tasks: row.tasks,
    remarks: row.remarks,
  }));

  const { imported, skipped } = await bulkImportTimeEntries(toImport);

  revalidatePath("/dashboard");
  revalidatePath("/admin/employees");
  revalidatePath("/admin/salaries");

  return { success: true, imported, skipped, errors: [] };
}
