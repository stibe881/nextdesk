import { useCallback, useEffect, useRef, useState } from "react";
import { functionErrorStatus } from "./lib/function-error";
import {
  AI_UNAVAILABLE_CODES,
  knowledgeSuggestionMessage,
  parseKnowledgeSuggestionDraft,
  parseKnowledgeSuggestionList,
  type KnowledgeSuggestionList,
} from "./lib/knowledge-suggestions";
import { supabase } from "./lib/supabase";

type SuggestionRequest =
  | { type: "list" | "refresh"; tenantId: string }
  | { type: "draft" | "dismiss"; tenantId: string; suggestionId: string };

class SuggestionError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number | null,
  ) {
    super(message);
  }
}

async function invokeSuggestions<T>(
  request: SuggestionRequest,
  parse: (value: unknown) => T,
  fallback: string,
): Promise<T> {
  if (!supabase) {
    throw new SuggestionError(
      "Die Verbindung zu Supabase ist nicht konfiguriert.",
      null,
      null,
    );
  }
  const { data, error } = await supabase.functions.invoke<unknown>(
    "knowledge-suggestions",
    { body: request },
  );
  if (error) {
    let code: string | null = null;
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const body = (await context.clone().json()) as {
          error?: { code?: unknown };
        };
        code = typeof body.error?.code === "string" ? body.error.code : null;
      } catch {
        code = null;
      }
    }
    throw new SuggestionError(
      knowledgeSuggestionMessage(code, fallback),
      code,
      functionErrorStatus(error),
    );
  }
  return parse(data);
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeZone: "Europe/Zurich",
  }).format(date);
}

const styles = `
  .knowledge-suggestions { display: grid; gap: 14px; padding: 22px 24px 24px; }
  .knowledge-suggestions .eyebrow { margin: 0 0 4px; }
  .knowledge-suggestions__header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .knowledge-suggestions__header h2 { margin: 0; }
  .knowledge-suggestions__intro { margin: 6px 0 0; color: var(--muted, #64748b); max-width: 60ch; }
  .knowledge-suggestions__note { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--surface-muted, #f1f5f9); }
  .knowledge-suggestions__error { margin: 0; color: var(--danger, #b91c1c); }
  .knowledge-suggestions__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .knowledge-suggestions__item { border: 1px solid var(--border, #e2e8f0); border-radius: 10px; padding: 12px 14px; display: grid; gap: 8px; }
  .knowledge-suggestions__item-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; }
  .knowledge-suggestions__item-head h3 { margin: 0; font-size: 1rem; }
  .knowledge-suggestions__meta { color: var(--muted, #64748b); font-size: 0.875rem; }
  p.knowledge-suggestions__meta { margin: 0; }
  .knowledge-suggestions__tickets { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
  .knowledge-suggestions__ticket { background: none; border: 0; padding: 0; color: var(--accent, #075985); cursor: pointer; text-align: left; font: inherit; text-decoration: underline; }
  .knowledge-suggestions__actions { display: flex; flex-wrap: wrap; gap: 8px; }
  @media (max-width: 760px) {
    .knowledge-suggestions { padding: 18px 20px 20px; }
  }
  @media (max-width: 640px) {
    .knowledge-suggestions__actions > button { flex: 1 1 100%; }
  }
`;

export type KnowledgeSuggestionsProps = {
  tenantId: string;
  disabled?: boolean;
  /** Opens a created or existing draft in the article editor. */
  onOpenDraft: (articleId: string) => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
};

/**
 * «Artikelvorschläge»: groups of similar solved tickets without a published
 * article. The AI writes an internal draft that a person reviews and
 * publishes in the normal article editor.
 */
export function KnowledgeSuggestions({
  tenantId,
  disabled = false,
  onOpenDraft,
  onOpenTicket,
}: KnowledgeSuggestionsProps) {
  const [list, setList] = useState<KnowledgeSuggestionList | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [aiNote, setAiNote] = useState("");

  const load = useCallback(
    async (type: "list" | "refresh") => {
      setLoading(true);
      setError("");
      try {
        const next = await invokeSuggestions(
          { type, tenantId },
          parseKnowledgeSuggestionList,
          "Die Artikelvorschläge konnten nicht geladen werden.",
        );
        setList(next);
        setHidden(false);
        setAiNote(
          next.ai.available
            ? ""
            : knowledgeSuggestionMessage(
                next.ai.code,
                "Die KI-Unterstützung ist für diesen Mandanten nicht verfügbar.",
              ),
        );
      } catch (nextError) {
        // Without knowledge management rights the section stays hidden.
        if (
          nextError instanceof SuggestionError &&
          (nextError.code === "article_manage_denied" ||
            nextError.code === "knowledge_feature_disabled")
        ) {
          setHidden(true);
          return;
        }
        setError(
          nextError instanceof Error && nextError.message
            ? nextError.message
            : "Die Artikelvorschläge konnten nicht geladen werden.",
        );
      } finally {
        setLoading(false);
      }
    },
    [tenantId],
  );

  useEffect(() => {
    setList(null);
    void load("list");
  }, [load]);

  // Blocks a second click before React has re-rendered the disabled button.
  const drafting = useRef(false);

  async function createDraft(suggestionId: string) {
    if (drafting.current) return;
    drafting.current = true;
    setBusyId(suggestionId);
    setError("");
    try {
      const articleId = await invokeSuggestions(
        { type: "draft", tenantId, suggestionId },
        parseKnowledgeSuggestionDraft,
        "Der KI-Entwurf konnte nicht erstellt werden. Bitte versuchen Sie es erneut.",
      );
      setList((current) =>
        current
          ? {
              ...current,
              suggestions: current.suggestions.map((entry) =>
                entry.id === suggestionId
                  ? { ...entry, status: "drafted", articleId }
                  : entry,
              ),
            }
          : current,
      );
      onOpenDraft(articleId);
    } catch (nextError) {
      const message =
        nextError instanceof Error && nextError.message
          ? nextError.message
          : "Der KI-Entwurf konnte nicht erstellt werden.";
      if (
        nextError instanceof SuggestionError &&
        nextError.code &&
        AI_UNAVAILABLE_CODES.has(nextError.code)
      ) {
        setAiNote(message);
      } else {
        setError(message);
      }
    } finally {
      drafting.current = false;
      setBusyId(null);
    }
  }

  async function dismiss(suggestionId: string) {
    setBusyId(suggestionId);
    setError("");
    try {
      await invokeSuggestions(
        { type: "dismiss", tenantId, suggestionId },
        () => undefined,
        "Der Vorschlag konnte nicht verworfen werden.",
      );
      setList((current) =>
        current
          ? {
              ...current,
              suggestions: current.suggestions.filter(
                (entry) => entry.id !== suggestionId,
              ),
            }
          : current,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error && nextError.message
          ? nextError.message
          : "Der Vorschlag konnte nicht verworfen werden.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (hidden) return null;
  const busy = disabled || loading || busyId !== null;
  const suggestions = list?.suggestions ?? [];

  return (
    <section
      aria-labelledby="knowledge-suggestions-heading"
      className="panel knowledge-suggestions"
    >
      <style>{styles}</style>
      <div className="knowledge-suggestions__header">
        <div>
          <p className="eyebrow">Wissensdatenbank</p>
          <h2 id="knowledge-suggestions-heading">Artikelvorschläge</h2>
          <p className="knowledge-suggestions__intro">
            Ähnliche Tickets, die in den letzten {list?.windowDays ?? 120} Tagen
            mehrmals gleich gelöst wurden und noch keinen veröffentlichten
            Artikel haben. Die KI schreibt einen Entwurf, den Sie prüfen und
            speichern.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void load("refresh")}
          type="button"
        >
          {loading ? "Wird berechnet …" : "Neu berechnen"}
        </button>
      </div>

      {aiNote ? (
        <p className="knowledge-suggestions__note" role="status">
          {aiNote}
        </p>
      ) : null}
      {error ? (
        <p className="knowledge-suggestions__error" role="alert">
          {error}
        </p>
      ) : null}

      {list && suggestions.length === 0 && !loading ? (
        <p className="knowledge-suggestions__meta">
          Zurzeit gibt es keine Artikelvorschläge.
          {list.refreshedAt
            ? ` Zuletzt berechnet am ${formatDate(list.refreshedAt)}.`
            : ""}
        </p>
      ) : null}
      {!list && loading ? (
        <p className="knowledge-suggestions__meta">
          Artikelvorschläge werden geladen …
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <ul className="knowledge-suggestions__list">
          {suggestions.map((suggestion) => (
            <li className="knowledge-suggestions__item" key={suggestion.id}>
              <div className="knowledge-suggestions__item-head">
                <h3>{suggestion.titleHint}</h3>
                <span className="knowledge-suggestions__meta">
                  {suggestion.ticketCount} ähnliche Tickets
                  {suggestion.status === "drafted"
                    ? " · Entwurf vorhanden"
                    : ""}
                </span>
              </div>
              {suggestion.sampleTickets.length > 0 ? (
                <details>
                  <summary>Beispieltickets anzeigen</summary>
                  <ul className="knowledge-suggestions__tickets">
                    {suggestion.sampleTickets.map((ticket) => {
                      const label = `${ticket.ticketNumber ? `#${ticket.ticketNumber} ` : ""}${ticket.subject}`;
                      return (
                        <li key={ticket.id}>
                          {onOpenTicket ? (
                            <button
                              className="knowledge-suggestions__ticket"
                              onClick={() => onOpenTicket(ticket.id)}
                              type="button"
                            >
                              {label}
                            </button>
                          ) : (
                            label
                          )}
                          {ticket.solvedAt ? (
                            <span className="knowledge-suggestions__meta">
                              {" "}
                              · gelöst am {formatDate(ticket.solvedAt)}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}
              <div className="knowledge-suggestions__actions">
                {suggestion.status === "drafted" && suggestion.articleId ? (
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => onOpenDraft(suggestion.articleId!)}
                    type="button"
                  >
                    Entwurf prüfen
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    disabled={busy || (list ? !list.ai.available : true)}
                    onClick={() => void createDraft(suggestion.id)}
                    title={
                      list && !list.ai.available
                        ? "Die KI-Unterstützung ist nicht verfügbar."
                        : undefined
                    }
                    type="button"
                  >
                    {busyId === suggestion.id
                      ? "Entwurf wird erstellt …"
                      : "Entwurf mit KI erstellen"}
                  </button>
                )}
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void dismiss(suggestion.id)}
                  type="button"
                >
                  Verwerfen
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
