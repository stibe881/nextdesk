import { Activity } from "lucide-react";
import { useEffect, useState } from "react";

import {
  parseTicketIncidents,
  STATE_LABELS,
  type TicketIncidentLink,
} from "./lib/incidents";
import { supabase } from "./lib/supabase";

/**
 * Hint in the ticket view: «Gehört zur Störung STO-…» when the ticket is
 * linked to a monitoring incident (automatically or by hand).
 */
export function TicketMonitoringIncidentHint({
  tenantId,
  ticketId,
  onOpenIncident,
}: {
  tenantId: string;
  ticketId: string;
  onOpenIncident?: ((incidentId: string) => void) | undefined;
}) {
  const [links, setLinks] = useState<{
    ticketId: string;
    incidents: TicketIncidentLink[];
    canOpen: boolean;
  } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.functions
      .invoke("incidents", {
        body: { type: "ticketIncidents", tenantId, ticketId },
      })
      .then(({ data, error }) => {
        if (!active || error) return;
        setLinks({ ticketId, ...parseTicketIncidents(data) });
      });
    return () => {
      active = false;
    };
  }, [tenantId, ticketId]);

  if (!links || links.ticketId !== ticketId || !links.incidents.length) {
    return null;
  }
  return (
    <p className="ticket-detail-message warning" role="status">
      <Activity aria-hidden="true" size={17} />
      <span>
        Gehört zur Störung{" "}
        {links.incidents.map((incident, index) => (
          <span key={incident.id}>
            {index ? ", " : ""}
            {links.canOpen && onOpenIncident ? (
              <button
                className="text-button"
                onClick={() => onOpenIncident(incident.id)}
                type="button"
              >
                {incident.number}
              </button>
            ) : (
              <strong>{incident.number}</strong>
            )}{" "}
            ({incident.title}, {STATE_LABELS[incident.state] ?? incident.state})
          </span>
        ))}
        . Beim Abschluss der Störung kann das Ticket automatisch informiert und
        gelöst werden.
      </span>
    </p>
  );
}
