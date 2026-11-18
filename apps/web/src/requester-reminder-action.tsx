import { tn } from "./lib/formality";
import { Check, CircleHelp, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import {
  parseReminderActionResponse,
  reminderActionErrorText,
  reminderActionTokenFromHash,
  type ReminderActionPreview,
} from "./lib/requester-reminder-action";
import { supabase } from "./lib/supabase";
import "./requester-ticket-progress.css";

type ErrorEnvelope = { error?: { code?: unknown } };

async function errorCode(error: unknown): Promise<string | null> {
  const context =
    typeof error === "object" && error !== null && "context" in error
      ? (error as { context?: unknown }).context
      : null;
  if (!(context instanceof Response)) return null;
  try {
    const body = (await context.clone().json()) as ErrorEnvelope;
    return typeof body.error?.code === "string" ? body.error.code : null;
  } catch {
    return null;
  }
}

async function callAction(
  body: Record<string, unknown>,
): Promise<ReminderActionPreview> {
  if (!supabase) throw new Error("not_configured");
  const { data, error } = await supabase.functions.invoke(
    "requester-reminder-action",
    { body },
  );
  if (error) throw new Error((await errorCode(error)) ?? "failed");
  const parsed = parseReminderActionResponse(data);
  if (!parsed) throw new Error("failed");
  return parsed;
}

/**
 * Public page for the one-click links in reminder e-mails
 * (https://app.nextdesk.ch/#ticket-aktion=<token>). Opening the link changes
 * nothing; the person confirms with one click. This keeps mail scanners that
 * open links in advance from answering on the person's behalf.
 */
export function RequesterReminderActionPage() {
  const [token] = useState(() =>
    reminderActionTokenFromHash(window.location.hash),
  );
  const [preview, setPreview] = useState<ReminderActionPreview | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // Remove the token from the address bar and the browser history.
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setError(reminderActionErrorText("token_invalid"));
      return;
    }
    void callAction({ token })
      .then(setPreview)
      .catch((cause: Error) =>
        setError(reminderActionErrorText(cause.message)),
      );
  }, [token]);

  async function confirm() {
    if (!token || pending) return;
    setPending(true);
    setError("");
    try {
      const result = await callAction({
        token,
        confirm: true,
        ...(message.trim() ? { message: message.trim() } : {}),
      });
      setPreview((current) =>
        current ? { ...current, state: "done" } : result,
      );
    } catch (cause) {
      setError(reminderActionErrorText((cause as Error).message));
    } finally {
      setPending(false);
    }
  }

  const resolved = preview?.action === "resolved";
  const title = !preview
    ? tn("Rückmeldung zu deinem Ticket", "Rückmeldung zu Ihrem Ticket")
    : preview.state === "done"
      ? resolved
        ? "Danke, das Ticket ist gelöst"
        : "Danke, wir kümmern uns weiter darum"
      : resolved
        ? tn("Ist dein Problem gelöst?", "Ist Ihr Problem gelöst?")
        : tn("Brauchst du noch Hilfe?", "Sie brauchen noch Hilfe?");

  return (
    <main className="reminder-action-page">
      <section
        aria-labelledby="reminder-action-heading"
        className="reminder-action-page__card"
      >
        <p className="eyebrow">NEXTDESK</p>
        <h1 id="reminder-action-heading">{title}</h1>
        {preview?.ticketNumber ? (
          <p>
            <strong>{preview.ticketNumber}</strong>
            {preview.subject ? ` · ${preview.subject}` : ""}
          </p>
        ) : null}
        {!preview && !error ? (
          <p role="status">
            <LoaderCircle
              aria-hidden="true"
              className="ticket-detail-spinner"
              size={16}
            />{" "}
            Link wird geprüft …
          </p>
        ) : null}
        {preview?.state === "open" ? (
          <>
            <p>
              {resolved
                ? tn(
                    "Bestätige mit einem Klick, dass dein Problem gelöst ist. Das Ticket wird danach als gelöst markiert.",
                    "Bestätigen Sie mit einem Klick, dass Ihr Problem gelöst ist. Das Ticket wird danach als gelöst markiert.",
                  )
                : tn(
                    "Bestätige, dass du noch Hilfe brauchst. Das Support-Team bearbeitet dein Ticket dann weiter.",
                    "Bestätigen Sie, dass Sie noch Hilfe brauchen. Das Support-Team bearbeitet Ihr Ticket dann weiter.",
                  )}
            </p>
            {!resolved ? (
              <label>
                Was ist noch offen? (optional)
                <textarea
                  disabled={pending}
                  maxLength={5000}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={4}
                  value={message}
                />
              </label>
            ) : null}
            <button
              className="primary-button"
              disabled={pending}
              onClick={() => void confirm()}
              type="button"
            >
              {pending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : resolved ? (
                <Check aria-hidden="true" size={16} />
              ) : (
                <CircleHelp aria-hidden="true" size={16} />
              )}{" "}
              {resolved ? "Ja, Problem ist gelöst" : "Ich brauche noch Hilfe"}
            </button>
          </>
        ) : null}
        {preview && preview.state !== "open" && preview.state !== "done" ? (
          <p>{reminderActionErrorText(preview.state)}</p>
        ) : null}
        {preview?.state === "done" ? (
          <p role="status">
            {resolved
              ? tn(
                  "Vielen Dank für deine Rückmeldung. Du kannst dieses Fenster schliessen.",
                  "Vielen Dank für Ihre Rückmeldung. Sie können dieses Fenster schliessen.",
                )
              : tn(
                  "Vielen Dank. Dein Ticket ist wieder in Bearbeitung. Du kannst dieses Fenster schliessen.",
                  "Vielen Dank. Ihr Ticket ist wieder in Bearbeitung. Sie können dieses Fenster schliessen.",
                )}
          </p>
        ) : null}
        {error ? (
          <p className="form-message form-message--error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
