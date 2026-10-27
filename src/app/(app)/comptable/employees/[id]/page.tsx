import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { findProfileById, getEntriesInRange } from "@/lib/queries";
import { EntriesTable } from "@/components/entries/entries-table";
import { MonthSelector } from "@/components/dashboard/month-selector";
import { WeekSummaryTable } from "@/components/dashboard/week-summary-table";
import { LeaveCard, MoneyCard } from "@/components/dashboard/stat-cards";
import { getMonthDates, getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { sumHours, summarizeByWeek } from "@/lib/hours";
import { summarizeMonthlyLeave } from "@/lib/leaves";
import { MONTH_NAMES_FR } from "@/lib/constants";
import { formatHours } from "@/lib/utils";
import { TimeEntry } from "@/lib/types";

export default async function ComptableEmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const now = nowInAppTimeZone();
  const year = sp.year ? Number(sp.year) : now.year;
  const month = sp.month ? Number(sp.month) : now.month;

  const { start, end } = getMonthRange(year, month);
  const monthDates = getMonthDates(year, month);

  const [p, monthEntries] = await Promise.all([findProfileById(id), getEntriesInRange(id, start, end)]);
  if (!p) notFound();
  const entriesByDate: Record<string, TimeEntry> = {};
  for (const e of monthEntries) entriesByDate[e.entry_date] = e;

  const weeks = summarizeByWeek(monthEntries, p.weekly_target_hours);
  const leave = summarizeMonthlyLeave(monthEntries, p);
  const monthLabel = `${MONTH_NAMES_FR[month]} ${year}`;

  return (
    <div className="space-y-6 max-w-6xl">
      <Link href="/comptable/employees" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Retour aux employés
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-slate-900">{p.full_name}</h1>
        <p className="text-sm text-slate-500">{p.function_title} — {p.company}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MoneyCard title="Salaire mensuel fixe" amount={p.monthly_salary} />
        <LeaveCard
          title={`Congé — ${monthLabel}`}
          total={leave.congeTotal}
          used={leave.congeUsed}
          hint={leave.recoveryDays > 0 ? `dont ${leave.recoveryDays}j de récupération` : undefined}
        />
        <LeaveCard title={`Maladie — ${monthLabel}`} total={leave.maladieTotal} used={leave.maladieUsed} />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-medium text-slate-700">Suivi horaire</h2>
          <p className="text-xs text-slate-500">
            Total du mois : <span className="font-medium text-slate-900">{formatHours(sumHours(monthEntries))}</span>
          </p>
        </div>
        <MonthSelector year={year} month={month} />
      </div>

      <WeekSummaryTable weeks={weeks} />

      <EntriesTable profileId={id} monthDates={monthDates} entriesByDate={entriesByDate} readOnly />
    </div>
  );
}
