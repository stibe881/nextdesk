// Kaderstufen (1 = höchste Stufe). 0 bedeutet «kein Kader».
// Same rules as the SQL functions in 0251_shop_cadre_visibility.sql.

export const CADRE_LEVELS = [1, 2, 3] as const;
export type CadreLevel = 0 | 1 | 2 | 3;

export function cadreTitleKey(title: unknown): string | null {
  if (typeof title !== "string") return null;
  const key = title.trim().toLowerCase();
  return key.length > 0 ? key : null;
}

export function isCadreLevel(value: unknown): value is CadreLevel {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/**
 * Levels an article is visible for. Empty = everybody. Returns null for
 * invalid input (unknown level, not an array).
 */
export function parseVisibleCadreLevels(value: unknown): number[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const levels = new Set<number>();
  for (const entry of value) {
    if (entry !== 1 && entry !== 2 && entry !== 3) return null;
    levels.add(entry);
  }
  return [...levels].sort((a, b) => a - b);
}

export function cleanStoredLevels(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((level): level is number => [1, 2, 3].includes(level))
    : [];
}

export function visibleForCadre(
  visibleLevels: readonly number[],
  level: number,
): boolean {
  return visibleLevels.length === 0 || visibleLevels.includes(level);
}

export type CadreRules = {
  /** job title key → level */
  titles: Map<string, number>;
  /** user id → manually set level (0–3) */
  overrides: Map<string, number>;
};

export function cadreLevelOf(
  rules: CadreRules,
  userId: string | null,
  jobTitle: unknown,
): CadreLevel {
  if (userId) {
    const manual = rules.overrides.get(userId);
    if (isCadreLevel(manual)) return manual;
  }
  const key = cadreTitleKey(jobTitle);
  const level = key ? rules.titles.get(key) : undefined;
  return isCadreLevel(level) ? level : 0;
}

export function cadreLabel(levels: readonly number[]): string {
  return levels.length === 0
    ? "Alle"
    : levels.map((level) => `Kaderstufe ${level}`).join(", ");
}
