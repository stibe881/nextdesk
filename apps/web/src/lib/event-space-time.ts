export type EventSpaceRecurrence = "none" | "weekly" | "monthly";

type SwissWallParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const SWISS_TIME_ZONE = "Europe/Zurich";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function swissParts(date: Date): SwissWallParts {
  const values = new Intl.DateTimeFormat("en-GB", {
    timeZone: SWISS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function swissWallValueFromParts(parts: SwissWallParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function parseWallValue(value: string): SwissWallParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const candidate = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month! - 1 ||
    candidate.getUTCDate() !== day ||
    hour! > 23 ||
    minute! > 59
  ) {
    return null;
  }
  return {
    year: year!,
    month: month!,
    day: day!,
    hour: hour!,
    minute: minute!,
  };
}

/** Converts a Swiss wall-clock value from datetime-local to an unambiguous instant. */
export function swissWallTimeToInstant(value: string): Date | null {
  const parts = parseWallValue(value);
  if (!parts) return null;
  const target = swissWallValueFromParts(parts);
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  const matches = Array.from(
    { length: 7 },
    (_, index) => new Date(utcGuess + (index - 3) * 60 * 60 * 1000),
  ).filter((candidate) => swissWallValue(candidate) === target);
  // The one repeated hour at the end of summer time is resolved to the first
  // matching instant. Nonexistent local times are rejected instead of shifted.
  return matches[0] ?? null;
}

export function swissWallValue(date: Date): string {
  return swissWallValueFromParts(swissParts(date));
}

function addSwissWallOccurrence(
  value: string,
  recurrence: EventSpaceRecurrence,
  index: number,
): string | null {
  const parts = parseWallValue(value);
  if (!parts) return null;
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute),
  );
  if (recurrence === "weekly") date.setUTCDate(date.getUTCDate() + index * 7);
  if (recurrence === "monthly") {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + index);
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(parts.day, lastDay));
  }
  return swissWallValueFromParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  });
}

export function swissEventSpaceOccurrences(input: {
  startsAt: string;
  endsAt: string;
  recurrence: EventSpaceRecurrence;
  count: number;
}): Array<{ startsAt: string; endsAt: string }> | null {
  if (
    !Number.isInteger(input.count) ||
    input.count < 1 ||
    input.count > 52 ||
    (input.recurrence === "none" && input.count !== 1) ||
    (input.recurrence !== "none" && input.count < 2)
  ) {
    return null;
  }
  const occurrences = Array.from({ length: input.count }, (_, index) => {
    const startsAt = addSwissWallOccurrence(
      input.startsAt,
      input.recurrence,
      index,
    );
    const endsAt = addSwissWallOccurrence(
      input.endsAt,
      input.recurrence,
      index,
    );
    const start = startsAt ? swissWallTimeToInstant(startsAt) : null;
    const end = endsAt ? swissWallTimeToInstant(endsAt) : null;
    return start && end && end > start
      ? { startsAt: start.toISOString(), endsAt: end.toISOString() }
      : null;
  });
  return occurrences.every((occurrence) => occurrence !== null)
    ? (occurrences as Array<{ startsAt: string; endsAt: string }>)
    : null;
}
