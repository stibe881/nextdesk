import {
  CalendarClock,
  Check,
  CircleCheck,
  LoaderCircle,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { supabase } from "./lib/supabase";

type FollowUp = {
  id: string;
  ticketId: string | null;
  title: string;
  description: string | null;
  dueAt: string | null;
  priority: "low" | "normal" | "high";
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ResolutionConfirmation = {
  id: string;
  ticketId: string;
  confirmed: boolean;
  comment: string | null;
  confirmedAt: string;
  confirmedByDisplayName: string | null;
};

type Availability = "checking" | "available" | "unavailable";
type FollowUpPending = "save" | string | null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    !value.includes("\u0000") &&
    Number.isFinite(Date.parse(value))
  );
}

function isText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    !value.includes("\u0000") &&
    [...value].length >= minimum &&
    [...value].length <= maximum
  );
}

function toFollowUp(value: unknown): FollowUp | null {
  const followUp = asRecord(value);
  if (
    !followUp ||
    !hasOnlyKeys(followUp, [
      "id",
      "ticketId",
      "title",
      "description",
      "dueAt",
      "priority",
      "resolvedAt",
      "createdAt",
      "updatedAt",
    ]) ||
    !isUuid(followUp.id) ||
    (followUp.ticketId !== null && !isUuid(followUp.ticketId)) ||
    !isText(followUp.title, 1, 240) ||
    (followUp.description !== null &&
      !isText(followUp.description, 1, 5_000)) ||
    (followUp.dueAt !== null && !isTimestamp(followUp.dueAt)) ||
    (followUp.priority !== "low" &&
      followUp.priority !== "normal" &&
      followUp.priority !== "high") ||
    (followUp.resolvedAt !== null && !isTimestamp(followUp.resolvedAt)) ||
    !isTimestamp(followUp.createdAt) ||
    !isTimestamp(followUp.updatedAt)
  ) {
    return null;
  }
  return followUp as FollowUp;
}

function parseFollowUps(value: unknown): FollowUp[] | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (
    !envelope ||
    !hasOnlyKeys(envelope, ["data"]) ||
    !data ||
    !hasOnlyKeys(data, ["followUps", "truncated"]) ||
    !Array.isArray(data.followUps) ||
    data.followUps.length > 100 ||
    typeof data.truncated !== "boolean"
  ) {
    return null;
  }
  const followUps = data.followUps.map(toFollowUp);
  return followUps.every((followUp): followUp is FollowUp => followUp !== null)
    ? followUps
    : null;
}

function toResolutionConfirmation(
  value: unknown,
): ResolutionConfirmation | null {
  const confirmation = asRecord(value);
  if (
    !confirmation ||
    !hasOnlyKeys(confirmation, [
      "id",
      "ticketId",
      "confirmed",
      "comment",
      "confirmedAt",
      "confirmedByDisplayName",
    ]) ||
    !isUuid(confirmation.id) ||
    !isUuid(confirmation.ticketId) ||
    typeof confirmation.confirmed !== "boolean" ||
    (confirmation.comment !== null &&
      !isText(confirmation.comment, 1, 3_000)) ||
    !isTimestamp(confirmation.confirmedAt) ||
    (confirmation.confirmedByDisplayName !== null &&
      !isText(confirmation.confirmedByDisplayName, 1, 240))
  ) {
    return null;
  }
  return confirmation as ResolutionConfirmation;
}

function parseResolutionConfirmations(
  value: unknown,
): ResolutionConfirmation[] | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (
    !envelope ||
    !hasOnlyKeys(envelope, ["data"]) ||
    !data ||
    !hasOnlyKeys(data, ["confirmations"]) ||
    !Array.isArray(data.confirmations) ||
    data.confirmations.length > 100
  ) {
    return null;
  }
  const confirmations = data.confirmations.map(toResolutionConfirmation);
  return confirmations.every(
    (confirmation): confirmation is ResolutionConfirmation =>
      confirmation !== null,
  )
    ? confirmations
    : null;
}

function parseSubmittedConfirmation(
  value: unknown,
  ticketId: string,
  confirmed: boolean,
): ResolutionConfirmation | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  const confirmation = asRecord(data?.confirmation);
  if (
    !envelope ||
    !hasOnlyKeys(envelope, ["data"]) ||
    !data ||
    !hasOnlyKeys(data, ["confirmation"]) ||
    !confirmation ||
    !hasOnlyKeys(confirmation, [
      "id",
      "ticketId",
      "confirmed",
      "confirmedAt",
    ]) ||
    !isUuid(confirmation.id) ||
    confirmation.ticketId !== ticketId ||
    confirmation.confirmed !== confirmed ||
    !isTimestamp(confirmation.confirmedAt)
  ) {
    return null;
  }
  return {
    id: confirmation.id,
    ticketId: confirmation.ticketId,
    confirmed: confirmation.confirmed,
    comment: null,
    confirmedAt: confirmation.confirmedAt,
    confirmedByDisplayName: null,
  };
}

async function invokeExperienceHub(
  body: Record<string, unknown>,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("experience-hub", {
    body,
  });
  if (error) throw error;
  return data;
}

function functionErrorStatus(error: unknown): number | null {
  const record = asRecord(error);
  if (!record) return null;
  if (typeof record.status === "number") return record.status;
  const context = record.context;
  if (context instanceof Response) return context.status;
  const contextRecord = asRecord(context);
  return typeof contextRecord?.status === "number"
    ? contextRecord.status
    : null;
}

function formatDateTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Zeitpunkt unbekannt";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function toLocalDateTimeInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function quickDueAt(kind: "tomorrow" | "three-days" | "next-week"): string {
  const due = new Date();
  due.setSeconds(0, 0);
  due.setHours(9, 0, 0, 0);
  if (kind === "tomorrow") {
    due.setDate(due.getDate() + 1);
  } else if (kind === "three-days") {
    due.setDate(due.getDate() + 3);
  } else {
    const daysUntilMonday = (8 - due.getDay()) % 7 || 7;
    due.setDate(due.getDate() + daysUntilMonday);
  }
  return toLocalDateTimeInput(due);
}

function defaultFollowUpTitle(ticketNumber: string, subject: string): string {
  return [...`${ticketNumber} – ${subject}`].slice(0, 240).join("");
}

function followsDueOrder(first: FollowUp, second: FollowUp): number {
  if (first.dueAt === null && second.dueAt === null) {
    return first.createdAt.localeCompare(second.createdAt);
  }
  if (first.dueAt === null) return 1;
  if (second.dueAt === null) return -1;
  return first.dueAt.localeCompare(second.dueAt);
}

function followUpErrorMessage(
  error: unknown,
  action: "save" | "resolve",
): string {
  const status = functionErrorStatus(error);
  if (status === 404) {
    return action === "save"
      ? "Das Ticket ist nicht mehr verfügbar."
      : "Die Wiedervorlage ist nicht mehr verfügbar.";
  }
  if (status === 409) {
    return "Die Wiedervorlage wurde zwischenzeitlich geändert. Bitte aktualisieren Sie die Liste.";
  }
  if (status === 422 || status === 400) {
    return "Bitte prüfen Sie Titel, Notiz und Termin der Wiedervorlage.";
  }
  return action === "save"
    ? "Die Wiedervorlage konnte nicht gespeichert werden. Bitte versuchen Sie es erneut."
    : "Die Wiedervorlage konnte nicht als erledigt markiert werden. Bitte versuchen Sie es erneut.";
}

export function TicketFollowUps({
  tenantId,
  ticketId,
  ticketNumber,
  subject,
  enabled,
}: {
  tenantId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  /** The ticket detail already established the agent's write permission. */
  enabled: boolean;
}) {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [pending, setPending] = useState<FollowUpPending>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestSequence = useRef(0);

  const loadFollowUps = useCallback(async () => {
    const requestId = ++requestSequence.current;
    try {
      const result = parseFollowUps(
        await invokeExperienceHub({
          type: "listFollowUps",
          tenantId,
          ticketId,
        }),
      );
      if (!result) throw new Error("invalid_follow_up_response");
      if (requestId !== requestSequence.current) return false;
      setFollowUps(
        result
          .filter(
            (followUp) =>
              followUp.ticketId === ticketId && !followUp.resolvedAt,
          )
          .sort(followsDueOrder),
      );
      setAvailability("available");
      return true;
    } catch {
      if (requestId === requestSequence.current) {
        // The server gate is authoritative and fail-closed. A disabled feature
        // or a not-yet-configured Experience Hub therefore stays out of view.
        setAvailability("unavailable");
        setExpanded(false);
        setFollowUps([]);
      }
      return false;
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    requestSequence.current += 1;
    setAvailability(enabled ? "checking" : "unavailable");
    setExpanded(false);
    setFollowUps([]);
    setTitle(defaultFollowUpTitle(ticketNumber, subject));
    setDescription("");
    setDueAt("");
    setPending(null);
    setError("");
    setNotice("");
    if (!enabled) return;
    void loadFollowUps();
    return () => {
      requestSequence.current += 1;
    };
  }, [enabled, loadFollowUps, subject, ticketNumber]);

  async function saveFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || availability !== "available") return;

    const nextTitle = title.trim();
    const nextDescription = description.trim();
    const due = dueAt ? new Date(dueAt) : null;
    if (
      !isText(nextTitle, 1, 240) ||
      (nextDescription && !isText(nextDescription, 1, 5_000)) ||
      (dueAt && (!due || Number.isNaN(due.getTime())))
    ) {
      setError(
        "Bitte geben Sie einen Titel und bei Bedarf eine gültige Notiz und einen gültigen Termin ein.",
      );
      return;
    }

    setPending("save");
    setError("");
    setNotice("");
    try {
      await invokeExperienceHub({
        type: "saveFollowUp",
        tenantId,
        title: nextTitle,
        description: nextDescription || null,
        dueAt: due ? due.toISOString() : null,
        priority: "normal",
        ticketId,
      });
      setDescription("");
      setDueAt("");
      setNotice("Wiedervorlage wurde für Sie gespeichert.");
      await loadFollowUps();
    } catch (nextError) {
      const status = functionErrorStatus(nextError);
      if (status === 403 || status === 503) {
        setAvailability("unavailable");
        setExpanded(false);
      } else {
        setError(followUpErrorMessage(nextError, "save"));
      }
    } finally {
      setPending(null);
    }
  }

  async function resolveFollowUp(followUp: FollowUp) {
    if (pending || availability !== "available" || followUp.resolvedAt) return;
    setPending(followUp.id);
    setError("");
    setNotice("");
    try {
      await invokeExperienceHub({
        type: "resolveFollowUp",
        tenantId,
        followUpId: followUp.id,
      });
      setNotice("Wiedervorlage als erledigt markiert.");
      await loadFollowUps();
    } catch (nextError) {
      const status = functionErrorStatus(nextError);
      if (status === 403 || status === 503) {
        setAvailability("unavailable");
        setExpanded(false);
      } else {
        setError(followUpErrorMessage(nextError, "resolve"));
      }
    } finally {
      setPending(null);
    }
  }

  if (availability !== "available") return null;

  const formId = `ticket-follow-ups-${ticketId}`;
  return (
    <div className="ticket-experience ticket-experience--follow-ups">
      <button
        aria-controls={formId}
        aria-expanded={expanded}
        aria-label="Wiedervorlage setzen"
        className="secondary-button ticket-experience__header-action"
        disabled={pending !== null}
        onClick={() => {
          setExpanded((current) => !current);
          setError("");
          setNotice("");
        }}
        type="button"
      >
        <CalendarClock aria-hidden="true" size={16} strokeWidth={1.8} />
        <span className="ticket-detail-action-label">Wiedervorlage setzen</span>
      </button>
      {expanded && (
        <section
          aria-busy={pending !== null}
          aria-labelledby={`${formId}-heading`}
          className="ticket-experience__popover"
          id={formId}
        >
          <div className="ticket-experience__popover-heading">
            <div>
              <p className="eyebrow">MEINE ARBEIT</p>
              <h3 id={`${formId}-heading`}>Wiedervorlage setzen</h3>
            </div>
            <button
              aria-label="Wiedervorlage schliessen"
              className="more-button ticket-experience__close"
              disabled={pending !== null}
              onClick={() => setExpanded(false)}
              type="button"
            >
              <X aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          </div>
          <p className="data-caption">
            Die Wiedervorlage gehört nur Ihnen und ändert dieses Ticket nicht.
          </p>
          {error && (
            <p className="ticket-detail-message error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="ticket-detail-message success" role="status">
              <CircleCheck aria-hidden="true" size={16} />
              {notice}
            </p>
          )}
          <form className="ticket-experience__form" onSubmit={saveFollowUp}>
            <div className="ticket-experience__quick-dates" role="group">
              <span>Termin schnell wählen</span>
              <button
                onClick={() => setDueAt(quickDueAt("tomorrow"))}
                type="button"
              >
                Morgen 09:00
              </button>
              <button
                onClick={() => setDueAt(quickDueAt("three-days"))}
                type="button"
              >
                In 3 Tagen
              </button>
              <button
                onClick={() => setDueAt(quickDueAt("next-week"))}
                type="button"
              >
                Nächste Woche
              </button>
            </div>
            <label>
              Titel
              <input
                disabled={pending !== null}
                maxLength={240}
                onChange={(event) => setTitle(event.target.value)}
                required
                value={title}
              />
            </label>
            <label>
              Eigener Termin (optional)
              <input
                disabled={pending !== null}
                onChange={(event) => setDueAt(event.target.value)}
                type="datetime-local"
                value={dueAt}
              />
            </label>
            <label>
              Notiz (optional)
              <textarea
                disabled={pending !== null}
                maxLength={5000}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Woran möchten Sie erinnert werden?"
                rows={2}
                value={description}
              />
            </label>
            <button
              className="primary-button"
              disabled={pending !== null || !title.trim()}
              type="submit"
            >
              {pending === "save" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : (
                <CalendarClock aria-hidden="true" size={16} />
              )}
              Wiedervorlage speichern
            </button>
          </form>
          <div className="ticket-experience__follow-up-list">
            <div className="ticket-experience__list-heading">
              <strong>Eigene offene Wiedervorlagen</strong>
              <span className="data-caption">{followUps.length}</span>
            </div>
            {followUps.length === 0 ? (
              <p className="data-caption">
                Für dieses Ticket ist keine Wiedervorlage offen.
              </p>
            ) : (
              <ol>
                {followUps.map((followUp) => {
                  const resolving = pending === followUp.id;
                  return (
                    <li key={followUp.id}>
                      <div>
                        <strong>{followUp.title}</strong>
                        <span>
                          {followUp.dueAt
                            ? `Fällig: ${formatDateTime(followUp.dueAt)}`
                            : "Ohne Termin"}
                        </span>
                        {followUp.description && <p>{followUp.description}</p>}
                      </div>
                      <button
                        className="secondary-button"
                        disabled={pending !== null}
                        onClick={() => void resolveFollowUp(followUp)}
                        type="button"
                      >
                        {resolving ? (
                          <LoaderCircle
                            aria-hidden="true"
                            className="ticket-detail-spinner"
                            size={16}
                          />
                        ) : (
                          <Check aria-hidden="true" size={16} />
                        )}
                        Erledigen
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export function TicketResolutionExperience({
  tenantId,
  ticketId,
  canConfirm,
  canReadHistory,
}: {
  tenantId: string;
  ticketId: string;
  /** Only the known requester or affected person receives the response card. */
  canConfirm: boolean;
  /** Ticket-detail permissions identify the agent quality/history view. */
  canReadHistory: boolean;
}) {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [confirmations, setConfirmations] = useState<ResolutionConfirmation[]>(
    [],
  );
  const [choice, setChoice] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<ResolutionConfirmation | null>(
    null,
  );
  const requestSequence = useRef(0);

  const loadConfirmations = useCallback(async () => {
    const requestId = ++requestSequence.current;
    try {
      const result = parseResolutionConfirmations(
        await invokeExperienceHub({
          type: "listResolutionConfirmations",
          tenantId,
          ticketId,
        }),
      );
      if (
        !result ||
        result.some((confirmation) => confirmation.ticketId !== ticketId)
      ) {
        throw new Error("invalid_resolution_confirmation_response");
      }
      if (requestId !== requestSequence.current) return false;
      setConfirmations(result);
      setAvailability("available");
      return true;
    } catch {
      if (requestId === requestSequence.current) {
        // Keep feature-gated and unavailable Experience Hub endpoints quiet.
        setAvailability("unavailable");
        setConfirmations([]);
      }
      return false;
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    requestSequence.current += 1;
    setAvailability(canConfirm || canReadHistory ? "checking" : "unavailable");
    setConfirmations([]);
    setChoice(null);
    setComment("");
    setPending(false);
    setError("");
    setSubmitted(null);
    if (!canConfirm && !canReadHistory) return;
    void loadConfirmations();
    return () => {
      requestSequence.current += 1;
    };
  }, [canConfirm, canReadHistory, loadConfirmations]);

  async function submitConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfirm || choice === null || pending) return;

    const nextComment = comment.trim();
    if (nextComment && !isText(nextComment, 1, 3_000)) {
      setError("Der Kommentar darf höchstens 3'000 gültige Zeichen enthalten.");
      return;
    }

    setPending(true);
    setError("");
    try {
      const confirmation = parseSubmittedConfirmation(
        await invokeExperienceHub({
          type: "confirmResolution",
          tenantId,
          ticketId,
          confirmed: choice,
          comment: nextComment || null,
        }),
        ticketId,
        choice,
      );
      if (!confirmation)
        throw new Error("invalid_resolution_confirmation_response");
      setSubmitted(confirmation);
      setChoice(null);
      setComment("");
      if (canReadHistory) await loadConfirmations();
    } catch (nextError) {
      const status = functionErrorStatus(nextError);
      if (status === 403 || status === 503) {
        setAvailability("unavailable");
      } else if (status === 422) {
        setError(
          "Dieses Ticket ist nicht als gelöst erfasst. Der Ticketstatus wurde nicht geändert.",
        );
      } else if (status === 404) {
        setError("Dieses Ticket ist nicht mehr verfügbar.");
      } else {
        setError(
          "Die Rückmeldung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
        );
      }
    } finally {
      setPending(false);
    }
  }

  if (availability !== "available") return null;

  return (
    <section className="ticket-experience__resolution" aria-live="polite">
      {canConfirm && (
        <section
          aria-labelledby={`ticket-resolution-prompt-${ticketId}`}
          className="ticket-experience__resolution-card"
        >
          <div>
            <p className="eyebrow">RÜCKMELDUNG</p>
            <h3 id={`ticket-resolution-prompt-${ticketId}`}>
              Wurde Ihr Anliegen gelöst?
            </h3>
          </div>
          {submitted ? (
            <p className="ticket-experience__result" role="status">
              {submitted.confirmed ? (
                <ThumbsUp aria-hidden="true" size={18} />
              ) : (
                <ThumbsDown aria-hidden="true" size={18} />
              )}
              <span>
                <strong>
                  {submitted.confirmed
                    ? "Als gelöst bestätigt"
                    : "Als nicht gelöst gemeldet"}
                </strong>
                <br />
                Ihre Rückmeldung wurde am{" "}
                {formatDateTime(submitted.confirmedAt)} gespeichert. Der
                Ticketstatus wurde nicht geändert.
              </span>
            </p>
          ) : (
            <form
              aria-describedby={`ticket-resolution-note-${ticketId}`}
              className="ticket-experience__resolution-form"
              onSubmit={submitConfirmation}
            >
              <p id={`ticket-resolution-note-${ticketId}`}>
                Ihre Rückmeldung wird als eigener, unveränderlicher Eintrag
                gespeichert. Sie ändert den Ticketstatus nicht.
              </p>
              {error && (
                <p className="ticket-detail-message error" role="alert">
                  {error}
                </p>
              )}
              <fieldset disabled={pending}>
                <legend>Ihre Antwort</legend>
                <label className={choice === true ? "is-selected" : undefined}>
                  <input
                    checked={choice === true}
                    name={`ticket-resolution-${ticketId}`}
                    onChange={() => setChoice(true)}
                    type="radio"
                  />
                  <ThumbsUp aria-hidden="true" size={17} /> Ja, gelöst
                </label>
                <label className={choice === false ? "is-selected" : undefined}>
                  <input
                    checked={choice === false}
                    name={`ticket-resolution-${ticketId}`}
                    onChange={() => setChoice(false)}
                    type="radio"
                  />
                  <ThumbsDown aria-hidden="true" size={17} /> Nein, noch offen
                </label>
              </fieldset>
              <label>
                Kommentar (optional)
                <textarea
                  disabled={pending}
                  maxLength={3000}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Was hat geholfen oder was fehlt noch?"
                  rows={3}
                  value={comment}
                />
              </label>
              <p className="data-caption">
                {[...comment].length}/3&apos;000 Zeichen
              </p>
              <button
                className="primary-button"
                disabled={pending || choice === null}
                type="submit"
              >
                {pending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="ticket-detail-spinner"
                    size={16}
                  />
                ) : (
                  <CircleCheck aria-hidden="true" size={16} />
                )}
                Ergebnis bestätigen
              </button>
            </form>
          )}
        </section>
      )}

      {canReadHistory && (
        <section
          aria-labelledby={`ticket-resolution-history-${ticketId}`}
          className="ticket-experience__resolution-history"
        >
          <div className="ticket-detail-section-heading">
            <div>
              <p className="eyebrow">LÖSUNGSBESTÄTIGUNGEN</p>
              <h3 id={`ticket-resolution-history-${ticketId}`}>
                Rückmeldungen zur Lösung
              </h3>
            </div>
            <span className="data-caption">{confirmations.length}</span>
          </div>
          {confirmations.length === 0 ? (
            <p className="empty-state">
              Noch keine Lösungsbestätigung vorhanden.
            </p>
          ) : (
            <ol className="ticket-experience__confirmation-list">
              {confirmations.map((confirmation) => (
                <li key={confirmation.id}>
                  {confirmation.confirmed ? (
                    <ThumbsUp aria-hidden="true" size={18} />
                  ) : (
                    <ThumbsDown aria-hidden="true" size={18} />
                  )}
                  <div>
                    <strong>
                      {confirmation.confirmed
                        ? "Gelöst bestätigt"
                        : "Nicht gelöst"}
                    </strong>
                    <span>
                      {confirmation.confirmedByDisplayName
                        ? `${confirmation.confirmedByDisplayName} · `
                        : ""}
                      {formatDateTime(confirmation.confirmedAt)}
                    </span>
                    {confirmation.comment && <p>{confirmation.comment}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </section>
  );
}
