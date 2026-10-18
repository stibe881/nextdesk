import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";
type Decision = "approved" | "rejected";
type Action =
  | { type: "list"; tenantId: string; ticketId: string }
  | {
      type: "request";
      tenantId: string;
      ticketId: string;
      approvalKind: string;
      reason: string;
      requiredApprovals: number;
    }
  | {
      type: "decide";
      tenantId: string;
      ticketId: string;
      approvalId: string;
      decision: Decision;
      comment?: string;
    }
  | {
      type: "cancel";
      tenantId: string;
      ticketId: string;
      approvalId: string;
    };

type Ticket = {
  id: string;
  tenant_id: string;
  department_id: string;
  requester_id: string | null;
  affected_user_id: string | null;
  assigned_agent_id: string | null;
  customer_organization_id: string | null;
};

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const APPROVAL_KIND = /^[a-z][a-z0-9_]{1,62}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
const safeText = (value: unknown, min: number, max: number) => {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length >= min &&
    result.length <= max &&
    !/[\u0000-\u001f]/.test(result)
    ? result
    : null;
};

function headers(request: Request) {
  const responseHeaders = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    responseHeaders.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    responseHeaders.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    responseHeaders.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return responseHeaders;
}
function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId) || !isUuid(value.ticketId))
    return null;
  if (value.type === "list")
    return { type: "list", tenantId: value.tenantId, ticketId: value.ticketId };
  if (value.type === "request") {
    const approvalKind = safeText(value.approvalKind, 2, 63)?.toLowerCase();
    const reason = safeText(value.reason, 3, 2000);
    if (
      !approvalKind ||
      !APPROVAL_KIND.test(approvalKind) ||
      !reason ||
      typeof value.requiredApprovals !== "number" ||
      !Number.isInteger(value.requiredApprovals) ||
      value.requiredApprovals < 1 ||
      value.requiredApprovals > 10
    )
      return null;
    return {
      type: "request",
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      approvalKind,
      reason,
      requiredApprovals: value.requiredApprovals,
    };
  }
  if (
    value.type === "decide" &&
    isUuid(value.approvalId) &&
    (value.decision === "approved" || value.decision === "rejected")
  ) {
    const comment =
      value.comment === undefined
        ? undefined
        : safeText(value.comment, 1, 2000);
    if (value.comment !== undefined && !comment) return null;
    return {
      type: "decide",
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      approvalId: value.approvalId,
      decision: value.decision,
      ...(comment ? { comment } : {}),
    };
  }
  if (value.type === "cancel" && isUuid(value.approvalId))
    return {
      type: "cancel",
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      approvalId: value.approvalId,
    };
  return null;
}

async function activeMember(admin: any, userId: string, tenantId: string) {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return !error && Boolean(data);
}

async function hasPermission(
  admin: any,
  userId: string,
  tenantId: string,
  departmentId: string,
  permission: string,
) {
  const now = new Date().toISOString();
  const [
    { data: membership, error: membershipError },
    { data: assignments, error: assignmentsError },
  ] = await Promise.all([
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
  if (membershipError || assignmentsError || !membership) return false;
  return (assignments ?? []).some((assignment: any) => {
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

async function canReadTicket(admin: any, userId: string, ticket: Ticket) {
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
    ))
  )
    return true;
  if (
    await hasPermission(
      admin,
      userId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.read.department",
    )
  )
    return true;
  if (!ticket.customer_organization_id) return false;
  const { data } = await admin
    .from("customer_memberships")
    .select("access, customer_organizations!inner(active, ticket_access)")
    .eq("customer_organization_id", ticket.customer_organization_id)
    .eq("user_id", userId)
    .maybeSingle();
  return (
    data?.access === "company" &&
    data.customer_organizations?.active &&
    data.customer_organizations?.ticket_access !== "disabled"
  );
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string")
    return json(request, { error: { code: "invalid_request" } }, 400);

  const { data: ticket } = await context.supabaseAdmin
    .from("tickets")
    .select(
      "id, tenant_id, department_id, requester_id, affected_user_id, assigned_agent_id, customer_organization_id",
    )
    .eq("tenant_id", action.tenantId)
    .eq("id", action.ticketId)
    .maybeSingle();
  if (!ticket || !(await canReadTicket(context.supabaseAdmin, actorId, ticket)))
    return json(request, { error: { code: "ticket_access_denied" } }, 403);

  const featureStates = await resolveTenantFeatureStates(
    context.supabaseAdmin,
    ticket.tenant_id,
    ["ticketing.detail"],
  );
  if (!featureStates)
    return json(
      request,
      { error: { code: "tenant_feature_lookup_failed" } },
      503,
    );
  if (featureStates["ticketing.detail"] !== true)
    return json(request, { error: { code: "ticket_feature_disabled" } }, 403);

  const [canRequest, canDecide] = await Promise.all([
    hasPermission(
      context.supabaseAdmin,
      actorId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.approval.request",
    ),
    hasPermission(
      context.supabaseAdmin,
      actorId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.approval.decide",
    ),
  ]);

  if (action.type === "list") {
    const { data: requests, error } = await context.supabaseAdmin
      .from("ticket_approval_requests")
      .select(
        "id, ticket_id, approval_kind, status, required_approvals, requested_by, reason, requested_at, decided_at, ticket_approval_decisions(id, approver_id, decision, comment, decided_at)",
      )
      .eq("tenant_id", ticket.tenant_id)
      .eq("ticket_id", ticket.id)
      .order("requested_at", { ascending: false })
      .limit(100);
    if (error)
      return json(
        request,
        { error: { code: "ticket_approvals_lookup_failed" } },
        500,
      );
    const ids = new Set<string>();
    for (const item of requests ?? []) {
      if (isUuid(item.requested_by)) ids.add(item.requested_by);
      for (const decision of item.ticket_approval_decisions ?? [])
        if (isUuid(decision.approver_id)) ids.add(decision.approver_id);
    }
    const { data: profiles } = ids.size
      ? await context.supabaseAdmin
          .from("user_profiles")
          .select("id, display_name")
          .in("id", [...ids])
      : { data: [] };
    const names = new Map(
      (profiles ?? []).map((profile: any) => [
        profile.id,
        typeof profile.display_name === "string"
          ? profile.display_name
          : "nextDesk Benutzer",
      ]),
    );
    return json(request, {
      data: {
        canRequest,
        canDecide,
        approvals: (requests ?? []).map((item: any) => ({
          id: item.id,
          approvalKind: item.approval_kind,
          status: item.status as ApprovalStatus,
          requiredApprovals: item.required_approvals,
          requestedBy: item.requested_by,
          requestedByName: names.get(item.requested_by) ?? "nextDesk Benutzer",
          reason: item.reason,
          requestedAt: item.requested_at,
          decidedAt: item.decided_at,
          decisions: (item.ticket_approval_decisions ?? []).map(
            (decision: any) => ({
              id: decision.id,
              approverId: decision.approver_id,
              approverName:
                names.get(decision.approver_id) ?? "nextDesk Benutzer",
              decision: decision.decision as Decision,
              comment: decision.comment,
              decidedAt: decision.decided_at,
            }),
          ),
        })),
      },
    });
  }

  if (action.type === "request") {
    if (!canRequest)
      return json(
        request,
        { error: { code: "ticket_approval_request_denied" } },
        403,
      );
    const { data, error } = await context.supabaseAdmin.rpc(
      "create_ticket_approval_request",
      {
        p_actor_id: actorId,
        p_tenant_id: ticket.tenant_id,
        p_ticket_id: ticket.id,
        p_approval_kind: action.approvalKind,
        p_reason: action.reason,
        p_required_approvals: action.requiredApprovals,
      },
    );
    if (error)
      return json(
        request,
        { error: { code: "ticket_approval_request_failed" } },
        error.code === "23505" ? 409 : 422,
      );
    return json(request, { data }, 201);
  }

  if (action.type === "decide") {
    if (!canDecide)
      return json(
        request,
        { error: { code: "ticket_approval_decision_denied" } },
        403,
      );
    const { data, error } = await context.supabaseAdmin.rpc(
      "decide_ticket_approval",
      {
        p_actor_id: actorId,
        p_tenant_id: ticket.tenant_id,
        p_approval_id: action.approvalId,
        p_decision: action.decision,
        p_comment: action.comment ?? null,
      },
    );
    if (error)
      return json(
        request,
        { error: { code: "ticket_approval_decision_failed" } },
        error.code === "23505" ? 409 : 422,
      );
    return json(request, { data });
  }

  const { data, error } = await context.supabaseAdmin.rpc(
    "cancel_ticket_approval",
    {
      p_actor_id: actorId,
      p_tenant_id: ticket.tenant_id,
      p_approval_id: action.approvalId,
    },
  );
  if (error)
    return json(
      request,
      { error: { code: "ticket_approval_cancellation_failed" } },
      error.code === "42501" ? 403 : 422,
    );
  return json(request, { data });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: headers(request) });
    return handler(request);
  },
};
