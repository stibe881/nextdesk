import { assertEquals } from "jsr:@std/assert@1";
import {
  incidentNoticeVisibility,
  parseIncidentPushSettings,
} from "./incident-notices.ts";

const links = [
  { noticeId: "a", name: "Backup", active: true, internal: true },
  { noticeId: "b", name: "E-Mail", active: true, internal: false },
  { noticeId: "b", name: "Firewall", active: true, internal: true },
  { noticeId: "c", name: "Alt", active: false, internal: false },
];

Deno.test("employees do not see notices that only concern internal services", () => {
  const result = incidentNoticeVisibility(links, false);
  assertEquals([...result.hidden].sort(), ["a", "c"]);
  assertEquals(result.names.get("b"), ["E-Mail"]);
});

Deno.test("agents see every notice with all active services", () => {
  const result = incidentNoticeVisibility(links, true);
  assertEquals(result.hidden.size, 0);
  assertEquals(result.names.get("a"), ["Backup"]);
  assertEquals(result.names.get("b"), ["E-Mail", "Firewall"]);
  assertEquals(result.names.get("c"), undefined);
});

Deno.test("parseIncidentPushSettings validates the request", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assertEquals(parseIncidentPushSettings({ type: "x", tenantId: "t", enabled: true }), {
    enabled: true,
    serviceIds: null,
  });
  assertEquals(
    parseIncidentPushSettings({ enabled: false, serviceIds: [id, id.toUpperCase()] }),
    { enabled: false, serviceIds: [id] },
  );
  assertEquals(parseIncidentPushSettings({ enabled: "yes" }), null);
  assertEquals(parseIncidentPushSettings({ enabled: true, serviceIds: ["x"] }), null);
  assertEquals(parseIncidentPushSettings({ enabled: true, other: 1 }), null);
});
