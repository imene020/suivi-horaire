import Link from "next/link";
import { listEmployees, getAllEntriesInRange } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle, CardValue } from "@/components/ui/card";
import { getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { sumHours } from "@/lib/hours";
import { formatHours } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

export default async function ComptableOverviewPage() {
  const now = nowInAppTimeZone();
  const { start, end } = getMonthRange(now.year, now.month);

  const [employees, monthEntries] = await Promise.all([
    listEmployees(),
    getAllEntriesInRange(start, end),
  ]);
  const totalHours = sumHours(monthEntries);
  const activeCount = employees.filter((e) => e.active).length;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Vue d&apos;ensemble</h1>
        <p className="text-sm text-slate-500">Accès en lecture seule aux heures de l&apos;équipe</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
      </div>

      <Link
        href="/comptable/employees"
        className="inline-flex items-center gap-2 text-sm font-medium text-[#545454] hover:text-[#3a3736]"
      >
        Voir le détail par employé <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
