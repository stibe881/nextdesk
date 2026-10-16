import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  Clock3,
  Eye,
  EyeOff,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Save,
  Send,
  X,
} from "lucide-react";
import { supabase } from "./lib/supabase";

type CommentVisibility = "external" | "internal";
type PendingAction = "comment" | "update" | "watch" | null;

type GetTicketAction = {
  type: "getTicket";
  tenantId: string;
  ticketId: string;
};

type UpdateTicketAction = {
  type: "updateTicket";
  tenantId: string;
  ticketId: string;
  statusKey?: string;
  priorityKey?: string;
  assignedTeamId?: string | null;
};

type AddCommentAction = {
  type: "addComment";
  tenantId: string;
  ticketId: string;
  body: string;
  visibility: CommentVisibility;
};

type ToggleWatchAction = {
  type: "toggleWatch";
  tenantId: string;
  ticketId: string;
  watching: boolean;
};

type TicketOperation =
  GetTicketAction | UpdateTicketAction | AddCommentAction | ToggleWatchAction;

type TicketRecord = {
  id: string;
  ticket_number: string;
  subject: string;
  description: string;
  status_id: string;
  priority_id: string;
  assigned_team_id: string | null;
  created_at: string;
};

type TicketComment = {
  id: string;
  authorName: string;
  body: string;
  created_at: string;
  visibility: CommentVisibility;
};

type TicketEvent = {
  id: string;
  event_type: string;
  created_at: string;
};

type TicketStatus = {
  id: string;
  key: string;
  label: string;
  is_closed: boolean;
};

type TicketPriority = {
  id: string;
  key: string;
  label: string;
};

type TicketTeam = {
  id: string;
  name: string;
};

type TicketDetailData = {
  ticket: TicketRecord;
  comments: TicketComment[];
  events: TicketEvent[];
  statuses: TicketStatus[];
  priorities: TicketPriority[];
  teams: TicketTeam[];
  watching: boolean;
  canUpdate: boolean;
  canUseInternalNotes: boolean;
};

type TicketDetailProps = {
  tenantId: string;
  ticketId: string;
  onClose: () => void;
  onChanged: () => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isTicketRecord(value: unknown): value is TicketRecord {
  const ticket = asRecord(value);
  return Boolean(
    ticket &&
    typeof ticket.id === "string" &&
    typeof ticket.ticket_number === "string" &&
    typeof ticket.subject === "string" &&
    typeof ticket.description === "string" &&
    typeof ticket.status_id === "string" &&
    typeof ticket.priority_id === "string" &&
    (typeof ticket.assigned_team_id === "string" ||
      ticket.assigned_team_id === null) &&
    typeof ticket.created_at === "string",
  );
}

function isTicketComment(value: unknown): value is TicketComment {
  const comment = asRecord(value);
  return Boolean(
    comment &&
    typeof comment.id === "string" &&
    typeof comment.body === "string" &&
    typeof comment.created_at === "string" &&
    (comment.visibility === "external" || comment.visibility === "internal"),
  );
}

function toTicketComment(value: unknown): TicketComment | null {
  if (!isTicketComment(value)) return null;
  const comment = asRecord(value);
  const authorName =
    typeof comment?.authorName === "string" && comment.authorName.trim()
      ? comment.authorName
      : "Benutzerkonto";
  return { ...value, authorName };
}

function isTicketEvent(value: unknown): value is TicketEvent {
  const event = asRecord(value);
  return Boolean(
    event &&
    typeof event.id === "string" &&
    typeof event.event_type === "string" &&
    typeof event.created_at === "string",
  );
}

function isTicketStatus(value: unknown): value is TicketStatus {
  const status = asRecord(value);
  return Boolean(
    status &&
    typeof status.id === "string" &&
    typeof status.key === "string" &&
    typeof status.label === "string" &&
    typeof status.is_closed === "boolean",
  );
}

function isTicketPriority(value: unknown): value is TicketPriority {
  const priority = asRecord(value);
  return Boolean(
    priority &&
    typeof priority.id === "string" &&
    typeof priority.key === "string" &&
    typeof priority.label === "string",
  );
}

function isTicketTeam(value: unknown): value is TicketTeam {
  const team = asRecord(value);
  return Boolean(
    team && typeof team.id === "string" && typeof team.name === "string",
  );
}

function valuesOf<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(guard) : [];
}

/**
 * `null` represents an explicitly empty server response; `undefined` is an
 * invalid response shape and is treated as a request error.
 */
function parseTicketDetail(
  value: unknown,
): TicketDetailData | null | undefined {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (!data) return undefined;
  if (data.ticket === null) return null;
  if (!isTicketRecord(data.ticket)) return undefined;

  const comments = Array.isArray(data.comments)
    ? data.comments
        .map(toTicketComment)
        .filter((comment): comment is TicketComment => comment !== null)
    : [];

  return {
    ticket: data.ticket,
    comments,
    events: valuesOf(data.events, isTicketEvent),
    statuses: valuesOf(data.statuses, isTicketStatus),
    priorities: valuesOf(data.priorities, isTicketPriority),
    teams: valuesOf(data.teams, isTicketTeam),
    watching: data.watching === true,
    canUpdate: data.canUpdate === true,
    canUseInternalNotes: data.canUseInternalNotes === true,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  const value = asRecord(error);
  if (typeof value?.message === "string" && value.message.trim()) {
    return value.message;
  }
  return "Der Ticketvorgang konnte nicht verarbeitet werden.";
}

function formatDateTime(timestamp: string): string {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return timestamp;
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    "comment.external_added": "Externer Kommentar hinzugefügt",
    "comment.internal_added": "Interne Notiz hinzugefügt",
    "ticket.updated": "Ticket aktualisiert",
  };
  return (
    labels[eventType] ??
    eventType
      .replaceAll(/[._-]+/g, " ")
      .replace(/^./, (character) => character.toLocaleUpperCase("de-CH"))
  );
}

async function invokeTicketOperation(
  action: TicketOperation,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ticket-operations", {
    body: action,
  });
  if (error) throw error;
  return data;
}

export function TicketDetail({
  tenantId,
  ticketId,
  onClose,
  onChanged,
}: TicketDetailProps) {
  const [detail, setDetail] = useState<TicketDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [statusKey, setStatusKey] = useState("");
  const [priorityKey, setPriorityKey] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [comment, setComment] = useState("");
  const [commentVisibility, setCommentVisibility] =
    useState<CommentVisibility>("external");
  const requestSequence = useRef(0);

  const loadTicket = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError("");

    try {
      const response = await invokeTicketOperation({
        type: "getTicket",
        tenantId,
        ticketId,
      });
      const nextDetail = parseTicketDetail(response);
      if (nextDetail === undefined) {
        throw new Error("Die Ticketdaten sind unvollständig.");
      }
      if (requestId !== requestSequence.current) return false;

      setDetail(nextDetail);
      setStatusKey(
        nextDetail?.statuses.find(
          (status) => status.id === nextDetail.ticket.status_id,
        )?.key ?? "",
      );
      setPriorityKey(
        nextDetail?.priorities.find(
          (priority) => priority.id === nextDetail.ticket.priority_id,
        )?.key ?? "",
      );
      setSelectedTeamId(nextDetail?.ticket.assigned_team_id ?? "");
      if (!nextDetail?.canUseInternalNotes) {
        setCommentVisibility("external");
      }
      return true;
    } catch (nextError) {
      if (requestId === requestSequence.current) {
        setDetail(null);
        setError(errorMessage(nextError));
      }
      return false;
    } finally {
      if (requestId === requestSequence.current) {
        setLoaded(true);
        setLoading(false);
      }
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    void loadTicket();
    return () => {
      requestSequence.current += 1;
    };
  }, [loadTicket]);

  const selectedStatus = useMemo(
    () =>
      detail?.statuses.find(
        (status) => status.id === detail.ticket.status_id,
      ) ?? null,
    [detail],
  );
  const selectedPriority = useMemo(
    () =>
      detail?.priorities.find(
        (priority) => priority.id === detail.ticket.priority_id,
      ) ?? null,
    [detail],
  );
  const assignedTeamId = detail?.ticket.assigned_team_id ?? "";
  const hasChanges = Boolean(
    detail &&
    (statusKey !== selectedStatus?.key ||
      priorityKey !== selectedPriority?.key ||
      selectedTeamId !== assignedTeamId),
  );
  const busy = pendingAction !== null;

  async function saveTicketChanges() {
    if (!detail || !hasChanges) return;

    const action: UpdateTicketAction = {
      type: "updateTicket",
      tenantId,
      ticketId,
    };
    if (statusKey && statusKey !== selectedStatus?.key) {
      action.statusKey = statusKey;
    }
    if (priorityKey && priorityKey !== selectedPriority?.key) {
      action.priorityKey = priorityKey;
    }
    if (selectedTeamId !== assignedTeamId) {
      action.assignedTeamId = selectedTeamId || null;
    }
    if (
      !action.statusKey &&
      !action.priorityKey &&
      action.assignedTeamId === undefined
    ) {
      return;
    }

    setPendingAction("update");
    setError("");
    try {
      await invokeTicketOperation(action);
      onChanged();
      await loadTicket();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function saveComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = comment.trim();
    if (!body) {
      setError("Bitte geben Sie einen Kommentar ein.");
      return;
    }
    if (body.length > 50_000) {
      setError("Ein Kommentar darf höchstens 50'000 Zeichen enthalten.");
      return;
    }

    setPendingAction("comment");
    setError("");
    try {
      await invokeTicketOperation({
        type: "addComment",
        tenantId,
        ticketId,
        body,
        visibility: commentVisibility,
      });
      setComment("");
      onChanged();
      await loadTicket();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function toggleWatch() {
    if (!detail) return;
    const watching = !detail.watching;
    setPendingAction("watch");
    setError("");
    try {
      await invokeTicketOperation({
        type: "toggleWatch",
        tenantId,
        ticketId,
        watching,
      });
      setDetail((current) => (current ? { ...current, watching } : current));
      onChanged();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  if (loading && !loaded) {
    return (
      <section className="ticket-detail panel" aria-label="Ticketdetails">
        <p className="empty-state ticket-detail-loading" aria-live="polite">
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={18}
          />
          Ticket wird geladen …
        </p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="ticket-detail panel" aria-label="Ticketdetails">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">TICKETDETAILS</p>
            <h2>Ticket nicht verfügbar</h2>
          </div>
          <button
            aria-label="Ticketdetails schliessen"
            className="more-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </div>
        {error ? (
          <p className="ticket-detail-message error" role="alert">
            <AlertCircle aria-hidden="true" size={17} />
            {error}
          </p>
        ) : (
          <p className="empty-state">
            Für dieses Ticket sind keine Details verfügbar.
          </p>
        )}
        <div className="ticket-detail-actions">
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => void loadTicket()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} strokeWidth={1.8} />
            Erneut laden
          </button>
          <button className="primary-button" onClick={onClose} type="button">
            Schliessen
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="ticket-detail panel" aria-label="Ticketdetails">
      <header className="ticket-detail-header">
        <div>
          <p className="eyebrow">TICKET {detail.ticket.ticket_number}</p>
          <h2>{detail.ticket.subject}</h2>
        </div>
        <div className="ticket-detail-header-actions">
          <button
            className={
              detail.watching
                ? "secondary-button ticket-watch-button active"
                : "secondary-button ticket-watch-button"
            }
            disabled={busy}
            onClick={() => void toggleWatch()}
            type="button"
          >
            {pendingAction === "watch" ? (
              <LoaderCircle
                aria-hidden="true"
                className="ticket-detail-spinner"
                size={16}
              />
            ) : detail.watching ? (
              <EyeOff aria-hidden="true" size={16} strokeWidth={1.8} />
            ) : (
              <Eye aria-hidden="true" size={16} strokeWidth={1.8} />
            )}
            {detail.watching ? "Nicht mehr beobachten" : "Beobachten"}
          </button>
          <button
            aria-label="Ticketdetails schliessen"
            className="more-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {error && (
        <p className="ticket-detail-message error" role="alert">
          <AlertCircle aria-hidden="true" size={17} />
          {error}
        </p>
      )}

      <div className="ticket-detail-summary">
        <div className="ticket-detail-badges" aria-label="Ticketstatus">
          <span className="state-badge ticket-detail-status">
            {selectedStatus?.label ?? "Status nicht verfügbar"}
          </span>
          <span className="ticket-detail-priority">
            {selectedPriority?.label ?? "Priorität nicht verfügbar"}
          </span>
        </div>
        <p className="ticket-detail-description">{detail.ticket.description}</p>
        <p className="data-caption">
          Erstellt am {formatDateTime(detail.ticket.created_at)}
        </p>
      </div>

      {detail.canUpdate && (
        <section
          className="ticket-detail-editor"
          aria-labelledby="ticket-status-heading"
        >
          <div className="ticket-detail-section-heading">
            <div>
              <p className="eyebrow">BEARBEITEN</p>
              <h3 id="ticket-status-heading">Status und Priorität</h3>
            </div>
          </div>
          <div className="ticket-detail-selects">
            <label>
              Status
              <select
                disabled={busy || detail.statuses.length === 0}
                onChange={(event) => setStatusKey(event.target.value)}
                value={statusKey}
              >
                {detail.statuses.map((status) => (
                  <option key={status.id} value={status.key}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priorität
              <select
                disabled={busy || detail.priorities.length === 0}
                onChange={(event) => setPriorityKey(event.target.value)}
                value={priorityKey}
              >
                {detail.priorities.map((priority) => (
                  <option key={priority.id} value={priority.key}>
                    {priority.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Zugewiesenes Team
              <select
                disabled={busy}
                onChange={(event) => setSelectedTeamId(event.target.value)}
                value={selectedTeamId}
              >
                <option value="">Keinem Team zugewiesen</option>
                {detail.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="secondary-button"
            disabled={busy || !hasChanges}
            onClick={() => void saveTicketChanges()}
            type="button"
          >
            {pendingAction === "update" ? (
              <LoaderCircle
                aria-hidden="true"
                className="ticket-detail-spinner"
                size={16}
              />
            ) : (
              <Save aria-hidden="true" size={16} strokeWidth={1.8} />
            )}
            Änderungen speichern
          </button>
        </section>
      )}

      <section
        className="ticket-detail-comments"
        aria-labelledby="ticket-comments-heading"
      >
        <div className="ticket-detail-section-heading">
          <div>
            <p className="eyebrow">KOMMUNIKATION</p>
            <h3 id="ticket-comments-heading">Kommentare</h3>
          </div>
          <span className="data-caption">{detail.comments.length}</span>
        </div>

        <form className="ticket-comment-form" onSubmit={saveComment}>
          <label className="ticket-comment-body">
            Neuer Kommentar
            <textarea
              disabled={busy}
              maxLength={50_000}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Antwort oder Notiz verfassen …"
              required
              rows={4}
              value={comment}
            />
          </label>
          <fieldset className="ticket-comment-visibility" disabled={busy}>
            <legend>Sichtbarkeit</legend>
            <label>
              <input
                checked={commentVisibility === "external"}
                name="comment-visibility"
                onChange={() => setCommentVisibility("external")}
                type="radio"
                value="external"
              />
              Extern
            </label>
            {detail.canUseInternalNotes && (
              <label>
                <input
                  checked={commentVisibility === "internal"}
                  name="comment-visibility"
                  onChange={() => setCommentVisibility("internal")}
                  type="radio"
                  value="internal"
                />
                Intern
              </label>
            )}
          </fieldset>
          <button className="primary-button" disabled={busy} type="submit">
            {pendingAction === "comment" ? (
              <LoaderCircle
                aria-hidden="true"
                className="ticket-detail-spinner"
                size={16}
              />
            ) : (
              <Send aria-hidden="true" size={16} strokeWidth={1.8} />
            )}
            Kommentar speichern
          </button>
        </form>

        {detail.comments.length === 0 ? (
          <p className="empty-state">Noch keine Kommentare vorhanden.</p>
        ) : (
          <ol className="ticket-comment-list">
            {detail.comments.map((item) => (
              <li className="ticket-comment" key={item.id}>
                <div className="ticket-comment-meta">
                  <strong>{item.authorName}</strong>
                  <span
                    className={
                      item.visibility === "internal"
                        ? "ticket-comment-visibility-badge internal"
                        : "ticket-comment-visibility-badge external"
                    }
                  >
                    {item.visibility === "internal" ? "Intern" : "Extern"}
                  </span>
                  <time dateTime={item.created_at}>
                    {formatDateTime(item.created_at)}
                  </time>
                </div>
                <p>{item.body}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        className="ticket-detail-timeline"
        aria-labelledby="ticket-timeline-heading"
      >
        <div className="ticket-detail-section-heading">
          <div>
            <p className="eyebrow">VERLAUF</p>
            <h3 id="ticket-timeline-heading">Timeline</h3>
          </div>
          <Clock3 aria-hidden="true" size={18} strokeWidth={1.8} />
        </div>
        {detail.events.length === 0 ? (
          <p className="empty-state">Noch keine Ereignisse vorhanden.</p>
        ) : (
          <ol className="ticket-timeline-list">
            {detail.events.map((event) => (
              <li className="ticket-timeline-event" key={event.id}>
                <MessageSquare aria-hidden="true" size={16} strokeWidth={1.8} />
                <div>
                  <strong>{eventLabel(event.event_type)}</strong>
                  <time dateTime={event.created_at}>
                    {formatDateTime(event.created_at)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
