import Link from "next/link";
import { ShieldCheck, SearchCheck, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Anomaly, AnomalySeverity } from "@/lib/anomalies";
import { cn } from "@/lib/utils";

const SEVERITY: Record<AnomalySeverity, { label: string; className: string }> = {
  high: { label: "À corriger", className: "bg-red-50 text-red-700 ring-red-200" },
  medium: { label: "À vérifier", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  low: { label: "Pour info", className: "bg-slate-100 text-slate-600 ring-slate-200" },
};

const VISIBLE = 6;

function hrefFor(a: Anomaly, today: string): string {
  const date = a.date ?? today;
  const [y, m] = date.split("-").map(Number);
  return `/admin/employees/${a.profile_id}?year=${y}&month=${m - 1}`;
}

function Row({ a, colorIndex, today }: { a: Anomaly; colorIndex: number; today: string }) {
  const sev = SEVERITY[a.severity];
  return (
    <li>
      <Link
        href={hrefFor(a, today)}
        className="group flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sea-500"
      >
        <Avatar name={a.full_name} colorIndex={colorIndex} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-medium text-slate-900">{a.title}</p>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", sev.className)}>
              {sev.label}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{a.full_name}</span> · {a.detail}
          </p>
        </div>
        <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-slate-500" />
      </Link>
    </li>
  );
}

export function AnomaliesPanel({
  anomalies,
  colorIndexById,
  today,
}: {
  anomalies: Anomaly[];
  colorIndexById: Map<string, number>;
  today: string;
}) {
  const high = anomalies.filter((a) => a.severity === "high").length;
  const shown = anomalies.slice(0, VISIBLE);
  const rest = anomalies.slice(VISIBLE);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 md:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sea-50 text-sea-600">
            <SearchCheck className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Points à vérifier</h2>
            <p className="text-xs text-slate-500">Détectés automatiquement sur les 30 derniers jours, avant la paie</p>
          </div>
        </div>
        {anomalies.length > 0 && (
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-semibold tabular",
              high > 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
            )}
          >
            {anomalies.length}
          </span>
        )}
      </div>

      {anomalies.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-8 text-sm text-slate-600">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
          Rien à signaler : toutes les journées des 30 derniers jours sont cohérentes.
        </div>
      ) : (
        <div className="p-2">
          <ul className="divide-y divide-slate-100">
            {shown.map((a) => (
              <Row key={a.id} a={a} colorIndex={colorIndexById.get(a.profile_id) ?? 0} today={today} />
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-sea-600 hover:text-sea-700 [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">{rest.length === 1 ? "Voir l'autre point" : `Voir les ${rest.length} autres points`}</span>
                <span className="hidden group-open:inline">Masquer</span>
              </summary>
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {rest.map((a) => (
                  <Row key={a.id} a={a} colorIndex={colorIndexById.get(a.profile_id) ?? 0} today={today} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
