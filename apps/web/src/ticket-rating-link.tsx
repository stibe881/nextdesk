import { LoaderCircle, Star } from "lucide-react";
import { useEffect, useState } from "react";

import {
  parseRatingLinkResponse,
  ratingLinkErrorText,
  ratingLinkTokenFromHash,
  type RatingLinkPreview,
} from "./lib/ticket-rating-link";
import { supabase } from "./lib/supabase";
import "./requester-ticket-progress.css";
import "./ticket-rating-link.css";

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

async function callRating(
  body: Record<string, unknown>,
): Promise<RatingLinkPreview> {
  if (!supabase) throw new Error("not_configured");
  const { data, error } = await supabase.functions.invoke(
    "ticket-rating-link",
    { body },
  );
  if (error) throw new Error((await errorCode(error)) ?? "failed");
  const parsed = parseRatingLinkResponse(data);
  if (!parsed) throw new Error("failed");
  return parsed;
}

const SCORE_WORDS = [
  "",
  "Unzufrieden",
  "Eher unzufrieden",
  "Zufrieden",
  "Sehr zufrieden",
  "Begeistert",
] as const;

/**
 * Public page for the star links in the «ticket resolved» e-mail
 * (https://app.nextdesk.ch/#ticket-bewertung=<token>). Opening the link saves
 * nothing; the person confirms with one click, so mail scanners that open links
 * in advance cannot rate on the person's behalf.
 */
export function TicketRatingLinkPage() {
  const [token] = useState(() => ratingLinkTokenFromHash(window.location.hash));
  const [preview, setPreview] = useState<RatingLinkPreview | null>(null);
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // Remove the token from the address bar and the browser history.
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setError(ratingLinkErrorText("token_invalid"));
      return;
    }
    void callRating({ token })
      .then((result) => {
        setPreview(result);
        setScore(result.score);
      })
      .catch((cause: Error) => setError(ratingLinkErrorText(cause.message)));
  }, [token]);

  async function confirm() {
    if (!token || pending || score < 1) return;
    setPending(true);
    setError("");
    try {
      const result = await callRating({
        token,
        confirm: true,
        score,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setPreview(result);
      setScore(result.score);
    } catch (cause) {
      setError(ratingLinkErrorText((cause as Error).message));
    } finally {
      setPending(false);
    }
  }

  const done = preview?.state === "done";
  const title = done
    ? "Danke für Ihre Bewertung"
    : preview?.state === "rated"
      ? "Dieses Ticket wurde bereits bewertet"
      : "Wie zufrieden waren Sie?";

  return (
    <main className="reminder-action-page">
      <section
        aria-labelledby="rating-link-heading"
        className="reminder-action-page__card"
      >
        <p className="eyebrow">NEXTDESK</p>
        <h1 id="rating-link-heading">{title}</h1>
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
            <div
              aria-label="Bewertung von 1 bis 5 Sternen"
              className="rating-link__stars"
              role="radiogroup"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  aria-checked={score === value}
                  aria-label={`${value} von 5 Sternen`}
                  className={`rating-link__star${value <= score ? " is-active" : ""}`}
                  disabled={pending}
                  key={value}
                  onClick={() => setScore(value)}
                  role="radio"
                  type="button"
                >
                  <Star aria-hidden="true" size={34} strokeWidth={1.6} />
                </button>
              ))}
            </div>
            <p className="rating-link__word" aria-live="polite">
              {SCORE_WORDS[score] ?? ""}
            </p>
            <label>
              Kommentar (optional)
              <textarea
                disabled={pending}
                maxLength={3000}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Was war gut, was können wir besser machen?"
                rows={4}
                value={comment}
              />
            </label>
            <button
              className="primary-button"
              disabled={pending || score < 1}
              onClick={() => void confirm()}
              type="button"
            >
              {pending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : null}{" "}
              Bewertung senden
            </button>
          </>
        ) : null}
        {done ? (
          <>
            <div
              aria-label={`${preview.score} von 5 Sternen`}
              className="rating-link__stars"
              role="img"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <span
                  className={`rating-link__star${value <= preview.score ? " is-active" : ""}`}
                  key={value}
                >
                  <Star aria-hidden="true" size={34} strokeWidth={1.6} />
                </span>
              ))}
            </div>
            <p role="status">
              Ihre Bewertung wurde gespeichert. Sie können dieses Fenster
              schliessen.
            </p>
          </>
        ) : null}
        {preview?.state === "rated" || preview?.state === "not_ratable" ? (
          <p>{ratingLinkErrorText(preview.state)}</p>
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
