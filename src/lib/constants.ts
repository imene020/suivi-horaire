import { DayType, WeekdayHours, LeaveType, LeaveRequestStatus } from "./types";

export const DEFAULT_WEEKDAY_HOURS: WeekdayHours = {
  "0": 0, // Dimanche
  "1": 8, // Lundi
  "2": 8, // Mardi
  "3": 8, // Mercredi
  "4": 8, // Jeudi
  "5": 6, // Vendredi
  "6": 4, // Samedi
};

export const DEFAULT_WEEKLY_TARGET_HOURS = 42;

/**
 * Taille maximale d'un fichier envoyé. Vercel refuse toute requête de plus de 4,5 Mo
 * (erreur 413) et Next.js limite les Server Actions à 1 Mo par défaut (relevé à 4,5 Mo
 * dans next.config.ts). 4 Mo laisse la marge nécessaire à l'encodage du formulaire.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_ERROR = "Fichier trop volumineux (max 4 Mo).";

/** Vérifie la taille des fichiers d'un formulaire AVANT l'envoi (côté navigateur) :
 * au-delà de la limite, la requête serait rejetée avant d'atteindre l'action serveur. */
export function uploadTooLarge(formData: FormData): string | null {
  for (const value of formData.values()) {
    if (typeof value !== "string" && value.size > MAX_UPLOAD_BYTES) return MAX_UPLOAD_ERROR;
  }
  return null;
}

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  normal: "Normal",
  conge: "Congé",
  maladie: "Maladie",
  ferie_paye: "Férié payé",
  ferie_non_paye: "Férié non payé",
  repos: "Repos",
};

export const DAY_TYPE_COLORS: Record<DayType, string> = {
  normal: "bg-slate-100 text-slate-700",
  conge: "bg-blue-100 text-blue-700",
  maladie: "bg-red-100 text-red-700",
  ferie_paye: "bg-purple-100 text-purple-700",
  ferie_non_paye: "bg-gray-200 text-gray-600",
  repos: "bg-amber-100 text-amber-700",
};

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  conge: "Congé",
  maladie: "Maladie",
};

export const LEAVE_REQUEST_STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  pending: "En attente",
  approved: "Acceptée",
  rejected: "Refusée",
};

export const LEAVE_REQUEST_STATUS_COLORS: Record<LeaveRequestStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

// Palette de couleurs distinctes par employé (calendrier d'équipe).
export const EMPLOYEE_COLORS: string[] = [
  "bg-sky-200 text-sky-900",
  "bg-emerald-200 text-emerald-900",
  "bg-rose-200 text-rose-900",
  "bg-violet-200 text-violet-900",
  "bg-orange-200 text-orange-900",
  "bg-teal-200 text-teal-900",
  "bg-fuchsia-200 text-fuchsia-900",
  "bg-lime-200 text-lime-900",
  "bg-indigo-200 text-indigo-900",
  "bg-yellow-200 text-yellow-900",
  "bg-cyan-200 text-cyan-900",
  "bg-pink-200 text-pink-900",
];

export function employeeColor(index: number): string {
  return EMPLOYEE_COLORS[index % EMPLOYEE_COLORS.length];
}

export const WEEKDAY_NAMES_FR = [
  "Dimanche",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
];

// Jours fériés fixes en Tunisie (dates civiles). Les fêtes religieuses musulmanes
// (Aïd el-Fitr, Aïd el-Adha, Nouvel An hégirien, Mawlid) suivent le calendrier
// lunaire et changent chaque année : elles doivent être ajoutées manuellement
// via le calendrier admin.
export const TUNISIA_FIXED_HOLIDAYS: { month: number; day: number; label: string }[] = [
  { month: 1, day: 1, label: "Jour de l'an" },
  { month: 1, day: 14, label: "Fête de la Révolution" },
  { month: 3, day: 20, label: "Fête de l'Indépendance" },
  { month: 4, day: 9, label: "Journée des Martyrs" },
  { month: 5, day: 1, label: "Fête du Travail" },
  { month: 7, day: 25, label: "Fête de la République" },
  { month: 8, day: 13, label: "Fête de la Femme" },
  { month: 10, day: 15, label: "Fête de l'Évacuation" },
];

export const MONTH_NAMES_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];
