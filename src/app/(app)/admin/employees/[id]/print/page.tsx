import { notFound, redirect } from "next/navigation";
import { findProfileById, getEntriesInRange } from "@/lib/queries";
import { getSessionProfile } from "@/lib/session";
import { getMonthDates, getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { sumHours } from "@/lib/hours";
import { formatHours } from "@/lib/utils";
import { MONTH_NAMES_FR } from "@/lib/constants";
import { TimeEntry } from "@/lib/types";
import { EntriesTable } from "@/components/entries/entries-table";
import { MonthSelector } from "@/components/dashboard/month-selector";
import { PrintButton } from "@/components/print/print-button";

export default async function PrintSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const me = await getSessionProfile();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/dashboard");

  const now = nowInAppTimeZone();
  const year = sp.year ? Number(sp.year) : now.year;
  const month = sp.month ? Number(sp.month) : now.month;

  const { start, end } = getMonthRange(year, month);
  const monthDates = getMonthDates(year, month);

  const [p, monthEntries] = await Promise.all([
    findProfileById(id),
    getEntriesInRange(id, start, end),
  ]);
  if (!p) notFound();
  const entriesByDate: Record<string, TimeEntry> = {};
  for (const e of monthEntries) entriesByDate[e.entry_date] = e;

  const total = sumHours(monthEntries);

  return (
    <div className="space-y-4 max-w-6xl print:max-w-none">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Planning — {p.full_name}</h1>
          <p className="text-sm text-slate-500">{MONTH_NAMES_FR[month]} {year}</p>
        </div>
        <div className="flex items-center gap-3">
          <MonthSelector year={year} month={month} />
          <PrintButton />
        </div>
      </div>

      <div className="hidden print:block mb-4">
        <p className="text-lg font-semibold text-slate-900">{p.company} — {p.full_name}</p>
        <p className="text-sm text-slate-700">
          {MONTH_NAMES_FR[month]} {year} — Total : {formatHours(total)}h
        </p>
      </div>

      <EntriesTable profileId={id} monthDates={monthDates} entriesByDate={entriesByDate} readOnly />
    </div>
  );
}
