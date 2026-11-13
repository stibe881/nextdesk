import { describe, expect, it } from "vitest";

import type { PriorityList } from "../lib/my-priorities";
import { openSlaPause, slaPausedLabel } from "../lib/sla-pause";
import { priorityPartFromList } from "../lib/widget-snapshot";

const NOW = Date.parse("2026-11-13T15:00:00Z"); // 16:00 in Zürich

describe("SLA-Pause", () => {
  it("zeigt den Beginn der Pause statt einer Frist", () => {
    expect(slaPausedLabel("2026-11-13T13:30:00Z", NOW)).toBe(
      "SLA pausiert seit 14:30",
    );
    expect(slaPausedLabel("2026-11-10T08:05:00Z", NOW)).toBe(
      "SLA pausiert seit 10.11.2026, 09:05",
    );
    expect(slaPausedLabel(null, NOW)).toBeNull();
    expect(slaPausedLabel("kaputt", NOW)).toBe("SLA pausiert");
  });

  it("gilt nur für offene Tickets", () => {
    expect(openSlaPause("2026-11-13T13:30:00Z", false)).toBe(
      "2026-11-13T13:30:00Z",
    );
    expect(openSlaPause("2026-11-13T13:30:00Z", true)).toBeNull();
    expect(openSlaPause(null, false)).toBeNull();
  });

  it("zählt pausierte Tickets im Widget nicht als fällig", () => {
    const list: PriorityList = {
      rankedAt: null,
      source: "rules",
      hasManualOrder: false,
      tickets: [
        {
          position: 1,
          id: "a",
          ticketNumber: "T-1",
          subject: "Wartet",
          statusLabel: "Wartend auf Kunde",
          priorityLabel: "Hoch",
          resolutionDueAt: "2026-11-13T12:00:00Z",
          slaPausedAt: "2026-11-13T10:00:00Z",
          reason: null,
          aiRank: null,
          manual: false,
        },
        {
          position: 2,
          id: "b",
          ticketNumber: "T-2",
          subject: "Läuft",
          statusLabel: "In Bearbeitung",
          priorityLabel: "Hoch",
          resolutionDueAt: "2026-11-13T14:00:00Z",
          reason: null,
          aiRank: null,
          manual: false,
        },
      ],
    };
    expect(priorityPartFromList(list).slaDueAt).toEqual([
      "2026-11-13T14:00:00.000Z",
    ]);
  });
});
