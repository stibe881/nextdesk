import { describe, expect, it } from "vitest";

import {
  isRatingLinkHash,
  parseRatingLinkResponse,
  ratingLinkTokenFromHash,
} from "./ticket-rating-link";

describe("ticket rating link", () => {
  it("recognises the hash and extracts the token", () => {
    expect(isRatingLinkHash("#ticket-bewertung=r1.abc.def")).toBe(true);
    expect(ratingLinkTokenFromHash("#ticket-bewertung=r1.abc_-.d-e_f")).toBe(
      "r1.abc_-.d-e_f",
    );
    expect(isRatingLinkHash("#ticket-aktion=v1.abc.def")).toBe(false);
  });

  it("rejects foreign or malformed tokens", () => {
    expect(ratingLinkTokenFromHash("#ticket-bewertung=v1.a.b")).toBeNull();
    expect(ratingLinkTokenFromHash("#ticket-bewertung=r1.a b.c")).toBeNull();
    expect(ratingLinkTokenFromHash("#ticket-bewertung=%E0%A4%A")).toBeNull();
  });

  it("parses a valid preview and rejects invalid scores", () => {
    expect(
      parseRatingLinkResponse({
        data: {
          score: 4,
          state: "open",
          ticketNumber: "ICT-1",
          subject: "Drucker",
          existingScore: null,
        },
      }),
    ).toEqual({
      score: 4,
      state: "open",
      ticketNumber: "ICT-1",
      subject: "Drucker",
      existingScore: null,
    });
    expect(
      parseRatingLinkResponse({ data: { score: 6, state: "open" } }),
    ).toBeNull();
    expect(
      parseRatingLinkResponse({ data: { score: 3, state: "weird" } }),
    ).toBeNull();
  });
});
