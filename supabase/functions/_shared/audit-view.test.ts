import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  AUDIT_REDACTED,
  auditActionArea,
  auditActionLabel,
  auditAreaPrefixFilter,
  auditCsvCell,
  auditCsvDocument,
  auditDiff,
  auditEntityLink,
  parseAuditFilters,
  redactAuditSecrets,
} from "./audit-view.ts";

Deno.test("areas use the longest matching prefix", () => {
  assertEquals(auditActionArea("tenant.role.assigned"), "users");
  assertEquals(auditActionArea("tenant.settings.updated"), "settings");
  assertEquals(auditActionArea("knowledge.article.ai_draft_failed"), "ai");
  assertEquals(auditActionArea("knowledge.article.created"), "knowledge");
  assertEquals(auditActionArea("ticket.updated"), "tickets");
  assertEquals(auditActionArea("völlig.unbekannt"), "other");
});

Deno.test("area prefix filter excludes longer prefixes of other areas", () => {
  const settings = auditAreaPrefixFilter("settings");
  assert(settings.include?.includes("tenant."));
  assert(settings.exclude.includes("tenant.role."));
  assert(!settings.exclude.includes("ticket."));
  const other = auditAreaPrefixFilter("other");
  assertEquals(other.include, null);
  assert(other.exclude.includes("shop."));
});

Deno.test("labels are German and unknown actions stay raw", () => {
  assertEquals(auditActionLabel("tenant.role.assigned"), "Rolle zugewiesen");
  assertEquals(auditActionLabel("x.custom_thing"), "x.custom_thing");
});

Deno.test("filter parsing accepts valid input and rejects junk", () => {
  assertEquals(
    parseAuditFilters({
      actorId: "00000000-0000-4000-8000-0000000000AA",
      area: "tickets",
      severity: "security",
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: "2026-02-01T00:00:00.000Z",
      freeText: "  Passwort zurückgesetzt  ",
      entityType: "",
    }),
    {
      actorId: "00000000-0000-4000-8000-0000000000aa",
      area: "tickets",
      severity: "security",
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: "2026-02-01T00:00:00.000Z",
      freeText: "Passwort zurückgesetzt",
    },
  );
  assertEquals(parseAuditFilters(undefined), {});
  assertEquals(parseAuditFilters({ unknown: 1 }), null);
  assertEquals(parseAuditFilters({ severity: "debug" }), null);
  assertEquals(parseAuditFilters({ area: "nope" }), null);
  assertEquals(parseAuditFilters({ actorId: "abc" }), null);
  assertEquals(parseAuditFilters({ action: "ticket updated; drop" }), null);
  assertEquals(
    parseAuditFilters({
      startAt: "2026-03-01T00:00:00Z",
      endAt: "2026-02-01T00:00:00Z",
    }),
    null,
  );
  assertEquals(parseAuditFilters({ freeText: "x".repeat(201) }), null);
});

Deno.test("secrets are hidden at any depth", () => {
  assertEquals(
    redactAuditSecrets({
      api_token: "abc",
      nested: { clientSecret: "x", list: [{ password: "y", ok: 1 }] },
      priorityKey: "high",
      name: "Sichtbar",
    }),
    {
      api_token: AUDIT_REDACTED,
      nested: {
        clientSecret: AUDIT_REDACTED,
        list: [{ password: AUDIT_REDACTED, ok: 1 }],
      },
      priorityKey: "high",
      name: "Sichtbar",
    },
  );
});

Deno.test("key-level diff classifies changes", () => {
  const diff = auditDiff(
    { status: "open", title: "A", removed: 1, same: { a: 1, b: 2 } },
    { status: "closed", title: "A", added: true, same: { b: 2, a: 1 } },
  );
  assertEquals(
    diff.map((entry) => [entry.key, entry.change]),
    [
      ["status", "changed"],
      ["added", "added"],
      ["removed", "removed"],
      ["same", "unchanged"],
      ["title", "unchanged"],
    ],
  );
  assertEquals(auditDiff(null, { a: 1 })[0].change, "added");
});

Deno.test("ticket links come from entity or metadata", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assertEquals(auditEntityLink("ticket", id, {}), {
    kind: "ticket",
    ticketId: id,
  });
  assertEquals(auditEntityLink("problems", null, { ticket_id: id }), {
    kind: "ticket",
    ticketId: id,
  });
  assertEquals(auditEntityLink("team", id, {}), null);
});

Deno.test("CSV uses semicolons, BOM, German headers and escaping", () => {
  assertEquals(auditCsvCell('a;"b"'), '"a;""b"""');
  assertEquals(auditCsvCell("=SUM(A1)"), "'=SUM(A1)");
  const csv = auditCsvDocument([
    {
      id: "00000000-0000-4000-8000-000000000009",
      occurredAt: "2026-01-01T10:00:00+00:00",
      action: "tenant.role.assigned",
      actorId: null,
      actorName: "System",
      entityType: "tenant_role",
      entityId: null,
      severity: "security",
      metadata: { role: "Agent", token: "geheim" },
      beforeData: null,
      afterData: null,
    },
  ]);
  assert(csv.startsWith("﻿Zeitpunkt (UTC);Bereich;Aktion;"));
  const line = csv.split("\r\n")[1];
  assert(
    line.includes(
      "Benutzer & Rollen;Rolle zugewiesen;tenant.role.assigned;System;",
    ),
  );
  assert(line.includes("Sicherheit"));
  assert(line.includes('"{""role"":""Agent"",""token"":""[verborgen]""}"'));
  assert(!csv.includes('geheim"'));
});
