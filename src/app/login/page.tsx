"use client";

import { useActionState, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signIn } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { nowInAppTimeZone } from "@/lib/date";

/** Heure de Tunis en direct (rendue côté client uniquement, pour éviter un écart d'hydratation). */
function useTunisClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only Date
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  if (!now) return { time: "--:--", date: "" };
  const { date, time } = nowInAppTimeZone(now);
  const label = new Date(date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return { time, date: label };
}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, null);
  const clock = useTunisClock();

  return (
    <div className="grid min-h-screen bg-steel-50 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Panneau d'identité : la porte bleue de Sidi Bou Saïd, avec l'heure de Tunis. */}
      <aside className="hidden items-center justify-center bg-white p-12 lg:flex" aria-hidden="true">
        <div className="relative flex aspect-[3/4] w-full max-w-md flex-col justify-end overflow-hidden rounded-t-full bg-gradient-to-b from-sea-500 to-sea-800 p-10 text-white shadow-2xl shadow-sea-900/25">
          <div
            className="absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage: "radial-gradient(circle, #ffffff 1.6px, transparent 2px)",
              backgroundSize: "28px 28px",
              maskImage: "linear-gradient(to bottom, black 0%, black 55%, transparent 85%)",
            }}
          />
          <div className="absolute inset-x-10 top-10 bottom-[45%] rounded-t-full border-2 border-white/25" />
          <div className="relative space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sea-100">Tunis · {clock.date}</p>
            <p className="text-7xl font-semibold tracking-tight tabular">{clock.time}</p>
            <p className="max-w-xs text-sm leading-relaxed text-sea-100">
              Pointage, congés et paie : toute l&apos;équipe au même endroit.
            </p>
          </div>
        </div>
      </aside>

      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center">
            <Image src="/logo.png" alt="ELENI Consulting" width={220} height={76} className="mb-6 object-contain" priority />
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Bienvenue</h1>
            <p className="mt-1 text-sm text-slate-500">Connectez-vous à votre espace Suivi Horaire</p>
            <p className="mt-2 text-xs text-steel-500 tabular lg:hidden">Il est {clock.time} à Tunis</p>
          </div>

          <form
            action={formAction}
            className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-7"
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required placeholder="vous@entreprise.com" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Mot de passe</Label>
                <Link href="/forgot-password" className="text-xs text-sea-600 hover:underline">
                  Mot de passe oublié ?
                </Link>
              </div>
              <Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
            </div>

            {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>}

            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? "Connexion..." : "Se connecter"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
