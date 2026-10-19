import {
  invokeNextDesk,
  loadCurrentTenant,
  requireNextDesk,
  type MobileTenant,
} from "@/lib/nextdesk-client";
import {
  getSelectedTenantId,
  loadOfflineTicketListCache,
  saveOfflineTicketListCache,
} from "@/lib/mobile-private-state";

export type MobileTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assignedToCurrentUser: boolean;
  resolved: boolean;
  /** Ticket ohne zugewiesene Agentin bzw. zugewiesenen Agenten (wie im Web). */
  unassigned: boolean;
  requesterId: string;
};

type Department = { id: string; key: string; name: string; kind: string };
type Priority = { key: string; label: string; sort_order: number };
export type MobileTicketCategory = {
  active: boolean;
  id: string;
  name: string;
  parentId: string | null;
};
export type TicketRequester = {
  id: string;
  displayName: string;
  department?: string;
  email?: string;
  offering?: string;
  phone?: string;
};
export type TicketCommentVisibility = "internal" | "external";
export type MobileTicketComment = {
  id: string;
  authorId: string;
  authorKind: "agent" | "customer" | "internal";
  authorName: string;
  body: string;
  createdAt: string;
  visibility: TicketCommentVisibility;
  channel?: "portal" | "email";
  emailDelivery?: "pending" | "sent" | "failed" | null;
};

export type MobileTicketDraft = {
  body: string;
  updatedAt: string;
  visibility: TicketCommentVisibility;
};

export type TicketFormOptions = {
  departments: Department[];
  priorities: Priority[];
  currentRequester: TicketRequester;
};

export type MobileTicketDetail = {
  categoryId: string | null;
  categoryOptions: MobileTicketCategory[];
  departmentId: string;
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  requesterId: string | null;
  requesterName: string | null;
  requesterContact: TicketRequester | null;
  resolvedAt: string | null;
  subcategoryId: string | null;
  statusId: string;
  priorityId: string;
  statusOptions: {
    id: string;
    key: string;
    label: string;
    is_closed: boolean;
  }[];
  priorityOptions: { id: string; key: string; label: string }[];
  comments: MobileTicketComment[];
  canUpdate: boolean;
  canClose: boolean;
  canWriteInternalNotes: boolean;
  canCommentExternal: boolean;
  drafts: MobileTicketDraft[];
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

function ticketRequester(value: unknown): TicketRequester | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as {
    department?: unknown;
    departmentName?: unknown;
    id?: unknown;
    displayName?: unknown;
    email?: unknown;
    offering?: unknown;
    offeringName?: unknown;
    phone?: unknown;
    phoneNumber?: unknown;
  };
  if (
    typeof record.id !== "string" ||
    typeof record.displayName !== "string" ||
    !record.id ||
    !record.displayName.trim()
  ) {
    return null;
  }
  return {
    id: record.id,
    displayName: record.displayName.trim(),
    ...(typeof record.department === "string" && record.department.trim()
      ? { department: record.department.trim() }
      : typeof record.departmentName === "string" &&
          record.departmentName.trim()
        ? { department: record.departmentName.trim() }
        : {}),
    ...(typeof record.email === "string" && record.email.trim()
      ? { email: record.email.trim() }
      : {}),
    ...(typeof record.offering === "string" && record.offering.trim()
      ? { offering: record.offering.trim() }
      : typeof record.offeringName === "string" && record.offeringName.trim()
        ? { offering: record.offeringName.trim() }
        : {}),
    ...(typeof record.phone === "string" && record.phone.trim()
      ? { phone: record.phone.trim() }
      : typeof record.phoneNumber === "string" && record.phoneNumber.trim()
        ? { phone: record.phoneNumber.trim() }
        : {}),
  };
}

function ticketComment(value: unknown): MobileTicketComment | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.author_id !== "string" ||
    typeof record.body !== "string" ||
    typeof record.created_at !== "string" ||
    (record.authorKind !== "agent" &&
      record.authorKind !== "customer" &&
      record.authorKind !== "internal") ||
    (record.visibility !== "internal" && record.visibility !== "external")
  ) {
    return null;
  }
  return {
    id: record.id,
    authorId: record.author_id,
    authorKind: record.authorKind,
    authorName:
      typeof record.authorName === "string" && record.authorName.trim()
        ? record.authorName.trim()
        : "nextDesk Benutzer",
    body: record.body,
    createdAt: record.created_at,
    visibility: record.visibility,
    ...(record.channel === "portal" || record.channel === "email"
      ? { channel: record.channel }
      : {}),
    ...(record.emailDelivery === "pending" ||
    record.emailDelivery === "sent" ||
    record.emailDelivery === "failed" ||
    record.emailDelivery === null
      ? { emailDelivery: record.emailDelivery }
      : {}),
  };
}

function ticketDraft(value: unknown): MobileTicketDraft | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.body !== "string" ||
    typeof record.updated_at !== "string" ||
    (record.visibility !== "internal" && record.visibility !== "external")
  ) {
    return null;
  }
  return {
    body: record.body,
    updatedAt: record.updated_at,
    visibility: record.visibility,
  };
}

function ticketCategory(value: unknown): MobileTicketCategory | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    !record.id ||
    typeof record.name !== "string" ||
    !record.name.trim() ||
    (record.parent_id !== null && typeof record.parent_id !== "string")
  ) {
    return null;
  }
  return {
    // Older server revisions omitted this property. Treat that response as an
    // active category so an already installed app remains compatible during a
    // rolling Edge-Function deployment.
    active: record.active !== false,
    id: record.id,
    name: record.name.trim(),
    parentId: typeof record.parent_id === "string" ? record.parent_id : null,
  };
}

export async function loadMobileDashboard(input: {
  allowOfflineCache: boolean;
}): Promise<{
  cachedAt: string | null;
  isOfflineCache: boolean;
  tenant: MobileTenant;
  tickets: MobileTicket[];
  userId: string;
}> {
  const client = requireNextDesk();
  const {
    data: { session },
  } = await client.auth.getSession();
  const user = session?.user;
  if (
    !user ||
    (typeof session.expires_at === "number" &&
      session.expires_at * 1_000 <= Date.now())
  ) {
    throw new Error("Die Anmeldung ist abgelaufen.");
  }

  const {
    data: { user: verifiedUser },
    error: userError,
  } = await client.auth.getUser();
  if (userError && !input.allowOfflineCache) {
    throw new Error("Die Anmeldung konnte nicht bestätigt werden.");
  }
  const activeUser = !userError && verifiedUser ? verifiedUser : user;

  try {
    const tenant = await loadCurrentTenant();
    const [ticketsResult, statusesResult, prioritiesResult] = await Promise.all(
      [
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
      ],
    );
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
        ticket.assigned_agent_id === activeUser.id ||
        ticket.requester_id === activeUser.id,
      resolved: Boolean(statusById.get(ticket.status_id)?.is_closed),
      unassigned: !ticket.assigned_agent_id,
      requesterId: ticket.requester_id,
    }));
    try {
      await saveOfflineTicketListCache({
        userId: activeUser.id,
        tenant,
        tickets: tickets.map(
          ({
            assignedToCurrentUser,
            id,
            priority,
            resolved,
            status,
            subject,
            ticketNumber,
            unassigned,
          }) => ({
            assignedToCurrentUser,
            id,
            priority,
            resolved,
            status,
            subject,
            ticketNumber,
            unassigned,
          }),
        ),
      });
    } catch {
      // A device cache is optional; a current RLS-authorized server result wins.
    }
    return {
      cachedAt: null,
      isOfflineCache: false,
      tenant,
      tickets,
      userId: activeUser.id,
    };
  } catch (networkError) {
    if (!input.allowOfflineCache) throw networkError;
    const tenantId = await getSelectedTenantId(activeUser.id);
    if (tenantId) {
      const cache = await loadOfflineTicketListCache({
        tenantId,
        userId: activeUser.id,
      });
      if (cache) {
        return {
          cachedAt: cache.cachedAt,
          isOfflineCache: true,
          tenant: cache.tenant,
          tickets: cache.tickets.map((ticket) => ({
            ...ticket,
            description: "",
            requesterId: "",
            unassigned: ticket.unassigned ?? false,
          })),
          userId: activeUser.id,
        };
      }
    }
    throw networkError;
  }
}

/**
 * Lädt einzelne Tickets per ID nach, z. B. wenn eine Kennzahl Tickets enthält,
 * die nicht unter den 50 zuletzt geänderten der Startseite sind. Die Abfrage
 * läuft wie alle Ticketabfragen über RLS und den aktiven Mandanten.
 */
export async function loadMobileTicketsByIds(
  ids: string[],
): Promise<MobileTicket[]> {
  const uniqueIds = [...new Set(ids)].slice(0, 100);
  if (uniqueIds.length === 0) return [];
  const client = requireNextDesk();
  const {
    data: { session },
  } = await client.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Die Anmeldung ist abgelaufen.");
  const tenant = await loadCurrentTenant();
  const [ticketsResult, statusesResult, prioritiesResult] = await Promise.all([
    client
      .from("tickets")
      .select(
        "id, ticket_number, subject, description, status_id, priority_id, requester_id, assigned_agent_id, created_at",
      )
      .eq("tenant_id", tenant.id)
      .in("id", uniqueIds)
      .order("updated_at", { ascending: false })
      .limit(100),
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
  return (ticketsResult.data ?? []).map((ticket) => ({
    id: ticket.id,
    ticketNumber: ticket.ticket_number,
    subject: ticket.subject,
    description: ticket.description,
    status: statusById.get(ticket.status_id)?.label ?? "Unbekannt",
    priority: priorityById.get(ticket.priority_id)?.label ?? "Ohne Priorität",
    assignedToCurrentUser:
      ticket.assigned_agent_id === userId || ticket.requester_id === userId,
    resolved: Boolean(statusById.get(ticket.status_id)?.is_closed),
    unassigned: !ticket.assigned_agent_id,
    requesterId: ticket.requester_id,
  }));
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
  const currentRequester = ticketRequester(data.currentRequester);
  if (
    !Array.isArray(data.departments) ||
    !Array.isArray(data.priorities) ||
    !currentRequester
  ) {
    throw new Error("Die Angaben für die Ticketerfassung sind unvollständig.");
  }
  return {
    departments: data.departments as Department[],
    priorities: data.priorities as Priority[],
    currentRequester,
  };
}

export async function searchTicketRequesters(
  tenantId: string,
  query: string,
): Promise<TicketRequester[]> {
  const normalizedQuery = query.trim();
  if (Array.from(normalizedQuery).length < 2) return [];

  const data = envelopeData(
    await invokeNextDesk<unknown>("ticket-actions", {
      type: "searchRequesters",
      tenantId,
      query: normalizedQuery,
    }),
  );
  if (!Array.isArray(data.requesters)) {
    throw new Error("Die anfragenden Personen konnten nicht geladen werden.");
  }
  return data.requesters.flatMap((requester) => {
    const parsed = ticketRequester(requester);
    return parsed ? [parsed] : [];
  });
}

export async function createTicketRequester(input: {
  tenantId: string;
  displayName: string;
  email?: string;
}): Promise<TicketRequester> {
  const data = envelopeData(
    await invokeNextDesk<unknown>("ticket-actions", {
      type: "createRequester",
      tenantId: input.tenantId,
      displayName: input.displayName.trim(),
      ...(input.email?.trim() ? { email: input.email.trim() } : {}),
    }),
  );
  const requester = ticketRequester(data);
  if (!requester) {
    throw new Error("Die anfragende Person konnte nicht angelegt werden.");
  }
  return requester;
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
  const requesterContact = ticketRequester(data.requesterContact);
  if (
    typeof record.id !== "string" ||
    typeof record.ticket_number !== "string" ||
    typeof record.subject !== "string" ||
    typeof record.description !== "string" ||
    typeof record.department_id !== "string" ||
    typeof record.status_id !== "string" ||
    typeof record.priority_id !== "string" ||
    (record.category_id !== null && typeof record.category_id !== "string") ||
    (record.subcategory_id !== null &&
      typeof record.subcategory_id !== "string") ||
    !Array.isArray(data.statuses) ||
    !Array.isArray(data.priorities) ||
    !Array.isArray(data.categories) ||
    !Array.isArray(data.comments) ||
    !Array.isArray(data.drafts)
  ) {
    throw new Error("Die Ticketdetails sind unvollständig.");
  }
  const comments = data.comments.map(ticketComment);
  const drafts = data.drafts.map(ticketDraft);
  const categoryOptions = data.categories.map(ticketCategory);
  if (
    !comments.every(
      (comment): comment is MobileTicketComment => comment !== null,
    ) ||
    !drafts.every((draft): draft is MobileTicketDraft => draft !== null) ||
    !categoryOptions.every(
      (category): category is MobileTicketCategory => category !== null,
    )
  ) {
    throw new Error(
      "Die Ticketkommunikation oder Entwürfe sind unvollständig.",
    );
  }
  return {
    categoryId:
      typeof record.category_id === "string" ? record.category_id : null,
    categoryOptions,
    departmentId: record.department_id,
    id: record.id,
    ticketNumber: record.ticket_number,
    subject: record.subject,
    description: record.description,
    requesterId:
      typeof record.requester_id === "string" ? record.requester_id : null,
    requesterName: requesterContact?.displayName ?? null,
    requesterContact,
    resolvedAt:
      typeof record.resolved_at === "string" ? record.resolved_at : null,
    subcategoryId:
      typeof record.subcategory_id === "string" ? record.subcategory_id : null,
    statusId: record.status_id,
    priorityId: record.priority_id,
    statusOptions: data.statuses as MobileTicketDetail["statusOptions"],
    priorityOptions: data.priorities as MobileTicketDetail["priorityOptions"],
    comments,
    drafts,
    canUpdate: data.canUpdate === true,
    canClose: data.canClose === true,
    canWriteInternalNotes: data.canWriteInternalNotes === true,
    canCommentExternal: data.canCommentExternal === true,
  };
}

export async function updateMobileTicket(input: {
  tenantId: string;
  ticketId: string;
  subject: string;
  description: string;
  confirmClose?: boolean;
  statusKey?: string;
  priorityKey?: string;
  requesterContactId?: string;
}): Promise<void> {
  await invokeNextDesk<unknown>("ticket-operations", {
    type: "updateTicket",
    tenantId: input.tenantId,
    ticketId: input.ticketId,
    subject: input.subject,
    description: input.description,
    ...(input.confirmClose === true ? { confirmClose: true } : {}),
    ...(input.statusKey ? { statusKey: input.statusKey } : {}),
    ...(input.priorityKey ? { priorityKey: input.priorityKey } : {}),
    ...(input.requesterContactId
      ? { requesterContactId: input.requesterContactId }
      : {}),
  });
}

export async function updateMobileTicketCategory(input: {
  categoryId: string | null;
  subcategoryId: string | null;
  tenantId: string;
  ticketId: string;
}): Promise<void> {
  await invokeNextDesk<unknown>("ticket-category-selection", {
    categoryId: input.categoryId,
    subcategoryId: input.subcategoryId,
    tenantId: input.tenantId,
    ticketId: input.ticketId,
  });
}

export async function addMobileTicketComment(input: {
  tenantId: string;
  ticketId: string;
  body: string;
  visibility: TicketCommentVisibility;
}): Promise<void> {
  const body = input.body.trim();
  if (!body || Array.from(body).length > 50_000 || body.includes("\u0000")) {
    throw new Error(
      "Die Nachricht muss zwischen 1 und 50'000 Zeichen lang sein.",
    );
  }
  await invokeNextDesk<unknown>("ticket-operations", {
    type: "addComment",
    tenantId: input.tenantId,
    ticketId: input.ticketId,
    body,
    visibility: input.visibility,
  });
}

export async function saveMobileTicketDraft(input: {
  tenantId: string;
  ticketId: string;
  body: string;
  visibility: TicketCommentVisibility;
}): Promise<void> {
  await invokeNextDesk<unknown>("ticket-operations", {
    type: "saveDraft",
    tenantId: input.tenantId,
    ticketId: input.ticketId,
    body: input.body.slice(0, 50_000),
    visibility: input.visibility,
  });
}
