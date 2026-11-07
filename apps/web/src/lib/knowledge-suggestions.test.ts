import { describe, expect, it } from "vitest";

import {
  knowledgeSuggestionMessage,
  parseKnowledgeSuggestionDraft,
  parseKnowledgeSuggestionList,
} from "./knowledge-suggestions";

describe("knowledge suggestions", () => {
  it("parses the list and drops invalid entries", () => {
    const list = parseKnowledgeSuggestionList({
      data: {
        windowDays: 120,
        refreshedAt: "2026-11-07T08:00:00Z",
        ai: { available: false, code: "ai_provider_not_approved" },
        suggestions: [
          {
            id: "s1",
            titleHint: "Verbindung · Vpn",
            ticketCount: 4,
            status: "open",
            sampleTickets: [
              { id: "t1", ticketNumber: 1042, subject: "VPN bricht ab" },
              { subject: "ohne id" },
            ],
          },
          { id: "s2", titleHint: "x", status: "dismissed" },
        ],
      },
    });
    expect(list.ai).toEqual({
      available: false,
      code: "ai_provider_not_approved",
    });
    expect(list.suggestions).toHaveLength(1);
    expect(list.suggestions[0]?.sampleTickets).toEqual([
      {
        id: "t1",
        ticketNumber: "1042",
        subject: "VPN bricht ab",
        solvedAt: null,
      },
    ]);
  });

  it("rejects incomplete responses", () => {
    expect(() => parseKnowledgeSuggestionList({ data: {} })).toThrow();
    expect(() => parseKnowledgeSuggestionDraft({ data: {} })).toThrow();
    expect(parseKnowledgeSuggestionDraft({ data: { articleId: "a1" } })).toBe(
      "a1",
    );
  });

  it("maps governance codes to German messages", () => {
    expect(knowledgeSuggestionMessage("ai_feature_disabled", "x")).toContain(
      "nicht aktiviert",
    );
    expect(knowledgeSuggestionMessage("unknown", "Fallback")).toBe("Fallback");
    expect(knowledgeSuggestionMessage(null, "Fallback")).toBe("Fallback");
  });
});
