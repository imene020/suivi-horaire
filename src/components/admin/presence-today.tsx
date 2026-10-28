import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Presence, PresenceStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";

export interface PresenceRow {
  id: string;
  full_name: string;
  colorIndex: number;
  presence: Presence;
}

const DOT: Record<PresenceStatus, string> = {
  working: "bg-sea-500 live-dot",
  break: "bg-amber-400",
  done: "bg-emerald-500",
  leave: "bg-violet-400",
  sick: "bg-rose-400",
  holiday: "bg-slate-300",
  not_yet: "bg-slate-300",
  day_off: "bg-slate-200",
};

/** Ordre d'affichage : d'abord ceux qui sont là, puis les absents, puis les autres. */
const ORDER: PresenceStatus[] = ["working", "break", "done", "not_yet", "leave", "sick", "holiday", "day_off"];

export function PresenceToday({ rows }: { rows: PresenceRow[] }) {
  const sorted = [...rows].sort(
    (a, b) => ORDER.indexOf(a.presence.status) - ORDER.indexOf(b.presence.status) || a.full_name.localeCompare(b.full_name)
  );
  const here = rows.filter((r) => ["working", "break"].includes(r.presence.status));
  const office = here.filter((r) => !r.presence.remote).length;
  const remote = here.length - office;
  const away = rows.filter((r) => ["leave", "sick"].includes(r.presence.status)).length;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-4 md:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-steel-100 text-steel-600">
          <Users className="h-[18px] w-[18px]" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Présences du jour</h2>
          <p className="text-xs text-slate-500 tabular">
            {office} au bureau · {remote} en télétravail · {away} absent{away > 1 ? "s" : ""}
          </p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-sm text-slate-500">Aucun employé actif pour le moment.</p>
      ) : (
        <ul className="divide-y divide-slate-100 p-2">
          {sorted.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar name={r.full_name} colorIndex={r.colorIndex} className="h-8 w-8 text-[11px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{r.full_name}</p>
                <p className="truncate text-xs text-slate-500">{r.presence.label}</p>
              </div>
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[r.presence.status])} aria-hidden="true" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
