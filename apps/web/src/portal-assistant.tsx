import { getFormality, tn } from "./lib/formality";
import { Bot, BookOpen, Check, LoaderCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  deflectionRate,
  messagesForTurn,
  parseAssistantSettings,
  parseAssistantTurn,
  type AssistantArticle,
  type AssistantDraft,
  type AssistantMessage,
  type AssistantSettings,
  type AssistantTurn,
} from "./lib/portal-assistant";
import { supabase } from "./lib/supabase";
import "./portal-assistant.css";

/**
 * «Selbstbedienungs-Assistent im Portal» (web): a small chat in the ticket
 * composer. The edge function portal-assistant suggests knowledge articles
 * and asks at most two questions; if nothing helps, the prepared draft is
 * taken into the normal ticket form and the person creates the ticket.
 */

async function call(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("portal-assistant", {
    body,
  });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = (await context.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (payload?.error?.message) throw new Error(payload.error.message);
    }
    throw new Error("Der Assistent ist gerade nicht verfügbar.");
  }
  return data;
}

/** Records how an assistant conversation ended (errors are ignored). */
export async function recordPortalAssistantOutcome(input: {
  tenantId: string;
  sessionId: string;
  outcome: "solved_by_article" | "ticket_created" | "abandoned";
  articleId?: string;
  ticketId?: string;
}): Promise<void> {
  try {
    await call({ type: "finish", ...input });
  } catch {
    // Reporting must never block the person.
  }
}

/** Whether the assistant is switched on for the tenant (off by default). */
export function usePortalAssistantEnabled(tenantId: string): boolean {
  const [enabled, setEnabled] = useState<{
    tenantId: string;
    value: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void call({ type: "getSettings", tenantId })
      .then((value) => {
        if (active)
          setEnabled({
            tenantId,
            value: parseAssistantSettings(value).enabled,
          });
      })
      .catch(() => {
        if (active) setEnabled({ tenantId, value: false });
      });
    return () => {
      active = false;
    };
  }, [tenantId]);
  return enabled?.tenantId === tenantId && enabled.value;
}

export function PortalAssistantPanel({
  tenantId,
  departmentId,
  onClose,
  onUseDraft,
  onSolved,
  onOpenArticle,
}: {
  tenantId: string;
  departmentId: string | null;
  /** Closed without result (recorded as abandoned when a chat started). */
  onClose: () => void;
  /** Takes the draft into the ticket form; the session id is kept there. */
  onUseDraft: (draft: AssistantDraft, sessionId: string) => void;
  /** An article solved the problem (already recorded). */
  onSolved: () => void;
  onOpenArticle?: ((articleId: string) => void) | undefined;
}) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [turn, setTurn] = useState<AssistantTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionId = turn?.sessionId ?? null;

  // No <form>: the panel is shown inside the ticket form.
  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const history = messagesForTurn([...messages, { role: "user", text }]);
    setBusy(true);
    setError("");
    try {
      const next = parseAssistantTurn(
        await call({
          type: "turn",
          tenantId,
          sessionId,
          departmentId,
          address: getFormality() === "sie" ? "formal" : "informal",
          messages: history,
        }),
      );
      if (!next) throw new Error("Die Antwort des Assistenten ist ungültig.");
      setTurn(next);
      setMessages([
        ...history,
        ...(next.question
          ? [{ role: "assistant" as const, text: next.question }]
          : []),
      ]);
      setInput("");
      inputRef.current?.focus();
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Der Assistent ist gerade nicht verfügbar.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function solvedWith(article: AssistantArticle) {
    if (!sessionId) return;
    await recordPortalAssistantOutcome({
      tenantId,
      sessionId,
      outcome: "solved_by_article",
      articleId: article.id,
    });
    onSolved();
  }

  function close() {
    if (sessionId) {
      void recordPortalAssistantOutcome({
        tenantId,
        sessionId,
        outcome: "abandoned",
      });
    }
    onClose();
  }

  const canAnswer = !turn || turn.question !== null;

  return (
    <section
      aria-labelledby="portal-assistant-heading"
      className="portal-assistant"
    >
      <div className="portal-assistant__heading">
        <span aria-hidden="true" className="portal-assistant__icon">
          <Bot size={18} />
        </span>
        <div>
          <h3 id="portal-assistant-heading">Mit dem Assistenten lösen</h3>
          <p className="data-caption">
            {tn(
              "Beschreibe dein Problem. Der Assistent sucht passende Artikel und bereitet bei Bedarf ein Ticket für dich vor.",
              "Beschreiben Sie Ihr Problem. Der Assistent sucht passende Artikel und bereitet bei Bedarf ein Ticket für Sie vor.",
            )}
          </p>
        </div>
        <button
          aria-label="Assistent schliessen"
          className="icon-button"
          onClick={close}
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>

      {messages.length > 0 ? (
        <ol aria-live="polite" className="portal-assistant__messages">
          {messages.map((message, index) => (
            <li
              className={`portal-assistant__message portal-assistant__message--${message.role}`}
              key={`${index}-${message.role}`}
            >
              <span className="sr-only">
                {message.role === "user" ? tn("Du: ", "Sie: ") : "Assistent: "}
              </span>
              {message.text}
            </li>
          ))}
        </ol>
      ) : null}

      {turn ? (
        <div className="portal-assistant__result" role="status">
          {turn.reply ? <p>{turn.reply}</p> : null}
          {turn.mode === "search" ? (
            <p className="data-caption">
              Die KI ist nicht verfügbar; gezeigt werden Treffer der
              Artikelsuche.
            </p>
          ) : null}
          {turn.articles.length > 0 ? (
            <ul className="portal-assistant__articles">
              {turn.articles.map((article) => (
                <li key={article.id}>
                  <strong>
                    <BookOpen aria-hidden="true" size={15} /> {article.title}
                  </strong>
                  {article.excerpt ? <p>{article.excerpt}</p> : null}
                  <div className="portal-assistant__article-actions">
                    {onOpenArticle ? (
                      <button
                        className="text-button"
                        onClick={() => onOpenArticle(article.id)}
                        type="button"
                      >
                        Artikel öffnen
                      </button>
                    ) : null}
                    <button
                      className="secondary-button"
                      onClick={() => void solvedWith(article)}
                      type="button"
                    >
                      <Check aria-hidden="true" size={15} />
                      Hat mein Problem gelöst
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="portal-assistant__draft">
            <p className="data-caption">
              Nicht gelöst? Der Assistent hat ein Ticket vorbereitet:
            </p>
            <p>
              <strong>{turn.draft.subject}</strong>
              {turn.draft.categoryName
                ? ` · Kategorie: ${turn.draft.categoryName}`
                : ""}
            </p>
            <button
              className="primary-button"
              onClick={() => onUseDraft(turn.draft, turn.sessionId)}
              type="button"
            >
              Ticket mit diesem Entwurf vorbereiten
            </button>
          </div>
        </div>
      ) : null}

      {canAnswer ? (
        <div className="portal-assistant__form">
          <label className="sr-only" htmlFor="portal-assistant-input">
            {turn?.question
              ? tn("Deine Antwort", "Ihre Antwort")
              : tn("Dein Problem", "Ihr Problem")}
          </label>
          <textarea
            disabled={busy}
            id="portal-assistant-input"
            maxLength={2000}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={
              turn?.question
                ? tn("Deine Antwort …", "Ihre Antwort …")
                : "z. B. «Mein Laptop verbindet sich nicht mit dem WLAN.»"
            }
            ref={inputRef}
            rows={2}
            value={input}
          />
          <button
            className="primary-button"
            disabled={busy || !input.trim()}
            onClick={() => void send()}
            type="button"
          >
            {busy ? (
              <LoaderCircle aria-hidden="true" size={16} />
            ) : (
              <Send aria-hidden="true" size={16} />
            )}
            {busy ? "Wird geprüft …" : "Senden"}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Tenant setting (off by default) with a small outcome report. */
export function PortalAssistantSettings({ tenantId }: { tenantId: string }) {
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void call({ type: "getSettings", tenantId })
      .then((value) => {
        if (active) setSettings(parseAssistantSettings(value));
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  async function save(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      setSettings(
        parseAssistantSettings(
          await call({ type: "saveSettings", tenantId, enabled }),
        ),
      );
      setMessage("Gespeichert.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const summary = settings?.summary ?? null;
  return (
    <section className="tenant-automation portal-assistant-settings">
      <div className="tenant-automation__heading">
        <div>
          <p className="eyebrow">SELBSTBEDIENUNG</p>
          <h2>Selbstbedienungs-Assistent im Portal</h2>
          <p>
            Mitarbeitende und anfragende Personen können ihr Problem vor dem
            Erfassen eines Tickets mit dem Assistenten lösen. Er schlägt
            veröffentlichte Wissensartikel vor, stellt höchstens zwei Rückfragen
            und bereitet sonst das Ticket mit Betreff, Beschreibung und
            Kategorie vor. Mit freigegebener KI-Unterstützung formuliert die KI,
            sonst wird die normale Artikelsuche verwendet. Standardmässig
            ausgeschaltet.
          </p>
        </div>
      </div>
      {settings ? (
        <label className="tenant-automation__switch">
          <input
            checked={settings.enabled}
            disabled={busy || !settings.canManage}
            onChange={(event) => void save(event.target.checked)}
            type="checkbox"
          />
          <span>{settings.enabled ? "Eingeschaltet" : "Ausgeschaltet"}</span>
        </label>
      ) : null}
      {summary ? (
        <dl className="portal-assistant-settings__summary">
          <div>
            <dt>Gespräche ({summary.days} Tage)</dt>
            <dd>{summary.total}</dd>
          </div>
          <div>
            <dt>Mit Artikel gelöst</dt>
            <dd>{summary.solvedByArticle}</dd>
          </div>
          <div>
            <dt>Ticket erstellt</dt>
            <dd>{summary.ticketCreated}</dd>
          </div>
          <div>
            <dt>Abgebrochen</dt>
            <dd>{summary.abandoned}</dd>
          </div>
          <div>
            <dt>Ohne Ticket gelöst</dt>
            <dd>{deflectionRate(summary)} %</dd>
          </div>
        </dl>
      ) : null}
      {message ? <p className="data-caption">{message}</p> : null}
    </section>
  );
}
