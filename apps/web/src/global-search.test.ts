import { describe, expect, it } from "vitest";
import {
  filterGlobalSearchResults,
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
    detail: "Persönliche Wiedervorlage",
    entityId: "follow-up-1",
    resultType: "follow_up",
    section: "Wiedervorlagen",
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
});
