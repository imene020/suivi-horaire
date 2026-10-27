"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Clock, CheckCircle2, LogIn, LogOut, Coffee, Play, Building2, Home, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TimeEntry, WorkMode } from "@/lib/types";
import { DAY_TYPE_LABELS } from "@/lib/constants";
import { NON_WORKING_DAY_TYPES } from "@/lib/hours";
import { cn } from "@/lib/utils";
import { APP_TIME_ZONE } from "@/lib/date";
import {
  punchInAction,
  punchOutAction,
  startBreakAction,
  endBreakAction,
  setWorkModeAction,
} from "@/lib/actions/punch";

type Mode = Exclude<WorkMode, null>;

export function PunchClock({ todayEntry }: { todayEntry: TimeEntry | null }) {
  const router = useRouter();
  const [now, setNow] = React.useState<Date | null>(null);
  const [mode, setMode] = React.useState<Mode>(todayEntry?.work_mode ?? "presentiel");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only Date, avoids SSR hydration mismatch
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 1000 * 30);
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

  const status = !isWorkDay
    ? "Journée non travaillée (congé, maladie)"
    : !started
      ? "Non pointé aujourd'hui"
      : finished
        ? `${startTime} → ${endTime} · pause ${breakMinutes} min`
        : onBreak
          ? `Arrivé à ${startTime} · en pause depuis ${breakStart}`
          : `Arrivé à ${startTime} · pause cumulée ${breakMinutes} min`;

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        {isNonWorkingDay && todayEntry && (
          <div className="flex items-start gap-2 rounded-lg bg-purple-50 text-purple-800 px-3 py-2 text-xs">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              Aujourd&apos;hui est un jour <strong>{DAY_TYPE_LABELS[todayEntry.day_type].toLowerCase()}</strong>
              {todayEntry.tasks ? ` (${todayEntry.tasks})` : ""}. Vous n&apos;êtes pas tenu de travailler ; si vous
              pointez, les heures effectuées seront automatiquement comptabilisées dans vos heures payées.
            </p>
          </div>
        )}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "h-11 w-11 rounded-full flex items-center justify-center shadow-md shadow-[#545454]/20",
                onBreak
                  ? "bg-gradient-to-br from-amber-400 to-orange-500"
                  : "bg-gradient-to-br from-[#b0abaa] to-[#736d6c]"
              )}
            >
              {finished ? (
                <CheckCircle2 className="h-5 w-5 text-white" />
              ) : onBreak ? (
                <Coffee className="h-5 w-5 text-white" />
              ) : (
                <Clock className="h-5 w-5 text-white" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">
                {now?.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: APP_TIME_ZONE }) ?? "--:--"}
              </p>
              <p className="text-xs text-slate-500">{status}</p>
            </div>
          </div>

          {isWorkDay && !finished && (
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
              <ModeButton active={mode === "presentiel"} onClick={() => changeMode("presentiel")} disabled={pending}>
                <Building2 className="h-3.5 w-3.5" /> Présentiel
              </ModeButton>
              <ModeButton active={mode === "teletravail"} onClick={() => changeMode("teletravail")} disabled={pending}>
                <Home className="h-3.5 w-3.5" /> Télétravail
              </ModeButton>
            </div>
          )}
        </div>

        {isWorkDay && !finished && (
          <div className="flex flex-wrap gap-2">
            {!started && (
              <Button onClick={() => run(() => punchInAction(mode))} disabled={pending}>
                <LogIn className="h-4 w-4" /> Pointer l&apos;arrivée
              </Button>
            )}
            {started && !onBreak && (
              <Button variant="outline" onClick={() => run(startBreakAction)} disabled={pending}>
                <Coffee className="h-4 w-4" /> Début de pause
              </Button>
            )}
            {onBreak && (
              <Button onClick={() => run(endBreakAction)} disabled={pending}>
                <Play className="h-4 w-4" /> Reprendre le travail
              </Button>
            )}
            {started && (
              <Button variant="destructive" onClick={() => run(punchOutAction)} disabled={pending}>
                <LogOut className="h-4 w-4" /> Pointer le départ
              </Button>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>}
      </CardContent>
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
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-white text-[#545454] shadow-sm" : "text-slate-500 hover:text-slate-700",
        props.disabled && "opacity-60"
      )}
      {...props}
    >
      {children}
    </button>
  );
}
