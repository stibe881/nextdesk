import { ArrowLeft, MailX, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { tn } from "./lib/formality";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";
import {
  parseSpamSenders,
  parseSpamTickets,
  type SpamSender,
  type SpamTicket,
} from "./lib/ticket-spam";

const dateTime = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: string | null): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? dateTime.format(parsed) : "";
}

async function invoke(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new Error("not_configured");
  const { data, error } = await supabase.functions.invoke(
    "ticket-bulk-status",
    {
      body,
    },
  );
  if (error) throw error;
  return data;
}

/**
 * Filter «Spam» der Ticketliste: als Spam eingestufte Tickets ansehen, mit
 * «Kein Spam» zurückholen (der Absender wird dabei freigegeben) und gesperrte
 * Absender verwalten.
 */
export function TicketSpamDialog({
  tenantId,
  onClose,
  onRestored,
}: {
  tenantId: string;
  onClose: () => void;
  onRestored: (count: number) => void;
}) {
  const [tab, setTab] = useState<"tickets" | "senders">("tickets");
  const [tickets, setTickets] = useState<SpamTicket[] | null>(null);
  const [senders, setSenders] = useState<SpamSender[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setTickets(
        parseSpamTickets(await invoke({ type: "listSpam", tenantId })),
      );
    } catch (cause) {
      setTickets([]);
      setError(
        await functionErrorMessage(
          cause,
          "Der Spam konnte nicht geladen werden.",
        ),
      );
    }
    try {
      setSenders(
        parseSpamSenders(await invoke({ type: "listSpamSenders", tenantId })),
      );
    } catch {
      // Ohne Recht zur Verwaltung bleibt die Absenderliste leer.
      setSenders([]);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const release = async (ticket: SpamTicket) => {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await invoke({
        type: "unmarkSpam",
        tenantId,
        ticketIds: [ticket.id],
        releaseSenders: true,
      });
      setNotice(
        `${ticket.ticketNumber} ist kein Spam mehr${
          ticket.senderEmail
            ? `; ${ticket.senderEmail} ist nicht mehr gesperrt`
            : ""
        }.`,
      );
      onRestored(1);
      await load();
    } catch (cause) {
      setError(
        await functionErrorMessage(
          cause,
          "Das Ticket konnte nicht zurückgeholt werden.",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  const unblock = async (sender: SpamSender) => {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await invoke({ type: "removeSpamSender", tenantId, senderId: sender.id });
      setNotice(`${sender.email} ist nicht mehr gesperrt.`);
      await load();
    } catch (cause) {
      setError(
        await functionErrorMessage(
          cause,
          "Der Absender konnte nicht freigegeben werden.",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="ticket-trash-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="ticket-spam-title"
        aria-modal="true"
        className="ticket-trash"
        role="dialog"
      >
        <header className="ticket-trash__header">
          <div>
            <p className="eyebrow">TICKETLISTE</p>
            <h2 id="ticket-spam-title">
              <MailX aria-hidden="true" size={18} /> Spam
            </h2>
            <p>
              Spam-Tickets lösen keine Regeln, SLA oder Mitteilungen aus und
              zählen nicht in die Statistik. Neue Tickets gesperrter Absender
              landen automatisch hier und werden nach 90 Tagen entfernt.
            </p>
          </div>
          <button
            aria-label="Schliessen"
            className="ticket-list-filter-panel__close"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <div className="ticket-trash__body">
          <div className="ticket-trash__tabs" role="tablist">
            <button
              aria-selected={tab === "tickets"}
              className={
                tab === "tickets" ? "primary-button" : "secondary-button"
              }
              onClick={() => setTab("tickets")}
              role="tab"
              type="button"
            >
              Spam-Tickets{tickets ? ` (${tickets.length})` : ""}
            </button>
            <button
              aria-selected={tab === "senders"}
              className={
                tab === "senders" ? "primary-button" : "secondary-button"
              }
              onClick={() => setTab("senders")}
              role="tab"
              type="button"
            >
              Gesperrte Absender{senders ? ` (${senders.length})` : ""}
            </button>
          </div>
          {error ? (
            <p className="form-message form-message--error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="form-message form-message--success" role="status">
              {notice}
            </p>
          ) : null}
          {tab === "tickets" ? (
            tickets === null ? (
              <p className="ticket-trash__muted">Spam wird geladen …</p>
            ) : tickets.length === 0 ? (
              <p className="ticket-trash__muted">Es gibt keinen Spam.</p>
            ) : (
              <ul className="ticket-trash__list">
                {tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <div className="ticket-trash__open">
                      <span className="ticket-trash__number">
                        {ticket.ticketNumber}
                        {ticket.department ? ` · ${ticket.department}` : ""}
                      </span>
                      <strong>{ticket.subject}</strong>
                      <small>
                        {ticket.senderEmail ?? "Absender unbekannt"} ·{" "}
                        {formatDate(ticket.spamAt)}
                        {ticket.markedByName
                          ? ` · markiert von ${ticket.markedByName}`
                          : " · automatisch erkannt"}
                      </small>
                    </div>
                    <button
                      className="secondary-button"
                      disabled={pending}
                      onClick={() => void release(ticket)}
                      type="button"
                    >
                      <RotateCcw aria-hidden="true" size={15} /> Kein Spam
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : senders === null ? (
            <p className="ticket-trash__muted">Absender werden geladen …</p>
          ) : senders.length === 0 ? (
            <p className="ticket-trash__muted">
              {tn(
                "Es sind keine Absender gesperrt (oder dir fehlt das Recht, Spam zu verwalten).",
                "Es sind keine Absender gesperrt (oder Ihnen fehlt das Recht, Spam zu verwalten).",
              )}
            </p>
          ) : (
            <ul className="ticket-trash__list">
              {senders.map((sender) => (
                <li key={sender.id}>
                  <div className="ticket-trash__open">
                    <strong>{sender.email}</strong>
                    <small>
                      Seit {formatDate(sender.createdAt)} · {sender.hits}{" "}
                      abgefangen
                      {sender.lastHitAt
                        ? ` · zuletzt ${formatDate(sender.lastHitAt)}`
                        : ""}
                    </small>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={pending}
                    onClick={() => void unblock(sender)}
                    type="button"
                  >
                    <ArrowLeft aria-hidden="true" size={15} /> Freigeben
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
