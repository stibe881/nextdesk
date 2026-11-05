import { describe, expect, it } from "vitest";
import {
  classificationSource,
  parseTicketSuggestions,
  suggestionRequest,
} from "./ticket-suggestions";

const ID = "0b6a1c1e-4f7a-4d2b-9c1e-2a3b4c5d6e7f";
const OTHER = "1c7b2d2f-5a8b-4e3c-8d2f-3b4c5d6e7f80";

describe("suggestionRequest", () => {
  it("waits for a subject with four characters", () => {
    expect(suggestionRequest(ID, " VPN ", "", "requester")).toBeNull();
    expect(
      suggestionRequest(ID, " WLAN weg ", " seit heute ", "agent"),
    ).toEqual({
      type: "suggest",
      tenantId: ID,
      subject: "WLAN weg",
      description: "seit heute",
      mode: "agent",
    });
  });

  it("shortens long drafts to the server limits", () => {
    const request = suggestionRequest(
      ID,
      "a".repeat(300),
      "b".repeat(5000),
      "requester",
    );
    expect(request?.subject).toHaveLength(240);
    expect(request?.description).toHaveLength(4000);
  });
});

describe("parseTicketSuggestions", () => {
  it("parses articles, duplicates and classification", () => {
    const parsed = parseTicketSuggestions({
      data: {
        mode: "agent",
        articles: [
          {
            id: ID,
            title: "VPN",
            excerpt: "So geht es",
            visibility: "internal",
          },
        ],
        duplicates: [],
        classification: {
          sampleSize: 6,
          category: {
            id: ID,
            name: "Netzwerk",
            departmentId: OTHER,
            matches: 4,
          },
          department: null,
          priority: { id: OTHER, key: "high", name: "Hoch", matches: 3 },
        },
        solvedTickets: [
          {
            id: OTHER,
            ticketNumber: "T-1",
            subject: "VPN",
            statusLabel: "Gelöst",
          },
        ],
      },
    });
    expect(parsed.articles).toHaveLength(1);
    expect(parsed.classification?.category?.departmentId).toBe(OTHER);
    expect(parsed.classification?.priority?.key).toBe("high");
    expect(parsed.classification?.department).toBeNull();
    expect(parsed.solvedTickets[0]?.ticketNumber).toBe("T-1");
  });

  it("rejects invalid data", () => {
    expect(() => parseTicketSuggestions({ data: { mode: "x" } })).toThrow();
    expect(() =>
      parseTicketSuggestions({
        data: {
          mode: "requester",
          articles: [
            { id: "nope", title: "x", excerpt: "", visibility: "external" },
          ],
          duplicates: [],
          classification: null,
          solvedTickets: [],
        },
      }),
    ).toThrow();
    // A single matching ticket is no majority.
    expect(() =>
      parseTicketSuggestions({
        data: {
          mode: "agent",
          articles: [],
          duplicates: [],
          classification: {
            sampleSize: 3,
            category: null,
            department: { id: ID, name: "IT", matches: 1 },
            priority: null,
          },
          solvedTickets: [],
        },
      }),
    ).toThrow();
  });
});

describe("classificationSource", () => {
  it("names the number of similar tickets", () => {
    expect(classificationSource(4)).toBe("aus 4 ähnlichen Tickets");
  });
});
