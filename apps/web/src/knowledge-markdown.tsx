import { Children, isValidElement, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import {
  knowledgeImageUrlTransform,
  type KnowledgeImageUrls,
} from "./lib/knowledge-images";
import "./knowledge-markdown.css";

const NOTE_LABEL = /^\s*(Hinweis|Tipp|Wichtig|Achtung|Warnung)\s*:\s*/i;

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) {
    return nodeText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/**
 * A paragraph that starts with «Hinweis:», «Tipp:», «Achtung:» … becomes a
 * coloured note. Returns null for every other paragraph.
 */
function noteParts(
  children: ReactNode,
): { label: string; tone: "info" | "warn"; rest: ReactNode[] } | null {
  const items = Children.toArray(children);
  const first = items[0];
  let label: string | null = null;
  let rest: ReactNode[] = items.slice(1);
  if (typeof first === "string") {
    const match = NOTE_LABEL.exec(first);
    if (!match?.[1]) return null;
    label = match[1];
    rest = [first.slice(match[0].length), ...rest];
  } else if (isValidElement(first)) {
    // «**Hinweis:** Text»
    const match = /^\s*(Hinweis|Tipp|Wichtig|Achtung|Warnung)\s*:?\s*$/i.exec(
      nodeText(first),
    );
    if (!match?.[1]) return null;
    label = match[1];
    const next = rest[0];
    if (typeof next === "string")
      rest = [next.replace(/^\s+/, ""), ...rest.slice(1)];
  }
  if (!label) return null;
  const tone = /^(achtung|warnung)$/i.test(label) ? "warn" : "info";
  return {
    label: label.charAt(0).toUpperCase() + label.slice(1).toLowerCase(),
    tone,
    rest,
  };
}

/**
 * Article Markdown with uploaded images (kb-image:) resolved to the signed
 * URLs delivered with the article (imageUrls). Used by the knowledge base and
 * the ticket view. With `notes`, lines starting with «Hinweis:», «Tipp:»,
 * «Achtung:» are shown as coloured notes (article view).
 */
export function KnowledgeMarkdown({
  body,
  imageUrls,
  notes = false,
}: {
  body: string;
  imageUrls: KnowledgeImageUrls;
  notes?: boolean;
}) {
  const urlTransform = useMemo(
    () => knowledgeImageUrlTransform(imageUrls),
    [imageUrls],
  );
  return (
    <ReactMarkdown
      components={{
        ...(notes
          ? {
              p: ({ children }: { children?: ReactNode }) => {
                const note = noteParts(children);
                return note ? (
                  <div
                    className={`knowledge-article__note knowledge-article__note--${note.tone}`}
                  >
                    <strong>{note.label}</strong>
                    <span>{note.rest}</span>
                  </div>
                ) : (
                  <p>{children}</p>
                );
              },
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
