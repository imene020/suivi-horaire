import "server-only";
import path from "path";
import { sql, withSeed, toIso, toDateOnly, toDateOnlyOrNull, toHHMM } from "./pg";
import { generateId, hashPassword, StoredProfile, DocumentRecord } from "./db";
import { computeDayHours, NON_WORKING_DAY_TYPES } from "./hours";
import { DEFAULT_WEEKDAY_HOURS, DEFAULT_WEEKLY_TARGET_HOURS } from "./constants";
import { todayStr, nowHHMM } from "./date";
import {
  Profile,
  TimeEntry,
  LeaveBalance,
  WeekdayHours,
  DayType,
  WorkMode,
  EmployeeTask,
  LeaveRequest,
  LeaveRequestStatus,
  LeaveType,
  AppNotification,
  NotificationType,
  Meeting,
  MeetingParticipant,
  MeetingAttachment,
  Message,
  ConversationSummary,
  OcrDraftRow,
  OcrDraftStatus,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

async function sqlQ(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> {
  const s = await pgdb();
  return s(strings, ...values) as Promise<Row[]>;
}

async function pgdb() {
  await withSeed();
  return sql();
}

/**
 * "($1, $2), ($3, $4), ..." pour un INSERT multi-lignes. Les paramètres ne sont pas
 * typés explicitement : Postgres les déduit du type des colonnes cibles, ce qui
 * fonctionne que les identifiants soient en `uuid` ou en `text`.
 */
function valuesPlaceholders(rowCount: number, colCount: number): string {
  const rows: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    const cols: string[] = [];
    for (let c = 0; c < colCount; c++) cols.push(`$${r * colCount + c + 1}`);
    rows.push(`(${cols.join(", ")})`);
  }
  return rows.join(", ");
}

async function insertMeetingParticipants(meetingId: string, profileIds: string[]): Promise<void> {
  const ids = [...new Set(profileIds)].filter(Boolean);
  if (ids.length === 0) return;
  const dbq = await pgdb();
  await dbq.query(
    `INSERT INTO meeting_participants (meeting_id, profile_id) VALUES ${valuesPlaceholders(ids.length, 2)}
     ON CONFLICT DO NOTHING`,
    ids.flatMap((pid) => [meetingId, pid])
  );
}

function stripPassword(p: StoredProfile): Profile {
  const { password_hash, ...rest } = p;
  void password_hash;
  return rest;
}

function mapProfileRow(r: Row): StoredProfile {
  return {
    id: r.id,
    email: r.email,
    full_name: r.full_name,
    role: r.role,
    function_title: r.function_title ?? null,
    company: r.company,
    phone: r.phone ?? null,
    weekly_target_hours: Number(r.weekly_target_hours ?? 0),
    weekday_hours: r.weekday_hours,
    monthly_salary: Number(r.monthly_salary ?? 0),
    conge_days_per_month: Number(r.conge_days_per_month ?? 1.5),
    maladie_days_per_month: Number(r.maladie_days_per_month ?? 0.5),
    active: !!r.active,
    created_at: toIso(r.created_at),
    password_hash: r.password_hash,
  };
}

// --- Profiles ---------------------------------------------------------------------

export async function findProfileByEmail(email: string): Promise<StoredProfile | null> {
  const rows = await sqlQ`SELECT * FROM profiles WHERE lower(email) = lower(${email}) LIMIT 1`;
  return rows.length ? mapProfileRow(rows[0]) : null;
}

export async function findProfileById(id: string): Promise<Profile | null> {
  const rows = await sqlQ`SELECT * FROM profiles WHERE id = ${id} LIMIT 1`;
  return rows.length ? stripPassword(mapProfileRow(rows[0])) : null;
}

export async function listEmployees(): Promise<Profile[]> {
  const rows = await sqlQ`SELECT * FROM profiles WHERE role = 'employee'`;
  return rows.map((r) => stripPassword(mapProfileRow(r))).sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function listAdmins(): Promise<Profile[]> {
  const rows = await sqlQ`SELECT * FROM profiles WHERE role = 'admin'`;
  return rows
    .map((r) => stripPassword(mapProfileRow(r)))
    .filter((p) => p.active)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export interface CreateProfileInput {
  email: string;
  password: string;
  full_name: string;
  function_title: string;
  company: string;
  weekly_target_hours: number;
  weekday_hours: WeekdayHours;
  monthly_salary: number;
  conge_days_per_month: number;
  maladie_days_per_month: number;
}

export async function createEmployeeProfile(input: CreateProfileInput): Promise<{ error?: string; id?: string }> {
  if (await findProfileByEmail(input.email)) {
    return { error: "Un compte existe déjà avec cet email." };
  }

  const id = generateId();
  const now = new Date().toISOString();

  await sqlQ`INSERT INTO profiles
    (id, email, full_name, role, function_title, company, phone, weekly_target_hours, weekday_hours,
     active, created_at, password_hash, qr_token, pin_code, monthly_salary, conge_days_per_month, maladie_days_per_month)
    VALUES (${id}, ${input.email}, ${input.full_name}, 'employee', ${input.function_title || null}, ${input.company},
      NULL, ${input.weekly_target_hours || DEFAULT_WEEKLY_TARGET_HOURS}, ${JSON.stringify(input.weekday_hours || DEFAULT_WEEKDAY_HOURS)},
      true, ${now}, ${hashPassword(input.password)}, ${generateId()}, NULL,
      ${input.monthly_salary ?? 0}, ${input.conge_days_per_month ?? 1.5}, ${input.maladie_days_per_month ?? 0.5})`;

  return { id };
}

export interface MonthlySettingsInput {
  monthly_salary: number;
  conge_days_per_month: number;
  maladie_days_per_month: number;
}

export async function updateMonthlySettings(id: string, input: MonthlySettingsInput): Promise<void> {
  await sqlQ`UPDATE profiles SET monthly_salary = ${input.monthly_salary},
    conge_days_per_month = ${input.conge_days_per_month}, maladie_days_per_month = ${input.maladie_days_per_month}
    WHERE id = ${id}`;
}

export interface CreateComptableInput {
  email: string;
  password: string;
  full_name: string;
  function_title: string;
  company: string;
}

export async function listComptables(): Promise<Profile[]> {
  const rows = await sqlQ`SELECT * FROM profiles WHERE role = 'comptable'`;
  return rows.map((r) => stripPassword(mapProfileRow(r))).sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function createComptableProfile(input: CreateComptableInput): Promise<{ error?: string; id?: string }> {
  if (await findProfileByEmail(input.email)) {
    return { error: "Un compte existe déjà avec cet email." };
  }

  const id = generateId();
  const now = new Date().toISOString();

  await sqlQ`INSERT INTO profiles
    (id, email, full_name, role, function_title, company, phone, weekly_target_hours, weekday_hours,
     active, created_at, password_hash, qr_token, pin_code, monthly_salary, conge_days_per_month, maladie_days_per_month)
    VALUES (${id}, ${input.email}, ${input.full_name}, 'comptable', ${input.function_title || null}, ${input.company},
      NULL, 0, ${JSON.stringify(DEFAULT_WEEKDAY_HOURS)},
      true, ${now}, ${hashPassword(input.password)}, ${generateId()}, NULL, 0, 1.5, 0.5)`;

  return { id };
}

export interface UpdateProfileInput {
  id: string;
  full_name: string;
  function_title: string;
  company: string;
  phone?: string;
  weekly_target_hours: number;
  weekday_hours: WeekdayHours;
  active: boolean;
}

export async function updateProfile(input: UpdateProfileInput): Promise<{ error?: string }> {
  await sqlQ`UPDATE profiles SET full_name = ${input.full_name},
    function_title = ${input.function_title || null}, company = ${input.company},
    weekly_target_hours = ${input.weekly_target_hours}, weekday_hours = ${JSON.stringify(input.weekday_hours)},
    active = ${input.active}, phone = ${input.phone || null}
    WHERE id = ${input.id}`;
  return {};
}

export interface UpdateAccountInput {
  email?: string;
  password?: string;
  role?: Profile["role"];
}

/** Gestion administrative du compte : email, mot de passe, rôle. Séparé de
 * `updateProfile` car ce sont des champs sensibles (identité de connexion). */
export async function updateAccount(id: string, input: UpdateAccountInput): Promise<{ error?: string }> {
  if (input.email) {
    const existing = await findProfileByEmail(input.email);
    if (existing && existing.id !== id) return { error: "Un autre compte utilise déjà cet email." };
  }
  if (!input.email && !input.password && !input.role) return {};
  const dbq = await pgdb();
  await dbq.query(
    `UPDATE profiles SET
      email = COALESCE($1, email),
      password_hash = COALESCE($2, password_hash),
      role = COALESCE($3, role)
    WHERE id = $4`,
    [input.email ?? null, input.password ? hashPassword(input.password) : null, input.role ?? null, id]
  );
  return {};
}

/** Supprime en cascade (best-effort) tout ce qui référence ce profil. */
export async function deleteProfile(id: string): Promise<void> {
  const dbq = await pgdb();

  for (const table of ["sessions", "time_entries", "leave_balances", "employee_tasks", "leave_requests", "notifications"]) {
    await dbq.query(`DELETE FROM ${table} WHERE profile_id = $1`, [id]);
  }

  await dbq.query(`DELETE FROM documents WHERE profile_id = $1`, [id]);
  await dbq.query(`DELETE FROM messages WHERE $1 = ANY(participant_ids)`, [id]);
  await dbq.query(`DELETE FROM meeting_participants WHERE profile_id = $1`, [id]);
  await dbq.query(`DELETE FROM ocr_drafts WHERE profile_id = $1`, [id]);
  await dbq.query(`DELETE FROM password_resets WHERE profile_id = $1`, [id]);
  await dbq.query(`DELETE FROM profiles WHERE id = $1`, [id]);
}

// --- Leave balances (non utilisé actuellement par l'UI, conservé pour compatibilité) ---

function leaveBalanceDocId(profileId: string, year: number, leaveType: string) {
  return `${profileId}__${year}__${leaveType}`;
}

export async function getLeaveBalances(profileId: string, year: number): Promise<LeaveBalance[]> {
  const rows = await sqlQ`SELECT * FROM leave_balances WHERE profile_id = ${profileId} AND year = ${year}`;
  return rows.map((r) => ({
    id: r.id,
    profile_id: r.profile_id,
    year: Number(r.year),
    leave_type: r.leave_type,
    total: Number(r.total),
    used: Number(r.used),
  }));
}

export async function upsertLeaveBalance(
  profileId: string,
  year: number,
  leaveType: "conge" | "maladie",
  total: number
): Promise<void> {
  const id = leaveBalanceDocId(profileId, year, leaveType);
  await sqlQ`INSERT INTO leave_balances (id, profile_id, year, leave_type, total, used)
    VALUES (${id}, ${profileId}, ${year}, ${leaveType}, ${total}, 0)
    ON CONFLICT (id) DO UPDATE SET total = ${total}`;
}

// --- Time entries -------------------------------------------------------------------

function timeEntryDocId(profileId: string, date: string) {
  return `${profileId}__${date}`;
}

function mapTimeEntryRow(r: Row): TimeEntry {
  return {
    id: r.id,
    profile_id: r.profile_id,
    entry_date: toDateOnly(r.entry_date),
    day_type: r.day_type,
    work_mode: r.work_mode ?? null,
    start_time: toHHMM(r.start_time),
    end_time: toHHMM(r.end_time),
    break_minutes: Number(r.break_minutes ?? 0),
    break_start: toHHMM(r.break_start),
    hours: Number(r.hours ?? 0),
    tasks: r.tasks ?? null,
    remarks: r.remarks ?? null,
    imported: !!r.imported,
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
  };
}

async function readTimeEntry(profileId: string, date: string): Promise<TimeEntry | null> {
  const rows = await sqlQ`SELECT * FROM time_entries WHERE id = ${timeEntryDocId(profileId, date)}`;
  return rows.length ? mapTimeEntryRow(rows[0]) : null;
}

/** Écrit une entrée en préservant les champs non fournis (comme un UPDATE partiel SQL). */
async function writeTimeEntry(
  profileId: string,
  date: string,
  fields: Partial<Omit<TimeEntry, "id" | "profile_id" | "entry_date" | "created_at" | "updated_at">>
): Promise<TimeEntry> {
  const dbq = await pgdb();
  const id = timeEntryDocId(profileId, date);
  const existingRows = await dbq`SELECT * FROM time_entries WHERE id = ${id}`;
  const existing = existingRows.length ? existingRows[0] : null;
  const now = new Date().toISOString();

  const merged = {
    day_type: (existing?.day_type ?? "normal") as DayType,
    work_mode: (existing?.work_mode ?? null) as WorkMode,
    start_time: existing?.start_time ?? null,
    end_time: existing?.end_time ?? null,
    break_minutes: Number(existing?.break_minutes ?? 0),
    break_start: existing?.break_start ?? null,
    hours: Number(existing?.hours ?? 0),
    tasks: existing?.tasks ?? null,
    remarks: existing?.remarks ?? null,
    imported: !!existing?.imported,
    ...fields,
  };

  await dbq`INSERT INTO time_entries
    (id, profile_id, entry_date, day_type, work_mode, start_time, end_time, break_minutes, break_start, hours, tasks, remarks, imported, created_at, updated_at)
    VALUES (${id}, ${profileId}, ${date}, ${merged.day_type}, ${merged.work_mode}, ${merged.start_time},
      ${merged.end_time}, ${merged.break_minutes}, ${merged.break_start}, ${merged.hours},
      ${merged.tasks}, ${merged.remarks}, ${merged.imported},
      ${existing ? toIso(existing.created_at) : now}, ${now})
    ON CONFLICT (id) DO UPDATE SET
      day_type = EXCLUDED.day_type, work_mode = EXCLUDED.work_mode, start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time, break_minutes = EXCLUDED.break_minutes, break_start = EXCLUDED.break_start,
      hours = EXCLUDED.hours, tasks = EXCLUDED.tasks, remarks = EXCLUDED.remarks, imported = EXCLUDED.imported,
      updated_at = EXCLUDED.updated_at`;

  return mapTimeEntryRow({ ...merged, id, profile_id: profileId, entry_date: date, created_at: existing ? existing.created_at : now, updated_at: now });
}

export async function getEntriesInRange(profileId: string, start: string, end: string): Promise<TimeEntry[]> {
  const rows = await sqlQ`SELECT * FROM time_entries
    WHERE profile_id = ${profileId} AND entry_date >= ${start} AND entry_date <= ${end}
    ORDER BY entry_date`;
  return rows.map(mapTimeEntryRow);
}

export async function getAllEntriesInRange(start: string, end: string): Promise<TimeEntry[]> {
  const rows = await sqlQ`SELECT * FROM time_entries
    WHERE entry_date >= ${start} AND entry_date <= ${end}`;
  return rows.map(mapTimeEntryRow);
}

export interface UpsertEntryInput {
  id?: string;
  profile_id: string;
  entry_date: string;
  day_type: DayType;
  work_mode: WorkMode;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  tasks: string;
  remarks: string;
}

export async function upsertEntry(input: UpsertEntryInput): Promise<{ error?: string; hours?: number }> {
  const profiles = await sqlQ`SELECT weekday_hours FROM profiles WHERE id = ${input.profile_id}`;
  if (profiles.length === 0) return { error: "Employé introuvable." };
  const weekdayHours = profiles[0].weekday_hours as WeekdayHours;

  const hours = computeDayHours(
    {
      day_type: input.day_type,
      start_time: input.start_time,
      end_time: input.end_time,
      break_minutes: input.break_minutes,
      entry_date: input.entry_date,
    },
    weekdayHours
  );

  await writeTimeEntry(input.profile_id, input.entry_date, {
    day_type: input.day_type,
    work_mode: input.work_mode,
    start_time: input.start_time,
    end_time: input.end_time,
    break_minutes: input.break_minutes,
    hours,
    tasks: input.tasks,
    remarks: input.remarks,
  });

  return { hours };
}

export interface BulkDayTypeUpdate {
  profile_id: string;
  entry_date: string;
  day_type: DayType | null; // null = remove the entry if it currently has a removable day type
  default_tasks?: string;
}

/**
 * Applies many day-type updates (e.g. company-wide holidays across all employees).
 */
export async function bulkSetDayType(updates: BulkDayTypeUpdate[], removableTypes: DayType[]): Promise<void> {
  if (updates.length === 0) return;
  const dbq = await pgdb();

  const profileIds = [...new Set(updates.map((u) => u.profile_id))];
  const weekdayHoursById = new Map<string, WeekdayHours>();
  const profileRows = await dbq.query(`SELECT id, weekday_hours FROM profiles WHERE id = ANY($1)`, [profileIds]);
  for (const r of profileRows) weekdayHoursById.set(r.id, r.weekday_hours);

  for (const u of updates) {
    const weekdayHours = weekdayHoursById.get(u.profile_id);
    if (!weekdayHours) continue;

    if (u.day_type === null) {
      const existing = await readTimeEntry(u.profile_id, u.entry_date);
      if (existing && removableTypes.includes(existing.day_type)) {
        await dbq`DELETE FROM time_entries WHERE id = ${timeEntryDocId(u.profile_id, u.entry_date)}`;
      }
      continue;
    }

    // Sur un jour non travaillé (férié / repos), un pointage déjà effectué est conservé
    // et les heures réellement travaillées restent comptabilisées.
    const existing = NON_WORKING_DAY_TYPES.includes(u.day_type)
      ? await readTimeEntry(u.profile_id, u.entry_date)
      : null;
    const keepPunch = !!existing?.start_time;

    const hours = computeDayHours(
      {
        day_type: u.day_type,
        start_time: keepPunch ? existing!.start_time : null,
        end_time: keepPunch ? existing!.end_time : null,
        break_minutes: keepPunch ? existing!.break_minutes : 0,
        entry_date: u.entry_date,
      },
      weekdayHours
    );

    const tasksValue =
      existing?.tasks && existing.tasks !== "" ? existing.tasks : u.default_tasks ?? "";

    await writeTimeEntry(u.profile_id, u.entry_date, {
      day_type: u.day_type,
      work_mode: keepPunch ? existing!.work_mode : null,
      start_time: keepPunch ? existing!.start_time : null,
      end_time: keepPunch ? existing!.end_time : null,
      break_minutes: keepPunch ? existing!.break_minutes : 0,
      break_start: keepPunch ? existing!.break_start ?? null : null,
      hours,
      tasks: tasksValue,
    });
  }
}

export async function deleteEntry(id: string): Promise<void> {
  await sqlQ`DELETE FROM time_entries WHERE id = ${id}`;
}

export async function getEntryByDate(profileId: string, date: string): Promise<TimeEntry | null> {
  return readTimeEntry(profileId, date);
}

// --- Documents (métadonnées + contenu stockés en base, colonne bytea) ------------------

function mapDocumentRow(r: Row): DocumentRecord {
  return {
    id: r.id,
    profile_id: r.profile_id,
    file_name: r.file_name,
    original_name: r.original_name,
    mime_type: r.mime_type,
    size: Number(r.size),
    note: r.note ?? null,
    category: r.category,
    uploaded_at: toIso(r.uploaded_at),
  };
}

export interface CreateDocumentInput {
  profile_id: string;
  original_name: string;
  mime_type: string;
  size: number;
  buffer: Buffer;
  category: DocumentRecord["category"];
  note: string | null;
}

export async function createDocument(input: CreateDocumentInput): Promise<DocumentRecord> {
  const id = generateId();
  const ext = path.extname(input.original_name);
  const file_name = `${id}${ext}`;
  const now = new Date().toISOString();

  await sqlQ`INSERT INTO documents
    (id, profile_id, file_name, original_name, mime_type, size, note, category, uploaded_at, content)
    VALUES (${id}, ${input.profile_id}, ${file_name}, ${input.original_name}, ${input.mime_type},
      ${input.size}, ${input.note ? input.note.trim() : null}, ${input.category}, ${now}, ${input.buffer})`;

  return mapDocumentRow({ id, profile_id: input.profile_id, file_name, original_name: input.original_name, mime_type: input.mime_type, size: input.size, note: input.note ? input.note.trim() : null, category: input.category, uploaded_at: now });
}

export async function listDocumentsByProfile(
  profileId: string,
  category?: DocumentRecord["category"]
): Promise<DocumentRecord[]> {
  const dbq = await pgdb();
  const rows = category
    ? await dbq`SELECT id, profile_id, file_name, original_name, mime_type, size, note, category, uploaded_at FROM documents WHERE profile_id = ${profileId} AND category = ${category} ORDER BY uploaded_at DESC`
    : await dbq`SELECT id, profile_id, file_name, original_name, mime_type, size, note, category, uploaded_at FROM documents WHERE profile_id = ${profileId} ORDER BY uploaded_at DESC`;
  return rows.map(mapDocumentRow);
}

/** Compte les documents d'une catégorie pour plusieurs profils en une seule requête
 * (évite N requêtes séquentielles/parallèles sur les pages de synthèse, ex. salaires admin). */
export async function countDocumentsByProfiles(
  profileIds: string[],
  category: DocumentRecord["category"]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (profileIds.length === 0) return result;
  const rows = await sqlQ`SELECT profile_id, count(*)::int AS n FROM documents
    WHERE category = ${category} AND profile_id = ANY(${profileIds}) GROUP BY profile_id`;
  for (const r of rows) result.set(r.profile_id, Number(r.n));
  return result;
}

export async function getDocumentById(id: string): Promise<DocumentRecord | null> {
  const rows = await sqlQ`SELECT id, profile_id, file_name, original_name, mime_type, size, note, category, uploaded_at FROM documents WHERE id = ${id}`;
  return rows.length ? mapDocumentRow(rows[0]) : null;
}

export async function getDocumentContent(
  id: string
): Promise<{ content: Buffer; mime_type: string; original_name: string } | null> {
  const rows = await sqlQ`SELECT content, mime_type, original_name FROM documents WHERE id = ${id}`;
  if (rows.length === 0 || !rows[0].content) return null;
  const content = Buffer.isBuffer(rows[0].content) ? rows[0].content : Buffer.from(rows[0].content, "base64");
  return { content, mime_type: rows[0].mime_type, original_name: rows[0].original_name };
}

export async function deleteDocumentRecord(id: string): Promise<{ error?: string }> {
  const rows = await sqlQ`DELETE FROM documents WHERE id = ${id} RETURNING id`;
  return rows.length ? {} : { error: "Document introuvable." };
}

async function getWeekdayHours(profileId: string): Promise<WeekdayHours | null> {
  const rows = await sqlQ`SELECT weekday_hours FROM profiles WHERE id = ${profileId}`;
  return rows.length ? (rows[0].weekday_hours as WeekdayHours) ?? null : null;
}

export async function punchIn(
  profileId: string,
  workMode: WorkMode = null
): Promise<{ error?: string; entry?: TimeEntry }> {
  const weekdayHours = await getWeekdayHours(profileId);
  if (!weekdayHours) return { error: "Employé introuvable." };

  const date = todayStr();
  const time = nowHHMM();
  const existing = await getEntryByDate(profileId, date);

  if (existing?.start_time) return { error: "Arrivée déjà pointée aujourd'hui." };

  const mode = workMode ?? existing?.work_mode ?? "presentiel";
  // Un jour férié / de repos reste typé ainsi : les heures pointées viendront s'y ajouter.
  const dayType: DayType =
    existing && NON_WORKING_DAY_TYPES.includes(existing.day_type) ? existing.day_type : "normal";
  const hours = computeDayHours(
    {
      day_type: dayType,
      start_time: time,
      end_time: existing?.end_time ?? null,
      break_minutes: existing?.break_minutes ?? 0,
      entry_date: date,
    },
    weekdayHours
  );

  const entry = await writeTimeEntry(profileId, date, { day_type: dayType, work_mode: mode, start_time: time, hours });
  return { entry };
}

/** Minutes écoulées depuis `from` (HH:MM, heure de l'entreprise) jusqu'à maintenant, jamais négatif. */
function minutesSince(from: string): number {
  const [h, m] = from.split(":").map(Number);
  const [nh, nm] = nowHHMM().split(":").map(Number);
  return Math.max(0, nh * 60 + nm - (h * 60 + (m || 0)));
}

export async function startBreak(profileId: string): Promise<{ error?: string; entry?: TimeEntry }> {
  const date = todayStr();
  const existing = await getEntryByDate(profileId, date);

  if (!existing || !existing.start_time) return { error: "Vous devez d'abord pointer votre arrivée." };
  if (existing.end_time) return { error: "Départ déjà pointé aujourd'hui." };
  if (existing.break_start) return { error: "Une pause est déjà en cours." };

  const entry = await writeTimeEntry(profileId, date, { break_start: nowHHMM() });
  return { entry };
}

export async function endBreak(profileId: string): Promise<{ error?: string; entry?: TimeEntry }> {
  const weekdayHours = await getWeekdayHours(profileId);
  if (!weekdayHours) return { error: "Employé introuvable." };

  const date = todayStr();
  const existing = await getEntryByDate(profileId, date);
  if (!existing?.break_start) return { error: "Aucune pause en cours." };

  const breakMinutes = existing.break_minutes + minutesSince(existing.break_start);
  const hours = computeDayHours({ ...existing, break_minutes: breakMinutes }, weekdayHours);

  const entry = await writeTimeEntry(profileId, date, { break_start: null, break_minutes: breakMinutes, hours });
  return { entry };
}

export async function setTodayWorkMode(
  profileId: string,
  workMode: Exclude<WorkMode, null>
): Promise<{ error?: string; entry?: TimeEntry }> {
  const date = todayStr();
  const existing = await getEntryByDate(profileId, date);
  if (!existing || !existing.start_time || (existing.day_type !== "normal" && !NON_WORKING_DAY_TYPES.includes(existing.day_type))) {
    return { error: "Aucune journée de travail pointée aujourd'hui." };
  }

  const entry = await writeTimeEntry(profileId, date, { work_mode: workMode });
  return { entry };
}

export async function punchOut(profileId: string): Promise<{ error?: string; entry?: TimeEntry }> {
  const weekdayHours = await getWeekdayHours(profileId);
  if (!weekdayHours) return { error: "Employé introuvable." };

  const date = todayStr();
  const existing = await getEntryByDate(profileId, date);

  if (!existing || !existing.start_time) return { error: "Vous devez d'abord pointer votre arrivée." };
  if (existing.end_time) return { error: "Départ déjà pointé aujourd'hui." };

  const endTime = nowHHMM();
  // Une pause encore ouverte est clôturée automatiquement au départ.
  const breakMinutes = existing.break_minutes + (existing.break_start ? minutesSince(existing.break_start) : 0);
  const hours = computeDayHours({ ...existing, end_time: endTime, break_minutes: breakMinutes }, weekdayHours);

  const entry = await writeTimeEntry(profileId, date, {
    end_time: endTime,
    hours,
    break_minutes: breakMinutes,
    break_start: null,
  });

  return { entry };
}

// --- Employee tasks --------------------------------------------------------------

function mapTaskRow(r: Row): EmployeeTask {
  return {
    id: r.id,
    profile_id: r.profile_id,
    task_date: toDateOnly(r.task_date),
    title: r.title,
    description: r.description ?? null,
    is_innovation: !!r.is_innovation,
    done: !!r.done,
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
  };
}

function sortTasks(tasks: EmployeeTask[]): EmployeeTask[] {
  return tasks.sort(
    (a, b) => b.task_date.localeCompare(a.task_date) || b.created_at.localeCompare(a.created_at)
  );
}

export async function listTasks(profileId: string, start: string, end: string): Promise<EmployeeTask[]> {
  const rows = await sqlQ`SELECT * FROM employee_tasks
    WHERE profile_id = ${profileId} AND task_date >= ${start} AND task_date <= ${end}`;
  return sortTasks(rows.map(mapTaskRow));
}

export async function listAllTasks(start: string, end: string): Promise<EmployeeTask[]> {
  const rows = await sqlQ`SELECT * FROM employee_tasks
    WHERE task_date >= ${start} AND task_date <= ${end}`;
  return sortTasks(rows.map(mapTaskRow));
}

export interface CreateTaskInput {
  profile_id: string;
  task_date: string;
  title: string;
  description: string;
  is_innovation: boolean;
}

export async function createTask(input: CreateTaskInput): Promise<EmployeeTask> {
  const id = generateId();
  const now = new Date().toISOString();
  await sqlQ`INSERT INTO employee_tasks
    (id, profile_id, task_date, title, description, is_innovation, done, created_at, updated_at)
    VALUES (${id}, ${input.profile_id}, ${input.task_date}, ${input.title.trim()},
      ${input.description.trim() || null}, ${input.is_innovation}, false, ${now}, ${now})`;
  return mapTaskRow({ id, profile_id: input.profile_id, task_date: input.task_date, title: input.title.trim(), description: input.description.trim() || null, is_innovation: input.is_innovation, done: false, created_at: now, updated_at: now });
}

export async function setTaskDone(id: string, profileId: string, done: boolean): Promise<void> {
  await sqlQ`UPDATE employee_tasks SET done = ${done}, updated_at = ${new Date().toISOString()}
    WHERE id = ${id} AND profile_id = ${profileId}`;
}

export async function deleteTask(id: string, profileId: string): Promise<void> {
  await sqlQ`DELETE FROM employee_tasks WHERE id = ${id} AND profile_id = ${profileId}`;
}

// --- Leave requests ---------------------------------------------------------------

function mapLeaveRequestRow(r: Row): LeaveRequest {
  return {
    id: r.id,
    profile_id: r.profile_id,
    leave_type: r.leave_type,
    start_date: toDateOnly(r.start_date),
    end_date: toDateOnly(r.end_date),
    comment: r.comment ?? null,
    status: r.status,
    admin_comment: r.admin_comment ?? null,
    created_at: toIso(r.created_at),
    decided_at: r.decided_at ? toIso(r.decided_at) : null,
  };
}

export async function listLeaveRequests(profileId: string): Promise<LeaveRequest[]> {
  const rows = await sqlQ`SELECT * FROM leave_requests WHERE profile_id = ${profileId} ORDER BY created_at DESC`;
  return rows.map(mapLeaveRequestRow);
}

export async function listAllLeaveRequests(status?: LeaveRequestStatus): Promise<LeaveRequest[]> {
  const dbq = await pgdb();
  const rows = status
    ? await dbq`SELECT * FROM leave_requests WHERE status = ${status} ORDER BY created_at DESC`
    : await dbq`SELECT * FROM leave_requests ORDER BY created_at DESC`;
  return rows.map(mapLeaveRequestRow);
}

export async function countPendingLeaveRequests(): Promise<number> {
  const rows = await sqlQ`SELECT count(*)::int AS n FROM leave_requests WHERE status = 'pending'`;
  return Number(rows[0].n);
}

export async function getLeaveRequestById(id: string): Promise<LeaveRequest | null> {
  const rows = await sqlQ`SELECT * FROM leave_requests WHERE id = ${id}`;
  return rows.length ? mapLeaveRequestRow(rows[0]) : null;
}

export interface CreateLeaveRequestInput {
  profile_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  comment: string;
}

export async function createLeaveRequest(input: CreateLeaveRequestInput): Promise<LeaveRequest> {
  const id = generateId();
  const now = new Date().toISOString();
  await sqlQ`INSERT INTO leave_requests
    (id, profile_id, leave_type, start_date, end_date, comment, status, admin_comment, created_at, decided_at)
    VALUES (${id}, ${input.profile_id}, ${input.leave_type}, ${input.start_date}, ${input.end_date},
      ${input.comment.trim() || null}, 'pending', NULL, ${now}, NULL)`;
  return mapLeaveRequestRow({ id, profile_id: input.profile_id, leave_type: input.leave_type, start_date: input.start_date, end_date: input.end_date, comment: input.comment.trim() || null, status: "pending", admin_comment: null, created_at: now, decided_at: null });
}

export async function cancelLeaveRequest(id: string, profileId: string): Promise<{ error?: string }> {
  const rows = await sqlQ`DELETE FROM leave_requests
    WHERE id = ${id} AND profile_id = ${profileId} AND status = 'pending' RETURNING id`;
  if (rows.length === 0) return { error: "Seule une demande en attente peut être annulée." };
  return {};
}

export async function decideLeaveRequest(
  id: string,
  status: Exclude<LeaveRequestStatus, "pending">,
  adminComment: string
): Promise<{ error?: string; request?: LeaveRequest }> {
  const rows = await sqlQ`UPDATE leave_requests
    SET status = ${status}, admin_comment = ${adminComment.trim() || null}, decided_at = ${new Date().toISOString()}
    WHERE id = ${id} AND status = 'pending' RETURNING *`;
  if (rows.length === 0) return { error: "Demande introuvable ou déjà traitée." };
  return { request: mapLeaveRequestRow(rows[0]) };
}

// --- In-app notifications ---------------------------------------------------------

function mapNotificationRow(r: Row): AppNotification {
  return {
    id: r.id,
    profile_id: r.profile_id,
    type: r.type,
    title: r.title,
    body: r.body ?? null,
    link: r.link ?? null,
    read: !!r.read,
    created_at: toIso(r.created_at),
  };
}

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}

export async function createNotifications(profileIds: string[], input: NotificationInput): Promise<void> {
  const ids = [...new Set(profileIds)].filter(Boolean);
  if (ids.length === 0) return;
  const dbq = await pgdb();
  const now = new Date().toISOString();
  await dbq.query(
    `INSERT INTO notifications (id, profile_id, type, title, body, link, read, created_at)
     VALUES ${valuesPlaceholders(ids.length, 8)}`,
    ids.flatMap((pid) => [generateId(), pid, input.type, input.title, input.body ?? null, input.link ?? null, false, now])
  );
}

export async function listNotifications(profileId: string, limit = 15): Promise<AppNotification[]> {
  const rows = await sqlQ`SELECT * FROM notifications WHERE profile_id = ${profileId}
    ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(mapNotificationRow);
}

export async function countUnreadNotifications(profileId: string): Promise<number> {
  const rows = await sqlQ`SELECT count(*)::int AS n FROM notifications WHERE profile_id = ${profileId} AND read = false`;
  return Number(rows[0].n);
}

export async function markNotificationsRead(profileId: string, ids?: string[]): Promise<void> {
  const dbq = await pgdb();
  if (ids && ids.length > 0) {
    await dbq`UPDATE notifications SET read = true WHERE profile_id = ${profileId} AND id = ANY(${ids})`;
  } else {
    await dbq`UPDATE notifications SET read = true WHERE profile_id = ${profileId} AND read = false`;
  }
}

// --- Comptes : liste globale pour l'admin -----------------------------------

function sortByRoleThenName(a: Profile, b: Profile): number {
  return a.role.localeCompare(b.role) || a.full_name.localeCompare(b.full_name);
}

export async function listAllAccounts(): Promise<Profile[]> {
  const rows = await sqlQ`SELECT * FROM profiles`;
  return rows.map((r) => stripPassword(mapProfileRow(r))).sort(sortByRoleThenName);
}

// --- Réunions ----------------------------------------------------------------

function mapMeetingRow(r: Row): Meeting {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    location: r.location ?? null,
    meeting_link: r.meeting_link ?? null,
    start_at: toIso(r.start_at),
    end_at: r.end_at ? toIso(r.end_at) : null,
    created_by: r.created_by,
    recurrence: r.recurrence,
    minutes: r.minutes ?? null,
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
  };
}

export interface CreateMeetingInput {
  title: string;
  description: string;
  location: string;
  meeting_link: string;
  start_at: string;
  end_at: string | null;
  created_by: string;
  recurrence: Meeting["recurrence"];
  recurrence_until: string | null;
  participant_ids: string[];
}

/** Crée une réunion. Si récurrente (hebdo/mensuelle) jusqu'à `recurrence_until`,
 * génère une ligne par occurrence (plus simple et cohérent avec le reste de
 * l'app qui modélise chaque jour individuellement, ex. time_entries). */
export async function createMeeting(input: CreateMeetingInput): Promise<Meeting[]> {
  const occurrences: { start: Date; end: Date | null }[] = [];
  const start = new Date(input.start_at);
  const end = input.end_at ? new Date(input.end_at) : null;
  const durationMs = end ? end.getTime() - start.getTime() : null;

  if (input.recurrence === "none" || !input.recurrence_until) {
    occurrences.push({ start, end });
  } else {
    const until = new Date(input.recurrence_until + "T23:59:59");
    let cursor = new Date(start);
    let guard = 0;
    while (cursor <= until && guard < 104) {
      occurrences.push({ start: new Date(cursor), end: durationMs !== null ? new Date(cursor.getTime() + durationMs) : null });
      cursor = new Date(cursor);
      if (input.recurrence === "weekly") cursor.setDate(cursor.getDate() + 7);
      else cursor.setMonth(cursor.getMonth() + 1);
      guard++;
    }
  }

  const dbq = await pgdb();
  const now = new Date().toISOString();
  const created: Meeting[] = [];
  for (const occ of occurrences) {
    const id = generateId();
    await dbq`INSERT INTO meetings
      (id, title, description, location, meeting_link, start_at, end_at, created_by, recurrence, minutes, created_at, updated_at)
      VALUES (${id}, ${input.title.trim()}, ${input.description.trim() || null}, ${input.location.trim() || null},
        ${input.meeting_link.trim() || null}, ${occ.start.toISOString()}, ${occ.end ? occ.end.toISOString() : null},
        ${input.created_by}, ${input.recurrence}, NULL, ${now}, ${now})`;
    if (input.participant_ids.length > 0) {
      await insertMeetingParticipants(id, input.participant_ids);
    }
    created.push(mapMeetingRow({ id, title: input.title.trim(), description: input.description.trim() || null, location: input.location.trim() || null, meeting_link: input.meeting_link.trim() || null, start_at: occ.start.toISOString(), end_at: occ.end ? occ.end.toISOString() : null, created_by: input.created_by, recurrence: input.recurrence, minutes: null, created_at: now, updated_at: now }));
  }
  return created;
}

export async function updateMeeting(
  id: string,
  input: {
    title: string;
    description: string;
    location: string;
    meeting_link: string;
    start_at: string;
    end_at: string | null;
    participant_ids: string[];
  }
): Promise<{ error?: string }> {
  const dbq = await pgdb();
  await dbq`UPDATE meetings SET title = ${input.title.trim()}, description = ${input.description.trim() || null},
    location = ${input.location.trim() || null}, meeting_link = ${input.meeting_link.trim() || null},
    start_at = ${input.start_at}, end_at = ${input.end_at}, updated_at = ${new Date().toISOString()}
    WHERE id = ${id}`;
  await dbq`DELETE FROM meeting_participants WHERE meeting_id = ${id}`;
  if (input.participant_ids.length > 0) {
    await insertMeetingParticipants(id, input.participant_ids);
  }
  return {};
}

export async function saveMeetingMinutes(id: string, minutes: string): Promise<void> {
  await sqlQ`UPDATE meetings SET minutes = ${minutes.trim() || null}, updated_at = ${new Date().toISOString()} WHERE id = ${id}`;
}

export async function deleteMeeting(id: string): Promise<void> {
  const dbq = await pgdb();
  await dbq`DELETE FROM meeting_attachments WHERE meeting_id = ${id}`;
  await dbq`DELETE FROM meeting_participants WHERE meeting_id = ${id}`;
  await dbq`DELETE FROM meetings WHERE id = ${id}`;
}

export async function getMeetingById(id: string): Promise<Meeting | null> {
  const rows = await sqlQ`SELECT * FROM meetings WHERE id = ${id}`;
  return rows.length ? mapMeetingRow(rows[0]) : null;
}

export async function listMeetingParticipants(meetingId: string): Promise<MeetingParticipant[]> {
  const rows = await sqlQ`SELECT mp.profile_id, p.full_name FROM meeting_participants mp
    JOIN profiles p ON p.id = mp.profile_id WHERE mp.meeting_id = ${meetingId} ORDER BY p.full_name`;
  return rows.map((r) => ({ meeting_id: meetingId, profile_id: r.profile_id, full_name: r.full_name }));
}

/** Réunions à venir/passées visibles par un profil : celles qu'il a créées ou
 * auxquelles il est invité. Les admins voient toutes les réunions. */
export async function listMeetingsFor(profile: Profile): Promise<Meeting[]> {
  const dbq = await pgdb();
  const rows =
    profile.role === "admin"
      ? await dbq`SELECT * FROM meetings ORDER BY start_at DESC`
      : await dbq`SELECT DISTINCT m.* FROM meetings m
          LEFT JOIN meeting_participants mp ON mp.meeting_id = m.id
          WHERE m.created_by = ${profile.id} OR mp.profile_id = ${profile.id}
          ORDER BY m.start_at DESC`;
  return rows.map(mapMeetingRow);
}

function mapMeetingAttachmentRow(r: Row): MeetingAttachment & { meeting_id: string } {
  return {
    id: r.id,
    meeting_id: r.meeting_id,
    original_name: r.original_name,
    mime_type: r.mime_type,
    size: Number(r.size),
    uploaded_at: toIso(r.uploaded_at),
  };
}

export interface CreateMeetingAttachmentInput {
  meeting_id: string;
  original_name: string;
  mime_type: string;
  size: number;
  buffer: Buffer;
}

export async function createMeetingAttachment(input: CreateMeetingAttachmentInput): Promise<MeetingAttachment> {
  const id = generateId();
  const now = new Date().toISOString();
  await sqlQ`INSERT INTO meeting_attachments
    (id, meeting_id, original_name, mime_type, size, uploaded_at, content)
    VALUES (${id}, ${input.meeting_id}, ${input.original_name}, ${input.mime_type}, ${input.size}, ${now}, ${input.buffer})`;
  return mapMeetingAttachmentRow({ id, meeting_id: input.meeting_id, original_name: input.original_name, mime_type: input.mime_type, size: input.size, uploaded_at: now });
}

export async function listMeetingAttachments(meetingId: string): Promise<MeetingAttachment[]> {
  const rows = await sqlQ`SELECT id, meeting_id, original_name, mime_type, size, uploaded_at
    FROM meeting_attachments WHERE meeting_id = ${meetingId} ORDER BY uploaded_at DESC`;
  return rows.map(mapMeetingAttachmentRow);
}

export async function getMeetingAttachmentById(id: string): Promise<(MeetingAttachment & { meeting_id: string }) | null> {
  const rows = await sqlQ`SELECT id, meeting_id, original_name, mime_type, size, uploaded_at FROM meeting_attachments WHERE id = ${id}`;
  return rows.length ? mapMeetingAttachmentRow(rows[0]) : null;
}

export async function getMeetingAttachmentContent(
  id: string
): Promise<{ content: Buffer; mime_type: string; original_name: string } | null> {
  const rows = await sqlQ`SELECT content, mime_type, original_name FROM meeting_attachments WHERE id = ${id}`;
  if (rows.length === 0 || !rows[0].content) return null;
  const content = Buffer.isBuffer(rows[0].content) ? rows[0].content : Buffer.from(rows[0].content, "base64");
  return { content, mime_type: rows[0].mime_type, original_name: rows[0].original_name };
}

export async function deleteMeetingAttachment(id: string): Promise<void> {
  await sqlQ`DELETE FROM meeting_attachments WHERE id = ${id}`;
}

// --- Messagerie interne --------------------------------------------------------

function mapMessageRow(r: Row, viewerReadField: "recipient" | string): Message {
  const readBy: string[] = r.read_by ?? [];
  const readTarget = viewerReadField === "recipient" ? r.recipient_id : viewerReadField;
  return {
    id: r.id,
    sender_id: r.sender_id,
    sender_name: r.sender_name ?? "",
    recipient_id: r.recipient_id ?? null,
    body: r.body,
    created_at: toIso(r.created_at),
    read: readTarget ? readBy.includes(readTarget) : false,
  };
}

export async function sendMessage(input: { sender_id: string; recipient_id: string | null; body: string }): Promise<Message> {
  const dbq = await pgdb();
  const senders = await dbq`SELECT full_name FROM profiles WHERE id = ${input.sender_id}`;
  const senderName = senders.length ? senders[0].full_name : "";
  const participantIds = input.recipient_id ? [input.sender_id, input.recipient_id] : [input.sender_id];

  const id = generateId();
  const now = new Date().toISOString();
  await dbq`INSERT INTO messages (id, sender_id, sender_name, recipient_id, body, created_at, is_broadcast, participant_ids, read_by)
    VALUES (${id}, ${input.sender_id}, ${senderName}, ${input.recipient_id}, ${input.body.trim()}, ${now},
      ${input.recipient_id === null}, ${participantIds}, ${[]})`;
  return mapMessageRow({ id, sender_id: input.sender_id, sender_name: senderName, recipient_id: input.recipient_id, body: input.body.trim(), created_at: now, read_by: [] }, "recipient");
}

/** Annonces diffusées à tous les employés (recipient_id IS NULL). */
export async function listBroadcastMessages(viewerId: string, limit = 50): Promise<Message[]> {
  const rows = await sqlQ`SELECT * FROM messages WHERE is_broadcast = true ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r) => mapMessageRow(r, viewerId));
}

/** Conversation directe (dans les deux sens) entre deux comptes. */
export async function listConversation(a: string, b: string, limit = 100): Promise<Message[]> {
  const rows = await sqlQ`SELECT * FROM messages
    WHERE is_broadcast = false AND ((sender_id = ${a} AND recipient_id = ${b}) OR (sender_id = ${b} AND recipient_id = ${a}))
    ORDER BY created_at LIMIT ${limit}`;
  return rows.map((r) => mapMessageRow(r, "recipient"));
}

/** Liste des interlocuteurs avec qui l'utilisateur a échangé, triée par dernier message. */
export async function listConversationsFor(profileId: string): Promise<ConversationSummary[]> {
  const dbq = await pgdb();
  const rows = await dbq`SELECT * FROM messages
    WHERE is_broadcast = false AND ${profileId} = ANY(participant_ids)`;

  const byOther = new Map<string, Row[]>();
  for (const m of rows) {
    const other = m.sender_id === profileId ? m.recipient_id : m.sender_id;
    if (!byOther.has(other)) byOther.set(other, []);
    byOther.get(other)!.push(m);
  }

  const otherIds = [...byOther.keys()].filter(Boolean);
  const nameById = new Map<string, string>();
  if (otherIds.length > 0) {
    const profiles = await dbq.query(`SELECT id, full_name FROM profiles WHERE id = ANY($1)`, [otherIds]);
    for (const p of profiles) nameById.set(p.id, p.full_name);
  }

  const summaries: ConversationSummary[] = otherIds
    .filter((id) => nameById.has(id))
    .map((otherId) => {
      const msgs = byOther.get(otherId)!.sort((x, y) => toIso(y.created_at).localeCompare(toIso(x.created_at)));
      const last = msgs[0];
      const unread = msgs.filter(
        (m) => m.recipient_id === profileId && !(m.read_by ?? []).includes(profileId)
      ).length;
      return {
        profile_id: otherId,
        full_name: nameById.get(otherId)!,
        last_message: last.body,
        last_at: toIso(last.created_at),
        unread,
      };
    });

  return summaries.sort((a, b) => b.last_at.localeCompare(a.last_at));
}

export async function markConversationRead(viewerId: string, otherId: string): Promise<void> {
  await sqlQ`UPDATE messages SET read_by = array_append(read_by, ${viewerId})
    WHERE is_broadcast = false AND sender_id = ${otherId} AND recipient_id = ${viewerId}
      AND NOT (${viewerId} = ANY(read_by))`;
}

export async function markBroadcastRead(viewerId: string): Promise<void> {
  await sqlQ`UPDATE messages SET read_by = array_append(read_by, ${viewerId})
    WHERE is_broadcast = true AND NOT (${viewerId} = ANY(read_by))`;
}

export async function countUnreadMessages(profileId: string): Promise<number> {
  const rows = await sqlQ`SELECT count(*)::int AS n FROM messages
    WHERE NOT (${profileId} = ANY(read_by)) AND (
      (is_broadcast = false AND recipient_id = ${profileId}) OR
      (is_broadcast = true AND sender_id <> ${profileId})
    )`;
  return Number(rows[0].n);
}

// --- Import d'heures historiques (CSV) -----------------------------------------

export interface HistoricalHourRow {
  profile_id: string;
  entry_date: string;
  day_type: DayType;
  work_mode: WorkMode;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  hours: number;
  tasks: string | null;
  remarks: string | null;
}

/**
 * Vrai si la ligne d'import a déjà été appliquée à cette journée : l'entrée existante
 * provient d'un import et porte exactement le même type de jour, les mêmes heures de
 * début/fin et la même pause. Sert à éviter qu'un même fichier importé deux fois
 * double les heures (et donc les salaires).
 */
export function isAlreadyImported(
  existing: TimeEntry | null,
  row: Pick<HistoricalHourRow, "day_type" | "start_time" | "end_time" | "break_minutes">
): boolean {
  if (!existing?.imported) return false;
  return (
    existing.day_type === row.day_type &&
    toHHMM(existing.start_time) === toHHMM(row.start_time) &&
    toHHMM(existing.end_time) === toHHMM(row.end_time) &&
    existing.break_minutes === (row.break_minutes || 0)
  );
}

/** Insère en masse des entrées de temps historiques (import CSV) en ADDITIONNANT
 * les heures à l'entrée existante du même jour. Les autres champs (type de jour,
 * début/fin, pause, tâches, remarques) sont mis à jour avec la nouvelle ligne.
 * Les lignes déjà importées à l'identique sont ignorées (voir isAlreadyImported). */
export async function bulkImportTimeEntries(rows: HistoricalHourRow[]): Promise<{ imported: number; skipped: number }> {
  let count = 0;
  let skipped = 0;
  for (const r of rows) {
    const existing = await readTimeEntry(r.profile_id, r.entry_date);
    if (isAlreadyImported(existing, r)) {
      skipped++;
      continue;
    }
    const mergedHours = (existing?.hours ?? 0) + r.hours;
    await writeTimeEntry(r.profile_id, r.entry_date, {
      day_type: r.day_type,
      work_mode: r.work_mode,
      start_time: r.start_time,
      end_time: r.end_time,
      break_minutes: r.break_minutes,
      hours: mergedHours,
      tasks: r.tasks,
      remarks: r.remarks,
      imported: true,
    });
    count++;
  }
  return { imported: count, skipped };
}

export interface ImportedEntryRow extends TimeEntry {
  full_name: string;
  email: string;
}

/** Toutes les entrées marquées comme issues d'un import de fichier, jointes au
 * profil de l'employé, triées de la plus récente à la plus ancienne. */
export async function listImportedEntries(limit = 500): Promise<ImportedEntryRow[]> {
  const rows = await sqlQ`SELECT t.*, COALESCE(p.full_name, '(compte supprimé)') AS full_name, COALESCE(p.email, '') AS email
    FROM time_entries t LEFT JOIN profiles p ON p.id = t.profile_id
    WHERE t.imported = true ORDER BY t.entry_date DESC LIMIT ${limit}`;
  return rows.map((r) => ({ ...mapTimeEntryRow(r), full_name: r.full_name, email: r.email }));
}

// --- Import par scan OCR (feuille de présence papier) --------------------------

function mapOcrDraftRow(r: Row): OcrDraftRow {
  return {
    id: r.id,
    batch_id: r.batch_id,
    document_id: r.document_id ?? null,
    profile_id: r.profile_id ?? null,
    full_name: r.full_name ?? null,
    entry_date: toDateOnlyOrNull(r.entry_date),
    start_time: toHHMM(r.start_time),
    end_time: toHHMM(r.end_time),
    break_minutes: Number(r.break_minutes ?? 0),
    hours: Number(r.hours ?? 0),
    raw_line: r.raw_line ?? "",
    valid: !!r.valid,
    issues: Array.isArray(r.issues) ? r.issues : [],
    status: r.status,
    created_at: toIso(r.created_at),
  };
}

export interface CreateOcrDraftRowInput {
  batch_id: string;
  document_id: string | null;
  profile_id: string | null;
  full_name: string | null;
  entry_date: string | null;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  hours: number;
  raw_line: string;
  valid: boolean;
  issues: string[];
}

/** Enregistre en base les lignes extraites par OCR (statut "pending") pour relecture
 * par un administrateur : rien n'est fusionné dans l'historique des heures à ce stade. */
export async function createOcrDraftRows(rows: CreateOcrDraftRowInput[]): Promise<OcrDraftRow[]> {
  if (rows.length === 0) return [];
  const dbq = await pgdb();
  const now = new Date().toISOString();
  const created: OcrDraftRow[] = [];

  for (const r of rows) {
    const id = generateId();
    await dbq`INSERT INTO ocr_drafts
      (id, batch_id, document_id, profile_id, full_name, entry_date, start_time, end_time, break_minutes, hours, raw_line, valid, issues, status, created_at)
      VALUES (${id}, ${r.batch_id}, ${r.document_id}, ${r.profile_id}, ${r.full_name}, ${r.entry_date},
        ${r.start_time}, ${r.end_time}, ${r.break_minutes}, ${r.hours}, ${r.raw_line}, ${r.valid}, ${r.issues}, 'pending', ${now})`;
    created.push(mapOcrDraftRow({ id, ...r, status: "pending", created_at: now }));
  }
  return created;
}

export async function listOcrDrafts(status?: OcrDraftStatus): Promise<OcrDraftRow[]> {
  const dbq = await pgdb();
  const rows = status
    ? await dbq`SELECT * FROM ocr_drafts WHERE status = ${status} ORDER BY created_at DESC`
    : await dbq`SELECT * FROM ocr_drafts ORDER BY created_at DESC`;
  return rows.map(mapOcrDraftRow);
}

export async function getOcrDraftById(id: string): Promise<OcrDraftRow | null> {
  const rows = await sqlQ`SELECT * FROM ocr_drafts WHERE id = ${id}`;
  return rows.length ? mapOcrDraftRow(rows[0]) : null;
}

export interface UpdateOcrDraftInput {
  profile_id?: string | null;
  full_name?: string | null;
  entry_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  break_minutes?: number;
  hours?: number;
  valid?: boolean;
  issues?: string[];
}

/** Permet à l'admin de corriger une ligne (employé, date, heures) avant de la confirmer. */
export async function updateOcrDraft(id: string, fields: UpdateOcrDraftInput): Promise<void> {
  const dbq = await pgdb();
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    setClauses.push(`${key} = $${i++}`);
    params.push(value);
  }
  if (setClauses.length === 0) return;
  params.push(id);
  await dbq.query(`UPDATE ocr_drafts SET ${setClauses.join(", ")} WHERE id = $${i}`, params);
}

export async function setOcrDraftStatus(ids: string[], status: OcrDraftStatus): Promise<void> {
  if (ids.length === 0) return;
  await sqlQ`UPDATE ocr_drafts SET status = ${status} WHERE id = ANY(${ids})`;
}

/**
 * Fusionne une ligne validée par OCR avec l'entrée existante du même jour en ADDITIONNANT
 * les heures (plutôt qu'en les remplaçant) : utile quand la feuille papier vient compléter
 * un pointage déjà enregistré. Si aucune entrée n'existe pour ce jour, elle est créée.
 */
export async function addHoursToTimeEntry(
  profileId: string,
  date: string,
  extra: { start_time: string | null; end_time: string | null; break_minutes: number; hours: number }
): Promise<TimeEntry> {
  const existing = await readTimeEntry(profileId, date);
  const mergedHours = (existing?.hours ?? 0) + extra.hours;
  const note = `Import scan (+${extra.hours.toFixed(2)} h)`;

  return writeTimeEntry(profileId, date, {
    day_type: existing?.day_type ?? "normal",
    work_mode: existing?.work_mode ?? null,
    // On garde le pointage existant s'il y en a un ; sinon on reprend celui du scan.
    start_time: existing?.start_time ?? extra.start_time,
    end_time: existing?.end_time ?? extra.end_time,
    break_minutes: existing?.break_minutes ?? extra.break_minutes,
    hours: mergedHours,
    remarks: existing?.remarks ? `${existing.remarks}\n${note}` : note,
  });
}

// --- Réinitialisation de mot de passe ------------------------------------------

const RESET_TOKEN_DURATION_MS = 60 * 60 * 1000; // 1 heure

/** Crée un jeton de réinitialisation à usage unique et invalide les précédents. */
export async function createPasswordReset(profileId: string): Promise<string> {
  const dbq = await pgdb();
  await dbq`DELETE FROM password_resets WHERE profile_id = ${profileId} AND used = false`;
  const token = generateId();
  await dbq`INSERT INTO password_resets (token, profile_id, expires, used, created_at)
    VALUES (${token}, ${profileId}, ${Date.now() + RESET_TOKEN_DURATION_MS}, false, ${new Date().toISOString()})`;
  return token;
}

export async function findValidPasswordReset(token: string): Promise<{ profile_id: string } | null> {
  const rows = await sqlQ`SELECT profile_id, expires, used FROM password_resets WHERE token = ${token}`;
  if (rows.length === 0) return null;
  const r = rows[0];
  if (r.used || Number(r.expires) < Date.now()) return null;
  return { profile_id: r.profile_id };
}

/** Applique le nouveau mot de passe, consomme le jeton et déconnecte toutes les sessions actives. */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<{ error?: string }> {
  const dbq = await pgdb();
  const reset = await findValidPasswordReset(token);
  if (!reset) return { error: "Ce lien de réinitialisation est invalide ou a expiré." };

  await dbq`UPDATE profiles SET password_hash = ${hashPassword(newPassword)} WHERE id = ${reset.profile_id}`;
  await dbq`UPDATE password_resets SET used = true WHERE token = ${token}`;
  await dbq`DELETE FROM sessions WHERE profile_id = ${reset.profile_id}`;
  return {};
}
