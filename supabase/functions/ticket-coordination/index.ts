import { withSupabase } from "@supabase/server";
import { isUuid, json, noContent } from "../_shared/http.ts";
import { listAssignableAgents } from "../_shared/assignable-agents.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";
import {
  type Action,
  parseAction,
  rpcErrorCode,
  type SplitChild,
  timelineEventPayload,
  type VendorInput,
} from "./logic.ts";

/**
 * Ticket coordination for agents:
 *  - overview: child tickets, parent, vendor cases, vendors and the data of
 *    the ticket timeline (events, comment metadata, SLA columns),
 *  - splitOptions / assignableAgents / split: «Ticket-Aufteilung» into child
 *    tickets for other departments, teams or people,
 *  - openVendorCase / recordVendorUpdate / closeVendorCase: «Lieferantenfälle»,
 *  - listVendors / saveVendor: vendor list of the tenant (automation.manage).
 *
 * The ticket is read with the caller's client (RLS: can_read_ticket); writes
 * run through service-role RPCs only after the caller's own permissions
 * (has_ticket_permission, can_access_ticket_team) have been checked.
 */

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 128 * 1024;
const TICKET_FEATURE = "ticketing.detail";
const TICKET_COLUMNS =
  "id, tenant_id, department_id, ticket_number, subject, status_id, requester_id, affected_user_id, assigned_agent_id, assigned_team_id, parent_ticket_id, merged_into_ticket_id, created_at, first_responded_at, response_due_at, resolution_due_at, resolved_at, closed_at, status_changed_at, waiting_since";

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

type TicketRow = {
  id: string;
  tenant_id: string;
  department_id: string;
  ticket_number: string;
  subject: string;
  status_id: string;
  requester_id: string;
  affected_user_id: string | null;
  assigned_agent_id: string | null;
  assigned_team_id: string | null;
  parent_ticket_id: string | null;
  merged_into_ticket_id: string | null;
  created_at: string;
  first_responded_at: string | null;
  response_due_at: string | null;
  resolution_due_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  status_changed_at: string | null;
  waiting_since: string | null;
};

async function readBody(request: Request): Promise<unknown> {
  const body = await request.text().catch(() => null);
  if (
    body === null ||
    new TextEncoder().encode(body).length > MAX_REQUEST_BYTES
  ) {
    throw new HttpError(413, "payload_too_large");
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function requireTenantAccess(
  admin: Client,
  tenantId: string,
  actorId: string,
): Promise<void> {
  const [{ data: membership, error }, features] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId)
      .eq("status", "active")
      .maybeSingle(),
    resolveTenantFeatureStates(admin, tenantId, [TICKET_FEATURE]),
  ]);
  if (error) throw new HttpError(500, "authorization_check_failed");
  if (!membership) throw new HttpError(403, "tenant_membership_required");
  if (!features) throw new HttpError(503, "tenant_feature_lookup_failed");
  if (features[TICKET_FEATURE] !== true) {
    throw new HttpError(403, "ticket_feature_disabled");
  }
}

async function ticketPermission(
  client: Client,
  tenantId: string,
  departmentId: string,
  code: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("has_ticket_permission", {
    p_tenant_id: tenantId,
    p_department_id: departmentId,
    p_permission_code: code,
  });
  if (error) throw new HttpError(500, "authorization_check_failed");
  return data === true;
}

async function tenantPermission(
  client: Client,
  tenantId: string,
  code: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("has_tenant_permission", {
    p_tenant_id: tenantId,
    p_permission_code: code,
  });
  if (error) throw new HttpError(500, "authorization_check_failed");
  return data === true;
}

/** The ticket as the caller may read it (RLS), else 404. */
async function loadTicket(
  client: Client,
  tenantId: string,
  ticketId: string,
): Promise<TicketRow> {
  const { data, error } = await client
    .from("tickets")
    .select(TICKET_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw new HttpError(500, "ticket_lookup_failed");
  if (!data) throw new HttpError(404, "ticket_not_found");
  return data as TicketRow;
}

async function isStaff(client: Client, ticket: TicketRow): Promise<boolean> {
  const results = await Promise.all(
    ["ticket.update", "ticket.read.department", "ticket.read.assigned"].map(
      (code) =>
        ticketPermission(client, ticket.tenant_id, ticket.department_id, code),
    ),
  );
  return results.some(Boolean);
}

async function canUpdateTicket(
  client: Client,
  ticket: TicketRow,
): Promise<boolean> {
  const [canUpdate, team] = await Promise.all([
    ticketPermission(
      client,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.update",
    ),
    client.rpc("can_access_ticket_team", { p_ticket_id: ticket.id }),
  ]);
  if (team.error) throw new HttpError(500, "authorization_check_failed");
  return canUpdate && team.data === true;
}

async function requireUpdate(client: Client, ticket: TicketRow) {
  if (!(await canUpdateTicket(client, ticket))) {
    throw new HttpError(403, "ticket_update_denied");
  }
}

async function overview(
  request: Request,
  client: Client,
  admin: Client,
  ticket: TicketRow,
): Promise<Response> {
  if (!(await isStaff(client, ticket))) {
    throw new HttpError(403, "ticket_coordination_denied");
  }
  const [
    statuses,
    children,
    parent,
    cases,
    vendors,
    events,
    comments,
    departments,
    canUpdate,
    canManageVendors,
  ] = await Promise.all([
    admin
      .from("ticket_statuses")
      .select("id, key, label, is_closed, sort_order")
      .eq("tenant_id", ticket.tenant_id)
      .order("sort_order"),
    admin
      .from("tickets")
      .select(
        "id, ticket_number, subject, status_id, department_id, assigned_agent_id, created_at, resolved_at, closed_at",
      )
      .is("deleted_at", null)
      .eq("tenant_id", ticket.tenant_id)
      .eq("parent_ticket_id", ticket.id)
      .is("merged_into_ticket_id", null)
      .order("created_at")
      .limit(50),
    ticket.parent_ticket_id
      ? admin
        .from("tickets")
        .select("id, ticket_number, subject, status_id")
        .is("deleted_at", null)
        .eq("tenant_id", ticket.tenant_id)
        .eq("id", ticket.parent_ticket_id)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from("ticket_vendor_cases")
      .select(
        "id, vendor_id, external_case_number, opened_at, last_vendor_update_at, reminder_sent_at, closed_at, note",
      )
      .eq("tenant_id", ticket.tenant_id)
      .eq("ticket_id", ticket.id)
      .order("opened_at"),
    admin
      .from("ticket_vendors")
      .select(
        "id, name, contact_email, contact_phone, reminder_after_hours, active",
      )
      .eq("tenant_id", ticket.tenant_id)
      .order("name")
      .limit(500),
    client
      .from("ticket_events")
      .select("id, event_type, payload, created_at")
      .eq("ticket_id", ticket.id)
      .order("created_at")
      .limit(500),
    client
      .from("ticket_comments")
      .select("id, author_id, visibility, channel, requester_contact_id, created_at")
      .eq("ticket_id", ticket.id)
      .order("created_at")
      .limit(1000),
    admin
      .from("departments")
      .select("id, name")
      .eq("tenant_id", ticket.tenant_id),
    canUpdateTicket(client, ticket),
    tenantPermission(client, ticket.tenant_id, "automation.manage"),
  ]);
  if (
    statuses.error ||
    children.error ||
    parent.error ||
    cases.error ||
    vendors.error ||
    events.error ||
    comments.error ||
    departments.error
  ) {
    throw new HttpError(500, "ticket_coordination_load_failed");
  }

  const statusById = new Map<string, Row>(
    ((statuses.data ?? []) as Row[]).map((row) => [String(row.id), row]),
  );
  const departmentNames = new Map<string, string>(
    ((departments.data ?? []) as Row[]).map((
      row,
    ) => [String(row.id), String(row.name ?? "")]),
  );
  const childRows = (children.data ?? []) as Row[];
  const relatedIds = [
    ...childRows.map((row) => String(row.id)),
    ...(parent.data ? [String((parent.data as Row).id)] : []),
  ];
  const agentIds = [
    ...new Set(
      childRows
        .map((row) => row.assigned_agent_id)
        .filter((id): id is string => isUuid(id)),
    ),
  ];
  const [readable, agents] = await Promise.all([
    relatedIds.length
      ? client.from("tickets").select("id").in("id", relatedIds)
      : Promise.resolve({ data: [], error: null }),
    agentIds.length
      ? admin.from("user_profiles").select("id, display_name").in(
        "id",
        agentIds,
      )
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (readable.error || agents.error) {
    throw new HttpError(500, "ticket_coordination_load_failed");
  }
  const readableIds = new Set(
    ((readable.data ?? []) as Row[]).map((row) => String(row.id)),
  );
  const agentNames = new Map<string, string>(
    ((agents.data ?? []) as Row[]).map((row) => [
      String(row.id),
      text(row.display_name)?.trim() || "nextDesk Benutzer",
    ]),
  );
  const vendorRows = (vendors.data ?? []) as Row[];
  const vendorById = new Map<string, Row>(
    vendorRows.map((row) => [String(row.id), row]),
  );
  const status = statusById.get(ticket.status_id);

  return json(request, {
    data: {
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticket_number,
        statusKey: text(status?.key),
        isClosed: status?.is_closed === true,
        createdAt: ticket.created_at,
        firstRespondedAt: ticket.first_responded_at,
        responseDueAt: ticket.response_due_at,
        resolutionDueAt: ticket.resolution_due_at,
        resolvedAt: ticket.resolved_at,
        closedAt: ticket.closed_at,
        statusChangedAt: ticket.status_changed_at,
        waitingSince: ticket.waiting_since,
      },
      parent: parent.data
        ? (() => {
          const row = parent.data as Row;
          const parentStatus = statusById.get(String(row.status_id));
          const canRead = readableIds.has(String(row.id));
          return {
            id: String(row.id),
            ticketNumber: String(row.ticket_number),
            subject: canRead ? text(row.subject) : null,
            statusLabel: text(parentStatus?.label),
            readable: canRead,
          };
        })()
        : null,
      children: childRows.map((row) => {
        const childStatus = statusById.get(String(row.status_id));
        const canRead = readableIds.has(String(row.id));
        return {
          id: String(row.id),
          ticketNumber: String(row.ticket_number),
          subject: canRead ? text(row.subject) : null,
          statusKey: text(childStatus?.key),
          statusLabel: text(childStatus?.label) ?? "Unbekannt",
          isClosed: childStatus?.is_closed === true,
          departmentName: departmentNames.get(String(row.department_id)) ??
            null,
          assigneeName: isUuid(row.assigned_agent_id)
            ? agentNames.get(row.assigned_agent_id) ?? null
            : null,
          createdAt: text(row.created_at),
          resolvedAt: text(row.resolved_at),
          closedAt: text(row.closed_at),
          readable: canRead,
        };
      }),
      vendorCases: ((cases.data ?? []) as Row[]).map((row) => {
        const vendor = vendorById.get(String(row.vendor_id));
        return {
          id: String(row.id),
          vendorId: String(row.vendor_id),
          vendorName: text(vendor?.name) ?? "Drittanbieter",
          contactEmail: text(vendor?.contact_email),
          contactPhone: text(vendor?.contact_phone),
          reminderAfterHours: typeof vendor?.reminder_after_hours === "number"
            ? vendor.reminder_after_hours
            : 48,
          externalCaseNumber: text(row.external_case_number),
          openedAt: text(row.opened_at),
          lastVendorUpdateAt: text(row.last_vendor_update_at),
          reminderSentAt: text(row.reminder_sent_at),
          closedAt: text(row.closed_at),
          note: text(row.note),
        };
      }),
      vendors: vendorRows
        .filter((row) => row.active === true)
        .map((row) => ({
          id: String(row.id),
          name: String(row.name),
          contactEmail: text(row.contact_email),
          contactPhone: text(row.contact_phone),
          reminderAfterHours: Number(row.reminder_after_hours ?? 48),
        })),
      events: ((events.data ?? []) as Row[]).map((row) => ({
        id: String(row.id),
        type: String(row.event_type),
        createdAt: String(row.created_at),
        payload: timelineEventPayload(row.payload),
      })),
      comments: ((comments.data ?? []) as Row[]).map((row) => ({
        id: String(row.id),
        visibility: row.visibility === "internal" ? "internal" : "external",
        createdAt: String(row.created_at),
        channel: text(row.channel),
        fromRequester: isUuid(row.requester_contact_id) ||
          row.author_id === ticket.requester_id ||
          (ticket.affected_user_id !== null &&
            row.author_id === ticket.affected_user_id),
      })),
      statuses: ((statuses.data ?? []) as Row[]).map((row) => ({
        key: String(row.key),
        label: String(row.label),
        isClosed: row.is_closed === true,
      })),
      permissions: {
        canSplit: canUpdate && status?.is_closed !== true &&
          ticket.merged_into_ticket_id === null,
        canManageVendorCases: canUpdate,
        canManageVendors,
      },
    },
  });
}

async function splitOptions(
  request: Request,
  client: Client,
  admin: Client,
  ticket: TicketRow,
): Promise<Response> {
  await requireUpdate(client, ticket);
  const [departments, teams] = await Promise.all([
    admin
      .from("departments")
      .select("id, name")
      .eq("tenant_id", ticket.tenant_id)
      .eq("active", true)
      .order("name")
      .limit(100),
    admin
      .from("teams")
      .select("id, name, department_id")
      .eq("tenant_id", ticket.tenant_id)
      .eq("active", true)
      .order("name")
      .limit(500),
  ]);
  if (departments.error || teams.error) {
    throw new HttpError(500, "ticket_split_options_failed");
  }
  const departmentRows = (departments.data ?? []) as Row[];
  const assignable = await Promise.all(
    departmentRows.map((row) =>
      ticketPermission(
        client,
        ticket.tenant_id,
        String(row.id),
        "ticket.assign",
      )
    ),
  );
  return json(request, {
    data: {
      departments: departmentRows.map((row, index) => ({
        id: String(row.id),
        name: String(row.name),
        canAssign: assignable[index],
      })),
      teams: ((teams.data ?? []) as Row[]).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        departmentId: String(row.department_id),
      })),
    },
  });
}

async function requireTeam(
  admin: Client,
  tenantId: string,
  departmentId: string,
  teamId: string,
) {
  const { data, error } = await admin
    .from("teams")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("department_id", departmentId)
    .eq("id", teamId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new HttpError(500, "ticket_split_check_failed");
  if (!data) throw new HttpError(422, "ticket_split_team_invalid");
}

async function assignableAgents(
  request: Request,
  client: Client,
  admin: Client,
  ticket: TicketRow,
  departmentId: string,
  teamId: string | null,
): Promise<Response> {
  await requireUpdate(client, ticket);
  if (
    !(await ticketPermission(
      client,
      ticket.tenant_id,
      departmentId,
      "ticket.assign",
    ))
  ) {
    throw new HttpError(403, "ticket_assign_denied");
  }
  if (teamId) await requireTeam(admin, ticket.tenant_id, departmentId, teamId);
  const result = await listAssignableAgents(
    admin,
    ticket.tenant_id,
    departmentId,
    teamId,
  );
  if (result.error) throw new HttpError(500, "ticket_agents_lookup_failed");
  return json(request, { data: { agents: result.agents } });
}

async function validateSplitChildren(
  client: Client,
  admin: Client,
  tenantId: string,
  children: SplitChild[],
) {
  const departmentIds = [...new Set(children.map((child) => child.departmentId))];
  const { data: departments, error } = await admin
    .from("departments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .in("id", departmentIds);
  if (error) throw new HttpError(500, "ticket_split_check_failed");
  const active = new Set(((departments ?? []) as Row[]).map((row) => String(row.id)));
  const assignCache = new Map<string, boolean>();
  for (const child of children) {
    if (!active.has(child.departmentId)) {
      throw new HttpError(422, "ticket_split_department_invalid");
    }
    if (!child.teamId && !child.agentId) continue;
    let canAssign = assignCache.get(child.departmentId);
    if (canAssign === undefined) {
      canAssign = await ticketPermission(
        client,
        tenantId,
        child.departmentId,
        "ticket.assign",
      );
      assignCache.set(child.departmentId, canAssign);
    }
    if (!canAssign) throw new HttpError(403, "ticket_assign_denied");
    if (child.teamId) {
      await requireTeam(admin, tenantId, child.departmentId, child.teamId);
    }
    if (child.agentId) {
      const result = await listAssignableAgents(
        admin,
        tenantId,
        child.departmentId,
        child.teamId,
      );
      if (result.error) throw new HttpError(500, "ticket_agents_lookup_failed");
      if (!result.agents.some((agent) => agent.id === child.agentId)) {
        throw new HttpError(422, "assigned_agent_invalid");
      }
    }
  }
}

async function split(
  request: Request,
  client: Client,
  admin: Client,
  actorId: string,
  ticket: TicketRow,
  children: SplitChild[],
): Promise<Response> {
  await requireUpdate(client, ticket);
  await validateSplitChildren(client, admin, ticket.tenant_id, children);
  const { data, error } = await admin
    .rpc("ticket_split_create_children", {
      p_tenant_id: ticket.tenant_id,
      p_parent_ticket_id: ticket.id,
      p_actor_id: actorId,
      p_children: children,
    })
    // Lets the push trigger recognise the acting person behind service writes.
    .setHeader("x-nextdesk-actor-id", actorId);
  if (error) {
    const mapped = rpcErrorCode(error, "ticket_split_failed");
    if (mapped.status === 500) console.error("ticket_split_failed", error.code);
    throw new HttpError(mapped.status, mapped.code);
  }
  const created = (Array.isArray(data) ? data : []) as Row[];
  await admin.from("audit_logs").insert({
    tenant_id: ticket.tenant_id,
    actor_id: actorId,
    action: "ticket.split",
    entity_type: "ticket",
    entity_id: ticket.id,
    severity: "info",
    metadata: {
      childTicketIds: created.map((row) => row.id),
      childCount: created.length,
    },
  });
  return json(
    request,
    {
      data: {
        children: created.map((row) => ({
          id: String(row.id),
          ticketNumber: String(row.ticketNumber),
        })),
      },
    },
    201,
  );
}

async function vendorCaseAction(
  request: Request,
  client: Client,
  admin: Client,
  actorId: string,
  ticket: TicketRow,
  action: Extract<
    Action,
    { type: "openVendorCase" | "recordVendorUpdate" | "closeVendorCase" }
  >,
): Promise<Response> {
  await requireUpdate(client, ticket);
  const call = action.type === "openVendorCase"
    ? admin.rpc("ticket_vendor_case_open", {
      p_tenant_id: ticket.tenant_id,
      p_ticket_id: ticket.id,
      p_vendor_id: action.vendorId,
      p_actor_id: actorId,
      p_external_case_number: action.externalCaseNumber,
      p_note: action.note,
    })
    : admin.rpc(
      action.type === "recordVendorUpdate"
        ? "ticket_vendor_case_record_update"
        : "ticket_vendor_case_close",
      {
        p_tenant_id: ticket.tenant_id,
        p_ticket_id: ticket.id,
        p_case_id: action.caseId,
        p_actor_id: actorId,
        p_note: action.note,
      },
    );
  const { data, error } = await call.setHeader("x-nextdesk-actor-id", actorId);
  if (error) {
    const mapped = rpcErrorCode(error, "vendor_case_failed");
    if (mapped.status === 500) console.error("vendor_case_failed", error.code);
    throw new HttpError(
      mapped.status,
      mapped.code === "not_found" ? "vendor_case_not_found" : mapped.code,
    );
  }
  return json(
    request,
    { data: (data ?? {}) as Row },
    action.type === "openVendorCase" ? 201 : 200,
  );
}

async function requireVendorManager(client: Client, tenantId: string) {
  if (!(await tenantPermission(client, tenantId, "automation.manage"))) {
    throw new HttpError(403, "vendor_manage_denied");
  }
}

async function listVendors(
  request: Request,
  client: Client,
  admin: Client,
  tenantId: string,
): Promise<Response> {
  await requireVendorManager(client, tenantId);
  const { data, error } = await admin
    .from("ticket_vendors")
    .select(
      "id, name, contact_email, contact_phone, reminder_after_hours, active, updated_at",
    )
    .eq("tenant_id", tenantId)
    .order("name")
    .limit(500);
  if (error) throw new HttpError(500, "vendor_list_failed");
  return json(request, {
    data: {
      vendors: ((data ?? []) as Row[]).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        contactEmail: text(row.contact_email),
        contactPhone: text(row.contact_phone),
        reminderAfterHours: Number(row.reminder_after_hours ?? 48),
        active: row.active === true,
        updatedAt: text(row.updated_at),
      })),
    },
  });
}

async function saveVendor(
  request: Request,
  client: Client,
  admin: Client,
  actorId: string,
  tenantId: string,
  vendor: VendorInput,
): Promise<Response> {
  await requireVendorManager(client, tenantId);
  const values = {
    name: vendor.name,
    contact_email: vendor.contactEmail,
    contact_phone: vendor.contactPhone,
    reminder_after_hours: vendor.reminderAfterHours,
    active: vendor.active,
  };
  const result = vendor.vendorId
    ? await admin
      .from("ticket_vendors")
      .update(values)
      .eq("tenant_id", tenantId)
      .eq("id", vendor.vendorId)
      .select("id")
      .maybeSingle()
    : await admin
      .from("ticket_vendors")
      .insert({ ...values, tenant_id: tenantId, created_by: actorId })
      .select("id")
      .single();
  if (result.error) {
    if (result.error.code === "23505") {
      throw new HttpError(409, "vendor_name_exists");
    }
    if (result.error.code === "23514") {
      throw new HttpError(422, "invalid_request");
    }
    throw new HttpError(500, "vendor_save_failed");
  }
  if (!result.data) throw new HttpError(404, "vendor_not_found");
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: vendor.vendorId ? "ticket.vendor.updated" : "ticket.vendor.created",
    entity_type: "ticket_vendor",
    entity_id: result.data.id,
    severity: "info",
    metadata: { name: vendor.name, active: vendor.active },
  });
  return json(
    request,
    { data: { vendorId: String(result.data.id) } },
    vendor.vendorId ? 200 : 201,
  );
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") {
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      }
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) {
        return json(request, { error: { code: "unauthorized" } }, 401);
      }
      const action = parseAction(await readBody(request));
      if (!action) {
        return json(request, { error: { code: "invalid_request" } }, 422);
      }
      const client = context.supabase;
      const admin = context.supabaseAdmin;
      await requireTenantAccess(admin, action.tenantId, actorId);

      if (action.type === "listVendors") {
        return await listVendors(request, client, admin, action.tenantId);
      }
      if (action.type === "saveVendor") {
        return await saveVendor(
          request,
          client,
          admin,
          actorId,
          action.tenantId,
          action.vendor,
        );
      }
      const ticket = await loadTicket(client, action.tenantId, action.ticketId);
      switch (action.type) {
        case "overview":
          return await overview(request, client, admin, ticket);
        case "splitOptions":
          return await splitOptions(request, client, admin, ticket);
        case "assignableAgents":
          return await assignableAgents(
            request,
            client,
            admin,
            ticket,
            action.departmentId,
            action.teamId,
          );
        case "split":
          return await split(
            request,
            client,
            admin,
            actorId,
            ticket,
            action.children,
          );
        case "openVendorCase":
        case "recordVendorUpdate":
        case "closeVendorCase":
          return await vendorCaseAction(
            request,
            client,
            admin,
            actorId,
            ticket,
            action,
          );
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return json(request, { error: { code: error.code } }, error.status);
      }
      console.error("ticket_coordination_failed", error);
      return json(request, { error: { code: "internal_error" } }, 500);
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};
