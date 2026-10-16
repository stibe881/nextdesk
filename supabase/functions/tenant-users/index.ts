import { withSupabase } from "@supabase/server";

type Action =
  | { type: "inviteUser"; tenantId: string; email: string }
  | { type: "acceptMyInvitations" };

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
  if (
    value.type === "inviteUser" &&
    isUuid(value.tenantId) &&
    typeof value.email === "string" &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.email)
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      email: value.email.trim().toLowerCase(),
    };
  }
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
  const { data: assignment } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("role_id", role.id)
    .lte("starts_at", new Date().toISOString())
    .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
    .maybeSingle();
  return Boolean(assignment);
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string")
    return json(request, { error: { code: "invalid_request" } }, 400);

  if (action.type === "inviteUser") {
    if (
      !(await isTenantAdministrator(
        context.supabaseAdmin,
        actorId,
        action.tenantId,
      ))
    ) {
      return json(request, { error: { code: "tenant_admin_required" } }, 403);
    }
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
    if (existing) {
      await context.supabaseAdmin
        .from("tenant_user_invitations")
        .update({ invited_by: actorId, expires_at: expiresAt, updated_at: now })
        .eq("id", existing.id);
    } else {
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
      .select("id, tenant_id, invited_by")
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
    const { data: requester } = await context.supabaseAdmin
      .from("roles")
      .select("id")
      .eq("tenant_id", invitation.tenant_id)
      .eq("name", "Requester")
      .eq("scope", "tenant")
      .eq("active", true)
      .maybeSingle();
    if (requester) {
      const { data: assignment } = await context.supabaseAdmin
        .from("user_role_assignments")
        .select("id")
        .eq("tenant_id", invitation.tenant_id)
        .eq("user_id", actorId)
        .eq("role_id", requester.id)
        .is("expires_at", null)
        .maybeSingle();
      if (!assignment)
        await context.supabaseAdmin.from("user_role_assignments").insert({
          tenant_id: invitation.tenant_id,
          user_id: actorId,
          role_id: requester.id,
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
