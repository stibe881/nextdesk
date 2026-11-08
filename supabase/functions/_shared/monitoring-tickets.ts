// Ticket helpers for monitoring automations (certificate/domain expiry and
// backup monitoring). Tickets and comments are authored by the global
// monitoring service identity that the PRTG webhook (0220) also uses.

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

const SERVICE_EMAIL = "monitoring-service@app.nextdesk.ch";
const SERVICE_NAME = "nextDesk Monitoring";

export type MonitoringSource = "certificate" | "domain" | "backup";

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** Returns the monitoring service identity, creating it on first use. */
export async function ensureMonitoringServiceIdentity(
  admin: Admin,
): Promise<string> {
  const existing = await admin
    .from("monitoring_service_identity")
    .select("user_id")
    .eq("singleton", true)
    .maybeSingle();
  if (existing.error) throw new Error("service_identity_lookup_failed");
  let userId = asString(existing.data?.user_id);
  if (userId) return userId;

  const created = await admin.auth.admin.createUser({
    email: SERVICE_EMAIL,
    email_confirm: true,
    password: `N!m${crypto.randomUUID()}A`,
    app_metadata: { nextdesk_service_identity: "monitoring" },
    user_metadata: { display_name: SERVICE_NAME },
  });
  userId = asString(created?.data?.user?.id);
  if (!userId) {
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = Array.isArray(users?.data?.users)
      ? users.data.users.find(
          (user: Row) =>
            typeof user?.email === "string" &&
            user.email.toLowerCase() === SERVICE_EMAIL,
        )
      : null;
    userId = asString(found?.id);
  }
  if (!userId) throw new Error("service_identity_create_failed");
  const profile = await admin
    .from("user_profiles")
    .upsert({ id: userId, display_name: SERVICE_NAME }, { onConflict: "id" });
  if (profile.error) throw new Error("service_identity_profile_failed");
  await admin
    .from("monitoring_service_identity")
    .upsert(
      { singleton: true, user_id: userId },
      { onConflict: "singleton", ignoreDuplicates: true },
    );
  const stored = await admin
    .from("monitoring_service_identity")
    .select("user_id")
    .eq("singleton", true)
    .maybeSingle();
  const storedId = asString(stored.data?.user_id);
  if (!storedId) throw new Error("service_identity_store_failed");
  return storedId;
}

async function resolvePriority(
  admin: Admin,
  tenantId: string,
  preferred: (string | null)[],
): Promise<string | null> {
  const { data, error } = await admin
    .from("ticket_priorities")
    .select("id, key")
    .eq("tenant_id", tenantId);
  if (error) return null;
  const rows = (data ?? []) as Row[];
  for (const key of preferred) {
    const found = key ? rows.find((row) => row.key === key) : null;
    if (found) return String(found.id);
  }
  return rows[0] ? String(rows[0].id) : null;
}

async function resolveDepartment(
  admin: Admin,
  tenantId: string,
  candidates: (string | null)[],
): Promise<{ id: string; key: string } | null> {
  for (const departmentId of candidates) {
    if (!departmentId) continue;
    const { data } = await admin
      .from("departments")
      .select("id, key")
      .eq("tenant_id", tenantId)
      .eq("id", departmentId)
      .eq("active", true)
      .maybeSingle();
    if (data) return { id: String(data.id), key: String(data.key) };
  }
  const { data } = await admin
    .from("departments")
    .select("id, key")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("key")
    .limit(1)
    .maybeSingle();
  return data ? { id: String(data.id), key: String(data.key) } : null;
}

export type CreateMonitoringTicket = {
  tenantId: string;
  /** Tried in order (record department, then automation default). */
  departmentIds: (string | null)[];
  /** Priority keys tried in order; the first existing one wins. */
  priorityKeys: (string | null)[];
  subject: string;
  description: string;
  assetId: string | null;
  source: MonitoringSource;
  metadata?: Record<string, unknown>;
};

export async function createMonitoringTicket(
  admin: Admin,
  input: CreateMonitoringTicket,
  serviceIdentityId: string,
): Promise<{ id: string; number: string }> {
  const tenantId = input.tenantId;
  const [department, status, priorityId] = await Promise.all([
    resolveDepartment(admin, tenantId, input.departmentIds),
    admin
      .from("ticket_statuses")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("key", "new")
      .maybeSingle(),
    resolvePriority(admin, tenantId, input.priorityKeys),
  ]);
  if (!department || status.error || !status.data || !priorityId) {
    throw new Error("ticket_defaults_unavailable");
  }
  const number = await admin.rpc("reserve_ticket_number", {
    p_tenant_id: tenantId,
    p_department_id: department.id,
    p_prefix: department.key.slice(0, 8),
  });
  if (number.error || typeof number.data !== "string") {
    throw new Error("ticket_number_failed");
  }
  const ticket = await admin
    .from("tickets")
    .insert({
      tenant_id: tenantId,
      department_id: department.id,
      ticket_number: number.data,
      subject: input.subject.slice(0, 300),
      description: input.description.slice(0, 50_000),
      status_id: status.data.id,
      priority_id: priorityId,
      requester_id: serviceIdentityId,
      source: "automation",
    })
    .select("id, ticket_number")
    .single();
  if (ticket.error || !ticket.data) throw new Error("ticket_create_failed");
  const ticketId = String(ticket.data.id);
  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: serviceIdentityId,
    event_type: "ticket.created",
    payload: { source: "monitoring", provider: input.source },
  });
  if (input.assetId) {
    await admin.from("ticket_assets").insert({
      tenant_id: tenantId,
      ticket_id: ticketId,
      asset_id: input.assetId,
      linked_by: null,
    });
  }
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: serviceIdentityId,
    action: "monitoring.ticket.created",
    entity_type: "ticket",
    entity_id: ticketId,
    severity: "info",
    metadata: {
      provider: input.source,
      ticketNumber: ticket.data.ticket_number,
      assetId: input.assetId,
      ...(input.metadata ?? {}),
    },
  });
  return { id: ticketId, number: String(ticket.data.ticket_number) };
}

export async function addMonitoringComment(
  admin: Admin,
  ticketId: string,
  authorId: string,
  body: string,
  source: MonitoringSource,
): Promise<void> {
  const comment = await admin
    .from("ticket_comments")
    .insert({
      ticket_id: ticketId,
      author_id: authorId,
      visibility: "internal",
      body: body.slice(0, 50_000),
    })
    .select("id")
    .single();
  if (comment.error) throw new Error("comment_create_failed");
  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: authorId,
    event_type: "comment.internal_added",
    payload: { source: "monitoring", provider: source },
  });
}

/** True while the ticket exists, is not closed and not resolved. */
export async function monitoringTicketOpen(
  admin: Admin,
  tenantId: string,
  ticketId: string | null,
): Promise<boolean> {
  if (!ticketId) return false;
  const { data: ticket, error } = await admin
    .from("tickets")
    .select("id, status_id, closed_at, resolved_at")
    .eq("tenant_id", tenantId)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw new Error("ticket_lookup_failed");
  if (!ticket || ticket.closed_at) return false;
  const { data: status } = await admin
    .from("ticket_statuses")
    .select("key, is_closed")
    .eq("id", ticket.status_id)
    .maybeSingle();
  return !(status?.is_closed === true || status?.key === "resolved");
}

/**
 * Raises the ticket priority to the first existing key, but never lowers it.
 * Returns true when the priority changed.
 */
export async function raiseMonitoringTicketPriority(
  admin: Admin,
  tenantId: string,
  ticketId: string,
  priorityKeys: (string | null)[],
  serviceIdentityId: string,
  source: MonitoringSource,
): Promise<boolean> {
  const [{ data: ticket }, { data: priorities }] = await Promise.all([
    admin
      .from("tickets")
      .select("id, priority_id")
      .eq("tenant_id", tenantId)
      .eq("id", ticketId)
      .maybeSingle(),
    admin
      .from("ticket_priorities")
      .select("id, key, sort_order")
      .eq("tenant_id", tenantId),
  ]);
  const rows = (priorities ?? []) as Row[];
  if (!ticket || !rows.length) return false;
  const target = priorityKeys
    .map((key) => (key ? rows.find((row) => row.key === key) : undefined))
    .find((row) => row !== undefined);
  const current = rows.find((row) => row.id === ticket.priority_id);
  if (!target || target.id === ticket.priority_id) return false;
  if (current && Number(current.sort_order) >= Number(target.sort_order)) {
    return false;
  }
  const { error } = await admin
    .from("tickets")
    .update({ priority_id: target.id })
    .eq("tenant_id", tenantId)
    .eq("id", ticketId);
  if (error) return false;
  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: serviceIdentityId,
    event_type: "ticket.updated",
    payload: {
      changedFields: ["priority"],
      source: "monitoring",
      provider: source,
      fromPriorityId: ticket.priority_id,
      toPriorityKey: target.key,
    },
  });
  return true;
}

/**
 * Sets the ticket to «Gelöst». Respects the status rule that a ticket leaves
 * «Neu» only with an assignee; returns false when it was not changed.
 */
export async function resolveMonitoringTicket(
  admin: Admin,
  tenantId: string,
  ticketId: string,
  serviceIdentityId: string,
  source: MonitoringSource,
): Promise<boolean> {
  const [{ data: ticket }, { data: resolved }] = await Promise.all([
    admin
      .from("tickets")
      .select("id, status_id, assigned_agent_id, closed_at")
      .eq("tenant_id", tenantId)
      .eq("id", ticketId)
      .maybeSingle(),
    admin
      .from("ticket_statuses")
      .select("id, key, is_closed")
      .eq("tenant_id", tenantId)
      .eq("key", "resolved")
      .maybeSingle(),
  ]);
  if (!ticket || !resolved || ticket.closed_at) return false;
  if (ticket.status_id === resolved.id) return false;
  const { data: current } = await admin
    .from("ticket_statuses")
    .select("key")
    .eq("id", ticket.status_id)
    .maybeSingle();
  if (current?.key === "new" && !ticket.assigned_agent_id) return false;
  const now = new Date().toISOString();
  const { error } = await admin
    .from("tickets")
    .update({
      status_id: resolved.id,
      closed_at: resolved.is_closed ? now : null,
      resolved_at: now,
      waiting_since: null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", ticketId);
  if (error) return false;
  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: serviceIdentityId,
    event_type: resolved.is_closed ? "ticket.closed" : "ticket.updated",
    payload: {
      changedFields: ["status"],
      source: "monitoring",
      provider: source,
      statusTransition: {
        fromStatusId: ticket.status_id,
        toStatusKey: "resolved",
        isClosed: resolved.is_closed === true,
        occurredAt: now,
      },
    },
  });
  return true;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** 32 random bytes as base64url (43 characters). */
export function generateMonitoringToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
