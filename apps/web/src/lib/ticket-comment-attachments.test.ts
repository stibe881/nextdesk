import { describe, expect, it } from "vitest";
import {
  MAX_TICKET_COMMENT_IMAGE_ATTACHMENTS,
  ticketCommentAttachmentIds,
  requestAttachments,
  ticketCommentBodyWithAttachments,
} from "./ticket-comment-attachments";

describe("ticketCommentBodyWithAttachments", () => {
  it("erlaubt einen Anhang auch ohne zusätzlichen Text", () => {
    expect(ticketCommentBodyWithAttachments("   ", 1)).toBe("Anhang");
    expect(ticketCommentBodyWithAttachments("", 2)).toBe("2 Anhänge");
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

describe("requestAttachments", () => {
  const created = "2026-11-12T12:03:12.000Z";
  const file = (
    id: string,
    createdAt: string,
    extra: { commentId?: string | null; inline?: boolean } = {},
  ) => ({ id, createdAt, commentId: null, inline: false, ...extra });

  it("zeigt die Dateien der eingegangenen E-Mail bei der Beschreibung", () => {
    expect(
      requestAttachments(
        [
          file("pdf", "2026-11-12T12:03:14.000Z"),
          file("inline", "2026-11-12T12:03:14.000Z", { inline: true }),
          file("reply", "2026-11-12T12:05:00.000Z", { commentId: "c1" }),
          file("later", "2026-11-12T15:00:00.000Z"),
        ],
        created,
      ).map((attachment) => attachment.id),
    ).toEqual(["pdf"]);
  });

  it("liefert nichts bei ungültigem Erstellungsdatum", () => {
    expect(requestAttachments([file("a", created)], "kein Datum")).toEqual([]);
  });
});
