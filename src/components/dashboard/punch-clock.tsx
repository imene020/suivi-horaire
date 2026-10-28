"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogIn, LogOut, Coffee, Play, Building2, Home, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TimeEntry, WorkMode } from "@/lib/types";
import { DAY_TYPE_LABELS } from "@/lib/constants";
import { NON_WORKING_DAY_TYPES, timeToMinutes } from "@/lib/hours";
import { cn, formatHours } from "@/lib/utils";
import { nowHHMM } from "@/lib/date";
import {
  punchInAction,
  punchOutAction,
  startBreakAction,
  endBreakAction,
  setWorkModeAction,
} from "@/lib/actions/punch";

type Mode = Exclude<WorkMode, null>;
type Phase = "off" | "idle" | "working" | "break" | "done";

const PHASE: Record<Phase, { label: string; dot: string; pill: string }> = {
  idle: { label: "Pas encore pointé", dot: "bg-slate-400", pill: "bg-slate-100 text-slate-600" },
  working: { label: "Au travail", dot: "bg-sea-500 live-dot", pill: "bg-sea-50 text-sea-700" },
  break: { label: "En pause", dot: "bg-amber-400", pill: "bg-amber-50 text-amber-800" },
  done: { label: "Journée terminée", dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700" },
  off: { label: "Journée non travaillée", dot: "bg-slate-300", pill: "bg-slate-100 text-slate-600" },
};

/** Anneau de progression : heures faites aujourd'hui / heures prévues. */
function DayRing({ worked, standard }: { worked: number; standard: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const pct = standard > 0 ? Math.min(1, worked / standard) : 0;
  const done = standard > 0 && worked >= standard;
  return (
    <div className="relative h-28 w-28 shrink-0" role="img" aria-label={`${formatHours(worked)} travaillées sur ${formatHours(standard)} prévues`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="8" className="stroke-slate-100" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className={cn("transition-[stroke-dashoffset] duration-700", done ? "stroke-emerald-500" : "stroke-sea-500")}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-semibold text-slate-900 tabular">{formatHours(worked)}</span>
        {standard > 0 && <span className="text-[11px] text-slate-500 tabular">sur {formatHours(standard)}</span>}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-800 tabular">{value}</p>
    </div>
  );
}

export function PunchClock({ todayEntry, standardHours = 0 }: { todayEntry: TimeEntry | null; standardHours?: number }) {
  const router = useRouter();
  const [now, setNow] = React.useState<Date | null>(null);
  const [mode, setMode] = React.useState<Mode>(todayEntry?.work_mode ?? "presentiel");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only Date, avoids SSR hydration mismatch
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 1000 * 15);
    return () => clearInterval(interval);
  }, []);

  const startTime = todayEntry?.start_time?.slice(0, 5) ?? null;
  const endTime = todayEntry?.end_time?.slice(0, 5) ?? null;
  const breakStart = todayEntry?.break_start?.slice(0, 5) ?? null;
  const breakMinutes = todayEntry?.break_minutes ?? 0;
  const isNonWorkingDay = !!todayEntry && NON_WORKING_DAY_TYPES.includes(todayEntry.day_type);
  const isWorkDay = !todayEntry || todayEntry.day_type === "normal" || isNonWorkingDay;
  const started = !!startTime;
  const finished = !!startTime && !!endTime;
  const onBreak = started && !finished && !!breakStart;
  const phase: Phase = !isWorkDay ? "off" : !started ? "idle" : finished ? "done" : onBreak ? "break" : "working";

  // Heure murale de l'entreprise (Africa/Tunis), pas celle de l'appareil.
  const clock = now ? nowHHMM(now) : "--:--";
  const nowMin = now ? timeToMinutes(clock) : null;

  // Temps travaillé aujourd'hui, mis à jour en direct pendant la journée.
  let workedMin = 0;
  if (startTime && (endTime || nowMin !== null)) {
    const end = endTime ? timeToMinutes(endTime) : nowMin!;
    const ongoingBreak = onBreak && breakStart && nowMin !== null ? Math.max(0, nowMin - timeToMinutes(breakStart)) : 0;
    workedMin = Math.max(0, end - timeToMinutes(startTime) - breakMinutes - ongoingBreak);
  }

  async function run(action: () => Promise<{ error?: string }>) {
    setPending(true);
    setError(null);
    const res = await action();
    setPending(false);
    if (res?.error) setError(res.error);
    else router.refresh();
  }

  async function changeMode(next: Mode) {
    setMode(next);
    if (started && !finished) await run(() => setWorkModeAction(next));
  }

  const detail =
    phase === "off"
      ? todayEntry?.day_type === "maladie"
        ? "Arrêt maladie aujourd'hui : prenez soin de vous."
        : "En congé aujourd'hui : bon repos !"
      : phase === "idle"
        ? "Pointez votre arrivée dès que vous commencez."
        : phase === "break"
          ? `En pause depuis ${breakStart}.${breakStart && breakStart >= "11:30" && breakStart <= "14:30" ? " Bon appétit !" : ""}`
          : phase === "done"
            ? "Bonne soirée, à demain."
            : mode === "teletravail"
              ? "En télétravail aujourd'hui."
              : "Au bureau aujourd'hui.";

  const p = PHASE[phase];

  return (
    <Card className="overflow-hidden">
      {isNonWorkingDay && todayEntry && (
        <div className="flex items-start gap-2 border-b border-violet-100 bg-violet-50 px-4 py-2.5 text-xs text-violet-800 md:px-6">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Aujourd&apos;hui est un jour <strong>{DAY_TYPE_LABELS[todayEntry.day_type].toLowerCase()}</strong>
            {todayEntry.tasks ? ` (${todayEntry.tasks})` : ""}. Vous n&apos;êtes pas tenu de travailler ; si vous pointez,
            les heures effectuées seront automatiquement comptabilisées.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-center sm:justify-between md:p-6">
        <div className="min-w-0 space-y-3">
          <span className={cn("inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold", p.pill)}>
            <span className={cn("h-2 w-2 rounded-full", p.dot)} aria-hidden="true" />
            {p.label}
          </span>
          <div>
            <p className="text-5xl font-semibold tracking-tight text-slate-900 tabular md:text-6xl" aria-label="Heure actuelle">
              {clock}
            </p>
            <p className="mt-1 text-sm text-slate-500">{detail}</p>
          </div>
          {started && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
              <Fact label="Arrivée" value={startTime!} />
              <Fact label="Pause" value={`${breakMinutes + (onBreak && breakStart && nowMin !== null ? Math.max(0, nowMin - timeToMinutes(breakStart)) : 0)} min`} />
              <Fact label="Départ" value={endTime ?? "—"} />
            </div>
          )}
        </div>
        {isWorkDay && <DayRing worked={workedMin / 60} standard={standardHours} />}
      </div>

      {isWorkDay && !finished && (
        <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div className="flex flex-wrap gap-2">
            {!started && (
              <Button variant="accent" size="lg" onClick={() => run(() => punchInAction(mode))} disabled={pending}>
                <LogIn className="h-4 w-4" /> Pointer l&apos;arrivée
              </Button>
            )}
            {started && !onBreak && (
              <Button variant="outline" onClick={() => run(startBreakAction)} disabled={pending}>
                <Coffee className="h-4 w-4" /> Début de pause
              </Button>
            )}
            {onBreak && (
              <Button variant="accent" onClick={() => run(endBreakAction)} disabled={pending}>
                <Play className="h-4 w-4" /> Reprendre le travail
              </Button>
            )}
            {started && (
              <Button onClick={() => run(punchOutAction)} disabled={pending}>
                <LogOut className="h-4 w-4" /> Pointer le départ
              </Button>
            )}
          </div>
          <div className="inline-flex self-start rounded-lg border border-slate-200 bg-white p-0.5 sm:self-auto">
            <ModeButton active={mode === "presentiel"} onClick={() => changeMode("presentiel")} disabled={pending}>
              <Building2 className="h-3.5 w-3.5" /> Présentiel
            </ModeButton>
            <ModeButton active={mode === "teletravail"} onClick={() => changeMode("teletravail")} disabled={pending}>
              <Home className="h-3.5 w-3.5" /> Télétravail
            </ModeButton>
          </div>
        </div>
      )}

      {error && <p className="mx-4 mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 md:mx-6">{error}</p>}
    </Card>
  );
}

function ModeButton({
  active,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-steel-700 text-white shadow-sm" : "text-slate-500 hover:text-slate-800",
        props.disabled && "opacity-60"
      )}
      {...props}
    >
      {children}
    </button>
  );
}
