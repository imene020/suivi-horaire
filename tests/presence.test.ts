import { describe, it, expect } from "vitest";
import { presenceFor, initials } from "@/lib/presence";
import { TimeEntry } from "@/lib/types";

const W = { "0": 0, "1": 8, "2": 8, "3": 8, "4": 8, "5": 6, "6": 0 };
const WED = "2026-10-28";
const SUN = "2026-11-01";
const e = (f: Partial<TimeEntry>): TimeEntry => ({
  id: "x", profile_id: "p", entry_date: WED, day_type: "normal", work_mode: "presentiel", start_time: null, end_time: null,
  break_minutes: 0, break_start: null, hours: 0, tasks: null, remarks: null, imported: false, created_at: "", updated_at: "", ...f,
});

describe("presenceFor", () => {
  it("covers each situation of the day", () => {
    expect(presenceFor(undefined, WED, W)).toMatchObject({ status: "not_yet" });
    expect(presenceFor(undefined, SUN, W)).toMatchObject({ status: "day_off" });
    expect(presenceFor(e({ start_time: "08:41" }), WED, W)).toEqual({ status: "working", label: "Au bureau depuis 08:41", remote: false });
    expect(presenceFor(e({ start_time: "08:41", work_mode: "teletravail" }), WED, W).label).toBe("En télétravail depuis 08:41");
    expect(presenceFor(e({ start_time: "08:41", break_start: "12:10" }), WED, W)).toMatchObject({ status: "break", label: "En pause depuis 12:10" });
    expect(presenceFor(e({ start_time: "08:41", end_time: "17:02" }), WED, W)).toMatchObject({ status: "done", label: "Parti à 17:02" });
    expect(presenceFor(e({ day_type: "conge" }), WED, W)).toMatchObject({ status: "leave" });
    expect(presenceFor(e({ day_type: "maladie" }), WED, W)).toMatchObject({ status: "sick" });
    expect(presenceFor(e({ day_type: "ferie_paye" }), WED, W)).toMatchObject({ status: "holiday", label: "Jour férié" });
    // Working on a holiday counts as working.
    expect(presenceFor(e({ day_type: "ferie_paye", start_time: "09:00" }), WED, W)).toMatchObject({ status: "working" });
  });
  it("builds initials", () => {
    expect(initials("Amira Ben Salah")).toBe("AB");
    expect(initials("  karim  ")).toBe("K");
  });
});
