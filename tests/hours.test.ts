import { describe, it, expect } from "vitest";
import { computeDayHours, workedHours, summarizeByWeek, sumHours } from "@/lib/hours";
import { countRecoveryDays, summarizeMonthlyLeave } from "@/lib/leaves";
import { TimeEntry, WeekdayHours } from "@/lib/types";

const WEEKDAY: WeekdayHours = { "0": 0, "1": 8, "2": 8, "3": 8, "4": 8, "5": 7, "6": 0 };
const MON = "2026-10-05";
const FRI = "2026-10-09";
const SUN = "2026-10-11";

function entry(partial: Partial<TimeEntry>): TimeEntry {
  return {
    id: "x",
    profile_id: "p",
    entry_date: MON,
    day_type: "normal",
    work_mode: "presentiel",
    start_time: null,
    end_time: null,
    break_minutes: 0,
    break_start: null,
    hours: 0,
    tasks: null,
    remarks: null,
    imported: false,
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

describe("workedHours", () => {
  it("is end - start - break", () => {
    expect(workedHours({ start_time: "08:00", end_time: "17:00", break_minutes: 60 })).toBe(8);
    expect(workedHours({ start_time: "08:15", end_time: "12:45", break_minutes: 0 })).toBe(4.5);
  });
  it("is 0 when incomplete or negative", () => {
    expect(workedHours({ start_time: "08:00", end_time: null, break_minutes: 0 })).toBe(0);
    expect(workedHours({ start_time: "17:00", end_time: "08:00", break_minutes: 0 })).toBe(0);
  });
});

describe("computeDayHours (current business rules)", () => {
  it("normal day = worked hours", () => {
    expect(computeDayHours({ day_type: "normal", start_time: "09:00", end_time: "17:30", break_minutes: 30, entry_date: MON }, WEEKDAY)).toBe(8);
  });
  it("congé / maladie = standard hours of that weekday", () => {
    expect(computeDayHours({ day_type: "conge", start_time: null, end_time: null, break_minutes: 0, entry_date: MON }, WEEKDAY)).toBe(8);
    expect(computeDayHours({ day_type: "maladie", start_time: null, end_time: null, break_minutes: 0, entry_date: FRI }, WEEKDAY)).toBe(7);
  });
  it("férié payé = standard hours + any hours actually worked", () => {
    expect(computeDayHours({ day_type: "ferie_paye", start_time: null, end_time: null, break_minutes: 0, entry_date: MON }, WEEKDAY)).toBe(8);
    expect(computeDayHours({ day_type: "ferie_paye", start_time: "09:00", end_time: "12:00", break_minutes: 0, entry_date: MON }, WEEKDAY)).toBe(11);
  });
  it("férié non payé / repos = 0 paid hours, even when worked", () => {
    expect(computeDayHours({ day_type: "ferie_non_paye", start_time: "09:00", end_time: "12:00", break_minutes: 0, entry_date: MON }, WEEKDAY)).toBe(0);
    expect(computeDayHours({ day_type: "repos", start_time: "09:00", end_time: "12:00", break_minutes: 0, entry_date: SUN }, WEEKDAY)).toBe(0);
  });
});

describe("leave", () => {
  it("converts work on rest days into recovery days", () => {
    // 4h on a Monday rest day (standard 8h) = 0.5 day; 4h on Sunday (no standard -> 8h) = 0.5 day.
    const entries = [
      entry({ entry_date: MON, day_type: "repos", start_time: "08:00", end_time: "12:00" }),
      entry({ entry_date: SUN, day_type: "ferie_non_paye", start_time: "08:00", end_time: "12:00" }),
    ];
    expect(countRecoveryDays(entries, WEEKDAY)).toBe(1);
  });

  it("summarizes the month: allowance + recovery - used", () => {
    const entries = [
      entry({ entry_date: MON, day_type: "conge" }),
      entry({ entry_date: "2026-10-06", day_type: "maladie" }),
      entry({ entry_date: SUN, day_type: "repos", start_time: "08:00", end_time: "12:00" }),
    ];
    const s = summarizeMonthlyLeave(entries, { conge_days_per_month: 1.5, maladie_days_per_month: 0.5, weekday_hours: WEEKDAY });
    expect(s).toMatchObject({ recoveryDays: 0.5, congeTotal: 2, congeUsed: 1, congeRemaining: 1, maladieUsed: 1, maladieRemaining: -0.5 });
  });
});

describe("weekly summary", () => {
  it("groups entries by Monday-starting week and compares to target", () => {
    const entries = [
      entry({ entry_date: "2026-10-05", hours: 8 }),
      entry({ entry_date: "2026-10-11", hours: 2 }), // Sunday, same week
      entry({ entry_date: "2026-10-12", hours: 7 }), // next Monday
    ];
    const weeks = summarizeByWeek(entries, 40);
    expect(weeks).toEqual([
      { weekStart: "2026-10-05", totalHours: 10, targetHours: 40, diffHours: -30 },
      { weekStart: "2026-10-12", totalHours: 7, targetHours: 40, diffHours: -33 },
    ]);
    expect(sumHours(entries)).toBe(17);
  });
});

describe("formatHours", () => {
  it("rounds on whole minutes (never shows 60 minutes)", async () => {
    const { formatHours } = await import("@/lib/utils");
    expect(formatHours(7.999)).toBe("8h00");
    expect(formatHours(8.5)).toBe("8h30");
    expect(formatHours(-25.75)).toBe("-25h45");
    expect(formatHours(0)).toBe("0h00");
  });
});
