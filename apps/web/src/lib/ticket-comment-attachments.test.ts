import { describe, expect, it } from "vitest";
import {
  MAX_TICKET_COMMENT_IMAGE_ATTACHMENTS,
  ticketCommentAttachmentIds,
  ticketCommentBodyWithAttachments,
} from "./ticket-comment-attachments";

describe("ticketCommentBodyWithAttachments", () => {
  it("erlaubt einen Bildanhang auch ohne zusätzlichen Text", () => {
    expect(ticketCommentBodyWithAttachments("   ", 1)).toBe("Bildanhang");
    expect(ticketCommentBodyWithAttachments("", 2)).toBe("2 Bildanhänge");
  });

  it("bewahrt einen bewusst verfassten Nachrichtentext", () => {
    expect(ticketCommentBodyWithAttachments("  Bitte prüfen.  ", 3)).toBe(
      "Bitte prüfen.",
    );
  });

  it("liefert nur eindeutige Anhang-IDs und begrenzt die Bildauswahl", () => {
    expect(
      ticketCommentAttachmentIds([{ id: "a" }, { id: "a" }, { id: "b" }]),
    ).toEqual(["a", "b"]);
    expect(MAX_TICKET_COMMENT_IMAGE_ATTACHMENTS).toBe(5);
  });
});
