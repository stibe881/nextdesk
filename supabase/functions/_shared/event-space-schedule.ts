export const EVENT_SPACE_EQUIPMENT = [
  "projector",
  "connections",
  "display",
  "audio",
  "videocall",
  "microphones",
  "screen",
  "reception_laptop",
] as const;

export type EventSpaceEquipment = (typeof EVENT_SPACE_EQUIPMENT)[number];
export type EventSpaceRecurrence = "none" | "weekly" | "monthly";
export type EventSpaceOccurrence = {
  startsAt: string;
  endsAt: string;
};

export const MAX_EVENT_SPACE_OCCURRENCES = 52;
export const MAX_EVENT_SPACE_MONTHLY_OCCURRENCES = 12;
const MIN_DURATION_MS = 15 * 60 * 1000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const RECURRENCE_TIME_ZONE = "Europe/Zurich";

type CalendarParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const recurrenceDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: RECURRENCE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function validText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    !value.includes("\u0000") &&
    value.isWellFormed()
  );
}

function canonicalInstant(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length < 20 ||
    value.length > 40 ||
    !value.includes("T") ||
    !value.isWellFormed()
  ) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function calendarParts(value: string): CalendarParts {
  const byName = new Map(
    recurrenceDateFormatter
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: byName.get("year") ?? 0,
    month: byName.get("month") ?? 0,
    day: byName.get("day") ?? 0,
    hour: byName.get("hour") ?? 0,
    minute: byName.get("minute") ?? 0,
    second: byName.get("second") ?? 0,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function sameTime(first: CalendarParts, second: CalendarParts): boolean {
  return (
    first.hour === second.hour &&
    first.minute === second.minute &&
    first.second === second.second
  );
}

function hasExpectedRecurrence(
  first: CalendarParts,
  current: CalendarParts,
  occurrenceIndex: number,
  recurrence: Exclude<EventSpaceRecurrence, "none">,
): boolean {
  if (!sameTime(first, current)) return false;
  if (recurrence === "weekly") {
    const firstDay = Date.UTC(first.year, first.month - 1, first.day);
    const currentDay = Date.UTC(current.year, current.month - 1, current.day);
    return currentDay - firstDay === occurrenceIndex * 7 * 24 * 60 * 60 * 1000;
  }
  const absoluteMonth = first.year * 12 + (first.month - 1) + occurrenceIndex;
  const expectedYear = Math.floor(absoluteMonth / 12);
  const expectedMonth = (absoluteMonth % 12) + 1;
  return (
    current.year === expectedYear &&
    current.month === expectedMonth &&
    current.day ===
      Math.min(first.day, daysInMonth(expectedYear, expectedMonth))
  );
}

export function parseEventSpaceOccurrences(
  value: unknown,
  recurrence: EventSpaceRecurrence,
): EventSpaceOccurrence[] | null {
  const maximumOccurrences =
    recurrence === "monthly"
      ? MAX_EVENT_SPACE_MONTHLY_OCCURRENCES
      : MAX_EVENT_SPACE_OCCURRENCES;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > maximumOccurrences
  ) {
    return null;
  }
  if (recurrence === "none" && value.length !== 1) return null;
  if (recurrence !== "none" && value.length < 2) return null;

  let previousStart = -Infinity;
  const normalized: EventSpaceOccurrence[] = [];
  let firstStart: CalendarParts | null = null;
  let firstDuration: number | null = null;
  for (const [index, occurrence] of value.entries()) {
    if (
      typeof occurrence !== "object" ||
      occurrence === null ||
      Array.isArray(occurrence)
    ) {
      return null;
    }
    const startsAt = canonicalInstant(
      (occurrence as Record<string, unknown>).startsAt,
    );
    const endsAt = canonicalInstant(
      (occurrence as Record<string, unknown>).endsAt,
    );
    if (!startsAt || !endsAt) return null;
    const startMs = Date.parse(startsAt);
    const endMs = Date.parse(endsAt);
    const duration = endMs - startMs;
    if (
      duration < MIN_DURATION_MS ||
      duration > MAX_DURATION_MS ||
      startMs <= previousStart
    ) {
      return null;
    }
    if (index === 0) {
      firstStart = calendarParts(startsAt);
      firstDuration = duration;
    } else if (
      recurrence !== "none" &&
      (!firstStart ||
        firstDuration === null ||
        duration !== firstDuration ||
        !hasExpectedRecurrence(
          firstStart,
          calendarParts(startsAt),
          index,
          recurrence,
        ))
    ) {
      return null;
    }
    previousStart = startMs;
    normalized.push({ startsAt, endsAt });
  }
  return normalized;
}

export function parseEventSpaceEquipment(
  value: unknown,
): EventSpaceEquipment[] | null {
  if (!Array.isArray(value) || value.length > EVENT_SPACE_EQUIPMENT.length) {
    return null;
  }
  const unique = new Set<EventSpaceEquipment>();
  for (const item of value) {
    if (
      !validText(item) ||
      !EVENT_SPACE_EQUIPMENT.includes(item as EventSpaceEquipment)
    ) {
      return null;
    }
    unique.add(item as EventSpaceEquipment);
  }
  return [...unique];
}

export function overlaps(
  first: EventSpaceOccurrence,
  second: EventSpaceOccurrence,
): boolean {
  return (
    Date.parse(first.startsAt) < Date.parse(second.endsAt) &&
    Date.parse(first.endsAt) > Date.parse(second.startsAt)
  );
}

export type EventSpaceConflictSummary = {
  hasConflicts: boolean;
  roomConflictCount: number;
  equipmentConflictCount: number;
};

function stableConflictIds(ids: Iterable<string>): string {
  return [...new Set(ids)].sort().join(",");
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Opaque to the browser: it contains no foreign request contents, but binds a
 * confirmation to precisely the room and equipment conflicts that were shown.
 */
export async function eventSpaceConflictSnapshot(input: {
  equipmentConflictingRequestIds: Iterable<string>;
  roomConflictingRequestIds: Iterable<string>;
}): Promise<string> {
  const [room, equipment] = await Promise.all([
    sha256(stableConflictIds(input.roomConflictingRequestIds)),
    sha256(stableConflictIds(input.equipmentConflictingRequestIds)),
  ]);
  return `${room}.${equipment}`;
}

export function isEventSpaceConflictSnapshot(value: unknown): value is string {
  return (
    typeof value === "string" && /^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value)
  );
}

export function summarizeEventSpaceConflicts(input: {
  equipmentConflictingRequestIds: Iterable<string>;
  roomConflictingRequestIds: Iterable<string>;
}): EventSpaceConflictSummary {
  const roomConflictCount = new Set(input.roomConflictingRequestIds).size;
  const equipmentConflictCount = new Set(input.equipmentConflictingRequestIds)
    .size;
  return {
    hasConflicts: roomConflictCount > 0 || equipmentConflictCount > 0,
    roomConflictCount,
    equipmentConflictCount,
  };
}
