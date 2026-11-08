import { describe, expect, it } from "vitest";
import {
  formatDuration,
  parsePersonOverview,
  parsePersonSearchHits,
  personInitials,
  personRefFromHit,
  personTimeline,
} from "./person-overview";

const ID = "83448fd3-cdbe-433b-92d2-a9e25fffbb41";

describe("person overview", () => {
  it("parses people search hits and builds references", () => {
    const hits = parsePersonSearchHits([
      {
        kind: "entra",
        id: ID,
        displayName: "Anna Müller",
        email: "anna@example.ch",
        jobTitle: null,
        department: "Finanzen",
        accountEnabled: false,
        openTicketCount: 2,
      },
      { kind: "other", id: ID, displayName: "x" },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.accountEnabled).toBe(false);
    expect(personRefFromHit(hits[0]!)).toEqual({
      entraObjectId: ID,
      displayName: "Anna Müller",
    });
  });

  it("parses the overview and keeps restricted areas as null", () => {
    const overview = parsePersonOverview({
      data: {
        person: { displayName: "Anna Müller", source: "entra" },
        stats: { openTickets: 2, avgResolutionHours: "6.4" },
        satisfaction: { ratingCount: 2, average: null, minimumRatings: 3 },
        tickets: [
          {
            id: "t1",
            subject: "Laptop",
            createdAt: "2026-10-01T08:00:00Z",
            closedAt: "2026-10-02T08:00:00Z",
            isClosed: true,
            statusLabel: "Gelöst",
          },
        ],
        devices: null,
        licenses: [],
      },
    });
    expect(overview?.stats.avgResolutionHours).toBe(6.4);
    expect(overview?.satisfaction.average).toBeNull();
    expect(overview?.devices).toBeNull();
    expect(overview?.licenses).toEqual([]);
    expect(overview?.orders).toBeNull();
    const timeline = personTimeline(overview!);
    expect(timeline.map((entry) => entry.kind)).toEqual([
      "ticket_closed",
      "ticket_created",
    ]);
  });

  it("formats initials and durations", () => {
    expect(personInitials("Anna Müller-Kunz")).toBe("AK");
    expect(personInitials("Peter")).toBe("P");
    expect(formatDuration(null)).toBe("–");
    expect(formatDuration(6.4)).toBe("6.4 h");
    expect(formatDuration(72)).toBe("3.0 Tage");
  });
});
