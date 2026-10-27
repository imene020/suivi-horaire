import { describe, it, expect, afterEach } from "vitest";
import { toDateStr, getMonthGrid, getMonthDates, getDatesBetween, nowInAppTimeZone } from "@/lib/date";
import { getISOWeekKey } from "@/lib/hours";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

// Server (Vercel) runs in UTC, browsers and local machines in Tunisia run at UTC+1.
// The calendar helpers must give the same answer everywhere.
describe.each(["UTC", "Africa/Tunis", "America/New_York", "Asia/Tokyo"])("calendar helpers with TZ=%s", (tz) => {
  it("formats a local date without shifting the day", () => {
    process.env.TZ = tz;
    expect(toDateStr(new Date(2026, 9, 1))).toBe("2026-10-01");
    expect(toDateStr(new Date(2026, 0, 1))).toBe("2026-01-01");
  });

  it("builds month grids that start on the right day", () => {
    process.env.TZ = tz;
    const grid = getMonthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(grid[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    const dates = getMonthDates(2026, 9);
    expect(dates[0]).toBe("2026-10-01");
    expect(dates.at(-1)).toBe("2026-10-31");
  });

  it("computes the Monday of a week", () => {
    process.env.TZ = tz;
    expect(getISOWeekKey("2026-10-28")).toBe("2026-10-26"); // Wednesday -> Monday
    expect(getISOWeekKey("2026-11-01")).toBe("2026-10-26"); // Sunday -> previous Monday
    expect(getISOWeekKey("2026-10-26")).toBe("2026-10-26");
  });

  it("lists dates across a DST change", () => {
    process.env.TZ = tz;
    expect(getDatesBetween("2026-10-24", "2026-10-27")).toEqual([
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
    ]);
  });

  it("reads 'now' in the company time zone (Africa/Tunis, UTC+1), not the server's", () => {
    process.env.TZ = tz;
    // 23:30 UTC is already 00:30 the next day in Tunisia.
    const late = nowInAppTimeZone(new Date("2026-10-27T23:30:00Z"));
    expect(late).toEqual({ year: 2026, month: 9, date: "2026-10-28", time: "00:30" });
    // 07:05 UTC is 08:05 in Tunisia: a punch at that moment must be recorded as 08:05.
    expect(nowInAppTimeZone(new Date("2026-10-27T07:05:00Z")).time).toBe("08:05");
    // Month boundary: 23:15 UTC on Oct 31 is already November in Tunisia.
    expect(nowInAppTimeZone(new Date("2026-10-31T23:15:00Z")).month).toBe(10);
  });
});
