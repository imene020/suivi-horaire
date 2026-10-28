import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatHours(hours: number): string {
  const sign = hours < 0 ? "-" : "";
  // Arrondi sur le total de minutes (et non sur la partie décimale seule), sinon
  // 7,999 h s'affichait "7h60" au lieu de "8h00".
  const totalMinutes = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${sign}${h}h${m.toString().padStart(2, "0")}`;
}
