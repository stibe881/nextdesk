import { tn } from "./lib/formality";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, CheckCircle2, Lightbulb, Ticket } from "lucide-react";
import { supabase } from "./lib/supabase";
import { KnowledgeMarkdown } from "./knowledge-markdown";
import {
  parseKnowledgeImageUrls,
  type KnowledgeImageUrls,
} from "./lib/knowledge-images";
import {
  classificationSource,
  outcomeQueryText,
  parseTicketSuggestions,
  SUGGESTION_DEBOUNCE_MS,
  suggestionRequest,
  type ClassificationVote,
  type SuggestedArticle,
  type SuggestedTicket,
  type SuggestionMode,
  type TicketSuggestions,
} from "./lib/ticket-suggestions";
import "./ticket-suggestions.css";

/**
 * Suggestions for a ticket draft, requested with a debounce while typing.
 * Failures stay quiet: suggestions never block ticket creation.
 */
export function useTicketSuggestions({
  description,
  enabled,
  mode,
  subject,
  tenantId,
}: {
  description: string;
  enabled: boolean;
  mode: SuggestionMode;
  subject: string;
  tenantId: string;
}): { suggestions: TicketSuggestions | null; clear: () => void } {
  const [suggestions, setSuggestions] = useState<TicketSuggestions | null>(
    null,
  );
  const requestRef = useRef(0);
  const request = enabled
    ? suggestionRequest(tenantId, subject, description, mode)
    : null;
  const key = request ? JSON.stringify(request) : "";

  useEffect(() => {
    const requestId = ++requestRef.current;
    const client = supabase;
    if (!client || !key) {
      setSuggestions(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void client.functions
        .invoke("ticket-suggestions", {
          body: JSON.parse(key) as Record<string, unknown>,
        })
        .then(({ data, error }) => {
          if (error) throw error;
          const parsed = parseTicketSuggestions(data);
          if (requestRef.current === requestId) setSuggestions(parsed);
        })
        .catch(() => {
          if (requestRef.current === requestId) setSuggestions(null);
        });
    }, SUGGESTION_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ++requestRef.current;
    };
  }, [key]);

  const clear = useCallback(() => {
    ++requestRef.current;
    setSuggestions(null);
  }, []);
  return { suggestions, clear };
}

async function recordOutcome(
  tenantId: string,
  articleId: string,
  kind: "deflected" | "not_helpful",
  queryText: string | undefined,
): Promise<void> {
  if (!supabase) return;
  // The outcome is statistics only; a failure must not bother the person.
  await supabase.functions
    .invoke("ticket-suggestions", {
      body: {
        type: "recordOutcome",
        tenantId,
        articleId,
        kind,
        ...(queryText ? { queryText } : {}),
      },
    })
    .catch(() => undefined);
}

type ArticleView =
  | { status: "loading" }
  | { status: "ready"; body: string; imageUrls: KnowledgeImageUrls }
  | { status: "error" };

function parseArticleView(value: unknown): ArticleView {
  if (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null &&
    "revision" in value.data &&
    typeof value.data.revision === "object" &&
    value.data.revision !== null &&
    "body" in value.data.revision &&
    typeof value.data.revision.body === "string"
  ) {
    const imageUrls = parseKnowledgeImageUrls(
      "imageUrls" in value.data ? value.data.imageUrls : undefined,
    );
    return {
      status: "ready",
      body: value.data.revision.body,
      imageUrls: imageUrls ?? {},
    };
  }
  return { status: "error" };
}

function ticketLabel(ticket: SuggestedTicket): string {
  const number = ticket.ticketNumber.startsWith("#")
    ? ticket.ticketNumber
    : `#${ticket.ticketNumber}`;
  return `${number} – ${ticket.subject}`;
}

/**
 * Articles, duplicate hints (requesters) and similar solved tickets (agents)
 * for the draft. Requesters can close their request with "Hat mein Problem
 * gelöst" (recorded as deflected, no ticket is created).
 */
/** What happens with a suggested article when the ticket is created. */
export type ArticleChoice = "link" | "internal" | "external";

export function TicketSuggestionPanel({
  articleChoices,
  disabled = false,
  onArticleChoice,
  onDeflected,
  onOpenKnowledgeArticle,
  onOpenTicket,
  subject,
  suggestions,
  tenantId,
}: {
  articleChoices?: Readonly<Record<string, ArticleChoice>> | undefined;
  disabled?: boolean;
  onArticleChoice?:
    | ((article: SuggestedArticle, choice: ArticleChoice | null) => void)
    | undefined;
  onDeflected?: (() => void) | undefined;
  onOpenKnowledgeArticle?: ((articleId: string) => void) | undefined;
  onOpenTicket?: ((ticketId: string, ticketNumber: string) => void) | undefined;
  subject: string;
  suggestions: TicketSuggestions | null;
  tenantId: string;
}) {
  const [openArticleId, setOpenArticleId] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, ArticleView>>({});
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [busyArticleId, setBusyArticleId] = useState<string | null>(null);

  useEffect(() => {
    setOpenArticleId(null);
    setViews({});
    setDismissed([]);
    setNotice("");
  }, [tenantId]);

  if (!suggestions) return null;
  const requester = suggestions.mode === "requester";
  const articles = suggestions.articles.filter(
    (article) => !dismissed.includes(article.id),
  );
  const duplicates = requester ? suggestions.duplicates : [];
  const solved = requester ? [] : suggestions.solvedTickets;
  if (!articles.length && !duplicates.length && !solved.length && !notice)
    return null;

  function toggleArticle(article: SuggestedArticle) {
    if (openArticleId === article.id) {
      setOpenArticleId(null);
      return;
    }
    setOpenArticleId(article.id);
    if (views[article.id]?.status === "ready" || !supabase) return;
    setViews((current) => ({
      ...current,
      [article.id]: { status: "loading" },
    }));
    void supabase.functions
      .invoke("knowledge-base", {
        body: { type: "getArticle", tenantId, articleId: article.id },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        return parseArticleView(data);
      })
      .catch((): ArticleView => ({ status: "error" }))
      .then((view) =>
        setViews((current) => ({ ...current, [article.id]: view })),
      );
  }

  async function markDeflected(article: SuggestedArticle) {
    if (busyArticleId) return;
    setBusyArticleId(article.id);
    await recordOutcome(
      tenantId,
      article.id,
      "deflected",
      outcomeQueryText(subject),
    );
    setBusyArticleId(null);
    setOpenArticleId(null);
    onDeflected?.();
  }

  async function markNotHelpful(article: SuggestedArticle) {
    if (busyArticleId) return;
    setBusyArticleId(article.id);
    await recordOutcome(
      tenantId,
      article.id,
      "not_helpful",
      outcomeQueryText(subject),
    );
    setBusyArticleId(null);
    setDismissed((current) => [...current, article.id]);
    if (openArticleId === article.id) setOpenArticleId(null);
    setNotice("Danke für die Rückmeldung.");
  }

  return (
    <section
      aria-labelledby="ticket-suggestions-heading"
      aria-live="polite"
      className="ticket-suggestions ticket-compose-description"
    >
      {duplicates.map((ticket) => (
        <div className="ticket-suggestions__duplicate" key={ticket.id}>
          <Ticket aria-hidden="true" size={18} strokeWidth={1.8} />
          <p>
            {tn(
              "Du hast dazu bereits ein offenes Ticket:",
              "Sie haben dazu bereits ein offenes Ticket:",
            )}{" "}
            <strong>{ticketLabel(ticket)}</strong>
            {ticket.statusLabel && (
              <span className="ticket-suggestions__muted">
                {" "}
                ({ticket.statusLabel})
              </span>
            )}
          </p>
          {onOpenTicket && (
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => onOpenTicket(ticket.id, ticket.ticketNumber)}
              type="button"
            >
              Ticket öffnen
            </button>
          )}
        </div>
      ))}

      {articles.length > 0 && (
        <>
          <div className="ticket-suggestions__heading">
            <Lightbulb aria-hidden="true" size={18} strokeWidth={1.8} />
            <h3 id="ticket-suggestions-heading">
              {requester
                ? tn("Könnte dir das helfen?", "Könnte Ihnen das helfen?")
                : "Passende Artikel aus der Wissensdatenbank"}
            </h3>
          </div>
          <ul className="ticket-suggestions__list">
            {articles.map((article) => {
              const open = openArticleId === article.id;
              const view = views[article.id];
              return (
                <li className="ticket-suggestions__article" key={article.id}>
                  <strong>{article.title}</strong>
                  {!requester && article.visibility === "internal" && (
                    <span className="ticket-suggestions__badge">Intern</span>
                  )}
                  {article.excerpt && !open && <p>{article.excerpt}</p>}
                  {open && (
                    <div id={`ticket-suggestion-article-${article.id}`}>
                      {view?.status === "ready" ? (
                        <div className="knowledge-markdown ticket-suggestions__article-body">
                          <KnowledgeMarkdown
                            body={view.body}
                            imageUrls={view.imageUrls}
                          />
                        </div>
                      ) : view?.status === "error" ? (
                        <p className="ticket-suggestions__muted" role="status">
                          Der Artikel konnte nicht geladen werden.
                        </p>
                      ) : (
                        <p className="ticket-suggestions__muted" role="status">
                          Artikel wird geladen …
                        </p>
                      )}
                    </div>
                  )}
                  {!requester && onArticleChoice ? (
                    <label className="ticket-suggestions__choice">
                      Beim Erstellen
                      <select
                        disabled={disabled}
                        onChange={(event) =>
                          onArticleChoice(
                            article,
                            event.target.value === ""
                              ? null
                              : (event.target.value as ArticleChoice),
                          )
                        }
                        value={articleChoices?.[article.id] ?? ""}
                      >
                        <option value="">Nicht übernehmen</option>
                        <option value="link">Mit Ticket verknüpfen</option>
                        <option value="internal">
                          Verknüpfen und als interne Notiz eintragen
                        </option>
                        {article.visibility === "external" ? (
                          <option value="external">
                            Verknüpfen und als Antwort an anfragende Person
                            senden
                          </option>
                        ) : null}
                      </select>
                    </label>
                  ) : null}
                  <div className="ticket-suggestions__actions">
                    <button
                      aria-controls={`ticket-suggestion-article-${article.id}`}
                      aria-expanded={open}
                      className="text-button"
                      onClick={() => toggleArticle(article)}
                      type="button"
                    >
                      <BookOpen
                        aria-hidden="true"
                        size={15}
                        strokeWidth={1.8}
                      />
                      {open
                        ? "Artikel schliessen"
                        : requester
                          ? "Artikel ansehen"
                          : "Artikel öffnen"}
                    </button>
                    {!requester && open && onOpenKnowledgeArticle && (
                      <button
                        className="text-button"
                        disabled={disabled}
                        onClick={() => onOpenKnowledgeArticle(article.id)}
                        type="button"
                      >
                        In der Wissensdatenbank öffnen
                      </button>
                    )}
                    {requester && onDeflected && (
                      <button
                        className="secondary-button"
                        disabled={disabled || busyArticleId !== null}
                        onClick={() => void markDeflected(article)}
                        type="button"
                      >
                        <CheckCircle2
                          aria-hidden="true"
                          size={15}
                          strokeWidth={1.8}
                        />
                        Hat mein Problem gelöst
                      </button>
                    )}
                    {requester && (
                      <button
                        className="text-button"
                        disabled={disabled || busyArticleId !== null}
                        onClick={() => void markNotHelpful(article)}
                        type="button"
                      >
                        Hilft nicht
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {notice && (
        <p className="ticket-suggestions__muted" role="status">
          {notice}
        </p>
      )}

      {solved.length > 0 && (
        <div className="ticket-suggestions__solved">
          <h3>Ähnliche gelöste Tickets</h3>
          <ul>
            {solved.map((ticket) => (
              <li key={ticket.id}>
                {onOpenTicket ? (
                  <button
                    className="text-button"
                    disabled={disabled}
                    onClick={() => onOpenTicket(ticket.id, ticket.ticketNumber)}
                    type="button"
                  >
                    {ticketLabel(ticket)}
                  </button>
                ) : (
                  <span>{ticketLabel(ticket)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** "Vorschlag: Netzwerk (aus 4 ähnlichen Tickets) – übernehmen" */
export function ClassificationSuggestion({
  disabled = false,
  onApply,
  vote,
}: {
  disabled?: boolean;
  onApply: () => void;
  vote: ClassificationVote;
}) {
  return (
    <button
      className="text-button ticket-suggestions__classification"
      disabled={disabled}
      onClick={onApply}
      type="button"
    >
      Vorschlag: {vote.name} ({classificationSource(vote.matches)}) – übernehmen
    </button>
  );
}
