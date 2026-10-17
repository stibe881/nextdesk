import {
  invokeNextDesk,
  loadCurrentTenant,
  requireNextDesk,
  type MobileTenant,
} from "@/lib/nextdesk-client";

export type MobileTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assignedToCurrentUser: boolean;
  resolved: boolean;
  requesterId: string;
};

type Department = { id: string; key: string; name: string; kind: string };
type Priority = { key: string; label: string; sort_order: number };
type Requester = { id: string; displayName: string };

export type TicketFormOptions = {
  departments: Department[];
  priorities: Priority[];
  currentRequester: Requester;
};

export type MobileTicketDetail = {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  requesterName: string | null;
  statusId: string;
  priorityId: string;
  statusOptions: Array<{
    id: string;
    key: string;
    label: string;
    is_closed: boolean;
  }>;
  priorityOptions: Array<{ id: string; key: string; label: string }>;
  canUpdate: boolean;
};

function envelopeData(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Die Antwort von nextDesk ist unvollständig.");
  }
  const data = (value as { data?: unknown }).data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Die Antwort von nextDesk ist unvollständig.");
  }
  return data as Record<string, unknown>;
}

export async function loadMobileDashboard(): Promise<{
  tenant: MobileTenant;
  tickets: MobileTicket[];
}> {
  const client = requireNextDesk();
  const tenant = await loadCurrentTenant();
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (userError || !user) throw new Error("Die Anmeldung ist abgelaufen.");

  const [ticketsResult, statusesResult, prioritiesResult] = await Promise.all([
    client
      .from("tickets")
      .select(
        "id, ticket_number, subject, description, status_id, priority_id, requester_id, assigned_agent_id, created_at",
      )
      .eq("tenant_id", tenant.id)
      .order("updated_at", { ascending: false })
      .limit(50),
    client
      .from("ticket_statuses")
      .select("id, label, is_closed")
      .eq("tenant_id", tenant.id),
    client
      .from("ticket_priorities")
      .select("id, label")
      .eq("tenant_id", tenant.id),
  ]);
  if (ticketsResult.error || statusesResult.error || prioritiesResult.error) {
    throw new Error("Die Tickets konnten nicht geladen werden.");
  }

  const statusById = new Map(
    (statusesResult.data ?? []).map((status) => [status.id, status]),
  );
  const priorityById = new Map(
    (prioritiesResult.data ?? []).map((priority) => [priority.id, priority]),
  );
  const tickets = (ticketsResult.data ?? []).map((ticket) => ({
    id: ticket.id,
    ticketNumber: ticket.ticket_number,
    subject: ticket.subject,
    description: ticket.description,
    status: statusById.get(ticket.status_id)?.label ?? "Unbekannt",
    priority: priorityById.get(ticket.priority_id)?.label ?? "Ohne Priorität",
    assignedToCurrentUser:
      ticket.assigned_agent_id === user.id || ticket.requester_id === user.id,
    resolved: Boolean(statusById.get(ticket.status_id)?.is_closed),
    requesterId: ticket.requester_id,
  }));
  return { tenant, tickets };
}

export async function loadTicketFormOptions(
  tenantId: string,
): Promise<TicketFormOptions> {
  const data = envelopeData(
    await invokeNextDesk<unknown>("ticket-actions", {
      type: "getFormOptions",
      tenantId,
    }),
  );
  if (
    !Array.isArray(data.departments) ||
    !Array.isArray(data.priorities) ||
    !data.currentRequester
  ) {
    throw new Error("Die Angaben für die Ticketerfassung sind unvollständig.");
  }
  return {
    departments: data.departments as Department[],
    priorities: data.priorities as Priority[],
    currentRequester: data.currentRequester as Requester,
  };
}

export async function createMobileTicket(input: {
  tenantId: string;
  departmentId: string;
  priorityKey: string;
  requesterContactId: string;
  subject: string;
  description: string;
}): Promise<{ ticketId: string; ticketNumber: string }> {
  const data = envelopeData(
    await invokeNextDesk<unknown>("ticket-actions", {
      type: "createTicket",
      tenantId: input.tenantId,
      departmentId: input.departmentId,
      priorityKey: input.priorityKey,
      requesterContactId: input.requesterContactId,
      subject: input.subject,
      description: input.description,
    }),
  );
  if (
    typeof data.ticketId !== "string" ||
    typeof data.ticketNumber !== "string"
  ) {
    throw new Error("Das Ticket konnte nicht angelegt werden.");
  }
  return { ticketId: data.ticketId, ticketNumber: data.ticketNumber };
}

export async function loadMobileTicketDetail(
  tenantId: string,
  ticketId: string,
): Promise<MobileTicketDetail> {
  const data = envelopeData(
    await invokeNextDesk<unknown>("ticket-operations", {
      type: "getTicket",
      tenantId,
      ticketId,
    }),
  );
  const ticket = data.ticket;
  if (typeof ticket !== "object" || ticket === null || Array.isArray(ticket)) {
    throw new Error("Das Ticket ist nicht mehr verfügbar.");
  }
  const record = ticket as Record<string, unknown>;
  const requester = data.requesterContact as
    | { displayName?: unknown }
    | null
    | undefined;
  if (
    typeof record.id !== "string" ||
    typeof record.ticket_number !== "string" ||
    typeof record.subject !== "string" ||
    typeof record.description !== "string" ||
    typeof record.status_id !== "string" ||
    typeof record.priority_id !== "string" ||
    !Array.isArray(data.statuses) ||
    !Array.isArray(data.priorities)
  ) {
    throw new Error("Die Ticketdetails sind unvollständig.");
  }
  return {
    id: record.id,
    ticketNumber: record.ticket_number,
    subject: record.subject,
    description: record.description,
    requesterName:
      typeof requester?.displayName === "string" ? requester.displayName : null,
    statusId: record.status_id,
    priorityId: record.priority_id,
    statusOptions: data.statuses as MobileTicketDetail["statusOptions"],
    priorityOptions: data.priorities as MobileTicketDetail["priorityOptions"],
    canUpdate: data.canUpdate === true,
  };
}

export async function updateMobileTicket(input: {
  tenantId: string;
  ticketId: string;
  subject: string;
  description: string;
}): Promise<void> {
  await invokeNextDesk<unknown>("ticket-operations", {
    type: "updateTicket",
    tenantId: input.tenantId,
    ticketId: input.ticketId,
    subject: input.subject,
    description: input.description,
  });
}
