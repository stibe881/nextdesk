import { describe, expect, it } from "vitest";
import {
  daysUntilPurge,
  parseDeletedTicket,
  parseDeletedTickets,
} from "./ticket-trash";

const row = {
  id: "t1",
  ticketNumber: "ICT-1",
  subject: "Drucker",
  deletedAt: "2026-11-01T10:00:00Z",
  purgeAt: "2027-01-30T10:00:00Z",
};

describe("Papierkorb", () => {
  it("liest die Liste und verwirft ungültige Einträge", () => {
    const list = parseDeletedTickets({
      data: { tickets: [row, { id: "x" }, null] },
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.ticketNumber).toBe("ICT-1");
    expect(parseDeletedTickets(null)).toEqual([]);
  });

  it("liest das Detail mit Verlauf", () => {
    const detail = parseDeletedTicket({
      data: {
        ticket: {
          ...row,
          description: "Geht nicht",
          comments: [
            { id: "c1", body: "Hallo", internal: true, createdAt: "x" },
            { body: "ohne id" },
          ],
          attachmentNames: ["log.txt", 3],
        },
      },
    });
    expect(detail?.comments).toHaveLength(1);
    expect(detail?.comments[0]?.internal).toBe(true);
    expect(detail?.attachmentNames).toEqual(["log.txt"]);
  });

  it("rechnet die verbleibenden Tage", () => {
    const now = Date.parse("2027-01-28T10:00:00Z");
    expect(daysUntilPurge("2027-01-30T10:00:00Z", now)).toBe(2);
    expect(daysUntilPurge("2027-01-28T09:00:00Z", now)).toBe(0);
    expect(daysUntilPurge("kaputt", now)).toBe(0);
  });
});
