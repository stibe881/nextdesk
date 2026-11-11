import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  articleSourceText,
  caseDescription,
  compareIncidents,
  encodeCursor,
  incidentArticleTemplate,
  parseCursor,
  ticketReplyText,
} from "./workflow.ts";
import { parseAction } from "./index.ts";

const tenantId = "d119bcc1-89e6-4c73-b1c1-c14ea71a88c3";
const incidentId = "fbc3ecd4-a48c-4990-8011-b296a4e6f107";
const ticketId = "0b6c3e4c-5d0f-4b8e-9a51-6b9f0f2c1a77";

Deno.test("Störungen: Cursor ist streng und umkehrbar", () => {
  const cursor = encodeCursor("2026-11-10T08:00:00.000Z", incidentId);
  assertEquals(parseCursor(cursor), { openedAt: "2026-11-10T08:00:00.000Z", id: incidentId });
  assertEquals(parseCursor("2026-11-10T08:00:00Z|kein-uuid"), null);
  assertEquals(parseCursor(`nicht-datum|${incidentId}`), null);
  assertEquals(parseCursor(`${cursor}|zuviel`), null);
  assertEquals(parseAction({ type: "list", tenantId, filter: "all", cursor: "x" }), null);
  const list = parseAction({ type: "list", tenantId, filter: "closed", cursor, search: "  sw-core " });
  assert(list?.type === "list");
  assertEquals(list.search, "sw-core");
  assertEquals(list.cursor?.id, incidentId);
});

Deno.test("Störungen: aktive zuerst unbestätigt, Ausfall vor Warnung, älteste zuerst", () => {
  const rows = [
    { id: "a", state: "active", acknowledgedAt: "2026-11-10T08:00:00Z", severity: "down", openedAt: "2026-11-10T07:00:00Z" },
    { id: "b", state: "active", acknowledgedAt: null, severity: "warning", openedAt: "2026-11-10T06:00:00Z" },
    { id: "c", state: "active", acknowledgedAt: null, severity: "down", openedAt: "2026-11-10T09:00:00Z" },
    { id: "d", state: "active", acknowledgedAt: null, severity: "down", openedAt: "2026-11-10T05:00:00Z" },
  ];
  assertEquals(rows.sort(compareIncidents).map((row) => row.id), ["d", "c", "b", "a"]);
});

Deno.test("Störungen: Abschluss-Aktion mit Tickets und Fall", () => {
  const close = parseAction({
    type: "close",
    tenantId,
    incidentId,
    cause: "power",
    note: "USV getauscht",
    notifyTickets: true,
    openCase: { title: "USV Serverraum", includeRecurring: true },
  });
  assert(close?.type === "close");
  assertEquals(close.notifyTickets, true);
  assertEquals(close.openCase, { title: "USV Serverraum", includeRecurring: true });
  // Older clients: no replies to tickets.
  const old = parseAction({ type: "close", tenantId, incidentId, cause: "power" });
  assert(old?.type === "close");
  assertEquals(old.notifyTickets, false);
  assertEquals(parseAction({ type: "close", tenantId, incidentId, cause: "power", openCase: { title: "x" } }), null);
  assertEquals(parseAction({ type: "close", tenantId, incidentId, cause: "power", notifyTickets: "ja" }), null);
  assertEquals(parseAction({ type: "linkTicket", tenantId, incidentId, ticket: "T-2026-0042" })?.type, "linkTicket");
  assertEquals(parseAction({ type: "unlinkTicket", tenantId, incidentId, ticketId })?.type, "unlinkTicket");
  assertEquals(parseAction({ type: "unlinkTicket", tenantId, incidentId, ticketId: "x" }), null);
  assertEquals(parseAction({ type: "ticketIncidents", tenantId, ticketId })?.type, "ticketIncidents");
  assertEquals(parseAction({ type: "openCase", tenantId, incidentId, title: "ab" }), null);
  assertEquals(parseAction({ type: "draftArticle", tenantId, incidentId })?.type, "draftArticle");
});

Deno.test("Störungen: Texte für Tickets, Fall und Artikel", () => {
  const incident = { number: "STO-2026-0007", title: "SW-CORE – Ping", deviceName: "SW-CORE" };
  const reply = ticketReplyText(incident, "power", "USV getauscht");
  assert(reply.includes("STO-2026-0007"));
  assert(reply.includes("Ursache: Strom\nUSV getauscht"));
  assert(reply.includes("«Gelöst»"));
  assert(!reply.includes("ß"));

  const description = caseDescription({
    incident: { ...incident, cause: "hardware", closingNote: "Netzteil defekt" },
    incidentNumbers: ["STO-2026-0001", "STO-2026-0004", "STO-2026-0007"],
    services: ["WLAN"],
  });
  assert(description.includes("Störungen (30 Tage): STO-2026-0001, STO-2026-0004, STO-2026-0007"));
  assert(description.includes("Dienste: WLAN"));

  const source = {
    ...incident,
    location: "Serverraum",
    services: ["WLAN"],
    cause: "hardware" as const,
    closingNote: null,
    openedAt: "2026-11-10T08:00:00Z",
    resolvedAt: "2026-11-10T09:30:00Z",
    durationMinutes: 90,
    sensors: ["Ping"],
    notes: ["Netzteil ersetzt"],
  };
  const draft = incidentArticleTemplate(source);
  assertEquals(draft.title, "Störung SW-CORE: Hardware");
  for (const heading of ["## Symptom", "## Ursache", "## Lösung", "## Vorbeugung"]) {
    assert(draft.bodyMarkdown.includes(heading), heading);
  }
  assert(draft.bodyMarkdown.includes("Noch zu ergänzen."));
  assert(draft.bodyMarkdown.includes("- Netzteil ersetzt"));
  const text = articleSourceText(source);
  assert(text.includes("Dauer: 1 h 30 min"));
  assert(text.includes("Ursache: Hardware"));
});
