// Pure logic of the knowledge article suggestions: clusters of similar
// solved tickets, their stable fingerprint and the combined, redacted source
// text for the AI draft. No database or network access here.

import { subjectWords } from "../_shared/ticket-similarity.ts";
import { clipText, redactTicketText } from "../_shared/ticket-redaction.ts";

export const MIN_CLUSTER_SIZE = 3;
export const MAX_CLUSTERS = 30;
/** Words of a subject that form pairs (keeps the pair count small). */
const MAX_WORDS_PER_TICKET = 8;
const FINGERPRINT_VERSION = "v1";

export type SolvedTicket = {
  id: string;
  subject: string;
  categoryName: string | null;
  departmentId: string | null;
  solvedAt: string;
};

export type SuggestionCluster = {
  fingerprint: string;
  departmentId: string | null;
  titleHint: string;
  /** Newest solved ticket first. */
  ticketIds: string[];
};

type Tier = 0 | 1 | 2;
type Group = {
  key: string;
  tier: Tier;
  words: string[];
  category: string | null;
  tickets: SolvedTicket[];
};

function normalizeCategory(name: string): string {
  return name.trim().toLocaleLowerCase("de-CH").replace(/\s+/g, " ");
}

function capitalize(word: string): string {
  return word ? word[0].toLocaleUpperCase("de-CH") + word.slice(1) : word;
}

/**
 * Stable key of a cluster: version, department and the similarity key (two
 * subject words, category and word, or one word). The ticket ids are not part
 * of it, so a cluster keeps its identity while new tickets join it.
 */
export function suggestionFingerprint(
  departmentId: string | null,
  key: string,
): string {
  return `${FINGERPRINT_VERSION}|${departmentId ?? "-"}|${key}`;
}

function titleHint(group: Group, categoryLabel: string | null): string {
  const words = group.words.map(capitalize).join(" · ");
  const hint = group.tier === 1 && categoryLabel
    ? `${categoryLabel.trim()}: ${words}`
    : words;
  return clipText(hint, 200);
}

/**
 * Groups solved tickets into clusters of at least three similar tickets per
 * department. Specific keys win: first pairs of subject words, then category
 * plus word, then single words; within a tier larger groups first. A ticket
 * belongs to at most one cluster. Groups whose fingerprint is blocked (a
 * dismissed, drafted or published suggestion) consume their tickets without
 * producing a cluster, so that topic does not come back under another key.
 */
export function clusterSolvedTickets(
  tickets: readonly SolvedTicket[],
  options: {
    blockedFingerprints?: ReadonlySet<string>;
    excludedTicketIds?: ReadonlySet<string>;
    minSize?: number;
    maxClusters?: number;
  } = {},
): SuggestionCluster[] {
  const minSize = options.minSize ?? MIN_CLUSTER_SIZE;
  const maxClusters = options.maxClusters ?? MAX_CLUSTERS;
  const blocked = options.blockedFingerprints ?? new Set<string>();
  const excluded = options.excludedTicketIds ?? new Set<string>();

  const byDepartment = new Map<string, SolvedTicket[]>();
  for (const ticket of tickets) {
    if (excluded.has(ticket.id)) continue;
    const key = ticket.departmentId ?? "";
    const list = byDepartment.get(key) ?? [];
    list.push(ticket);
    byDepartment.set(key, list);
  }

  const candidates: Array<Group & { departmentId: string | null }> = [];
  const categoryLabels = new Map<string, string>();
  for (const [departmentKey, list] of byDepartment) {
    const departmentId = departmentKey || null;
    const groups = new Map<string, Group>();
    const add = (
      key: string,
      tier: Tier,
      words: string[],
      category: string | null,
      ticket: SolvedTicket,
    ) => {
      const group = groups.get(key) ??
        { key, tier, words, category, tickets: [] };
      if (!group.tickets.includes(ticket)) group.tickets.push(ticket);
      groups.set(key, group);
    };
    for (const ticket of list) {
      // "VPN-Verbindung" and "VPN Verbindung" mean the same here.
      const words = subjectWords(ticket.subject.replace(/-/g, " "))
        .slice(0, MAX_WORDS_PER_TICKET)
        .sort();
      for (let i = 0; i < words.length; i += 1) {
        for (let j = i + 1; j < words.length; j += 1) {
          add(`pair:${words[i]}+${words[j]}`, 0, [words[i], words[j]], null, ticket);
        }
      }
      const category = ticket.categoryName?.trim()
        ? normalizeCategory(ticket.categoryName)
        : null;
      if (category) {
        if (!categoryLabels.has(category)) {
          categoryLabels.set(category, ticket.categoryName!.trim());
        }
        for (const word of words) {
          add(`category:${category}+${word}`, 1, [word], category, ticket);
        }
      }
      for (const word of words) add(`word:${word}`, 2, [word], null, ticket);
    }
    for (const group of groups.values()) {
      if (group.tickets.length >= minSize) {
        candidates.push({ ...group, departmentId });
      }
    }
  }

  candidates.sort((a, b) =>
    a.tier - b.tier ||
    b.tickets.length - a.tickets.length ||
    (a.departmentId ?? "").localeCompare(b.departmentId ?? "") ||
    a.key.localeCompare(b.key)
  );

  const used = new Set<string>();
  const result: SuggestionCluster[] = [];
  for (const group of candidates) {
    const fresh = group.tickets.filter((ticket) => !used.has(ticket.id));
    if (fresh.length < minSize) continue;
    const fingerprint = suggestionFingerprint(group.departmentId, group.key);
    fresh.forEach((ticket) => used.add(ticket.id));
    if (blocked.has(fingerprint)) continue;
    result.push({
      fingerprint,
      departmentId: group.departmentId,
      titleHint: titleHint(
        group,
        group.category ? categoryLabels.get(group.category) ?? null : null,
      ),
      ticketIds: [...fresh]
        .sort((a, b) => b.solvedAt.localeCompare(a.solvedAt))
        .map((ticket) => ticket.id),
    });
    if (result.length >= maxClusters) break;
  }
  return result;
}

export type TicketComment = {
  ticketId: string;
  visibility: string;
  body: string;
  createdAt: string;
};

/** Latest reply to the requester and latest internal note of each ticket. */
export function solutionTexts(
  comments: readonly TicketComment[],
): Map<string, { reply: string | null; note: string | null }> {
  const result = new Map<string, { reply: string | null; note: string | null }>();
  const sorted = [...comments].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  for (const comment of sorted) {
    if (!comment.body.trim()) continue;
    const entry = result.get(comment.ticketId) ?? { reply: null, note: null };
    if (comment.visibility === "external") entry.reply ??= comment.body;
    else entry.note ??= comment.body;
    result.set(comment.ticketId, entry);
  }
  return result;
}

export type ClusterSourceTicket = {
  subject: string;
  description: string;
  reply: string | null;
  note: string | null;
};

/** Upper bound accepted by the AI queue for ticket-based knowledge drafts. */
export const MAX_SOURCE_CHARACTERS = 12_000;
export const MAX_SOURCE_TICKETS = 8;

/**
 * Combined, redacted source text of a cluster for the AI draft: subject,
 * description and solution texts of the newest tickets, within the budget.
 */
export function buildClusterSource(
  titleHint: string,
  tickets: readonly ClusterSourceTicket[],
): string {
  const header = [
    `Gemeinsames Thema: ${redactTicketText(titleHint)}`,
    `Anzahl ähnlicher gelöster Tickets: ${tickets.length}`,
  ].join("\n");
  let budget = MAX_SOURCE_CHARACTERS - Array.from(header).length - 20;
  const parts: string[] = [header];
  let index = 0;
  for (const ticket of tickets.slice(0, MAX_SOURCE_TICKETS)) {
    index += 1;
    const lines = [
      `### Fall ${index}`,
      `Betreff: ${clipText(redactTicketText(ticket.subject), 240)}`,
      `Beschreibung: ${clipText(redactTicketText(ticket.description), 700)}`,
    ];
    if (ticket.reply?.trim()) {
      lines.push(`Lösung (letzte Antwort): ${clipText(redactTicketText(ticket.reply), 1_400)}`);
    }
    if (ticket.note?.trim()) {
      lines.push(`Interne Notiz: ${clipText(redactTicketText(ticket.note), 700)}`);
    }
    const block = lines.join("\n");
    const size = Array.from(block).length + 2;
    if (size > budget) break;
    budget -= size;
    parts.push(block);
  }
  return clipText(parts.join("\n\n"), MAX_SOURCE_CHARACTERS);
}

export const CLUSTER_ARTICLE_INSTRUCTIONS =
  " Der Rohinhalt besteht aus mehreren ähnlichen, bereits gelösten Support-Fällen (Betreff, Beschreibung, letzte Antwort und interne Notiz). Leite daraus einen allgemein wiederverwendbaren Lösungsartikel ab: beschreibe das gemeinsame Problem, typische Ursachen und die Lösungsschritte, die in mehreren Fällen funktioniert haben. Abweichungen einzelner Fälle höchstens als Hinweis. Lass Namen von Personen, E-Mail-Adressen, Telefonnummern, Ticketnummern, Grussformeln und Smalltalk weg. Ist keine gemeinsame Lösung erkennbar, schreibe die Erkenntnisse auf und kennzeichne den Artikel im Text deutlich als unvollständig.";
