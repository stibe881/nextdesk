import { LoaderCircle, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  loadTicketSupportLevel,
  markTicketSpam,
  spamResultText,
  type TicketSupportLevel,
} from "./lib/support-levels";

/**
 * «Spam/Phishing»: classifies the ticket after a confirmation. The requester
 * gets the same standard reply as for a mail reported in Outlook, and the
 * ticket goes to the department's 2nd level team (e.g. «System Engineer»).
 * Hidden without the rights or without a single active 2nd level team.
 */
export function TicketSpamAction({
  disabled,
  onDone,
  refreshKey,
  tenantId,
  ticketId,
}: {
  disabled: boolean;
  onDone: (result: { tone: "success" | "error"; text: string }) => void;
  refreshKey: string;
  tenantId: string;
  ticketId: string;
}) {
  const [spam, setSpam] = useState<TicketSupportLevel["spam"] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setSpam(null);
    void loadTicketSupportLevel(tenantId, ticketId)
      .then((state) => {
        if (active) setSpam(state.spam);
      })
      // Without agent rights the button simply stays hidden.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [refreshKey, tenantId, ticketId]);

  if (!spam) return null;
  if (spam.marked) {
    return (
      <span
        className="ticket-spam-badge"
        title="Dieses Ticket wurde als Spam/Phishing eingestuft."
      >
        <ShieldAlert aria-hidden="true" size={15} />
        <span className="ticket-detail-action-label">Spam/Phishing</span>
      </span>
    );
  }
  if (!spam.canMark || !spam.targetTeam) return null;
  const teamName = spam.targetTeam.name;

  async function mark() {
    const confirmed = window.confirm(
      `Wirklich als Spam/Phishing markieren?\n\nDie anfragende Person erhält die Standardantwort (wie bei einer Phishing-Meldung aus Outlook) und das Ticket wird an den 2nd Level (${teamName}) weitergeleitet. Das lässt sich nicht rückgängig machen.`,
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await markTicketSpam(tenantId, ticketId);
      setSpam((current) =>
        current ? { ...current, marked: true, canMark: false } : current,
      );
      onDone({
        tone: result.reply === "queued" ? "success" : "error",
        text: spamResultText(result),
      });
    } catch (error) {
      onDone({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Das Ticket konnte nicht als Spam/Phishing eingestuft werden.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      aria-label="Als Spam/Phishing einstufen"
      className="secondary-button ticket-spam-button"
      disabled={disabled || busy}
      onClick={() => void mark()}
      title={`Als Spam/Phishing einstufen: Standardantwort an die anfragende Person, Weiterleitung an ${teamName}`}
      type="button"
    >
      {busy ? (
        <LoaderCircle
          aria-hidden="true"
          className="ticket-detail-spinner"
          size={16}
        />
      ) : (
        <ShieldAlert aria-hidden="true" size={16} strokeWidth={1.8} />
      )}
      <span className="ticket-detail-action-label">Spam/Phishing</span>
    </button>
  );
}
