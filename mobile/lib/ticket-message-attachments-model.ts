/**
 * Files in the ticket conversation: attachments of messages, attachments of
 * the original request (e.g. the e-mail the ticket came from) and files
 * picked for a new message. Mirrors the web app and the ticket-attachments
 * Function (same file types and limits).
 */

export const MAX_MESSAGE_ATTACHMENTS = 5;
export const MAX_MESSAGE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Files that arrived with the request belong to the first message. */
export const REQUEST_ATTACHMENT_WINDOW_MS = 10 * 60 * 1000;

export const MESSAGE_ATTACHMENT_CONTENT_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

const ALLOWED = new Set<string>(MESSAGE_ATTACHMENT_CONTENT_TYPES);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const MESSAGE_ATTACHMENT_TYPES_LABEL =
  "PDF, TXT, CSV, Word, Excel, PNG, JPG und WebP";

export type MessageAttachment = {
  id: string;
  commentId: string | null;
  /** Inline e-mail image, already part of the message text. */
  inline: boolean;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Accepts every listed attachment (also e.g. «winmail.dat» from e-mails). */
export function parseMessageAttachment(
  value: unknown,
): MessageAttachment | null {
  const item = record(value);
  const contentType = item?.content_type ?? item?.contentType;
  const byteSize = item?.byte_size ?? item?.byteSize;
  const createdAt = item?.created_at ?? item?.createdAt;
  const filename = item?.original_filename ?? item?.originalFilename;
  const commentId = item?.comment_id ?? item?.commentId ?? null;
  if (
    !item ||
    typeof item.id !== "string" ||
    typeof filename !== "string" ||
    !filename.trim() ||
    typeof contentType !== "string" ||
    typeof createdAt !== "string" ||
    typeof byteSize !== "number" ||
    !Number.isSafeInteger(byteSize) ||
    (commentId !== null && typeof commentId !== "string")
  ) {
    return null;
  }
  return {
    id: item.id,
    commentId,
    inline: item.inline === true,
    originalFilename: filename,
    contentType,
    byteSize,
    createdAt,
  };
}

export function isImageAttachment(attachment: { contentType: string }) {
  return IMAGE_TYPES.has(attachment.contentType);
}

export function attachmentsByComment(
  attachments: readonly MessageAttachment[],
): Record<string, MessageAttachment[]> {
  const grouped: Record<string, MessageAttachment[]> = {};
  for (const attachment of attachments) {
    if (!attachment.commentId || attachment.inline) continue;
    (grouped[attachment.commentId] ??= []).push(attachment);
  }
  return grouped;
}

/**
 * Attachments of the original request: without a message, not inline, and
 * stored together with the ticket. Files added later stay out.
 */
export function requestAttachments(
  attachments: readonly MessageAttachment[],
  ticketCreatedAt: string,
): MessageAttachment[] {
  const created = Date.parse(ticketCreatedAt);
  if (!Number.isFinite(created)) return [];
  return attachments
    .filter((attachment) => {
      if (attachment.commentId !== null || attachment.inline) return false;
      const added = Date.parse(attachment.createdAt);
      return (
        Number.isFinite(added) &&
        added >= created - 60_000 &&
        added <= created + REQUEST_ATTACHMENT_WINDOW_MS
      );
    })
    .sort(
      (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
    );
}

/** MIME type of a picked file: the reported type if allowed, else by name. */
export function messageAttachmentContentType(
  filename: string,
  reported?: string | null,
): string | null {
  const normalized = reported?.split(";")[0]?.trim().toLowerCase();
  if (normalized === "image/jpg") return "image/jpeg";
  if (normalized && ALLOWED.has(normalized)) return normalized;
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  return BY_EXTENSION[extension] ?? null;
}

export function pickedFileError(file: {
  name: string;
  size: number;
  contentType: string | null;
}): string | null {
  if (!file.contentType) {
    return `«${file.name}» hat einen nicht erlaubten Dateityp. Erlaubt sind ${MESSAGE_ATTACHMENT_TYPES_LABEL}.`;
  }
  if (file.size < 1) return `«${file.name}» ist leer.`;
  if (file.size > MAX_MESSAGE_ATTACHMENT_BYTES) {
    return `«${file.name}» ist grösser als 25 MB.`;
  }
  return null;
}

/** Message text for a message that only carries files. */
export function messageBodyWithAttachments(
  body: string,
  attachmentCount: number,
): string {
  const text = body.trim();
  if (text) return text;
  if (attachmentCount === 1) return "Anhang";
  if (attachmentCount > 1) return `${attachmentCount} Anhänge`;
  return "";
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("de-CH", {
    maximumFractionDigits: 1,
  })} MB`;
}
