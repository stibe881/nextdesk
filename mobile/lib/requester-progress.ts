// Ticket progress for requesters («Paketverfolgung») and the answers to
// waiting reminders. The server maps statuses by key; this module validates
// the response and words it for the app («du»).
import { tn } from "./formality";


export type ProgressStepKey =
  | "received"
  | "in_progress"
  | "waiting_for_requester"
  | "resolved"
  | "closed";

export type ProgressStep = {
  key: ProgressStepKey;
  state: "done" | "current" | "upcoming";
  reachedAt: string | null;
};

export type RequesterProgress = {
  currentStep: ProgressStepKey;
  steps: ProgressStep[];
  expected: { at: string; basis: "sla" | "history" } | null;
  waitingForRequester: boolean;
};

export type ReminderAnswer = "resolved" | "need_help";

const STEP_KEYS: readonly ProgressStepKey[] = [
  "received",
  "in_progress",
  "waiting_for_requester",
  "resolved",
  "closed",
];

/** iOS notification category registered by the app (see apns.ts). */
export const REQUESTER_REMINDER_CATEGORY = "NEXTDESK_REQUESTER_REMINDER";
export const REMINDER_ACTION_RESOLVED = "requester-resolved";
export const REMINDER_ACTION_NEED_HELP = "requester-need-help";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function isStepKey(value: unknown): value is ProgressStepKey {
  return (
    typeof value === "string" &&
    (STEP_KEYS as readonly string[]).includes(value)
  );
}

/** Accepts `{ progress }` (the data part of the function response). */
export function parseRequesterProgress(
  value: unknown,
): RequesterProgress | null {
  const progress = record(record(value)?.progress);
  if (!progress || !isStepKey(progress.currentStep)) return null;
  if (!Array.isArray(progress.steps) || progress.steps.length > 5) return null;
  const steps: ProgressStep[] = [];
  for (const entry of progress.steps) {
    const step = record(entry);
    if (
      !step ||
      !isStepKey(step.key) ||
      (step.state !== "done" &&
        step.state !== "current" &&
        step.state !== "upcoming")
    )
      return null;
    steps.push({
      key: step.key,
      state: step.state,
      reachedAt: timestamp(step.reachedAt),
    });
  }
  if (!steps.some((step) => step.state === "current")) return null;
  const expectedRow = record(progress.expected);
  const expectedAt = timestamp(expectedRow?.at);
  const basis = expectedRow?.basis;
  const expected: RequesterProgress["expected"] =
    expectedAt && (basis === "sla" || basis === "history")
      ? { at: expectedAt, basis }
      : null;
  return {
    currentStep: progress.currentStep,
    steps,
    expected,
    waitingForRequester: progress.waitingForRequester === true,
  };
}

const labels = (): Record<ProgressStepKey, string> => ({
  received: "Eingegangen",
  in_progress: "In Bearbeitung",
  waiting_for_requester: tn("Wartet auf dich", "Wartet auf Sie"),
  resolved: "Gelöst",
  closed: "Geschlossen",
});

export function progressStepLabel(key: ProgressStepKey): string {
  return labels()[key];
}

const hints = (): Record<ProgressStepKey, string> => ({
  received: tn(
    "Dein Anliegen ist eingegangen und wird bald zugeteilt.",
    "Ihr Anliegen ist eingegangen und wird bald zugeteilt.",
  ),
  in_progress: tn(
    "Eine Fachperson kümmert sich um dein Anliegen.",
    "Eine Fachperson kümmert sich um Ihr Anliegen.",
  ),
  waiting_for_requester:
    tn(
      "Wir brauchen deine Rückmeldung, damit wir weiterarbeiten können.",
      "Wir brauchen Ihre Rückmeldung, damit wir weiterarbeiten können.",
    ),
  resolved:
    tn(
      "Dein Anliegen wurde gelöst. Melde dich, falls noch etwas offen ist.",
      "Ihr Anliegen wurde gelöst. Melden Sie sich, falls noch etwas offen ist.",
    ),
  closed: "Das Ticket ist abgeschlossen.",
});

export function progressStepHint(key: ProgressStepKey): string {
  return hints()[key];
}

/** «heute, 14:00», «morgen, 09:05» or «Do., 12. Nov., 09:05». */
export function formatProgressTime(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  const dayDiff = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );
  if (dayDiff === 0) return `heute, ${time}`;
  if (dayDiff === 1) return `morgen, ${time}`;
  if (dayDiff === -1) return `gestern, ${time}`;
  const day = new Intl.DateTimeFormat("de-CH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
  return `${day}, ${time}`;
}

export function expectedResolutionText(
  expected: RequesterProgress["expected"],
  now = new Date(),
): string | null {
  if (!expected) return null;
  const when = formatProgressTime(expected.at, now);
  if (!when) return null;
  return expected.basis === "sla"
    ? `Voraussichtlich gelöst bis ${when}`
    : `Voraussichtlich gelöst bis ${when} (Erfahrungswert)`;
}

/** Maps the tapped notification action to the answer to preselect. */
export function reminderAnswerFromNotificationAction(
  actionIdentifier: string | null | undefined,
): ReminderAnswer | null {
  if (actionIdentifier === REMINDER_ACTION_RESOLVED) return "resolved";
  if (actionIdentifier === REMINDER_ACTION_NEED_HELP) return "need_help";
  return null;
}

/** Route parameter from the ticket screen URL. */
export function reminderAnswerFromParam(value: unknown): ReminderAnswer | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "resolved" || raw === "need_help" ? raw : null;
}
