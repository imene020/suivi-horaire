import ExcelJS from "exceljs";
import { Profile, TimeEntry } from "./types";
import { standardHoursFor, workedHours } from "./hours";
import { countRecoveryDays, summarizeMonthlyLeave } from "./leaves";
import { Anomaly } from "./anomalies";
import { DAY_TYPE_LABELS, MONTH_NAMES_FR, WEEKDAY_NAMES_FR } from "./constants";

/**
 * Export de paie mensuel (Excel) pour le comptable : une synthèse par employé, le détail
 * jour par jour, et les points à vérifier avant de payer. Fonction pure (sans accès base),
 * testée dans tests/payroll-export.test.ts.
 */

export type PayrollEmployee = Pick<
  Profile,
  | "id"
  | "full_name"
  | "email"
  | "function_title"
  | "active"
  | "weekday_hours"
  | "monthly_salary"
  | "conge_days_per_month"
  | "maladie_days_per_month"
>;

export interface PayrollExportInput {
  company: string;
  year: number;
  /** Mois 0-11 (comme dans le reste de l'application). */
  month: number;
  employees: PayrollEmployee[];
  /** Entrées du mois exporté (les autres sont ignorées). */
  entries: TimeEntry[];
  anomalies?: Anomaly[];
  /** Horodatage affiché dans l'en-tête, ex. "28/10/2026 à 15:12". */
  generatedAt: string;
}

export interface PayrollSummaryRow {
  profile_id: string;
  full_name: string;
  function_title: string;
  daysWorked: number;
  remoteDays: number;
  workedHours: number;
  paidAbsenceHours: number;
  paidHours: number;
  congeDays: number;
  maladieDays: number;
  recoveryDays: number;
  congeRemaining: number;
  salary: number;
  checks: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Calcule la ligne de synthèse d'un employé pour le mois. */
export function summarizePayroll(emp: PayrollEmployee, monthEntries: TimeEntry[], checks = 0): PayrollSummaryRow {
  let daysWorked = 0;
  let remoteDays = 0;
  let worked = 0;
  let paidAbsence = 0;
  for (const e of monthEntries) {
    const w = e.start_time && e.end_time ? workedHours(e) : 0;
    if (w > 0) {
      daysWorked++;
      worked += w;
      if (e.work_mode === "teletravail") remoteDays++;
    }
    if (e.day_type === "conge" || e.day_type === "maladie") paidAbsence += e.hours;
    if (e.day_type === "ferie_paye") paidAbsence += standardHoursFor(e.entry_date, emp.weekday_hours);
  }
  const leave = summarizeMonthlyLeave(monthEntries, emp);
  return {
    profile_id: emp.id,
    full_name: emp.full_name,
    function_title: emp.function_title ?? "",
    daysWorked,
    remoteDays,
    workedHours: round2(worked),
    paidAbsenceHours: round2(paidAbsence),
    paidHours: round2(monthEntries.reduce((s, e) => s + e.hours, 0)),
    congeDays: leave.congeUsed,
    maladieDays: leave.maladieUsed,
    recoveryDays: countRecoveryDays(monthEntries, emp.weekday_hours),
    congeRemaining: leave.congeRemaining,
    salary: emp.monthly_salary,
    checks,
  };
}

const STEEL = "FF4B4746";
const STEEL_LIGHT = "FFEBEAE8";
const SEA = "FF1F58A8";
const HOURS_FMT = "0.00";
const DAYS_FMT = "0.0";
const MONEY_FMT = '#,##0.000 "TND"';

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 32;
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STEEL } };
  });
}

function titleBlock(ws: ExcelJS.Worksheet, title: string, subtitle: string, lastCol: string) {
  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: STEEL } };
  ws.mergeCells(`A2:${lastCol}2`);
  ws.getCell("A2").value = subtitle;
  ws.getCell("A2").font = { italic: true, size: 10, color: { argb: "FF736D6C" } };
  ws.getRow(1).height = 22;
}

/** "2026-10-05" -> date Excel (les dates Excel n'ont pas de fuseau : on passe par UTC). */
function excelDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export async function buildPayrollWorkbook(input: PayrollExportInput): Promise<Buffer> {
  const { year, month, company } = input;
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthLabel = `${MONTH_NAMES_FR[month]} ${year}`;
  const monthEntries = input.entries.filter((e) => e.entry_date.startsWith(monthPrefix));
  const employees = input.employees.filter((e) => e.active).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const anomalies = input.anomalies ?? [];
  const checksById = new Map<string, number>();
  for (const a of anomalies) checksById.set(a.profile_id, (checksById.get(a.profile_id) ?? 0) + 1);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Suivi Horaire";
  wb.created = new Date();

  // --- Synthèse ---------------------------------------------------------------
  const ws = wb.addWorksheet("Synthèse", { views: [{ state: "frozen", ySplit: 4, xSplit: 1 }] });
  titleBlock(
    ws,
    `${company} — Paie ${monthLabel}`,
    `Généré le ${input.generatedAt} · Heures en décimales (8,50 = 8h30) · Salaire mensuel fixe défini par la RH`,
    "M"
  );
  ws.columns = [
    { key: "name", width: 26 },
    { key: "title", width: 22 },
    { key: "days", width: 11 },
    { key: "remote", width: 12 },
    { key: "worked", width: 13 },
    { key: "absence", width: 15 },
    { key: "paid", width: 12 },
    { key: "conge", width: 10 },
    { key: "maladie", width: 10 },
    { key: "recovery", width: 13 },
    { key: "balance", width: 12 },
    { key: "salary", width: 18 },
    { key: "checks", width: 12 },
  ];
  const header = ws.getRow(4);
  header.values = [
    "Employé",
    "Fonction",
    "Jours travaillés",
    "dont télétravail",
    "Heures travaillées",
    "Heures congé, maladie, férié",
    "Heures payées",
    "Congés (j)",
    "Maladie (j)",
    "Récupération (j)",
    "Solde congé (j)",
    "Salaire mensuel",
    "Points à vérifier",
  ];
  styleHeader(header);

  const rows = employees.map((emp) =>
    summarizePayroll(
      emp,
      monthEntries.filter((e) => e.profile_id === emp.id),
      checksById.get(emp.id) ?? 0
    )
  );
  rows.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    row.values = [
      r.full_name,
      r.function_title,
      r.daysWorked,
      r.remoteDays,
      r.workedHours,
      r.paidAbsenceHours,
      r.paidHours,
      r.congeDays,
      r.maladieDays,
      r.recoveryDays,
      r.congeRemaining,
      r.salary,
      r.checks,
    ];
    if (r.checks > 0) row.getCell(13).font = { bold: true, color: { argb: "FFB45309" } };
    if (r.congeRemaining < 0) row.getCell(11).font = { color: { argb: "FFB91C1C" } };
    if (i % 2 === 1) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F8F7" } };
      });
    }
  });

  const first = 5;
  const last = 4 + rows.length;
  const totalRow = ws.getRow(last + 1);
  totalRow.getCell(1).value = "Total";
  if (rows.length > 0) {
    for (const col of ["C", "D", "E", "F", "G", "H", "I", "J", "L", "M"]) {
      const sum = rows.reduce((s, r) => {
        const v = { C: r.daysWorked, D: r.remoteDays, E: r.workedHours, F: r.paidAbsenceHours, G: r.paidHours, H: r.congeDays, I: r.maladieDays, J: r.recoveryDays, L: r.salary, M: r.checks }[col]!;
        return s + v;
      }, 0);
      ws.getCell(`${col}${last + 1}`).value = { formula: `SUM(${col}${first}:${col}${last})`, result: round2(sum) };
    }
  }
  totalRow.font = { bold: true };
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STEEL_LIGHT } };
    cell.border = { top: { style: "thin", color: { argb: STEEL } } };
  });

  for (const [col, fmt] of [
    ["E", HOURS_FMT], ["F", HOURS_FMT], ["G", HOURS_FMT],
    ["H", DAYS_FMT], ["I", DAYS_FMT], ["J", DAYS_FMT], ["K", DAYS_FMT],
    ["L", MONEY_FMT],
  ] as const) {
    ws.getColumn(col).numFmt = fmt;
  }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 13 } };

  // --- Détail ------------------------------------------------------------------
  const wd = wb.addWorksheet("Détail par jour", { views: [{ state: "frozen", ySplit: 4 }] });
  titleBlock(wd, `Détail des journées — ${monthLabel}`, "Une ligne par employé et par jour enregistré", "J");
  wd.columns = [
    { width: 12 }, { width: 11 }, { width: 26 }, { width: 18 }, { width: 13 },
    { width: 9 }, { width: 9 }, { width: 10 }, { width: 13 }, { width: 40 },
  ];
  const dh = wd.getRow(4);
  dh.values = ["Date", "Jour", "Employé", "Type de jour", "Mode", "Arrivée", "Départ", "Pause (min)", "Heures payées", "Remarques"];
  styleHeader(dh);
  const nameById = new Map(employees.map((e) => [e.id, e.full_name]));
  const detail = monthEntries
    .filter((e) => nameById.has(e.profile_id))
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || nameById.get(a.profile_id)!.localeCompare(nameById.get(b.profile_id)!));
  detail.forEach((e, i) => {
    const row = wd.getRow(5 + i);
    row.values = [
      excelDate(e.entry_date),
      WEEKDAY_NAMES_FR[new Date(e.entry_date + "T00:00:00").getDay()],
      nameById.get(e.profile_id)!,
      DAY_TYPE_LABELS[e.day_type],
      e.work_mode === "teletravail" ? "Télétravail" : e.work_mode === "presentiel" ? "Présentiel" : "",
      e.start_time ?? "",
      e.end_time ?? "",
      e.break_minutes || "",
      e.hours,
      [e.tasks, e.remarks].filter(Boolean).join(" · "),
    ];
  });
  wd.getColumn(1).numFmt = "dd/mm/yyyy";
  wd.getColumn(9).numFmt = HOURS_FMT;
  wd.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 10 } };

  // --- Points à vérifier -----------------------------------------------------------
  const wa = wb.addWorksheet("Points à vérifier", { views: [{ state: "frozen", ySplit: 4 }] });
  titleBlock(
    wa,
    `Points à vérifier avant la paie — ${monthLabel}`,
    anomalies.length
      ? "Détectés automatiquement par Suivi Horaire : à confirmer avec la RH avant de payer"
      : "Aucun point détecté : toutes les journées du mois sont cohérentes",
    "E"
  );
  wa.columns = [{ width: 26 }, { width: 12 }, { width: 12 }, { width: 42 }, { width: 70 }];
  const ah = wa.getRow(4);
  ah.values = ["Employé", "Date", "Gravité", "Point", "Détail"];
  styleHeader(ah);
  const severityLabel = { high: "À corriger", medium: "À vérifier", low: "Pour info" } as const;
  anomalies.forEach((a, i) => {
    const row = wa.getRow(5 + i);
    row.values = [a.full_name, a.date ? excelDate(a.date) : "", severityLabel[a.severity], a.title, a.detail];
    row.getCell(3).font = { bold: true, color: { argb: a.severity === "high" ? "FFB91C1C" : a.severity === "medium" ? "FFB45309" : "FF475569" } };
    row.alignment = { vertical: "top", wrapText: true };
  });
  wa.getColumn(2).numFmt = "dd/mm/yyyy";

  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: SEA } };
  // Impression : paysage, toutes les colonnes sur la largeur d'une page.
  for (const sheet of [ws, wd, wa]) {
    sheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "4:4" };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
