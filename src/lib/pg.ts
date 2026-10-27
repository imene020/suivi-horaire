import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { generateId, hashPassword } from "./db";
import { DEFAULT_WEEKDAY_HOURS, DEFAULT_WEEKLY_TARGET_HOURS } from "./constants";

let _sql: NeonQueryFunction<false, false> | null = null;

export function sql(): NeonQueryFunction<false, false> {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("DATABASE_URL manquant — configurer la connexion Postgres (Neon) dans les variables d'environnement.");
  }
  _sql = neon(url);
  return _sql;
}

// --- Seed des comptes démo ---------------------------------------------------

let seedPromise: Promise<void> | null = null;

/** Crée les comptes démo une seule fois par process, uniquement en développement
 * ou si SEED_DEMO=true. Identique au comportement précédent (withSeed). */
export function withSeed(): Promise<void> {
  if (seedPromise) return seedPromise;
  if (process.env.NODE_ENV !== "development" && process.env.SEED_DEMO !== "true") {
    seedPromise = Promise.resolve();
    return seedPromise;
  }
  // Hors développement, pas de mot de passe connu de tous : un compte admin@demo.com /
  // admin123 sur un site en ligne donnerait un accès admin à n'importe qui.
  const demoPassword = process.env.DEMO_PASSWORD;
  if (process.env.NODE_ENV !== "development" && (!demoPassword || demoPassword.length < 8)) {
    console.warn("[seed] SEED_DEMO=true ignoré : définir DEMO_PASSWORD (8 caractères minimum) pour créer les comptes démo hors développement.");
    seedPromise = Promise.resolve();
    return seedPromise;
  }
  seedPromise = (async () => {
    const db = sql();
    const now = new Date().toISOString();
    const rows = [
      {
        email: "admin@demo.com",
        full_name: "Admin RH",
        role: "admin",
        function_title: "Responsable RH",
        password: demoPassword || "admin123",
      },
      {
        email: "employe@demo.com",
        full_name: "Employé Démo",
        role: "employee",
        function_title: "Consultant",
        password: demoPassword || "employe123",
      },
    ];
    for (const r of rows) {
      const existing = await db`SELECT id FROM profiles WHERE lower(email) = lower(${r.email}) LIMIT 1`;
      if (existing.length > 0) continue;
      await db`INSERT INTO profiles (id, email, full_name, role, function_title, company, phone, weekly_target_hours, weekday_hours, monthly_salary, conge_days_per_month, maladie_days_per_month, active, created_at, password_hash, qr_token, pin_code)
        VALUES (${generateId()}, ${r.email}, ${r.full_name}, ${r.role}, ${r.function_title}, 'ELENI - Consulting', NULL, ${DEFAULT_WEEKLY_TARGET_HOURS}, ${JSON.stringify(DEFAULT_WEEKDAY_HOURS)}, 0, 1.5, 0.5, true, ${now}, ${hashPassword(r.password)}, ${generateId()}, NULL)`;
    }
  })().catch((e) => {
    seedPromise = null;
    throw e;
  });
  return seedPromise;
}

/** Convertit une valeur timestamptz (Date côté driver Neon) en ISO string. */
export function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? "");
}

/**
 * Normalise une colonne "jour" en "YYYY-MM-DD", que la colonne soit de type `date`
 * (le driver Neon renvoie alors un objet Date à minuit heure locale) ou `text`.
 * Le reste du code manipule toujours les jours comme des chaînes "YYYY-MM-DD".
 */
export function toDateOnly(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v ?? "").slice(0, 10);
}

/** Variante de toDateOnly qui conserve null / undefined. */
export function toDateOnlyOrNull(v: unknown): string | null {
  return v === null || v === undefined || v === "" ? null : toDateOnly(v);
}

/** Normalise une colonne heure en "HH:MM" (une colonne `time` renvoie "HH:MM:SS"). */
export function toHHMM(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v).slice(0, 5);
}
