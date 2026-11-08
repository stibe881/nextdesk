import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: null }));

import {
  formatLevelMinutes,
  formatRate,
  handoverNoteError,
  levelChangeText,
  parseQueueLevels,
  parseSupportLevelReport,
  parseTicketSupportLevel,
  supportLevelFilterValue,
  supportLevelFromSelect,
  supportLevelLabel,
  supportLevelOfFilter,
} from "./support-levels";

describe("Supportstufen", () => {
  it("beschriftet die Stufen und liest Formular- und Filterwerte", () => {
    expect(supportLevelLabel(1)).toBe("1st Level");
    expect(supportLevelLabel(3)).toBe("3rd Level");
    expect(supportLevelFromSelect("2")).toBe(2);
    expect(supportLevelFromSelect("")).toBeNull();
    expect(supportLevelFromSelect("4")).toBeNull();
    expect(supportLevelFilterValue("2")).toBe("2");
    expect(supportLevelFilterValue("5")).toBeNull();
    expect(supportLevelOfFilter("all")).toBeNull();
    expect(supportLevelOfFilter("3")).toBe(3);
  });

  it("verlangt eine aussagekräftige Übergabenotiz", () => {
    expect(handoverNoteError("  kurz ")).toMatch(/mindestens 10 Zeichen/);
    expect(handoverNoteError("Neustart geprüft, Fehler bleibt")).toBeNull();
    expect(handoverNoteError("x".repeat(4001))).toMatch(/höchstens/);
  });

  it("beschreibt Stufenwechsel und formatiert Kennzahlen", () => {
    expect(
      levelChangeText({
        kind: "escalated",
        fromLevel: 1,
        toLevel: 2,
        teamName: "Systemtechnik",
      }),
    ).toBe("Übergabe an 2nd Level (Systemtechnik)");
    expect(
      levelChangeText({
        kind: "returned",
        fromLevel: 2,
        toLevel: 1,
        teamName: null,
      }),
    ).toBe("Zurück an 1st Level");
    expect(
      levelChangeText({
        kind: "cleared",
        fromLevel: 2,
        toLevel: null,
        teamName: "Projekt",
      }),
    ).toBe("2nd Level verlassen (Projekt)");
    expect(formatLevelMinutes(null)).toBe("–");
    expect(formatLevelMinutes(45)).toBe("45 Min.");
    expect(formatLevelMinutes(80)).toBe("1 Std. 20 Min.");
    expect(formatLevelMinutes(4320)).toBe("3 Tage");
    expect(formatRate(0.667)).toBe("66.7 %");
    expect(formatRate(null)).toBe("–");
  });

  it("liest den Ticketzustand robust", () => {
    const parsed = parseTicketSupportLevel({
      data: {
        levelsConfigured: true,
        currentLevel: 2,
        currentTeam: { id: "t2", name: "Systemtechnik" },
        ticketClosed: false,
        canHandover: true,
        targets: {
          next: { level: 3, teams: [{ id: "t3", name: "Spezialisten" }] },
          back: [
            { level: 1, teams: [{ id: "t1", name: "Service Desk" }] },
            { level: 9, teams: [{ id: "x", name: "Ungültig" }] },
          ],
        },
        currentHandover: {
          id: "c1",
          kind: "escalated",
          fromLevel: 1,
          toLevel: 2,
          teamName: "Systemtechnik",
          note: "Neustart geprüft",
          actorName: "Anna",
          createdAt: "2026-11-01T09:00:00Z",
        },
        history: [{ id: "bad" }],
      },
    });
    expect(parsed?.currentLevel).toBe(2);
    expect(parsed?.targets.next?.teams).toHaveLength(1);
    expect(parsed?.targets.back).toEqual([
      { level: 1, teams: [{ id: "t1", name: "Service Desk" }] },
    ]);
    expect(parsed?.currentHandover?.note).toBe("Neustart geprüft");
    expect(parsed?.history).toEqual([]);
    expect(parseTicketSupportLevel({ data: {} })).toBeNull();
  });

  it("liest Bericht und Warteschlangen-Stufen", () => {
    const report = parseSupportLevelReport({
      data: {
        levelsConfigured: true,
        firstLevelResolution: {
          resolvedTickets: 10,
          resolvedAtFirstLevel: 7,
          rate: 0.7,
        },
        escalations: 3,
        returns: 1,
        escalationsByCategory: [
          {
            categoryId: "c1",
            categoryName: "Netzwerk",
            escalations: 2,
            tickets: 2,
          },
        ],
        averageTimeByLevel: [
          { level: 1, averageMinutes: 30, tickets: 10 },
          { level: 2, averageMinutes: null, tickets: 0 },
        ],
      },
    });
    expect(report?.firstLevelResolution.rate).toBe(0.7);
    expect(report?.escalationsByCategory[0]?.categoryName).toBe("Netzwerk");
    expect(report?.averageTimeByLevel[1]?.averageMinutes).toBeNull();
    expect(parseSupportLevelReport({ data: null })).toBeNull();
    expect(
      parseQueueLevels({
        data: { levels: [{ level: 1 }, { level: 7 }, { level: 2 }] },
      }),
    ).toEqual([1, 2]);
    expect(parseQueueLevels(null)).toEqual([]);
  });
});
