import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildPayrollWorkbook, summarizePayroll, PayrollEmployee } from "@/lib/payroll-export";
import { TimeEntry } from "@/lib/types";
import { Anomaly } from "@/lib/anomalies";

const W = { "0": 0, "1": 8, "2": 8, "3": 8, "4": 8, "5": 6, "6": 4 };
const emp = (id: string, name: string, extra: Partial<PayrollEmployee> = {}): PayrollEmployee => ({
  id, full_name: name, email: `${id}@x.tn`, function_title: "Consultant", active: true, weekday_hours: W,
  monthly_salary: 2400, conge_days_per_month: 1.5, maladie_days_per_month: 0.5, ...extra,
});
const e = (profile_id: string, entry_date: string, f: Partial<TimeEntry> = {}): TimeEntry => ({
  id: `${profile_id}__${entry_date}`, profile_id, entry_date, day_type: "normal", work_mode: "presentiel",
  start_time: "08:00", end_time: "17:00", break_minutes: 60, break_start: null, hours: 8, tasks: null, remarks: null,
  imported: false, created_at: "", updated_at: "", ...f,
});

const amira = emp("a", "Amira Ben Salah", { monthly_salary: 2400.5 });
const youssef = emp("y", "Youssef Trabelsi", { monthly_salary: 2900 });
const entries: TimeEntry[] = [
  e("a", "2026-10-05"),
  e("a", "2026-10-06", { work_mode: "teletravail", start_time: "09:00", end_time: "17:30", break_minutes: 30 }),
  e("a", "2026-10-07", { day_type: "conge", start_time: null, end_time: null, work_mode: null }),
  e("a", "2026-10-15", { day_type: "ferie_paye", start_time: null, end_time: null, work_mode: null }),
  e("a", "2026-10-18", { day_type: "repos", start_time: "09:00", end_time: "13:00", break_minutes: 0, hours: 0 }), // Sunday worked
  e("y", "2026-10-05"),
  e("y", "2026-09-30"), // previous month: excluded
];

describe("summarizePayroll", () => {
  it("splits worked, paid-absence and paid hours", () => {
    const r = summarizePayroll(amira, entries.filter((x) => x.profile_id === "a"));
    expect(r).toMatchObject({
      daysWorked: 3, // 5th, 6th, and the Sunday 18th
      remoteDays: 1,
      workedHours: 8 + 8 + 4,
      paidAbsenceHours: 8 + 8, // congé + férié payé (Thursday standard 8h)
      paidHours: 8 + 8 + 8 + 8 + 0,
      congeDays: 1,
      maladieDays: 0,
      recoveryDays: 0.5, // 4h on a Sunday (no standard -> 8h)
      congeRemaining: 1, // 1.5 + 0.5 recovery - 1
    });
  });
});

describe("buildPayrollWorkbook", () => {
  it("produces a summary, a daily detail and the checks to review", async () => {
    const anomalies: Anomaly[] = [
      { id: "1", kind: "missing_clock_out", severity: "high", profile_id: "y", full_name: "Youssef Trabelsi", date: "2026-10-21", title: "Départ non pointé le 21 oct.", detail: "Arrivée à 08:41" },
    ];
    const buf = await buildPayrollWorkbook({
      company: "ELENI - Consulting", year: 2026, month: 9,
      employees: [youssef, amira, emp("z", "Ancien", { active: false })],
      entries, anomalies, generatedAt: "28/10/2026 à 15:12",
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Synthèse", "Détail par jour", "Points à vérifier"]);

    const s = wb.getWorksheet("Synthèse")!;
    expect(s.getCell("A1").value).toBe("ELENI - Consulting — Paie Octobre 2026");
    expect(s.getCell("A4").value).toBe("Employé");
    // Sorted by name, inactive employees left out.
    expect(s.getCell("A5").value).toBe("Amira Ben Salah");
    expect(s.getCell("A6").value).toBe("Youssef Trabelsi");
    expect(s.getCell("A7").value).toBe("Total");
    expect(s.getCell("G5").value).toBe(32);
    expect(s.getCell("L5").value).toBe(2400.5);
    expect(s.getCell("M6").value).toBe(1);
    const total = s.getCell("L7").value as { formula: string; result: number };
    expect(total.formula).toBe("SUM(L5:L6)");
    expect(total.result).toBe(5300.5);
    expect(s.getColumn("L").numFmt).toContain("TND");

    const d = wb.getWorksheet("Détail par jour")!;
    expect(d.getCell("C5").value).toBe("Amira Ben Salah");
    const firstDate = d.getCell("A5").value as Date;
    expect(firstDate.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(d.getCell("B5").value).toBe("Lundi");
    // 5 Amira days + 1 Youssef day in October (September entry excluded)
    expect(d.rowCount).toBe(4 + 6);

    const a = wb.getWorksheet("Points à vérifier")!;
    expect(a.getCell("A5").value).toBe("Youssef Trabelsi");
    expect(a.getCell("C5").value).toBe("À corriger");
  });

  it("works for a month without anything recorded", async () => {
    const buf = await buildPayrollWorkbook({
      company: "ELENI - Consulting", year: 2026, month: 0, employees: [amira], entries: [], generatedAt: "x",
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as never);
    expect(wb.getWorksheet("Synthèse")!.getCell("G5").value).toBe(0);
    expect(wb.getWorksheet("Points à vérifier")!.getCell("A2").value).toContain("Aucun point");
  });
});
