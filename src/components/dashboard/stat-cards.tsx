import { Clock3, Palmtree, HeartPulse, Wallet, Target } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatHours } from "@/lib/utils";
import { cn } from "@/lib/utils";

type IconType = React.ComponentType<{ className?: string }>;

/** Carte de chiffre clé : pastille d'icône, intitulé, valeur, puis un complément (barre, aide). */
function StatShell({
  icon: Icon,
  tone = "steel",
  title,
  children,
}: {
  icon: IconType;
  tone?: "steel" | "sea" | "violet" | "rose";
  title: string;
  children: React.ReactNode;
}) {
  const chip = {
    steel: "bg-steel-100 text-steel-600",
    sea: "bg-sea-50 text-sea-600",
    violet: "bg-violet-50 text-violet-600",
    rose: "bg-rose-50 text-rose-600",
  }[tone];
  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5">
      <div className="flex items-center gap-2.5">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", chip)}>
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-medium text-slate-500">{title}</h3>
      </div>
      {children}
    </Card>
  );
}

function Bar({ pct, className }: { pct: number; className: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cn("h-full rounded-full transition-all", className)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function HoursCard({ title, hours, target }: { title: string; hours: number; target?: number }) {
  if (target === undefined || target <= 0) {
    return (
      <StatShell icon={Clock3} tone="sea" title={title}>
        <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular">{formatHours(hours)}</p>
      </StatShell>
    );
  }
  const reached = hours >= target;
  return (
    <StatShell icon={Target} tone="sea" title={title}>
      <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular">
        {formatHours(hours)} <span className="text-sm font-normal text-slate-400">/ {formatHours(target)}</span>
      </p>
      <Bar pct={(hours / target) * 100} className={reached ? "bg-emerald-500" : "bg-gradient-to-r from-sea-400 to-sea-600"} />
      {/* En cours de semaine, ce qui reste à faire n'est pas un "retard" : formulation neutre. */}
      <p className={cn("text-xs tabular", reached ? "font-medium text-emerald-700" : "text-slate-500")}>
        {reached ? `Objectif atteint (+${formatHours(hours - target)})` : `Encore ${formatHours(target - hours)} pour l'objectif`}
      </p>
    </StatShell>
  );
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("fr-TN", { style: "currency", currency: "TND", maximumFractionDigits: 3 }).format(amount);
}

export function MoneyCard({ title, amount, hint }: { title: string; amount: number; hint?: string }) {
  return (
    <StatShell icon={Wallet} title={title}>
      <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular">{formatMoney(amount)}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </StatShell>
  );
}

/** Jours au format français : "1,5 j", "2 j". */
function fmtDays(n: number): string {
  return `${(Math.round(n * 10) / 10).toLocaleString("fr-FR")} j`;
}

export function LeaveCard({
  title,
  total,
  used,
  hint,
}: {
  title: string;
  total: number;
  used: number;
  hint?: string;
}) {
  const remaining = Math.round((total - used) * 100) / 100;
  const pct = total > 0 ? (used / total) * 100 : 0;
  const sick = /maladie/i.test(title);
  return (
    <StatShell icon={sick ? HeartPulse : Palmtree} tone={sick ? "rose" : "violet"} title={title}>
      <div className="flex items-baseline justify-between gap-2">
        <p className={cn("text-2xl font-semibold tracking-tight text-slate-900 tabular", remaining < 0 && "text-red-600")}>
          {fmtDays(remaining)} <span className="text-sm font-normal text-slate-400">restant{Math.abs(remaining) >= 2 ? "s" : ""}</span>
        </p>
        <span className="text-xs text-slate-500 tabular">
          {fmtDays(used)} / {fmtDays(total)}
        </span>
      </div>
      <Bar pct={pct} className={remaining < 0 ? "bg-red-500" : sick ? "bg-rose-400" : "bg-violet-400"} />
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </StatShell>
  );
}
