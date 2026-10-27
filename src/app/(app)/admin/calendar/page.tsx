import { listEmployees, getAllEntriesInRange } from "@/lib/queries";
import { getYearRange, getDatesBetween, nowInAppTimeZone } from "@/lib/date";
import { AdminYearCalendar } from "@/components/admin/admin-year-calendar";
import { ImportHolidaysButton } from "@/components/admin/import-holidays-button";
import { DayMarker } from "@/components/calendar/mini-month";
import { EmployeeDayStatus } from "@/components/admin/day-detail-dialog";
import { DAY_TYPE_LABELS, employeeColor } from "@/lib/constants";
import { DayType } from "@/lib/types";

const COMPANY_DAY_TYPES: DayType[] = ["ferie_paye", "ferie_non_paye", "repos"];
const LEAVE_DAY_TYPES: DayType[] = ["conge", "maladie"];

export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const sp = await searchParams;
  const year = sp.year ? Number(sp.year) : nowInAppTimeZone().year;
  const { start, end } = getYearRange(year);

  const [allEmployees, entries] = await Promise.all([listEmployees(), getAllEntriesInRange(start, end)]);
  const employees = allEmployees.filter((e) => e.active);
  const employeeIndex = new Map(employees.map((e, i) => [e.id, i]));
  const employeeName = new Map(employees.map((e) => [e.id, e.full_name]));

  const dayTypeByDate: Record<string, DayType> = {};
  const leavesByDate: Record<string, { profile_id: string; full_name: string; day_type: DayType }[]> = {};
  // Statut de chaque employé actif pour chaque jour (défaut "normal" si pas d'entrée).
  const statusesByDate: Record<string, EmployeeDayStatus[]> = {};

  for (const date of getDatesBetween(start, end)) {
    statusesByDate[date] = employees.map((e) => ({
      profile_id: e.id,
      full_name: e.full_name,
      day_type: "normal",
      work_mode: null,
      hours: 0,
    }));
  }

  for (const e of entries) {
    if (COMPANY_DAY_TYPES.includes(e.day_type)) {
      dayTypeByDate[e.entry_date] = e.day_type;
    } else if (LEAVE_DAY_TYPES.includes(e.day_type) && employeeIndex.has(e.profile_id)) {
      (leavesByDate[e.entry_date] ??= []).push({
        profile_id: e.profile_id,
        full_name: employeeName.get(e.profile_id) ?? "",
        day_type: e.day_type,
      });
    }

    const idx = employeeIndex.get(e.profile_id);
    const dayStatuses = statusesByDate[e.entry_date];
    if (idx !== undefined && dayStatuses) {
      const statusIdx = dayStatuses.findIndex((s) => s.profile_id === e.profile_id);
      if (statusIdx !== -1) {
        dayStatuses[statusIdx] = {
          profile_id: e.profile_id,
          full_name: employeeName.get(e.profile_id) ?? "",
          day_type: e.day_type,
          work_mode: e.work_mode,
          hours: e.hours,
        };
      }
    }
  }

  // Une couleur par employé ; si plusieurs employés sont absents le même jour,
  // la couleur du premier est affichée avec un compteur, le détail est dans l'infobulle.
  const markersByDate: Record<string, DayMarker> = {};
  for (const [date, leaves] of Object.entries(leavesByDate)) {
    leaves.sort((a, b) => (employeeIndex.get(a.profile_id) ?? 0) - (employeeIndex.get(b.profile_id) ?? 0));
    const first = leaves[0];
    markersByDate[date] = {
      className: `${employeeColor(employeeIndex.get(first.profile_id) ?? 0)} font-medium${
        first.day_type === "maladie" ? " ring-1 ring-inset ring-red-400" : ""
      }`,
      title: leaves.map((l) => `${l.full_name} — ${DAY_TYPE_LABELS[l.day_type]}`).join("\n"),
      count: leaves.length,
    };
  }

  const employeeLegend = employees.map((e, i) => ({
    label: e.full_name,
    className: employeeColor(employeeIndex.get(e.id) ?? i),
  }));

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Calendrier de l&apos;équipe</h1>
          <p className="text-sm text-slate-500">
            Cliquez sur une date pour voir le statut complet de chaque employé ce jour-là (congé, maladie,
            présentiel, télétravail, férié, repos ou non renseigné) et pour définir un jour férié/repos pour toute
            l&apos;équipe. Les congés/maladies acceptés apparaissent avec la couleur de chaque employé (contour
            rouge = maladie).
          </p>
        </div>
        <ImportHolidaysButton year={year} />
      </div>

      <p className="text-xs text-slate-500">
        Note : les fêtes religieuses musulmanes (Aïd el-Fitr, Aïd el-Adha, Mawlid, Nouvel An hégirien) suivent le
        calendrier lunaire et changent chaque année — ajoutez-les manuellement en cliquant sur la date concernée.
      </p>

      <AdminYearCalendar
        year={year}
        dayTypeByDate={dayTypeByDate}
        markersByDate={markersByDate}
        employeeLegend={employeeLegend}
        statusesByDate={statusesByDate}
      />
    </div>
  );
}
