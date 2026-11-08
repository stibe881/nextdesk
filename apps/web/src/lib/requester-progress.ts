// Ticket progress for requesters («Paketverfolgung»). The server
// (requester-portal, action ticketProgress) maps statuses by key; this module
// only validates the response and words it for the web («Sie»).

export type ProgressStepKey =
  "received" | "in_progress" | "waiting_for_requester" | "resolved" | "closed";

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

const STEP_KEYS: readonly ProgressStepKey[] = [
  "received",
  "in_progress",
  "waiting_for_requester",
  "resolved",
  "closed",
];

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

/** Accepts the function envelope `{ data: { progress } }`. */
export function parseRequesterProgress(
  value: unknown,
): RequesterProgress | null {
  const progress = record(record(record(value)?.data)?.progress);
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

const LABELS: Record<ProgressStepKey, string> = {
  received: "Eingegangen",
  in_progress: "In Bearbeitung",
  waiting_for_requester: "Wartet auf Sie",
  resolved: "Gelöst",
  closed: "Geschlossen",
};

export function progressStepLabel(key: ProgressStepKey): string {
  return LABELS[key];
}

const HINTS: Record<ProgressStepKey, string> = {
  received:
    "Ihr Anliegen ist eingegangen und wird demnächst einer Fachperson zugeteilt.",
  in_progress: "Eine Fachperson kümmert sich um Ihr Anliegen.",
  waiting_for_requester:
    "Wir brauchen eine Rückmeldung von Ihnen, damit wir weiterarbeiten können.",
  resolved:
    "Ihr Anliegen wurde gelöst. Melden Sie sich, falls noch etwas offen ist.",
  closed: "Das Ticket ist abgeschlossen.",
};

export function progressStepHint(key: ProgressStepKey): string {
  return HINTS[key];
}

/** «Mo., 9. Nov., 14:00» – or «heute, 14:00» / «morgen, 14:00». */
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
    : `Voraussichtlich gelöst bis ${when} (Erfahrungswert ähnlicher Anfragen)`;
}
