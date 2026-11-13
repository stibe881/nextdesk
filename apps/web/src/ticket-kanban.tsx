import { tn } from "./lib/formality";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useTicketHoverPreview } from "./ticket-hover-preview";

import type { DashboardTicket } from "./dashboard-data";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";
import "./ticket-kanban.css";

type Status = { key: string; label: string; isClosed: boolean };

/**
 * Kanban board of the filtered ticket list: one column per status, cards can
 * be dragged to another column to change the status (closing asks first).
 */
export function TicketKanban({
  tenantId,
  tickets,
  onOpen,
  onChanged,
}: {
  tenantId: string;
  tickets: readonly DashboardTicket[];
  onOpen: (ticketId: string) => void;
  onChanged: () => void;
}) {
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const hoverPreview = useTicketHoverPreview();

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase
      .from("ticket_statuses")
      .select("key, label, is_closed, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order")
      .then(({ data }) => {
        if (!active) return;
        setStatuses(
          (
            (data ?? []) as { key: string; label: string; is_closed: boolean }[]
          ).map((status) => ({
            key: status.key,
            label: status.label,
            isClosed: status.is_closed,
          })),
        );
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  const columns = useMemo(
    () =>
      statuses
        .filter((status) => showClosed || !status.isClosed)
        .map((status) => ({
          ...status,
          tickets: tickets.filter((ticket) => ticket.state === status.label),
        })),
    [statuses, tickets, showClosed],
  );

  async function move(ticket: DashboardTicket, status: Status) {
    if (!supabase || ticket.state === status.label) return;
    if (status.key === "new") {
      setError("Ein Ticket kann nicht auf «Neu» zurückgesetzt werden.");
      return;
    }
    if (
      status.isClosed &&
      !window.confirm(
        `Ticket ${ticket.id} wirklich auf «${status.label}» setzen? Die anfragende Person wird informiert.`,
      )
    ) {
      return;
    }
    const ticketId = ticket.recordId ?? ticket.id;
    setMoving(ticketId);
    setError("");
    const { error: invokeError } = await supabase.functions.invoke(
      "ticket-operations",
      {
        body: {
          type: "updateTicket",
          tenantId,
          ticketId,
          statusKey: status.key,
          ...(status.isClosed ? { confirmClose: true } : {}),
        },
      },
    );
    setMoving(null);
    if (invokeError) {
      setError(
        await functionErrorMessage(
          invokeError,
          "Der Status konnte nicht geändert werden.",
        ),
      );
      return;
    }
    onChanged();
  }

  function onDrop(event: DragEvent<HTMLElement>, status: Status) {
    event.preventDefault();
    setDragOver(null);
    const id = event.dataTransfer.getData("text/plain");
    const ticket = tickets.find((entry) => (entry.recordId ?? entry.id) === id);
    if (ticket) void move(ticket, status);
  }

  return (
    <div className="ticket-kanban">
      {hoverPreview.overlay}
      <div className="ticket-kanban__toolbar">
        <p>
          {tn(
            "Ziehe eine Karte in eine andere Spalte, um den Status zu ändern.",
            "Ziehen Sie eine Karte in eine andere Spalte, um den Status zu ändern.",
          )}
        </p>
        <label>
          <input
            checked={showClosed}
            onChange={(event) => setShowClosed(event.target.checked)}
            type="checkbox"
          />
          Geschlossene Spalten zeigen
        </label>
      </div>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ticket-kanban__board">
        {columns.map((column) => (
          <section
            aria-label={`${column.label}: ${column.tickets.length} Tickets`}
            className={`ticket-kanban__column${dragOver === column.key ? " is-drop-target" : ""}`}
            key={column.key}
            onDragLeave={() => setDragOver(null)}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(column.key);
            }}
            onDrop={(event) => onDrop(event, column)}
          >
            <header>
              <span>{column.label}</span>
              <strong>{column.tickets.length}</strong>
            </header>
            <ul>
              {column.tickets.map((ticket) => {
                const id = ticket.recordId ?? ticket.id;
                return (
                  <li
                    className={`ticket-kanban__card ticket-kanban__card--${ticket.risk}${moving === id ? " is-moving" : ""}`}
                    draggable={moving === null}
                    key={id}
                    onDragStart={(event) =>
                      event.dataTransfer.setData("text/plain", id)
                    }
                  >
                    <button
                      {...hoverPreview.bind(
                        id,
                        `${ticket.id} · ${ticket.subject}`,
                      )}
                      onClick={() => onOpen(id)}
                      type="button"
                    >
                      <code>{ticket.id}</code>
                      <strong>{ticket.subject}</strong>
                      {ticket.requesterName ? (
                        <span className="ticket-kanban__requester">
                          <span className="sr-only">Anfragende Person: </span>
                          {ticket.requesterName}
                        </span>
                      ) : null}
                      <span>
                        {ticket.isUnassigned
                          ? "Nicht zugewiesen"
                          : ticket.assignedToCurrentUser
                            ? "Mir zugewiesen"
                            : (ticket.assignedAgentName ?? "Zugewiesen")}
                        {ticket.priority ? ` · ${ticket.priority}` : ""}
                      </span>
                      <small>{ticket.sla}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
            {column.tickets.length === 0 ? (
              <p className="ticket-kanban__empty">Keine Tickets</p>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
