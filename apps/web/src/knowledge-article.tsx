import { FolderOpen } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { KnowledgeMarkdown } from "./knowledge-markdown";
import type { KnowledgeImageUrls } from "./lib/knowledge-images";
import {
  knowledgeKindLabels,
  knowledgeReadingMinutes,
  structureKnowledgeArticle,
} from "./lib/knowledge-article-structure";

/**
 * The article as people read it: a banner in the colours of the tenant
 * (Einstellungen → Design), «Kurz gesagt» and sections that fold open. The
 * look follows from the text (steps, questions, tables, notes), nobody
 * chooses an article type. Used by the reader, the editor preview and the
 * AI result.
 */
export function KnowledgeArticleView({
  body,
  extra,
  imageUrls,
  summary,
  title,
  topic,
  updatedLabel,
}: {
  body: string;
  /** Extra meta for editors (status, version …), shown under the banner. */
  extra?: ReactNode;
  imageUrls: KnowledgeImageUrls;
  summary?: string | null;
  title: string;
  topic?: string;
  updatedLabel?: string;
}) {
  const structure = useMemo(
    () => structureKnowledgeArticle(body, summary ?? null),
    [body, summary],
  );
  const [openSections, setOpenSections] = useState<ReadonlySet<number>>(
    () => new Set([0]),
  );
  const allOpen = openSections.size >= structure.sections.length;
  const minutes = knowledgeReadingMinutes(body);

  function toggleSection(index: number, open: boolean) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (open) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  return (
    <div className="knowledge-article">
      <header className="knowledge-article__banner">
        <div className="knowledge-article__meta">
          <span className="knowledge-article__kind">
            {knowledgeKindLabels[structure.kind]}
          </span>
          {topic ? (
            <span className="knowledge-article__topic">
              <FolderOpen aria-hidden="true" size={14} strokeWidth={1.8} />
              {topic}
            </span>
          ) : null}
          {updatedLabel ? <span>Aktualisiert {updatedLabel}</span> : null}
          {body.trim() ? <span>{minutes} Min. Lesezeit</span> : null}
        </div>
        <h2 id="knowledge-article-detail-heading">{title}</h2>
      </header>

      {extra ? <div className="knowledge-article__extra">{extra}</div> : null}

      {structure.lead ? (
        <aside aria-label="Kurz gesagt" className="knowledge-article__summary">
          <strong>Kurz gesagt</strong>
          <p>{structure.lead}</p>
        </aside>
      ) : null}

      {body.trim() ? (
        <div className="knowledge-article__body">
          {structure.intro ? (
            <KnowledgeMarkdown
              body={structure.intro}
              imageUrls={imageUrls}
              notes
            />
          ) : null}

          {structure.folding ? (
            <>
              <div className="knowledge-article__fold-tools">
                <button
                  onClick={() =>
                    setOpenSections(
                      allOpen
                        ? new Set()
                        : new Set(structure.sections.map((_, i) => i)),
                    )
                  }
                  type="button"
                >
                  {allOpen ? "Alle zuklappen" : "Alle aufklappen"}
                </button>
              </div>
              {structure.sections.map((section, index) => (
                <details
                  className="knowledge-article__section"
                  key={`${index}-${section.title}`}
                  onToggle={(event) =>
                    toggleSection(index, event.currentTarget.open)
                  }
                  open={openSections.has(index)}
                >
                  <summary>{section.title}</summary>
                  <div className="knowledge-article__section-body">
                    <KnowledgeMarkdown
                      body={section.body}
                      imageUrls={imageUrls}
                      notes
                    />
                  </div>
                </details>
              ))}
            </>
          ) : (
            structure.sections.map((section) => (
              <section
                className="knowledge-article__plain-section"
                key={section.title}
              >
                <h3>{section.title}</h3>
                <KnowledgeMarkdown
                  body={section.body}
                  imageUrls={imageUrls}
                  notes
                />
              </section>
            ))
          )}
        </div>
      ) : (
        <p className="knowledge-article__empty">
          Dieser Artikel enthält noch keinen Inhalt.
        </p>
      )}
    </div>
  );
}

/** Colours: the tenant's design (Einstellungen → Design), gradient from primary to accent. */
export const knowledgeArticleStyles = `
  .knowledge-article {
    --kb-main: var(--brand-primary, #4338ca);
    --kb-detail: var(--brand-accent, #075985);
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  .knowledge-article__banner {
    display: grid;
    gap: 10px;
    border-radius: 18px;
    background: linear-gradient(135deg, var(--kb-main), var(--kb-detail));
    color: #fff;
    padding: 24px 28px 22px;
  }
  .knowledge-article__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    font-size: 12.5px;
    opacity: 0.96;
  }
  .knowledge-article__kind {
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.22);
    font-weight: 700;
    padding: 2px 10px;
  }
  .knowledge-article__topic {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-weight: 600;
  }
  .knowledge-article__banner h2 {
    margin: 0;
    color: #fff;
    font-size: 32px;
    line-height: 1.12;
    text-wrap: balance;
  }
  .knowledge-article__extra { min-width: 0; }
  .knowledge-article__summary {
    border: 1px solid var(--border, #e3e9ee);
    border-left: 4px solid var(--kb-main);
    border-radius: 12px;
    background: color-mix(in srgb, var(--kb-main) 7%, var(--surface, #fff));
    padding: 12px 16px;
  }
  .knowledge-article__summary strong {
    display: block;
    margin-bottom: 2px;
    color: var(--kb-main);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .knowledge-article__summary p { margin: 0; color: var(--text, #294657); line-height: 1.55; }
  .knowledge-article__body {
    display: grid;
    gap: 12px;
    color: var(--text, #294657);
    font-size: 15.5px;
    line-height: 1.7;
    overflow-wrap: anywhere;
  }
  .knowledge-article__body > :first-child { margin-top: 0; }
  .knowledge-article__body p { margin: 0 0 10px; }
  .knowledge-article__body p:last-child { margin-bottom: 0; }
  .knowledge-article__body h3,
  .knowledge-article__body h4 {
    margin: 18px 0 6px;
    color: var(--ink, #173246);
    line-height: 1.3;
  }
  .knowledge-article__body ul { margin: 0 0 10px; padding-left: 22px; }
  .knowledge-article__body li + li { margin-top: 4px; }
  .knowledge-article__body ol {
    display: grid;
    gap: 8px;
    margin: 4px 0 10px;
    padding: 0;
    list-style: none;
    counter-reset: kb-step;
  }
  .knowledge-article__body ol > li {
    position: relative;
    margin: 0;
    border: 1px solid var(--border, #e3e9ee);
    border-radius: 12px;
    background: var(--surface, #fff);
    padding: 10px 14px 10px 56px;
    counter-increment: kb-step;
  }
  .knowledge-article__body ol > li::before {
    content: counter(kb-step);
    position: absolute;
    left: 14px;
    top: 10px;
    display: grid;
    width: 30px;
    height: 30px;
    place-items: center;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--kb-main), var(--kb-detail));
    color: #fff;
    font-size: 13px;
    font-weight: 700;
  }
  .knowledge-article__body ol > li > :first-child { margin-top: 0; }
  .knowledge-article__body ol > li > :last-child { margin-bottom: 0; }
  .knowledge-article__body table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  .knowledge-article__body th {
    border-bottom: 2px solid var(--border, #e3e9ee);
    color: var(--muted, #5d6f7a);
    font-size: 11.5px;
    letter-spacing: 0.06em;
    padding: 8px 10px;
    text-align: left;
    text-transform: uppercase;
  }
  .knowledge-article__body td {
    border-bottom: 1px solid var(--border, #e3e9ee);
    padding: 8px 10px;
  }
  .knowledge-article__body code {
    border-radius: 6px;
    background: var(--surface-subtle, #eef2f6);
    font-size: 0.9em;
    padding: 1px 6px;
  }
  .knowledge-article__body pre {
    overflow-x: auto;
    border-radius: 12px;
    background: var(--surface-subtle, #eef2f6);
    padding: 12px 14px;
  }
  .knowledge-article__body pre code { background: transparent; padding: 0; }
  .knowledge-article__body img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 10px 0;
    border: 1px solid var(--border, #e3e9ee);
    border-radius: 12px;
  }
  .knowledge-article__body blockquote {
    margin: 0 0 10px;
    border-left: 3px solid var(--border, #e3e9ee);
    padding-left: 14px;
    color: var(--muted, #5d6f7a);
  }
  .knowledge-article__note {
    display: flex;
    gap: 10px;
    margin: 4px 0 10px;
    border-radius: 12px;
    padding: 10px 14px;
    font-size: 14.5px;
    line-height: 1.55;
  }
  .knowledge-article__note strong { flex: none; }
  .knowledge-article__note--info {
    background: color-mix(in srgb, var(--kb-detail) 10%, var(--surface, #fff));
    color: var(--text, #294657);
  }
  .knowledge-article__note--info strong { color: var(--kb-detail); }
  .knowledge-article__note--warn {
    background: #fdf0dc;
    color: #7a3d08;
  }
  .knowledge-article__fold-tools { display: flex; justify-content: flex-end; }
  .knowledge-base .knowledge-article__fold-tools button {
    min-height: 0;
    border: 0;
    background: transparent;
    color: var(--kb-detail);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    padding: 0;
  }
  .knowledge-article__section {
    border: 1px solid var(--border, #e3e9ee);
    border-radius: 14px;
    background: var(--surface, #fff);
    overflow: hidden;
  }
  .knowledge-article__section summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    cursor: pointer;
    list-style: none;
    padding: 13px 18px;
    color: var(--ink, #173246);
    font-size: 16px;
    font-weight: 700;
  }
  .knowledge-article__section summary::-webkit-details-marker { display: none; }
  .knowledge-article__section summary::after {
    content: "+";
    color: var(--muted, #5d6f7a);
    font-size: 22px;
    font-weight: 400;
    line-height: 1;
  }
  .knowledge-article__section[open] > summary {
    background: color-mix(in srgb, var(--kb-main) 6%, var(--surface, #fff));
  }
  .knowledge-article__section[open] > summary::after { content: "−"; }
  .knowledge-article__section-body { padding: 14px 18px 16px; }
  .knowledge-article__plain-section h3 { margin-top: 8px; }
  .knowledge-article__empty { margin: 0; color: var(--muted, #5d6f7a); }
  @media (max-width: 640px) {
    .knowledge-article__banner { padding: 18px 18px 16px; }
    .knowledge-article__banner h2 { font-size: 25px; }
  }
`;
