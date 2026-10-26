const INLINE_IMAGE_MARKER =
  /\[\[nextdesk-inline-image:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]\]/giu;
const LEGACY_CID_REFERENCE =
  /\s*(?:\[\s*cid:[^\]\r\n]{1,255}\s*\]|<\s*cid:[^<>\r\n]{1,255}\s*>|\bcid:[^\s<>"'\]\[\r\n]{1,255})/giu;

export type TicketInlineMediaSegment =
  { kind: "text"; value: string } | { attachmentId: string; kind: "image" };

/**
 * The ticket body remains plain text. Only the exact internal marker produced
 * by the Exchange worker becomes an image segment. Legacy raw CID fragments
 * are hidden because they cannot be resolved securely after import.
 */
export function ticketInlineMediaSegments(
  body: string,
): TicketInlineMediaSegment[] {
  const cleaned = body.replace(LEGACY_CID_REFERENCE, "");
  const segments: TicketInlineMediaSegment[] = [];
  let cursor = 0;

  for (const match of cleaned.matchAll(INLINE_IMAGE_MARKER)) {
    const marker = match[0];
    const attachmentId = match[1];
    if (!marker || !attachmentId) continue;
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: "text", value: cleaned.slice(cursor, index) });
    }
    segments.push({ attachmentId: attachmentId.toLowerCase(), kind: "image" });
    cursor = index + marker.length;
  }

  if (cursor < cleaned.length) {
    segments.push({ kind: "text", value: cleaned.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ kind: "text", value: cleaned }];
}

export function ticketInlineAttachmentIds(bodies: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const body of bodies) {
    for (const segment of ticketInlineMediaSegments(body)) {
      if (segment.kind === "image") ids.add(segment.attachmentId);
    }
  }
  return [...ids].sort();
}

export function isTrustedTicketInlineImageUrl(
  value: unknown,
  storageOrigin: string | null | undefined,
): value is string {
  if (typeof value !== "string" || !storageOrigin) return false;
  try {
    const origin = new URL(storageOrigin);
    const candidate = new URL(value);
    return (
      candidate.protocol === "https:" &&
      candidate.origin === origin.origin &&
      candidate.pathname.startsWith(
        "/storage/v1/object/sign/ticket-attachments/",
      )
    );
  } catch {
    return false;
  }
}
