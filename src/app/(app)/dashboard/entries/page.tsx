import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/session";
import { getEntriesInRange } from "@/lib/queries";
import { getMonthDates, getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { MonthSelector } from "@/components/dashboard/month-selector";
import { EntriesTable } from "@/components/entries/entries-table";
import { sumHours } from "@/lib/hours";
import { formatHours } from "@/lib/utils";
import { TimeEntry } from "@/lib/types";

export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const params = await searchParams;
  const now = nowInAppTimeZone();
  const year = params.year ? Number(params.year) : now.year;
  const month = params.month ? Number(params.month) : now.month;

  const profile = await getSessionProfile();
  if (!profile) redirect("/login");

  const { start, end } = getMonthRange(year, month);
  const monthDates = getMonthDates(year, month);

  const monthEntries = await getEntriesInRange(profile.id, start, end);
  const entriesByDate: Record<string, TimeEntry> = {};
  for (const e of monthEntries) entriesByDate[e.entry_date] = e;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Mes heures</h1>
          <p className="text-sm text-slate-500">
            Total du mois : <span className="font-medium text-slate-900">{formatHours(sumHours(monthEntries))}</span>
          </p>
        </div>
        <MonthSelector year={year} month={month} />
      </div>

      <p className="text-xs text-slate-500 -mt-3">
        Les heures sont enregistrées automatiquement via le pointage. Vous ne pouvez pas les
        modifier manuellement — contactez votre administrateur en cas d&apos;erreur.
      </p>

      <EntriesTable profileId={profile.id} monthDates={monthDates} entriesByDate={entriesByDate} readOnly />
    </div>
  );
}
