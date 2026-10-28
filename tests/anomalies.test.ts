import { describe, it, expect } from "vitest";
import { detectAnomalies, median, medianAbsoluteDeviation, AnomalyEmployee } from "@/lib/anomalies";
import { TimeEntry } from "@/lib/types";
import { getDatesBetween } from "@/lib/date";

const WEEKDAY = { "0": 0, "1": 8, "2": 8, "3": 8, "4": 8, "5": 6, "6": 0 } as const;
const TODAY = "2026-10-28"; // a Wednesday

function emp(id: string, extra: Partial<AnomalyEmployee> = {}): AnomalyEmployee {
  return {
    id,
    full_name: id === "a" ? "Amira Ben Salah" : "Youssef Trabelsi",
    active: true,
    weekday_hours: { ...WEEKDAY },
    conge_days_per_month: 1.5,
    maladie_days_per_month: 0.5,
    ...extra,
  };
}

function day(profile_id: string, entry_date: string, f: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: `${profile_id}__${entry_date}`,
    profile_id,
    entry_date,
    day_type: "normal",
    work_mode: "presentiel",
    start_time: "08:30",
    end_time: "17:30",
    break_minutes: 60,
    break_start: null,
    hours: 8,
    tasks: null,
    remarks: null,
    imported: false,
    created_at: "",
    updated_at: "",
    ...f,
  };
}

/** A clean month of normal 8h days (Mon–Thu) and 6h Fridays for one person. */
function cleanHistory(pid: string, from = "2026-09-28", to = "2026-10-27"): TimeEntry[] {
  return getDatesBetween(from, to)
    .filter((d) => WEEKDAY[String(new Date(d + "T00:00:00").getDay()) as keyof typeof WEEKDAY] > 0)
    .map((d) => {
      const friday = new Date(d + "T00:00:00").getDay() === 5;
      return friday ? day(pid, d, { end_time: "14:30", break_minutes: 0, hours: 6 }) : day(pid, d);
    });
}

const kinds = (list: ReturnType<typeof detectAnomalies>) => list.map((a) => a.kind);

describe("robust statistics", () => {
  it("median and MAD ignore a single outlier", () => {
    const starts = [510, 515, 505, 520, 512, 508, 252];
    expect(median(starts)).toBe(510);
    expect(medianAbsoluteDeviation(starts)).toBe(5);
  });
});

describe("detectAnomalies", () => {
  it("finds nothing in a clean month", () => {
    expect(detectAnomalies([emp("a")], cleanHistory("a"), { today: TODAY })).toEqual([]);
  });

  it("flags a forgotten clock-out as high severity", () => {
    const entries = cleanHistory("a").map((e) =>
      e.entry_date === "2026-10-21" ? { ...e, start_time: "08:41", end_time: null, hours: 0 } : e
    );
    const found = detectAnomalies([emp("a")], entries, { today: TODAY });
    expect(found[0]).toMatchObject({ kind: "missing_clock_out", severity: "high", date: "2026-10-21" });
    expect(found[0].detail).toContain("08:41");
  });

  it("does not flag today's open day (still at work)", () => {
    const entries = [...cleanHistory("a"), day("a", TODAY, { end_time: null, hours: 0 })];
    expect(kinds(detectAnomalies([emp("a")], entries, { today: TODAY }))).not.toContain("missing_clock_out");
  });

  it("flags paid hours that don't match the punches (e.g. a doubled import)", () => {
    const entries = cleanHistory("a").map((e) =>
      e.entry_date === "2026-10-08" ? { ...e, hours: 16, imported: true } : e
    );
    const [a] = detectAnomalies([emp("a")], entries, { today: TODAY });
    expect(a).toMatchObject({ kind: "hours_mismatch", severity: "high", date: "2026-10-08" });
    expect(a.detail).toContain("16h00 payées, 8h00 attendues");
    expect(a.detail).toContain("import");
  });

  it("treats hours added by a scan as a low-severity check", () => {
    const entries = cleanHistory("a").map((e) =>
      e.entry_date === "2026-10-08" ? { ...e, hours: 12, remarks: "Import scan (+4.00 h)" } : e
    );
    expect(detectAnomalies([emp("a")], entries, { today: TODAY })[0]).toMatchObject({ kind: "hours_mismatch", severity: "low" });
  });

  it("checks leave days against standard hours", () => {
    const entries = cleanHistory("a").map((e) =>
      e.entry_date === "2026-10-12" ? { ...e, day_type: "conge" as const, start_time: null, end_time: null, hours: 4 } : e
    );
    expect(detectAnomalies([emp("a")], entries, { today: TODAY })[0]).toMatchObject({ kind: "hours_mismatch", date: "2026-10-12" });
  });

  it("checks paid holidays too (a holiday paying 16 h instead of 8 h)", () => {
    const entries = cleanHistory("a").map((e) =>
      e.entry_date === "2026-10-08" ? { ...e, day_type: "ferie_paye" as const, start_time: null, end_time: null, hours: 16, imported: true } : e
    );
    const [a] = detectAnomalies([emp("a")], entries, { today: TODAY });
    expect(a).toMatchObject({ kind: "hours_mismatch", date: "2026-10-08" });
    expect(a.detail).toContain("16h00 payées, 8h00 attendues");
    // A normal paid holiday is fine.
    const ok = cleanHistory("a").map((e) =>
      e.entry_date === "2026-10-08" ? { ...e, day_type: "ferie_paye" as const, start_time: null, end_time: null, hours: 8 } : e
    );
    expect(detectAnomalies([emp("a")], ok, { today: TODAY })).toEqual([]);
  });

  it("flags very long days", () => {
    const entries = cleanHistory("a").map((e) =>
      e.entry_date === "2026-10-14" ? { ...e, start_time: "07:05", end_time: "21:20", break_minutes: 15, hours: 14 } : e
    );
    const found = detectAnomalies([emp("a")], entries, { today: TODAY });
    expect(found.find((a) => a.kind === "long_day")).toMatchObject({ severity: "medium", date: "2026-10-14" });
  });

  it("flags a clock-in far from the person's own habit, not a normal variation", () => {
    const entries = cleanHistory("a").map((e, i) => {
      if (e.entry_date === "2026-10-23") return { ...e, start_time: "04:12", end_time: "12:30", break_minutes: 0, hours: 8.3 };
      // natural variation of ±20 minutes must not be flagged
      return { ...e, start_time: i % 2 ? "08:10" : "08:50", end_time: i % 2 ? "17:10" : "17:50" };
    });
    const unusual = detectAnomalies([emp("a")], entries, { today: TODAY }).filter((a) => a.kind === "unusual_start");
    expect(unusual).toHaveLength(1);
    expect(unusual[0]).toMatchObject({ date: "2026-10-23", severity: "low" });
    expect(unusual[0].title).toContain("04:12");
  });

  it("needs enough history before judging habits", () => {
    const entries = cleanHistory("a", "2026-10-21", "2026-10-27").map((e, i) =>
      i === 0 ? { ...e, start_time: "04:00" } : e
    );
    expect(kinds(detectAnomalies([emp("a")], entries, { today: TODAY }))).not.toContain("unusual_start");
  });

  it("groups consecutive workdays without any entry, skipping the weekend", () => {
    // Fri 23 and Mon 26 missing: one group, because Sat/Sun are not workdays.
    const entries = cleanHistory("a").filter((e) => !["2026-10-23", "2026-10-26"].includes(e.entry_date));
    const missing = detectAnomalies([emp("a")], entries, { today: TODAY }).filter((a) => a.kind === "missing_days");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ date: "2026-10-23", severity: "medium" });
    expect(missing[0].title).toMatch(/^Aucun pointage du 23 oct\. au 26 oct\.$/);
  });

  it("does not report missing days before the person's first entry (new employee or new install)", () => {
    const entries = cleanHistory("a", "2026-10-26", "2026-10-27");
    expect(kinds(detectAnomalies([emp("a")], entries, { today: TODAY }))).not.toContain("missing_days");
    expect(detectAnomalies([emp("b")], [], { today: TODAY })).toEqual([]);
  });

  it("flags an exceeded sick-leave balance this month", () => {
    const entries = cleanHistory("a").map((e) =>
      e.entry_date === "2026-10-22" ? { ...e, day_type: "maladie" as const, start_time: null, end_time: null, hours: 8 } : e
    );
    const found = detectAnomalies([emp("a")], entries, { today: TODAY }).find((a) => a.kind === "negative_balance");
    expect(found?.title).toBe("Solde maladie dépassé ce mois-ci");
    expect(found?.detail).toBe("1 j pris pour 0,5 j disponibles.");
  });

  it("ignores inactive employees and sorts by severity, then most recent", () => {
    const a = cleanHistory("a").map((e) =>
      e.entry_date === "2026-10-14" ? { ...e, start_time: "07:00", end_time: "21:00", break_minutes: 0, hours: 14 } : e
    );
    const b = cleanHistory("b").map((e) => (e.entry_date === "2026-10-20" ? { ...e, end_time: null, hours: 0 } : e));
    const found = detectAnomalies([emp("a"), emp("b")], [...a, ...b], { today: TODAY });
    expect(found[0].kind).toBe("missing_clock_out");
    expect(found.map((x) => x.severity)).toEqual([...found.map((x) => x.severity)].sort((x, y) => ["high", "medium", "low"].indexOf(x) - ["high", "medium", "low"].indexOf(y)));
    expect(detectAnomalies([emp("b", { active: false })], b, { today: TODAY })).toEqual([]);
  });
});
