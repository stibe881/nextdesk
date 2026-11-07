import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  buildClusterSource,
  clusterSolvedTickets,
  MAX_SOURCE_CHARACTERS,
  type SolvedTicket,
  solutionTexts,
  suggestionFingerprint,
} from "./clustering.ts";
import { parseAction, refreshDue } from "./index.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";
const suggestionId = "00000000-0000-4000-8000-000000000002";
const departmentA = "00000000-0000-4000-8000-0000000000aa";

function ticket(
  id: string,
  subject: string,
  options: Partial<SolvedTicket> = {},
): SolvedTicket {
  return {
    id,
    subject,
    categoryName: null,
    departmentId: departmentA,
    solvedAt: `2026-10-${id.padStart(2, "0")}T08:00:00Z`,
    ...options,
  };
}

Deno.test("similar solved tickets form one cluster with a stable fingerprint", () => {
  const tickets = [
    ticket("1", "VPN Verbindung bricht ab"),
    ticket("2", "VPN-Verbindung bricht ständig ab"),
    ticket("3", "Verbindung VPN abgebrochen"),
    ticket("4", "Drucker druckt nicht"),
  ];
  const clusters = clusterSolvedTickets(tickets);
  assertEquals(clusters.length, 1);
  assertEquals(clusters[0].ticketIds, ["3", "2", "1"]);
  assertEquals(clusters[0].departmentId, departmentA);
  assertEquals(
    clusters[0].fingerprint,
    suggestionFingerprint(departmentA, "pair:verbindung+vpn"),
  );
  assertEquals(clusters[0].titleHint, "Verbindung · Vpn");

  // A further ticket joins the cluster without changing its identity.
  const again = clusterSolvedTickets([
    ...tickets,
    ticket("5", "VPN Verbindung langsam"),
  ]);
  assertEquals(again[0].fingerprint, clusters[0].fingerprint);
  assertEquals(again[0].ticketIds.length, 4);
});

Deno.test("fewer than three similar tickets form no cluster", () => {
  assertEquals(
    clusterSolvedTickets([
      ticket("1", "Outlook startet nicht"),
      ticket("2", "Outlook startet nicht mehr"),
      ticket("3", "Teams Kamera schwarz"),
    ]),
    [],
  );
});

Deno.test("clusters stay within one department", () => {
  const clusters = clusterSolvedTickets([
    ticket("1", "Passwort zurücksetzen", { departmentId: null }),
    ticket("2", "Passwort zurücksetzen", { departmentId: null }),
    ticket("3", "Passwort zurücksetzen"),
  ]);
  assertEquals(clusters, []);
});

Deno.test("category and word cluster tickets with different wording", () => {
  const clusters = clusterSolvedTickets([
    ticket("1", "Toner leer", { categoryName: "Drucker" }),
    ticket("2", "Toner wechseln", { categoryName: "Drucker" }),
    ticket("3", "Toner bestellen", { categoryName: " drucker " }),
  ]);
  assertEquals(clusters.length, 1);
  assertEquals(
    clusters[0].fingerprint,
    suggestionFingerprint(departmentA, "category:drucker+toner"),
  );
  assertEquals(clusters[0].titleHint, "Drucker: Toner");
});

Deno.test("blocked fingerprints do not come back under another key", () => {
  const tickets = [
    ticket("1", "VPN Verbindung bricht ab"),
    ticket("2", "VPN Verbindung bricht ab"),
    ticket("3", "VPN Verbindung bricht ab"),
  ];
  const [first] = clusterSolvedTickets(tickets);
  const blocked = clusterSolvedTickets(tickets, {
    blockedFingerprints: new Set([first.fingerprint]),
  });
  assertEquals(blocked, []);
  assertEquals(
    clusterSolvedTickets(tickets, { excludedTicketIds: new Set(["1"]) }),
    [],
  );
});

Deno.test("a ticket belongs to at most one cluster", () => {
  const clusters = clusterSolvedTickets([
    ticket("1", "VPN Verbindung Zertifikat"),
    ticket("2", "VPN Verbindung Zertifikat"),
    ticket("3", "VPN Verbindung Zertifikat"),
    ticket("4", "VPN Zertifikat abgelaufen"),
  ]);
  const ids = clusters.flatMap((cluster) => cluster.ticketIds);
  assertEquals(new Set(ids).size, ids.length);
});

Deno.test("solution texts take the latest reply and note per ticket", () => {
  const texts = solutionTexts([
    { ticketId: "1", visibility: "external", body: "Alt", createdAt: "2026-10-01T08:00:00Z" },
    { ticketId: "1", visibility: "external", body: "Neu", createdAt: "2026-10-02T08:00:00Z" },
    { ticketId: "1", visibility: "internal", body: "Notiz", createdAt: "2026-10-01T09:00:00Z" },
    { ticketId: "2", visibility: "internal", body: "  ", createdAt: "2026-10-01T09:00:00Z" },
  ]);
  assertEquals(texts.get("1"), { reply: "Neu", note: "Notiz" });
  assertEquals(texts.has("2"), false);
});

Deno.test("cluster source is redacted and bounded", () => {
  const source = buildClusterSource("Vpn · Verbindung", [
    {
      subject: "VPN bricht ab",
      description: "Bitte melden unter anna@example.ch oder +41 79 123 45 67\npassword = geheim",
      reply: "Client neu installieren.",
      note: null,
    },
    ...Array.from({ length: 20 }, () => ({
      subject: "VPN",
      description: "x".repeat(5_000),
      reply: "y".repeat(5_000),
      note: "z".repeat(5_000),
    })),
  ]);
  assert(!source.includes("anna@example.ch"));
  assert(!source.includes("123 45 67"));
  assert(!source.includes("geheim"));
  assert(source.includes("[E-Mail]"));
  assert(source.includes("Lösung (letzte Antwort): Client neu installieren."));
  assert(Array.from(source).length <= MAX_SOURCE_CHARACTERS);
  assert(source.split("### Fall").length - 1 <= 8);
});

Deno.test("actions are validated strictly", () => {
  assertEquals(parseAction({ type: "list", tenantId }), { type: "list", tenantId });
  assertEquals(parseAction({ type: "draft", tenantId, suggestionId }), {
    type: "draft",
    tenantId,
    suggestionId,
  });
  assertEquals(parseAction({ type: "draft", tenantId }), null);
  assertEquals(parseAction({ type: "list", tenantId, extra: 1 }), null);
  assertEquals(parseAction({ type: "refreshAll", tenantId }), null);
  assertEquals(parseAction({ type: "list", tenantId: "nope" }), null);
});

Deno.test("clusters are recomputed after 24 hours", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  assertEquals(refreshDue(null, now), true);
  assertEquals(refreshDue("2026-11-07T00:00:00Z", now), false);
  assertEquals(refreshDue("2026-11-06T11:59:00Z", now), true);
  assertEquals(refreshDue("kaputt", now), true);
});
