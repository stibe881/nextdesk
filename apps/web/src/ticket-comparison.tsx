import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, LoaderCircle } from "lucide-react";
import { supabase } from "./lib/supabase";

type Candidate = {
  id: string;
  ticketNumber: string;
  subject: string;
  statusLabel: string;
};
type Snapshot = {
  ticket: Record<string, unknown>;
  requesterContact: { displayName?: string } | null;
  assignedAgent: { displayName?: string | null } | null;
  statuses: Array<{ id: string; label: string }>;
  priorities: Array<{ id: string; label: string }>;
  comments: unknown[];
  checklistItems: Array<{ completed_at?: string | null }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, fallback = "–") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function invokeGetTicket(tenantId: string, ticketId: string) {
  if (!supabase)
    return Promise.reject(new Error("Supabase ist nicht konfiguriert."));
  return supabase.functions
    .invoke("ticket-operations", {
      body: { type: "getTicket", tenantId, ticketId },
    })
    .then(({ data, error }) => {
      if (error) throw error;
      if (!isRecord(data) || !isRecord(data.data))
        throw new Error("Ticketvergleich konnte nicht geladen werden.");
      if (isRecord(data.error))
        throw new Error(
          "Du hast keine Berechtigung für diesen Ticketvergleich.",
        );
      const payload = data.data;
      if (!isRecord(payload.ticket))
        throw new Error("Ticketvergleich enthält keine Ticketdaten.");
      return {
        ticket: payload.ticket,
        requesterContact: isRecord(payload.requesterContact)
          ? payload.requesterContact
          : null,
        assignedAgent: isRecord(payload.assignedAgent)
          ? payload.assignedAgent
          : null,
        statuses: Array.isArray(payload.statuses)
          ? payload.statuses
              .filter(isRecord)
              .flatMap((item) =>
                typeof item.id === "string" && typeof item.label === "string"
                  ? [{ id: item.id, label: item.label }]
                  : [],
              )
          : [],
        priorities: Array.isArray(payload.priorities)
          ? payload.priorities
              .filter(isRecord)
              .flatMap((item) =>
                typeof item.id === "string" && typeof item.label === "string"
                  ? [{ id: item.id, label: item.label }]
                  : [],
              )
          : [],
        comments: Array.isArray(payload.comments) ? payload.comments : [],
        checklistItems: Array.isArray(payload.checklistItems)
          ? payload.checklistItems.filter(isRecord)
          : [],
      } satisfies Snapshot;
    });
}
function fieldLabel(values: Array<{ id: string; label: string }>, id: unknown) {
  if (typeof id !== "string") return "–";
  return values.find((value) => value.id === id)?.label ?? "–";
}
function renderValue(
  snapshot: Snapshot,
  field:
    | "number"
    | "subject"
    | "status"
    | "priority"
    | "requester"
    | "agent"
    | "description"
    | "comments"
    | "checklist",
) {
  if (field === "number") return text(snapshot.ticket.ticket_number);
  if (field === "subject") return text(snapshot.ticket.subject);
  if (field === "status")
    return fieldLabel(snapshot.statuses, snapshot.ticket.status_id);
  if (field === "priority")
    return fieldLabel(snapshot.priorities, snapshot.ticket.priority_id);
  if (field === "requester")
    return text(
      snapshot.requesterContact?.displayName ?? snapshot.ticket.requester_name,
    );
  if (field === "agent") return text(snapshot.assignedAgent?.displayName);
  if (field === "description") return text(snapshot.ticket.description);
  if (field === "comments")
    return `${snapshot.comments.length} Beitrag${snapshot.comments.length === 1 ? "" : "e"}`;
  const completed = snapshot.checklistItems.filter(
    (item) => typeof item.completed_at === "string",
  ).length;
  return snapshot.checklistItems.length
    ? `${completed} von ${snapshot.checklistItems.length} erledigt`
    : "Keine Checkliste";
}

export function TicketComparison({
  tenantId,
  ticketId,
  candidates,
}: {
  tenantId: string;
  ticketId: string;
  candidates: Candidate[];
}) {
  const options = useMemo(() => {
    const known = new Set<string>();
    return candidates.filter((candidate) => {
      if (candidate.id === ticketId || known.has(candidate.id)) return false;
      known.add(candidate.id);
      return true;
    });
  }, [candidates, ticketId]);
  const [otherId, setOtherId] = useState("");
  const [current, setCurrent] = useState<Snapshot | null>(null);
  const [other, setOther] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!otherId) {
      setCurrent(null);
      setOther(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void Promise.all([
      invokeGetTicket(tenantId, ticketId),
      invokeGetTicket(tenantId, otherId),
    ])
      .then(([nextCurrent, nextOther]) => {
        if (!cancelled) {
          setCurrent(nextCurrent);
          setOther(nextOther);
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          setCurrent(null);
          setOther(null);
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Ticketvergleich konnte nicht geladen werden.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [otherId, tenantId, ticketId]);

  if (options.length === 0) return null;
  const fields: Array<{
    key: Parameters<typeof renderValue>[1];
    label: string;
    long?: boolean;
  }> = [
    { key: "number", label: "Ticketnummer" },
    { key: "subject", label: "Betreff" },
    { key: "status", label: "Status" },
    { key: "priority", label: "Priorität" },
    { key: "requester", label: "Anfragende Person" },
    { key: "agent", label: "Zugewiesener Agent" },
    { key: "comments", label: "Kommunikation" },
    { key: "checklist", label: "Checkliste" },
    { key: "description", label: "Beschreibung", long: true },
  ];

  return (
    <section
      className="ticket-comparison"
      aria-labelledby="ticket-comparison-heading"
    >
      <div className="ticket-comparison__heading">
        <div>
          <p className="eyebrow">VERGLEICH</p>
          <h3 id="ticket-comparison-heading">Tickets vergleichen</h3>
        </div>
        <ArrowLeftRight aria-hidden="true" size={19} />
      </div>
      <label className="ticket-comparison__picker">
        Vergleichsticket
        <select
          onChange={(event) => setOtherId(event.target.value)}
          value={otherId}
        >
          <option value="">Ticket zum Vergleichen auswählen</option>
          {options.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.ticketNumber} · {candidate.subject}
            </option>
          ))}
        </select>
      </label>
      {loading && (
        <p className="ticket-detail-loading" role="status">
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={18}
          />{" "}
          Vergleich wird geladen …
        </p>
      )}
      {error && (
        <p className="ticket-detail-message error" role="alert">
          {error}
        </p>
      )}
      {current && other && !loading && (
        <div
          className="ticket-comparison__table"
          role="table"
          aria-label="Ticketvergleich"
        >
          <div
            className="ticket-comparison__row ticket-comparison__row--head"
            role="row"
          >
            <span role="columnheader">Eigenschaft</span>
            <strong role="columnheader">Aktuelles Ticket</strong>
            <strong role="columnheader">Vergleichsticket</strong>
          </div>
          {fields.map((field) => {
            const left = renderValue(current, field.key);
            const right = renderValue(other, field.key);
            return (
              <div
                className={`ticket-comparison__row${field.long ? " ticket-comparison__row--long" : ""}${left !== right ? " is-different" : ""}`}
                key={field.key}
                role="row"
              >
                <span role="rowheader">{field.label}</span>
                <span role="cell">{left}</span>
                <span role="cell">{right}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
