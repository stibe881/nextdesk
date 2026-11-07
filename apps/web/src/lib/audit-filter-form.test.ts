import { describe, expect, it } from "vitest";

import {
  activeAuditFilterCount,
  auditActionGroups,
  auditExportFileName,
  auditFiltersFromForm,
  csvWithBom,
  EMPTY_AUDIT_FILTER_FORM,
  localDayBoundary,
} from "./audit-filter-form";
import { parseAuditFilters } from "./audit-view";

describe("auditFiltersFromForm", () => {
  it("returns no filters for an empty form", () => {
    expect(auditFiltersFromForm(EMPTY_AUDIT_FILTER_FORM)).toEqual({});
    expect(activeAuditFilterCount({})).toBe(0);
  });

  it("converts form values into server filters", () => {
    const filters = auditFiltersFromForm({
      ...EMPTY_AUDIT_FILTER_FORM,
      actorId: "00000000-0000-4000-8000-000000000001",
      actorLabel: "Anna",
      action: "area:users",
      entityType: "ticket",
      severity: "security",
      from: "2026-11-01",
      to: "2026-11-07",
      freeText: "  rolle ",
    });
    expect(filters).toMatchObject({
      actorId: "00000000-0000-4000-8000-000000000001",
      area: "users",
      entityType: "ticket",
      severity: "security",
      freeText: "rolle",
    });
    expect(filters.startAt).toBe(localDayBoundary("2026-11-01", "start"));
    expect(filters.endAt).toBe(localDayBoundary("2026-11-07", "end"));
    expect(activeAuditFilterCount(filters)).toBe(7);
    // The server accepts what the form produces.
    expect(parseAuditFilters(filters)).toEqual(filters);
  });

  it("supports single actions and ignores invalid values", () => {
    expect(
      auditFiltersFromForm({
        ...EMPTY_AUDIT_FILTER_FORM,
        action: "action:ticket.deleted",
        severity: "debug",
        from: "31.12.2026",
      }),
    ).toEqual({ action: "ticket.deleted" });
    expect(
      auditFiltersFromForm({ ...EMPTY_AUDIT_FILTER_FORM, action: "area:x" }),
    ).toEqual({});
  });

  it("swaps a reversed period", () => {
    const filters = auditFiltersFromForm({
      ...EMPTY_AUDIT_FILTER_FORM,
      from: "2026-11-07",
      to: "2026-11-01",
    });
    expect(filters.startAt).toBe(localDayBoundary("2026-11-01", "start"));
    expect(filters.endAt).toBe(localDayBoundary("2026-11-07", "end"));
  });
});

describe("localDayBoundary", () => {
  it("rejects impossible dates", () => {
    expect(localDayBoundary("2026-02-30", "start")).toBeNull();
    expect(localDayBoundary("", "end")).toBeNull();
  });

  it("covers the full local day", () => {
    const start = Date.parse(localDayBoundary("2026-11-07", "start") ?? "");
    const end = Date.parse(localDayBoundary("2026-11-07", "end") ?? "");
    expect(end - start).toBe(24 * 60 * 60 * 1000 - 1);
  });
});

describe("auditActionGroups", () => {
  it("groups actions by area with an «all» option first", () => {
    const groups = auditActionGroups();
    const users = groups.find((group) => group.area === "users");
    expect(users?.label).toBe("Benutzer & Rollen");
    expect(users?.options[0]).toEqual({
      value: "area:users",
      label: "Alle Aktionen: Benutzer & Rollen",
    });
    expect(users?.options).toContainEqual({
      value: "action:tenant.role.assigned",
      label: "Rolle zugewiesen",
    });
    const tickets = groups.find((group) => group.area === "tickets");
    const created = tickets?.options.filter((option) =>
      option.label.startsWith("Ticket erstellt"),
    );
    expect(created?.map((option) => option.label)).toEqual([
      "Ticket erstellt (ticket.created)",
      "Ticket erstellt (tickets.insert)",
    ]);
  });
});

describe("export helpers", () => {
  it("adds a BOM only once", () => {
    expect(csvWithBom("a;b")).toBe("﻿a;b");
    expect(csvWithBom("﻿a;b")).toBe("﻿a;b");
  });

  it("names export files by date", () => {
    expect(auditExportFileName("json", new Date(2026, 10, 7))).toBe(
      "nextdesk-audit-2026-11-07.json",
    );
  });
});
