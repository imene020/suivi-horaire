import Link from "next/link";
import { listEmployees, getAllEntriesInRange, countDocumentsByProfiles } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle, CardValue } from "@/components/ui/card";
import { MonthSelector } from "@/components/dashboard/month-selector";
import { getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { sumHours } from "@/lib/hours";
import { summarizeMonthlyLeave } from "@/lib/leaves";
import { MONTH_NAMES_FR } from "@/lib/constants";
import { formatHours } from "@/lib/utils";
import { formatMoney } from "@/components/dashboard/stat-cards";
import { ArrowRight, Download, Wallet } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default async function AdminSalariesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const now = nowInAppTimeZone();
  const year = sp.year ? Number(sp.year) : now.year;
  const month = sp.month ? Number(sp.month) : now.month;
  const { start, end } = getMonthRange(year, month);

  const employees = await listEmployees();
  const active = employees.filter((e) => e.active);

  const [allEntries, payslipCounts] = await Promise.all([
    getAllEntriesInRange(start, end),
    countDocumentsByProfiles(active.map((e) => e.id), "paie"),
  ]);

  const entriesByProfile = new Map<string, typeof allEntries>();
  for (const e of allEntries) {
    (entriesByProfile.get(e.profile_id) ?? entriesByProfile.set(e.profile_id, []).get(e.profile_id)!).push(e);
  }

  const monthLabel = `${MONTH_NAMES_FR[month]} ${year}`;
  const totalPayroll = active.reduce((s, e) => s + e.monthly_salary, 0);
  const totalHours = sumHours(allEntries);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 inline-flex items-center gap-2">
            <Wallet className="h-5 w-5 text-[#545454]" /> Gestion des salaires
          </h1>
          <p className="text-sm text-slate-500">Salaire mensuel fixe, heures et congés — {monthLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/exports/payroll?year=${year}&month=${month}`} className={buttonVariants({ variant: "outline" })}>
            <Download className="h-4 w-4" /> Exporter en Excel
          </a>
          <MonthSelector year={year} month={month} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Masse salariale ({monthLabel})</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <CardValue>{formatMoney(totalPayroll)}</CardValue>
            <p className="text-xs text-slate-500 mt-1">{active.length} employé(s) actif(s)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Heures travaillées ({monthLabel})</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <CardValue>{formatHours(totalHours)}</CardValue>
            <p className="text-xs text-slate-500 mt-1">Cumul équipe</p>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Employé</th>
              <th className="text-right px-4 py-3 font-medium">Salaire mensuel</th>
              <th className="text-right px-4 py-3 font-medium">Heures</th>
              <th className="text-right px-4 py-3 font-medium">Congé utilisé</th>
              <th className="text-right px-4 py-3 font-medium">Maladie utilisée</th>
              <th className="text-center px-4 py-3 font-medium">Fiches de paie</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {active.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Aucun employé actif.
                </td>
              </tr>
            ) : (
              active.map((e) => {
                const entries = entriesByProfile.get(e.id) ?? [];
                const leave = summarizeMonthlyLeave(entries, e);
                const payslipCount = payslipCounts.get(e.id) ?? 0;
                return (
                  <tr key={e.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{e.full_name}</p>
                      <p className="text-xs text-slate-500">{e.function_title ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">{formatMoney(e.monthly_salary)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatHours(sumHours(entries))}</td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {leave.congeUsed}j / {leave.congeTotal}j
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {leave.maladieUsed}j / {leave.maladieTotal}j
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center min-w-6 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-medium">
                        {payslipCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/employees/${e.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#545454] hover:text-[#3a3736]"
                      >
                        Détail <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        Astuce : pour modifier le salaire mensuel ou les droits de congé/maladie d&apos;un employé, ouvrez sa fiche
        détaillée (lien Détail) puis la section « Paramètres mensuels ». Les fiches de paie s&apos;uploadent également
        depuis la fiche détaillée de chaque employé.
      </p>
    </div>
  );
}
