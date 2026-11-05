import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { name: string; body: Record<string, unknown> }[] = [];
let failAssignment = false;

vi.mock("../lib/nextdesk-client", () => ({
  invokeNextDesk: async (name: string, body: Record<string, unknown>) => {
    calls.push({ name, body });
    if (name === "ticket-agent-assignment" && failAssignment)
      throw new Error("forbidden");
    return { data: {} };
  },
}));

const {
  classificationSource,
  parseTicketSuggestions,
  recordSuggestionOutcome,
  resolveSuggestionMode,
  suggestedTicketLabel,
  suggestionRequest,
} = await import("../lib/mobile-ticket-suggestions");

const TENANT = "0b6a1c1e-4f7a-4d2b-9c1e-2a3b4c5d6e7f";
const ID = "1c7b2d2f-5a8b-4e3c-8d2f-3b4c5d6e7f80";

beforeEach(() => {
  calls.length = 0;
  failAssignment = false;
});

describe("mobile ticket suggestions", () => {
  it("only asks once the subject is long enough", () => {
    expect(suggestionRequest(TENANT, " VPN ", "", "requester")).toBeNull();
    expect(suggestionRequest(TENANT, " VPN geht ", " x ", "agent")).toEqual({
      type: "suggest",
      tenantId: TENANT,
      subject: "VPN geht",
      description: "x",
      mode: "agent",
    });
  });

  it("parses at most three articles and the classification", () => {
    const article = {
      id: ID,
      title: "VPN einrichten",
      excerpt: "So geht es",
      visibility: "external",
    };
    const parsed = parseTicketSuggestions({
      data: {
        mode: "agent",
        articles: [article, article, article, article],
        duplicates: [],
        solvedTickets: [
          {
            id: ID,
            ticketNumber: "T-1",
            subject: "VPN",
            statusLabel: "Gelöst",
          },
        ],
        classification: {
          sampleSize: 5,
          department: { id: ID, name: "ICT", matches: 4 },
          category: null,
          priority: { id: ID, name: "Hoch", matches: 3, key: "high" },
        },
      },
    });
    expect(parsed.articles).toHaveLength(3);
    expect(parsed.classification?.priority?.key).toBe("high");
    expect(suggestedTicketLabel(parsed.solvedTickets[0]!)).toBe("#T-1 – VPN");
    expect(classificationSource(4)).toBe("aus 4 ähnlichen Tickets");
    expect(() => parseTicketSuggestions({ data: { mode: "x" } })).toThrow();
  });

  it("uses the agent mode only when agent assignment is allowed", async () => {
    expect(await resolveSuggestionMode(TENANT, ID)).toBe("agent");
    failAssignment = true;
    expect(await resolveSuggestionMode(TENANT, ID)).toBe("requester");
    expect(await resolveSuggestionMode(TENANT, "")).toBe("requester");
    expect(calls.map((call) => call.body.type)).toEqual([
      "listForDepartment",
      "listForDepartment",
    ]);
  });

  it("records a deflection with the subject as query text", async () => {
    await recordSuggestionOutcome({
      tenantId: TENANT,
      articleId: ID,
      kind: "deflected",
      subject: "  VPN geht nicht ",
    });
    expect(calls).toEqual([
      {
        name: "ticket-suggestions",
        body: {
          type: "recordOutcome",
          tenantId: TENANT,
          articleId: ID,
          kind: "deflected",
          queryText: "VPN geht nicht",
        },
      },
    ]);
  });
});
