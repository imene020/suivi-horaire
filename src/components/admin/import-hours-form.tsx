"use client";

import * as React from "react";
import { Download, Upload, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { analyzeImportAction, confirmImportAction, ImportPreviewRow, AnalyzeImportResult } from "@/lib/actions/import";
import { cn } from "@/lib/utils";
import { uploadTooLarge } from "@/lib/constants";

const CSV_HEADER = "email,date,type_jour,heure_debut,heure_fin,pause_minutes,mode,taches,remarques";
const CSV_EXAMPLE = `${CSV_HEADER}
employe@demo.com,2025-01-06,normal,08:00,17:00,60,presentiel,Suivi dossiers,
employe@demo.com,2025-01-07,conge,,,,,,\n`;

const DAY_TYPE_LABELS: Record<string, string> = {
  normal: "Normal",
  conge: "Congé",
  maladie: "Maladie",
  ferie_paye: "Férié payé",
  ferie_non_paye: "Férié non payé",
  repos: "Repos",
};

function downloadTemplate() {
  const blob = new Blob([CSV_EXAMPLE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "modele-import-heures.csv";
  a.click();
  URL.revokeObjectURL(url);
}

interface EmployeeOption {
  id: string;
  full_name: string;
  email: string;
}

export function ImportHoursForm({ employees }: { employees: EmployeeOption[] }) {
  const [pending, setPending] = React.useState(false);
  const [analyzeError, setAnalyzeError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<Omit<AnalyzeImportResult, "success"> | null>(null);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [search, setSearch] = React.useState("");
  const [dayTypeFilter, setDayTypeFilter] = React.useState("all");
  const [finalResult, setFinalResult] = React.useState<{ imported?: number; skipped?: number; error?: string } | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [defaultEmployee, setDefaultEmployee] = React.useState("");
  const [assignEmployee, setAssignEmployee] = React.useState("");

  async function handleAnalyze(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setAnalyzeError(null);
    setFinalResult(null);
    setPreview(null);
    const formData = new FormData(e.currentTarget);
    const tooLarge = uploadTooLarge(formData);
    if (tooLarge) {
      setPending(false);
      setAnalyzeError(tooLarge);
      return;
    }
    const res = await analyzeImportAction(formData);
    setPending(false);
    if ("error" in res) {
      setAnalyzeError(res.error);
      return;
    }
    setPreview(res);
    // Seules les lignes déjà associées à un employé sont présélectionnées : les lignes
    // non assignées doivent d'abord être rattachées à un employé avant d'être importées.
    // Les lignes déjà importées à l'identique ne sont pas présélectionnées (elles seraient ignorées).
    setSelected(new Set(res.rows.filter((r) => r.profile_id && !r.already_imported).map((r) => r.line)));
    if (res.suggestedEmployee && !defaultEmployee) setDefaultEmployee(res.suggestedEmployee.id);
  }

  /** Associe l'employé choisi à toutes les lignes non encore assignées de l'aperçu (fichier
   * sans colonne email), sans avoir à ré-uploader/ré-analyser le fichier. */
  function applyEmployeeToUnresolved() {
    if (!preview || !assignEmployee) return;
    const employee = employees.find((e) => e.id === assignEmployee);
    if (!employee) return;

    const newlyAssignedLines: number[] = [];
    const rows = preview.rows.map((r) => {
      if (r.profile_id) return r;
      newlyAssignedLines.push(r.line);
      return {
        ...r,
        profile_id: employee.id,
        full_name: employee.full_name,
        email: employee.email,
        existing_hours: 0,
        total_hours: r.hours,
        already_imported: false,
      };
    });
    setPreview({ ...preview, rows });
    setSelected((prev) => {
      const next = new Set(prev);
      newlyAssignedLines.forEach((line) => next.add(line));
      return next;
    });
  }

  const filteredRows = React.useMemo(() => {
    if (!preview) return [];
    const term = search.trim().toLowerCase();
    return preview.rows.filter((r) => {
      if (dayTypeFilter !== "all" && r.day_type !== dayTypeFilter) return false;
      if (term && !r.email.toLowerCase().includes(term) && !r.full_name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [preview, search, dayTypeFilter]);

  function toggleRow(line: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }

  function toggleAllFiltered(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of filteredRows) {
        if (!r.profile_id) continue; // lignes non assignées : pas sélectionnables
        if (checked) next.add(r.line);
        else next.delete(r.line);
      }
      return next;
    });
  }

  async function handleConfirm() {
    if (!preview) return;
    const rowsToImport: ImportPreviewRow[] = preview.rows.filter((r) => selected.has(r.line));
    if (rowsToImport.length === 0) {
      setFinalResult({ error: "Veuillez sélectionner au moins une ligne à importer." });
      return;
    }
    setConfirming(true);
    setFinalResult(null);
    const res = await confirmImportAction(rowsToImport);
    setConfirming(false);
    if ("error" in res) {
      setFinalResult({ error: res.error });
      return;
    }
    setFinalResult({ imported: res.imported, skipped: res.skipped });
    setPreview(null);
    setSelected(new Set());
  }

  const resolvableFilteredRows = filteredRows.filter((r) => r.profile_id);
  const allFilteredSelected = resolvableFilteredRows.length > 0 && resolvableFilteredRows.every((r) => selected.has(r.line));
  const unresolvedCount = preview?.rows.filter((r) => !r.profile_id).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Format attendu</h2>
        <p className="text-sm text-slate-600">
          Fichier CSV ou Excel (.xlsx) avec en-tête, colonnes reconnues :{" "}
          <code className="bg-slate-100 px-1 rounded">{CSV_HEADER}</code>
        </p>
        <ul className="text-xs text-slate-500 list-disc pl-5 space-y-0.5">
          <li>Les en-têtes sont reconnus même avec des variantes (accents, majuscules, synonymes FR/EN comme &quot;Arrivée&quot;/&quot;Départ&quot;).</li>
          <li><code>email</code> : optionnel — si absent, une colonne <code>nom</code>/<code>employé</code> est recherchée automatiquement et les lignes sont associées au compte correspondant ; sinon sélectionnez un employé par défaut ci-dessous.</li>
          <li><code>date</code> : détectée automatiquement même sans en-tête exact (formats YYYY-MM-DD ou JJ/MM/AAAA).</li>
          <li><code>type_jour</code> : normal, congé, maladie, férié payé, férié non payé ou repos (par défaut : normal).</li>
          <li><code>heure_debut</code> / <code>heure_fin</code> : HH:MM, 8h30, etc. — optionnel selon le type de jour.</li>
        </ul>
        <p className="text-xs text-slate-500">
          Les heures importées s&apos;ajoutent automatiquement aux heures déjà enregistrées pour la même date. Vous
          pouvez choisir ligne par ligne celles à importer dans l&apos;aperçu ci-dessous.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
          <Download className="h-3.5 w-3.5" /> Télécharger le modèle CSV
        </Button>
      </div>

      <form onSubmit={handleAnalyze} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="csv-file">Fichier CSV ou Excel (.xlsx)</Label>
          <Input id="csv-file" name="file" type="file" accept=".csv,.xlsx" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="default-employee">
            Employé par défaut <span className="text-slate-400 font-normal">(si le fichier n&apos;a pas de colonne email)</span>
          </Label>
          <Select
            id="default-employee"
            name="default_profile_id"
            value={defaultEmployee}
            onChange={(e) => setDefaultEmployee(e.target.value)}
          >
            <option value="">— Aucun —</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.full_name} ({emp.email})</option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          <Upload className="h-3.5 w-3.5" />
          {pending ? "Analyse en cours..." : "Analyser le fichier"}
        </Button>
        {analyzeError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{analyzeError}</p>}
      </form>

      {preview && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div>
            <p className="text-xs text-slate-500 mb-1">En-têtes détectés dans le fichier :</p>
            <div className="flex flex-wrap gap-1.5">
              {preview.detectedHeaders.map((h, i) => (
                <span key={i} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                  {h.trim() || `(colonne ${i + 1})`}
                </span>
              ))}
            </div>
          </div>

          {preview.suggestedEmployee && (
            <p className="text-sm text-blue-700 bg-blue-50 rounded-md px-3 py-2 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              Employé détecté dans le fichier : <strong>{preview.suggestedEmployee.full_name}</strong> — présélectionné ci-dessus.
            </p>
          )}

          {unresolvedCount > 0 && (
            <div className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2 space-y-2">
              <p className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                {unresolvedCount} ligne(s) ne sont associées à aucun compte (ni email ni nom reconnu dans le fichier).
                Choisissez un employé ci-dessous pour les assigner toutes, sans avoir à ré-analyser le fichier.
              </p>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="space-y-1 min-w-[220px]">
                  <Label htmlFor="assign-employee">Employé à assigner</Label>
                  <Select id="assign-employee" value={assignEmployee} onChange={(e) => setAssignEmployee(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.full_name} ({emp.email})</option>
                    ))}
                  </Select>
                </div>
                <Button type="button" size="sm" onClick={applyEmployeeToUnresolved} disabled={!assignEmployee}>
                  Assigner aux {unresolvedCount} ligne(s) non assignée(s)
                </Button>
              </div>
            </div>
          )}

          {preview.sampleRows.length > 0 && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer select-none">Voir un extrait brut du fichier (avant interprétation)</summary>
              <div className="mt-2 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <tbody>
                    {preview.sampleRows.map((row, i) => (
                      <tr key={i} className="border-t border-slate-100 first:border-t-0">
                        {row.map((cell, j) => (
                          <td key={j} className="px-2 py-1 whitespace-nowrap">{cell || "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">
              Aperçu — {preview.rows.length} ligne(s) détectée(s)
              {unresolvedCount > 0 && `, ${unresolvedCount} non assignée(s)`}
              {preview.errors.length > 0 && `, ${preview.errors.length} ignorée(s)`}
            </h2>
          </div>

          {preview.errors.length > 0 && (
            <div className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2">
              <p className="font-medium mb-1">Lignes ignorées :</p>
              <ul className="list-disc pl-5 space-y-0.5 max-h-32 overflow-y-auto">
                {preview.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {preview.rows.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="space-y-1 flex-1 min-w-[180px]">
                  <Label htmlFor="filter-search">Filtrer par employé</Label>
                  <Input
                    id="filter-search"
                    placeholder="Nom ou email..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="space-y-1 min-w-[160px]">
                  <Label htmlFor="filter-daytype">Type de jour</Label>
                  <Select
                    id="filter-daytype"
                    value={dayTypeFilter}
                    onChange={(e) => setDayTypeFilter(e.target.value)}
                  >
                    <option value="all">Tous</option>
                    {Object.entries(DAY_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-2 text-left">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={(e) => toggleAllFiltered(e.target.checked)}
                        />
                      </th>
                      <th className="px-2 py-2 text-left">Compte</th>
                      <th className="px-2 py-2 text-left">Date</th>
                      <th className="px-2 py-2 text-left">Type</th>
                      <th className="px-2 py-2 text-left">Début</th>
                      <th className="px-2 py-2 text-left">Fin</th>
                      <th className="px-2 py-2 text-left">Pause</th>
                      <th className="px-2 py-2 text-left">Import</th>
                      <th className="px-2 py-2 text-left">Actuel</th>
                      <th className="px-2 py-2 text-left">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r) => (
                      <tr key={r.line} className={cn("border-t border-slate-100", !r.profile_id && "bg-amber-50/60")}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={selected.has(r.line)}
                            onChange={() => toggleRow(r.line)}
                            disabled={!r.profile_id}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          {r.profile_id ? (
                            <>
                              <div className="font-medium text-slate-800">{r.full_name}</div>
                              <div className="text-xs text-slate-400">{r.email}</div>
                              {r.source_name && r.source_name !== r.full_name && (
                                <div className="text-xs text-slate-400">fichier : {r.source_name}</div>
                              )}
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-amber-700 font-medium">Non assigné</span>
                              {r.source_name && (
                                <div className="text-xs text-amber-600">fichier : {r.source_name}</div>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-2 py-1.5">{r.entry_date}</td>
                        <td className="px-2 py-1.5">{DAY_TYPE_LABELS[r.day_type] ?? r.day_type}</td>
                        <td className="px-2 py-1.5">{r.start_time ?? "—"}</td>
                        <td className="px-2 py-1.5">{r.end_time ?? "—"}</td>
                        <td className="px-2 py-1.5">{r.break_minutes} min</td>
                        <td className="px-2 py-1.5">{r.hours.toFixed(2)} h</td>
                        <td className="px-2 py-1.5">{r.existing_hours.toFixed(2)} h</td>
                        <td className={cn("px-2 py-1.5 font-semibold", r.existing_hours > 0 && "text-emerald-600")}>
                          {r.total_hours.toFixed(2)} h
                          {r.already_imported && (
                            <div className="text-xs font-normal text-amber-700">Déjà importée</div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-2 py-4 text-center text-slate-400">
                          Aucune ligne ne correspond aux filtres.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <p className="text-sm text-slate-500">{selected.size} ligne(s) sélectionnée(s) sur {preview.rows.length}</p>
                <Button type="button" onClick={handleConfirm} disabled={confirming || selected.size === 0} className="w-full sm:w-auto">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {confirming ? "Import en cours..." : `Confirmer l'import (${selected.size})`}
                </Button>
              </div>
            </>
          )}
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
              <CheckCircle2 className="h-4 w-4" /> {finalResult.imported} entrée(s) importée(s) avec succès.
              {!!finalResult.skipped && ` ${finalResult.skipped} ligne(s) déjà importée(s) ignorée(s).`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
