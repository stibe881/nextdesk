import { describe, expect, it } from "vitest";

import {
  feedbackCommentError,
  isRatableTicketStatus,
  parseTicketFeedback,
} from "../lib/ticket-satisfaction-model";

describe("isRatableTicketStatus", () => {
  it("allows rating once a ticket is resolved or closed", () => {
    expect(isRatableTicketStatus({ key: "resolved", is_closed: false })).toBe(
      true,
    );
    expect(isRatableTicketStatus({ key: "closed", is_closed: true })).toBe(
      true,
    );
    expect(
      isRatableTicketStatus({ key: "in_progress", is_closed: false }),
    ).toBe(false);
    expect(isRatableTicketStatus(null)).toBe(false);
  });
});

describe("parseTicketFeedback", () => {
  it("reads the Function response including isRatable", () => {
    expect(
      parseTicketFeedback({
        data: {
          satisfaction: { score: 4, comment: "Schnell gelöst" },
          canRate: true,
          ticket: { status: { isClosed: true, isRatable: true } },
        },
      }),
    ).toEqual({
      satisfaction: { score: 4, comment: "Schnell gelöst" },
      canRate: true,
      isRatable: true,
    });
  });

  it("falls back to isClosed for older backends", () => {
    expect(
      parseTicketFeedback({
        data: {
          satisfaction: null,
          canRate: false,
          ticket: { status: { isClosed: false } },
        },
      }).isRatable,
    ).toBe(false);
  });

  it("rejects malformed scores", () => {
    expect(() =>
      parseTicketFeedback({
        data: {
          satisfaction: { score: 7, comment: null },
          canRate: true,
          ticket: { status: { isClosed: true } },
        },
      }),
    ).toThrow();
  });
});

describe("feedbackCommentError", () => {
  it("limits comments to 3000 characters", () => {
    expect(feedbackCommentError("ok")).toBeNull();
    expect(feedbackCommentError("x".repeat(3001))).not.toBeNull();
  });
});
