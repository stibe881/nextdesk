import { useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import {
  knowledgeImageUrlTransform,
  type KnowledgeImageUrls,
} from "./lib/knowledge-images";
import "./knowledge-markdown.css";

export type KnowledgeHeading = { id: string; level: 2 | 3; text: string };

function headingSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "abschnitt"
  );
}

function plainHeadingText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .trim();
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return nodeText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** Level 2 and 3 headings of an article (for the table of contents). */
export function knowledgeHeadings(body: string): KnowledgeHeading[] {
  const headings: KnowledgeHeading[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const text = plainHeadingText(match[2]);
    if (!text) continue;
    headings.push({
      id: `kb-${headingSlug(text)}`,
      level: match[1].length === 2 ? 2 : 3,
      text,
    });
  }
  return headings;
}

/**
 * Article Markdown with uploaded images (kb-image:) resolved to the signed
 * URLs delivered with the article (imageUrls). Used by the knowledge base and
 * the ticket view.
 */
export function KnowledgeMarkdown({
  anchors = false,
  body,
  imageUrls,
}: {
  /** Gives level 2 and 3 headings the ids of knowledgeHeadings(). */
  anchors?: boolean;
  body: string;
  imageUrls: KnowledgeImageUrls;
}) {
  const urlTransform = useMemo(
    () => knowledgeImageUrlTransform(imageUrls),
    [imageUrls],
  );
  return (
    <ReactMarkdown
      components={{
        ...(anchors
          ? {
              h2: ({ children }: { children?: ReactNode }) => (
                <h2 id={`kb-${headingSlug(nodeText(children))}`}>{children}</h2>
              ),
              h3: ({ children }: { children?: ReactNode }) => (
                <h3 id={`kb-${headingSlug(nodeText(children))}`}>{children}</h3>
              ),
            }
          : {}),
        img: ({ src, alt }) =>
          typeof src === "string" && src ? (
            <img alt={alt ?? ""} loading="lazy" src={src} />
          ) : (
            <span className="knowledge-markdown__image-missing knowledge-base__image-missing">
              {alt ? `Bild «${alt}» nicht verfügbar` : "Bild nicht verfügbar"}
            </span>
          ),
      }}
      urlTransform={urlTransform}
    >
      {body}
    </ReactMarkdown>
  );
}
