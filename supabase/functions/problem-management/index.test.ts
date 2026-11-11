import { assertEquals } from "jsr:@std/assert@1";

import { groupsFromClusters, parseAction } from "./index.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";

Deno.test("clusters of the database become candidate groups", () => {
  const ticket = (n: number) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    ticket_number: `T-${n}`,
    subject: "VPN bricht ab",
    created_at: "2026-11-01T00:00:00Z",
  });
  const groups = groupsFromClusters([
    {
      ticket_id: ticket(1).id,
      subject: "VPN bricht ab",
      ticket_count: 3,
      ticket_ids: [ticket(1).id, ticket(2).id, ticket(3).id],
      tickets: [ticket(1), ticket(2), ticket(3)],
    },
    // Too small or broken rows are left out.
    { ticket_id: ticket(4).id, subject: "x", tickets: [ticket(4)] },
    { ticket_id: "nope", tickets: [] },
  ]);
  assertEquals(groups.length, 1);
  assertEquals(groups[0].kind, "similar");
  assertEquals(groups[0].label, "VPN bricht ab");
  assertEquals(groups[0].tickets.map((entry) => entry.ticketNumber), [
    "T-1",
    "T-2",
    "T-3",
  ]);
  assertEquals(groupsFromClusters(null), []);
});

Deno.test("parseAction validates the analysis payload", () => {
  assertEquals(
    parseAction({
      type: "saveAnalysis",
      tenantId,
      problemId: tenantId,
      whys: ["a", "b", "c", "d", "e", "f"],
      impact: "",
    }),
    null,
  );
  assertEquals(
    parseAction({ type: "createFromTickets", tenantId, title: "VPN", ticketIds: [] }),
    null,
  );
});
