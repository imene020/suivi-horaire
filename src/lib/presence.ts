import { TimeEntry, WeekdayHours } from "./types";
import { standardHoursFor } from "./hours";

/** Situation d'un employé aujourd'hui, pour le tableau "Présences du jour". */
export type PresenceStatus = "working" | "break" | "done" | "leave" | "sick" | "holiday" | "not_yet" | "day_off";

export interface Presence {
  status: PresenceStatus;
  label: string;
  remote: boolean;
}

export function presenceFor(entry: TimeEntry | undefined, today: string, weekdayHours: WeekdayHours): Presence {
  const remote = entry?.work_mode === "teletravail";
  if (entry?.day_type === "conge") return { status: "leave", label: "En congé", remote: false };
  if (entry?.day_type === "maladie") return { status: "sick", label: "Arrêt maladie", remote: false };
  if (entry?.start_time && entry.end_time) return { status: "done", label: `Parti à ${entry.end_time}`, remote };
  if (entry?.start_time && entry.break_start) return { status: "break", label: `En pause depuis ${entry.break_start}`, remote };
  if (entry?.start_time) {
    return { status: "working", label: `${remote ? "En télétravail" : "Au bureau"} depuis ${entry.start_time}`, remote };
  }
  if (entry && entry.day_type !== "normal") {
    return { status: "holiday", label: entry.day_type === "repos" ? "Jour de repos" : "Jour férié", remote: false };
  }
  if (standardHoursFor(today, weekdayHours) === 0) return { status: "day_off", label: "Pas de travail prévu", remote: false };
  return { status: "not_yet", label: "Pas encore pointé", remote: false };
}

export function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
