import { parseAction } from "./index.ts";

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
