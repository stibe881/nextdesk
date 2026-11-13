export const MAX_TICKET_COMMENT_IMAGE_ATTACHMENTS = 5;

/** Files that arrived with the request belong to the first message. */
export const REQUEST_ATTACHMENT_WINDOW_MS = 10 * 60 * 1000;

export function ticketCommentAttachmentIds(
  attachments: readonly { id: string }[],
): string[] {
  return [...new Set(attachments.map((attachment) => attachment.id))];
}

export function ticketCommentBodyWithAttachments(
  draft: string,
  attachmentCount: number,
): string {
  const body = draft.trim();
  if (body) return body;
  if (attachmentCount === 1) return "Anhang";
  if (attachmentCount > 1) return `${attachmentCount} Anhänge`;
  return "";
}

/**
 * Attachments of the original request («Beschreibung»): stored without a
 * message, not shown inline in the text, and added together with the ticket
 * (e.g. the files of the e-mail that created it). Files added later through
 * «Anhang hochladen» stay in the attachment strip only.
 */
export function requestAttachments<
  T extends { commentId: string | null; inline?: boolean; createdAt: string },
>(attachments: readonly T[], ticketCreatedAt: string): T[] {
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
