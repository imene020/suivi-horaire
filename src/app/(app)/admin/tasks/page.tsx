import { Suspense } from "react";
import { Lightbulb } from "lucide-react";
import { listEmployees, listAllTasks } from "@/lib/queries";
import { getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { MonthSelector } from "@/components/dashboard/month-selector";
import { EmployeeFilter } from "@/components/admin/employee-filter";
import { TaskList } from "@/components/tasks/task-list";
import { Card, CardContent, CardHeader, CardTitle, CardValue } from "@/components/ui/card";

export default async function AdminTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; employee?: string; innovation?: string }>;
}) {
  const sp = await searchParams;
  const now = nowInAppTimeZone();
  const year = sp.year ? Number(sp.year) : now.year;
  const month = sp.month ? Number(sp.month) : now.month;
  const { start, end } = getMonthRange(year, month);

  const [employees, allTasks] = await Promise.all([listEmployees(), listAllTasks(start, end)]);
  const employeeNames = Object.fromEntries(employees.map((e) => [e.id, e.full_name]));

  const tasks = allTasks.filter((t) => (!sp.employee || t.profile_id === sp.employee) && (!sp.innovation || t.is_innovation));
  const innovations = allTasks.filter((t) => t.is_innovation);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Tâches de l&apos;équipe</h1>
          <p className="text-sm text-slate-500">Tâches déclarées par les employés et idées d&apos;innovation.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Suspense>
            <EmployeeFilter employees={employees} value={sp.employee ?? ""} />
          </Suspense>
          <MonthSelector year={year} month={month} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Tâches ce mois</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <CardValue>{allTasks.length}</CardValue>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Terminées</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <CardValue>{allTasks.filter((t) => t.done).length}</CardValue>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Lightbulb className="h-4 w-4 text-amber-500" /> Innovations
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <CardValue>{innovations.length}</CardValue>
          </CardContent>
        </Card>
      </div>

      {innovations.length > 0 && !sp.employee && (
        <div>
          <h2 className="text-sm font-medium text-slate-700 mb-3 inline-flex items-center gap-1.5">
            <Lightbulb className="h-4 w-4 text-amber-500" /> Idées d&apos;innovation
          </h2>
          <TaskList tasks={innovations} readOnly employeeNames={employeeNames} />
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium text-slate-700 mb-3">Toutes les tâches</h2>
        <TaskList tasks={tasks} readOnly employeeNames={employeeNames} emptyMessage="Aucune tâche pour cette période." />
      </div>
    </div>
  );
}
