import { tn } from "./formality";
// Parsing and texts for the knowledge article suggestions
// (edge function `knowledge-suggestions`).

export type KnowledgeSuggestionTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  solvedAt: string | null;
};

export type KnowledgeSuggestion = {
  id: string;
  departmentId: string | null;
  titleHint: string;
  ticketCount: number;
  status: "open" | "drafted";
  articleId: string | null;
  sampleTickets: KnowledgeSuggestionTicket[];
};

export type KnowledgeSuggestionList = {
  windowDays: number;
  refreshedAt: string | null;
  ai: { available: boolean; code: string | null };
  suggestions: KnowledgeSuggestion[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTicket(value: unknown): KnowledgeSuggestionTicket | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    ticketNumber:
      typeof value.ticketNumber === "string" ||
      typeof value.ticketNumber === "number"
        ? String(value.ticketNumber)
        : "",
    subject: typeof value.subject === "string" ? value.subject : "",
    solvedAt: typeof value.solvedAt === "string" ? value.solvedAt : null,
  };
}

function parseSuggestion(value: unknown): KnowledgeSuggestion | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.titleHint !== "string" ||
    (value.status !== "open" && value.status !== "drafted")
  ) {
    return null;
  }
  return {
    id: value.id,
    departmentId:
      typeof value.departmentId === "string" ? value.departmentId : null,
    titleHint: value.titleHint,
    ticketCount:
      typeof value.ticketCount === "number" &&
      Number.isFinite(value.ticketCount)
        ? value.ticketCount
        : 0,
    status: value.status,
    articleId: typeof value.articleId === "string" ? value.articleId : null,
    sampleTickets: Array.isArray(value.sampleTickets)
      ? value.sampleTickets
          .map(parseTicket)
          .filter((ticket): ticket is KnowledgeSuggestionTicket =>
            Boolean(ticket),
          )
      : [],
  };
}

export function parseKnowledgeSuggestionList(
  value: unknown,
): KnowledgeSuggestionList {
  const data = isRecord(value) && isRecord(value.data) ? value.data : null;
  if (!data || !Array.isArray(data.suggestions)) {
    throw new Error("Die Antwort der Artikelvorschläge ist unvollständig.");
  }
  const ai = isRecord(data.ai) ? data.ai : {};
  return {
    windowDays: typeof data.windowDays === "number" ? data.windowDays : 120,
    refreshedAt: typeof data.refreshedAt === "string" ? data.refreshedAt : null,
    ai: {
      available: ai.available === true,
      code: typeof ai.code === "string" ? ai.code : null,
    },
    suggestions: data.suggestions
      .map(parseSuggestion)
      .filter((entry): entry is KnowledgeSuggestion => Boolean(entry)),
  };
}

export function parseKnowledgeSuggestionDraft(value: unknown): string {
  const data = isRecord(value) && isRecord(value.data) ? value.data : null;
  if (!data || typeof data.articleId !== "string") {
    throw new Error("Die Antwort des KI-Entwurfs ist unvollständig.");
  }
  return data.articleId;
}

const messages = (): Record<string, string> => ({
  article_manage_denied: tn(
    "Für Artikelvorschläge fehlt dir die Berechtigung zur Wissensverwaltung.",
    "Für Artikelvorschläge fehlt Ihnen die Berechtigung zur Wissensverwaltung.",
  ),
  knowledge_feature_disabled: tn(
    "Die Wissensdatenbank ist für dich nicht aktiviert.",
    "Die Wissensdatenbank ist für Sie nicht aktiviert.",
  ),
  ai_feature_disabled:
    "Die KI-Unterstützung ist für diesen Mandanten nicht aktiviert. Eine Administratorin oder ein Administrator kann sie in den Einstellungen einschalten.",
  ai_provider_not_approved:
    "Die KI-Unterstützung ist für diesen Mandanten noch nicht freigegeben. Eine Administratorin oder ein Administrator kann sie in den Einstellungen freigeben.",
  ai_purpose_not_approved:
    "Die KI-Unterstützung für Wissensartikel ist für diesen Mandanten noch nicht freigegeben.",
  ai_governance_unavailable: tn(
    "Die KI-Freigabe kann im Moment nicht geprüft werden. Bitte versuche es später erneut.",
    "Die KI-Freigabe kann im Moment nicht geprüft werden. Bitte versuchen Sie es später erneut.",
  ),
  ai_budget_exceeded: tn(
    "Das stündliche KI-Kontingent ist erreicht. Bitte versuche es später erneut.",
    "Das stündliche KI-Kontingent ist erreicht. Bitte versuchen Sie es später erneut.",
  ),
  ai_provider_rate_limited: tn(
    "Der KI-Dienst ist gerade ausgelastet. Bitte versuche es in einer Minute erneut.",
    "Der KI-Dienst ist gerade ausgelastet. Bitte versuchen Sie es in einer Minute erneut.",
  ),
  ai_provider_not_configured: "Die KI-Anbindung ist noch nicht eingerichtet.",
  ai_object_not_available:
    "Die Tickets dieses Vorschlags sind nicht mehr verfügbar.",
  tickets_not_found: tn(
    "Die Tickets dieses Vorschlags sind für dich nicht verfügbar.",
    "Die Tickets dieses Vorschlags sind für Sie nicht verfügbar.",
  ),
  suggestion_not_found: "Der Vorschlag ist nicht mehr verfügbar.",
  suggestion_closed: "Der Vorschlag wurde bereits abgeschlossen.",
  draft_in_progress: tn(
    "Für diesen Vorschlag wird gerade ein Entwurf erstellt. Bitte warte einen Moment.",
    "Für diesen Vorschlag wird gerade ein Entwurf erstellt. Bitte warten Sie einen Moment.",
  ),
  article_department_required: tn(
    "Bitte lege zuerst fest, welcher Abteilung der Artikel gehören soll.",
    "Bitte legen Sie zuerst fest, welcher Abteilung der Artikel gehören soll.",
  ),
});

/** Codes for which the AI is not usable for this tenant at all. */
export const AI_UNAVAILABLE_CODES = new Set([
  "ai_feature_disabled",
  "ai_provider_not_approved",
  "ai_purpose_not_approved",
  "ai_provider_not_configured",
]);

export function knowledgeSuggestionMessage(
  code: string | null | undefined,
  fallback: string,
): string {
  return (code && messages()[code]) || fallback;
}
