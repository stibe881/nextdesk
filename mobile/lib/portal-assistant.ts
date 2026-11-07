// «Selbstbedienungs-Assistent im Portal»: contract of the portal-assistant
// edge function (pure parsing, no I/O).

export type AssistantMessage = { role: "user" | "assistant"; text: string };

export type AssistantArticle = { id: string; title: string; excerpt: string };

export type AssistantDraft = {
  subject: string;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
};

export type AssistantTurn = {
  sessionId: string;
  mode: "ai" | "search";
  reply: string;
  question: string | null;
  questionsLeft: number;
  articles: AssistantArticle[];
  draft: AssistantDraft;
};

export type AssistantSettings = {
  enabled: boolean;
  canManage: boolean;
  summary: {
    days: number;
    total: number;
    solvedByArticle: number;
    ticketCreated: number;
    abandoned: number;
    aiSessions: number;
  } | null;
};

/** The server keeps at most 8 messages; older ones are dropped first. */
export const MAX_ASSISTANT_MESSAGES = 8;
export const MAX_ASSISTANT_MESSAGE_LENGTH = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

/**
 * Messages for the next turn: the newest first user message is kept and the
 * list always starts with a person's message (server contract).
 */
export function messagesForTurn(
  history: AssistantMessage[],
): AssistantMessage[] {
  const clean = history
    .map((message) => ({
      role: message.role,
      text: message.text.trim().slice(0, MAX_ASSISTANT_MESSAGE_LENGTH),
    }))
    .filter((message) => message.text);
  if (clean.length <= MAX_ASSISTANT_MESSAGES) return clean;
  const first = clean.find((message) => message.role === "user");
  let rest = clean.slice(-(MAX_ASSISTANT_MESSAGES - 1));
  while (rest.length && rest[0]!.role !== "user") rest = rest.slice(1);
  return first && !rest.includes(first) ? [first, ...rest] : rest;
}

export function parseAssistantTurn(value: unknown): AssistantTurn | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  const sessionId = text(data.sessionId, 64);
  const reply = text(data.reply, 2000);
  if (!sessionId || reply === null) return null;
  if (data.mode !== "ai" && data.mode !== "search") return null;
  const draft = isRecord(data.draft) ? data.draft : {};
  const subject = text(draft.subject, 400);
  const description = text(draft.description, 10_000);
  if (subject === null || description === null) return null;
  const articles = Array.isArray(data.articles)
    ? data.articles.flatMap((entry: unknown) => {
        if (!isRecord(entry)) return [];
        const id = text(entry.id, 64);
        const title = text(entry.title, 400);
        if (!id || !title) return [];
        return [{ id, title, excerpt: text(entry.excerpt, 1000) ?? "" }];
      })
    : [];
  const question = text(data.question, 1000);
  return {
    sessionId,
    mode: data.mode,
    reply,
    question: question && question.trim() ? question : null,
    questionsLeft: count(data.questionsLeft),
    articles,
    draft: {
      subject,
      description,
      categoryId: text(draft.categoryId, 64) || null,
      categoryName: text(draft.categoryName, 400) || null,
    },
  };
}

export function parseAssistantSettings(value: unknown): AssistantSettings {
  const data = isRecord(value) && isRecord(value.data) ? value.data : {};
  const summary = isRecord(data.summary) ? data.summary : null;
  return {
    enabled: data.enabled === true,
    canManage: data.canManage === true,
    summary: summary
      ? {
          days: count(summary.days) || 30,
          total: count(summary.total),
          solvedByArticle: count(summary.solvedByArticle),
          ticketCreated: count(summary.ticketCreated),
          abandoned: count(summary.abandoned),
          aiSessions: count(summary.aiSessions),
        }
      : null,
  };
}

/** Share of conversations solved without a ticket, in whole percent. */
export function deflectionRate(summary: AssistantSettings["summary"]): number {
  if (!summary) return 0;
  const finished = summary.solvedByArticle + summary.ticketCreated;
  return finished === 0
    ? 0
    : Math.round((summary.solvedByArticle / finished) * 100);
}
