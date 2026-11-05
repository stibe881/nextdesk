/**
 * Recurrence rules for service tasks ("Serviceaufgaben"). Dates are calendar
 * dates (YYYY-MM-DD) in Swiss local time; no time zone arithmetic is needed
 * here. Non-working days are weekends plus Swiss national holidays and the
 * public holidays of the canton of Zug.
 */

export type RecurrenceFrequency =
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "interval";

export type MonthlyMode = "day" | "nth_weekday" | "first_workday" | "last_workday";

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  /** Every n days/weeks/months/years. For "interval": every n days. */
  interval: number;
  /** ISO weekdays 1 (Mo) … 7 (So) for weekly rules. */
  weekdays?: number[];
  monthlyMode?: MonthlyMode;
  /** Day of month for monthly "day" and yearly rules (clamped to month end). */
  dayOfMonth?: number;
  /** 1–4 or -1 (last) for monthly "nth_weekday". */
  nth?: number;
  /** ISO weekday for monthly "nth_weekday". */
  weekday?: number;
  /** Month 1–12 for yearly rules. */
  month?: number;
  /**
   * Daily/weekly: drop non-working days. Monthly "day", yearly and interval:
   * move the date to the next working day.
   */
  skipNonWorkdays: boolean;
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_ITERATIONS = 5_000;

export function parseDate(value: string): Date | null {
  const match = DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: Date): number {
  return ((date.getUTCDay() + 6) % 7) + 1;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Easter Sunday (Gregorian, anonymous algorithm). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const holidayCache = new Map<number, Map<string, string>>();

/** Swiss national holidays plus the public holidays of the canton of Zug. */
export function holidays(year: number): Map<string, string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const easter = easterSunday(year);
  const fixed = (month: number, day: number) =>
    formatDate(new Date(Date.UTC(year, month - 1, day)));
  const result = new Map<string, string>([
    [fixed(1, 1), "Neujahr"],
    [fixed(1, 2), "Berchtoldstag"],
    [formatDate(addDays(easter, -2)), "Karfreitag"],
    [formatDate(addDays(easter, 1)), "Ostermontag"],
    [formatDate(addDays(easter, 39)), "Auffahrt"],
    [formatDate(addDays(easter, 50)), "Pfingstmontag"],
    [formatDate(addDays(easter, 60)), "Fronleichnam"],
    [fixed(8, 1), "Bundesfeiertag"],
    [fixed(8, 15), "Mariä Himmelfahrt"],
    [fixed(11, 1), "Allerheiligen"],
    [fixed(12, 8), "Mariä Empfängnis"],
    [fixed(12, 25), "Weihnachten"],
    [fixed(12, 26), "Stephanstag"],
  ]);
  holidayCache.set(year, result);
  return result;
}

export function holidayName(date: Date): string | null {
  return holidays(date.getUTCFullYear()).get(formatDate(date)) ?? null;
}

export function isWorkday(date: Date): boolean {
  return isoWeekday(date) <= 5 && holidayName(date) === null;
}

function nextWorkday(date: Date): Date {
  let cursor = date;
  for (let guard = 0; guard < 30 && !isWorkday(cursor); guard += 1) {
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

function nthWeekdayOfMonth(
  year: number,
  monthIndex: number,
  nth: number,
  weekday: number,
): Date | null {
  if (nth === -1) {
    let cursor = new Date(
      Date.UTC(year, monthIndex, daysInMonth(year, monthIndex)),
    );
    while (isoWeekday(cursor) !== weekday) cursor = addDays(cursor, -1);
    return cursor;
  }
  let cursor = new Date(Date.UTC(year, monthIndex, 1));
  while (isoWeekday(cursor) !== weekday) cursor = addDays(cursor, 1);
  const result = addDays(cursor, (nth - 1) * 7);
  return result.getUTCMonth() === monthIndex ? result : null;
}

function monthlyDate(
  rule: RecurrenceRule,
  year: number,
  monthIndex: number,
): Date | null {
  switch (rule.monthlyMode ?? "day") {
    case "first_workday":
      return nextWorkday(new Date(Date.UTC(year, monthIndex, 1)));
    case "last_workday": {
      let cursor = new Date(
        Date.UTC(year, monthIndex, daysInMonth(year, monthIndex)),
      );
      for (let guard = 0; guard < 30 && !isWorkday(cursor); guard += 1) {
        cursor = addDays(cursor, -1);
      }
      return cursor;
    }
    case "nth_weekday":
      return nthWeekdayOfMonth(
        year,
        monthIndex,
        rule.nth ?? 1,
        rule.weekday ?? 1,
      );
    case "day":
    default: {
      const day = Math.min(
        rule.dayOfMonth ?? 1,
        daysInMonth(year, monthIndex),
      );
      const date = new Date(Date.UTC(year, monthIndex, day));
      return rule.skipNonWorkdays ? nextWorkday(date) : date;
    }
  }
}

/** Validates and normalises an untrusted rule; returns null when invalid. */
export function normalizeRule(value: unknown): RecurrenceRule | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const integer = (input: unknown, min: number, max: number) =>
    typeof input === "number" &&
    Number.isInteger(input) &&
    input >= min &&
    input <= max
      ? input
      : null;
  const frequency = raw.frequency;
  if (
    frequency !== "daily" &&
    frequency !== "weekly" &&
    frequency !== "monthly" &&
    frequency !== "yearly" &&
    frequency !== "interval"
  ) {
    return null;
  }
  const interval = integer(raw.interval ?? 1, 1, 366);
  if (interval === null || typeof raw.skipNonWorkdays !== "boolean") {
    return null;
  }
  const rule: RecurrenceRule = {
    frequency,
    interval,
    skipNonWorkdays: raw.skipNonWorkdays,
  };
  if (frequency === "weekly") {
    if (!Array.isArray(raw.weekdays) || raw.weekdays.length === 0) return null;
    const weekdays = [...new Set(raw.weekdays)].map((day) =>
      integer(day, 1, 7),
    );
    if (weekdays.some((day) => day === null)) return null;
    rule.weekdays = (weekdays as number[]).sort((a, b) => a - b);
  }
  if (frequency === "monthly") {
    const mode = raw.monthlyMode ?? "day";
    if (
      mode !== "day" &&
      mode !== "nth_weekday" &&
      mode !== "first_workday" &&
      mode !== "last_workday"
    ) {
      return null;
    }
    rule.monthlyMode = mode;
    if (mode === "day") {
      const day = integer(raw.dayOfMonth, 1, 31);
      if (day === null) return null;
      rule.dayOfMonth = day;
    }
    if (mode === "nth_weekday") {
      const nth = raw.nth === -1 ? -1 : integer(raw.nth, 1, 4);
      const weekday = integer(raw.weekday, 1, 7);
      if (nth === null || weekday === null) return null;
      rule.nth = nth;
      rule.weekday = weekday;
    }
  }
  if (frequency === "yearly") {
    const month = integer(raw.month, 1, 12);
    const day = integer(raw.dayOfMonth, 1, 31);
    if (month === null || day === null) return null;
    rule.month = month;
    rule.dayOfMonth = day;
  }
  return rule;
}

/**
 * All due dates of the rule in [from, to] (inclusive), counting the interval
 * from `start`. Dates before `start` are never returned.
 */
export function occurrencesBetween(
  rule: RecurrenceRule,
  start: string,
  from: string,
  to: string,
  limit = 400,
): string[] {
  const startDate = parseDate(start);
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  if (!startDate || !fromDate || !toDate || toDate < fromDate) return [];
  const lower = fromDate > startDate ? fromDate : startDate;
  const result = new Set<string>();
  const push = (date: Date | null) => {
    if (!date || date < lower || date > toDate || date < startDate) return;
    result.add(formatDate(date));
  };

  if (rule.frequency === "daily") {
    let cursor = startDate;
    for (let i = 0; i < MAX_ITERATIONS && cursor <= toDate; i += 1) {
      if (!rule.skipNonWorkdays || isWorkday(cursor)) push(cursor);
      cursor = addDays(cursor, rule.interval);
    }
  } else if (rule.frequency === "interval") {
    let cursor = startDate;
    for (let i = 0; i < MAX_ITERATIONS && cursor <= toDate; i += 1) {
      push(rule.skipNonWorkdays ? nextWorkday(cursor) : cursor);
      cursor = addDays(cursor, rule.interval);
    }
  } else if (rule.frequency === "weekly") {
    // Weeks are counted from the Monday of the start week.
    const weekStart = addDays(startDate, 1 - isoWeekday(startDate));
    let week = weekStart;
    for (let i = 0; i < MAX_ITERATIONS && week <= toDate; i += 1) {
      for (const weekday of rule.weekdays ?? []) {
        const date = addDays(week, weekday - 1);
        if (!rule.skipNonWorkdays || isWorkday(date)) push(date);
      }
      week = addDays(week, 7 * rule.interval);
    }
  } else if (rule.frequency === "monthly") {
    let year = startDate.getUTCFullYear();
    let month = startDate.getUTCMonth();
    for (let i = 0; i < MAX_ITERATIONS; i += 1) {
      if (new Date(Date.UTC(year, month, 1)) > toDate) break;
      push(monthlyDate(rule, year, month));
      month += rule.interval;
      year += Math.floor(month / 12);
      month %= 12;
    }
  } else if (rule.frequency === "yearly") {
    for (
      let year = startDate.getUTCFullYear(), i = 0;
      year <= toDate.getUTCFullYear() + 1 && i < MAX_ITERATIONS;
      year += rule.interval, i += 1
    ) {
      const monthIndex = (rule.month ?? 1) - 1;
      const day = Math.min(rule.dayOfMonth ?? 1, daysInMonth(year, monthIndex));
      const date = new Date(Date.UTC(year, monthIndex, day));
      push(rule.skipNonWorkdays ? nextWorkday(date) : date);
    }
  }
  return [...result].sort().slice(0, limit);
}

/** The next `count` due dates on or after `from`. */
export function nextOccurrences(
  rule: RecurrenceRule,
  start: string,
  from: string,
  count: number,
): string[] {
  const fromDate = parseDate(from);
  if (!fromDate) return [];
  // Look far enough ahead for yearly rules with long intervals.
  const horizon = formatDate(addDays(fromDate, 366 * Math.max(2, rule.interval + 1)));
  return occurrencesBetween(rule, start, from, horizon, count);
}

/** Human-readable German description, e.g. "Monatlich am 1. Werktag". */
export function describeRule(rule: RecurrenceRule): string {
  const weekdayNames = [
    "",
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
    "Sonntag",
  ];
  const short = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const every = (one: string, many: string) =>
    rule.interval === 1 ? one : `Alle ${rule.interval} ${many}`;
  switch (rule.frequency) {
    case "daily":
      return rule.skipNonWorkdays
        ? `${every("Täglich", "Tage")} an Werktagen`
        : every("Täglich", "Tage");
    case "interval":
      return `Alle ${rule.interval} Tage`;
    case "weekly":
      return `${every("Wöchentlich", "Wochen")} am ${(rule.weekdays ?? [])
        .map((day) => short[day])
        .join(", ")}`;
    case "monthly": {
      const prefix = every("Monatlich", "Monate");
      if (rule.monthlyMode === "first_workday") return `${prefix} am 1. Werktag`;
      if (rule.monthlyMode === "last_workday") {
        return `${prefix} am letzten Werktag`;
      }
      if (rule.monthlyMode === "nth_weekday") {
        const nth = rule.nth === -1 ? "letzten" : `${rule.nth}.`;
        return `${prefix} am ${nth} ${weekdayNames[rule.weekday ?? 1]}`;
      }
      return `${prefix} am ${rule.dayOfMonth}.`;
    }
    case "yearly":
      return `${every("Jährlich", "Jahre")} am ${rule.dayOfMonth}.${rule.month}.`;
  }
}
