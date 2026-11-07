import { describe, expect, it } from "vitest";

import type { PriorityItem, PriorityList } from "../lib/my-priorities";
import {
  countSlaBreaches,
  countSlaWarnings,
  formatSnapshotTime,
  mergeWidgetSnapshot,
  parseWidgetSnapshot,
  priorityPartFromList,
  widgetDeepLink,
  type WidgetSnapshot,
} from "../lib/widget-snapshot";

const NOW = new Date("2026-11-07T12:00:00Z");

function ticket(position: number, overrides: Partial<PriorityItem> = {}) {
  return {
    position,
    id: `id-${position}`,
    ticketNumber: `T-${100 + position}`,
    subject: `Betreff ${position}`,
    statusLabel: "Offen",
    priorityLabel: "Hoch",
    resolutionDueAt: null,
    reason: `Grund ${position}`,
    aiRank: position,
    manual: false,
    ...overrides,
  } satisfies PriorityItem;
}

function list(tickets: PriorityItem[]): PriorityList {
  return { rankedAt: null, source: "ai", hasManualOrder: false, tickets };
}

describe("priorityPartFromList", () => {
  it("keeps the top three in position order without extra fields", () => {
    const part = priorityPartFromList(
      list([ticket(4), ticket(2), ticket(1), ticket(3)]),
    );
    expect(part.priorities).toEqual([
      {
        id: "id-1",
        ticketNumber: "T-101",
        subject: "Betreff 1",
        reason: "Grund 1",
      },
      {
        id: "id-2",
        ticketNumber: "T-102",
        subject: "Betreff 2",
        reason: "Grund 2",
      },
      {
        id: "id-3",
        ticketNumber: "T-103",
        subject: "Betreff 3",
        reason: "Grund 3",
      },
    ]);
  });

  it("collects valid due dates of all own tickets, ascending", () => {
    const part = priorityPartFromList(
      list([
        ticket(1, { resolutionDueAt: "2026-11-07T18:00:00Z" }),
        ticket(2, { resolutionDueAt: "kaputt" }),
        ticket(3),
        ticket(4, { resolutionDueAt: "2026-11-07T10:00:00Z" }),
      ]),
    );
    expect(part.slaDueAt).toEqual([
      "2026-11-07T10:00:00.000Z",
      "2026-11-07T18:00:00.000Z",
    ]);
  });

  it("clips long text and normalises whitespace", () => {
    const part = priorityPartFromList(
      list([ticket(1, { subject: `  ${"x".repeat(200)}\n`, reason: null })]),
    );
    expect(part.priorities?.[0]?.subject).toHaveLength(120);
    expect(part.priorities?.[0]?.subject.endsWith("…")).toBe(true);
    expect(part.priorities?.[0]?.reason).toBeNull();
  });
});

describe("mergeWidgetSnapshot", () => {
  it("merges priorities and approvals for the same tenant", () => {
    const first = mergeWidgetSnapshot(
      null,
      { tenantId: "t1", approvals: 2 },
      NOW,
    );
    expect(first.priorities).toBeNull();
    expect(first.approvals).toBe(2);
    const later = new Date("2026-11-07T12:05:00Z");
    const second = mergeWidgetSnapshot(
      first,
      { tenantId: "t1", priorities: list([ticket(1)]) },
      later,
    );
    expect(second.approvals).toBe(2);
    expect(second.priorities).toHaveLength(1);
    expect(second.slaDueAt).toEqual([]);
    expect(second.updatedAt).toBe(later.toISOString());
  });

  it("drops data of a previous tenant", () => {
    const first = mergeWidgetSnapshot(
      null,
      { tenantId: "t1", approvals: 5, priorities: list([ticket(1)]) },
      NOW,
    );
    const second = mergeWidgetSnapshot(
      first,
      { tenantId: "t2", approvals: 1 },
      NOW,
    );
    expect(second).toMatchObject({
      tenantId: "t2",
      approvals: 1,
      priorities: null,
      slaDueAt: null,
    });
  });

  it("never stores negative or fractional approval counts", () => {
    expect(
      mergeWidgetSnapshot(null, { tenantId: "t1", approvals: -3 }, NOW)
        .approvals,
    ).toBe(0);
    expect(
      mergeWidgetSnapshot(null, { tenantId: "t1", approvals: 2.7 }, NOW)
        .approvals,
    ).toBe(2);
  });
});

describe("SLA counts", () => {
  const due = [
    "2026-11-07T11:00:00Z", // overdue
    "2026-11-07T12:00:00Z", // due now
    "2026-11-07T15:59:00Z", // within 4 h
    "2026-11-07T16:00:00Z", // exactly 4 h: not a warning
    "2026-11-08T12:00:00Z",
  ];

  it("counts overdue tickets and those due within four hours", () => {
    expect(countSlaWarnings(due, NOW)).toBe(3);
    expect(countSlaBreaches(due, NOW)).toBe(2);
  });

  it("recounts later from the same due dates", () => {
    expect(countSlaWarnings(due, new Date("2026-11-08T09:00:00Z"))).toBe(5);
  });

  it("stays unknown without due dates", () => {
    expect(countSlaWarnings(null, NOW)).toBeNull();
    expect(countSlaBreaches(null, NOW)).toBeNull();
    expect(countSlaWarnings([], NOW)).toBe(0);
  });
});

describe("parseWidgetSnapshot", () => {
  const valid: WidgetSnapshot = mergeWidgetSnapshot(
    null,
    {
      tenantId: "t1",
      approvals: 1,
      priorities: list([
        ticket(1, { resolutionDueAt: "2026-11-07T13:00:00Z" }),
      ]),
    },
    NOW,
  );

  it("round-trips a stored snapshot", () => {
    expect(parseWidgetSnapshot(JSON.stringify(valid))).toEqual(valid);
  });

  it("rejects malformed or foreign data", () => {
    expect(parseWidgetSnapshot(null)).toBeNull();
    expect(parseWidgetSnapshot("{")).toBeNull();
    expect(parseWidgetSnapshot("[]")).toBeNull();
    expect(
      parseWidgetSnapshot(JSON.stringify({ ...valid, version: 2 })),
    ).toBeNull();
    expect(
      parseWidgetSnapshot(JSON.stringify({ ...valid, updatedAt: "nie" })),
    ).toBeNull();
  });

  it("drops invalid entries and stores no unexpected fields", () => {
    const parsed = parseWidgetSnapshot(
      JSON.stringify({
        ...valid,
        accessToken: "geheim",
        approvals: -1,
        slaDueAt: ["2026-11-07T13:00:00Z", 5, "kaputt"],
        priorities: [
          { id: "a", ticketNumber: "T-1", subject: "S", reason: 3 },
          { id: 1 },
        ],
      }),
    );
    expect(parsed).not.toHaveProperty("accessToken");
    expect(parsed?.approvals).toBeNull();
    expect(parsed?.slaDueAt).toEqual(["2026-11-07T13:00:00Z"]);
    expect(parsed?.priorities).toEqual([
      { id: "a", ticketNumber: "T-1", subject: "S", reason: null },
    ]);
  });
});

describe("formatSnapshotTime", () => {
  it("shows the clock for today and the date otherwise", () => {
    const now = new Date(2026, 10, 7, 18, 30);
    expect(
      formatSnapshotTime(new Date(2026, 10, 7, 9, 5).toISOString(), now),
    ).toBe("Stand 09:05");
    expect(
      formatSnapshotTime(new Date(2026, 10, 6, 23, 59).toISOString(), now),
    ).toBe("Stand 06.11. 23:59");
    expect(formatSnapshotTime("kaputt", now)).toBe("Stand unbekannt");
  });
});

describe("widgetDeepLink", () => {
  it("opens a ticket or «Meine Prioritäten»", () => {
    expect(widgetDeepLink("abc-1")).toBe("ch.grossict.nextdesk://ticket/abc-1");
    expect(widgetDeepLink("a/b")).toBe("ch.grossict.nextdesk://ticket/a%2Fb");
    expect(widgetDeepLink()).toBe("ch.grossict.nextdesk://priorities");
    expect(widgetDeepLink(null)).toBe("ch.grossict.nextdesk://priorities");
  });
});
