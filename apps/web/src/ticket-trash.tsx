import { ArrowLeft, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { tn } from "./lib/formality";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";
import {
  daysUntilPurge,
  parseDeletedTicket,
  parseDeletedTickets,
  type DeletedTicket,
  type DeletedTicketDetail,
} from "./lib/ticket-trash";

const dateTime = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? dateTime.format(parsed) : "";
}

function purgeText(purgeAt: string): string {
  const days = daysUntilPurge(purgeAt, Date.now());
  if (days <= 0) return "wird heute endgültig entfernt";
  return days === 1
    ? "noch 1 Tag wiederherstellbar"
    : `noch ${days} Tage wiederherstellbar`;
}

async function invoke(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new Error("not_configured");
  const { data, error } = await supabase.functions.invoke(
    "ticket-bulk-status",
    { body },
  );
  if (error) throw error;
  return data;
}

/**
 * Papierkorb der Ticketliste: gelöschte Tickets ansehen und wiederherstellen.
 * Nach 90 Tagen werden sie automatisch endgültig entfernt.
 */
export function TicketTrashDialog({
  tenantId,
  onClose,
  onRestored,
}: {
  tenantId: string;
  onClose: () => void;
  onRestored: (count: number) => void;
}) {
  const [tickets, setTickets] = useState<DeletedTicket[] | null>(null);
  const [detail, setDetail] = useState<DeletedTicketDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setTickets(
        parseDeletedTickets(await invoke({ type: "listDeleted", tenantId })),
      );
    } catch (cause) {
      setTickets([]);
      setError(
        await functionErrorMessage(
          cause,
          "Der Papierkorb konnte nicht geladen werden.",
        ),
      );
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

  const open = async (ticket: DeletedTicket) => {
    setPending(true);
    setError("");
    try {
      const parsed = parseDeletedTicket(
        await invoke({ type: "getDeleted", tenantId, ticketId: ticket.id }),
      );
      if (!parsed) throw new Error("invalid_deleted_ticket");
      setDetail(parsed);
    } catch (cause) {
      setError(
        await functionErrorMessage(
          cause,
          "Das Ticket konnte nicht geöffnet werden.",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  const restore = async (ticket: { id: string; ticketNumber: string }) => {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await invoke({
        type: "restoreTickets",
        tenantId,
        ticketIds: [ticket.id],
      });
      setDetail(null);
      setNotice(`${ticket.ticketNumber} wurde wiederhergestellt.`);
      onRestored(1);
      await load();
    } catch (cause) {
      setError(
        await functionErrorMessage(
          cause,
          "Das Ticket konnte nicht wiederhergestellt werden.",
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
        aria-labelledby="ticket-trash-title"
        aria-modal="true"
        className="ticket-trash"
        role="dialog"
      >
        <header className="ticket-trash__header">
          <div>
            <p className="eyebrow">TICKETLISTE</p>
            <h2 id="ticket-trash-title">
              <Trash2 aria-hidden="true" size={18} /> Gelöschte Tickets
            </h2>
            <p>
              Gelöschte Tickets bleiben 90 Tage im Papierkorb und werden danach
              automatisch endgültig entfernt.
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
          {detail ? (
            <article className="ticket-trash__detail">
              <button
                className="text-button"
                onClick={() => setDetail(null)}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={15} /> Zurück zur Liste
              </button>
              <h3>
                <code>{detail.ticketNumber}</code> {detail.subject}
              </h3>
              <dl className="ticket-trash__facts">
                <div>
                  <dt>Status</dt>
                  <dd>{detail.status ?? "–"}</dd>
                </div>
                <div>
                  <dt>Priorität</dt>
                  <dd>{detail.priority ?? "–"}</dd>
                </div>
                <div>
                  <dt>Abteilung</dt>
                  <dd>{detail.department ?? "–"}</dd>
                </div>
                <div>
                  <dt>Anfragende Person</dt>
                  <dd>{detail.requesterName ?? "–"}</dd>
                </div>
                <div>
                  <dt>Zugewiesen</dt>
                  <dd>{detail.assigneeName ?? "–"}</dd>
                </div>
                <div>
                  <dt>Gelöscht</dt>
                  <dd>
                    {formatDate(detail.deletedAt)}
                    {detail.deletedByName ? ` von ${detail.deletedByName}` : ""}
                  </dd>
                </div>
              </dl>
              {detail.description ? (
                <p className="ticket-trash__description">
                  {detail.description}
                </p>
              ) : null}
              {detail.attachmentNames.length > 0 ? (
                <p className="ticket-trash__muted">
                  Anhänge: {detail.attachmentNames.join(", ")}
                </p>
              ) : null}
              <h4>Verlauf ({detail.comments.length})</h4>
              {detail.comments.length === 0 ? (
                <p className="ticket-trash__muted">Keine Kommentare.</p>
              ) : (
                <ol className="ticket-trash__comments">
                  {detail.comments.map((comment) => (
                    <li
                      className={comment.internal ? "is-internal" : ""}
                      key={comment.id}
                    >
                      <small>
                        {comment.authorName ?? "Unbekannt"} ·{" "}
                        {formatDate(comment.createdAt)}
                        {comment.internal ? " · intern" : ""}
                      </small>
                      <p>{comment.body}</p>
                    </li>
                  ))}
                </ol>
              )}
              <div className="ticket-trash__detail-actions">
                <span className="ticket-trash__muted">
                  {purgeText(detail.purgeAt)}
                </span>
                <button
                  className="primary-button"
                  disabled={pending}
                  onClick={() => void restore(detail)}
                  type="button"
                >
                  <RotateCcw aria-hidden="true" size={16} /> Wiederherstellen
                </button>
              </div>
            </article>
          ) : tickets === null ? (
            <p className="ticket-trash__muted">Papierkorb wird geladen …</p>
          ) : tickets.length === 0 ? (
            <p className="ticket-trash__muted">
              {tn(
                "Der Papierkorb ist leer – oder dir fehlt das Recht, Tickets zu löschen.",
                "Der Papierkorb ist leer – oder Ihnen fehlt das Recht, Tickets zu löschen.",
              )}
            </p>
          ) : (
            <ul className="ticket-trash__list">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    className="ticket-trash__open"
                    disabled={pending}
                    onClick={() => void open(ticket)}
                    type="button"
                  >
                    <span className="ticket-trash__number">
                      {ticket.ticketNumber}
                      {ticket.department ? ` · ${ticket.department}` : ""}
                    </span>
                    <strong>{ticket.subject}</strong>
                    <small>
                      Gelöscht {formatDate(ticket.deletedAt)}
                      {ticket.deletedByName
                        ? ` von ${ticket.deletedByName}`
                        : ""}{" "}
                      · {purgeText(ticket.purgeAt)}
                    </small>
                  </button>
                  <button
                    className="secondary-button"
                    disabled={pending}
                    onClick={() => void restore(ticket)}
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" size={15} /> Wiederherstellen
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
