import { describe, expect, it } from "vitest";
import {
  filterGlobalSearchResults,
  parseResults,
  type GlobalSearchResult,
} from "./global-search";

const results: readonly GlobalSearchResult[] = [
  {
    detail: "Ticketdetail",
    entityId: "ticket-1",
    resultType: "ticket",
    section: "Tickets",
    ticketId: "ticket-1",
    title: "Drucker prüfen",
  },
  {
    detail: "Persönliche Erinnerung",
    entityId: "follow-up-1",
    resultType: "follow_up",
    section: "Erinnerungen",
    ticketId: null,
    title: "Rückmeldung einholen",
  },
  {
    detail: "Interner Artikel",
    entityId: "knowledge-1",
    resultType: "knowledge",
    section: "Wissen",
    ticketId: null,
    title: "WLAN einrichten",
  },
];

describe("globale Suche", () => {
  it("zeigt reinen Anfragenden ausschliesslich Ticketresultate", () => {
    expect(
      filterGlobalSearchResults(results, "tickets-only").map(
        (result) => result.resultType,
      ),
    ).toEqual(["ticket"]);
  });

  it("erhält den vollständigen berechtigten Suchumfang für Ticketarbeit", () => {
    expect(filterGlobalSearchResults(results, "all")).toEqual(results);
  });

  it("liest Störungen und Phishing-/Junk-Fälle", () => {
    const parsed = parseResults({
      data: {
        results: [
          {
            resultType: "incident",
            entityId: "incident-1",
            title: "STO-12 · Switch Haus A",
            detail: "Aktiv",
            section: "Störungen",
            ticketId: null,
          },
          {
            resultType: "security_case",
            entityId: "case-1",
            title: "SEC-3 · Rechnung",
            detail: "Zu beurteilen",
            section: "Phishing / Junk",
            ticketId: null,
          },
        ],
      },
    });
    expect(parsed?.map((result) => result.resultType)).toEqual([
      "incident",
      "security_case",
    ]);
    expect(filterGlobalSearchResults(parsed ?? [], "tickets-only")).toEqual([]);
    expect(
      parseResults({
        data: {
          results: [
            {
              resultType: "security_case",
              entityId: "case-2",
              title: "SEC-4 · Mahnung",
              detail: "Zu beurteilen",
              section: "Sicherheitsfälle",
              ticketId: null,
            },
            {
              resultType: "follow_up",
              entityId: "follow-up-1",
              title: "Rückruf",
              detail: "Heute",
              section: "Wiedervorlagen",
              ticketId: null,
            },
          ],
        },
      })?.map((result) => result.section),
    ).toEqual(["Phishing / Junk", "Erinnerungen"]);
    expect(
      parseResults({
        data: {
          results: [
            {
              resultType: "virus",
              entityId: "x",
              title: "x",
              detail: "x",
              section: "Störungen",
              ticketId: null,
            },
          ],
        },
      }),
    ).toBeNull();
  });
});
