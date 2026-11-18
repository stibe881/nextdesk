/**
 * Reads the structure of an article from its Markdown, so the article view can
 * show «Kurz gesagt», sections to fold open and the kind of article without
 * anyone choosing a type.
 */

export type KnowledgeArticleKind =
  "steps" | "faq" | "trouble" | "reference" | "info";

export type KnowledgeArticleSection = { title: string; body: string };

export type KnowledgeArticleStructure = {
  kind: KnowledgeArticleKind;
  /** «Kurz gesagt»: the summary field, otherwise the first paragraph. */
  lead: string;
  /** Text before the first section (without the lead paragraph). */
  intro: string;
  sections: KnowledgeArticleSection[];
  /** Three or more sections are shown as folding sections. */
  folding: boolean;
};

export const knowledgeKindLabels: Record<KnowledgeArticleKind, string> = {
  steps: "Anleitung",
  faq: "FAQ",
  trouble: "Störung",
  reference: "Referenz",
  info: "Information",
};

const FOLD_FROM_SECTIONS = 3;

function isBlockStart(line: string): boolean {
  return (
    /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|!\[)/.test(line) ||
    /^\s*(Hinweis|Tipp|Achtung|Warnung|Wichtig)\s*:/i.test(line)
  );
}

/** Splits at «## » headings that are not inside a code fence. */
function splitSections(body: string): {
  preamble: string;
  sections: KnowledgeArticleSection[];
} {
  const preambleLines: string[] = [];
  const sections: { title: string; lines: string[] }[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1]) {
      sections.push({
        title: heading[1].replace(/[*_`]/g, "").trim(),
        lines: [],
      });
      continue;
    }
    const current = sections[sections.length - 1];
    if (current) current.lines.push(line);
    else preambleLines.push(line);
  }
  return {
    preamble: preambleLines.join("\n").trim(),
    sections: sections.map((section) => ({
      title: section.title,
      body: section.lines.join("\n").trim(),
    })),
  };
}

/** The first plain paragraph of the text, and what is left. */
function takeFirstParagraph(text: string): { paragraph: string; rest: string } {
  const lines = text.split("\n");
  let start = 0;
  while (start < lines.length && !lines[start]?.trim()) start += 1;
  if (start >= lines.length || isBlockStart(lines[start] ?? "")) {
    return { paragraph: "", rest: text };
  }
  let end = start;
  while (end < lines.length && lines[end]?.trim()) end += 1;
  return {
    paragraph: lines.slice(start, end).join(" ").trim(),
    rest: lines.slice(end).join("\n").trim(),
  };
}

function detectKind(
  body: string,
  sections: KnowledgeArticleSection[],
): KnowledgeArticleKind {
  const questions = sections.filter((section) =>
    section.title.trim().endsWith("?"),
  ).length;
  if (questions >= 2) return "faq";
  const troubleHeadings = sections.filter((section) =>
    /symptom|ursache|lösung|loesung|behebung/i.test(section.title),
  ).length;
  if (troubleHeadings >= 2) return "trouble";
  if (/^\s*\d+[.)]\s+\S/m.test(body)) return "steps";
  if (/^\s*\|?\s*:?-{3,}:?\s*\|/m.test(body)) return "reference";
  return "info";
}

export function structureKnowledgeArticle(
  body: string,
  summary: string | null,
): KnowledgeArticleStructure {
  const { preamble, sections } = splitSections(body);
  const given = summary?.trim() ?? "";
  let lead = given;
  let intro = preamble;
  if (!given) {
    const first = takeFirstParagraph(preamble);
    lead = first.paragraph;
    intro = first.rest;
  }
  return {
    kind: detectKind(body, sections),
    lead,
    intro,
    sections,
    folding: sections.length >= FOLD_FROM_SECTIONS,
  };
}

export function knowledgeReadingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
