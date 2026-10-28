import Link from "next/link";
import { listEmployees, getAllEntriesInRange, countPendingLeaveRequests } from "@/lib/queries";
import { getSessionProfile } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { PageGreeting, firstNameOf } from "@/components/ui/page-greeting";
import { AnomaliesPanel } from "@/components/admin/anomalies-panel";
import { PresenceToday, PresenceRow } from "@/components/admin/presence-today";
import { getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { sumHours } from "@/lib/hours";
import { detectAnomalies, shiftDate } from "@/lib/anomalies";
import { presenceFor } from "@/lib/presence";
import { MONTH_NAMES_FR } from "@/lib/constants";
import { formatHours, cn } from "@/lib/utils";
import { ArrowRight, Download, Inbox, Users, Clock3, CalendarOff } from "lucide-react";

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone = "steel",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "steel" | "sea" | "amber";
}) {
  const chip = {
    steel: "bg-steel-100 text-steel-600",
    sea: "bg-sea-50 text-sea-600",
    amber: "bg-amber-100 text-amber-700",
  }[tone];
  return (
    <div className="flex items-start gap-3 p-4 md:p-5">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", chip)}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900 tabular">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

export default async function AdminOverviewPage() {
  const now = nowInAppTimeZone();
  const { start: monthStart, end: monthEnd } = getMonthRange(now.year, now.month);
  const windowStart = shiftDate(now.date, -30);

  const [me, employees, entries, pendingRequests] = await Promise.all([
    getSessionProfile(),
    listEmployees(),
    // Une seule requête couvre le mois en cours et les 30 jours analysés par "Points à vérifier".
    getAllEntriesInRange(windowStart < monthStart ? windowStart : monthStart, monthEnd),
    countPendingLeaveRequests(),
  ]);

  const active = employees.filter((e) => e.active);
  const colorIndexById = new Map(employees.map((e, i) => [e.id, i]));
  const monthEntries = entries.filter((e) => e.entry_date >= monthStart && e.entry_date <= monthEnd);
  const todayByProfile = new Map(entries.filter((e) => e.entry_date === now.date).map((e) => [e.profile_id, e]));

  const presence: PresenceRow[] = active.map((e) => ({
    id: e.id,
    full_name: e.full_name,
    colorIndex: colorIndexById.get(e.id) ?? 0,
    presence: presenceFor(todayByProfile.get(e.id), now.date, e.weekday_hours),
  }));
  const anomalies = detectAnomalies(active, entries, { today: now.date });

  const onLeaveToday = presence.filter((p) => ["leave", "sick"].includes(p.presence.status)).length;
  const hereNow = presence.filter((p) => ["working", "break"].includes(p.presence.status)).length;
  const toFix = anomalies.filter((a) => a.severity === "high").length;

  const summary = [
    `${hereNow} personne${hereNow > 1 ? "s" : ""} au travail en ce moment`,
    anomalies.length > 0
      ? `${anomalies.length} point${anomalies.length > 1 ? "s" : ""} à vérifier${toFix > 0 ? `, dont ${toFix} à corriger` : ""}`
      : "aucun point à vérifier",
  ].join(" · ");

  return (
    <div className="space-y-6 max-w-6xl">
      <PageGreeting firstName={firstNameOf(me?.full_name ?? "")} subtitle={summary}>
        <a
          href={`/api/exports/payroll?year=${now.year}&month=${now.month}`}
          className={buttonVariants({ variant: "outline" })}
        >
          <Download className="h-4 w-4" /> Exporter la paie de {MONTH_NAMES_FR[now.month].toLowerCase()}
        </a>
      </PageGreeting>

      <Card className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <Link
          href="/admin/leave-requests"
          className={cn(
            "rounded-t-2xl transition-colors hover:bg-slate-50 sm:rounded-tr-none lg:rounded-l-2xl",
            pendingRequests > 0 && "bg-amber-50/50 hover:bg-amber-50"
          )}
        >
          <Kpi
            icon={Inbox}
            label="Demandes en attente"
            value={pendingRequests}
            hint={pendingRequests > 0 ? "À traiter" : "Tout est traité"}
            tone={pendingRequests > 0 ? "amber" : "steel"}
          />
        </Link>
        <Kpi icon={Users} label="Employés actifs" value={active.length} />
        <Kpi
          icon={Clock3}
          label={`Heures de ${MONTH_NAMES_FR[now.month].toLowerCase()}`}
          value={formatHours(sumHours(monthEntries))}
          tone="sea"
        />
        <Kpi icon={CalendarOff} label="Absents aujourd'hui" value={onLeaveToday} hint="Congé ou maladie" />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <AnomaliesPanel anomalies={anomalies} colorIndexById={colorIndexById} today={now.date} />
        <PresenceToday rows={presence} />
      </div>

      <Link
        href="/admin/employees"
        className="inline-flex items-center gap-2 text-sm font-medium text-sea-600 hover:text-sea-700"
      >
        Gérer les employés <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
