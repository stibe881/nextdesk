import {
  hasTicketCommentImageSignature,
  TICKET_COMMENT_IMAGE_CONTENT_TYPES,
} from "./ticket-comment-image.ts";

Deno.test(
  "Kommentarbild-Signaturen akzeptieren nur passende PNG-, JPEG- und WebP-Dateien",
  () => {
    if (
      !hasTicketCommentImageSignature(
        "image/png",
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    ) {
      throw new Error("Eine gültige PNG-Signatur wurde verworfen.");
    }
    if (
      !hasTicketCommentImageSignature(
        "image/jpeg",
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      )
    ) {
      throw new Error("Eine gültige JPEG-Signatur wurde verworfen.");
    }
    if (
      !hasTicketCommentImageSignature(
        "image/webp",
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
          0x50,
        ]),
      )
    ) {
      throw new Error("Eine gültige WebP-Signatur wurde verworfen.");
    }
  },
);

Deno.test(
  "Kommentarbild-Signaturen weisen MIME-Spoofing und nicht erlaubte Formate ab",
  () => {
    if (
      hasTicketCommentImageSignature(
        "image/png",
        new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      )
    ) {
      throw new Error("PDF-Daten dürfen nicht als PNG akzeptiert werden.");
    }
    if (
      hasTicketCommentImageSignature(
        "image/jpeg",
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      )
    ) {
      throw new Error("PNG-Daten dürfen nicht als JPEG akzeptiert werden.");
    }
    if (TICKET_COMMENT_IMAGE_CONTENT_TYPES.has("image/svg+xml")) {
      throw new Error("SVG darf kein Kommentarbildformat sein.");
    }
  },
);
