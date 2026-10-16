import { describe, expect, it } from "vitest";
import type { DashboardTicket } from "../dashboard-data";
import {
  matchesTicketSearch,
  parseTicketSearch,
  removeTicketSearchClause,
} from "./ticket-search";

const ticket: DashboardTicket = {
  age: "12 min",
  assignedToCurrentUser: true,
  id: "ICT-2026-0142",
  isClosed: false,
  isUnassigned: false,
  priority: "Hoch",
  queue: "ict",
  queueLabel: "ICT Support",
  risk: "kritisch",
  sla: "SLA in 42 min",
  state: "In Bearbeitung",
  subject: "VPN-Verbindung bricht intermittierend ab",
};

describe("Ticket-Suchsyntax", () => {
  it("erkennt Status, Priorität, Queue und SLA-Risiko als Filter-Chips", () => {
    const search = parseTicketSearch(
      "status:offen prio:hoch queue:ict sla:kritisch VPN",
    );

    expect(search.chips.map((chip) => chip.label)).toEqual([
      "Status: offen",
      "Priorität: hoch",
      "Queue: ict",
      "SLA-Risiko: kritisch",
    ]);
    expect(search.freeText).toEqual(["VPN"]);
    expect(matchesTicketSearch(ticket, search)).toBe(true);
  });

  it("unterstützt Ticketnummer und persönliche oder unzugewiesene Auswahl", () => {
    expect(
      matchesTicketSearch(ticket, parseTicketSearch("ticket:0142 agent:mir")),
    ).toBe(true);
    expect(
      matchesTicketSearch(ticket, parseTicketSearch("zuweisung:unzugewiesen")),
    ).toBe(false);
  });

  it("belässt unbekannte Syntax als sichere Freitextsuche", () => {
    const search = parseTicketSearch("service:VPN Verbindung");

    expect(search.chips).toEqual([]);
    expect(search.freeText).toEqual(["service:VPN", "Verbindung"]);
    expect(matchesTicketSearch(ticket, search)).toBe(false);
  });

  it("entfernt einzelne Filterklauseln ohne andere Suchbegriffe zu verlieren", () => {
    expect(
      removeTicketSearchClause("status:offen prio:hoch VPN", "prio:hoch"),
    ).toBe("status:offen VPN");
  });
});
