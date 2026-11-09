import { LoaderCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { supabase } from "./lib/supabase";
import "./requester-ticket-progress.css";

const HASH_PREFIX = "#sicherheit-antwort=";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSecurityResponseHash(hash: string): boolean {
  return hash.startsWith(HASH_PREFIX);
}

export function securityResponseToken(hash: string): string | null {
  if (!isSecurityResponseHash(hash)) return null;
  let token = "";
  try {
    token = decodeURIComponent(hash.slice(HASH_PREFIX.length));
  } catch {
    return null;
  }
  return UUID.test(token) ? token : null;
}

type Preview = {
  state: "open" | "answered";
  answer: "yes" | "no" | null;
  subject: string | null;
};

async function callResponse(body: Record<string, unknown>): Promise<Preview> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(
    "security-case-response",
    { body },
  );
  if (error) throw new Error("Der Link ist ungültig oder abgelaufen.");
  const value =
    typeof data === "object" && data !== null && "data" in data
      ? (data as { data: Record<string, unknown> }).data
      : null;
  if (!value) throw new Error("Der Link ist ungültig oder abgelaufen.");
  return {
    state: value.state === "answered" ? "answered" : "open",
    answer:
      value.answer === "yes" || value.answer === "no" ? value.answer : null,
    subject: typeof value.subject === "string" ? value.subject : null,
  };
}

/**
 * Public page for the «did you click?» question of a phishing report
 * (https://app.nextdesk.ch/#sicherheit-antwort=<token>). Opening the link
 * changes nothing; the person answers with one click.
 */
export function SecurityCaseResponsePage() {
  const [token] = useState(() => securityResponseToken(window.location.hash));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setError("Der Link ist ungültig oder abgelaufen.");
      return;
    }
    void callResponse({ token })
      .then(setPreview)
      .catch((cause: Error) => setError(cause.message));
  }, [token]);

  async function answer(value: "yes" | "no") {
    if (!token || pending) return;
    setPending(true);
    setError("");
    try {
      setPreview(await callResponse({ token, answer: value }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="reminder-action-page">
      <section
        aria-labelledby="security-response-heading"
        className="reminder-action-page__card"
      >
        <p className="eyebrow">SICHERHEIT</p>
        <h1 id="security-response-heading">
          {preview?.state === "answered"
            ? "Danke für Ihre Antwort"
            : "Kurze Rückfrage zu Ihrer Phishing-Meldung"}
        </h1>
        {preview?.subject ? (
          <p>
            Gemeldete E-Mail: <strong>«{preview.subject}»</strong>
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
              Haben Sie in dieser E-Mail einen Link oder Anhang geöffnet oder
              irgendwo Ihr Passwort oder andere Daten eingegeben? Ehrlich ist
              hier wichtig: Es passiert Ihnen nichts, wir müssen nur schnell
              reagieren können.
            </p>
            <div className="security-response__actions">
              <button
                className="primary-button"
                disabled={pending}
                onClick={() => void answer("yes")}
                type="button"
              >
                <ShieldAlert aria-hidden="true" size={16} /> Ja, ich habe
                geklickt oder Daten eingegeben
              </button>
              <button
                className="secondary-button"
                disabled={pending}
                onClick={() => void answer("no")}
                type="button"
              >
                <ShieldCheck aria-hidden="true" size={16} /> Nein, nichts
                geöffnet
              </button>
            </div>
          </>
        ) : null}
        {preview?.state === "answered" ? (
          <p role="status">
            {preview.answer === "yes"
              ? "Danke. Das Sicherheitsteam meldet sich bei Ihnen. Ändern Sie bis dahin vorsorglich Ihr Passwort, falls Sie es eingegeben haben."
              : "Danke, dann ist für Sie nichts weiter zu tun. Sie können dieses Fenster schliessen."}
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
