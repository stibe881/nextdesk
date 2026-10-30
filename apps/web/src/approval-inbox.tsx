import { useCallback, useEffect, useState } from "react";
import { Check, ClipboardCheck, LoaderCircle, X } from "lucide-react";
import { supabase } from "./lib/supabase";

type InboxItem = {
  approvalId: string;
  approvalKind: string;
  reason: string;
  requestedAt: string;
  ticketId: string;
  ticketNumber: string;
  ticketSubject: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function invokeApprovals(
  body: Record<string, unknown>,
): Promise<unknown> {
  if (!supabase) throw new Error("not_configured");
  const { data, error } = await supabase.functions.invoke("ticket-approvals", {
    body,
  });
  if (error) throw error;
  if (!isRecord(data) || isRecord(data.error) || !("data" in data)) {
    throw new Error("approval_request_failed");
  }
  return data.data;
}

function parseInbox(value: unknown): InboxItem[] {
  if (!isRecord(value) || !Array.isArray(value.approvals)) return [];
  const items: InboxItem[] = [];
  for (const entry of value.approvals) {
    if (
      !isRecord(entry) ||
      !isRecord(entry.ticket) ||
      !isRecord(entry.approval)
    )
      continue;
    const { ticket, approval } = entry;
    if (
      typeof ticket.id !== "string" ||
      typeof approval.id !== "string" ||
      typeof approval.approvalKind !== "string" ||
      typeof approval.reason !== "string" ||
      typeof approval.requestedAt !== "string"
    )
      continue;
    items.push({
      approvalId: approval.id,
      approvalKind: approval.approvalKind,
      reason: approval.reason,
      requestedAt: approval.requestedAt,
      ticketId: ticket.id,
      ticketNumber: typeof ticket.number === "string" ? ticket.number : "",
      ticketSubject: typeof ticket.subject === "string" ? ticket.subject : "",
    });
  }
  return items;
}

/**
 * Freigaben, die auf eine Entscheidung der angemeldeten Person warten. Ohne
 * Berechtigung oder offene Freigaben bleibt die Karte unsichtbar.
 */
export function ApprovalInboxCard({
  onOpenTicket,
  tenantId,
}: {
  onOpenTicket: (ticketId: string) => void;
  tenantId: string;
}) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setItems(
        parseInbox(await invokeApprovals({ type: "listInbox", tenantId })),
      );
    } catch {
      setItems(null);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(item: InboxItem, decision: "approved" | "rejected") {
    if (
      decision === "rejected" &&
      !window.confirm(`Freigabe für «${item.ticketNumber}» ablehnen?`)
    ) {
      return;
    }
    setBusyId(item.approvalId);
    setMessage("");
    try {
      await invokeApprovals({
        type: "decide",
        tenantId,
        ticketId: item.ticketId,
        approvalId: item.approvalId,
        decision,
      });
      setItems((current) =>
        (current ?? []).filter((entry) => entry.approvalId !== item.approvalId),
      );
      setMessage(
        decision === "approved"
          ? `«${item.ticketNumber}» wurde freigegeben.`
          : `«${item.ticketNumber}» wurde abgelehnt.`,
      );
    } catch {
      setMessage(
        "Die Freigabe konnte nicht verarbeitet werden. Möglicherweise wurde sie bereits entschieden.",
      );
      void load();
    } finally {
      setBusyId(null);
    }
  }

  if (!items || (items.length === 0 && !message)) return null;

  return (
    <article
      className="panel approval-inbox"
      aria-labelledby="approval-inbox-title"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Freigaben</p>
          <h2 id="approval-inbox-title">
            <ClipboardCheck aria-hidden="true" size={18} /> Zu entscheiden
          </h2>
        </div>
        <span className="data-caption">{items.length} offen</span>
      </div>
      {message && (
        <p className="approval-inbox__message" role="status">
          {message}
        </p>
      )}
      <ul className="approval-inbox__list">
        {items.slice(0, 8).map((item) => {
          const busy = busyId === item.approvalId;
          return (
            <li key={item.approvalId}>
              <button
                className="approval-inbox__ticket"
                onClick={() => onOpenTicket(item.ticketId)}
                type="button"
              >
                <span className="approval-inbox__number">
                  {item.ticketNumber}
                </span>
                <strong>{item.ticketSubject || item.approvalKind}</strong>
                <span className="approval-inbox__reason">{item.reason}</span>
              </button>
              <div className="approval-inbox__actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void decide(item, "rejected")}
                  type="button"
                >
                  <X aria-hidden="true" size={15} /> Ablehnen
                </button>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void decide(item, "approved")}
                  type="button"
                >
                  {busy ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="ticket-detail-spinner"
                      size={15}
                    />
                  ) : (
                    <Check aria-hidden="true" size={15} />
                  )}{" "}
                  Freigeben
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
