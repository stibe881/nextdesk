import { describe, expect, it } from "vitest";

import {
  parseWorkspaceSearch,
  ticketMatchesSearch,
} from "../lib/ticket-search-model";

const ticket = {
  ticketNumber: "ICT-2026-000158",
  subject: "HIN-Verschlüsselung",
  description: "Telefonnummer hinterlegen",
  status: "Neu",
  priority: "Normal",
  requesterName: "Mathilde Baumeler",
};

describe("Ticketsuche in der App", () => {
  it("findet über Nummer, Betreff und anfragende Person", () => {
    expect(ticketMatchesSearch(ticket, "000158")).toBe(true);
    expect(ticketMatchesSearch(ticket, "baumeler hin")).toBe(true);
    expect(ticketMatchesSearch(ticket, "baumeler vpn")).toBe(false);
  });

  it("liest Tickets und Personen der globalen Suche", () => {
    const result = parseWorkspaceSearch({
      data: {
        results: [
          { resultType: "ticket", ticketId: "t1", title: "ICT-1 · VPN", detail: "Neu" },
          { resultType: "ticket", ticketId: "t1", title: "doppelt" },
          { resultType: "knowledge", ticketId: null, title: "Artikel" },
        ],
        people: [
          {
            kind: "entra",
            id: "11111111-1111-4111-8111-111111111111",
            displayName: "Erwin Müller",
            email: "erwin@example.ch",
            jobTitle: null,
            department: null,
            accountEnabled: true,
            openTicketCount: 2,
          },
        ],
      },
    });
    expect(result.tickets).toEqual([{ ticketId: "t1", title: "ICT-1 · VPN", detail: "Neu" }]);
    expect(result.people.map((person) => person.displayName)).toEqual(["Erwin Müller"]);
  });
});
