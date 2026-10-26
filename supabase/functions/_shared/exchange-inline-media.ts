const INLINE_CONTENT_MARKER_PREFIX = "[[nextdesk-inline-content:";
const INLINE_CONTENT_MARKER_SUFFIX = "]]";
const INLINE_IMAGE_MARKER_PREFIX = "[[nextdesk-inline-image:";
const INLINE_IMAGE_MARKER_SUFFIX = "]]";

// Graph can return plain-text fallbacks in bracket form, regular `cid:` URLs
// from HTML attributes, or angle-bracketed values. Every match is subsequently
// checked against the message's imported attachment Content-IDs.
const CID_REFERENCE =
  /\[\s*cid:([^\]\r\n]{1,255})\s*\]|<\s*cid:([^<>\r\n]{1,255})\s*>|\bcid:([^\s<>"'\]\[,.;:!?\r\n]{1,255})/giu;
const CONTENT_MARKER = /\[\[nextdesk-inline-content:([^\]\r\n]{1,255})\]\]/giu;

/**
 * Content IDs are provider metadata. Keep only a compact, printable token that
 * can safely be embedded in our own plain-text marker format. These values are
 * never rendered as HTML and never exposed to the browser after replacement.
 */
export function normalizeInlineContentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value
    .trim()
    .replace(/^cid:/iu, "")
    .replace(/^<(.+)>$/u, "$1")
    .trim();
  if (
    trimmed.length < 1 ||
    trimmed.length > 255 ||
    /[\u0000-\u0020\u007f-\u009f<>\[\]{}]/u.test(trimmed)
  ) {
    return null;
  }
  return trimmed.toLowerCase();
}

export function inlineContentMarker(contentId: string): string {
  return `${INLINE_CONTENT_MARKER_PREFIX}${contentId}${INLINE_CONTENT_MARKER_SUFFIX}`;
}

export function inlineImageMarker(attachmentId: string): string {
  return `${INLINE_IMAGE_MARKER_PREFIX}${attachmentId}${INLINE_IMAGE_MARKER_SUFFIX}`;
}

/**
 * Replaces only CID references that belong to an inline file attachment which
 * Graph supplied for the same message. Unknown CID tokens are removed rather
 * than displayed as technical noise or treated as a remote resource.
 */
export function prepareInboundBodyWithInlineMarkers(
  body: string,
  knownContentIds: readonly string[],
): string {
  const permitted = new Set(
    knownContentIds
      .map(normalizeInlineContentId)
      .filter((value): value is string => value !== null),
  );
  return body.replace(
    CID_REFERENCE,
    (
      _reference,
      bracketed: string | undefined,
      angled: string | undefined,
      plain: string | undefined,
    ) => {
      const rawContentId = bracketed ?? angled ?? plain;
      const contentId = normalizeInlineContentId(rawContentId);
      return contentId && permitted.has(contentId)
        ? inlineContentMarker(contentId)
        : "";
    },
  );
}

/**
 * Converts our temporary content-ID markers to stable private attachment IDs
 * after upload. A failed or rejected image leaves no CID identifier behind.
 */
export function resolveInboundInlineMarkers(
  body: string,
  attachmentIdByContentId: ReadonlyMap<string, string>,
): string {
  return body.replace(CONTENT_MARKER, (_marker, rawContentId: string) => {
    const contentId = normalizeInlineContentId(rawContentId);
    const attachmentId = contentId
      ? attachmentIdByContentId.get(contentId)
      : undefined;
    return attachmentId ? inlineImageMarker(attachmentId) : "";
  });
}
