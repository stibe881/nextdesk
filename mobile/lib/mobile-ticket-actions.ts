import { loadCurrentTenant, requireNextDesk } from "@/lib/nextdesk-client";
import type { MobileTicket } from "@/lib/nextdesk-tickets";

export function followUpTitle(ticket: MobileTicket): string {
  return (
    Array.from(`${ticket.ticketNumber}: ${ticket.subject}`.trim())
      .slice(0, 240)
      .join("") || "Ticket-Wiedervorlage"
  );
}

export function dueToday(): string {
  const due = new Date();
  due.setHours(23, 59, 59, 999);
  return due.toISOString();
}

const DELETE_ERROR_MESSAGES: Record<string, string> = {
  bulk_ticket_delete_permission_denied:
    "Du hast keine Berechtigung, dieses Ticket zu löschen.",
  bulk_ticket_delete_legal_hold:
    "Dieses Ticket unterliegt einer Aufbewahrungssperre und kann nicht gelöscht werden.",
  bulk_ticket_delete_dependency_blocked:
    "Dieses Ticket ist mit anderen Daten verknüpft und kann nicht gelöscht werden.",
  bulk_ticket_delete_target_missing: "Dieses Ticket ist nicht mehr verfügbar.",
};

async function deleteErrorMessage(error: unknown): Promise<string> {
  const context =
    typeof error === "object" && error !== null && "context" in error
      ? (error as { context?: unknown }).context
      : undefined;
  if (context instanceof Response) {
    const payload: unknown = await context
      .clone()
      .json()
      .catch(() => null);
    const code =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error?: unknown }).error === "object" &&
      (payload as { error: { code?: unknown } | null }).error !== null
        ? (payload as { error: { code?: unknown } }).error.code
        : undefined;
    if (typeof code === "string" && DELETE_ERROR_MESSAGES[code]) {
      return DELETE_ERROR_MESSAGES[code];
    }
  }
  return "Das Ticket konnte nicht gelöscht werden.";
}

/**
 * Löscht ein Ticket über dieselbe serverseitig geprüfte Funktion wie die
 * Web-App. Die Berechtigung "ticket.delete" wird auf dem Server erzwungen.
 */
export async function deleteMobileTicket(ticketId: string): Promise<void> {
  const tenant = await loadCurrentTenant();
  const { data, error } = await requireNextDesk().functions.invoke(
    "ticket-bulk-status",
    {
      body: {
        type: "deleteTickets",
        tenantId: tenant.id,
        ticketIds: [ticketId],
        confirmDelete: true,
      },
    },
  );
  if (error) throw new Error(await deleteErrorMessage(error));
  const deleted =
    typeof data === "object" &&
    data !== null &&
    "data" in data &&
    typeof (data as { data?: { deleted?: unknown } }).data?.deleted === "number"
      ? (data as { data: { deleted: number } }).data.deleted
      : 0;
  if (deleted < 1) throw new Error("Das Ticket konnte nicht gelöscht werden.");
}
