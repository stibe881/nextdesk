import type {
  ExperienceFollowUp,
  FollowUpPriority,
} from "@/lib/nextdesk-experience";

/**
 * Reine Logik der Übersicht «Erinnerungen» (mobile/app/reminders.tsx):
 * Gruppierung, Sortierung und Datumsdarstellung. Keine Netzwerk- oder
 * React-Abhängigkeiten, damit alles in Vitest prüfbar bleibt.
 */

export type Reminder = ExperienceFollowUp;

export type ReminderGroupKey = "overdue" | "today" | "later" | "none";

export type ReminderGroup = {
  key: ReminderGroupKey;
  label: string;
  entries: Reminder[];
};

export const REMINDER_GROUP_LABELS: Record<ReminderGroupKey, string> = {
  overdue: "Überfällig",
  today: "Heute",
  later: "Demnächst",
  none: "Ohne Fälligkeit",
};

const GROUP_ORDER: readonly ReminderGroupKey[] = [
  "overdue",
  "today",
  "later",
  "none",
];

/** Anzahl erledigter Erinnerungen, die die Übersicht höchstens zeigt. */
export const RESOLVED_REMINDER_LIMIT = 20;

const WEEKDAYS = ["So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."];
const DAY_MS = 86_400_000;

export function parseReminderDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Kalendertage zwischen den lokalen Tagen von `now` und `date`. */
function dayOffset(date: Date, now: Date): number {
  return Math.round(
    (startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS,
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatReminderClock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Kurzes, relatives Datum im Schweizer Format:
 * «heute 14:00», «morgen 08:00», «gestern 16:00», «Mi., 18.11., 09:00»,
 * bei anderem Jahr «Mi., 18.11.2027, 09:00».
 */
export function formatReminderMoment(date: Date, now: Date): string {
  const time = formatReminderClock(date);
  const offset = dayOffset(date, now);
  if (offset === 0) return `heute ${time}`;
  if (offset === 1) return `morgen ${time}`;
  if (offset === -1) return `gestern ${time}`;
  const weekday = WEEKDAYS[date.getDay()] ?? "";
  const day = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.`;
  const year =
    date.getFullYear() === now.getFullYear() ? "" : String(date.getFullYear());
  return `${weekday}, ${day}${year}, ${time}`;
}

/** Fälligkeit einer offenen Erinnerung für die Zeile. */
export function formatReminderDue(dueAt: string | null, now: Date): string {
  if (!dueAt) return "Ohne Fälligkeit";
  const date = parseReminderDate(dueAt);
  if (!date) return "Termin nicht lesbar";
  return formatReminderMoment(date, now);
}

/** Erledigt-Zeitpunkt für die Zeile im Bereich «Erledigt». */
export function formatReminderResolved(
  resolvedAt: string | null,
  now: Date,
): string {
  const date = parseReminderDate(resolvedAt);
  return date ? `Erledigt ${formatReminderMoment(date, now)}` : "Erledigt";
}

export function reminderPriorityLabel(priority: FollowUpPriority): string {
  switch (priority) {
    case "high":
      return "Hoch";
    case "low":
      return "Tief";
    default:
      return "Normal";
  }
}

export function reminderGroupKey(
  reminder: Pick<Reminder, "dueAt">,
  now: Date,
): ReminderGroupKey {
  const due = parseReminderDate(reminder.dueAt);
  if (!due) return "none";
  if (due.getTime() < now.getTime()) return "overdue";
  return dayOffset(due, now) === 0 ? "today" : "later";
}

export function isReminderOverdue(
  reminder: Pick<Reminder, "dueAt" | "resolvedAt">,
  now: Date,
): boolean {
  return !reminder.resolvedAt && reminderGroupKey(reminder, now) === "overdue";
}

function compareByDue(left: Reminder, right: Reminder): number {
  const leftDue = parseReminderDate(left.dueAt)?.getTime();
  const rightDue = parseReminderDate(right.dueAt)?.getTime();
  if (leftDue !== undefined && rightDue !== undefined && leftDue !== rightDue) {
    return leftDue - rightDue;
  }
  if (leftDue === undefined && rightDue !== undefined) return 1;
  if (leftDue !== undefined && rightDue === undefined) return -1;
  return left.createdAt.localeCompare(right.createdAt);
}

/**
 * Offene Erinnerungen in die Bereiche «Überfällig», «Heute», «Demnächst» und
 * «Ohne Fälligkeit», jeweils nach Fälligkeit sortiert. Leere Bereiche entfallen.
 * Überfällig ist, was vor `now` fällig war (auch früher am selben Tag).
 */
export function groupOpenReminders(
  reminders: readonly Reminder[],
  now: Date,
): ReminderGroup[] {
  const buckets: Record<ReminderGroupKey, Reminder[]> = {
    overdue: [],
    today: [],
    later: [],
    none: [],
  };
  for (const reminder of reminders) {
    if (reminder.resolvedAt) continue;
    buckets[reminderGroupKey(reminder, now)].push(reminder);
  }
  return GROUP_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
    key,
    label: REMINDER_GROUP_LABELS[key],
    entries: [...buckets[key]].sort(compareByDue),
  }));
}

export function openReminderCount(reminders: readonly Reminder[]): number {
  return reminders.filter((reminder) => !reminder.resolvedAt).length;
}

/** Die zuletzt erledigten Erinnerungen, neueste zuerst. */
export function recentResolvedReminders(
  reminders: readonly Reminder[],
  limit = RESOLVED_REMINDER_LIMIT,
): Reminder[] {
  return reminders
    .filter((reminder) => Boolean(parseReminderDate(reminder.resolvedAt)))
    .sort((left, right) =>
      (right.resolvedAt ?? "").localeCompare(left.resolvedAt ?? ""),
    )
    .slice(0, Math.max(0, limit));
}

/** Setzt (oder entfernt mit `null`) den Erledigt-Zeitpunkt einer Erinnerung. */
export function withReminderResolvedAt(
  reminders: readonly Reminder[],
  id: string,
  resolvedAt: string | null,
): Reminder[] {
  return reminders.map((reminder) =>
    reminder.id === id ? { ...reminder, resolvedAt } : reminder,
  );
}

/** Ersetzt eine Erinnerung durch die Serverfassung oder fügt sie vorne an. */
export function upsertReminder(
  reminders: readonly Reminder[],
  next: Reminder,
): Reminder[] {
  return reminders.some((reminder) => reminder.id === next.id)
    ? reminders.map((reminder) => (reminder.id === next.id ? next : reminder))
    : [next, ...reminders];
}

export function removeReminder(
  reminders: readonly Reminder[],
  id: string,
): Reminder[] {
  return reminders.filter((reminder) => reminder.id !== id);
}
