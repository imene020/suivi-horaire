import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { listEmployees, getAllEntriesInRange } from "@/lib/queries";
import { getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { sumHours } from "@/lib/hours";
import { formatHours } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export default async function ComptableEmployeesPage() {
  const now = nowInAppTimeZone();
  const { start, end } = getMonthRange(now.year, now.month);
  const [profiles, monthEntries] = await Promise.all([
    listEmployees(),
    getAllEntriesInRange(start, end),
  ]);

  return (
    <div className="max-w-6xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-4">Employés</h1>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
              <th className="px-4 py-3">Nom</th>
              <th className="px-4 py-3">Fonction</th>
              <th className="px-4 py-3">Société</th>
              <th className="px-4 py-3">Heures ce mois</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((emp) => (
              <tr key={emp.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{emp.full_name}</td>
                <td className="px-4 py-3 text-slate-600">{emp.function_title || "-"}</td>
                <td className="px-4 py-3 text-slate-600">{emp.company}</td>
                <td className="px-4 py-3 text-slate-900">
                  {formatHours(sumHours(monthEntries.filter((e) => e.profile_id === emp.id)))}
                </td>
                <td className="px-4 py-3">
                  <Badge className={emp.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}>
                    {emp.active ? "Actif" : "Inactif"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/comptable/employees/${emp.id}`}>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </Link>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Aucun employé pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
