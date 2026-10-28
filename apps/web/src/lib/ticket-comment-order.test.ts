import { describe, expect, it } from "vitest";
import {
  chronologicalTicketComments,
  ticketConversationCountLabel,
} from "./ticket-comment-order";

describe("chronologicalTicketComments", () => {
  it("shows older ticket messages first and uses the ID as a stable tie-breaker", () => {
    const comments = chronologicalTicketComments([
      { created_at: "2026-10-27T12:14:00.000Z", id: "b" },
      { created_at: "2026-10-27T12:12:00.000Z", id: "c" },
      { created_at: "2026-10-27T12:12:00.000Z", id: "a" },
    ]);

    expect(comments.map((comment) => comment.id)).toEqual(["a", "c", "b"]);
  });

  it("beschriftet die sichtbare Unterhaltungsanzahl auf Deutsch", () => {
    expect(ticketConversationCountLabel(0)).toBe("0 Nachrichten");
    expect(ticketConversationCountLabel(1)).toBe("1 Nachricht");
    expect(ticketConversationCountLabel(9)).toBe("9 Nachrichten");
  });
});
