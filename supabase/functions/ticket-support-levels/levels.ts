// Pure logic of the support levels (1st/2nd/3rd Level). No I/O, so the
// rules can be tested without a database.

export type SupportLevel = 1 | 2 | 3;
export type LevelChangeKind = "initial" | "escalated" | "returned" | "cleared";
export type HandoverDirection = "escalated" | "returned";

export const SUPPORT_LEVELS: readonly SupportLevel[] = [1, 2, 3];
export const NOTE_MIN_LENGTH = 10;
export const NOTE_MAX_LENGTH = 4000;

export function isSupportLevel(value: unknown): value is SupportLevel {
  return value === 1 || value === 2 || value === 3;
}

export function supportLevelLabel(level: SupportLevel): string {
  return level === 1 ? "1st Level" : level === 2 ? "2nd Level" : "3rd Level";
}

/** Trimmed note or null when it is too short or too long. */
export function normalizeHandoverNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const note = value.replace(/\r\n/g, "\n").trim();
  const length = Array.from(note).length;
  return length >= NOTE_MIN_LENGTH && length <= NOTE_MAX_LENGTH ? note : null;
}

/**
 * Allowed moves: exactly one level up ("An nächste Stufe übergeben") or any
 * lower level ("Zurück an Stufe X"). Skipping a level is not allowed.
 */
export function handoverDirection(
  currentLevel: SupportLevel | null,
  targetLevel: SupportLevel | null,
): HandoverDirection | null {
  if (currentLevel === null || targetLevel === null) return null;
  if (targetLevel === currentLevel + 1) return "escalated";
  if (targetLevel < currentLevel) return "returned";
  return null;
}

export type LevelTeam = {
  id: string;
  name: string;
  departmentId: string;
  supportLevel: SupportLevel | null;
  active: boolean;
};

export type HandoverTargets = {
  next: { level: SupportLevel; teams: { id: string; name: string }[] } | null;
  back: { level: SupportLevel; teams: { id: string; name: string }[] }[];
};

/** Teams of the next level and of each lower level in the same department. */
export function handoverTargets(
  currentLevel: SupportLevel | null,
  departmentId: string,
  teams: readonly LevelTeam[],
): HandoverTargets {
  if (currentLevel === null) return { next: null, back: [] };
  const teamsOf = (level: SupportLevel) =>
    teams
      .filter(
        (team) =>
          team.active &&
          team.departmentId === departmentId &&
          team.supportLevel === level,
      )
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "de-CH"));
  const nextLevel = currentLevel + 1;
  const nextTeams = isSupportLevel(nextLevel) ? teamsOf(nextLevel) : [];
  const back = SUPPORT_LEVELS.filter((level) => level < currentLevel)
    .map((level) => ({ level, teams: teamsOf(level) }))
    .filter((entry) => entry.teams.length > 0)
    .reverse();
  return {
    next:
      isSupportLevel(nextLevel) && nextTeams.length > 0
        ? { level: nextLevel, teams: nextTeams }
        : null,
    back,
  };
}

export type LevelChange = {
  ticketId: string;
  fromLevel: SupportLevel | null;
  toLevel: SupportLevel | null;
  kind: LevelChangeKind;
  createdAt: string;
  note?: string | null;
};

/** Latest handover note that led to the ticket's current level. */
export function currentHandover<T extends LevelChange>(
  changes: readonly T[],
  currentLevel: SupportLevel | null,
): T | null {
  const last = changes.at(-1);
  if (!last || currentLevel === null || last.toLevel !== currentLevel)
    return null;
  return last.note ? last : null;
}

/**
 * Time spent per level, from the ordered history up to endAt (resolution or
 * now). Time before the first recorded level is not counted.
 */
export function levelDurations(
  changes: readonly LevelChange[],
  endAt: string,
): Map<SupportLevel, number> {
  const result = new Map<SupportLevel, number>();
  const end = Date.parse(endAt);
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    if (change.toLevel === null) continue;
    const start = Date.parse(change.createdAt);
    const next = changes[index + 1];
    const stop = Math.min(next ? Date.parse(next.createdAt) : end, end);
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start)
      continue;
    result.set(
      change.toLevel,
      (result.get(change.toLevel) ?? 0) + stop - start,
    );
  }
  return result;
}

/** Highest level a ticket reached; tickets without history count as level 1. */
export function maxLevelReached(
  changes: readonly LevelChange[],
  currentLevel: SupportLevel | null,
): SupportLevel {
  let max: SupportLevel = 1;
  for (const level of [
    currentLevel,
    ...changes.flatMap((change) => [change.fromLevel, change.toLevel]),
  ]) {
    if (level !== null && level > max) max = level;
  }
  return max;
}

export type ReportTicket = {
  id: string;
  departmentId: string;
  categoryId: string | null;
  currentLevel: SupportLevel | null;
  resolvedAt: string | null;
};

export type SupportLevelReport = {
  firstLevelResolution: {
    resolvedTickets: number;
    resolvedAtFirstLevel: number;
    rate: number | null;
  };
  escalations: number;
  returns: number;
  escalationsByCategory: {
    categoryId: string | null;
    categoryName: string;
    escalations: number;
    tickets: number;
  }[];
  averageTimeByLevel: {
    level: SupportLevel;
    label: string;
    averageMinutes: number | null;
    tickets: number;
  }[];
};

/**
 * Report over a period:
 * - first-level resolution: resolved tickets of departments with levels that
 *   never left level 1,
 * - escalations (level up) in the period, grouped by ticket category,
 * - average time per level of the tickets resolved in the period.
 */
export function buildSupportLevelReport(input: {
  range: { startsAt: string; endsAt: string };
  resolvedTickets: readonly ReportTicket[];
  changesByTicket: ReadonlyMap<string, readonly LevelChange[]>;
  periodChanges: readonly (LevelChange & { categoryId: string | null })[];
  leveledDepartmentIds: ReadonlySet<string>;
  categoryNames: ReadonlyMap<string, string>;
}): SupportLevelReport {
  const start = Date.parse(input.range.startsAt);
  const end = Date.parse(input.range.endsAt);
  const inRange = (value: string | null) => {
    if (!value) return false;
    const time = Date.parse(value);
    return Number.isFinite(time) && time >= start && time <= end;
  };

  let resolvedTickets = 0;
  let resolvedAtFirstLevel = 0;
  const totals = new Map<SupportLevel, { ms: number; tickets: number }>();
  for (const ticket of input.resolvedTickets) {
    if (!inRange(ticket.resolvedAt)) continue;
    if (!input.leveledDepartmentIds.has(ticket.departmentId)) continue;
    const changes = input.changesByTicket.get(ticket.id) ?? [];
    resolvedTickets += 1;
    if (maxLevelReached(changes, ticket.currentLevel) === 1)
      resolvedAtFirstLevel += 1;
    for (const [level, ms] of levelDurations(changes, ticket.resolvedAt!)) {
      const entry = totals.get(level) ?? { ms: 0, tickets: 0 };
      entry.ms += ms;
      entry.tickets += 1;
      totals.set(level, entry);
    }
  }

  let escalations = 0;
  let returns = 0;
  const byCategory = new Map<
    string,
    { categoryId: string | null; escalations: number; tickets: Set<string> }
  >();
  for (const change of input.periodChanges) {
    if (!inRange(change.createdAt)) continue;
    if (change.kind === "returned") returns += 1;
    if (change.kind !== "escalated") continue;
    escalations += 1;
    const key = change.categoryId ?? "";
    const entry = byCategory.get(key) ?? {
      categoryId: change.categoryId,
      escalations: 0,
      tickets: new Set<string>(),
    };
    entry.escalations += 1;
    entry.tickets.add(change.ticketId);
    byCategory.set(key, entry);
  }

  return {
    firstLevelResolution: {
      resolvedTickets,
      resolvedAtFirstLevel,
      rate:
        resolvedTickets > 0
          ? Math.round((resolvedAtFirstLevel / resolvedTickets) * 1000) / 1000
          : null,
    },
    escalations,
    returns,
    escalationsByCategory: [...byCategory.values()]
      .map((entry) => ({
        categoryId: entry.categoryId,
        categoryName: entry.categoryId
          ? (input.categoryNames.get(entry.categoryId) ??
            "Unbekannte Kategorie")
          : "Ohne Kategorie",
        escalations: entry.escalations,
        tickets: entry.tickets.size,
      }))
      .sort(
        (a, b) =>
          b.escalations - a.escalations ||
          a.categoryName.localeCompare(b.categoryName, "de-CH"),
      ),
    averageTimeByLevel: SUPPORT_LEVELS.map((level) => {
      const entry = totals.get(level);
      return {
        level,
        label: supportLevelLabel(level),
        averageMinutes:
          entry && entry.tickets > 0
            ? Math.round(entry.ms / entry.tickets / 60_000)
            : null,
        tickets: entry?.tickets ?? 0,
      };
    }),
  };
}
