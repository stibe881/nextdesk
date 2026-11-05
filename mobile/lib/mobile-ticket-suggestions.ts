// Suggestions while a ticket is created (ticket-suggestions edge function),
// the same contract as the web composer (apps/web/src/lib/ticket-suggestions.ts).

import { invokeNextDesk } from "./nextdesk-client";

export type SuggestionMode = "requester" | "agent";

export type SuggestedArticle = {
  id: string;
  title: string;
  excerpt: string;
  visibility: "internal" | "external";
};

export type SuggestedTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  statusLabel: string;
};

export type ClassificationVote = { id: string; name: string; matches: number };

export type TicketClassification = {
  sampleSize: number;
  category: (ClassificationVote & { departmentId: string }) | null;
  department: ClassificationVote | null;
  priority: (ClassificationVote & { key: string }) | null;
};

export type TicketSuggestions = {
  mode: SuggestionMode;
  articles: SuggestedArticle[];
  duplicates: SuggestedTicket[];
  classification: TicketClassification | null;
  solvedTickets: SuggestedTicket[];
};

/** Debounce before suggestions are requested while typing (as on the web). */
export const SUGGESTION_DEBOUNCE_MS = 400;
export const MIN_SUGGESTION_SUBJECT_LENGTH = 4;
const MAX_SUBJECT_LENGTH = 240;
const MAX_DESCRIPTION_LENGTH = 4000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function list<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) throw new Error("invalid_ticket_suggestions");
  return value.slice(0, 10).map((entry) => {
    const parsed = parse(entry);
    if (parsed === null) throw new Error("invalid_ticket_suggestions");
    return parsed;
  });
}

function parseArticle(value: unknown): SuggestedArticle | null {
  if (!isRecord(value) || typeof value.id !== "string" || !UUID.test(value.id))
    return null;
  const title = text(value.title, 500);
  const excerpt = text(value.excerpt, 400);
  if (!title?.trim() || excerpt === null) return null;
  if (value.visibility !== "internal" && value.visibility !== "external")
    return null;
  return { id: value.id, title, excerpt, visibility: value.visibility };
}

function parseTicket(value: unknown): SuggestedTicket | null {
  if (!isRecord(value) || typeof value.id !== "string" || !UUID.test(value.id))
    return null;
  const ticketNumber = text(value.ticketNumber, 120);
  const subject = text(value.subject, 1000);
  const statusLabel = text(value.statusLabel, 160);
  if (ticketNumber === null || subject === null || statusLabel === null)
    return null;
  return { id: value.id, ticketNumber, subject, statusLabel };
}

function parseVote(value: unknown): ClassificationVote | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.id !== "string" || !UUID.test(value.id))
    return undefined;
  const name = text(value.name, 240);
  const matches = count(value.matches);
  if (!name?.trim() || matches === null || matches < 2) return undefined;
  return { id: value.id, name, matches };
}

function parseClassification(value: unknown): TicketClassification | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new Error("invalid_ticket_suggestions");
  const sampleSize = count(value.sampleSize);
  const department = parseVote(value.department);
  const category = parseVote(value.category);
  const priority = parseVote(value.priority);
  const categoryDepartment = isRecord(value.category)
    ? value.category.departmentId
    : null;
  const priorityKey = isRecord(value.priority) ? value.priority.key : null;
  if (
    sampleSize === null ||
    department === undefined ||
    category === undefined ||
    priority === undefined ||
    (category !== null &&
      (typeof categoryDepartment !== "string" ||
        !UUID.test(categoryDepartment))) ||
    (priority !== null &&
      (typeof priorityKey !== "string" || !priorityKey.trim()))
  ) {
    throw new Error("invalid_ticket_suggestions");
  }
  return {
    sampleSize,
    department,
    category:
      category && typeof categoryDepartment === "string"
        ? { ...category, departmentId: categoryDepartment }
        : null,
    priority:
      priority && typeof priorityKey === "string"
        ? { ...priority, key: priorityKey }
        : null,
  };
}

export function parseTicketSuggestions(value: unknown): TicketSuggestions {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("invalid_ticket_suggestions");
  }
  const data = value.data;
  if (data.mode !== "requester" && data.mode !== "agent") {
    throw new Error("invalid_ticket_suggestions");
  }
  return {
    mode: data.mode,
    articles: list(data.articles, parseArticle).slice(0, 3),
    duplicates: list(data.duplicates, parseTicket).slice(0, 3),
    classification: parseClassification(data.classification),
    solvedTickets: list(data.solvedTickets, parseTicket).slice(0, 3),
  };
}

/** Request body for `suggest`, or null while the subject is too short. */
export function suggestionRequest(
  tenantId: string,
  subject: string,
  description: string,
  mode: SuggestionMode,
): {
  type: "suggest";
  tenantId: string;
  subject: string;
  description: string;
  mode: SuggestionMode;
} | null {
  const clean = (value: string) => value.replaceAll("\u0000", "").trim();
  const trimmedSubject = Array.from(clean(subject))
    .slice(0, MAX_SUBJECT_LENGTH)
    .join("")
    .trim();
  if (Array.from(trimmedSubject).length < MIN_SUGGESTION_SUBJECT_LENGTH)
    return null;
  return {
    type: "suggest",
    tenantId,
    subject: trimmedSubject,
    description: Array.from(clean(description))
      .slice(0, MAX_DESCRIPTION_LENGTH)
      .join("")
      .trim(),
    mode,
  };
}

/** "aus 4 ähnlichen Tickets" */
export function classificationSource(matches: number): string {
  return matches === 1
    ? "aus 1 ähnlichen Ticket"
    : `aus ${matches} ähnlichen Tickets`;
}

/** "#T-12 – Betreff" */
export function suggestedTicketLabel(ticket: SuggestedTicket): string {
  const number = ticket.ticketNumber.startsWith("#")
    ? ticket.ticketNumber
    : `#${ticket.ticketNumber}`;
  return `${number} – ${ticket.subject}`;
}

export async function loadTicketSuggestions(
  request: NonNullable<ReturnType<typeof suggestionRequest>>,
): Promise<TicketSuggestions> {
  return parseTicketSuggestions(
    await invokeNextDesk<unknown>("ticket-suggestions", request),
  );
}

/** Statistics only: a failure never bothers the person. */
export async function recordSuggestionOutcome(input: {
  tenantId: string;
  articleId: string;
  kind: "deflected" | "not_helpful";
  subject: string;
}): Promise<void> {
  const queryText = Array.from(input.subject.trim())
    .slice(0, 500)
    .join("")
    .trim();
  try {
    await invokeNextDesk<unknown>("ticket-suggestions", {
      type: "recordOutcome",
      tenantId: input.tenantId,
      articleId: input.articleId,
      kind: input.kind,
      ...(queryText ? { queryText } : {}),
    });
  } catch {
    // Ignored on purpose.
  }
}

/**
 * Same decision as the web composer: agent suggestions when the person may
 * assign agents in the selected department (ticket-agent-assignment answers),
 * otherwise the requester view. The server checks the mode again.
 */
export async function resolveSuggestionMode(
  tenantId: string,
  departmentId: string,
): Promise<SuggestionMode> {
  if (!departmentId) return "requester";
  try {
    await invokeNextDesk<unknown>("ticket-agent-assignment", {
      type: "listForDepartment",
      tenantId,
      departmentId,
    });
    return "agent";
  } catch {
    return "requester";
  }
}
