// Ein Ticket mit verletztem SLA-Ziel darf erst gelöst oder geschlossen werden,
// wenn für jede Verletzung eine Ursache erfasst ist (sla-breach-reasons).
import { detectBreaches } from "./sla-breach-causes.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

export const SLA_REASON_REQUIRED_MESSAGE =
  "Bitte zuerst die Ursache der SLA-Verletzung erfassen. Danach lässt sich das Ticket lösen oder schliessen.";

/**
 * Ticket ids (of the given ones) with an SLA breach that has no reason yet.
 * Returns null if the lookup failed, so callers can fail closed.
 */
export async function ticketIdsWithOpenSlaBreach(
  admin: Admin,
  tenantId: string,
  ticketIds: readonly string[],
): Promise<string[] | null> {
  if (ticketIds.length === 0) return [];
  const [tickets, events, reasons] = await Promise.all([
    admin
      .from("tickets")
      .select(
        "id, response_due_at, first_responded_at, resolution_due_at, resolved_at, closed_at, sla_paused_at",
      )
      .eq("tenant_id", tenantId)
      .in("id", ticketIds),
    admin
      .from("ticket_sla_events")
      .select("ticket_id, event_type")
      .in("ticket_id", ticketIds)
      .in("event_type", ["response_breached", "resolution_breached"]),
    admin
      .from("ticket_sla_breach_reasons")
      .select("ticket_id, breach_kind")
      .eq("tenant_id", tenantId)
      .in("ticket_id", ticketIds),
  ]);
  if (tickets.error || events.error || reasons.error) return null;
  const eventsByTicket = new Map<string, string[]>();
  for (const row of (events.data ?? []) as Row[]) {
    const id = String(row.ticket_id);
    eventsByTicket.set(id, [
      ...(eventsByTicket.get(id) ?? []),
      String(row.event_type),
    ]);
  }
  const recorded = new Set(
    ((reasons.data ?? []) as Row[]).map(
      (row) => `${row.ticket_id}:${row.breach_kind}`,
    ),
  );
  const open: string[] = [];
  for (const ticket of (tickets.data ?? []) as Row[]) {
    const id = String(ticket.id);
    const breaches = detectBreaches(
      {
        responseDueAt: (ticket.response_due_at as string | null) ?? null,
        firstRespondedAt: (ticket.first_responded_at as string | null) ?? null,
        resolutionDueAt: (ticket.resolution_due_at as string | null) ?? null,
        resolvedAt: (ticket.resolved_at as string | null) ?? null,
        closedAt: (ticket.closed_at as string | null) ?? null,
        slaPausedAt: (ticket.sla_paused_at as string | null) ?? null,
      },
      eventsByTicket.get(id) ?? [],
    );
    if (breaches.some((breach) => !recorded.has(`${id}:${breach.kind}`))) {
      open.push(id);
    }
  }
  return open;
}
