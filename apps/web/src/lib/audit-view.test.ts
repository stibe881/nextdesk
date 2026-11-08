import { describe, expect, it } from "vitest";
import serverCopy from "../../../../supabase/functions/_shared/audit-view.ts?raw";
import webCopy from "./audit-view.ts?raw";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_AREAS,
  AUDIT_CSV_HEADERS,
  AUDIT_REDACTED,
  auditActionArea,
  auditActionLabel,
  auditAreaPrefixFilter,
  auditCsvCell,
  auditCsvDocument,
  auditDiff,
  auditEntityLink,
  auditEntityTypeLabel,
  auditSeverityLabel,
  formatAuditValue,
  parseAuditFilters,
  redactAuditSecrets,
  type AuditExportEntry,
} from "./audit-view";

describe("audit-view copies", () => {
  it("web and edge function copies are identical", () => {
    expect(webCopy).toBe(serverCopy);
  });
});

describe("action labels and areas", () => {
  it("maps common actions to German labels", () => {
    expect(auditActionLabel("ticket.deleted")).toBe("Ticket gelöscht");
    expect(auditActionLabel("tenant.role.assigned")).toBe("Rolle zugewiesen");
    expect(auditActionLabel("audit.exported")).toBe(
      "Änderungsprotokoll exportiert",
    );
    expect(auditActionLabel("shop.order.submitted")).toBe(
      "Shop-Bestellung aufgegeben",
    );
  });

  it("shows unknown actions raw", () => {
    expect(auditActionLabel("custom.thing.done")).toBe("custom.thing.done");
    expect(auditEntityTypeLabel("custom_entity")).toBe("custom_entity");
    expect(auditSeverityLabel("weird")).toBe("weird");
  });

  it("uses formal German without sharp s in labels", () => {
    for (const label of Object.values(AUDIT_ACTION_LABELS)) {
      expect(label).not.toContain("ß");
    }
  });

  it("assigns each labelled action to its intended area", () => {
    expect(auditActionArea("ticket.csv_exported")).toBe("tickets");
    expect(auditActionArea("tenant.user.invited")).toBe("users");
    expect(auditActionArea("tenant.sso_person.provisioned")).toBe("users");
    expect(auditActionArea("tenant.data_retention.updated")).toBe("settings");
    expect(auditActionArea("inventory.movement.posted")).toBe("assets");
    expect(auditActionArea("ai.assist")).toBe("ai");
    expect(auditActionArea("monitoring.ticket.created")).toBe("monitoring");
    expect(auditActionArea("knowledge.suggestion.dismissed")).toBe("knowledge");
    expect(auditActionArea("shop.order.submitted")).toBe("shop");
    expect(auditActionArea("something.else")).toBe("other");
  });

  it("prefix filters agree with the area mapping", () => {
    const samples = [
      ...Object.keys(AUDIT_ACTION_LABELS),
      "tickets.update",
      "unbekannt.aktion",
      "tenant.irgendwas",
    ];
    for (const area of AUDIT_AREAS) {
      const filter = auditAreaPrefixFilter(area.key);
      for (const action of samples) {
        const included =
          (filter.include === null ||
            filter.include.some((prefix) => action.startsWith(prefix))) &&
          !filter.exclude.some((prefix) => action.startsWith(prefix));
        expect(
          included,
          `${action} in ${area.key}: ${auditActionArea(action)}`,
        ).toBe(auditActionArea(action) === area.key);
      }
    }
  });
});

describe("filter parsing", () => {
  it("normalises valid filters and drops empty values", () => {
    expect(
      parseAuditFilters({
        action: "ticket.updated",
        entityType: "ticket",
        entityId: "00000000-0000-4000-8000-00000000000A",
        freeText: " suche ",
        severity: "",
        actorId: null,
      }),
    ).toEqual({
      action: "ticket.updated",
      entityType: "ticket",
      entityId: "00000000-0000-4000-8000-00000000000a",
      freeText: "suche",
    });
  });

  it("rejects unknown keys and invalid values", () => {
    expect(parseAuditFilters([])).toBeNull();
    expect(parseAuditFilters({ limit: 5 })).toBeNull();
    expect(parseAuditFilters({ startAt: "gestern" })).toBeNull();
    expect(parseAuditFilters({ freeText: "a\u0000b" })).toBeNull();
    expect(parseAuditFilters({ entityType: "x y" })).toBeNull();
  });
});

describe("secret redaction", () => {
  it("hides token, secret, password and key values", () => {
    expect(
      redactAuditSecrets({
        accessToken: "a",
        client_secret: "b",
        Password: "c",
        apiKey: "d",
        nested: [{ refresh_token: "e", label: "ok" }],
        visible: 1,
      }),
    ).toEqual({
      accessToken: AUDIT_REDACTED,
      client_secret: AUDIT_REDACTED,
      Password: AUDIT_REDACTED,
      apiKey: AUDIT_REDACTED,
      nested: [{ refresh_token: AUDIT_REDACTED, label: "ok" }],
      visible: 1,
    });
    expect(redactAuditSecrets(null)).toBeNull();
    expect(redactAuditSecrets("text")).toBe("text");
  });
});

describe("diff", () => {
  it("lists changed, added, removed and unchanged keys", () => {
    const diff = auditDiff(
      { status: "open", priority: "low", old: true },
      { status: "closed", priority: "low", fresh: [1] },
    );
    expect(diff).toEqual([
      { key: "status", change: "changed", before: "open", after: "closed" },
      { key: "fresh", change: "added", before: undefined, after: [1] },
      { key: "old", change: "removed", before: true, after: undefined },
      { key: "priority", change: "unchanged", before: "low", after: "low" },
    ]);
  });

  it("handles missing sides and formats values", () => {
    expect(auditDiff(null, null)).toEqual([]);
    expect(auditDiff({ a: 1 }, null)[0]?.change).toBe("removed");
    expect(formatAuditValue(undefined)).toBe("–");
    expect(formatAuditValue(null)).toBe("leer");
    expect(formatAuditValue(true)).toBe("ja");
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("entity links", () => {
  it("links tickets", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(auditEntityLink("ticket", id, null)).toEqual({
      kind: "ticket",
      ticketId: id,
    });
    expect(auditEntityLink("x", null, { ticketId: id })?.ticketId).toBe(id);
    expect(auditEntityLink("ticket", null, {})).toBeNull();
  });
});

describe("CSV formatting", () => {
  const entry: AuditExportEntry = {
    id: "00000000-0000-4000-8000-000000000003",
    occurredAt: "2026-11-07T08:00:00+00:00",
    action: "ticket.updated",
    actorId: "00000000-0000-4000-8000-000000000004",
    actorName: "Müller; Anna",
    entityType: "ticket",
    entityId: "00000000-0000-4000-8000-000000000005",
    severity: "info",
    metadata: { note: 'Zeile 1\nZeile "2"', password: "geheim" },
    beforeData: { status: "open" },
    afterData: { status: "closed" },
  };

  it("escapes semicolons, quotes, newlines and formulas", () => {
    expect(auditCsvCell("plain")).toBe("plain");
    expect(auditCsvCell("a;b")).toBe('"a;b"');
    expect(auditCsvCell('a"b')).toBe('"a""b"');
    expect(auditCsvCell("a\nb")).toBe('"a\nb"');
    expect(auditCsvCell("+41 44")).toBe("'+41 44");
    expect(auditCsvCell("@cmd")).toBe("'@cmd");
    expect(auditCsvCell(null)).toBe("");
  });

  it("writes BOM, German headers and redacted rows", () => {
    const csv = auditCsvDocument([entry]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [header, row] = csv.slice(1).split("\r\n");
    expect(header).toBe(AUDIT_CSV_HEADERS.join(";"));
    expect(row).toContain(
      "2026-11-07T08:00:00+00:00;Tickets;Ticket geändert;ticket.updated;",
    );
    expect(row).toContain('"Müller; Anna"');
    expect(row).toContain(";Ticket;");
    expect(row).toContain(";Information;");
    expect(csv).toContain("[verborgen]");
    expect(csv).not.toContain("geheim");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
