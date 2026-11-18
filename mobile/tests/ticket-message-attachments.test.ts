import { describe, expect, it } from "vitest";

import {
  attachmentsByComment,
  formatAttachmentSize,
  messageAttachmentContentType,
  messageBodyWithAttachments,
  parseMessageAttachment,
  pickedFileError,
  requestAttachments,
  type MessageAttachment,
} from "../lib/ticket-message-attachments-model";

const created = "2026-11-12T12:03:12.000Z";
const file = (
  id: string,
  createdAt: string,
  extra: Partial<MessageAttachment> = {},
): MessageAttachment => ({
  id,
  commentId: null,
  inline: false,
  originalFilename: `${id}.pdf`,
  contentType: "application/pdf",
  byteSize: 1000,
  createdAt,
  ...extra,
});

describe("parseMessageAttachment", () => {
  it("reads every attachment type, including PDFs", () => {
    expect(
      parseMessageAttachment({
        id: "a",
        comment_id: null,
        original_filename: "Offerte.pdf",
        content_type: "application/pdf",
        byte_size: 2048,
        created_at: created,
        inline: false,
      }),
    ).toEqual({
      id: "a",
      commentId: null,
      inline: false,
      originalFilename: "Offerte.pdf",
      contentType: "application/pdf",
      byteSize: 2048,
      createdAt: created,
    });
    expect(parseMessageAttachment({ id: "x" })).toBeNull();
  });
});

describe("grouping", () => {
  it("assigns files to their message and skips inline images", () => {
    const grouped = attachmentsByComment([
      file("a", created, { commentId: "c1" }),
      file("b", created, { commentId: "c1", inline: true }),
      file("c", created),
    ]);
    expect(Object.keys(grouped)).toEqual(["c1"]);
    expect(grouped.c1?.map((item) => item.id)).toEqual(["a"]);
  });

  it("shows the files of the original e-mail with the description", () => {
    expect(
      requestAttachments(
        [
          file("pdf", "2026-11-12T12:03:14.000Z"),
          file("inline", "2026-11-12T12:03:14.000Z", { inline: true }),
          file("later", "2026-11-12T15:00:00.000Z"),
          file("reply", "2026-11-12T12:04:00.000Z", { commentId: "c1" }),
        ],
        created,
      ).map((item) => item.id),
    ).toEqual(["pdf"]);
  });
});

describe("picked files", () => {
  it("derives the type from the reported MIME type or the extension", () => {
    expect(messageAttachmentContentType("Offerte.PDF", null)).toBe(
      "application/pdf",
    );
    expect(messageAttachmentContentType("foto.jpg", "image/jpg")).toBe(
      "image/jpeg",
    );
    expect(
      messageAttachmentContentType("liste.xlsx", "application/octet-stream"),
    ).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(messageAttachmentContentType("setup.exe", null)).toBeNull();
  });

  it("rejects disallowed, empty and oversized files", () => {
    expect(
      pickedFileError({ name: "a.exe", size: 10, contentType: null }),
    ).toMatch("nicht erlaubten");
    expect(
      pickedFileError({
        name: "a.pdf",
        size: 0,
        contentType: "application/pdf",
      }),
    ).toMatch("leer");
    expect(
      pickedFileError({
        name: "a.pdf",
        size: 26 * 1024 * 1024,
        contentType: "application/pdf",
      }),
    ).toMatch("25 MB");
    expect(
      pickedFileError({
        name: "a.pdf",
        size: 10,
        contentType: "application/pdf",
      }),
    ).toBeNull();
  });
});

describe("messageBodyWithAttachments", () => {
  it("allows a message that only carries files", () => {
    expect(messageBodyWithAttachments("  ", 1)).toBe("Anhang");
    expect(messageBodyWithAttachments("", 3)).toBe("3 Anhänge");
    expect(messageBodyWithAttachments(" Hallo ", 2)).toBe("Hallo");
  });

  it("formats sizes", () => {
    expect(formatAttachmentSize(500)).toBe("500 B");
    expect(formatAttachmentSize(2048)).toBe("2 KB");
  });
});
