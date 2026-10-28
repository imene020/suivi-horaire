import { cn } from "@/lib/utils";
import { employeeColor } from "@/lib/constants";
import { initials } from "@/lib/presence";

/** Pastille aux initiales, dans la couleur attribuée à l'employé (la même que dans le calendrier). */
export function Avatar({ name, colorIndex, className }: { name: string; colorIndex: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        employeeColor(colorIndex),
        className
      )}
    >
      {initials(name)}
    </span>
  );
}
