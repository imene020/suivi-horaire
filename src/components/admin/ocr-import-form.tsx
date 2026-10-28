"use client";

import * as React from "react";
import { ScanLine, CheckCircle2, XCircle, AlertTriangle, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  analyzeOcrScanAction,
  confirmOcrDraftsAction,
  rejectOcrDraftsAction,
  updateOcrDraftAction,
} from "@/lib/actions/ocr-import";
import { OcrDraftRow } from "@/lib/types";
import { uploadTooLarge } from "@/lib/constants";
import { shrinkImageForUpload } from "@/lib/image-resize";

interface EmployeeOption {
  id: string;
  full_name: string;
  email: string;
}

const ENGINE_LABELS = {
  claude: "Lu par l'IA (Claude)",
  gemini: "Lu par l'IA (Gemini)",
  google_vision: "Lu par OCR (Google Vision)",
  tesseract: "Lu par OCR classique",
} as const;

export function OcrImportForm({
  employees,
  initialDrafts,
  aiEnabled,
}: {
  employees: EmployeeOption[];
  initialDrafts: OcrDraftRow[];
  aiEnabled: boolean;
}) {
  const [lastScan, setLastScan] = React.useState<{ engine: keyof typeof ENGINE_LABELS; warning?: string; rows: number } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [analyzeError, setAnalyzeError] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<OcrDraftRow[]>(initialDrafts);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [defaultEmployee, setDefaultEmployee] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [finalResult, setFinalResult] = React.useState<{ imported?: number; skipped?: number; error?: string } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  async function handleAnalyze(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setAnalyzeError(null);
    setFinalResult(null);
    const formData = new FormData(e.currentTarget);
    setLastScan(null);
    // Les photos de téléphone sont réduites avant l'envoi (plus rapide, sous la limite de 4 Mo).
    const original = formData.get("file");
    if (original instanceof File && original.size > 0) formData.set("file", await shrinkImageForUpload(original));
    const tooLarge = uploadTooLarge(formData);
    if (tooLarge) {
      setPending(false);
      setAnalyzeError(tooLarge);
      return;
    }
    const res = await analyzeOcrScanAction(formData);
    setPending(false);
    if ("error" in res) {
      setAnalyzeError(res.error);
      return;
    }
    setLastScan({ engine: res.engine, warning: res.warning, rows: res.rows.length });
    setDrafts((prev) => [...res.rows, ...prev]);
    setSelected((prev) => {
      const next = new Set(prev);
      res.rows.filter((r) => r.valid).forEach((r) => next.add(r.id));
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleFieldChange(row: OcrDraftRow, fields: Partial<OcrDraftRow>) {
    const patch = {
      profile_id: fields.profile_id,
      full_name:
        fields.profile_id !== undefined ? employees.find((e) => e.id === fields.profile_id)?.full_name ?? null : undefined,
      entry_date: fields.entry_date,
      start_time: fields.start_time,
      end_time: fields.end_time,
      hours: fields.hours,
    };
    const res = await updateOcrDraftAction(row.id, patch);
    if (res.error) return;
    // Le serveur revalide la ligne : on affiche tout de suite le nouveau statut.
    setDrafts((prev) =>
      prev.map((d) =>
        d.id === row.id
          ? { ...d, ...fields, full_name: patch.full_name ?? d.full_name, valid: res.valid ?? d.valid, issues: res.issues ?? d.issues }
          : d
      )
    );
  }

  async function handleConfirm() {
    const ids = drafts.filter((d) => selected.has(d.id) && d.status === "pending").map((d) => d.id);
    if (ids.length === 0) {
      setFinalResult({ error: "Veuillez sélectionner au moins une ligne valide à importer." });
      return;
    }
    setConfirming(true);
    setFinalResult(null);
    const res = await confirmOcrDraftsAction(ids);
    setConfirming(false);
    if ("error" in res) {
      setFinalResult({ error: res.error });
      return;
    }
    setDrafts((prev) => prev.filter((d) => !ids.includes(d.id)));
    setSelected(new Set());
    setFinalResult({ imported: res.imported, skipped: res.skipped });
  }

  async function handleReject() {
    const ids = Array.from(selected).filter((id) => drafts.find((d) => d.id === id)?.status === "pending");
    if (ids.length === 0) return;
    setRejecting(true);
    await rejectOcrDraftsAction(ids);
    setRejecting(false);
    setDrafts((prev) => prev.filter((d) => !ids.includes(d.id)));
    setSelected(new Set());
  }

  const pendingDrafts = drafts.filter((d) => d.status === "pending");

  return (
    <div className="space-y-4">
      {aiEnabled ? (
        <div className="flex items-start gap-3 rounded-xl border border-sea-200 bg-sea-50 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-sea-600 shadow-sm">
            <Sparkles className="h-[18px] w-[18px]" />
          </span>
          <div>
            <p className="text-sm font-semibold text-sea-800">Lecture intelligente activée</p>
            <p className="text-xs text-sea-700">
              L&apos;IA lit l&apos;écriture manuscrite, comprend les feuilles à plusieurs employés, déduit l&apos;année et
              signale ce qu&apos;elle lit mal. Vous validez chaque ligne avant qu&apos;elle ne compte.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-steel-100 text-steel-600">
            <Sparkles className="h-[18px] w-[18px]" />
          </span>
          <p className="text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Lecture OCR classique.</span> Pour lire aussi l&apos;écriture
            manuscrite et les feuilles à plusieurs employés, ajoutez dans les réglages du serveur une clé{" "}
            <code>GEMINI_API_KEY</code> (offre gratuite de Google) ou <code>ANTHROPIC_API_KEY</code> (Claude).
          </p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Comment ça marche</h2>
        <ul className="text-xs text-slate-500 list-disc pl-5 space-y-0.5">
          <li>Prenez une photo nette ou scannez la feuille de présence (JPG, PNG ou WEBP). Les grandes photos sont réduites automatiquement.</li>
          <li>
            {aiEnabled
              ? "La feuille est lue par l'IA, ligne par ligne, et chaque ligne est associée à un employé quand son nom est écrit."
              : "Le texte est lu automatiquement (OCR) puis les dates/heures sont extraites ligne par ligne."}
          </li>
          <li>Chaque ligne extraite est enregistrée en brouillon : rien n&apos;est ajouté à l&apos;historique tant que vous n&apos;avez pas validé.</li>
          <li>Les lignes valides sélectionnées sont <strong>additionnées</strong> aux heures déjà existantes du même jour (et non remplacées).</li>
          <li>Une alerte est envoyée aux administrateurs à chaque scan, avec le nombre d&apos;anomalies détectées.</li>
        </ul>
      </div>

      <form onSubmit={handleAnalyze} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ocr-file">Photo ou scan (JPG, PNG, WEBP)</Label>
          <Input ref={fileInputRef} id="ocr-file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ocr-default-employee">
            Employé <span className="text-slate-400 font-normal">(feuille propre à cette personne)</span>
          </Label>
          <Select
            id="ocr-default-employee"
            name="default_profile_id"
            value={defaultEmployee}
            onChange={(e) => setDefaultEmployee(e.target.value)}
          >
            <option value="">— Aucun (à assigner ligne par ligne) —</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.full_name} ({emp.email})</option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={pending}>
          <ScanLine className="h-3.5 w-3.5" />
          {pending ? (aiEnabled ? "Lecture de la feuille par l'IA..." : "Analyse OCR en cours...") : "Analyser le scan"}
        </Button>
        {analyzeError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{analyzeError}</p>}
        {lastScan && (
          <div className="space-y-2">
            <p
              className={
                lastScan.engine === "claude" || lastScan.engine === "gemini"
                  ? "inline-flex items-center gap-1.5 rounded-full bg-sea-50 px-2.5 py-1 text-xs font-medium text-sea-700"
                  : "inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
              }
            >
              {lastScan.engine === "claude" || lastScan.engine === "gemini" ? <Sparkles className="h-3.5 w-3.5" /> : <ScanLine className="h-3.5 w-3.5" />}
              {ENGINE_LABELS[lastScan.engine]} · {lastScan.rows} ligne(s) à relire
            </p>
            {lastScan.warning && (
              <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {lastScan.warning}
              </p>
            )}
          </div>
        )}
      </form>

      {pendingDrafts.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">
              Lignes à relire — {pendingDrafts.length}
              {" "}({pendingDrafts.filter((d) => d.valid).length} valide(s), {pendingDrafts.filter((d) => !d.valid).length} à corriger)
            </h2>
          </div>

          <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-2 py-2 text-left"></th>
                  <th className="px-2 py-2 text-left">Employé</th>
                  <th className="px-2 py-2 text-left">Date</th>
                  <th className="px-2 py-2 text-left">Début</th>
                  <th className="px-2 py-2 text-left">Fin</th>
                  <th className="px-2 py-2 text-left">Heures</th>
                  <th className="px-2 py-2 text-left">Statut</th>
                </tr>
              </thead>
              <tbody>
                {pendingDrafts.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} />
                    </td>
                    <td className="px-2 py-1.5 min-w-[160px]">
                      <Select
                        value={row.profile_id ?? ""}
                        onChange={(e) => handleFieldChange(row, { profile_id: e.target.value || null })}
                      >
                        <option value="">— Choisir —</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1.5 min-w-[130px]">
                      <Input
                        type="date"
                        value={row.entry_date ?? ""}
                        onChange={(e) => handleFieldChange(row, { entry_date: e.target.value || null })}
                      />
                    </td>
                    <td className="px-2 py-1.5 min-w-[100px]">
                      <Input
                        type="time"
                        value={row.start_time ?? ""}
                        onChange={(e) => handleFieldChange(row, { start_time: e.target.value || null })}
                      />
                    </td>
                    <td className="px-2 py-1.5 min-w-[100px]">
                      <Input
                        type="time"
                        value={row.end_time ?? ""}
                        onChange={(e) => handleFieldChange(row, { end_time: e.target.value || null })}
                      />
                    </td>
                    <td className="px-2 py-1.5 min-w-[90px]">
                      <Input
                        type="number"
                        step="0.25"
                        value={row.hours}
                        onChange={(e) => handleFieldChange(row, { hours: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="px-2 py-1.5 min-w-[200px]">
                      {row.valid ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 rounded-full px-2 py-0.5">
                          <CheckCircle2 className="h-3 w-3" /> Valide
                        </span>
                      ) : (
                        <div className="text-xs text-amber-700 bg-amber-50 rounded-md px-2 py-1 flex items-start gap-1">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                          <ul className="list-disc pl-3 space-y-0.5">
                            {row.issues.map((issue, i) => <li key={i}>{issue}</li>)}
                          </ul>
                        </div>
                      )}
                      <p className="text-[11px] text-slate-400 mt-1 truncate" title={row.raw_line}>{row.raw_line}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-slate-500">{selected.size} ligne(s) sélectionnée(s)</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={handleReject} disabled={rejecting || selected.size === 0}>
                <Trash2 className="h-3.5 w-3.5" /> Rejeter la sélection
              </Button>
              <Button type="button" onClick={handleConfirm} disabled={confirming || selected.size === 0}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {confirming ? "Import en cours..." : `Confirmer et additionner (${selected.size})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {finalResult && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {finalResult.error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2 flex items-center gap-2">
              <XCircle className="h-4 w-4" /> {finalResult.error}
            </p>
          )}
          {finalResult.imported !== undefined && (
            <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> {finalResult.imported} ligne(s) additionnée(s) à l&apos;historique
              {finalResult.skipped ? `, ${finalResult.skipped} ignorée(s) (invalide(s) ou sans employé).` : "."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
