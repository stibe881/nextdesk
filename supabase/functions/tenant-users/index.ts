import { withSupabase } from "@supabase/server";

type Action =
  | { type: "inviteUser"; tenantId: string; email: string }
  | { type: "acceptMyInvitations" }
  | { type: "listUsers"; tenantId: string }
  | { type: "removeUser"; tenantId: string; userId: string }
  | { type: "revokeInvitation"; tenantId: string; invitationId: string };

type Membership = {
  user_id: string;
  status: string;
  joined_at: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
function json(request: Request, body: Record<string, unknown>, status = 200) {
  const origin = request.headers.get("origin");
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin":
        origin === "https://app.nextdesk.ch" ? origin : "",
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json; charset=utf-8",
      Vary: "Origin",
    },
  });
}
function parseAction(value: unknown): Action | null {
  if (!isRecord(value)) return null;
  if (value.type === "acceptMyInvitations") return { type: value.type };
  if (value.type === "listUsers" && isUuid(value.tenantId))
    return { type: value.type, tenantId: value.tenantId };
  if (
    value.type === "removeUser" &&
    isUuid(value.tenantId) &&
    isUuid(value.userId)
  )
    return { type: value.type, tenantId: value.tenantId, userId: value.userId };
  if (
    value.type === "revokeInvitation" &&
    isUuid(value.tenantId) &&
    isUuid(value.invitationId)
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      invitationId: value.invitationId,
    };
  if (
    value.type === "inviteUser" &&
    isUuid(value.tenantId) &&
    typeof value.email === "string" &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.email)
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      email: value.email.trim().toLowerCase(),
    };
  return null;
}
async function isTenantAdministrator(
  admin: any,
  userId: string,
  tenantId: string,
) {
  const { data: membership } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) return false;
  const { data: role } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "Tenant administrator")
    .eq("scope", "tenant")
    .eq("active", true)
    .maybeSingle();
  if (!role) return false;
  const now = new Date().toISOString();
  const { data: assignment } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("role_id", role.id)
    .lte("starts_at", now)
    .or("expires_at.is.null,expires_at.gt." + now)
    .maybeSingle();
  return Boolean(assignment);
}
async function requireTenantAdministrator(
  admin: any,
  request: Request,
  actorId: string,
  tenantId: string,
) {
  if (!(await isTenantAdministrator(admin, actorId, tenantId)))
    return json(request, { error: { code: "tenant_admin_required" } }, 403);
  return null;
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string")
    return json(request, { error: { code: "invalid_request" } }, 400);

  if (action.type === "listUsers") {
    const denied = await requireTenantAdministrator(
      context.supabaseAdmin,
      request,
      actorId,
      action.tenantId,
    );
    if (denied) return denied;
    const [
      { data: memberships, error: membershipsError },
      { data: invitations, error: invitationsError },
    ] = await Promise.all([
      context.supabaseAdmin
        .from("tenant_memberships")
        .select("user_id, status, joined_at")
        .eq("tenant_id", action.tenantId)
        .order("created_at", { ascending: true })
        .limit(200),
      context.supabaseAdmin
        .from("tenant_user_invitations")
        .select("id, email, status, expires_at, created_at")
        .eq("tenant_id", action.tenantId)
        .in("status", ["sent", "accepted"])
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    if (membershipsError || invitationsError)
      return json(request, { error: { code: "user_list_failed" } }, 500);
    const members = await Promise.all(
      ((memberships ?? []) as Membership[]).map(async (membership) => {
        const { data } = await context.supabaseAdmin.auth.admin.getUserById(
          membership.user_id,
        );
        const user = data.user;
        return {
          id: membership.user_id,
          email: user?.email ?? "Unbekannte Adresse",
          displayName:
            typeof user?.user_metadata?.full_name === "string"
              ? user.user_metadata.full_name
              : null,
          status: membership.status,
          joinedAt: membership.joined_at,
        };
      }),
    );
    return json(request, { data: { members, invitations: invitations ?? [] } });
  }

  if (action.type === "removeUser") {
    const denied = await requireTenantAdministrator(
      context.supabaseAdmin,
      request,
      actorId,
      action.tenantId,
    );
    if (denied) return denied;
    if (action.userId === actorId)
      return json(request, { error: { code: "self_removal_forbidden" } }, 422);
    const now = new Date().toISOString();
    const { error: membershipError } = await context.supabaseAdmin
      .from("tenant_memberships")
      .update({ status: "removed" })
      .eq("tenant_id", action.tenantId)
      .eq("user_id", action.userId)
      .eq("status", "active");
    if (membershipError)
      return json(request, { error: { code: "user_remove_failed" } }, 422);
    await Promise.all([
      context.supabaseAdmin
        .from("user_role_assignments")
        .update({ expires_at: now })
        .eq("tenant_id", action.tenantId)
        .eq("user_id", action.userId)
        .is("expires_at", null),
      context.supabaseAdmin.from("audit_logs").insert({
        tenant_id: action.tenantId,
        actor_id: actorId,
        action: "tenant.user.removed",
        entity_type: "tenant_membership",
        severity: "security",
        metadata: { userId: action.userId },
      }),
    ]);
    return json(request, { data: { removed: true } });
  }

  if (action.type === "revokeInvitation") {
    const denied = await requireTenantAdministrator(
      context.supabaseAdmin,
      request,
      actorId,
      action.tenantId,
    );
    if (denied) return denied;
    const { error } = await context.supabaseAdmin
      .from("tenant_user_invitations")
      .update({ status: "revoked" })
      .eq("id", action.invitationId)
      .eq("tenant_id", action.tenantId)
      .eq("status", "sent");
    if (error)
      return json(
        request,
        { error: { code: "invitation_revoke_failed" } },
        422,
      );
    return json(request, { data: { revoked: true } });
  }

  if (action.type === "inviteUser") {
    const denied = await requireTenantAdministrator(
      context.supabaseAdmin,
      request,
      actorId,
      action.tenantId,
    );
    if (denied) return denied;
    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data: existing, error: existingError } = await context.supabaseAdmin
      .from("tenant_user_invitations")
      .select("id")
      .eq("tenant_id", action.tenantId)
      .eq("email", action.email)
      .eq("status", "sent")
      .maybeSingle();
    if (existingError)
      return json(
        request,
        { error: { code: "invitation_lookup_failed" } },
        500,
      );
    if (existing)
      await context.supabaseAdmin
        .from("tenant_user_invitations")
        .update({ invited_by: actorId, expires_at: expiresAt, updated_at: now })
        .eq("id", existing.id);
    else {
      const { error } = await context.supabaseAdmin
        .from("tenant_user_invitations")
        .insert({
          tenant_id: action.tenantId,
          email: action.email,
          invited_by: actorId,
          expires_at: expiresAt,
        });
      if (error)
        return json(
          request,
          { error: { code: "invitation_create_failed" } },
          422,
        );
    }
    const { error: mailError } = await context.supabaseAdmin.auth.signInWithOtp(
      {
        email: action.email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: "https://app.nextdesk.ch/",
        },
      },
    );
    if (mailError)
      return json(request, { error: { code: "invitation_email_failed" } }, 502);
    await context.supabaseAdmin.from("audit_logs").insert({
      tenant_id: action.tenantId,
      actor_id: actorId,
      action: "tenant.user.invited",
      entity_type: "tenant_user_invitation",
      severity: "security",
      metadata: { email: action.email },
    });
    return json(request, { data: { sent: true, expiresAt } }, 201);
  }

  const email =
    typeof context.userClaims?.email === "string"
      ? context.userClaims.email.toLowerCase()
      : null;
  if (!email)
    return json(request, { error: { code: "email_claim_required" } }, 403);
  const { data: invitations, error: invitationsError } =
    await context.supabaseAdmin
      .from("tenant_user_invitations")
      .select("id, tenant_id, invited_by, role_name")
      .eq("email", email)
      .eq("status", "sent")
      .gt("expires_at", new Date().toISOString())
      .limit(20);
  if (invitationsError)
    return json(request, { error: { code: "invitation_lookup_failed" } }, 500);
  for (const invitation of invitations ?? []) {
    await context.supabaseAdmin.from("user_profiles").upsert({ id: actorId });
    await context.supabaseAdmin.from("tenant_memberships").upsert(
      {
        tenant_id: invitation.tenant_id,
        user_id: actorId,
        status: "active",
        joined_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,user_id" },
    );
    const roleName =
      typeof invitation.role_name === "string"
        ? invitation.role_name
        : "Requester";
    const { data: requestedRole } = await context.supabaseAdmin
      .from("roles")
      .select("id")
      .eq("tenant_id", invitation.tenant_id)
      .eq("name", roleName)
      .eq("scope", "tenant")
      .eq("active", true)
      .maybeSingle();
    if (requestedRole) {
      const { data: assignment } = await context.supabaseAdmin
        .from("user_role_assignments")
        .select("id")
        .eq("tenant_id", invitation.tenant_id)
        .eq("user_id", actorId)
        .eq("role_id", requestedRole.id)
        .is("expires_at", null)
        .maybeSingle();
      if (!assignment)
        await context.supabaseAdmin.from("user_role_assignments").insert({
          tenant_id: invitation.tenant_id,
          user_id: actorId,
          role_id: requestedRole.id,
          assigned_by: invitation.invited_by,
        });
    }
    await context.supabaseAdmin
      .from("tenant_user_invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invitation.id);
  }
  return json(request, { data: { accepted: invitations?.length ?? 0 } });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return json(request, {}, 204);
    return handler(request);
  },
};
