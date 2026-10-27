import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/session";
import { getEntriesInRange, listLeaveRequests } from "@/lib/queries";
import { LeaveCard } from "@/components/dashboard/stat-cards";
import { LeaveRequestForm } from "@/components/leaves/leave-request-form";
import { LeaveRequestList } from "@/components/leaves/leave-request-list";
import { MonthSelector } from "@/components/dashboard/month-selector";
import { summarizeMonthlyLeave } from "@/lib/leaves";
import { getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { workedHours } from "@/lib/hours";
import { DAY_TYPE_COLORS, DAY_TYPE_LABELS, MONTH_NAMES_FR } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { formatHours } from "@/lib/utils";

export default async function LeavesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");

  const sp = await searchParams;
  const now = nowInAppTimeZone();
  const year = sp.year ? Number(sp.year) : now.year;
  const month = sp.month ? Number(sp.month) : now.month;
  const { start, end } = getMonthRange(year, month);

  const [monthEntries, requests] = await Promise.all([
    getEntriesInRange(profile.id, start, end),
    listLeaveRequests(profile.id),
  ]);

  const leave = summarizeMonthlyLeave(monthEntries, profile);
  const history = monthEntries
    .filter(
      (e) =>
        ["conge", "maladie", "ferie_paye"].includes(e.day_type) ||
        (["ferie_non_paye", "repos"].includes(e.day_type) && workedHours(e) > 0)
    )
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date));

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Congés & Maladie</h1>
          <p className="text-sm text-slate-500">
            Droits mensuels : {leave.congeAllowance}j de congé et {leave.maladieTotal}j de maladie par mois (non
            reportables). Travailler un jour férié non payé ou de repos crédite des jours de récupération.
          </p>
        </div>
        <MonthSelector year={year} month={month} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <LeaveCard
          title={`Congé — ${MONTH_NAMES_FR[month]} ${year}`}
          total={leave.congeTotal}
          used={leave.congeUsed}
          hint={leave.recoveryDays > 0 ? `dont ${leave.recoveryDays}j de récupération` : undefined}
        />
        <LeaveCard title={`Maladie — ${MONTH_NAMES_FR[month]} ${year}`} total={leave.maladieTotal} used={leave.maladieUsed} />
      </div>

      {profile.role === "employee" && <LeaveRequestForm defaultDate={now.date} />}

      <div>
        <h2 className="text-sm font-medium text-slate-700 mb-3">Mes demandes</h2>
        <LeaveRequestList requests={requests} mode="employee" emptyMessage="Aucune demande envoyée." />
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-700 mb-3">
          Absences et récupérations — {MONTH_NAMES_FR[month]} {year}
        </h2>
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {history.length === 0 && (
            <p className="text-sm text-slate-500 p-4">Aucune absence enregistrée ce mois.</p>
          )}
          {history.map((e) => {
            const worked = workedHours(e);
            const isRecovery = ["ferie_non_paye", "repos"].includes(e.day_type) && worked > 0;
            return (
              <div key={e.id} className="flex items-center justify-between px-4 py-3 gap-3">
                <span className="text-sm text-slate-900">
                  {new Date(e.entry_date + "T00:00:00").toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "2-digit",
                    month: "long",
                  })}
                  {e.tasks && e.day_type === "ferie_paye" && (
                    <span className="text-slate-400"> · {e.tasks}</span>
                  )}
                </span>
                <div className="flex items-center gap-1.5">
                  <Badge className={DAY_TYPE_COLORS[e.day_type]}>{DAY_TYPE_LABELS[e.day_type]}</Badge>
                  {isRecovery && (
                    <Badge className="bg-green-100 text-green-700">Récupération · {formatHours(worked)}</Badge>
                  )}
                  {e.day_type === "ferie_paye" && worked > 0 && (
                    <Badge className="bg-green-100 text-green-700">Travaillé · +{formatHours(worked)}</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
