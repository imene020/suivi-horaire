import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { findProfileById, getEntriesInRange, listDocumentsByProfile, listTasks } from "@/lib/queries";
import { TaskList } from "@/components/tasks/task-list";
import { EmployeeEditForm } from "@/components/admin/employee-edit-form";
import { MonthlySettingsEditor } from "@/components/admin/leave-balances-editor";
import { PaySlipUpload } from "@/components/admin/pay-slip-upload";
import { EntriesTable } from "@/components/entries/entries-table";
import { MonthSelector } from "@/components/dashboard/month-selector";
import { getMonthDates, getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { sumHours, summarizeByWeek } from "@/lib/hours";
import { summarizeMonthlyLeave } from "@/lib/leaves";
import { WeekSummaryTable } from "@/components/dashboard/week-summary-table";
import { formatHours } from "@/lib/utils";
import { MONTH_NAMES_FR } from "@/lib/constants";
import { TimeEntry } from "@/lib/types";

export default async function EmployeeDetailPage({
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

  const [p, monthEntries, paieDocsRaw, monthTasks] = await Promise.all([
    findProfileById(id),
    getEntriesInRange(id, start, end),
    listDocumentsByProfile(id, "paie"),
    listTasks(id, start, end),
  ]);
  if (!p) notFound();
  const entriesByDate: Record<string, TimeEntry> = {};
  for (const e of monthEntries) entriesByDate[e.entry_date] = e;

  const weeks = summarizeByWeek(monthEntries, p.weekly_target_hours);
  const paieDocs = paieDocsRaw.map((d) => ({
    id: d.id,
    original_name: d.original_name,
    uploaded_at: d.uploaded_at,
    note: d.note,
  }));

  const leave = summarizeMonthlyLeave(monthEntries, p);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center gap-3 print:hidden">
        <Link href="/admin/employees" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Retour aux employés
        </Link>
        <Link
          href={`/admin/employees/${id}/print`}
          target="_blank"
          className="inline-flex items-center gap-1.5 text-sm text-[#545454] hover:text-[#3a3736]"
        >
          <Printer className="h-4 w-4" /> Imprimer le planning
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-slate-900">{p.full_name}</h1>
        <p className="text-sm text-slate-500">{p.function_title} — {p.company}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EmployeeEditForm profile={p} />
        <MonthlySettingsEditor
          profileId={id}
          monthLabel={`${MONTH_NAMES_FR[month]} ${year}`}
          monthlySalary={p.monthly_salary}
          congePerMonth={p.conge_days_per_month}
          maladiePerMonth={p.maladie_days_per_month}
          summary={leave}
        />
      </div>

      <PaySlipUpload profileId={id} documents={paieDocs} />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-medium text-slate-700">Suivi horaire</h2>
          <p className="text-xs text-slate-500">
            Total du mois : <span className="font-medium text-slate-900">{formatHours(sumHours(monthEntries))}</span>
          </p>
        </div>
        <MonthSelector year={year} month={month} />
      </div>

      <WeekSummaryTable weeks={weeks} monthStart={start} monthEnd={end} today={now.date} />

      <EntriesTable profileId={id} monthDates={monthDates} entriesByDate={entriesByDate} />

      <div>
        <h2 className="text-sm font-medium text-slate-700 mb-3">Tâches déclarées ce mois</h2>
        <TaskList tasks={monthTasks} readOnly emptyMessage="Aucune tâche déclarée ce mois." />
      </div>
    </div>
  );
}
