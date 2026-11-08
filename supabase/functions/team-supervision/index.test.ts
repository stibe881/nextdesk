import { overloadWarnings, parseAction, planRebalance, priorityWeight } from "./index.ts";
import { assertEquals } from "jsr:@std/assert@1";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TICKET = "22222222-2222-4222-8222-222222222222";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("team supervision accepts only well-formed actions", () => {
  assert(parseAction({ type: "overview", tenantId: TENANT }), "overview");
  assert(
    parseAction({ type: "reassign", tenantId: TENANT, ticketIds: [TICKET], agentId: null }),
    "reassign to nobody",
  );
  assert(
    !parseAction({ type: "reassign", tenantId: TENANT, ticketIds: [], agentId: null }),
    "reassign needs tickets",
  );
  assert(
    !parseAction({
      type: "saveReview",
      tenantId: TENANT,
      ticketId: TICKET,
      rating: 6,
      solutionCorrect: true,
      toneAppropriate: true,
    }),
    "rating is limited to 1-5",
  );
  assert(
    parseAction({ type: "monthlyReport", tenantId: TENANT, month: "2026-11" }),
    "month report",
  );
  assert(
    !parseAction({ type: "monthlyReport", tenantId: TENANT, month: "2026-13" }),
    "invalid month",
  );
  assert(!parseAction({ type: "unknown", tenantId: TENANT }), "unknown action");
});

Deno.test("priority labels map to weights", () => {
  assertEquals(priorityWeight("Kritisch"), 4);
  assertEquals(priorityWeight("Hoch"), 3);
  assertEquals(priorityWeight("Mittel"), 2);
  assertEquals(priorityWeight("Niedrig"), 1);
});

const dept = "00000000-0000-4000-8000-0000000000d1";
function agent(id: string, open: number, score: number, overdue = 0, absence: unknown = null) {
  return {
    id,
    displayName: id,
    departmentIds: [dept],
    openTickets: open,
    overdue,
    loadScore: score,
    absence,
  };
}
function ticket(id: string, agentId: string, createdAt: string) {
  return {
    id,
    departmentId: dept,
    assignedAgentId: agentId,
    priorityWeight: 2,
    overdue: false,
    atRisk: false,
    createdAt,
  };
}

Deno.test("overload warnings flag clear outliers and overdue piles", () => {
  const warnings = overloadWarnings([
    agent("a", 10, 20),
    agent("b", 3, 6),
    agent("c", 2, 4, 3),
  ]);
  assertEquals(warnings.map((w) => [w.agentId, w.reason]), [
    ["a", "load"],
    ["c", "overdue"],
  ]);
});

Deno.test("rebalancing moves newest tickets to the least loaded colleague", () => {
  const tickets = [
    ticket("t1", "a", "2026-11-01T08:00:00Z"),
    ticket("t2", "a", "2026-11-02T08:00:00Z"),
    ticket("t3", "a", "2026-11-03T08:00:00Z"),
    ticket("t4", "a", "2026-11-04T08:00:00Z"),
    ticket("t5", "a", "2026-11-05T08:00:00Z"),
    ticket("t6", "a", "2026-11-06T08:00:00Z"),
  ];
  const moves = planRebalance(
    [agent("a", 6, 12), agent("b", 0, 0), agent("c", 1, 2)],
    tickets,
  );
  assertEquals(moves[0], {
    ticketId: "t6",
    fromAgentId: "a",
    toAgentId: "b",
    toAgentName: "b",
  });
  // Receivers stay at or below the average load (14 / 3 ≈ 4.7).
  assertEquals(moves.length, 3);
});

Deno.test("absent agents hand over all their tickets", () => {
  const moves = planRebalance(
    [agent("a", 1, 2, 0, { endsAt: "x" }), agent("b", 1, 2)],
    [ticket("t1", "a", "2026-11-01T08:00:00Z")],
  );
  assertEquals(moves.map((move) => move.toAgentId), ["b"]);
});

Deno.test("parses SLA cause report and kudos board actions", () => {
  assertEquals(
    parseAction({ type: "slaBreachCauses", tenantId: TENANT, month: "2026-11" }),
    { type: "slaBreachCauses", tenantId: TENANT, month: "2026-11" },
  );
  assertEquals(
    parseAction({ type: "slaBreachCauses", tenantId: TENANT, month: "2026-13" }),
    null,
  );
  assertEquals(parseAction({ type: "kudosBoard", tenantId: TENANT }), {
    type: "kudosBoard",
    tenantId: TENANT,
  });
});
