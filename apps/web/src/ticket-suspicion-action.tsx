import { LoaderCircle, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  loadTicketSupportLevel,
  reportPhishingSuspicion,
  suspicionResultText,
  type TicketSupportLevel,
} from "./lib/support-levels";

import { confirmDialog } from "./app-dialog";
/**
 * «Spam-/Phishing-Verdacht»: the requester suspects a spam or phishing
 * mail. After a confirmation The requester
 * gets the same standard reply as for a mail reported in Outlook, and the
 * ticket goes to the department's 2nd level team (e.g. «System Engineer»).
 * Hidden without the rights or without a single active 2nd level team.
 */
export function TicketSuspicionAction({
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
  const [suspicion, setSuspicion] = useState<
    TicketSupportLevel["suspicion"] | null
  >(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setSuspicion(null);
    void loadTicketSupportLevel(tenantId, ticketId)
      .then((state) => {
        if (active) setSuspicion(state.suspicion);
      })
      // Without agent rights the button simply stays hidden.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [refreshKey, tenantId, ticketId]);

  if (!suspicion) return null;
  if (suspicion.reported) {
    return (
      <span
        className="ticket-suspicion-badge"
        title="Für dieses Ticket wurde ein Spam-/Phishing-Verdacht gemeldet."
      >
        <ShieldAlert aria-hidden="true" size={15} />
        <span className="ticket-detail-action-label">
          Spam-/Phishing-Verdacht
        </span>
      </span>
    );
  }
  if (!suspicion.canReport || !suspicion.targetTeam) return null;
  const teamName = suspicion.targetTeam.name;

  async function mark() {
    const confirmed = await confirmDialog(
      `Wirklich als Spam/Phishing markieren?\n\nDie anfragende Person vermutet eine Spam- oder Phishing-Mail und erhält die Standardantwort (wie bei einer Phishing-Meldung aus Outlook), und das Ticket wird an den 2nd Level (${teamName}) weitergeleitet. Der Absender wird nicht gesperrt; dafür gibt es «Spam» in der Ticketliste. Das lässt sich nicht rückgängig machen.`,
      { confirmLabel: "Verdacht melden", tone: "danger" },
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await reportPhishingSuspicion(tenantId, ticketId);
      setSuspicion((current) =>
        current ? { ...current, reported: true, canReport: false } : current,
      );
      onDone({
        tone: result.reply === "queued" ? "success" : "error",
        text: suspicionResultText(result),
      });
    } catch (error) {
      onDone({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Das Ticket konnte nicht als Spam-/Phishing-Verdacht markiert werden.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      aria-label="Spam-/Phishing-Verdacht melden"
      className="secondary-button ticket-suspicion-button"
      disabled={disabled || busy}
      onClick={() => void mark()}
      title={`Spam-/Phishing-Verdacht: Standardantwort an die anfragende Person, Weiterleitung an ${teamName}`}
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
      <span className="ticket-detail-action-label">
        Spam-/Phishing-Verdacht
      </span>
    </button>
  );
}
