import { defaultUrlTransform } from "react-markdown";

/** Markdown image references to uploaded article images: kb-image:<id>. */
export const KNOWLEDGE_IMAGE_PROTOCOL = "kb-image:";
export const KNOWLEDGE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
export const MAX_KNOWLEDGE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_KNOWLEDGE_IMAGE_EDGE = 1600;

export type KnowledgeImageUrls = Record<string, string>;
export type UploadedKnowledgeImage = {
  id: string;
  markdown: string;
  url: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Signed image URLs (id → URL) delivered with article texts. */
export function parseKnowledgeImageUrls(
  value: unknown,
): KnowledgeImageUrls | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const urls: KnowledgeImageUrls = {};
  for (const [id, url] of Object.entries(value)) {
    if (!UUID.test(id) || !isHttpUrl(url)) return null;
    urls[id.toLowerCase()] = url;
  }
  return urls;
}

/** Response of `uploadArticleImage`. */
export function parseUploadedKnowledgeImage(
  value: unknown,
): UploadedKnowledgeImage | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const { id, markdown, url } = value.data;
  if (
    typeof id !== "string" ||
    !UUID.test(id) ||
    typeof markdown !== "string" ||
    !markdown.endsWith(`(${KNOWLEDGE_IMAGE_PROTOCOL}${id})`) ||
    (url !== null && !isHttpUrl(url))
  ) {
    return null;
  }
  return { id: id.toLowerCase(), markdown, url };
}

/**
 * URL transform for ReactMarkdown: kb-image references become their signed
 * URL (or an empty source while none is known); everything else keeps the
 * default sanitising.
 */
export function knowledgeImageUrlTransform(
  imageUrls: KnowledgeImageUrls,
): (url: string) => string {
  return (url) => {
    if (url.toLowerCase().startsWith(KNOWLEDGE_IMAGE_PROTOCOL)) {
      const id = url.slice(KNOWLEDGE_IMAGE_PROTOCOL.length).toLowerCase();
      return imageUrls[id] ?? "";
    }
    return defaultUrlTransform(url);
  };
}

/**
 * Inserts Markdown at the cursor (replacing a selection) on its own lines.
 * Returns the new text and the cursor position after the insertion.
 */
export function insertMarkdownBlock(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  insertion: string,
): { text: string; cursor: number } {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));
  const before = text.slice(0, start);
  const after = text.slice(end);
  const prefix =
    before.length === 0 || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const suffix = after.startsWith("\n") ? "" : "\n";
  const inserted = `${prefix}${insertion}${suffix}`;
  return {
    text: `${before}${inserted}${after}`,
    cursor: before.length + inserted.length,
  };
}

/** Image files among dropped or pasted items. */
export function knowledgeImageFiles(files: Iterable<File>): File[] {
  return [...files].filter((file) => file.type.startsWith("image/"));
}
