import { describe, expect, it } from "vitest";
import { formatDueAt } from "./live-dashboard";
import {
  formatPausedServiceMinutes,
  formatPauseStart,
  parseSlaStatuses,
  slaPausedLabel,
  slaPauseEventLabel,
} from "./sla-pause";
import { buildTicketTimeline } from "./ticket-timeline";

const NOW = Date.parse("2026-11-13T15:00:00Z"); // 16:00 in Zurich

describe("SLA-Pause", () => {
  it("shows the pause start instead of a countdown", () => {
    expect(formatPauseStart("2026-11-13T13:30:00Z", NOW)).toBe("14:30");
    expect(formatPauseStart("2026-11-10T08:05:00Z", NOW)).toBe(
      "10.11.2026, 09:05",
    );
    expect(slaPausedLabel("2026-11-13T13:30:00Z", NOW)).toBe(
      "SLA pausiert seit 14:30",
    );
    expect(slaPausedLabel(null, NOW)).toBeNull();
    expect(slaPausedLabel("kein Datum", NOW)).toBe("SLA pausiert");
  });

  it("treats a paused ticket as not due in the list", () => {
    const overdue = new Date(Date.now() - 60_000).toISOString();
    expect(formatDueAt(overdue).risk).toBe("kritisch");
    const paused = formatDueAt(overdue, new Date().toISOString());
    expect(paused.risk).toBe("ok");
    expect(paused.label.startsWith("SLA pausiert seit ")).toBe(true);
  });

  it("labels pause and resume events", () => {
    expect(
      slaPauseEventLabel("ticket.sla.paused", {
        reason: "status",
        statusLabel: "Wartend auf Kunde",
      }),
    ).toBe("SLA pausiert («Wartend auf Kunde»)");
    expect(
      slaPauseEventLabel("ticket.sla.resumed", {
        reason: "status",
        pausedServiceMinutes: 135,
      }),
    ).toBe("SLA fortgesetzt, Fristen um 2 Std. 15 Min. Servicezeit verschoben");
    expect(
      slaPauseEventLabel("ticket.sla.resumed", {
        reason: "closed",
        pausedServiceMinutes: 0,
      }),
    ).toBe("SLA-Pause beendet (abgeschlossen)");
    expect(slaPauseEventLabel("ticket.created", {})).toBeNull();
    expect(formatPausedServiceMinutes(45)).toBe("45 Min.");
    expect(formatPausedServiceMinutes(120)).toBe("2 Std.");
  });

  it("parses the status settings and never pauses closed statuses", () => {
    expect(
      parseSlaStatuses([
        {
          id: "a",
          key: "waiting_customer",
          label: "Wartend auf Kunde",
          isClosed: false,
          pausesSla: true,
        },
        {
          id: "b",
          key: "closed",
          label: "Geschlossen",
          isClosed: true,
          pausesSla: true,
        },
        { id: 3 },
      ]),
    ).toEqual([
      {
        id: "a",
        key: "waiting_customer",
        label: "Wartend auf Kunde",
        isClosed: false,
        pausesSla: true,
      },
      {
        id: "b",
        key: "closed",
        label: "Geschlossen",
        isClosed: true,
        pausesSla: false,
      },
    ]);
    expect(parseSlaStatuses(undefined)).toEqual([]);
  });

  it("puts pause and resume into the ticket timeline", () => {
    const timeline = buildTicketTimeline(
      {
        ticket: {
          createdAt: "2026-11-10T08:00:00Z",
          firstRespondedAt: null,
          responseDueAt: null,
          resolutionDueAt: null,
          resolvedAt: null,
          closedAt: null,
          isClosed: false,
        },
        events: [
          {
            id: "p",
            type: "ticket.sla.paused",
            createdAt: "2026-11-10T09:00:00Z",
            payload: { reason: "status", statusLabel: "Wartend" },
          },
          {
            id: "r",
            type: "ticket.sla.resumed",
            createdAt: "2026-11-11T09:00:00Z",
            payload: { reason: "status", pausedServiceMinutes: 540 },
          },
        ],
        comments: [],
        vendorCases: [],
        children: [],
        statuses: [],
      },
      NOW,
    );
    const titles = timeline.entries
      .filter((entry) => entry.kind === "sla_pause")
      .map((entry) => entry.title);
    expect(titles).toEqual([
      "SLA pausiert («Wartend»)",
      "SLA fortgesetzt, Fristen um 9 Std. Servicezeit verschoben",
    ]);
  });
});
