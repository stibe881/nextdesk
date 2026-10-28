export const MAX_TICKET_COMMENT_IMAGE_ATTACHMENTS = 5;

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
  if (attachmentCount === 1) return "Bildanhang";
  if (attachmentCount > 1) return `${attachmentCount} Bildanhänge`;
  return "";
}
