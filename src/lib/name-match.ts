/** Rapprochement tolérant d'un nom écrit à la main ("FATMA zalila", "Zalila F.") avec un compte. */

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Trouve l'employé correspondant à un nom libre : égalité (dans n'importe quel ordre des mots),
 * puis inclusion, puis tous les mots écrits présents dans le nom complet (initiales comprises).
 * Renvoie null si aucun ou plusieurs employés correspondent (ambigu : mieux vaut demander).
 */
export function matchEmployeeByName<T extends { full_name: string }>(employees: T[], name: string): T | null {
  const target = normalizeName(name);
  if (!target) return null;
  const targetWords = target.split(" ");
  const sorted = (s: string) => s.split(" ").sort().join(" ");

  const exact = employees.filter((e) => sorted(normalizeName(e.full_name)) === sorted(target));
  if (exact.length === 1) return exact[0];

  const contained = employees.filter((e) => {
    const n = normalizeName(e.full_name);
    return n.includes(target) || target.includes(n);
  });
  if (contained.length === 1) return contained[0];

  const byWords = employees.filter((e) => {
    const words = normalizeName(e.full_name).split(" ");
    return targetWords.every((w) => words.some((x) => x === w || (w.length === 1 && x.startsWith(w))));
  });
  return byWords.length === 1 ? byWords[0] : null;
}
