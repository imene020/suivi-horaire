/**
 * Fuseau horaire de l'entreprise. Toutes les notions de "aujourd'hui" et d'heure de
 * pointage en dépendent. Le serveur (Vercel) tourne en UTC et le navigateur dans le
 * fuseau de l'utilisateur : sans fuseau explicite, un pointage serait enregistré
 * avec une heure de décalage. Surchargeable via NEXT_PUBLIC_APP_TIME_ZONE.
 */
export const APP_TIME_ZONE = process.env.NEXT_PUBLIC_APP_TIME_ZONE || "Africa/Tunis";

/**
 * Date (jour du calendrier) au format "YYYY-MM-DD", à partir des champs LOCAUX de `d`.
 * (L'ancienne version utilisait toISOString(), qui convertit en UTC : à UTC+1, minuit
 * le 1er octobre devenait "30 septembre", d'où un calendrier décalé d'un jour.)
 */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Date et heure "murales" dans le fuseau de l'entreprise, quel que soit le fuseau du serveur. */
export function nowInAppTimeZone(now: Date = new Date(), timeZone: string = APP_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const year = Number(get("year"));
  const month = Number(get("month")) - 1; // 0-based, comme Date#getMonth()
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;
  return { year, month, date, time };
}

/** "YYYY-MM-DD" du jour courant dans le fuseau de l'entreprise. */
export function todayStr(now: Date = new Date()): string {
  return nowInAppTimeZone(now).date;
}

/** "HH:MM" courant dans le fuseau de l'entreprise. */
export function nowHHMM(now: Date = new Date()): string {
  return nowInAppTimeZone(now).time;
}

export function getMonthDates(year: number, month: number): string[] {
  const dates: string[] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    dates.push(toDateStr(d));
  }
  return dates;
}

export function getMonthRange(year: number, month: number): { start: string; end: string } {
  const dates = getMonthDates(year, month);
  return { start: dates[0], end: dates[dates.length - 1] };
}

export function getYearRange(year: number): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

/** Toutes les dates (YYYY-MM-DD) entre start et end inclus. */
export function getDatesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(start + "T00:00:00");
  const last = new Date(end + "T00:00:00");
  while (cursor <= last) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/**
 * Retourne une grille de semaines (Lundi -> Dimanche) pour un mois donné.
 * Les cases hors du mois sont `null`.
 */
export function getMonthGrid(year: number, month: number): (string | null)[][] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0 = Dimanche
  const leadingBlanks = firstWeekday === 0 ? 6 : firstWeekday - 1; // Lundi en premier

  const cells: (string | null)[] = Array(leadingBlanks).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(toDateStr(new Date(year, month, day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}
