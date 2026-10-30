import {
  invokeNextDesk,
  loadCurrentTenant,
  requireNextDesk,
} from "@/lib/nextdesk-client";
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

/** Weist ein Ticket der angemeldeten Person zu (Berechtigung wird serverseitig geprüft). */
export async function assignTicketToMe(
  ticketId: string,
  userId: string,
): Promise<void> {
  const tenant = await loadCurrentTenant();
  await invokeNextDesk("ticket-operations", {
    type: "updateTicket",
    tenantId: tenant.id,
    ticketId,
    assignedAgentId: userId,
  });
}

export type BulkResult = { failed: number; succeeded: number };

export async function assignTicketsToMe(
  ticketIds: readonly string[],
  userId: string,
): Promise<BulkResult> {
  const result: BulkResult = { failed: 0, succeeded: 0 };
  for (const ticketId of ticketIds) {
    try {
      await assignTicketToMe(ticketId, userId);
      result.succeeded += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export type BulkStatusKey = "in_progress" | "waiting" | "resolved" | "closed";

export const BULK_STATUS_OPTIONS: { key: BulkStatusKey; label: string }[] = [
  { key: "in_progress", label: "In Bearbeitung" },
  { key: "waiting", label: "Wartend" },
  { key: "resolved", label: "Gelöst" },
  { key: "closed", label: "Geschlossen" },
];

/** Setzt bis zu 50 Tickets auf einen Status; Schliessen verlangt eine Bestätigung. */
export async function bulkSetTicketStatus(
  ticketIds: readonly string[],
  statusKey: BulkStatusKey,
): Promise<void> {
  const tenant = await loadCurrentTenant();
  await invokeNextDesk("ticket-bulk-status", {
    type: "applyStatus",
    tenantId: tenant.id,
    ticketIds: [...ticketIds].slice(0, 50),
    statusKey,
    confirmClose: statusKey === "resolved" || statusKey === "closed",
  });
}

export async function bulkDeleteTickets(
  ticketIds: readonly string[],
): Promise<void> {
  const tenant = await loadCurrentTenant();
  await invokeNextDesk("ticket-bulk-status", {
    type: "deleteTickets",
    tenantId: tenant.id,
    ticketIds: [...ticketIds].slice(0, 50),
    confirmDelete: true,
  });
}

export type SavedTicketView = {
  filters: {
    agent: string;
    query: string;
    ticketScope: string;
  };
  id: string;
  name: string;
};

/** Persönliche gespeicherte Ansichten aus der Web-App. */
export async function listSavedTicketViews(): Promise<SavedTicketView[]> {
  const tenant = await loadCurrentTenant();
  const body = await invokeNextDesk<unknown>("ticket-saved-views", {
    type: "listSavedViews",
    tenantId: tenant.id,
  });
  const views =
    typeof body === "object" &&
    body !== null &&
    "data" in body &&
    typeof (body as { data?: unknown }).data === "object" &&
    (body as { data: { savedViews?: unknown } | null }).data !== null
      ? (body as { data: { savedViews?: unknown } }).data.savedViews
      : null;
  if (!Array.isArray(views)) return [];
  const result: SavedTicketView[] = [];
  for (const view of views) {
    if (typeof view !== "object" || view === null) continue;
    const record = view as Record<string, unknown>;
    const filters =
      typeof record.filters === "object" && record.filters !== null
        ? (record.filters as Record<string, unknown>)
        : {};
    if (typeof record.id !== "string" || typeof record.name !== "string")
      continue;
    result.push({
      id: record.id,
      name: record.name,
      filters: {
        agent: typeof filters.agent === "string" ? filters.agent : "all",
        query: typeof filters.query === "string" ? filters.query : "",
        ticketScope:
          typeof filters.ticketScope === "string" ? filters.ticketScope : "all",
      },
    });
  }
  return result;
}
