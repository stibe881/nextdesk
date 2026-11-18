// Pure helpers of the portal-assistant function: input parsing, validation
// of the AI answer and the fallback ticket draft. No I/O.

import { tone } from "../_shared/formality.ts";
import { isRecord, isUuid } from "../_shared/http.ts";

/** The assistant asks at most this many clarifying questions. */
export const MAX_QUESTIONS = 2;
export const MAX_MESSAGES = 8;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_SUBJECT_LENGTH = 160;
export const MAX_DESCRIPTION_LENGTH = 4000;

export type ChatMessage = { role: "user" | "assistant"; text: string };

export type Outcome = "solved_by_article" | "ticket_created" | "abandoned";

/** Web addresses people formally («Sie»), the mobile app informally («du»). */
export type Address = "formal" | "informal";

export type TurnAction = {
  type: "turn";
  tenantId: string;
  address: Address;
  sessionId: string | null;
  departmentId: string | null;
  messages: ChatMessage[];
};

export type Action =
  | { type: "getSettings"; tenantId: string }
  | { type: "saveSettings"; tenantId: string; enabled: boolean }
  | TurnAction
  | {
    type: "finish";
    tenantId: string;
    sessionId: string;
    outcome: Outcome;
    articleId: string | null;
    ticketId: string | null;
  };

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  if (value.includes("\u0000") || /\p{Cs}/u.test(value)) return null;
  const trimmed = value.trim();
  return trimmed && [...trimmed].length <= max ? trimmed : null;
}

function optionalUuid(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return isUuid(value) ? value.toLowerCase() : undefined;
}

export function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return null;
  const messages: ChatMessage[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    if (entry.role !== "user" && entry.role !== "assistant") return null;
    const text = cleanText(entry.text, MAX_MESSAGE_LENGTH);
    if (!text) return null;
    messages.push({ role: entry.role, text });
  }
  // The conversation starts and ends with the person.
  return messages[0]!.role === "user" && messages.at(-1)!.role === "user" ? messages : null;
}

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  switch (value.type) {
    case "getSettings":
      return { type: "getSettings", tenantId };
    case "saveSettings":
      return typeof value.enabled === "boolean"
        ? { type: "saveSettings", tenantId, enabled: value.enabled }
        : null;
    case "turn": {
      const sessionId = optionalUuid(value.sessionId);
      const departmentId = optionalUuid(value.departmentId);
      const messages = parseMessages(value.messages);
      if (sessionId === undefined || departmentId === undefined || !messages) return null;
      if (value.address !== undefined && value.address !== "formal" && value.address !== "informal") {
        return null;
      }
      const address: Address = value.address === "formal" ? "formal" : "informal";
      return { type: "turn", tenantId, address, sessionId, departmentId, messages };
    }
    case "finish": {
      if (!isUuid(value.sessionId)) return null;
      const outcome = value.outcome;
      if (outcome !== "solved_by_article" && outcome !== "ticket_created" && outcome !== "abandoned") {
        return null;
      }
      const articleId = optionalUuid(value.articleId);
      const ticketId = optionalUuid(value.ticketId);
      if (articleId === undefined || ticketId === undefined) return null;
      if (outcome === "solved_by_article" && !articleId) return null;
      if (outcome === "ticket_created" && !ticketId) return null;
      return {
        type: "finish",
        tenantId,
        sessionId: value.sessionId.toLowerCase(),
        outcome,
        articleId: outcome === "solved_by_article" ? articleId : null,
        ticketId: outcome === "ticket_created" ? ticketId : null,
      };
    }
    default:
      return null;
  }
}

/** Text of all user messages, for the knowledge search and the fallback. */
export function userText(messages: ChatMessage[]): string {
  return messages.filter((message) => message.role === "user").map((message) => message.text).join("\n");
}

function clip(value: string, max: number): string {
  const characters = [...value];
  return characters.length <= max ? value : `${characters.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * Ticket draft without AI: the first sentence of the first message is the
 * subject, all messages of the person form the description.
 */
export function fallbackDraft(messages: ChatMessage[]): { subject: string; description: string } {
  const first = messages.find((message) => message.role === "user")?.text ?? "";
  const sentence = first.split(/(?<=[.!?])\s|\n/u)[0]?.trim() || first.trim();
  const subject = clip(sentence.replace(/\s+/g, " "), MAX_SUBJECT_LENGTH);
  const parts: string[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role === "user") {
      const question = index > 0 && messages[index - 1]!.role === "assistant"
        ? messages[index - 1]!.text
        : null;
      parts.push(question ? `Rückfrage: ${question}\nAntwort: ${message.text}` : message.text);
    }
  }
  return {
    subject: subject.length >= 3 ? subject : "Anfrage über den Assistenten",
    description: clip(parts.join("\n\n"), MAX_DESCRIPTION_LENGTH),
  };
}

export type AiAnswer = {
  reply: string;
  articleIds: string[];
  question: string | null;
  subject: string;
  description: string;
  categoryId: string | null;
};

/**
 * Validates the AI answer: only known article and category IDs, at most three
 * articles, and no further question once MAX_QUESTIONS were asked.
 */
export function parseAiAnswer(
  value: unknown,
  candidates: { articleIds: string[]; categoryIds: string[] },
  questionsAsked: number,
  fallback: { subject: string; description: string },
): AiAnswer | null {
  if (!isRecord(value)) return null;
  const reply = typeof value.reply === "string" ? clip(value.reply.trim(), 600) : "";
  const articleIds = Array.isArray(value.articleIds)
    ? [...new Set(value.articleIds.filter((id): id is string =>
      typeof id === "string" && candidates.articleIds.includes(id)
    ))].slice(0, 3)
    : [];
  const rawQuestion = typeof value.question === "string" ? value.question.trim() : "";
  const question = questionsAsked < MAX_QUESTIONS && rawQuestion ? clip(rawQuestion, 300) : null;
  const subject = typeof value.subject === "string" && [...value.subject.trim()].length >= 3
    ? clip(value.subject.trim().replace(/\s+/g, " "), MAX_SUBJECT_LENGTH)
    : fallback.subject;
  const description = typeof value.description === "string" && value.description.trim()
    ? clip(value.description.trim(), MAX_DESCRIPTION_LENGTH)
    : fallback.description;
  const categoryId = typeof value.categoryId === "string" &&
      candidates.categoryIds.includes(value.categoryId)
    ? value.categoryId
    : null;
  if (!reply && !question) return null;
  return { reply, articleIds, question, subject, description, categoryId };
}

/** Reply text when no AI is used (plain article search). */
export function searchReply(articleCount: number, address: Address = "informal"): string {
  const formality = address === "informal" ? "du" : "sie";
  return articleCount > 0
    ? tone(
      formality,
      "Diese Artikel aus der Wissensdatenbank könnten dir weiterhelfen. Wenn keiner passt, erstelle direkt ein Ticket.",
      "Diese Artikel aus der Wissensdatenbank könnten weiterhelfen. Wenn keiner passt, erstellen Sie direkt ein Ticket.",
    )
    : tone(
      formality,
      "Dazu habe ich keinen passenden Artikel gefunden. Du kannst direkt ein Ticket mit deiner Beschreibung erstellen.",
      "Dazu habe ich keinen passenden Artikel gefunden. Sie können direkt ein Ticket mit Ihrer Beschreibung erstellen.",
    );
}
