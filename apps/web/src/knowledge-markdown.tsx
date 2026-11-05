import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import {
  knowledgeImageUrlTransform,
  type KnowledgeImageUrls,
} from "./lib/knowledge-images";
import "./knowledge-markdown.css";

/**
 * Article Markdown with uploaded images (kb-image:) resolved to the signed
 * URLs delivered with the article (imageUrls). Used by the knowledge base and
 * the ticket view.
 */
export function KnowledgeMarkdown({
  body,
  imageUrls,
}: {
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
