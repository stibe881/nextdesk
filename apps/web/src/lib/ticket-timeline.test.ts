import { describe, expect, it } from "vitest";
import {
  buildTicketTimeline,
  formatTimelineDuration,
  timelinePosition,
  timelineSequence,
  type TimelineInput,
} from "./ticket-timeline";

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-02T08:00:00.000Z");
const at = (hours: number) => new Date(T0 + hours * HOUR).toISOString();

const statuses = [
  { key: "new", label: "Neu", isClosed: false },
  { key: "in_progress", label: "In Bearbeitung", isClosed: false },
  {
    key: "waiting_vendor",
    label: "Wartend auf Drittanbieter",
    isClosed: false,
  },
  { key: "resolved", label: "Gelöst", isClosed: true },
];

function input(overrides: Partial<TimelineInput> = {}): TimelineInput {
  return {
    ticket: {
      createdAt: at(0),
      firstRespondedAt: null,
      responseDueAt: null,
      resolutionDueAt: null,
      resolvedAt: null,
      closedAt: null,
      isClosed: false,
    },
    events: [],
    comments: [],
    vendorCases: [],
    children: [],
    statuses,
    ...overrides,
  };
}

function statusEvent(id: string, hours: number, toStatusKey: string) {
  return {
    id,
    type: "ticket.updated",
    createdAt: at(hours),
    payload: {
      changedFields: ["status"],
      statusTransition: {
        toStatusKey,
        isClosed: toStatusKey === "resolved",
      },
    },
  };
}

describe("Ticket-Zeitachse", () => {
  it("formatiert Dauern verständlich", () => {
    expect(formatTimelineDuration(45 * 60000)).toBe("45 Min.");
    expect(formatTimelineDuration(3 * HOUR + 20 * 60000)).toBe(
      "3 Std. 20 Min.",
    );
    expect(formatTimelineDuration(5 * HOUR)).toBe("5 Std.");
    expect(formatTimelineDuration(24 * HOUR)).toBe("1 Tag");
    expect(formatTimelineDuration(52 * HOUR)).toBe("2 Tage 4 Std.");
  });

  it("ordnet Status, Zuweisung, Antworten und Notizen chronologisch", () => {
    const timeline = buildTicketTimeline(
      input({
        ticket: {
          ...input().ticket,
          firstRespondedAt: at(1),
        },
        events: [
          {
            id: "e1",
            type: "ticket.updated",
            createdAt: at(0.5),
            payload: { changedFields: ["assignedAgent"] },
          },
          statusEvent("e2", 0.75, "in_progress"),
        ],
        comments: [
          {
            id: "c1",
            visibility: "external",
            createdAt: at(1),
            fromRequester: false,
          },
          {
            id: "c2",
            visibility: "internal",
            createdAt: at(2),
            fromRequester: false,
          },
          {
            id: "c3",
            visibility: "external",
            createdAt: at(3),
            fromRequester: true,
          },
        ],
      }),
      T0 + 4 * HOUR,
    );
    expect(timeline.entries.map((entry) => entry.kind)).toEqual([
      "created",
      "assignment",
      "status",
      "agent_reply",
      "first_response",
      "internal_note",
      "requester_reply",
    ]);
    expect(timeline.entries[2]?.title).toBe("Status: In Bearbeitung");
    expect(timeline.entries[4]?.detail).toBe("nach 1 Std.");
    expect(timeline.gaps).toEqual([]);
  });

  it("zeigt bei pausierter SLA die Restzeit statt einer Verletzung", () => {
    const timeline = buildTicketTimeline(
      input({
        ticket: {
          ...input().ticket,
          responseDueAt: at(1),
          resolutionDueAt: at(6),
          slaPausedAt: at(2),
        },
      }),
      T0 + 10 * HOUR,
    );
    // Response target was missed before the pause: stays breached.
    expect(
      timeline.entries.find((entry) => entry.id === "sla-response"),
    ).toMatchObject({ tone: "danger", future: false });
    // Resolution target was running: frozen, 4 h left after resume.
    expect(
      timeline.entries.find((entry) => entry.id === "sla-resolution"),
    ).toMatchObject({
      tone: "neutral",
      future: true,
      time: T0 + 14 * HOUR,
      detail: `SLA pausiert, Restzeit ${formatTimelineDuration(4 * HOUR)}`,
    });
  });

  it("bewertet SLA-Fristen als eingehalten, verletzt oder offen", () => {
    const met = buildTicketTimeline(
      input({
        ticket: {
          ...input().ticket,
          firstRespondedAt: at(1),
          responseDueAt: at(2),
          resolutionDueAt: at(10),
        },
      }),
      T0 + 3 * HOUR,
    );
    const response = met.entries.find((entry) => entry.id === "sla-response");
    const resolution = met.entries.find(
      (entry) => entry.id === "sla-resolution",
    );
    expect(response).toMatchObject({ tone: "success", detail: "eingehalten" });
    expect(resolution).toMatchObject({ future: true, tone: "neutral" });

    const breached = buildTicketTimeline(
      input({ ticket: { ...input().ticket, responseDueAt: at(2) } }),
      T0 + 5 * HOUR,
    );
    expect(
      breached.entries.find((entry) => entry.id === "sla-response"),
    ).toMatchObject({ tone: "danger", future: false });

    const late = buildTicketTimeline(
      input({
        ticket: {
          ...input().ticket,
          firstRespondedAt: at(3),
          responseDueAt: at(2),
        },
      }),
      T0 + 5 * HOUR,
    );
    expect(
      late.entries.find((entry) => entry.id === "sla-response")?.detail,
    ).toBe("verletzt um 1 Std.");
  });

  it("hebt lange Wartezeiten beim Drittanbieter als Lücke hervor", () => {
    const timeline = buildTicketTimeline(
      input({
        events: [
          statusEvent("e1", 1, "in_progress"),
          {
            id: "e2",
            type: "ticket.vendor_case_opened",
            createdAt: at(2),
            payload: { vendorName: "Swisscom", externalCaseNumber: "SC-1" },
          },
          statusEvent("e3", 2, "waiting_vendor"),
          {
            id: "e4",
            type: "ticket.vendor_update",
            createdAt: at(74),
            payload: { vendorName: "Swisscom", note: "Techniker kommt" },
          },
        ],
        vendorCases: [
          {
            id: "v1",
            vendorName: "Swisscom",
            externalCaseNumber: "SC-1",
            openedAt: at(2),
            closedAt: null,
          },
        ],
      }),
      T0 + 80 * HOUR,
    );
    expect(timeline.gaps).toHaveLength(1);
    expect(timeline.gaps[0]).toMatchObject({
      reason: "waiting_vendor",
      durationMs: 72 * HOUR,
      ongoing: false,
      label: "Wartet auf Drittanbieter · 3 Tage",
    });
    const vendor = timeline.periods.find((period) => period.kind === "vendor");
    expect(vendor).toMatchObject({ label: "Swisscom (SC-1)", end: null });
    const waiting = timeline.periods.find(
      (period) => period.kind === "waiting",
    );
    expect(waiting).toMatchObject({ label: "Wartend auf Drittanbieter" });
    const sequence = timelineSequence(timeline);
    const gapIndex = sequence.findIndex((item) => item.type === "gap");
    const next = sequence[gapIndex + 1];
    expect(next?.type === "entry" && next.entry.title).toBe(
      "Rückmeldung von Swisscom",
    );
  });

  it("meldet eine laufende Lücke bei offenen Tickets ohne Aktivität", () => {
    const timeline = buildTicketTimeline(input(), T0 + 30 * HOUR);
    expect(timeline.gaps).toHaveLength(1);
    expect(timeline.gaps[0]).toMatchObject({ reason: "idle", ongoing: true });
    expect(timeline.end).toBe(T0 + 30 * HOUR);
  });

  it("zeigt Teil-Tickets als Zeitraum und erkennt den Abschluss", () => {
    const timeline = buildTicketTimeline(
      input({
        ticket: {
          ...input().ticket,
          resolvedAt: at(6),
          closedAt: at(6),
          isClosed: true,
        },
        events: [
          {
            id: "s1",
            type: "ticket.split",
            createdAt: at(1),
            payload: { children: ["IT-1", "HR-2"] },
          },
          {
            id: "d1",
            type: "ticket.children_done",
            createdAt: at(5),
            payload: { lastChildTicketNumber: "HR-2" },
          },
        ],
        children: [
          {
            id: "k1",
            ticketNumber: "IT-1",
            createdAt: at(1),
            resolvedAt: at(3),
            closedAt: at(3),
            isClosed: true,
          },
          {
            id: "k2",
            ticketNumber: "HR-2",
            createdAt: at(1),
            resolvedAt: null,
            closedAt: null,
            isClosed: false,
          },
        ],
      }),
      T0 + 10 * HOUR,
    );
    expect(timeline.entries.find((entry) => entry.id === "s1")?.title).toBe(
      "Aufgeteilt in 2 Teil-Tickets",
    );
    expect(timeline.entries.at(-1)).toMatchObject({
      kind: "resolved",
      title: "Gelöst",
    });
    const childPeriods = timeline.periods.filter(
      (period) => period.kind === "child",
    );
    expect(childPeriods.map((period) => period.end)).toEqual([
      T0 + 3 * HOUR,
      null,
    ]);
    expect(timeline.gaps).toEqual([]);
  });

  it("berechnet Positionen begrenzt auf 0 bis 100 Prozent", () => {
    const span = { start: 0, end: 200 };
    expect(timelinePosition(span, 50)).toBe(25);
    expect(timelinePosition(span, -10)).toBe(0);
    expect(timelinePosition(span, 500)).toBe(100);
    expect(timelinePosition({ start: 5, end: 5 }, 5)).toBe(0);
  });
});
