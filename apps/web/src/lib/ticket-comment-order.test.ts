import { describe, expect, it } from "vitest";
import { chronologicalTicketComments } from "./ticket-comment-order";

describe("chronologicalTicketComments", () => {
  it("shows older ticket messages first and uses the ID as a stable tie-breaker", () => {
    const comments = chronologicalTicketComments([
      { created_at: "2026-10-27T12:14:00.000Z", id: "b" },
      { created_at: "2026-10-27T12:12:00.000Z", id: "c" },
      { created_at: "2026-10-27T12:12:00.000Z", id: "a" },
    ]);

    expect(comments.map((comment) => comment.id)).toEqual(["a", "c", "b"]);
  });
});
