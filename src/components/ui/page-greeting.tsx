import { nowInAppTimeZone } from "@/lib/date";

/** En-tête de page chaleureux : "Bonjour Amira", la date du jour, et une ligne de contexte. */
export function PageGreeting({
  firstName,
  subtitle,
  children,
}: {
  firstName: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const now = nowInAppTimeZone();
  const hour = Number(now.time.slice(0, 2));
  const hello = hour >= 18 ? "Bonsoir" : "Bonjour";
  const dateLabel = new Date(now.date + "T00:00:00").toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-steel-500">{dateLabel}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 md:text-[28px]">
          {hello} {firstName}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
