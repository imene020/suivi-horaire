import { getSessionProfile } from "@/lib/session";
import { getEntriesInRange, getEntryByDate } from "@/lib/queries";
import { getMonthRange, nowInAppTimeZone, toDateStr } from "@/lib/date";
import { summarizeByWeek, sumHours, standardHoursFor } from "@/lib/hours";
import { summarizeMonthlyLeave } from "@/lib/leaves";
import { HoursCard, LeaveCard, MoneyCard } from "@/components/dashboard/stat-cards";
import { WeekSummaryTable } from "@/components/dashboard/week-summary-table";
import { MonthSelector } from "@/components/dashboard/month-selector";
import { PunchClock } from "@/components/dashboard/punch-clock";
import { MONTH_NAMES_FR } from "@/lib/constants";
import { PageGreeting, firstNameOf } from "@/components/ui/page-greeting";
import { redirect } from "next/navigation";

export default async function DashboardPage({
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

  const [monthEntries, todayEntry] = await Promise.all([
    getEntriesInRange(profile.id, start, end),
    getEntryByDate(profile.id, now.date),
  ]);

  const weeks = summarizeByWeek(monthEntries, profile.weekly_target_hours);
  const monthTotal = sumHours(monthEntries);
  const leave = summarizeMonthlyLeave(monthEntries, profile);

  const currentWeek = weeks.find((w) => {
    const wEnd = new Date(w.weekStart + "T00:00:00");
    wEnd.setDate(wEnd.getDate() + 6);
    return now.date >= w.weekStart && now.date <= toDateStr(wEnd);
  });

  const monthLabel = `${MONTH_NAMES_FR[month]} ${year}`;

  return (
    <div className="space-y-6 max-w-6xl">
      <PageGreeting
        firstName={firstNameOf(profile.full_name)}
        subtitle={[profile.function_title, profile.company].filter(Boolean).join(" · ")}
      >
        <MonthSelector year={year} month={month} />
      </PageGreeting>

      {profile.role === "employee" && (
        <PunchClock todayEntry={todayEntry} standardHours={standardHoursFor(now.date, profile.weekday_hours)} />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <HoursCard title={`Heures payées · ${monthLabel}`} hours={monthTotal} />
        <HoursCard
          title="Cette semaine"
          hours={currentWeek?.totalHours ?? 0}
          target={profile.weekly_target_hours}
        />
        <LeaveCard
          title={`Congé · ${MONTH_NAMES_FR[month]}`}
          total={leave.congeTotal}
          used={leave.congeUsed}
          hint={
            leave.recoveryDays > 0
              ? `${leave.congeAllowance.toLocaleString("fr-FR")} j/mois + ${leave.recoveryDays.toLocaleString("fr-FR")} j de récupération`
              : `${leave.congeAllowance.toLocaleString("fr-FR")} j par mois (non reportable)`
          }
        />
        <LeaveCard title={`Maladie · ${MONTH_NAMES_FR[month]}`} total={leave.maladieTotal} used={leave.maladieUsed} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-slate-700 mb-3">Résumé hebdomadaire</h2>
          <WeekSummaryTable weeks={weeks} monthStart={start} monthEnd={end} today={now.date} />
        </div>
        {profile.role === "employee" && profile.monthly_salary > 0 && (
          <div className="lg:pt-8">
            <MoneyCard title="Salaire mensuel" amount={profile.monthly_salary} hint="Montant fixe défini par la RH" />
          </div>
        )}
      </div>
    </div>
  );
}
