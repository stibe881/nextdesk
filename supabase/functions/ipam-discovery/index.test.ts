import { assert, assertEquals } from "jsr:@std/assert@1";

import { expectedFqdn, parseAction, scopeContains } from "./index.ts";

const tenantId = "d119bcc1-89e6-4c73-b1c1-c14ea71a88c3";
const agentId = "fbc3ecd4-a48c-4990-8011-b296a4e6f107";

Deno.test("IPAM-Discovery: Aktionen werden streng geprüft", () => {
  assertEquals(parseAction({ type: "overview", tenantId })?.type, "overview");
  assertEquals(parseAction({ type: "overview", tenantId: "x" }), null);
  assertEquals(parseAction({ type: "createAgent", tenantId, name: "  " }), null);
  assertEquals(parseAction({ type: "createAgent", tenantId, name: "Agent Baar" })?.type, "createAgent");
  assertEquals(parseAction({ type: "updateAgent", tenantId, agentId, status: "revoked" }), null);
  assertEquals(parseAction({ type: "scanNow", tenantId, agentId, prefixIds: ["x"] }), null);
  assertEquals(
    parseAction({ type: "queueJob", tenantId, addressId: agentId, operation: "dns_create" })?.type,
    "queueJob",
  );
  assertEquals(parseAction({ type: "queueJob", tenantId, addressId: agentId, operation: "rm -rf" }), null);
  const adopt = parseAction({ type: "adoptGhost", tenantId, findingId: agentId, hostname: "VM-TEST-77", status: "x" });
  assert(adopt?.type === "adoptGhost");
  if (adopt?.type === "adoptGhost") {
    assertEquals(adopt.hostname, "vm-test-77");
    assertEquals(adopt.status, "active");
  }
  assertEquals(parseAction({ type: "adoptGhost", tenantId, findingId: agentId, hostname: "bad name!" }), null);
});

Deno.test("IPAM-Discovery: DHCP-Bereich und erwarteter DNS-Name", () => {
  assert(scopeContains("10.20.30.0", "255.255.255.0", "10.20.30.21"));
  assert(!scopeContains("10.20.30.0", "255.255.255.0", "10.20.31.21"));
  assert(scopeContains("10.20.50.0", "255.255.254.0", "10.20.51.200"));
  assertEquals(expectedFqdn("DRU-A2-KOPIE", null, null, ["schule.local", "30.20.10.in-addr.arpa"]), "dru-a2-kopie.schule.local");
  assertEquals(expectedFqdn("DRU-A2-KOPIE", null, null, ["a.local", "b.local"]), null);
  assertEquals(expectedFqdn("DRU-A2-KOPIE", null, "b.local", ["a.local", "b.local"]), "dru-a2-kopie.b.local");
  assertEquals(expectedFqdn("x", "srv-01.schule.local.", null, []), "srv-01.schule.local");
});
