import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

type BillingKind = "internal" | "billable" | "goodwill";
type EscalationKind = "technical" | "organizational" | "sla";
type RelationType =
  "duplicates" | "blocks" | "blocked_by" | "relates_to" | "parent" | "child";
type DisplayRelationType = RelationType | "merged_into" | "merged_from";
type TicketModules = {
  detail: boolean;
  checklists: boolean;
  timeTracking: boolean;
};
type Action =
  | { type: "getTicket"; tenantId: string; ticketId: string }
  | { type: "recordExport"; tenantId: string; ticketId: string }
  | {
      type: "openEscalation";
      tenantId: string;
      ticketId: string;
      kind: EscalationKind;
      reason: string;
    }
  | {
      type: "resolveEscalation";
      tenantId: string;
      ticketId: string;
      escalationId: string;
    }
  | {
      type: "createRelation";
      tenantId: string;
      ticketId: string;
      relatedTicketId: string;
      relationType: RelationType;
    }
  | {
      type: "deleteRelation";
      tenantId: string;
      ticketId: string;
      relatedTicketId: string;
      relationType: RelationType;
    }
  | {
      type: "markMerged";
      tenantId: string;
      ticketId: string;
      primaryTicketId: string;
    }
  | {
      type: "searchMergeTargets";
      tenantId: string;
      ticketId: string;
      query: string;
    }
  | {
      type: "updateTicket";
      tenantId: string;
      ticketId: string;
      statusKey?: string;
      confirmClose?: boolean;
      priorityKey?: string;
      subject?: string;
      description?: string;
      requesterContactId?: string;
      assignedAgentId?: string | null;
      assignedTeamId?: string | null;
    }
  | {
      type: "addComment";
      tenantId: string;
      ticketId: string;
      body: string;
      visibility: "internal" | "external";
      attachmentIds: string[];
    }
  | {
      type: "saveDraft";
      tenantId: string;
      ticketId: string;
      body: string;
      visibility: "internal" | "external";
    }
  | {
      type: "toggleWatch";
      tenantId: string;
      ticketId: string;
      watching: boolean;
    }
  | {
      type: "addChecklistItem";
      tenantId: string;
      ticketId: string;
      description: string;
    }
  | {
      type: "toggleChecklistItem";
      tenantId: string;
      ticketId: string;
      itemId: string;
      completed: boolean;
    }
  | {
      type: "addTimeEntry";
      tenantId: string;
      ticketId: string;
      minutes: number;
      billingKind: BillingKind;
      note?: string;
      startedAt?: string;
    };

const originHeaders = (request: Request) => ({
  "Access-Control-Allow-Origin":
    request.headers.get("origin") === "https://app.nextdesk.ch"
      ? "https://app.nextdesk.ch"
      : "",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  Vary: "Origin",
});
const response = (
  request: Request,
  body: Record<string, unknown>,
  status = 200,
) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: originHeaders(request),
  });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const isRequesterContactId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isRelationType = (value: unknown): value is RelationType =>
  value === "duplicates" ||
  value === "blocks" ||
  value === "blocked_by" ||
  value === "relates_to" ||
  value === "parent" ||
  value === "child";
const isEscalationKind = (value: unknown): value is EscalationKind =>
  value === "technical" || value === "organizational" || value === "sla";
const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]) => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

function parseCommentAttachmentIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5) return null;
  const attachmentIds = value.map((attachmentId) =>
    isUuid(attachmentId) ? attachmentId.toLowerCase() : null,
  );
  return attachmentIds.every((attachmentId): attachmentId is string =>
    Boolean(attachmentId),
  ) && new Set(attachmentIds).size === attachmentIds.length
    ? attachmentIds
    : null;
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId) || !isUuid(value.ticketId))
    return null;
  if (value.type === "getTicket")
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
    };
  if (
    value.type === "recordExport" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId"])
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
    };
  if (
    value.type === "openEscalation" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId", "kind", "reason"]) &&
    isEscalationKind(value.kind) &&
    typeof value.reason === "string"
  ) {
    const reason = value.reason.trim();
    const reasonLength = [...reason].length;
    if (reasonLength < 3 || reasonLength > 2000 || reason.includes("\u0000"))
      return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      kind: value.kind,
      reason,
    };
  }
  if (
    value.type === "resolveEscalation" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId", "escalationId"]) &&
    isUuid(value.escalationId)
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      escalationId: value.escalationId,
    };
  if (
    (value.type === "createRelation" || value.type === "deleteRelation") &&
    isUuid(value.relatedTicketId) &&
    isRelationType(value.relationType)
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      relatedTicketId: value.relatedTicketId,
      relationType: value.relationType,
    };
  if (value.type === "markMerged" && isUuid(value.primaryTicketId))
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      primaryTicketId: value.primaryTicketId,
    };
  if (
    value.type === "searchMergeTargets" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId", "query"]) &&
    typeof value.query === "string"
  ) {
    const query = value.query.trim();
    if ([...query].length > 240 || query.includes("\u0000")) return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      query,
    };
  }
  if (
    value.type === "addComment" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "ticketId",
      "body",
      "visibility",
      "attachmentIds",
    ]) &&
    typeof value.body === "string" &&
    (value.visibility === "internal" || value.visibility === "external")
  ) {
    const attachmentIds = parseCommentAttachmentIds(value.attachmentIds);
    if (!attachmentIds) return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      body: value.body.trim(),
      visibility: value.visibility,
      attachmentIds,
    };
  }
  if (
    value.type === "saveDraft" &&
    typeof value.body === "string" &&
    value.body.length <= 50000 &&
    (value.visibility === "internal" || value.visibility === "external")
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      body: value.body,
      visibility: value.visibility,
    };
  if (value.type === "toggleWatch" && typeof value.watching === "boolean")
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      watching: value.watching,
    };
  if (
    value.type === "addChecklistItem" &&
    typeof value.description === "string"
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      description: value.description.trim(),
    };
  if (
    value.type === "toggleChecklistItem" &&
    isUuid(value.itemId) &&
    typeof value.completed === "boolean"
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      itemId: value.itemId,
      completed: value.completed,
    };
  if (
    value.type === "addTimeEntry" &&
    typeof value.minutes === "number" &&
    Number.isInteger(value.minutes) &&
    value.minutes >= 1 &&
    value.minutes <= 1440 &&
    (value.billingKind === "internal" ||
      value.billingKind === "billable" ||
      value.billingKind === "goodwill") &&
    (value.note === undefined ||
      (typeof value.note === "string" && value.note.length <= 3000)) &&
    (value.startedAt === undefined || typeof value.startedAt === "string")
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      minutes: value.minutes,
      billingKind: value.billingKind,
      note: value.note,
      startedAt: value.startedAt,
    };
  if (
    value.type === "updateTicket" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "ticketId",
      "statusKey",
      "confirmClose",
      "priorityKey",
      "subject",
      "description",
      "requesterContactId",
      "assignedAgentId",
      "assignedTeamId",
    ]) &&
    (value.confirmClose === undefined ||
      typeof value.confirmClose === "boolean") &&
    (value.requesterContactId === undefined ||
      isRequesterContactId(value.requesterContactId)) &&
    (value.assignedAgentId === undefined ||
      value.assignedAgentId === null ||
      isUuid(value.assignedAgentId)) &&
    (value.subject === undefined || typeof value.subject === "string") &&
    (value.description === undefined || typeof value.description === "string")
  ) {
    const subject =
      typeof value.subject === "string" ? value.subject.trim() : undefined;
    const description =
      typeof value.description === "string"
        ? value.description.trim()
        : undefined;
    if (
      (subject !== undefined &&
        ([...subject].length < 3 ||
          [...subject].length > 240 ||
          subject.includes("\u0000"))) ||
      (description !== undefined &&
        ([...description].length < 1 ||
          [...description].length > 10000 ||
          description.includes("\u0000")))
    )
      return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      statusKey:
        typeof value.statusKey === "string" ? value.statusKey : undefined,
      confirmClose:
        typeof value.confirmClose === "boolean"
          ? value.confirmClose
          : undefined,
      priorityKey:
        typeof value.priorityKey === "string" ? value.priorityKey : undefined,
      subject,
      description,
      requesterContactId:
        value.requesterContactId === undefined
          ? undefined
          : value.requesterContactId,
      assignedAgentId:
        value.assignedAgentId === null || isUuid(value.assignedAgentId)
          ? value.assignedAgentId
          : undefined,
      assignedTeamId:
        value.assignedTeamId === null || isUuid(value.assignedTeamId)
          ? value.assignedTeamId
          : undefined,
    };
  }
  return null;
}
async function activeMember(admin: any, userId: string, tenantId: string) {
  const { data } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data);
}
async function hasPermission(
  admin: any,
  userId: string,
  tenantId: string,
  departmentId: string,
  permission: string,
) {
  const now = new Date().toISOString();
  // Keep Function authorization aligned with public.has_ticket_permission:
  // every ticket permission requires an active department membership, even for
  // a tenant-scoped role. Service-role data access must not broaden RBAC.
  const [departmentMembership, roleAssignments] = await Promise.all([
    admin
      .from("department_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("department_id", departmentId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("user_role_assignments")
      .select(
        "department_id, roles!user_role_assignments_role_tenant_fk!inner(tenant_id, active, scope, role_permissions!inner(permission_code))",
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`),
  ]);
  if (
    departmentMembership.error ||
    roleAssignments.error ||
    !departmentMembership.data
  ) {
    return false;
  }
  return (roleAssignments.data ?? []).some((assignment: any) => {
    const role = Array.isArray(assignment.roles)
      ? assignment.roles[0]
      : assignment.roles;
    return (
      role?.tenant_id === tenantId &&
      role.active === true &&
      (role.scope === "tenant" ||
        (role.scope === "department" &&
          assignment.department_id === departmentId)) &&
      (role.role_permissions ?? []).some(
        (item: any) => item.permission_code === permission,
      )
    );
  });
}

async function hasTenantPermission(
  admin: any,
  userId: string,
  tenantId: string,
  permission: string,
) {
  const now = new Date().toISOString();
  const [membership, roleAssignments] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("user_role_assignments")
      .select(
        "roles!user_role_assignments_role_tenant_fk!inner(tenant_id, active, scope, role_permissions!inner(permission_code))",
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`),
  ]);
  if (membership.error || roleAssignments.error || !membership.data)
    return false;
  return (roleAssignments.data ?? []).some((assignment: any) => {
    const role = Array.isArray(assignment.roles)
      ? assignment.roles[0]
      : assignment.roles;
    return (
      role?.tenant_id === tenantId &&
      role.active === true &&
      role.scope === "tenant" &&
      (role.role_permissions ?? []).some(
        (item: any) => item.permission_code === permission,
      )
    );
  });
}

async function canPostExternalComment(admin: any, userId: string, ticket: any) {
  if (
    await hasPermission(
      admin,
      userId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.comment.external",
    )
  ) {
    return true;
  }
  if (ticket.requester_id !== userId) return false;
  const [canReadOwnTicket, canCommentOnOwnTicket] = await Promise.all([
    hasTenantPermission(admin, userId, ticket.tenant_id, "ticket.read.own"),
    hasTenantPermission(
      admin,
      userId,
      ticket.tenant_id,
      "ticket.comment.external.own",
    ),
  ]);
  return canReadOwnTicket && canCommentOnOwnTicket;
}

type TicketAgent = {
  id: string;
  displayName: string | null;
};

type EligibleTicketAgentIdsResult = {
  agentIds: string[];
  error: boolean;
};

async function getEligibleTicketAgentIds(
  admin: any,
  ticket: any,
): Promise<EligibleTicketAgentIdsResult> {
  const now = new Date().toISOString();
  const [
    { data: tenantMemberships, error: tenantMembershipsError },
    { data: departmentMemberships, error: departmentMembershipsError },
    { data: roleAssignments, error: roleAssignmentsError },
    { data: teamMemberships, error: teamMembershipsError },
  ] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", ticket.tenant_id)
      .eq("status", "active"),
    admin
      .from("department_memberships")
      .select("user_id")
      .eq("tenant_id", ticket.tenant_id)
      .eq("department_id", ticket.department_id)
      .eq("status", "active"),
    admin
      .from("user_role_assignments")
      .select(
        "user_id, department_id, roles!user_role_assignments_role_tenant_fk!inner(tenant_id, active, scope, role_permissions!inner(permission_code))",
      )
      .eq("tenant_id", ticket.tenant_id)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`),
    isUuid(ticket.assigned_team_id)
      ? admin
          .from("team_memberships")
          .select("user_id")
          .eq("tenant_id", ticket.tenant_id)
          .eq("team_id", ticket.assigned_team_id)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (
    tenantMembershipsError ||
    departmentMembershipsError ||
    roleAssignmentsError ||
    teamMembershipsError
  )
    return { agentIds: [], error: true };

  const activeTenantMemberIds = new Set(
    (tenantMemberships ?? []).map((membership: any) => membership.user_id),
  );
  const activeDepartmentMemberIds = new Set(
    (departmentMemberships ?? []).map((membership: any) => membership.user_id),
  );
  const agentIds = new Set<string>();
  for (const assignment of roleAssignments ?? []) {
    if (
      !isUuid(assignment.user_id) ||
      !activeTenantMemberIds.has(assignment.user_id)
    )
      continue;
    const role = Array.isArray(assignment.roles)
      ? assignment.roles[0]
      : assignment.roles;
    if (!role?.active || role.tenant_id !== ticket.tenant_id) continue;

    const canHandleAssignedTickets = (role.role_permissions ?? []).some(
      (permission: any) =>
        permission.permission_code === "ticket.read.assigned" ||
        permission.permission_code === "ticket.update",
    );
    if (!canHandleAssignedTickets) continue;

    // Tenant-scoped agents may work throughout their tenant. Department-scoped
    // agents remain limited to an active membership in this ticket's department.
    const tenantScopedAgent = role.scope === "tenant";
    const departmentScopedAgent =
      role.scope === "department" &&
      assignment.department_id === ticket.department_id &&
      activeDepartmentMemberIds.has(assignment.user_id);
    if (
      activeDepartmentMemberIds.has(assignment.user_id) &&
      (tenantScopedAgent || departmentScopedAgent)
    )
      agentIds.add(assignment.user_id);
  }
  if (isUuid(ticket.assigned_team_id)) {
    const teamMemberIds = new Set(
      (teamMemberships ?? [])
        .map((membership: any) => membership.user_id)
        .filter(isUuid),
    );
    for (const agentId of agentIds) {
      if (
        !teamMemberIds.has(agentId) ||
        !activeDepartmentMemberIds.has(agentId)
      )
        agentIds.delete(agentId);
    }
  }
  return { agentIds: [...agentIds], error: false };
}

async function getTicketAgents(
  admin: any,
  ticket: any,
): Promise<{ agents: TicketAgent[]; error: boolean }> {
  const eligibleAgentIds = await getEligibleTicketAgentIds(admin, ticket);
  if (eligibleAgentIds.error) return { agents: [], error: true };
  if (eligibleAgentIds.agentIds.length === 0)
    return { agents: [], error: false };

  const { data: profiles, error } = await admin
    .from("user_profiles")
    .select("id, display_name")
    .in("id", eligibleAgentIds.agentIds);
  if (error) return { agents: [], error: true };

  const profileNames = new Map<string, string | null>();
  for (const profile of profiles ?? []) {
    if (!isUuid(profile.id)) continue;
    profileNames.set(
      profile.id,
      typeof profile.display_name === "string" ? profile.display_name : null,
    );
  }
  const agents = eligibleAgentIds.agentIds.map((id) => ({
    id,
    displayName: profileNames.get(id) ?? "Aktiver Agent",
  }));
  agents.sort(
    (left, right) =>
      (left.displayName ?? "").localeCompare(
        right.displayName ?? "",
        "de-CH",
      ) || left.id.localeCompare(right.id),
  );
  return { agents, error: false };
}

async function getAssignedTicketAgent(
  admin: any,
  ticket: any,
): Promise<{ agent: TicketAgent | null; error: boolean }> {
  if (!isUuid(ticket.assigned_agent_id)) return { agent: null, error: false };

  const { data: membership, error: membershipError } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", ticket.tenant_id)
    .eq("user_id", ticket.assigned_agent_id)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) return { agent: null, error: true };
  if (!membership) {
    return {
      agent: {
        id: ticket.assigned_agent_id,
        displayName: "Nicht mehr aktiver Agent",
      },
      error: false,
    };
  }

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("id, display_name")
    .eq("id", ticket.assigned_agent_id)
    .maybeSingle();
  if (profileError) return { agent: null, error: true };
  if (!profile || !isUuid(profile.id)) {
    return {
      agent: {
        id: ticket.assigned_agent_id,
        displayName: "Nicht mehr aktiver Agent",
      },
      error: false,
    };
  }
  return {
    agent: {
      id: profile.id,
      displayName:
        typeof profile.display_name === "string" && profile.display_name.trim()
          ? profile.display_name.trim()
          : "Aktiver Agent",
    },
    error: false,
  };
}

async function canAccessTeamTicket(
  admin: any,
  userId: string,
  ticketId: string,
) {
  const { data, error } = await admin.rpc("can_user_access_ticket_team", {
    p_ticket_id: ticketId,
    p_user_id: userId,
  });
  return !error && data === true;
}

async function ticketNotificationRecipientAuthorized(
  admin: any,
  ticket: any,
  userId: string,
) {
  const { data, error } = await admin.rpc(
    "ticket_notification_recipient_authorized",
    {
      p_tenant_id: ticket.tenant_id,
      p_ticket_id: ticket.id,
      p_user_id: userId,
    },
  );
  // Notification recipients are always fail-closed. A service-role lookup
  // failure must not expose a team ticket's metadata to a watcher.
  return !error && data === true;
}

async function canRead(admin: any, userId: string, ticket: any) {
  if (!(await activeMember(admin, userId, ticket.tenant_id))) return false;
  if (ticket.requester_id === userId || ticket.affected_user_id === userId)
    return true;
  if (
    ticket.assigned_agent_id === userId &&
    (await hasPermission(
      admin,
      userId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.read.assigned",
    )) &&
    (await canAccessTeamTicket(admin, userId, ticket.id))
  ) {
    return true;
  }
  if (
    (await hasPermission(
      admin,
      userId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.read.department",
    )) &&
    (await canAccessTeamTicket(admin, userId, ticket.id))
  ) {
    return true;
  }
  if (ticket.customer_organization_id) {
    const { data } = await admin
      .from("customer_memberships")
      .select("access, customer_organizations!inner(active, ticket_access)")
      .eq("customer_organization_id", ticket.customer_organization_id)
      .eq("user_id", userId)
      .maybeSingle();
    return Boolean(
      data?.access === "company" &&
      data.customer_organizations?.active &&
      data.customer_organizations?.ticket_access !== "disabled",
    );
  }
  return false;
}
async function getTicket(admin: any, tenantId: string, ticketId: string) {
  const { data } = await admin
    .from("tickets")
    .select("*")
    .eq("id", ticketId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

/**
 * Feature-Schalter sind eine zusätzliche Mandantengrenze zu Rollenrechten.
 * Fehlende, abgelaufene oder nicht lesbare Schalter bleiben absichtlich
 * deaktiviert, damit ein API-Aufruf kein ausgeblendetes Modul reaktiviert.
 */
async function getTicketModules(
  admin: any,
  tenantId: string,
): Promise<TicketModules | null> {
  const states = await resolveTenantFeatureStates(admin, tenantId, [
    "ticketing.detail",
    "ticketing.checklists",
    "ticketing.time-tracking",
  ]);
  if (!states) return null;

  return {
    detail: states["ticketing.detail"] === true,
    checklists: states["ticketing.checklists"] === true,
    timeTracking: states["ticketing.time-tracking"] === true,
  };
}

const inverseRelationType = (relationType: RelationType): RelationType => {
  if (relationType === "blocks") return "blocked_by";
  if (relationType === "blocked_by") return "blocks";
  if (relationType === "parent") return "child";
  if (relationType === "child") return "parent";
  return relationType;
};

const relationTypeForTicket = (
  relationType: RelationType,
  isOutgoing: boolean,
): RelationType =>
  isOutgoing ? relationType : inverseRelationType(relationType);

async function canMutateRelation(admin: any, userId: string, ticket: any) {
  const [canUpdate, canEscalate] = await Promise.all([
    hasPermission(
      admin,
      userId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.update",
    ),
    hasPermission(
      admin,
      userId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.escalate",
    ),
  ]);
  return canUpdate || canEscalate;
}

async function hasEquivalentRelation(
  admin: any,
  ticketId: string,
  relatedTicketId: string,
  relationType: RelationType,
) {
  const inverseType = inverseRelationType(relationType);
  const [direct, inverse] = await Promise.all([
    admin
      .from("ticket_relations")
      .select("ticket_id")
      .eq("ticket_id", ticketId)
      .eq("related_ticket_id", relatedTicketId)
      .eq("relation_type", relationType)
      .maybeSingle(),
    admin
      .from("ticket_relations")
      .select("ticket_id")
      .eq("ticket_id", relatedTicketId)
      .eq("related_ticket_id", ticketId)
      .eq("relation_type", inverseType)
      .maybeSingle(),
  ]);
  if (direct.error || inverse.error) return null;
  return Boolean(direct.data || inverse.data);
}

async function hasParentTicketRelation(admin: any, childTicketId: string) {
  const [parentRelation, childRelation] = await Promise.all([
    admin
      .from("ticket_relations")
      .select("ticket_id")
      .eq("ticket_id", childTicketId)
      .eq("relation_type", "parent")
      .limit(1),
    admin
      .from("ticket_relations")
      .select("ticket_id")
      .eq("related_ticket_id", childTicketId)
      .eq("relation_type", "child")
      .limit(1),
  ]);
  if (parentRelation.error || childRelation.error) return null;
  return Boolean(parentRelation.data?.length || childRelation.data?.length);
}

async function createsReferenceCycle(
  admin: any,
  tenantId: string,
  ticketId: string,
  relatedTicket: any,
  referenceColumn: "parent_ticket_id" | "merged_into_ticket_id",
) {
  const seen = new Set<string>([ticketId]);
  let current = relatedTicket;
  for (let depth = 0; depth < 100; depth += 1) {
    if (
      current?.tenant_id !== tenantId ||
      !isUuid(current?.id) ||
      seen.has(current.id)
    )
      return true;
    seen.add(current.id);
    const columnReferenceId = current[referenceColumn];
    let relationParentId: unknown = null;
    if (referenceColumn === "parent_ticket_id") {
      const [parentRelation, childRelation] = await Promise.all([
        admin
          .from("ticket_relations")
          .select("related_ticket_id")
          .eq("ticket_id", current.id)
          .eq("relation_type", "parent")
          .maybeSingle(),
        admin
          .from("ticket_relations")
          .select("ticket_id")
          .eq("related_ticket_id", current.id)
          .eq("relation_type", "child")
          .maybeSingle(),
      ]);
      if (parentRelation.error || childRelation.error) return true;
      if (
        parentRelation.data &&
        childRelation.data &&
        parentRelation.data.related_ticket_id !== childRelation.data.ticket_id
      )
        return true;
      relationParentId =
        parentRelation.data?.related_ticket_id ?? childRelation.data?.ticket_id;
    }
    if (
      columnReferenceId !== null &&
      columnReferenceId !== undefined &&
      relationParentId !== null &&
      relationParentId !== undefined &&
      columnReferenceId !== relationParentId
    )
      return true;
    const nextId = columnReferenceId ?? relationParentId;
    if (nextId === null || nextId === undefined) return false;
    if (!isUuid(nextId)) return true;
    const { data, error } = await admin
      .from("tickets")
      .select("id, tenant_id, parent_ticket_id, merged_into_ticket_id")
      .eq("id", nextId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !data) return true;
    current = data;
  }
  return true;
}

const subjectStopWords = new Set([
  "aber",
  "alle",
  "beim",
  "dass",
  "dem",
  "den",
  "der",
  "des",
  "die",
  "das",
  "ein",
  "eine",
  "einem",
  "einen",
  "einer",
  "für",
  "ist",
  "mit",
  "nach",
  "nicht",
  "oder",
  "und",
  "von",
  "vor",
  "wird",
  "the",
  "and",
  "for",
  "with",
]);

function relevantSubjectTokens(subject: unknown) {
  if (typeof subject !== "string") return [];
  return [
    ...new Set(
      subject
        .normalize("NFKC")
        .toLocaleLowerCase("de-CH")
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length >= 3 && !subjectStopWords.has(token)),
    ),
  ].slice(0, 5);
}

function ticketReference(ticket: any) {
  const status = Array.isArray(ticket.status)
    ? (ticket.status[0] ?? null)
    : (ticket.status ?? null);
  return {
    id: ticket.id,
    ticketNumber: ticket.ticket_number,
    subject: ticket.subject,
    statusLabel:
      typeof status?.label === "string" && status.label.trim()
        ? status.label.trim()
        : "Status nicht verfügbar",
  };
}

const escalationLevelForKind = (kind: EscalationKind) => {
  if (kind === "technical") return 1;
  if (kind === "organizational") return 2;
  return 3;
};

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return response(request, { error: { code: "method_not_allowed" } }, 405);
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string")
    return response(request, { error: { code: "invalid_request" } }, 400);
  const ticket = await getTicket(
    context.supabaseAdmin,
    action.tenantId,
    action.ticketId,
  );
  if (!ticket)
    return response(request, { error: { code: "ticket_access_denied" } }, 403);

  const [canReadTicket, ticketModules, internal] = await Promise.all([
    canRead(context.supabaseAdmin, actorId, ticket),
    getTicketModules(context.supabaseAdmin, ticket.tenant_id),
    hasPermission(
      context.supabaseAdmin,
      actorId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.internal_notes.read",
    ),
  ]);
  if (!canReadTicket)
    return response(request, { error: { code: "ticket_access_denied" } }, 403);
  if (!ticketModules)
    return response(
      request,
      { error: { code: "ticket_feature_lookup_failed" } },
      503,
    );
  if (!ticketModules.detail)
    return response(
      request,
      { error: { code: "ticket_feature_disabled" } },
      403,
    );

  if (action.type === "getTicket") {
    const subjectTokens = relevantSubjectTokens(ticket.subject);
    const requesterContactPromise = isRequesterContactId(
      ticket.requester_contact_id,
    )
      ? context.supabaseAdmin
          .from("ticket_requesters")
          .select("id, display_name, email")
          .eq("tenant_id", ticket.tenant_id)
          .eq("id", ticket.requester_contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null });
    const storedTicketCategoryIds = [
      ticket.category_id,
      ticket.subcategory_id,
    ].filter(isUuid);
    const ticketCategoriesPromise = context.supabaseAdmin
      .from("ticket_categories")
      .select("id, name, parent_id, active")
      .eq("tenant_id", ticket.tenant_id)
      .eq("department_id", ticket.department_id)
      .eq("active", true)
      .order("name");
    const storedTicketCategoriesPromise = storedTicketCategoryIds.length
      ? context.supabaseAdmin
          .from("ticket_categories")
          .select("id, name, parent_id, active")
          .eq("tenant_id", ticket.tenant_id)
          .eq("department_id", ticket.department_id)
          .in("id", storedTicketCategoryIds)
      : Promise.resolve({ data: [] });
    const [
      { data: comments },
      { data: events },
      { data: escalations },
      { data: statuses },
      { data: priorities },
      { data: teams },
      { data: watchers },
      { data: checklistItems },
      { data: timeEntries },
      { data: drafts },
      { data: relationRows },
      { data: columnRelatedTickets },
      { data: similarCandidates },
      { data: requesterContactRow },
      { data: categories },
      { data: storedTicketCategories },
    ] = await Promise.all([
      context.supabaseAdmin
        .from("ticket_comments")
        .select(
          "id, author_id, visibility, body, channel, requester_contact_id, created_at, updated_at",
        )
        .eq("ticket_id", ticket.id)
        .order("created_at"),
      context.supabaseAdmin
        .from("ticket_events")
        .select("id, event_type, payload, created_at")
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: false })
        .limit(100),
      context.supabaseAdmin
        .from("ticket_escalations")
        .select(
          "id, ticket_id, level, kind, reason, opened_by, resolved_by, opened_at, resolved_at",
        )
        .eq("ticket_id", ticket.id)
        .order("opened_at", { ascending: false }),
      context.supabaseAdmin
        .from("ticket_statuses")
        .select("id, key, label, is_closed, sort_order")
        .eq("tenant_id", ticket.tenant_id)
        .order("sort_order"),
      context.supabaseAdmin
        .from("ticket_priorities")
        .select("id, key, label, sort_order")
        .eq("tenant_id", ticket.tenant_id)
        .order("sort_order"),
      context.supabaseAdmin
        .from("teams")
        .select("id, name")
        .eq("tenant_id", ticket.tenant_id)
        .eq("department_id", ticket.department_id)
        .eq("active", true)
        .order("name"),
      context.supabaseAdmin
        .from("ticket_watchers")
        .select("user_id")
        .eq("ticket_id", ticket.id)
        .eq("user_id", actorId)
        .maybeSingle(),
      ticketModules.checklists
        ? context.supabaseAdmin
            .from("ticket_checklist_items")
            .select(
              "id, ticket_id, description, position, completed_at, completed_by, created_by, created_at",
            )
            .eq("ticket_id", ticket.id)
            .order("position")
            .order("created_at")
        : Promise.resolve({ data: [] }),
      ticketModules.timeTracking && internal
        ? context.supabaseAdmin
            .from("ticket_time_entries")
            .select(
              "id, author_id, minutes, billing_kind, note, started_at, created_at",
            )
            .eq("ticket_id", ticket.id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      context.supabaseAdmin
        .from("ticket_drafts")
        .select("id, ticket_id, author_id, visibility, body, updated_at")
        .eq("ticket_id", ticket.id)
        .eq("author_id", actorId),
      context.supabaseAdmin
        .from("ticket_relations")
        .select("ticket_id, related_ticket_id, relation_type")
        .or(`ticket_id.eq.${ticket.id},related_ticket_id.eq.${ticket.id}`),
      context.supabaseAdmin
        .from("tickets")
        .select(
          "id, tenant_id, department_id, ticket_number, subject, requester_id, affected_user_id, assigned_agent_id, assigned_team_id, customer_organization_id, parent_ticket_id, merged_into_ticket_id, status:ticket_statuses(id, key, label, is_closed)",
        )
        .eq("tenant_id", ticket.tenant_id)
        .or(
          `parent_ticket_id.eq.${ticket.id},merged_into_ticket_id.eq.${ticket.id}`,
        )
        .limit(100),
      subjectTokens.length
        ? context.supabaseAdmin
            .from("tickets")
            .select(
              "id, tenant_id, department_id, ticket_number, subject, requester_id, affected_user_id, assigned_agent_id, assigned_team_id, customer_organization_id, status:ticket_statuses(id, key, label, is_closed)",
            )
            .eq("tenant_id", ticket.tenant_id)
            .neq("id", ticket.id)
            .or(
              subjectTokens
                .map((token) => `subject.ilike.%${token}%`)
                .join(","),
            )
            .order("updated_at", { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] }),
      requesterContactPromise,
      ticketCategoriesPromise,
      storedTicketCategoriesPromise,
    ]);
    const filteredComments = internal
      ? (comments ?? [])
      : (comments ?? []).filter(
          (comment: any) => comment.visibility === "external",
        );
    const ticketCategoryOptions = [
      ...new Map(
        [...(categories ?? []), ...(storedTicketCategories ?? [])]
          .filter((category: any) => isUuid(category?.id))
          .map((category: any) => [category.id, category]),
      ).values(),
    ];
    const authorIds = [
      ...new Set(
        filteredComments
          .map((comment: any) => comment.author_id)
          .filter((authorId: unknown) => isUuid(authorId)),
      ),
    ];
    const requesterContactIds = [
      ...new Set(
        filteredComments
          .map((comment: any) => comment.requester_contact_id)
          .filter((contactId: unknown) => isUuid(contactId)),
      ),
    ];
    const commentIds = filteredComments
      .map((comment: any) => comment.id)
      .filter((commentId: unknown) => isUuid(commentId));
    const [
      profileResult,
      customerMembershipResult,
      commentContactResult,
      emailDeliveryResult,
    ] = await Promise.all([
      authorIds.length
        ? context.supabaseAdmin
            .from("user_profiles")
            .select("id, display_name")
            .in("id", authorIds)
        : Promise.resolve({ data: [] }),
      isUuid(ticket.customer_organization_id) && authorIds.length
        ? context.supabaseAdmin
            .from("customer_memberships")
            .select("user_id")
            .eq("customer_organization_id", ticket.customer_organization_id)
            .in("user_id", authorIds)
        : Promise.resolve({ data: [] }),
      requesterContactIds.length
        ? context.supabaseAdmin
            .from("ticket_requesters")
            .select("id, display_name")
            .eq("tenant_id", ticket.tenant_id)
            .in("id", requesterContactIds)
        : Promise.resolve({ data: [] }),
      commentIds.length
        ? context.supabaseAdmin
            .from("mail_messages")
            .select("comment_id, processing_status")
            .eq("tenant_id", ticket.tenant_id)
            .eq("kind", "agent_reply")
            .in("comment_id", commentIds)
        : Promise.resolve({ data: [] }),
    ]);
    const profiles = profileResult.data;
    const profileNames = Object.fromEntries(
      (profiles ?? []).map((profile: any) => [
        profile.id,
        profile.display_name,
      ]),
    );
    const customerAuthorIds = new Set<string>();
    if (isUuid(ticket.requester_id)) customerAuthorIds.add(ticket.requester_id);
    for (const membership of customerMembershipResult.data ?? []) {
      if (isUuid(membership.user_id)) customerAuthorIds.add(membership.user_id);
    }
    const requesterContactNames = Object.fromEntries(
      (commentContactResult.data ?? [])
        .filter(
          (contact: any) =>
            isUuid(contact.id) && typeof contact.display_name === "string",
        )
        .map((contact: any) => [contact.id, contact.display_name]),
    );
    const emailDeliveryByCommentId = Object.fromEntries(
      (emailDeliveryResult.data ?? []).flatMap((delivery: any) => {
        if (!isUuid(delivery.comment_id)) return [];
        const emailDelivery =
          delivery.processing_status === "processed"
            ? "sent"
            : delivery.processing_status === "failed"
              ? "failed"
              : delivery.processing_status === "pending" ||
                  delivery.processing_status === "processing"
                ? "pending"
                : null;
        return emailDelivery === null
          ? []
          : [[delivery.comment_id, emailDelivery]];
      }),
    );
    const requesterContact =
      isRecord(requesterContactRow) &&
      isUuid(requesterContactRow.id) &&
      typeof requesterContactRow.display_name === "string"
        ? {
            id: requesterContactRow.id,
            displayName: requesterContactRow.display_name,
            ...(typeof requesterContactRow.email === "string" &&
            requesterContactRow.email.trim()
              ? { email: requesterContactRow.email.trim() }
              : {}),
          }
        : null;
    const canAssignPromise = hasPermission(
      context.supabaseAdmin,
      actorId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.assign",
    );
    const ticketAgentsPromise = canAssignPromise.then((canAssign) =>
      canAssign
        ? getTicketAgents(context.supabaseAdmin, ticket)
        : { agents: [], error: false },
    );
    const assignedTicketAgentPromise = getAssignedTicketAgent(
      context.supabaseAdmin,
      ticket,
    );
    const ticketPermissionsPromise = Promise.all([
      hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.update",
      ),
      hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.merge",
      ),
      canAssignPromise,
      hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.time.track",
      ),
      hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.escalate",
      ),
      hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.close",
      ),
      hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.internal_notes.write",
      ),
      canPostExternalComment(context.supabaseAdmin, actorId, ticket),
      hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.export",
      ),
    ]);
    const relationDescriptors = new Map<
      string,
      { relatedTicketId: string; relationType: DisplayRelationType }
    >();
    const addRelationDescriptor = (
      relatedTicketId: unknown,
      relationType: DisplayRelationType,
    ) => {
      if (!isUuid(relatedTicketId)) return;
      relationDescriptors.set(`${relationType}:${relatedTicketId}`, {
        relatedTicketId,
        relationType,
      });
    };
    for (const relation of relationRows ?? []) {
      const isOutgoing = relation.ticket_id === ticket.id;
      addRelationDescriptor(
        isOutgoing ? relation.related_ticket_id : relation.ticket_id,
        relationTypeForTicket(
          relation.relation_type as RelationType,
          isOutgoing,
        ),
      );
    }
    addRelationDescriptor(ticket.parent_ticket_id, "parent");
    addRelationDescriptor(ticket.merged_into_ticket_id, "merged_into");
    for (const columnRelatedTicket of columnRelatedTickets ?? []) {
      if (columnRelatedTicket.parent_ticket_id === ticket.id)
        addRelationDescriptor(columnRelatedTicket.id, "child");
      if (columnRelatedTicket.merged_into_ticket_id === ticket.id)
        addRelationDescriptor(columnRelatedTicket.id, "merged_from");
    }
    const relatedTicketIds = [
      ...new Set(
        [...relationDescriptors.values()].map(
          (relation) => relation.relatedTicketId,
        ),
      ),
    ];
    const { data: relatedTickets } = relatedTicketIds.length
      ? await context.supabaseAdmin
          .from("tickets")
          .select(
            "id, tenant_id, department_id, ticket_number, subject, requester_id, affected_user_id, assigned_agent_id, assigned_team_id, customer_organization_id, status:ticket_statuses(id, key, label, is_closed)",
          )
          .eq("tenant_id", ticket.tenant_id)
          .in("id", relatedTicketIds)
      : { data: [] };
    const [readableRelatedTickets, readableSimilarTickets] = await Promise.all([
      Promise.all(
        (relatedTickets ?? []).map(async (relatedTicket: any) =>
          (await canRead(context.supabaseAdmin, actorId, relatedTicket))
            ? relatedTicket
            : null,
        ),
      ),
      Promise.all(
        (similarCandidates ?? []).map(async (similarTicket: any) =>
          (await canRead(context.supabaseAdmin, actorId, similarTicket))
            ? similarTicket
            : null,
        ),
      ),
    ]);
    const relatedTicketById = new Map(
      readableRelatedTickets
        .filter((relatedTicket: any) => relatedTicket !== null)
        .map((relatedTicket: any) => [
          relatedTicket.id,
          ticketReference(relatedTicket),
        ]),
    );
    const relations = [...relationDescriptors.values()].flatMap((relation) => {
      const relatedTicket = relatedTicketById.get(relation.relatedTicketId);
      return relatedTicket
        ? [
            {
              relationType: relation.relationType,
              relatedTicketId: relatedTicket.id,
              ticketNumber: relatedTicket.ticketNumber,
              subject: relatedTicket.subject,
              statusLabel: relatedTicket.statusLabel,
            },
          ]
        : [];
    });
    const similarTickets = readableSimilarTickets
      .filter((similarTicket: any) => similarTicket !== null)
      .slice(0, 10)
      .map((similarTicket: any) => ticketReference(similarTicket));
    const [
      ticketAgents,
      assignedTicketAgent,
      [
        canUpdate,
        canMerge,
        canAssign,
        canTrackTime,
        canEscalate,
        canClose,
        canWriteInternalNotes,
        canCommentExternal,
        canExport,
      ],
    ] = await Promise.all([
      ticketAgentsPromise,
      assignedTicketAgentPromise,
      ticketPermissionsPromise,
    ]);
    if (ticketAgents.error || assignedTicketAgent.error)
      return response(
        request,
        { error: { code: "ticket_agents_lookup_failed" } },
        500,
      );
    const assignedAgent = assignedTicketAgent.agent;
    return response(request, {
      data: {
        ticket: {
          ...ticket,
          assigned_agent_id: ticket.assigned_agent_id ?? null,
        },
        requesterContact,
        ...(assignedAgent ? { assignedAgent } : {}),
        comments: filteredComments.map((comment: any) => {
          const requesterContactName = isUuid(comment.requester_contact_id)
            ? requesterContactNames[comment.requester_contact_id]
            : null;
          const emailDelivery = emailDeliveryByCommentId[comment.id] ?? null;
          return {
            ...comment,
            authorName:
              requesterContactName ??
              profileNames[comment.author_id] ??
              "nextDesk Benutzer",
            authorKind:
              comment.visibility === "internal"
                ? "internal"
                : requesterContactName
                  ? "customer"
                  : customerAuthorIds.has(comment.author_id)
                    ? "customer"
                    : "agent",
            emailDelivery,
          };
        }),
        events: events ?? [],
        escalations: escalations ?? [],
        statuses: statuses ?? [],
        priorities: priorities ?? [],
        categories: ticketCategoryOptions,
        teams: teams ?? [],
        watching: Boolean(watchers),
        checklistItems: checklistItems ?? [],
        timeEntries: internal ? (timeEntries ?? []) : [],
        drafts: drafts ?? [],
        relations,
        similarTickets,
        ticketModules,
        ...(canAssign ? { agents: ticketAgents.agents } : {}),
        canUpdate,
        canMerge,
        canAssign,
        canTrackTime: ticketModules.timeTracking && canTrackTime,
        canEscalate,
        canClose,
        canUseInternalNotes: internal,
        canWriteInternalNotes,
        canCommentExternal,
        canExport,
      },
    });
  }

  if (action.type === "recordExport") {
    if (
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.export",
      ))
    ) {
      return response(
        request,
        { error: { code: "ticket_export_denied" } },
        403,
      );
    }

    const occurredAt = new Date().toISOString();
    const [eventResult, auditResult] = await Promise.all([
      context.supabaseAdmin.from("ticket_events").insert({
        ticket_id: ticket.id,
        actor_id: actorId,
        event_type: "ticket.pdf_exported",
        payload: { format: "pdf", occurredAt },
      }),
      context.supabaseAdmin.from("audit_logs").insert({
        tenant_id: ticket.tenant_id,
        actor_id: actorId,
        action: "ticket.pdf_exported",
        entity_type: "ticket",
        entity_id: ticket.id,
        metadata: { format: "pdf", occurredAt },
      }),
    ]);
    if (eventResult.error || auditResult.error) {
      return response(
        request,
        { error: { code: "ticket_export_failed" } },
        500,
      );
    }
    return response(request, { data: { recorded: true, occurredAt } });
  }

  if (action.type === "searchMergeTargets") {
    if (
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.merge",
      ))
    )
      return response(request, { error: { code: "ticket_merge_denied" } }, 403);
    if ([...action.query].length < 2)
      return response(request, { data: { mergeTargets: [] } });

    const { data: candidates, error } = await context.supabaseAdmin
      .from("tickets")
      .select(
        "id, tenant_id, department_id, ticket_number, subject, requester_id, affected_user_id, assigned_agent_id, assigned_team_id, customer_organization_id, status:ticket_statuses(label)",
      )
      .eq("tenant_id", ticket.tenant_id)
      .neq("id", ticket.id)
      .is("merged_into_ticket_id", null)
      .ilike("subject", `%${action.query}%`)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error)
      return response(
        request,
        { error: { code: "ticket_merge_target_search_failed" } },
        500,
      );
    const readableTargets = (
      await Promise.all(
        (candidates ?? []).map(async (candidate: any) =>
          (await canRead(context.supabaseAdmin, actorId, candidate))
            ? candidate
            : null,
        ),
      )
    )
      .filter((candidate) => candidate !== null)
      .slice(0, 30);
    return response(request, {
      data: {
        mergeTargets: readableTargets.map((candidate: any) => {
          const status = Array.isArray(candidate.status)
            ? (candidate.status[0] ?? null)
            : (candidate.status ?? null);
          return {
            id: candidate.id,
            ticketNumber: candidate.ticket_number,
            subject: candidate.subject,
            statusLabel:
              typeof status?.label === "string" ? status.label : null,
          };
        }),
      },
    });
  }

  if (action.type === "openEscalation") {
    if (
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.escalate",
      ))
    )
      return response(
        request,
        { error: { code: "ticket_escalate_denied" } },
        403,
      );

    const { data: openEscalation, error: openEscalationError } =
      await context.supabaseAdmin
        .from("ticket_escalations")
        .select("id")
        .eq("ticket_id", ticket.id)
        .eq("kind", action.kind)
        .is("resolved_at", null)
        .limit(1)
        .maybeSingle();
    if (openEscalationError)
      return response(
        request,
        { error: { code: "ticket_escalation_check_failed" } },
        500,
      );
    if (openEscalation)
      return response(
        request,
        { error: { code: "ticket_escalation_already_open" } },
        409,
      );

    const { data: watchers, error: watchersError } = await context.supabaseAdmin
      .from("ticket_watchers")
      .select("user_id")
      .eq("ticket_id", ticket.id);
    if (watchersError)
      return response(
        request,
        { error: { code: "ticket_escalation_recipients_failed" } },
        500,
      );
    const recipientIds = new Set<string>();
    if (isUuid(ticket.assigned_agent_id))
      recipientIds.add(ticket.assigned_agent_id);
    for (const watcher of watchers ?? [])
      if (isUuid(watcher.user_id)) recipientIds.add(watcher.user_id);

    const notificationRecipientIds = [
      ...new Set(
        (
          await Promise.all(
            [...recipientIds]
              .filter((userId) => userId !== actorId)
              .map(async (userId) =>
                (await ticketNotificationRecipientAuthorized(
                  context.supabaseAdmin,
                  ticket,
                  userId,
                ))
                  ? userId
                  : null,
              ),
          )
        ).filter((userId): userId is string => userId !== null),
      ),
    ];

    const level = escalationLevelForKind(action.kind);
    const { data: escalation, error: escalationError } =
      await context.supabaseAdmin
        .from("ticket_escalations")
        .insert({
          ticket_id: ticket.id,
          level,
          kind: action.kind,
          reason: action.reason,
          opened_by: actorId,
        })
        .select(
          "id, ticket_id, level, kind, reason, opened_by, resolved_by, opened_at, resolved_at",
        )
        .single();
    if (escalationError)
      return response(
        request,
        { error: { code: "ticket_escalation_create_failed" } },
        422,
      );

    const { data: event, error: eventError } = await context.supabaseAdmin
      .from("ticket_events")
      .insert({
        ticket_id: ticket.id,
        actor_id: actorId,
        event_type: "ticket.escalation_opened",
        payload: {
          escalationId: escalation.id,
          level: escalation.level,
          kind: escalation.kind,
          reason: escalation.reason,
        },
      })
      .select("id")
      .single();
    if (eventError) {
      await context.supabaseAdmin
        .from("ticket_escalations")
        .delete()
        .eq("id", escalation.id)
        .eq("ticket_id", ticket.id)
        .is("resolved_at", null);
      return response(
        request,
        { error: { code: "ticket_escalation_event_failed" } },
        422,
      );
    }

    if (notificationRecipientIds.length > 0) {
      const { error: notificationError } = await context.supabaseAdmin
        .from("ticket_notifications")
        .insert(
          notificationRecipientIds.map((userId) => ({
            tenant_id: ticket.tenant_id,
            user_id: userId,
            ticket_id: ticket.id,
            kind: "ticket.escalation_opened",
            payload: {
              escalationId: escalation.id,
              level: escalation.level,
              kind: escalation.kind,
              reason: escalation.reason,
            },
          })),
        );
      if (notificationError) {
        await context.supabaseAdmin
          .from("ticket_events")
          .delete()
          .eq("id", event.id)
          .eq("ticket_id", ticket.id);
        await context.supabaseAdmin
          .from("ticket_escalations")
          .delete()
          .eq("id", escalation.id)
          .eq("ticket_id", ticket.id)
          .is("resolved_at", null);
        return response(
          request,
          { error: { code: "ticket_escalation_notification_failed" } },
          422,
        );
      }
    }

    return response(request, { data: { escalation } }, 201);
  }

  if (action.type === "resolveEscalation") {
    if (
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.escalate",
      ))
    )
      return response(
        request,
        { error: { code: "ticket_escalate_denied" } },
        403,
      );

    const resolvedAt = new Date().toISOString();
    const { data: escalation, error: escalationError } =
      await context.supabaseAdmin
        .from("ticket_escalations")
        .update({ resolved_by: actorId, resolved_at: resolvedAt })
        .eq("id", action.escalationId)
        .eq("ticket_id", ticket.id)
        .is("resolved_at", null)
        .select(
          "id, ticket_id, level, kind, reason, opened_by, resolved_by, opened_at, resolved_at",
        )
        .maybeSingle();
    if (escalationError)
      return response(
        request,
        { error: { code: "ticket_escalation_resolve_failed" } },
        422,
      );
    if (!escalation)
      return response(
        request,
        { error: { code: "ticket_escalation_not_found" } },
        404,
      );

    const { error: eventError } = await context.supabaseAdmin
      .from("ticket_events")
      .insert({
        ticket_id: ticket.id,
        actor_id: actorId,
        event_type: "ticket.escalation_resolved",
        payload: {
          escalationId: escalation.id,
          level: escalation.level,
          kind: escalation.kind,
        },
      });
    if (eventError) {
      await context.supabaseAdmin
        .from("ticket_escalations")
        .update({ resolved_by: null, resolved_at: null })
        .eq("id", escalation.id)
        .eq("ticket_id", ticket.id)
        .eq("resolved_by", actorId)
        .eq("resolved_at", resolvedAt);
      return response(
        request,
        { error: { code: "ticket_escalation_event_failed" } },
        422,
      );
    }
    return response(request, { data: { escalation } });
  }

  if (
    action.type === "createRelation" ||
    action.type === "deleteRelation" ||
    action.type === "markMerged"
  ) {
    const relatedTicketId =
      action.type === "markMerged"
        ? action.primaryTicketId
        : action.relatedTicketId;
    if (relatedTicketId === ticket.id)
      return response(
        request,
        { error: { code: "ticket_relation_self_reference" } },
        422,
      );
    const relatedTicket = await getTicket(
      context.supabaseAdmin,
      action.tenantId,
      relatedTicketId,
    );
    if (
      !relatedTicket ||
      !(await canRead(context.supabaseAdmin, actorId, relatedTicket))
    )
      return response(
        request,
        { error: { code: "related_ticket_access_denied" } },
        403,
      );
    if (action.type === "markMerged") {
      const [canMergeTicket, canMergeRelatedTicket] = await Promise.all([
        hasPermission(
          context.supabaseAdmin,
          actorId,
          ticket.tenant_id,
          ticket.department_id,
          "ticket.merge",
        ),
        hasPermission(
          context.supabaseAdmin,
          actorId,
          relatedTicket.tenant_id,
          relatedTicket.department_id,
          "ticket.merge",
        ),
      ]);
      if (!canMergeTicket || !canMergeRelatedTicket)
        return response(
          request,
          { error: { code: "ticket_merge_denied" } },
          403,
        );
    } else {
      const [canMutateTicket, canMutateRelatedTicket] = await Promise.all([
        canMutateRelation(context.supabaseAdmin, actorId, ticket),
        canMutateRelation(context.supabaseAdmin, actorId, relatedTicket),
      ]);
      if (!canMutateTicket || !canMutateRelatedTicket)
        return response(
          request,
          { error: { code: "ticket_relation_update_denied" } },
          403,
        );
    }

    if (action.type === "createRelation" || action.type === "deleteRelation") {
      const relationExists = await hasEquivalentRelation(
        context.supabaseAdmin,
        ticket.id,
        relatedTicket.id,
        action.relationType,
      );
      if (relationExists === null)
        return response(
          request,
          { error: { code: "ticket_relation_check_failed" } },
          422,
        );

      const isParentChild =
        action.relationType === "parent" || action.relationType === "child";
      const childTicket =
        action.relationType === "parent" ? ticket : relatedTicket;
      const parentTicket =
        action.relationType === "parent" ? relatedTicket : ticket;

      if (action.type === "createRelation") {
        if (relationExists)
          return response(
            request,
            { error: { code: "ticket_relation_exists" } },
            409,
          );
        if (isParentChild) {
          const parentRelationExists = await hasParentTicketRelation(
            context.supabaseAdmin,
            childTicket.id,
          );
          if (parentRelationExists === null)
            return response(
              request,
              { error: { code: "ticket_relation_check_failed" } },
              422,
            );
          if (childTicket.parent_ticket_id || parentRelationExists)
            return response(
              request,
              { error: { code: "parent_ticket_already_set" } },
              409,
            );
          if (
            await createsReferenceCycle(
              context.supabaseAdmin,
              ticket.tenant_id,
              childTicket.id,
              parentTicket,
              "parent_ticket_id",
            )
          )
            return response(
              request,
              { error: { code: "ticket_parent_cycle" } },
              422,
            );
          const { data: parentUpdated, error: parentUpdateError } =
            await context.supabaseAdmin
              .from("tickets")
              .update({ parent_ticket_id: parentTicket.id })
              .eq("id", childTicket.id)
              .eq("tenant_id", ticket.tenant_id)
              .is("parent_ticket_id", null)
              .select("id")
              .maybeSingle();
          if (parentUpdateError || !parentUpdated)
            return response(
              request,
              { error: { code: "parent_ticket_update_failed" } },
              409,
            );
        }
        const { error: relationCreateError } = await context.supabaseAdmin
          .from("ticket_relations")
          .insert({
            ticket_id: ticket.id,
            related_ticket_id: relatedTicket.id,
            relation_type: action.relationType,
            created_by: actorId,
          });
        if (relationCreateError) {
          if (isParentChild)
            await context.supabaseAdmin
              .from("tickets")
              .update({ parent_ticket_id: null })
              .eq("id", childTicket.id)
              .eq("tenant_id", ticket.tenant_id)
              .eq("parent_ticket_id", parentTicket.id);
          return response(
            request,
            { error: { code: "ticket_relation_create_failed" } },
            422,
          );
        }
        const { error: eventError } = await context.supabaseAdmin
          .from("ticket_events")
          .insert([
            {
              ticket_id: ticket.id,
              actor_id: actorId,
              event_type: "ticket.relation_created",
              payload: {
                relatedTicketId: relatedTicket.id,
                relationType: action.relationType,
              },
            },
            {
              ticket_id: relatedTicket.id,
              actor_id: actorId,
              event_type: "ticket.relation_created",
              payload: {
                relatedTicketId: ticket.id,
                relationType: inverseRelationType(action.relationType),
              },
            },
          ]);
        if (eventError)
          return response(
            request,
            { error: { code: "ticket_relation_event_failed" } },
            422,
          );
        return response(request, { data: { created: true } }, 201);
      }

      if (!relationExists)
        return response(
          request,
          { error: { code: "ticket_relation_not_found" } },
          404,
        );
      if (isParentChild) {
        const { error: parentClearError } = await context.supabaseAdmin
          .from("tickets")
          .update({ parent_ticket_id: null })
          .eq("id", childTicket.id)
          .eq("tenant_id", ticket.tenant_id)
          .eq("parent_ticket_id", parentTicket.id);
        if (parentClearError)
          return response(
            request,
            { error: { code: "parent_ticket_update_failed" } },
            422,
          );
      }
      const inverseType = inverseRelationType(action.relationType);
      const [directDelete, inverseDelete] = await Promise.all([
        context.supabaseAdmin
          .from("ticket_relations")
          .delete()
          .eq("ticket_id", ticket.id)
          .eq("related_ticket_id", relatedTicket.id)
          .eq("relation_type", action.relationType),
        context.supabaseAdmin
          .from("ticket_relations")
          .delete()
          .eq("ticket_id", relatedTicket.id)
          .eq("related_ticket_id", ticket.id)
          .eq("relation_type", inverseType),
      ]);
      if (directDelete.error || inverseDelete.error)
        return response(
          request,
          { error: { code: "ticket_relation_delete_failed" } },
          422,
        );
      const { error: eventError } = await context.supabaseAdmin
        .from("ticket_events")
        .insert([
          {
            ticket_id: ticket.id,
            actor_id: actorId,
            event_type: "ticket.relation_deleted",
            payload: {
              relatedTicketId: relatedTicket.id,
              relationType: action.relationType,
            },
          },
          {
            ticket_id: relatedTicket.id,
            actor_id: actorId,
            event_type: "ticket.relation_deleted",
            payload: {
              relatedTicketId: ticket.id,
              relationType: inverseType,
            },
          },
        ]);
      if (eventError)
        return response(
          request,
          { error: { code: "ticket_relation_event_failed" } },
          422,
        );
      return response(request, { data: { deleted: true } });
    }

    if (ticket.merged_into_ticket_id || relatedTicket.merged_into_ticket_id)
      return response(
        request,
        { error: { code: "ticket_merge_already_set" } },
        409,
      );
    if (
      await createsReferenceCycle(
        context.supabaseAdmin,
        ticket.tenant_id,
        ticket.id,
        relatedTicket,
        "merged_into_ticket_id",
      )
    )
      return response(request, { error: { code: "ticket_merge_cycle" } }, 422);
    const { data: primaryStatus, error: primaryStatusError } =
      await context.supabaseAdmin
        .from("ticket_statuses")
        .select("id, key, is_closed")
        .eq("id", relatedTicket.status_id)
        .eq("tenant_id", ticket.tenant_id)
        .maybeSingle();
    if (primaryStatusError || !primaryStatus)
      return response(
        request,
        { error: { code: "merge_primary_status_unresolved" } },
        422,
      );
    if (primaryStatus.is_closed !== false)
      return response(
        request,
        { error: { code: "merge_primary_ticket_closed" } },
        422,
      );
    const { data: resolvedStatus, error: resolvedStatusError } =
      await context.supabaseAdmin
        .from("ticket_statuses")
        .select("id, key, is_closed")
        .eq("tenant_id", ticket.tenant_id)
        .eq("key", "resolved")
        .maybeSingle();
    const mergedAt = new Date().toISOString();
    const mergeUpdate: Record<string, unknown> = {
      merged_into_ticket_id: relatedTicket.id,
    };
    const statusAutomaticallyUpdated =
      !resolvedStatusError && resolvedStatus?.is_closed === true;
    if (statusAutomaticallyUpdated) {
      if (
        !(await hasPermission(
          context.supabaseAdmin,
          actorId,
          ticket.tenant_id,
          ticket.department_id,
          "ticket.close",
        ))
      )
        return response(
          request,
          { error: { code: "ticket_close_denied" } },
          403,
        );
      mergeUpdate.status_id = resolvedStatus.id;
      mergeUpdate.closed_at = mergedAt;
      mergeUpdate.resolved_at = mergedAt;
      mergeUpdate.waiting_since = null;
    }
    const { data: mergedTicket, error: mergeError } =
      await context.supabaseAdmin
        .from("tickets")
        .update(mergeUpdate)
        .eq("id", ticket.id)
        .eq("tenant_id", ticket.tenant_id)
        .is("merged_into_ticket_id", null)
        .select("id")
        .maybeSingle();
    if (mergeError || !mergedTicket)
      return response(request, { error: { code: "ticket_merge_failed" } }, 409);
    const { error: eventError } = await context.supabaseAdmin
      .from("ticket_events")
      .insert([
        {
          ticket_id: ticket.id,
          actor_id: actorId,
          event_type: "ticket.merged",
          payload: {
            primaryTicketId: relatedTicket.id,
            statusAutomaticallyUpdated,
          },
        },
        {
          ticket_id: relatedTicket.id,
          actor_id: actorId,
          event_type: "ticket.merge_received",
          payload: {
            mergedTicketId: ticket.id,
            statusAutomaticallyUpdated,
          },
        },
      ]);
    if (eventError)
      return response(
        request,
        { error: { code: "ticket_merge_event_failed" } },
        422,
      );
    return response(request, {
      data: { merged: true, statusAutomaticallyUpdated },
    });
  }

  if (action.type === "saveDraft") {
    if (
      action.visibility === "internal" &&
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.internal_notes.write",
      ))
    )
      return response(
        request,
        { error: { code: "internal_note_denied" } },
        403,
      );
    const { data: draft, error } = await context.supabaseAdmin
      .from("ticket_drafts")
      .upsert(
        {
          ticket_id: ticket.id,
          author_id: actorId,
          visibility: action.visibility,
          body: action.body,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "ticket_id,author_id,visibility" },
      )
      .select("id, ticket_id, author_id, visibility, body, updated_at")
      .single();
    if (error)
      return response(request, { error: { code: "draft_save_failed" } }, 422);
    return response(request, { data: { draft } });
  }

  if (action.type === "addTimeEntry") {
    if (!ticketModules.timeTracking)
      return response(
        request,
        { error: { code: "ticket_feature_disabled" } },
        403,
      );
    if (
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.time.track",
      ))
    )
      return response(
        request,
        { error: { code: "ticket_time_track_denied" } },
        403,
      );
    const { data: timeEntry, error } = await context.supabaseAdmin
      .from("ticket_time_entries")
      .insert({
        ticket_id: ticket.id,
        author_id: actorId,
        minutes: action.minutes,
        billing_kind: action.billingKind,
        note: action.note ?? null,
        started_at: action.startedAt ?? null,
      })
      .select(
        "id, author_id, minutes, billing_kind, note, started_at, created_at",
      )
      .single();
    if (error)
      return response(
        request,
        { error: { code: "time_entry_create_failed" } },
        422,
      );
    await context.supabaseAdmin.from("ticket_events").insert({
      ticket_id: ticket.id,
      actor_id: actorId,
      event_type: "time_entry.added",
      payload: {
        timeEntryId: timeEntry.id,
        minutes: timeEntry.minutes,
        billingKind: timeEntry.billing_kind,
        startedAt: timeEntry.started_at,
      },
    });
    return response(request, { data: { timeEntry } }, 201);
  }

  if (action.type === "addComment") {
    if (
      action.body.length < 1 ||
      action.body.length > 50000 ||
      action.body.includes("\u0000")
    )
      return response(request, { error: { code: "invalid_comment" } }, 422);
    if (
      action.visibility === "internal" &&
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.internal_notes.write",
      ))
    )
      return response(
        request,
        {
          error: {
            code: "internal_note_denied",
            message:
              "Sie sind nicht berechtigt, interne Kommentare zu verfassen.",
          },
        },
        403,
      );
    if (
      action.visibility === "external" &&
      !(await canPostExternalComment(context.supabaseAdmin, actorId, ticket))
    )
      return response(
        request,
        {
          error: {
            code: "external_comment_denied",
            message:
              "Sie sind nicht berechtigt, externe Portalantworten zu veröffentlichen.",
          },
        },
        403,
      );
    let comment: {
      id: string;
      author_id: string;
      visibility: "internal" | "external";
    };
    if (action.attachmentIds.length > 0) {
      const { data: commentId, error } = await context.supabaseAdmin.rpc(
        "create_ticket_comment_with_attachments",
        {
          p_attachment_ids: action.attachmentIds,
          p_author_id: actorId,
          p_body: action.body,
          p_ticket_id: ticket.id,
          p_visibility: action.visibility,
        },
      );
      if (error || !isUuid(commentId))
        return response(
          request,
          { error: { code: "comment_attachment_link_failed" } },
          422,
        );
      comment = {
        id: commentId,
        author_id: actorId,
        visibility: action.visibility,
      };
    } else {
      const { data: createdComment, error } = await context.supabaseAdmin
        .from("ticket_comments")
        .insert({
          ticket_id: ticket.id,
          author_id: actorId,
          visibility: action.visibility,
          body: action.body,
        })
        .select("id, author_id, visibility")
        .single();
      if (!createdComment || error)
        return response(
          request,
          { error: { code: "comment_create_failed" } },
          422,
        );
      comment = createdComment as {
        id: string;
        author_id: string;
        visibility: "internal" | "external";
      };
    }
    await context.supabaseAdmin.from("ticket_events").insert({
      ticket_id: ticket.id,
      actor_id: actorId,
      event_type:
        action.visibility === "internal"
          ? "comment.internal_added"
          : "comment.external_added",
      payload:
        action.attachmentIds.length > 0
          ? { attachmentCount: action.attachmentIds.length }
          : {},
    });
    if (action.visibility === "external" && actorId !== ticket.requester_id) {
      const firstRespondedAt = new Date().toISOString();
      const { data: firstResponseTicket, error: firstResponseUpdateError } =
        await context.supabaseAdmin
          .from("tickets")
          .update({ first_responded_at: firstRespondedAt })
          .eq("id", ticket.id)
          .eq("tenant_id", ticket.tenant_id)
          .is("first_responded_at", null)
          .select("id, first_responded_at")
          .maybeSingle();
      if (!firstResponseUpdateError && firstResponseTicket) {
        const { error: firstResponseEventError } = await context.supabaseAdmin
          .from("ticket_sla_events")
          .insert({
            ticket_id: firstResponseTicket.id,
            event_type: "first_response",
            occurred_at: firstResponseTicket.first_responded_at,
            metadata: {
              actor_id: actorId,
              comment_id: comment.id,
              comment_visibility: comment.visibility,
            },
          });
        if (firstResponseEventError) {
          await context.supabaseAdmin
            .from("tickets")
            .update({ first_responded_at: null })
            .eq("id", firstResponseTicket.id)
            .eq("tenant_id", ticket.tenant_id)
            .eq("first_responded_at", firstResponseTicket.first_responded_at);
        }
      }
    }
    return response(request, { data: { created: true } }, 201);
  }

  if (action.type === "toggleWatch") {
    if (action.watching)
      await context.supabaseAdmin
        .from("ticket_watchers")
        .upsert({ ticket_id: ticket.id, user_id: actorId });
    else
      await context.supabaseAdmin
        .from("ticket_watchers")
        .delete()
        .eq("ticket_id", ticket.id)
        .eq("user_id", actorId);
    return response(request, { data: { watching: action.watching } });
  }

  if (
    action.type === "addChecklistItem" ||
    action.type === "toggleChecklistItem"
  ) {
    if (!ticketModules.checklists)
      return response(
        request,
        { error: { code: "ticket_feature_disabled" } },
        403,
      );
    if (
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.update",
      ))
    )
      return response(
        request,
        { error: { code: "ticket_update_denied" } },
        403,
      );

    if (action.type === "addChecklistItem") {
      if (action.description.length < 1 || action.description.length > 1000)
        return response(
          request,
          { error: { code: "invalid_checklist_item" } },
          422,
        );
      const { data: item, error } = await context.supabaseAdmin
        .from("ticket_checklist_items")
        .insert({
          ticket_id: ticket.id,
          description: action.description,
          created_by: actorId,
        })
        .select(
          "id, ticket_id, description, position, completed_at, completed_by, created_by, created_at",
        )
        .single();
      if (error)
        return response(
          request,
          { error: { code: "checklist_item_create_failed" } },
          422,
        );
      await context.supabaseAdmin.from("ticket_events").insert({
        ticket_id: ticket.id,
        actor_id: actorId,
        event_type: "checklist.item_added",
        payload: { itemId: item.id, description: item.description },
      });
      return response(request, { data: { item } }, 201);
    }

    const completedAt = action.completed ? new Date().toISOString() : null;
    const { data: item, error } = await context.supabaseAdmin
      .from("ticket_checklist_items")
      .update({
        completed_at: completedAt,
        completed_by: action.completed ? actorId : null,
      })
      .eq("id", action.itemId)
      .eq("ticket_id", ticket.id)
      .select(
        "id, ticket_id, description, position, completed_at, completed_by, created_by, created_at",
      )
      .maybeSingle();
    if (error)
      return response(
        request,
        { error: { code: "checklist_item_update_failed" } },
        422,
      );
    if (!item)
      return response(
        request,
        { error: { code: "checklist_item_not_found" } },
        404,
      );
    await context.supabaseAdmin.from("ticket_events").insert({
      ticket_id: ticket.id,
      actor_id: actorId,
      event_type: action.completed
        ? "checklist.item_completed"
        : "checklist.item_reopened",
      payload: { itemId: item.id, completed: action.completed },
    });
    return response(request, { data: { item } });
  }

  if (
    !(await hasPermission(
      context.supabaseAdmin,
      actorId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.update",
    ))
  )
    return response(request, { error: { code: "ticket_update_denied" } }, 403);
  const update: Record<string, unknown> = {};
  const changedFields: string[] = [];
  let statusTransition:
    | {
        fromStatusId: string;
        toStatusKey: string;
        isClosed: boolean;
        confirmed: boolean;
        occurredAt: string;
      }
    | undefined;
  if (action.subject !== undefined && action.subject !== ticket.subject) {
    update.subject = action.subject;
    changedFields.push("subject");
  }
  if (
    action.description !== undefined &&
    action.description !== ticket.description
  ) {
    update.description = action.description;
    changedFields.push("description");
  }
  if (action.statusKey) {
    const { data: status } = await context.supabaseAdmin
      .from("ticket_statuses")
      .select("id, key, is_closed")
      .eq("tenant_id", ticket.tenant_id)
      .eq("key", action.statusKey)
      .maybeSingle();
    if (!status)
      return response(request, { error: { code: "status_invalid" } }, 422);
    if (
      status.is_closed &&
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.close",
      ))
    )
      return response(request, { error: { code: "ticket_close_denied" } }, 403);
    if (status.id !== ticket.status_id) {
      if (status.is_closed) {
        if (action.confirmClose !== true)
          return response(
            request,
            { error: { code: "ticket_close_confirmation_required" } },
            422,
          );
      }
      const occurredAt = new Date().toISOString();
      update.status_id = status.id;
      update.closed_at = status.is_closed ? occurredAt : null;
      update.resolved_at =
        status.key === "resolved" ? occurredAt : ticket.resolved_at;
      update.waiting_since = status.key.startsWith("waiting")
        ? occurredAt
        : null;
      changedFields.push("status");
      statusTransition = {
        fromStatusId: ticket.status_id,
        toStatusKey: status.key,
        isClosed: status.is_closed,
        confirmed: status.is_closed && action.confirmClose === true,
        occurredAt,
      };
    }
  }
  if (action.priorityKey) {
    const { data: priority } = await context.supabaseAdmin
      .from("ticket_priorities")
      .select("id, key")
      .eq("tenant_id", ticket.tenant_id)
      .eq("key", action.priorityKey)
      .maybeSingle();
    if (!priority)
      return response(request, { error: { code: "priority_invalid" } }, 422);
    if (priority.id !== ticket.priority_id) {
      update.priority_id = priority.id;
      changedFields.push("priority");
    }
  }
  if (
    action.requesterContactId !== undefined &&
    action.requesterContactId !== ticket.requester_contact_id
  ) {
    const { data: requesterContact, error: requesterContactError } =
      await context.supabaseAdmin
        .from("ticket_requesters")
        .select("id")
        .eq("tenant_id", ticket.tenant_id)
        .eq("id", action.requesterContactId)
        .maybeSingle();
    if (requesterContactError || !requesterContact)
      return response(
        request,
        { error: { code: "requester_contact_invalid" } },
        422,
      );
    update.requester_contact_id = requesterContact.id;
    changedFields.push("requesterContact");
  }
  if (
    action.assignedAgentId !== undefined ||
    action.assignedTeamId !== undefined
  ) {
    if (
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.assign",
      ))
    )
      return response(
        request,
        { error: { code: "ticket_assign_denied" } },
        403,
      );
    if (action.assignedAgentId !== undefined) {
      if (action.assignedAgentId !== null) {
        const eligibleAgentIds = await getEligibleTicketAgentIds(
          context.supabaseAdmin,
          {
            ...ticket,
            assigned_team_id:
              action.assignedTeamId === undefined
                ? ticket.assigned_team_id
                : action.assignedTeamId,
          },
        );
        if (eligibleAgentIds.error)
          return response(
            request,
            { error: { code: "ticket_agents_lookup_failed" } },
            500,
          );
        if (!eligibleAgentIds.agentIds.includes(action.assignedAgentId))
          return response(
            request,
            { error: { code: "assigned_agent_invalid" } },
            422,
          );
      }
      if (action.assignedAgentId !== (ticket.assigned_agent_id ?? null)) {
        update.assigned_agent_id = action.assignedAgentId;
        changedFields.push("assignedAgent");
      }
    }
    if (
      action.assignedTeamId !== undefined &&
      action.assignedAgentId === undefined &&
      ticket.assigned_agent_id
    ) {
      const eligibleAgentIds = await getEligibleTicketAgentIds(
        context.supabaseAdmin,
        {
          ...ticket,
          assigned_team_id: action.assignedTeamId,
        },
      );
      if (eligibleAgentIds.error)
        return response(
          request,
          { error: { code: "ticket_agents_lookup_failed" } },
          500,
        );
      if (!eligibleAgentIds.agentIds.includes(ticket.assigned_agent_id))
        return response(
          request,
          { error: { code: "assigned_agent_team_mismatch" } },
          422,
        );
    }
    if (
      action.assignedTeamId !== undefined &&
      action.assignedTeamId !== (ticket.assigned_team_id ?? null)
    ) {
      if (action.assignedTeamId !== null) {
        const { data: team, error: teamError } = await context.supabaseAdmin
          .from("teams")
          .select("id")
          .eq("id", action.assignedTeamId)
          .eq("tenant_id", ticket.tenant_id)
          .eq("department_id", ticket.department_id)
          .eq("active", true)
          .maybeSingle();
        if (teamError || !team) {
          return response(
            request,
            { error: { code: "assigned_team_invalid" } },
            422,
          );
        }
      }
      update.assigned_team_id = action.assignedTeamId;
      changedFields.push("assignedTeam");
    }
  }
  // Saving unchanged values is idempotent: report success without a write so
  // clients never surface a technical error for a no-op save.
  if (Object.keys(update).length === 0)
    return response(request, { data: { updated: false } });
  const { error } = await context.supabaseAdmin
    .from("tickets")
    .update(update)
    .eq("id", ticket.id)
    // Lets the push trigger recognise the acting person behind service writes.
    .setHeader(
      "x-nextdesk-actor-id",
      typeof actorId === "string" ? actorId : "",
    );
  if (error)
    return response(request, { error: { code: "ticket_update_failed" } }, 422);
  await context.supabaseAdmin.from("ticket_events").insert({
    ticket_id: ticket.id,
    actor_id: actorId,
    event_type:
      statusTransition?.isClosed === true ? "ticket.closed" : "ticket.updated",
    payload: {
      changedFields,
      ...(statusTransition ? { statusTransition } : {}),
    },
  });
  return response(request, { data: { updated: true } });
});
export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return response(request, {}, 204);
    return handler(request);
  },
};
