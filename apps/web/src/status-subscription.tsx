import { BellRing } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  isValidSubscriberEmail,
  readStatusSubscriptionAction,
  statusSubscriptionMessage,
  withoutStatusSubscriptionParams,
} from "./lib/status-subscription";

async function post(body: Record<string, unknown>): Promise<string | null> {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) return "missing_configuration";
  try {
    const response = await fetch(
      new URL("/functions/v1/service-status-public", base),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (response.ok) return null;
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: unknown };
    } | null;
    return typeof payload?.error?.code === "string"
      ? payload.error.code
      : "status_subscription_failed";
  } catch {
    return "status_subscription_failed";
  }
}

/**
 * «Per E-Mail benachrichtigen»: Anmeldung mit Double-Opt-in. Bestätigungs-
 * und Abmeldelinks aus den Mails werden beim Öffnen der Seite ausgeführt.
 */
export function StatusSubscriptionPanel({ publicId }: { publicId: string }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const handledLink = useRef(false);

  useEffect(() => {
    if (handledLink.current) return;
    handledLink.current = true;
    const action = readStatusSubscriptionAction(window.location.search);
    if (!action) return;
    setPending(true);
    void post({ type: action.kind, token: action.token }).then((code) => {
      setMessage(statusSubscriptionMessage(action.kind, code));
      setPending(false);
      window.history.replaceState(
        null,
        "",
        withoutStatusSubscriptionParams(window.location.href),
      );
    });
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValidSubscriberEmail(email)) {
      setMessage(statusSubscriptionMessage("subscribe", "invalid_email"));
      return;
    }
    setPending(true);
    setMessage(null);
    const code = await post({
      type: "subscribe",
      id: publicId,
      email: email.trim(),
    });
    setMessage(statusSubscriptionMessage("subscribe", code));
    if (code === null) setEmail("");
    setPending(false);
  };

  return (
    <section
      aria-labelledby="status-subscription-title"
      className="status-subscription"
    >
      <div className="status-subscription__text">
        <h2 id="status-subscription-title">
          <BellRing aria-hidden="true" size={18} /> Per E-Mail benachrichtigen
        </h2>
        <p>
          Bei jeder Statusänderung eine E-Mail erhalten – jederzeit abmeldbar.
        </p>
      </div>
      <form
        className="status-subscription__form"
        onSubmit={(event) => void submit(event)}
      >
        <label className="sr-only" htmlFor="status-subscription-email">
          E-Mail-Adresse
        </label>
        <input
          autoComplete="email"
          disabled={pending}
          id="status-subscription-email"
          inputMode="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@beispiel.ch"
          type="email"
          value={email}
        />
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? "Bitte warten …" : "Anmelden"}
        </button>
      </form>
      {message ? (
        <p
          className={`status-subscription__message status-subscription__message--${message.tone}`}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
