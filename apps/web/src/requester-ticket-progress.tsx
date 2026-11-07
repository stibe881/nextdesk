import { Check, CircleHelp, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { functionErrorStatus } from "./lib/function-error";
import {
  expectedResolutionText,
  formatProgressTime,
  parseRequesterProgress,
  progressStepHint,
  progressStepLabel,
  type RequesterProgress,
} from "./lib/requester-progress";
import { supabase } from "./lib/supabase";
import "./requester-ticket-progress.css";

type Props = {
  tenantId: string;
  ticketId: string;
  /** Changes when the ticket changes (status, update time) to reload. */
  refreshKey: string;
  /** Called after the requester answered, so the ticket view reloads. */
  onChanged?: () => void;
};

async function invokePortal(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("requester-portal", {
    body,
  });
  if (error) throw error;
  return data;
}

/**
 * Step tracker for the requester's own ticket (Eingegangen → In Bearbeitung →
 * Wartet auf Sie → Gelöst). While the ticket waits for the requester, the
 * person can answer «Problem ist gelöst» or «Ich brauche noch Hilfe».
 */
export function RequesterTicketProgress({
  tenantId,
  ticketId,
  refreshKey,
  onChanged,
}: Props) {
  const [progress, setProgress] = useState<RequesterProgress | null>(null);
  const [hidden, setHidden] = useState(false);
  const [pending, setPending] = useState<"resolved" | "need_help" | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    try {
      const next = parseRequesterProgress(
        await invokePortal({ type: "ticketProgress", tenantId, ticketId }),
      );
      if (sequence.current !== requestId) return;
      if (!next) throw new Error("invalid_progress");
      setProgress(next);
      setHidden(false);
    } catch {
      if (sequence.current !== requestId) return;
      // Feature off, no access or older backend: the view simply omits it.
      setProgress(null);
      setHidden(true);
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    void load();
    return () => {
      sequence.current += 1;
    };
  }, [load, refreshKey]);

  async function respond(response: "resolved" | "need_help") {
    if (pending) return;
    setPending(response);
    setError("");
    setNotice("");
    try {
      await invokePortal({
        type: "respondToWaiting",
        tenantId,
        ticketId,
        response,
        channel: "portal",
        ...(response === "need_help" && message.trim()
          ? { message: message.trim() }
          : {}),
      });
      setShowHelp(false);
      setMessage("");
      setNotice(
        response === "resolved"
          ? "Danke für Ihre Rückmeldung. Das Ticket ist jetzt gelöst."
          : "Danke. Das Support-Team kümmert sich wieder um Ihr Anliegen.",
      );
      await load();
      onChanged?.();
    } catch (cause) {
      setError(
        functionErrorStatus(cause) === 409
          ? "Das Ticket wartet nicht mehr auf Ihre Rückmeldung. Bitte laden Sie die Ansicht neu."
          : "Ihre Rückmeldung konnte nicht übermittelt werden. Bitte versuchen Sie es erneut.",
      );
    } finally {
      setPending(null);
    }
  }

  if (hidden || !progress) return null;
  const expected = expectedResolutionText(progress.expected);

  return (
    <section
      aria-labelledby="requester-progress-heading"
      className="requester-progress"
    >
      <div className="requester-progress__heading">
        <p className="eyebrow">FORTSCHRITT</p>
        <h3 id="requester-progress-heading">
          {progressStepLabel(progress.currentStep)}
        </h3>
        <p>{progressStepHint(progress.currentStep)}</p>
        {expected ? (
          <p className="requester-progress__expected">{expected}</p>
        ) : null}
      </div>
      <ol className="requester-progress__steps">
        {progress.steps.map((step) => (
          <li
            aria-current={step.state === "current" ? "step" : undefined}
            className={`requester-progress__step requester-progress__step--${step.state}${
              step.key === "waiting_for_requester"
                ? " requester-progress__step--waiting"
                : ""
            }`}
            key={step.key}
          >
            <span aria-hidden="true" className="requester-progress__dot">
              {step.state === "done" ? <Check size={14} /> : null}
            </span>
            <span className="requester-progress__label">
              <strong>{progressStepLabel(step.key)}</strong>
              {step.reachedAt ? (
                <time dateTime={step.reachedAt}>
                  {formatProgressTime(step.reachedAt)}
                </time>
              ) : (
                <span className="requester-progress__pending">
                  {step.state === "upcoming" ? "Ausstehend" : ""}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      {progress.waitingForRequester ? (
        <div className="requester-progress__answer">
          <p>Ist Ihr Problem inzwischen gelöst?</p>
          <div className="requester-progress__actions">
            <button
              className="primary-button"
              disabled={pending !== null}
              onClick={() => void respond("resolved")}
              type="button"
            >
              {pending === "resolved" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : (
                <Check aria-hidden="true" size={16} />
              )}{" "}
              Problem ist gelöst
            </button>
            <button
              className="secondary-button"
              disabled={pending !== null}
              onClick={() => setShowHelp((value) => !value)}
              type="button"
            >
              <CircleHelp aria-hidden="true" size={16} /> Ich brauche noch Hilfe
            </button>
          </div>
          {showHelp ? (
            <div className="requester-progress__help">
              <label>
                Was ist noch offen? (optional)
                <textarea
                  disabled={pending !== null}
                  maxLength={5000}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={3}
                  value={message}
                />
              </label>
              <button
                className="primary-button"
                disabled={pending !== null}
                onClick={() => void respond("need_help")}
                type="button"
              >
                {pending === "need_help" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="ticket-detail-spinner"
                    size={16}
                  />
                ) : null}{" "}
                Rückmeldung senden
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <p className="requester-progress__notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
