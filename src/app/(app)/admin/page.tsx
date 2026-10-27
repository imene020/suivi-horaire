import Link from "next/link";
import { listEmployees, getAllEntriesInRange, countPendingLeaveRequests } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle, CardValue } from "@/components/ui/card";
import { getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { sumHours } from "@/lib/hours";
import { formatHours } from "@/lib/utils";
import { ArrowRight, Inbox } from "lucide-react";

export default async function AdminOverviewPage() {
  const now = nowInAppTimeZone();
  const { start, end } = getMonthRange(now.year, now.month);

  const [employees, monthEntries, pendingRequests] = await Promise.all([
    listEmployees(),
    getAllEntriesInRange(start, end),
    countPendingLeaveRequests(),
  ]);
  const totalHours = sumHours(monthEntries);
  const activeCount = employees.filter((e) => e.active).length;
  const onLeaveToday = monthEntries.filter(
    (e) => e.entry_date === now.date && (e.day_type === "conge" || e.day_type === "maladie")
  ).length;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Vue d&apos;ensemble RH</h1>
        <p className="text-sm text-slate-500">Résumé de l&apos;équipe pour ce mois</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/admin/leave-requests">
          <Card className={pendingRequests > 0 ? "border-amber-300 bg-amber-50/40 hover:shadow-md" : "hover:shadow-md"}>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-1.5">
                <Inbox className="h-4 w-4" /> Demandes en attente
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <CardValue>{pendingRequests}</CardValue>
            </CardContent>
          </Card>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Employés actifs</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <CardValue>{activeCount}</CardValue>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Heures totales ce mois</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <CardValue>{formatHours(totalHours)}</CardValue>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Absents aujourd&apos;hui</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <CardValue>{onLeaveToday}</CardValue>
          </CardContent>
        </Card>
      </div>

      <Link
        href="/admin/employees"
        className="inline-flex items-center gap-2 text-sm font-medium text-[#545454] hover:text-[#3a3736]"
      >
        Gérer les employés <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
