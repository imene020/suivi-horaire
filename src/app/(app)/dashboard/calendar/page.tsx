import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/session";
import { getEntriesInRange, getAllEntriesInRange, listEmployees } from "@/lib/queries";
import { getYearRange, nowInAppTimeZone } from "@/lib/date";
import { YearCalendar } from "@/components/calendar/year-calendar";
import { DayMarker } from "@/components/calendar/mini-month";
import { DAY_TYPE_LABELS, employeeColor } from "@/lib/constants";
import { formatHours } from "@/lib/utils";
import { DayType } from "@/lib/types";

export default async function EmployeeCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const sp = await searchParams;
  const year = sp.year ? Number(sp.year) : nowInAppTimeZone().year;

  const profile = await getSessionProfile();
  if (!profile) redirect("/login");

  const { start, end } = getYearRange(year);
  const [entries, allEntries, employees] = await Promise.all([
    getEntriesInRange(profile.id, start, end),
    getAllEntriesInRange(start, end),
    listEmployees(),
  ]);

  const dayTypeByDate: Record<string, DayType> = {};
  for (const e of entries) {
    if (e.day_type !== "normal") dayTypeByDate[e.entry_date] = e.day_type;
  }

  // Congés et maladies des collègues : une couleur par employé, détail en
  // infobulle (contour rouge = maladie). Les jours fériés/repos s'affichent
  // déjà via dayTypeByDate car ils sont inscrits dans le planning de chacun.
  const employeeIndex = new Map(employees.map((e, i) => [e.id, i]));
  const employeeName = new Map(employees.map((e) => [e.id, e.full_name]));

  const leavesByDate: Record<string, { profile_id: string; full_name: string; day_type: DayType }[]> = {};
  for (const e of allEntries) {
    if (
      (e.day_type === "conge" || e.day_type === "maladie") &&
      e.profile_id !== profile.id &&
      employeeIndex.has(e.profile_id)
    ) {
      (leavesByDate[e.entry_date] ??= []).push({
        profile_id: e.profile_id,
        full_name: employeeName.get(e.profile_id) ?? "",
        day_type: e.day_type,
      });
    }
  }

  // Jours travaillés (pointage ou import de fichier) : pastille verte avec le
  // détail des heures en infobulle, pour que toutes les journées avec des heures
  // soient visibles sur le calendrier, pas seulement les absences.
  const markersByDate: Record<string, DayMarker> = {};
  for (const e of entries) {
    if (e.day_type === "normal" && e.hours > 0) {
      markersByDate[e.entry_date] = {
        className: "bg-emerald-100 text-emerald-700 font-medium",
        title: `${formatHours(e.hours)} travaillées${e.imported ? " · Import" : ""}`,
      };
    }
  }
  for (const [date, leaves] of Object.entries(leavesByDate)) {
    if (markersByDate[date]) continue; // un jour travaillé (propre journée) prime sur l'absence d'un collègue
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

  const extraLegend = [
    { label: "Travaillé", className: "bg-emerald-100 text-emerald-700" },
    ...employees
      .filter((e) => e.active && e.id !== profile.id)
      .map((e) => ({ label: e.full_name, className: employeeColor(employeeIndex.get(e.id) ?? 0) })),
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Calendrier annuel</h1>
        <p className="text-sm text-slate-500">
          Vos congés, absences et jours fériés — ainsi que les absences de vos collègues — {year}
        </p>
      </div>

      <YearCalendar
        year={year}
        dayTypeByDate={dayTypeByDate}
        markersByDate={markersByDate}
        extraLegend={extraLegend}
      />
    </div>
  );
}
