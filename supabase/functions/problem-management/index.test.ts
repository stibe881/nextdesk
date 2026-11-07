import { assertEquals } from "jsr:@std/assert@1";

import { clusterTickets, parseAction, subjectWords } from "./index.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";

Deno.test("subject words drop filler and short words", () => {
  assertEquals(subjectWords("Drucker im 2. Stock druckt nicht"), [
    "drucker",
    "stock",
    "druckt",
  ]);
});

Deno.test("similar tickets form one cluster without overlaps", () => {
  const ticket = (id: string, subject: string, categoryName: string | null) => ({
    id,
    ticketNumber: `T-${id}`,
    subject,
    categoryName,
    departmentId: null,
    createdAt: "2026-11-01T00:00:00Z",
  });
  const groups = clusterTickets([
    ticket("1", "VPN Verbindung bricht ab", "Netzwerk"),
    ticket("2", "VPN langsam", "Netzwerk"),
    ticket("3", "VPN geht nicht", null),
    ticket("4", "Passwort vergessen", null),
  ]);
  assertEquals(groups.length, 1);
  assertEquals(groups[0].label, "vpn");
  assertEquals(groups[0].tickets.length, 3);
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
