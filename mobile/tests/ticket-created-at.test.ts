import { describe, expect, it } from "vitest";

import { formatTicketCreatedAt } from "../lib/ticket-created-at";

const now = new Date(2026, 10, 9, 18, 52);

describe("Erstellzeit auf Ticketkarten", () => {
  it("zeigt heute und gestern mit Uhrzeit", () => {
    expect(
      formatTicketCreatedAt(new Date(2026, 10, 9, 14, 32).toISOString(), now),
    ).toMatch(/^Erstellt heute, 14.32$/);
    expect(
      formatTicketCreatedAt(new Date(2026, 10, 8, 9, 5).toISOString(), now),
    ).toMatch(/^Erstellt gestern, 09.05$/);
  });

  it("zeigt ältere Tickets mit Datum und Uhrzeit", () => {
    expect(
      formatTicketCreatedAt(new Date(2026, 10, 3, 9, 12).toISOString(), now),
    ).toMatch(/^Erstellt 03\.11\.2026, 09.12$/);
  });

  it("gibt bei fehlender oder ungültiger Zeit nichts zurück", () => {
    expect(formatTicketCreatedAt(null, now)).toBeNull();
    expect(formatTicketCreatedAt("", now)).toBeNull();
    expect(formatTicketCreatedAt("kein Datum", now)).toBeNull();
  });
});
