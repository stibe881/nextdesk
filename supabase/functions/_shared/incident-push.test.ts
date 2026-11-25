import { assertEquals } from "jsr:@std/assert@1";
import { incidentPushText, parseIncidentPushes } from "./incident-push.ts";

const NOTICE = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

Deno.test("parseIncidentPushes keeps valid rows only", () => {
  assertEquals(parseIncidentPushes(null), []);
  assertEquals(
    parseIncidentPushes([
      { noticeId: NOTICE, tenantId: TENANT, title: "Mail", userIds: [USER, 5], services: ["Mail", 1] },
      { noticeId: "x", tenantId: TENANT, title: "Mail", userIds: [USER] },
      { noticeId: NOTICE, tenantId: TENANT, title: "Leer", userIds: [] },
    ]),
    [{ noticeId: NOTICE, tenantId: TENANT, title: "Mail", userIds: [USER], services: ["Mail"] }],
  );
});

Deno.test("incidentPushText names the affected services and stays short", () => {
  assertEquals(incidentPushText({ title: "E-Mail gestört", services: ["Exchange"] }), {
    title: "Störung: E-Mail gestört",
    body: "Betroffener Dienst: Exchange",
  });
  assertEquals(
    incidentPushText({ title: "x", services: ["A", "B"] }).body,
    "Betroffene Dienste: A, B",
  );
  assertEquals(incidentPushText({ title: "x", services: [] }).body, "Details stehen in nextDesk.");
  const long = incidentPushText({ title: "a".repeat(100), services: ["b".repeat(300)] });
  assertEquals(long.title.length, 60);
  assertEquals(long.body.length, 200);
});
