/**
 * Requester-facing ticket progress («Paketverfolgung»).
 *
 * Statuses are mapped only by their technical key and is_closed flag; status
 * labels (which may contain agent-internal wording) never leave the server.
 */

export type ProgressStepKey =
  | "received"
  | "in_progress"
  | "waiting_for_requester"
  | "resolved"
  | "closed";

export type ProgressStepState = "done" | "current" | "upcoming";

export type ProgressStep = {
  key: ProgressStepKey;
  state: ProgressStepState;
  reachedAt: string | null;
};

export type ExpectedResolution = {
  at: string;
  basis: "sla" | "history";
};

export type RequesterTicketProgress = {
  currentStep: ProgressStepKey;
  steps: ProgressStep[];
  expected: ExpectedResolution | null;
  waitingForRequester: boolean;
};

export type StatusChange = { at: string; toKey: string | null };

export type ProgressInput = {
  statusKey: string;
  statusIsClosed: boolean;
  createdAt: string;
  firstRespondedAt: string | null;
  waitingSince: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  resolutionDueAt: string | null;
  /** Median resolution time of similar tickets in seconds, if known. */
  medianResolutionSeconds: number | null;
  statusChanges: readonly StatusChange[];
  now: number;
};

const WAITING_FOR_REQUESTER = new Set(["waiting", "waiting_customer"]);

export function isWaitingForRequesterKey(key: string): boolean {
  return WAITING_FOR_REQUESTER.has(key);
}

/** Maps a status (key, is_closed, closed_at) to the requester step. */
export function currentStepFor(
  statusKey: string,
  statusIsClosed: boolean,
  closedAt: string | null,
): ProgressStepKey {
  if (statusKey === "new") return "received";
  if (WAITING_FOR_REQUESTER.has(statusKey)) return "waiting_for_requester";
  if (statusKey === "resolved") return "resolved";
  if (statusKey === "closed") return "closed";
  if (statusIsClosed) return closedAt ? "closed" : "resolved";
  // in_progress, waiting_vendor and tenant-specific open statuses: the
  // requester only needs to know that someone is working on it.
  return "in_progress";
}

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function earliest(...values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.min(...present) : null;
}

/** First moment the ticket left «received»: first answer or status change. */
function inProgressSince(input: ProgressInput): number | null {
  const firstChange = input.statusChanges
    .map((change) => ({ at: time(change.at), key: change.toKey }))
    .filter((change) => change.at !== null && change.key !== "new")
    .map((change) => change.at as number);
  return earliest(time(input.firstRespondedAt), ...firstChange);
}

export function expectedResolution(
  input: Pick<
    ProgressInput,
    "createdAt" | "resolutionDueAt" | "medianResolutionSeconds" | "now"
  >,
  currentStep: ProgressStepKey,
): ExpectedResolution | null {
  // While waiting for the requester the end depends on their answer; after
  // the resolution there is nothing left to expect.
  if (currentStep !== "received" && currentStep !== "in_progress") return null;
  const due = time(input.resolutionDueAt);
  if (due !== null && due > input.now) {
    return { at: new Date(due).toISOString(), basis: "sla" };
  }
  const created = time(input.createdAt);
  const median = input.medianResolutionSeconds;
  if (
    created !== null &&
    typeof median === "number" &&
    Number.isFinite(median) &&
    median > 0
  ) {
    const at = created + median * 1000;
    if (at > input.now) return { at: new Date(at).toISOString(), basis: "history" };
  }
  return null;
}

export function buildRequesterTicketProgress(
  input: ProgressInput,
): RequesterTicketProgress {
  const currentStep = currentStepFor(
    input.statusKey,
    input.statusIsClosed,
    input.closedAt,
  );
  const waiting = currentStep === "waiting_for_requester";
  const keys: ProgressStepKey[] = [
    "received",
    "in_progress",
    ...(waiting ? (["waiting_for_requester"] as const) : []),
    "resolved",
    ...(currentStep === "closed" ? (["closed"] as const) : []),
  ];
  const currentIndex = keys.indexOf(currentStep);
  const closedAt = time(input.closedAt);
  const resolvedAt = time(input.resolvedAt);
  const reached: Record<ProgressStepKey, number | null> = {
    received: time(input.createdAt),
    in_progress: inProgressSince(input),
    waiting_for_requester: time(input.waitingSince),
    resolved: earliest(resolvedAt, closedAt),
    closed: closedAt,
  };
  const steps = keys.map((key, index): ProgressStep => {
    const state: ProgressStepState = index < currentIndex
      ? "done"
      : index === currentIndex
      ? "current"
      : "upcoming";
    return {
      key,
      state,
      reachedAt: state === "upcoming" ? null : iso(reached[key]),
    };
  });
  return {
    currentStep,
    steps,
    expected: expectedResolution(input, currentStep),
    waitingForRequester: waiting,
  };
}

/**
 * Reads the target status key out of stored ticket events without exposing
 * the payload: `statusTransition.toStatusKey` (ticket.updated) or `statusKey`
 * (lifecycle and requester events).
 */
export function statusChangesFromEvents(
  events: ReadonlyArray<{ created_at?: unknown; payload?: unknown }>,
): StatusChange[] {
  const result: StatusChange[] = [];
  for (const event of events) {
    if (typeof event.created_at !== "string") continue;
    const payload = typeof event.payload === "object" && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : {};
    const transition = typeof payload.statusTransition === "object" &&
        payload.statusTransition !== null
      ? (payload.statusTransition as Record<string, unknown>)
      : null;
    const key = typeof transition?.toStatusKey === "string"
      ? transition.toStatusKey
      : typeof payload.statusKey === "string"
      ? payload.statusKey
      : null;
    if (key === null && !transition) continue;
    result.push({ at: event.created_at, toKey: key });
  }
  return result;
}
