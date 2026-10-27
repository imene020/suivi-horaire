import "server-only";
import ExcelJS from "exceljs";
import { DayType, WorkMode } from "./types";
import { computeDayHours } from "./hours";
import { DEFAULT_WEEKDAY_HOURS } from "./constants";

/**
 * Import d'heures historiques depuis un fichier CSV ou Excel (.xlsx).
 * Les en-têtes sont reconnus de façon tolérante (accents, casse, variantes FR/EN),
 * et si aucune colonne "email" n'est trouvée, l'appelant peut fournir un employé par
 * défaut (fichier mensuel propre à une seule personne, sans colonne email).
 * Colonnes reconnues : email, date, type_jour, heure_debut, heure_fin, pause_minutes,
 * mode, taches, remarques. Seule une colonne de date est strictement requise (détectée
 * par en-tête ou, à défaut, par analyse du contenu des colonnes).
 */

export const CSV_TEMPLATE_HEADER =
  "email,date,type_jour,heure_debut,heure_fin,pause_minutes,mode,taches,remarques";

const VALID_DAY_TYPES: DayType[] = ["normal", "conge", "maladie", "ferie_paye", "ferie_non_paye", "repos"];

const DAY_TYPE_MAP: Record<string, DayType> = {
  normal: "normal",
  travail: "normal",
  presence: "normal",
  present: "normal",
  conge: "conge",
  conges: "conge",
  vacances: "conge",
  cp: "conge",
  maladie: "maladie",
  arret: "maladie",
  arretmaladie: "maladie",
  arretdetravail: "maladie",
  feriepaye: "ferie_paye",
  jourferiepaye: "ferie_paye",
  ferie: "ferie_paye",
  joursferies: "ferie_paye",
  jourferie: "ferie_paye",
  ferienonpaye: "ferie_non_paye",
  jourferienonpaye: "ferie_non_paye",
  repos: "repos",
  weekend: "repos",
  we: "repos",
};

const MODE_MAP: Record<string, WorkMode> = {
  presentiel: "presentiel",
  surplace: "presentiel",
  bureau: "presentiel",
  onsite: "presentiel",
  teletravail: "teletravail",
  distanciel: "teletravail",
  domicile: "teletravail",
  remote: "teletravail",
};

const EMAIL_ALIASES = ["email", "emailemploye", "adresseemail", "mail", "courriel", "emailsalarie"];
const NAME_ALIASES = [
  "nom", "name", "employe", "employee", "nomemploye", "nomdelemploye", "employename",
  "salarie", "nomcomplet", "fullname", "agent", "collaborateur", "nomprenom", "prenomnom",
];
const DATE_ALIASES = ["date", "jour", "datejour", "journee", "datedujour"];
const DAY_TYPE_ALIASES = [
  "typejour", "type", "statut", "statutjour", "typedejour", "categoriejour", "nature",
  "absence", "motifabsence", "typeabsence", "motif",
];
const START_ALIASES = ["heuredebut", "heurearrivee", "debut", "arrivee", "entree", "heureentree", "heuredentree"];
const END_ALIASES = ["heurefin", "heuredepart", "fin", "depart", "sortie", "heuresortie", "heuredesortie"];
const BREAK_ALIASES = ["pauseminutes", "pause", "minutesdepause", "dureepause", "pausemin", "tempspause"];
const MODE_ALIASES = ["mode", "modedetravail", "lieu", "lieudetravail"];
const TASKS_ALIASES = ["taches", "tache", "activites", "activite", "travaileffectue", "description"];
const REMARKS_ALIASES = ["remarques", "remarque", "notes", "note", "commentaire", "commentaires", "observation", "observations"];

/** Normalise un en-tête pour une comparaison tolérante : minuscules, sans accents, sans séparateurs. */
function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Convertit une date écrite sous divers formats courants (ISO, JJ/MM/AAAA, JJ-MM-AAAA...)
 * ou un numéro de série Excel (ex. 45231, 45231.75) en YYYY-MM-DD. */
export function normalizeDateString(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  // Numéro de série Excel (date ou date+heure) → on garde la partie entière (date).
  m = s.match(/^(\d{4,5})(?:\.\d+)?$/);
  if (m) {
    const serial = Math.floor(Number(m[1]));
    // Plage raisonnable : 1900-01-05 (≈5) à ~2199-12-31 (≈80000).
    if (serial >= 1 && serial <= 80000) {
      const epochMs = (serial - 25569) * 86400 * 1000;
      const d = new Date(epochMs);
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }
  }
  return null;
}

/** Convertit une heure écrite sous divers formats courants (HH:MM, 8h30, ISO...) en HH:MM. */
export function normalizeTimeString(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/T(\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}`;
  m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  m = s.match(/^(\d{1,2})[hH](\d{2})?$/);
  if (m) return `${m[1].padStart(2, "0")}:${(m[2] ?? "00").padStart(2, "0")}`;
  return null;
}

function resolveDayType(raw: string): DayType | null {
  const s = raw.trim();
  if (!s) return "normal";
  const key = normalizeKey(s);
  return DAY_TYPE_MAP[key] ?? null;
}

function resolveWorkMode(raw: string): WorkMode {
  const key = normalizeKey(raw);
  return MODE_MAP[key] ?? null;
}

function parseBreakMinutes(raw: string): number | null {
  const s = raw.trim();
  if (!s) return 0;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** Cherche une colonne dont (presque) toutes les valeurs non vides ressemblent à une date. */
function sniffDateColumn(table: string[][]): number {
  const colCount = table[0]?.length ?? 0;
  let best = -1;
  let bestHits = 0;
  for (let c = 0; c < colCount; c++) {
    let hits = 0;
    let total = 0;
    for (let r = 1; r < Math.min(table.length, 30); r++) {
      const raw = (table[r]?.[c] || "").trim();
      if (!raw) continue;
      total++;
      if (normalizeDateString(raw)) hits++;
    }
    if (total > 0 && hits === total && hits > bestHits) {
      bestHits = hits;
      best = c;
    }
  }
  return best;
}

/** Parseur CSV minimal (gère les champs entre guillemets et les virgules échappées). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}

export interface ParsedHourRow {
  line: number;
  /** Vide si le fichier n'a pas de colonne email reconnue (l'appelant doit alors fournir un employé par défaut). */
  email: string;
  /** Nom d'employé lu dans une colonne "nom"/"employé" du fichier, vide si absente.
   * Permet de résoudre le compte par nom quand il n'y a pas d'email. */
  employee_name: string;
  entry_date: string;
  day_type: DayType;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  work_mode: WorkMode;
  hours: number;
  tasks: string | null;
  remarks: string | null;
}

export interface CsvParseResult {
  rows: ParsedHourRow[];
  errors: string[];
  /** En-têtes bruts détectés dans le fichier, pour affichage/diagnostic. */
  detectedHeaders: string[];
  /** Quelques lignes brutes du fichier (avant interprétation), pour vérification visuelle. */
  sampleRows: string[][];
  /** true si aucune colonne email n'a été trouvée : un employé par défaut est nécessaire. */
  needsDefaultEmployee: boolean;
  /** Nom d'employé repéré dans le fichier (ex. modèle "Suivi horaire" avec "Nom d'employé : ..."),
   * pour pré-sélectionner l'employé par défaut côté interface. */
  detectedEmployeeName?: string | null;
}

export function parseHoursCsv(text: string): CsvParseResult {
  return parseHoursTable(parseCsv(text.trim()));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Convertit une feuille Excel (1ère feuille du classeur) en table de chaînes. Les dates/heures
 * natives Excel sont reconstruites à partir des composants locaux (pas d'UTC) pour éviter tout
 * décalage de fuseau horaire, dans un format que normalizeDateString/normalizeTimeString savent lire. */
export async function parseHoursXlsx(buffer: Buffer): Promise<CsvParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    // Les types fournis par exceljs redéclarent globalement `Buffer` (en l'étendant
    // de `ArrayBuffer`), ce qui entre en conflit avec le vrai type Node.js `Buffer`
    // des @types/node récents. Cast nécessaire pour contourner cette définition tierce buguée.
    await workbook.xlsx.load(buffer as unknown as never);
  } catch {
    return { rows: [], errors: ["Fichier Excel illisible ou corrompu."], detectedHeaders: [], sampleRows: [], needsDefaultEmployee: false };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { rows: [], errors: ["Le classeur Excel ne contient aucune feuille."], detectedHeaders: [], sampleRows: [], needsDefaultEmployee: false };
  }

  // Modèle "Suivi horaire" (feuille annuelle avec un bloc par mois, titres fusionnés,
  // dates courtes sans année comme "1-janv.") : structure trop spécifique pour le
  // détecteur générique de colonnes, on tente d'abord un parseur dédié.
  const templateResult = parseSuiviHoraireTemplate(sheet);
  if (templateResult && templateResult.rows.length > 0) return templateResult;

  const columnCount = sheet.columnCount;
  const table: string[][] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= columnCount; c++) cells.push(cellToText(row.getCell(c).value));
    if (cells.some((f) => f.trim() !== "")) table.push(cells);
  }

  return parseHoursTable(table);
}

const MONTH_NAME_FR: Record<string, string> = {
  janvier: "01",
  fevrier: "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  aout: "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  decembre: "12",
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Reconnaît un titre de bloc mensuel du type "Janvier 2026" (avec ou sans accent). */
function parseMonthTitleFr(raw: string): { year: number; month: string } | null {
  const m = stripAccents(raw.trim()).match(/^([a-z]+)\s+(\d{4})$/i);
  if (!m) return null;
  const month = MONTH_NAME_FR[m[1].toLowerCase()];
  return month ? { year: Number(m[2]), month } : null;
}

/** Extrait le jour du mois d'une date courte sans année ("1-janv.", "14-févr.") : on
 * fait confiance au bloc mensuel environnant pour le mois et l'année. */
function extractDayOfMonth(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2})/);
  if (!m) return null;
  const day = Number(m[1]);
  return day >= 1 && day <= 31 ? day : null;
}

/** Convertit en minutes une cellule "durée" Excel (ex. pause de 00:30) affichée comme heure. */
function durationCellToMinutes(text: string): number {
  const time = normalizeTimeString(text);
  if (!time) return 0;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Parseur dédié au modèle "Suivi horaire" (une feuille par année, un bloc par mois avec
 * un titre fusionné "Mois AAAA" suivi d'un en-tête "Jour | Jour | Heures | Travail | Début |
 * Fin | Pause | Tâches effectuées | Remarques", puis une ligne par jour du mois). Renvoie
 * `null` si le fichier ne correspond pas à ce modèle (pas de bloc reconnu).
 */
function parseSuiviHoraireTemplate(sheet: ExcelJS.Worksheet): CsvParseResult | null {
  const rowCount = sheet.rowCount;
  const text = (r: number, c: number) => cellToText(sheet.getRow(r).getCell(c).value).trim();

  const headerRows: number[] = [];
  for (let r = 1; r <= rowCount; r++) {
    if (
      text(r, 3).toLowerCase() === "jour" &&
      text(r, 4).toLowerCase() === "jour" &&
      text(r, 5).toLowerCase().startsWith("heure") &&
      text(r, 7).toLowerCase().startsWith("d")
    ) {
      headerRows.push(r);
    }
  }
  if (headerRows.length === 0) return null;

  // Nom de l'employé, souvent indiqué en tête de feuille : "Nom d'employé: Fatma Zalila".
  let detectedEmployeeName: string | null = null;
  for (let r = 1; r < headerRows[0] && !detectedEmployeeName; r++) {
    for (let c = 1; c <= sheet.columnCount; c++) {
      const cell = text(r, c);
      const m = cell.match(/nom\s+d['’]employ[ée]\s*:\s*(.+)/i);
      if (m && m[1].trim()) {
        detectedEmployeeName = m[1].trim();
        break;
      }
    }
  }

  const rows: ParsedHourRow[] = [];
  const errors: string[] = [];

  for (let b = 0; b < headerRows.length; b++) {
    const headerRow = headerRows[b];
    const titleRow = headerRow - 1;
    let monthInfo: { year: number; month: string } | null = null;
    for (let c = 1; c <= sheet.columnCount && !monthInfo; c++) {
      monthInfo = parseMonthTitleFr(text(titleRow, c));
    }
    if (!monthInfo) {
      errors.push(`Bloc mensuel non identifié à la ligne ${headerRow} (titre attendu à la ligne ${titleRow}).`);
      continue;
    }

    const dataEnd = b + 1 < headerRows.length ? headerRows[b + 1] - 2 : rowCount;
    for (let r = headerRow + 1; r <= dataEnd; r++) {
      const dateCellValue = sheet.getRow(r).getCell(4).value;
      const dateRaw = text(r, 4);

      // La colonne "Jour" (date) est généralement un texte court sans année ("1-janv."),
      // mais certains blocs contiennent une vraie date Excel : dans ce cas on fait
      // confiance au jour/mois de cette date (plus fiable qu'un texte), tout en gardant
      // l'année du titre du bloc (fiable sur tout le fichier, contrairement à l'année
      // parfois erronée encodée dans la date native — vu sur des fichiers réels).
      let day: number | null;
      let month: string;
      if (dateCellValue instanceof Date) {
        day = dateCellValue.getUTCDate();
        month = pad2(dateCellValue.getUTCMonth() + 1);
      } else {
        day = extractDayOfMonth(dateRaw);
        month = monthInfo.month;
      }
      if (!day) continue; // ligne vide ou hors tableau (ex. totaux/graphiques)

      const entry_date = `${monthInfo.year}-${month}-${pad2(day)}`;
      const work_mode = resolveWorkMode(text(r, 6));
      const start_time = normalizeTimeString(text(r, 7));
      const end_time = normalizeTimeString(text(r, 8));
      const break_minutes = durationCellToMinutes(text(r, 9));
      const tasksRaw = text(r, 10);
      const remarksRaw = text(r, 11);

      // Le "type de jour" (congé, férié, maladie, repos...) est saisi à la main, parfois
      // dans la colonne Tâches, parfois dans Remarques : on cherche un mot-clé reconnu
      // dans les deux avant de considérer le jour comme "normal" (travaillé).
      const remarksDayType = remarksRaw ? resolveDayType(remarksRaw) : null;
      const tasksDayType = tasksRaw ? resolveDayType(tasksRaw) : null;
      const day_type: DayType = remarksDayType ?? tasksDayType ?? "normal";

      const tasks = tasksDayType ? null : tasksRaw || null;
      const remarks = remarksDayType ? null : remarksRaw || null;

      const hours = computeDayHours(
        { day_type, start_time, end_time, break_minutes, entry_date },
        DEFAULT_WEEKDAY_HOURS
      );

      rows.push({
        line: r,
        email: "",
        employee_name: detectedEmployeeName ?? "",
        entry_date,
        day_type,
        start_time,
        end_time,
        break_minutes,
        work_mode,
        hours,
        tasks,
        remarks,
      });
    }
  }

  return {
    rows,
    errors,
    detectedHeaders: ["Jour", "Jour", "Heures", "Travail", "Début", "Fin", "Pause", "Tâches effectuées", "Remarques"],
    sampleRows: [],
    needsDefaultEmployee: true,
    detectedEmployeeName,
  };
}

function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // ExcelJS renvoie les dates/heures Excel comme heure "murale" encodée en UTC
    // (une cellule "01/10/2026 08:00" devient 2026-10-01T08:00:00Z). On lit donc
    // toujours les composants UTC : les getters locaux donnaient le bon résultat
    // uniquement sur un serveur en UTC (ex. 09:00 au lieu de 08:00 en Tunisie).
    const y = value.getUTCFullYear();
    const mo = value.getUTCMonth();
    const d = value.getUTCDate();
    const h = value.getUTCHours();
    const mi = value.getUTCMinutes();
    const s = value.getUTCSeconds();
    return `${y}-${pad2(mo + 1)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}:${pad2(s)}`;
  }
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value && value.result !== undefined) return cellToText(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text).join("");
    }
  }
  return String(value);
}

function parseHoursTable(table: string[][]): CsvParseResult {
  const errors: string[] = [];
  const rows: ParsedHourRow[] = [];

  if (table.length === 0) {
    return { rows, errors: ["Fichier vide."], detectedHeaders: [], sampleRows: [], needsDefaultEmployee: false };
  }

  const rawHeader = table[0];
  const sampleRows = table.slice(1, 6);
  const header = rawHeader.map((h) => normalizeKey(h));
  const findCol = (aliases: string[]) => header.findIndex((h) => aliases.includes(h));

  const idx = {
    email: findCol(EMAIL_ALIASES),
    name: findCol(NAME_ALIASES),
    date: findCol(DATE_ALIASES),
    dayType: findCol(DAY_TYPE_ALIASES),
    start: findCol(START_ALIASES),
    end: findCol(END_ALIASES),
    breakMin: findCol(BREAK_ALIASES),
    mode: findCol(MODE_ALIASES),
    tasks: findCol(TASKS_ALIASES),
    remarks: findCol(REMARKS_ALIASES),
  };

  if (idx.date === -1) idx.date = sniffDateColumn(table);

  if (idx.date === -1) {
    const detected = rawHeader.filter((h) => h.trim() !== "").join(", ") || "(aucun en-tête détecté)";
    return {
      rows,
      errors: [
        `Impossible de trouver une colonne de date dans ce fichier. En-têtes détectés : ${detected}. ` +
          `Modèle attendu : ${CSV_TEMPLATE_HEADER}`,
      ],
      detectedHeaders: rawHeader,
      sampleRows,
      needsDefaultEmployee: idx.email === -1 && idx.name === -1,
    };
  }

  const needsDefaultEmployee = idx.email === -1 && idx.name === -1;

  for (let i = 1; i < table.length; i++) {
    const line = i + 1;
    const cells = table[i];
    const email = idx.email !== -1 ? (cells[idx.email] || "").trim().toLowerCase() : "";
    const employee_name = idx.name !== -1 ? (cells[idx.name] || "").trim() : "";
    const dateRaw = (cells[idx.date] || "").trim();
    const entry_date = normalizeDateString(dateRaw);
    const dayTypeRaw = idx.dayType !== -1 ? (cells[idx.dayType] || "") : "";
    const day_type = resolveDayType(dayTypeRaw);
    const start_time = idx.start !== -1 ? normalizeTimeString(cells[idx.start] || "") : null;
    const end_time = idx.end !== -1 ? normalizeTimeString(cells[idx.end] || "") : null;
    const break_minutes = idx.breakMin !== -1 ? parseBreakMinutes(cells[idx.breakMin] || "") : 0;
    const work_mode = idx.mode !== -1 ? resolveWorkMode(cells[idx.mode] || "") : null;
    const tasks = idx.tasks !== -1 ? (cells[idx.tasks] || "").trim() || null : null;
    const remarks = idx.remarks !== -1 ? (cells[idx.remarks] || "").trim() || null : null;

    if (!entry_date) {
      errors.push(`Ligne ${line} : date invalide ou manquante ("${dateRaw}").`);
      continue;
    }
    if (!day_type || !VALID_DAY_TYPES.includes(day_type)) {
      errors.push(`Ligne ${line} : type de jour non reconnu "${dayTypeRaw}".`);
      continue;
    }
    if (break_minutes === null) {
      errors.push(`Ligne ${line} : pause_minutes invalide.`);
      continue;
    }

    const hours = computeDayHours(
      { day_type, start_time, end_time, break_minutes, entry_date },
      DEFAULT_WEEKDAY_HOURS
    );

    rows.push({
      line,
      email,
      employee_name,
      entry_date,
      day_type,
      start_time,
      end_time,
      break_minutes,
      work_mode,
      hours,
      tasks,
      remarks,
    });
  }

  return { rows, errors, detectedHeaders: rawHeader, sampleRows, needsDefaultEmployee };
}
