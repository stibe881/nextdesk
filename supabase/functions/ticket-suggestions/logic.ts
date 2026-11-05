// Pure helpers of the ticket-suggestions function (input parsing, search
// query, excerpt, majority vote). No I/O, so they are unit tested directly.

import { isRecord, isUuid } from "../_shared/http.ts";

export type SuggestMode = "requester" | "agent";
export type OutcomeKind = "deflected" | "not_helpful";

export type SuggestAction = {
  type: "suggest";
  tenantId: string;
  subject: string;
  description: string;
  mode: SuggestMode;
};
export type RecordOutcomeAction = {
  type: "recordOutcome";
  tenantId: string;
  articleId: string;
  kind: OutcomeKind;
  queryText: string | null;
};
export type Action = SuggestAction | RecordOutcomeAction;

export const MAX_SUBJECT_LENGTH = 240;
export const MAX_DESCRIPTION_LENGTH = 4000;
export const MAX_QUERY_TEXT_LENGTH = 500;
/** Suggestions start once the subject has this many characters. */
export const MIN_SUBJECT_LENGTH = 4;
export const EXCERPT_LENGTH = 200;
/** search_knowledge_article_ids accepts at most 120 characters. */
const MAX_SEARCH_LENGTH = 120;
const MAX_SEARCH_WORDS = 10;

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(["type", "tenantId", ...keys]);
  return Object.keys(value).every((key) => allowed.has(key));
}

/**
 * Free text: no NUL or lone surrogates, at most `max` characters. Empty or
 * missing values give "" (the client sends partial drafts while typing).
 */
function draftText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  if (value.includes("\u0000") || /\p{Cs}/u.test(value)) return null;
  const trimmed = value.trim();
  return [...trimmed].length <= max ? trimmed : null;
}

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  if (value.type === "suggest") {
    if (!onlyKeys(value, ["subject", "description", "mode"])) return null;
    if (typeof value.subject !== "string") return null;
    const subject = draftText(value.subject, MAX_SUBJECT_LENGTH);
    const description = draftText(value.description, MAX_DESCRIPTION_LENGTH);
    if (subject === null || description === null) return null;
    if (value.mode !== "requester" && value.mode !== "agent") return null;
    return {
      type: "suggest",
      tenantId,
      subject,
      description,
      mode: value.mode,
    };
  }
  if (value.type === "recordOutcome") {
    if (!onlyKeys(value, ["articleId", "kind", "queryText"])) return null;
    if (!isUuid(value.articleId)) return null;
    if (value.kind !== "deflected" && value.kind !== "not_helpful") return null;
    const queryText = draftText(value.queryText, MAX_QUERY_TEXT_LENGTH);
    if (queryText === null) return null;
    return {
      type: "recordOutcome",
      tenantId,
      articleId: value.articleId.toLowerCase(),
      kind: value.kind,
      queryText: queryText || null,
    };
  }
  return null;
}

/** True when the draft is long enough to look for suggestions. */
export function subjectLongEnough(subject: string): boolean {
  return [...subject.trim()].length >= MIN_SUBJECT_LENGTH;
}

/**
 * A websearch query for search_knowledge_article_ids: the significant words
 * of subject and description (subject first), combined with "or" so that an
 * article sharing only some of the words is still found. Operators of the
 * websearch syntax (quotes, minus) never reach the database.
 */
export function knowledgeSearchQuery(
  subject: string,
  description: string,
): string | null {
  const words: string[] = [];
  const seen = new Set<string>();
  for (const word of `${subject} ${description}`.split(/[^\p{L}\p{N}]+/u)) {
    if ([...word].length < 3) continue;
    const key = word.toLocaleLowerCase("de-CH");
    if (seen.has(key) || key === "or" || key === "and") continue;
    seen.add(key);
    words.push(word);
    if (words.length >= MAX_SEARCH_WORDS) break;
  }
  let query = "";
  for (const word of words) {
    const next = query ? `${query} or ${word}` : word;
    if ([...next].length > MAX_SEARCH_LENGTH) break;
    query = next;
  }
  return query || null;
}

/** Text for similar_tickets (the SQL limits it to 2000 characters). */
export function similarityText(subject: string, description: string): string {
  return [...`${subject}\n${description}`.trim()].slice(0, 2000).join("");
}

/**
 * Plain-text excerpt of an article body (Markdown): images (incl. kb-image
 * references), HTML and formatting removed, links reduced to their text,
 * shortened on a word boundary.
 */
export function plainExcerpt(markdown: unknown, max = EXCERPT_LENGTH): string {
  if (typeof markdown !== "string") return "";
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/kb-image:[0-9a-f-]{36}/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*([-*_]\s*){3,}$/gm, " ")
    .replace(/[*_~`|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const characters = [...text];
  if (characters.length <= max) return text;
  const cut = characters.slice(0, max).join("");
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()} …`;
}

export type Vote = { id: string; matches: number };

/**
 * Most frequent non-empty value among `values` (in rank order). Only a value
 * shared by at least `minimum` entries counts; on a tie the value that
 * appears first (higher ranked ticket) wins.
 */
export function majorityVote(
  values: ReadonlyArray<string | null | undefined>,
  minimum = 2,
): Vote | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: Vote | null = null;
  for (const [id, matches] of counts) {
    if (!best || matches > best.matches) best = { id, matches };
  }
  return best && best.matches >= minimum ? best : null;
}

/** Duplicate outcomes of the same person and article are ignored this long. */
export const OUTCOME_DEDUP_MINUTES = 10;
/** At most this many outcomes per person and hour are stored. */
export const OUTCOME_HOURLY_LIMIT = 30;
