import { WeekSummary } from "@/lib/hours";
import { formatHours, cn } from "@/lib/utils";
import { toDateStr } from "@/lib/date";

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

/**
 * `monthStart`, `monthEnd` et `today` (YYYY-MM-DD) permettent de ne pas afficher en rouge ce qui
 * n'est pas un retard : la semaine en cours, et une semaine à cheval sur deux mois (seuls les
 * jours du mois affiché y sont comptés).
 */
export function WeekSummaryTable({
  weeks,
  monthStart,
  monthEnd,
  today,
}: {
  weeks: WeekSummary[];
  monthStart?: string;
  monthEnd?: string;
  today?: string;
}) {
  if (weeks.length === 0) {
    return <p className="text-sm text-slate-500">Aucune donnée pour cette période.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
            <th className="px-4 py-3">Semaine du</th>
            <th className="px-4 py-3">Heures travaillées</th>
            <th className="px-4 py-3">Objectif</th>
            <th className="px-4 py-3">Écart</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => {
            const weekEnd = addDays(w.weekStart, 6);
            const ongoing = !!today && today >= w.weekStart && today <= weekEnd;
            const partial = (!!monthStart && w.weekStart < monthStart) || (!!monthEnd && weekEnd > monthEnd);
            const neutral = (ongoing || partial) && w.diffHours < 0;
            return (
              <tr key={w.weekStart} className={cn("border-b border-slate-100 last:border-0", ongoing && "bg-sea-50/40")}>
                <td className="px-4 py-2.5 font-medium text-slate-900">
                  {new Date(w.weekStart + "T00:00:00").toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                  })}
                  {ongoing && (
                    <span className="ml-2 rounded-full bg-sea-100 px-2 py-0.5 text-[11px] font-semibold text-sea-700">en cours</span>
                  )}
                  {partial && !ongoing && (
                    <span className="ml-2 text-xs font-normal text-slate-400">semaine à cheval sur 2 mois</span>
                  )}
                </td>
                <td className="px-4 py-2.5 tabular">{formatHours(w.totalHours)}</td>
                <td className="px-4 py-2.5 text-slate-500 tabular">{formatHours(w.targetHours)}</td>
                <td
                  className={cn(
                    "px-4 py-2.5 font-medium tabular",
                    neutral ? "text-slate-400" : w.diffHours >= 0 ? "text-emerald-600" : "text-red-600"
                  )}
                >
                  {w.diffHours >= 0 ? "+" : ""}
                  {formatHours(w.diffHours)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
