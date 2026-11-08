import { assertEquals } from "jsr:@std/assert@1";
import {
  buildRequesterTicketProgress,
  currentStepFor,
  expectedResolution,
  type ProgressInput,
  statusChangesFromEvents,
} from "./requester-ticket-progress.ts";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const base: ProgressInput = {
  statusKey: "new",
  statusIsClosed: false,
  createdAt: "2026-11-06T08:00:00Z",
  firstRespondedAt: null,
  waitingSince: null,
  resolvedAt: null,
  closedAt: null,
  resolutionDueAt: null,
  medianResolutionSeconds: null,
  statusChanges: [],
  now: NOW,
};

Deno.test("status keys map to requester steps", () => {
  assertEquals(currentStepFor("new", false, null), "received");
  assertEquals(currentStepFor("in_progress", false, null), "in_progress");
  assertEquals(currentStepFor("waiting_vendor", false, null), "in_progress");
  assertEquals(currentStepFor("custom_internal", false, null), "in_progress");
  assertEquals(currentStepFor("waiting", false, null), "waiting_for_requester");
  assertEquals(
    currentStepFor("waiting_customer", false, null),
    "waiting_for_requester",
  );
  assertEquals(currentStepFor("resolved", true, null), "resolved");
  assertEquals(currentStepFor("closed", true, "2026-11-07T00:00:00Z"), "closed");
  assertEquals(currentStepFor("done_custom", true, null), "resolved");
  assertEquals(
    currentStepFor("done_custom", true, "2026-11-07T00:00:00Z"),
    "closed",
  );
});

Deno.test("new ticket: received current, no waiting or closed step", () => {
  const progress = buildRequesterTicketProgress(base);
  assertEquals(
    progress.steps.map((step) => [step.key, step.state]),
    [
      ["received", "current"],
      ["in_progress", "upcoming"],
      ["resolved", "upcoming"],
    ],
  );
  assertEquals(progress.steps[0].reachedAt, "2026-11-06T08:00:00.000Z");
  assertEquals(progress.steps[1].reachedAt, null);
});

Deno.test("waiting for requester adds the step with its timestamp", () => {
  const progress = buildRequesterTicketProgress({
    ...base,
    statusKey: "waiting_customer",
    waitingSince: "2026-11-07T09:00:00Z",
    statusChanges: [
      { at: "2026-11-06T09:30:00Z", toKey: "in_progress" },
      { at: "2026-11-07T09:00:00Z", toKey: "waiting_customer" },
    ],
    resolutionDueAt: "2026-11-09T00:00:00Z",
  });
  assertEquals(progress.currentStep, "waiting_for_requester");
  assertEquals(progress.waitingForRequester, true);
  assertEquals(
    progress.steps.map((step) => [step.key, step.state, step.reachedAt]),
    [
      ["received", "done", "2026-11-06T08:00:00.000Z"],
      ["in_progress", "done", "2026-11-06T09:30:00.000Z"],
      ["waiting_for_requester", "current", "2026-11-07T09:00:00.000Z"],
      ["resolved", "upcoming", null],
    ],
  );
  // No promise while the requester owes an answer.
  assertEquals(progress.expected, null);
});

Deno.test("in progress uses the earlier of first answer and status change", () => {
  const progress = buildRequesterTicketProgress({
    ...base,
    statusKey: "in_progress",
    firstRespondedAt: "2026-11-06T08:30:00Z",
    statusChanges: [{ at: "2026-11-06T10:00:00Z", toKey: "in_progress" }],
  });
  assertEquals(progress.steps[1].reachedAt, "2026-11-06T08:30:00.000Z");
});

Deno.test("closed ticket shows resolved and closed as reached", () => {
  const progress = buildRequesterTicketProgress({
    ...base,
    statusKey: "closed",
    statusIsClosed: true,
    resolvedAt: "2026-11-06T15:00:00Z",
    closedAt: "2026-11-07T10:00:00Z",
  });
  assertEquals(
    progress.steps.map((step) => [step.key, step.state]),
    [
      ["received", "done"],
      ["in_progress", "done"],
      ["resolved", "done"],
      ["closed", "current"],
    ],
  );
  assertEquals(progress.steps[2].reachedAt, "2026-11-06T15:00:00.000Z");
  assertEquals(progress.expected, null);
});

Deno.test("expected resolution prefers a future SLA due date", () => {
  assertEquals(
    expectedResolution(
      { ...base, resolutionDueAt: "2026-11-08T12:00:00Z", medianResolutionSeconds: 3600 },
      "in_progress",
    ),
    { at: "2026-11-08T12:00:00.000Z", basis: "sla" },
  );
});

Deno.test("expected resolution falls back to the historical median", () => {
  // created 2026-11-06T08:00Z + 2 days
  assertEquals(
    expectedResolution(
      { ...base, resolutionDueAt: "2026-11-07T00:00:00Z", medianResolutionSeconds: 172_800 },
      "received",
    ),
    { at: "2026-11-08T08:00:00.000Z", basis: "history" },
  );
});

Deno.test("expected resolution is omitted when every estimate is past", () => {
  assertEquals(
    expectedResolution({ ...base, medianResolutionSeconds: 3600 }, "in_progress"),
    null,
  );
  assertEquals(expectedResolution(base, "in_progress"), null);
  assertEquals(
    expectedResolution(
      { ...base, resolutionDueAt: "2026-12-01T00:00:00Z" },
      "resolved",
    ),
    null,
  );
});

Deno.test("status changes are read without exposing payloads", () => {
  assertEquals(
    statusChangesFromEvents([
      {
        created_at: "2026-11-06T09:00:00Z",
        payload: { statusTransition: { toStatusKey: "in_progress", note: "x" } },
      },
      { created_at: "2026-11-06T10:00:00Z", payload: { statusKey: "resolved" } },
      { created_at: "2026-11-06T11:00:00Z", payload: { changedFields: ["priority"] } },
      { created_at: 5, payload: { statusKey: "closed" } },
    ]),
    [
      { at: "2026-11-06T09:00:00Z", toKey: "in_progress" },
      { at: "2026-11-06T10:00:00Z", toKey: "resolved" },
    ],
  );
});
