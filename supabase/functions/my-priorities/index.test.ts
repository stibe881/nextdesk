import { assertEquals } from "jsr:@std/assert@1";
import {
  effectiveOrder,
  operationItems,
  parseAction,
  parseAiOrder,
  type PriorityTicket,
  ruleScore,
} from "./index.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";
const now = Date.parse("2026-11-07T12:00:00Z");

function ticket(patch: Partial<PriorityTicket>): PriorityTicket {
  return {
    id: "t",
    ticketNumber: "T-1",
    subject: "Drucker",
    description: "",
    statusKey: "in_progress",
    statusLabel: "In Bearbeitung",
    priorityLabel: "Mittel",
    createdAt: "2026-11-07T10:00:00Z",
    updatedAt: "2026-11-07T10:00:00Z",
    resolutionDueAt: null,
    responseDueAt: null,
    firstRespondedAt: "2026-11-07T10:10:00Z",
    waitingSince: null,
    ...patch,
  };
}

Deno.test("rule score puts SLA breaches above waiting tickets", () => {
  const breached = ruleScore(ticket({ resolutionDueAt: "2026-11-07T11:00:00Z" }), now);
  const waiting = ruleScore(
    ticket({ statusKey: "waiting_customer", priorityLabel: "Hoch" }),
    now,
  );
  assertEquals(breached.reason, "SLA überschritten");
  assertEquals(breached.score > waiting.score, true);
  assertEquals(waiting.reason, "Priorität Hoch · Wartet auf Rückmeldung");
});

Deno.test("manual order wins, new tickets are slotted in by proposal", () => {
  const ranks = new Map([
    ["a", { ai_rank: 1, manual_rank: 2 }],
    ["b", { ai_rank: 3, manual_rank: 1 }],
    ["c", { ai_rank: 2, manual_rank: null }],
    ["d", { ai_rank: 4, manual_rank: null }],
  ]);
  assertEquals(effectiveOrder(["a", "b", "c", "d"], ranks), ["c", "b", "a", "d"]);
});

Deno.test("AI answer drops unknown and repeated indexes", () => {
  assertEquals(
    parseAiOrder(
      { order: [{ index: 2, reason: "SLA" }, { index: 2, reason: "x" }, { index: 9, reason: "y" }] },
      3,
    ),
    [{ index: 2, reason: "SLA" }],
  );
  assertEquals(parseAiOrder({ nope: true }, 3), null);
});

Deno.test("reorder needs unique ticket ids", () => {
  const id = "00000000-0000-4000-8000-0000000000aa";
  assertEquals(parseAction({ type: "reorder", tenantId, ticketIds: [id, id] }), null);
  assertEquals(parseAction({ type: "reorder", tenantId, ticketIds: [id] })?.type, "reorder");
});

Deno.test("Meine Prioritäten: Störungen und Sicherheitsfälle, dringende zuerst", () => {
  const items = operationItems({
    incidents: [
      { id: "i1", number: "STO-1", title: "Switch", state: "resolved", severity: "down", acknowledged: true },
      { id: "i2", number: "STO-2", title: "Server", state: "active", severity: "down", acknowledged: false },
    ],
    securityCases: [
      { id: "s1", number: "SEC-1", title: "Rechnung", state: "triage", decisionDueAt: "2026-11-07T11:00:00Z" },
      { id: "s2", number: "SEC-2", title: "Paket", state: "actions", clicked: false },
      { number: "kaputt" },
    ],
  }, now);
  assertEquals(items.map((item) => item.id), ["i2", "s1", "i1", "s2"]);
  assertEquals(items[0]!.reason, "Ausfall · unbestätigt");
  assertEquals(items[1]!.reason, "Urteil überfällig");
  assertEquals(items[2]!.reason, "Behoben, Ursache erfassen und schliessen");
  assertEquals(operationItems(null), []);
});
