import { redirect } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { getSessionProfile } from "@/lib/session";
import { listTasks } from "@/lib/queries";
import { getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { MonthSelector } from "@/components/dashboard/month-selector";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskList } from "@/components/tasks/task-list";
import { Card, CardContent, CardHeader, CardTitle, CardValue } from "@/components/ui/card";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");

  const params = await searchParams;
  const now = nowInAppTimeZone();
  const year = params.year ? Number(params.year) : now.year;
  const month = params.month ? Number(params.month) : now.month;
  const { start, end } = getMonthRange(year, month);

  const tasks = await listTasks(profile.id, start, end);
  const doneCount = tasks.filter((t) => t.done).length;
  const innovationCount = tasks.filter((t) => t.is_innovation).length;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Mes tâches</h1>
          <p className="text-sm text-slate-500">Notez vos tâches du jour et vos idées d&apos;innovation.</p>
        </div>
        <MonthSelector year={year} month={month} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Tâches ce mois</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <CardValue>{tasks.length}</CardValue>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Terminées</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <CardValue>{doneCount}</CardValue>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Lightbulb className="h-4 w-4 text-amber-500" /> Innovations
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <CardValue>{innovationCount}</CardValue>
          </CardContent>
        </Card>
      </div>

      <TaskForm defaultDate={now.date} />

      <div>
        <h2 className="text-sm font-medium text-slate-700 mb-3">Liste des tâches</h2>
        <TaskList tasks={tasks} emptyMessage="Aucune tâche ce mois. Ajoutez-en une ci-dessus." />
      </div>
    </div>
  );
}
