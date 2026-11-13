import { describe, expect, it } from "vitest";

import {
  mobileHandoverNoteError,
  mobileSupportLevelLabel,
  parseMobileTicketSupportLevel,
  shouldShowSupportLevelCard,
  mobileSpamResultText,
  parseMobileSpamResult,
} from "../lib/support-levels-model";

describe("Supportstufen (mobil)", () => {
  it("beschriftet Stufen und prüft die Pflichtnotiz", () => {
    expect(mobileSupportLevelLabel(2)).toBe("2nd Level");
    expect(mobileHandoverNoteError("kurz")).toMatch(/mindestens 10 Zeichen/);
    expect(
      mobileHandoverNoteError("Router neu gestartet, Fehler bleibt"),
    ).toBeNull();
    expect(mobileHandoverNoteError("x".repeat(4001))).toMatch(/höchstens/);
  });

  it("liest Stufe, Ziele und Übergabenotiz", () => {
    const state = parseMobileTicketSupportLevel({
      data: {
        levelsConfigured: true,
        currentLevel: 2,
        currentTeam: { id: "t2", name: "Systemtechnik" },
        canHandover: true,
        targets: {
          next: { level: 3, teams: [{ id: "t3", name: "Spezialisten" }] },
          back: [
            { level: 1, teams: [{ id: "t1", name: "Service Desk" }] },
            { level: 1, teams: [] },
          ],
        },
        currentHandover: {
          kind: "escalated",
          fromLevel: 1,
          note: "Router neu gestartet",
          actorName: "Anna",
          createdAt: "2026-11-01T09:00:00Z",
        },
        history: [{}, {}],
      },
    });
    expect(state?.currentLevel).toBe(2);
    expect(state?.currentTeamName).toBe("Systemtechnik");
    expect(state?.next?.level).toBe(3);
    expect(state?.back).toHaveLength(1);
    expect(state?.currentHandover?.note).toBe("Router neu gestartet");
    expect(state?.historyCount).toBe(2);
    expect(shouldShowSupportLevelCard(state)).toBe(true);
  });

  it("blendet die Karte ohne Stufen-Konfiguration aus", () => {
    const state = parseMobileTicketSupportLevel({
      data: {
        levelsConfigured: false,
        currentLevel: null,
        targets: { next: null, back: [] },
        history: [],
      },
    });
    expect(shouldShowSupportLevelCard(state)).toBe(false);
    expect(shouldShowSupportLevelCard(null)).toBe(false);
    expect(parseMobileTicketSupportLevel({ data: {} })).toBeNull();
  });
});

describe("Spam/Phishing einstufen (mobil)", () => {
  it("liest den Spam-Zustand und blendet ihn bei alten Antworten aus", () => {
    const base = { targets: { next: null, back: [] }, history: [] };
    expect(
      parseMobileTicketSupportLevel({
        data: {
          ...base,
          spam: {
            marked: false,
            canMark: true,
            targetTeam: { id: "t2", name: "System Engineer" },
          },
        },
      })?.spam,
    ).toEqual({
      marked: false,
      canMark: true,
      targetTeamName: "System Engineer",
    });
    expect(parseMobileTicketSupportLevel({ data: base })?.spam).toEqual({
      marked: false,
      canMark: false,
      targetTeamName: null,
    });
  });

  it("beschreibt Übergabe und Antwort", () => {
    const result = parseMobileSpamResult({
      data: { teamName: "System Engineer", moved: true, reply: "queued" },
    });
    expect(result).toEqual({
      teamName: "System Engineer",
      moved: true,
      reply: "queued",
    });
    expect(mobileSpamResultText(result!)).toBe(
      "Das Ticket wurde an den 2nd Level (System Engineer) übergeben. Die Standardantwort an die anfragende Person ist unterwegs.",
    );
    expect(
      mobileSpamResultText({
        teamName: "System Engineer",
        moved: false,
        reply: "no_mail_channel",
      }),
    ).toMatch(/kein aktives Exchange-Postfach/);
    expect(parseMobileSpamResult({ data: {} })).toBeNull();
  });
});
