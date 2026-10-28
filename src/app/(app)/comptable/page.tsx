import Link from "next/link";
import { listEmployees, getAllEntriesInRange } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle, CardValue } from "@/components/ui/card";
import { getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { sumHours } from "@/lib/hours";
import { formatHours } from "@/lib/utils";
import { ArrowRight, Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { MONTH_NAMES_FR } from "@/lib/constants";

export default async function ComptableOverviewPage() {
  const now = nowInAppTimeZone();
  const { start, end } = getMonthRange(now.year, now.month);

  const [employees, monthEntries] = await Promise.all([
    listEmployees(),
    getAllEntriesInRange(start, end),
  ]);
  const totalHours = sumHours(monthEntries);
  const activeCount = employees.filter((e) => e.active).length;
  // Le mois précédent est souvent celui qu'on paie en début de mois.
  const prev = now.month === 0 ? { year: now.year - 1, month: 11 } : { year: now.year, month: now.month - 1 };

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

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Export de paie</p>
            <p className="text-xs text-slate-500">
              Fichier Excel : synthèse par employé, détail jour par jour et points à vérifier avant de payer.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/exports/payroll?year=${prev.year}&month=${prev.month}`} className={buttonVariants({ variant: "outline" })}>
              <Download className="h-4 w-4" /> {MONTH_NAMES_FR[prev.month]} {prev.year}
            </a>
            <a href={`/api/exports/payroll?year=${now.year}&month=${now.month}`} className={buttonVariants()}>
              <Download className="h-4 w-4" /> {MONTH_NAMES_FR[now.month]} {now.year} (en cours)
            </a>
          </div>
        </CardContent>
      </Card>

      <Link
        href="/comptable/employees"
        className="inline-flex items-center gap-2 text-sm font-medium text-[#545454] hover:text-[#3a3736]"
      >
        Voir le détail par employé <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
