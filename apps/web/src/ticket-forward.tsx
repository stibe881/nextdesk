import { useEffect, useRef, useState, type FormEvent } from "react";
import { Forward, LoaderCircle, X } from "lucide-react";

import { supabase } from "./lib/supabase";
import { functionErrorMessage } from "./lib/function-error";

const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

/** Zerlegt «a@b.ch; c@d.ch, …» in einzelne Adressen. */
export function parseForwardRecipients(value: string): {
  emails: string[];
  invalid: string[];
} {
  const parts = value
    .split(/[\s,;]+/)
    .map((part) => part.trim().replace(/^<|>$/g, ""))
    .filter(Boolean);
  const emails = [
    ...new Set(
      parts
        .filter((part) => EMAIL.test(part))
        .map((part) => part.toLowerCase()),
    ),
  ];
  return { emails, invalid: parts.filter((part) => !EMAIL.test(part)) };
}

/**
 * Weiterleiten einer Mail des Tickets (ursprüngliche Mail oder eine Nachricht)
 * an beliebige Adressen. Die anfragende Person erhält nichts; in der
 * Unterhaltung erscheint eine interne Notiz «Weitergeleitet an …».
 */
export function TicketForwardDialog({
  tenantId,
  ticketId,
  sourceCommentId,
  sourceLabel,
  onClose,
  onForwarded,
}: {
  tenantId: string;
  ticketId: string;
  sourceCommentId: string | null;
  sourceLabel: string;
  onClose: () => void;
  onForwarded: (count: number) => void | Promise<void>;
}) {
  const [recipients, setRecipients] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || pending) return;
    const { emails, invalid } = parseForwardRecipients(recipients);
    if (invalid.length) {
      setError(`Ungültige Adresse: ${invalid.join(", ")}`);
      return;
    }
    if (!emails.length || emails.length > 10) {
      setError("Bitte 1 bis 10 Mailadressen angeben.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        "ticket-operations",
        {
          body: {
            type: "forwardTicket",
            tenantId,
            ticketId,
            emails,
            message: message.trim(),
            sourceCommentId,
          },
        },
      );
      if (invokeError) throw invokeError;
      const count =
        data && typeof data === "object"
          ? Number((data as { data?: { forwarded?: unknown } }).data?.forwarded)
          : emails.length;
      await onForwarded(Number.isFinite(count) ? count : emails.length);
    } catch (nextError) {
      setError(
        await functionErrorMessage(
          nextError,
          "Die Mail konnte nicht weitergeleitet werden.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="ticket-forward-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <form
        aria-labelledby="ticket-forward-heading"
        aria-modal="true"
        className="ticket-forward-dialog"
        onSubmit={(event) => void submit(event)}
        role="dialog"
      >
        <div className="ticket-forward-dialog__head">
          <h3 id="ticket-forward-heading">
            <Forward aria-hidden="true" size={18} /> Weiterleiten
          </h3>
          <button
            aria-label="Schliessen"
            className="icon-button"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <p className="data-caption">
          {sourceLabel} wird mit den Anhängen weitergeleitet. Die anfragende
          Person erhält nichts; in der Unterhaltung erscheint eine interne
          Notiz.
        </p>
        <label className="ticket-comment-body">
          An (Mailadressen, durch Komma getrennt)
          <input
            autoComplete="email"
            disabled={pending}
            maxLength={2600}
            onChange={(event) => setRecipients(event.target.value)}
            placeholder="support@lieferant.ch"
            ref={input}
            required
            type="text"
            value={recipients}
          />
        </label>
        <label className="ticket-comment-body">
          Nachricht (optional)
          <textarea
            disabled={pending}
            maxLength={10000}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Was soll die empfangende Person tun?"
            rows={5}
            value={message}
          />
        </label>
        {error ? (
          <p className="ticket-detail-message error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ticket-detail-actions">
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? (
              <LoaderCircle
                aria-hidden="true"
                className="ticket-detail-spinner"
                size={16}
              />
            ) : (
              <Forward aria-hidden="true" size={16} />
            )}
            Weiterleiten
          </button>
          <button
            className="secondary-button"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            Abbrechen
          </button>
        </div>
      </form>
    </div>
  );
}
