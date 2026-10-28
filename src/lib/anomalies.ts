import { Profile, TimeEntry, WeekdayHours } from "./types";
import { computeDayHours, standardHoursFor, timeToMinutes, workedHours } from "./hours";
import { summarizeMonthlyLeave } from "./leaves";
import { getDatesBetween, toDateStr } from "./date";
import { formatHours } from "./utils";

/**
 * "Points à vérifier" : détection automatique des journées qui méritent un coup d'œil
 * avant la paie (oubli de pointage, heures incohérentes, horaires inhabituels...).
 *
 * Fonctions pures, sans accès base : testées dans tests/anomalies.test.ts.
 */

export type AnomalyKind =
  | "missing_clock_out"
  | "hours_mismatch"
  | "long_day"
  | "missing_days"
  | "unusual_start"
  | "negative_balance";

export type AnomalySeverity = "high" | "medium" | "low";

export interface Anomaly {
  id: string;
  kind: AnomalyKind;
  severity: AnomalySeverity;
  profile_id: string;
  full_name: string;
  /** Jour concerné (YYYY-MM-DD), ou premier jour d'une période. */
  date: string | null;
  title: string;
  detail: string;
}

export type AnomalyEmployee = Pick<
  Profile,
  "id" | "full_name" | "active" | "weekday_hours" | "conge_days_per_month" | "maladie_days_per_month"
>;

export interface DetectOptions {
  /** Aujourd'hui (YYYY-MM-DD) dans le fuseau de l'entreprise. */
  today: string;
  /** Profondeur d'analyse, en jours (30 par défaut). */
  windowDays?: number;
  /** Au-delà, une journée travaillée est signalée comme anormalement longue (12 h par défaut). */
  longDayHours?: number;
  /** Les jours sans aucun pointage ne sont recherchés que sur cette période récente (14 jours). */
  missingDaysWindow?: number;
  /** Mois (YYYY-MM) dont on vérifie les soldes de congé/maladie (par défaut, celui de `today`). */
  balanceMonth?: string;
}

const SEVERITY_ORDER: Record<AnomalySeverity, number> = { high: 0, medium: 1, low: 2 };

/** Écart toléré entre heures payées et heures recalculées (arrondis de saisie). */
const MISMATCH_TOLERANCE_HOURS = 0.25;
/** Nombre minimum d'arrivées pour établir les habitudes d'un employé. */
const MIN_SAMPLES_FOR_BASELINE = 8;
/** Écart minimal à la médiane pour qu'une heure d'arrivée soit jugée inhabituelle. */
const MIN_UNUSUAL_START_MINUTES = 90;

export function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function fmtDay(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function fmtClock(minutes: number): string {
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Écart absolu médian : une mesure de dispersion robuste, insensible aux valeurs aberrantes
 * (contrairement à l'écart-type, une seule arrivée à 4 h du matin ne fausse pas la référence). */
export function medianAbsoluteDeviation(values: number[]): number {
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

export function detectAnomalies(
  employees: AnomalyEmployee[],
  entries: TimeEntry[],
  options: DetectOptions
): Anomaly[] {
  const { today } = options;
  const windowDays = options.windowDays ?? 30;
  const longDayHours = options.longDayHours ?? 12;
  const missingWindow = options.missingDaysWindow ?? 14;
  const windowStart = shiftDate(today, -windowDays);

  const byProfile = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    if (e.entry_date < windowStart || e.entry_date > today) continue;
    (byProfile.get(e.profile_id) ?? byProfile.set(e.profile_id, []).get(e.profile_id)!).push(e);
  }

  const out: Anomaly[] = [];
  const push = (a: Omit<Anomaly, "id">) => out.push({ ...a, id: `${a.kind}:${a.profile_id}:${a.date ?? ""}` });

  for (const emp of employees) {
    if (!emp.active) continue;
    const list = (byProfile.get(emp.id) ?? []).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    const base = { profile_id: emp.id, full_name: emp.full_name };

    for (const e of list) {
      const isPast = e.entry_date < today;
      const open = !!e.start_time && !e.end_time;

      // 1. Départ jamais pointé : la journée compte 0 h.
      if (isPast && open) {
        push({
          ...base,
          kind: "missing_clock_out",
          severity: "high",
          date: e.entry_date,
          title: `Départ non pointé le ${fmtDay(e.entry_date)}`,
          detail: `Arrivée à ${e.start_time}, aucun départ enregistré : la journée compte 0h00.`,
        });
        continue;
      }

      // 2. Heures payées différentes de ce que donnent les règles de calcul.
      const complete = !!e.start_time && !!e.end_time;
      // Jours aux heures connues d'avance : congé, maladie, férié payé (= heures standard).
      if (complete || e.day_type === "conge" || e.day_type === "maladie" || e.day_type === "ferie_paye") {
        const expected = computeDayHours(e, emp.weekday_hours);
        if (Math.abs(e.hours - expected) > MISMATCH_TOLERANCE_HOURS) {
          const fromScan = (e.remarks ?? "").includes("Import scan");
          const source = fromScan
            ? " Des heures ont été ajoutées par un scan : à confirmer."
            : e.imported
              ? " Ligne importée depuis un fichier : possible import en double."
              : "";
          push({
            ...base,
            kind: "hours_mismatch",
            severity: fromScan ? "low" : "high",
            date: e.entry_date,
            title: `Heures incohérentes le ${fmtDay(e.entry_date)}`,
            detail:
              `${formatHours(e.hours)} payées, ${formatHours(expected)} attendues` +
              (complete ? ` (${e.start_time} → ${e.end_time}, pause ${e.break_minutes} min).` : ".") +
              source,
          });
        }
      }

      // 3. Journée anormalement longue (oubli de pointer le départ le soir même ?).
      if (complete) {
        const w = workedHours(e);
        if (w > longDayHours) {
          push({
            ...base,
            kind: "long_day",
            severity: "medium",
            date: e.entry_date,
            title: `Journée de ${formatHours(w)} le ${fmtDay(e.entry_date)}`,
            detail: `${e.start_time} → ${e.end_time}, pause ${e.break_minutes} min. Vraie longue journée ou départ pointé trop tard ?`,
          });
        }
      }
    }

    // 4. Arrivée inhabituelle, comparée aux habitudes de l'employé (médiane + écart absolu médian).
    const starts = list.filter((e) => e.day_type === "normal" && e.start_time);
    if (starts.length >= MIN_SAMPLES_FOR_BASELINE) {
      const minutes = starts.map((e) => timeToMinutes(e.start_time));
      const m = median(minutes);
      const threshold = Math.max(MIN_UNUSUAL_START_MINUTES, 3.5 * 1.4826 * medianAbsoluteDeviation(minutes));
      for (const e of starts) {
        const t = timeToMinutes(e.start_time);
        if (Math.abs(t - m) > threshold) {
          push({
            ...base,
            kind: "unusual_start",
            severity: "low",
            date: e.entry_date,
            title: `Arrivée inhabituelle à ${e.start_time} le ${fmtDay(e.entry_date)}`,
            detail: `D'habitude vers ${fmtClock(m)} (médiane de ses ${starts.length} dernières arrivées). Erreur de saisie ?`,
          });
        }
      }
    }

    // 5. Jours ouvrés récents sans aucune trace (ni pointage, ni absence, ni férié).
    if (list.length > 0) {
      const firstKnown = list[0].entry_date;
      const from = [shiftDate(today, -missingWindow), firstKnown].sort()[1];
      const known = new Set(list.map((e) => e.entry_date));
      const missing = getDatesBetween(from, shiftDate(today, -1)).filter(
        (d) => standardHoursFor(d, emp.weekday_hours as WeekdayHours) > 0 && !known.has(d)
      );
      // Regroupe les jours manquants consécutifs (en ignorant les jours non travaillés entre eux).
      const groups: string[][] = [];
      for (const d of missing) {
        const last = groups.at(-1);
        const prev = last?.at(-1);
        const contiguous =
          prev &&
          getDatesBetween(shiftDate(prev, 1), shiftDate(d, -1)).every(
            (x) => standardHoursFor(x, emp.weekday_hours as WeekdayHours) === 0
          );
        if (last && contiguous) last.push(d);
        else groups.push([d]);
      }
      for (const g of groups) {
        const label = g.length === 1 ? `le ${fmtDay(g[0])}` : `du ${fmtDay(g[0])} au ${fmtDay(g[g.length - 1])}`;
        push({
          ...base,
          kind: "missing_days",
          severity: "medium",
          date: g[0],
          title: `Aucun pointage ${label}`,
          detail:
            g.length === 1
              ? "Ni pointage ni absence enregistrée ce jour ouvré. Oubli, ou congé non déclaré ?"
              : `${g.length} jours ouvrés sans pointage ni absence enregistrée. Oubli, ou congé non déclaré ?`,
        });
      }
    }

    // 6. Solde de congé ou de maladie dépassé ce mois-ci.
    const monthPrefix = options.balanceMonth ?? today.slice(0, 7);
    const monthEntries = list.filter((e) => e.entry_date.startsWith(monthPrefix));
    if (monthEntries.length > 0) {
      const s = summarizeMonthlyLeave(monthEntries, emp);
      const days = (n: number) => `${String(Math.round(n * 100) / 100).replace(".", ",")} j`;
      if (s.maladieRemaining < 0) {
        push({
          ...base,
          kind: "negative_balance",
          severity: "low",
          date: null,
          title: options.balanceMonth ? "Solde maladie dépassé sur le mois" : "Solde maladie dépassé ce mois-ci",
          detail: `${days(s.maladieUsed)} pris pour ${days(s.maladieTotal)} disponibles.`,
        });
      }
      if (s.congeRemaining < 0) {
        push({
          ...base,
          kind: "negative_balance",
          severity: "low",
          date: null,
          title: options.balanceMonth ? "Solde de congé dépassé sur le mois" : "Solde de congé dépassé ce mois-ci",
          detail: `${days(s.congeUsed)} pris pour ${days(s.congeTotal)} disponibles.`,
        });
      }
    }
  }

  return out.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (b.date ?? "").localeCompare(a.date ?? "") ||
      a.full_name.localeCompare(b.full_name)
  );
}
