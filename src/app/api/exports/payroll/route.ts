import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/session";
import { listEmployees, getAllEntriesInRange } from "@/lib/queries";
import { buildPayrollWorkbook } from "@/lib/payroll-export";
import { detectAnomalies, shiftDate } from "@/lib/anomalies";
import { getMonthRange, nowInAppTimeZone } from "@/lib/date";

/** Téléchargement de l'export de paie (Excel) d'un mois : RH et comptable uniquement.
 *  GET /api/exports/payroll?year=2026&month=9  (mois 0-11, comme le reste de l'app) */
export async function GET(req: Request) {
  const me = await getSessionProfile();
  if (!me) return new NextResponse("Non authentifié", { status: 401 });
  if (me.role !== "admin" && me.role !== "comptable") return new NextResponse("Accès refusé", { status: 403 });

  const now = nowInAppTimeZone();
  const params = new URL(req.url).searchParams;
  const year = params.has("year") ? Number(params.get("year")) : now.year;
  const month = params.has("month") ? Number(params.get("month")) : now.month;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 0 || month > 11) {
    return new NextResponse("Mois invalide", { status: 400 });
  }

  const { start, end } = getMonthRange(year, month);
  const isCurrentMonth = now.date >= start && now.date <= end;
  // Pour un mois passé, les contrôles se font "au lendemain du dernier jour du mois".
  const reference = isCurrentMonth ? now.date : shiftDate(end, 1);
  const windowDays = isCurrentMonth ? 30 : 31 + 30;

  const [employees, entries] = await Promise.all([
    listEmployees(),
    getAllEntriesInRange(shiftDate(start, -30), end),
  ]);
  const active = employees.filter((e) => e.active);
  const anomalies = detectAnomalies(active, entries, {
    today: reference,
    windowDays,
    missingDaysWindow: windowDays,
    balanceMonth: start.slice(0, 7),
  }).filter((a) => a.date === null || (a.date >= start && a.date <= end));

  const buffer = await buildPayrollWorkbook({
    company: active[0]?.company || me.company || "Suivi Horaire",
    year,
    month,
    employees: active,
    entries,
    anomalies,
    generatedAt: `${now.date.split("-").reverse().join("/")} à ${now.time}`,
  });

  const fileName = `paie-${year}-${String(month + 1).padStart(2, "0")}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
