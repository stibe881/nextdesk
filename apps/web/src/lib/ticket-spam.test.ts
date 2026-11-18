import { describe, expect, it } from "vitest";
import {
  parseSpamReport,
  parseSpamSenders,
  parseSpamTickets,
  spamRange,
} from "./ticket-spam";

describe("ticket-spam", () => {
  it("liest die Spam-Liste und verwirft ungültige Einträge", () => {
    const tickets = parseSpamTickets({
      data: {
        tickets: [
          {
            id: "a",
            ticketNumber: "ICT-1",
            subject: "Gewinn!",
            senderEmail: "x@spam.test",
            spamAt: "2026-11-13T10:00:00Z",
            purgeAt: "2027-02-11T10:00:00Z",
          },
          { id: "b" },
          null,
        ],
      },
    });
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.senderEmail).toBe("x@spam.test");
    expect(parseSpamTickets(null)).toEqual([]);
  });

  it("liest gesperrte Absender und den Bericht", () => {
    expect(
      parseSpamSenders({
        data: { senders: [{ id: "s", email: "a@b.ch", hits: 3 }, {}] },
      }),
    ).toEqual([
      { id: "s", email: "a@b.ch", createdAt: "", hits: 3, lastHitAt: null },
    ]);
    const report = parseSpamReport({
      data: {
        total: 5,
        auto: 3,
        manual: 2,
        blockedSenders: 4,
        perDay: [{ day: "2026-11-13", auto: 3, manual: 2 }],
        topSenders: [
          { sender: "a@b.ch", count: 5, lastAt: "2026-11-13T10:00:00Z" },
        ],
        byDepartment: [{ name: "ICT", count: 5 }],
      },
    });
    expect(report?.total).toBe(5);
    expect(report?.perDay[0]?.manual).toBe(2);
    expect(parseSpamReport({})).toBeNull();
  });

  it("bildet den Berichtszeitraum", () => {
    const { from, to } = spamRange(7, new Date("2026-11-13T12:00:00Z"));
    expect(from).toBe("2026-11-06T12:00:00.000Z");
    expect(Date.parse(to)).toBeGreaterThan(Date.parse("2026-11-13T12:00:00Z"));
  });
});
