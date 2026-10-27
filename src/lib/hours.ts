import { DayType, TimeEntry, WeekdayHours } from "./types";
import { DEFAULT_WEEKDAY_HOURS } from "./constants";
import { toDateStr } from "./date";

/** Types de journée où les heures sont automatiquement égales aux heures standard du jour */
const AUTO_STANDARD_TYPES: DayType[] = ["conge", "maladie"];
/** Jours non travaillés définis par l'entreprise : le pointage y reste possible */
export const NON_WORKING_DAY_TYPES: DayType[] = ["ferie_paye", "ferie_non_paye", "repos"];

export function timeToMinutes(time: string | null): number {
  if (!time) return 0;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Heures réellement pointées (Fin - Début - Pause), 0 si incomplet. */
export function workedHours(entry: Pick<TimeEntry, "start_time" | "end_time" | "break_minutes">): number {
  if (!entry.start_time || !entry.end_time) return 0;
  const worked = timeToMinutes(entry.end_time) - timeToMinutes(entry.start_time) - (entry.break_minutes || 0);
  return worked > 0 ? worked / 60 : 0;
}

export function standardHoursFor(date: string, weekdayHours: WeekdayHours = DEFAULT_WEEKDAY_HOURS): number {
  const weekday = new Date(date + "T00:00:00").getDay();
  return weekdayHours[String(weekday) as keyof WeekdayHours];
}

/**
 * Calcule les heures payées pour une journée :
 * - Congé / Maladie -> heures standard du jour de la semaine
 * - Férié payé -> heures standard, plus les heures réellement effectuées si l'employé a travaillé
 * - Férié non payé / Repos -> 0 (les heures travaillées sont converties en jours de congé, voir leaves.ts)
 * - Sinon -> Fin - Début - Pause
 */
export function computeDayHours(
  entry: Pick<TimeEntry, "day_type" | "start_time" | "end_time" | "break_minutes" | "entry_date">,
  weekdayHours: WeekdayHours = DEFAULT_WEEKDAY_HOURS
): number {
  if (AUTO_STANDARD_TYPES.includes(entry.day_type)) {
    return standardHoursFor(entry.entry_date, weekdayHours);
  }
  if (entry.day_type === "ferie_paye") {
    return standardHoursFor(entry.entry_date, weekdayHours) + workedHours(entry);
  }
  if (NON_WORKING_DAY_TYPES.includes(entry.day_type)) {
    return 0;
  }
  return workedHours(entry);
}

export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday as first day
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getISOWeekKey(dateStr: string): string {
  const weekStart = getWeekStart(new Date(dateStr + "T00:00:00"));
  return toDateStr(weekStart);
}

export interface WeekSummary {
  weekStart: string;
  totalHours: number;
  targetHours: number;
  diffHours: number;
}

export function summarizeByWeek(
  entries: TimeEntry[],
  weeklyTargetHours: number
): WeekSummary[] {
  const byWeek = new Map<string, number>();
  for (const e of entries) {
    const key = getISOWeekKey(e.entry_date);
    byWeek.set(key, (byWeek.get(key) || 0) + e.hours);
  }
  return Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, totalHours]) => ({
      weekStart,
      totalHours,
      targetHours: weeklyTargetHours,
      diffHours: totalHours - weeklyTargetHours,
    }));
}

export function sumHours(entries: TimeEntry[]): number {
  return entries.reduce((acc, e) => acc + e.hours, 0);
}
