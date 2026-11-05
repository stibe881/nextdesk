import {
  addDays,
  formatDate,
  isoWeekday,
  occurrencesBetween,
  parseDate,
  type RecurrenceRule,
} from "../_shared/service-task-recurrence.ts";

/** How far ahead occurrences are stored. Later dates are projected only. */
export const GENERATION_HORIZON_DAYS = 60;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

/** Today's calendar date in Swiss local time. */
export function swissToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === kind)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Current hour (0–23) in Swiss local time. */
export function swissHour(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zurich",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
}

/** Converts a Swiss local date and time (HH:MM) to a UTC instant. */
export function swissDateTimeToUtc(date: string, time: string): Date | null {
  const day = parseDate(date);
  const match = TIME.exec(time);
  if (!day || !match) return null;
  const nominal = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    Number(match[1]),
    Number(match[2]),
  );
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nominal));
  const value = (kind: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === kind)?.value);
  const offset =
    Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
    ) - nominal;
  return new Date(nominal - offset);
}

export type ChecklistTemplateItem = { id: string; label: string };
export type ChecklistItem = ChecklistTemplateItem & {
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
};

export type TemplateForPlanning = {
  recurrence: RecurrenceRule;
  starts_on: string;
  ends_on: string | null;
  due_time: string;
  lead_days: number;
  generated_until: string | null;
};

export type PlannedOccurrence = {
  scheduled_on: string;
  due_on: string;
  due_at: string;
  visible_from: string;
};

/**
 * Occurrences to store for a template up to the horizon. Generation never
 * creates a backlog: dates before today are skipped on the first run.
 */
export function planOccurrences(
  template: TemplateForPlanning,
  today: string,
  horizonDays = GENERATION_HORIZON_DAYS,
): { planned: PlannedOccurrence[]; generatedUntil: string } {
  const todayDate = parseDate(today)!;
  const horizon = formatDate(addDays(todayDate, horizonDays));
  const until =
    template.ends_on && template.ends_on < horizon ? template.ends_on : horizon;
  const afterGenerated = template.generated_until
    ? formatDate(addDays(parseDate(template.generated_until)!, 1))
    : today;
  const from = [today, afterGenerated, template.starts_on].sort().at(-1)!;
  if (from > until) return { planned: [], generatedUntil: horizon };
  const time = template.due_time.slice(0, 5);
  const planned = occurrencesBetween(
    template.recurrence,
    template.starts_on,
    from,
    until,
  ).flatMap((date) => {
    const dueAt = swissDateTimeToUtc(date, time);
    if (!dueAt) return [];
    return [
      {
        scheduled_on: date,
        due_on: date,
        due_at: dueAt.toISOString(),
        visible_from: formatDate(
          addDays(parseDate(date)!, -template.lead_days),
        ),
      },
    ];
  });
  return { planned, generatedUntil: horizon };
}

export function initialChecklist(value: unknown): ChecklistItem[] {
  return normalizeTemplateChecklist(value).map((item) => ({
    ...item,
    done: false,
    doneAt: null,
    doneBy: null,
  }));
}

export function normalizeTemplateChecklist(
  value: unknown,
): ChecklistTemplateItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const label =
      typeof record.label === "string" ? record.label.trim().slice(0, 300) : "";
    const id =
      typeof record.id === "string" && /^[a-z0-9-]{1,40}$/iu.test(record.id)
        ? record.id
        : crypto.randomUUID();
    return label ? [{ id, label }] : [];
  });
}

/** Monday to Sunday of the Swiss week containing `today`. */
export function weekBounds(today: string): { start: string; end: string } {
  const date = parseDate(today)!;
  const start = addDays(date, 1 - isoWeekday(date));
  return { start: formatDate(start), end: formatDate(addDays(start, 6)) };
}

export type OccurrenceForStats = {
  status: string;
  due_on: string;
  due_at: string;
  completed_at: string | null;
};

/**
 * Share of occurrences due in the last 30 days that were completed on time.
 * Skipped occurrences count as handled; open overdue ones count as missed.
 */
export function fulfillment(
  occurrences: OccurrenceForStats[],
  today: string,
  now = new Date(),
): { onTime: number; total: number; percent: number | null } {
  const from = formatDate(addDays(parseDate(today)!, -30));
  let onTime = 0;
  let total = 0;
  for (const occurrence of occurrences) {
    if (occurrence.due_on < from || occurrence.due_on > today) continue;
    const due = Date.parse(occurrence.due_at);
    if (occurrence.status === "skipped") {
      total += 1;
      onTime += 1;
    } else if (occurrence.status === "done") {
      total += 1;
      if (
        occurrence.completed_at &&
        Date.parse(occurrence.completed_at) <= due
      ) {
        onTime += 1;
      }
    } else if (due < now.getTime()) {
      total += 1;
    }
  }
  return {
    onTime,
    total,
    percent: total ? Math.round((onTime / total) * 100) : null,
  };
}
