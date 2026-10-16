import { withSupabase } from "@supabase/server";

type Department = {
  key: string;
  name: string;
  kind: "ict" | "infrastructure" | "custom";
};
type Action =
  | { type: "listTenants" }
  | {
      type: "createTenant";
      slug: string;
      name: string;
      departments: Department[];
    }
  | {
      type: "updateTenant";
      tenantId: string;
      name: string;
      status: "active" | "suspended" | "archived";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function parseAction(body: unknown): Action | null {
  if (!isRecord(body)) return null;
  if (body.type === "listTenants") return { type: "listTenants" };
  if (body.type === "createTenant") {
    if (
      typeof body.slug !== "string" ||
      typeof body.name !== "string" ||
      !Array.isArray(body.departments)
    )
      return null;
    const departments = body.departments.flatMap((item) => {
      if (
        !isRecord(item) ||
        typeof item.key !== "string" ||
        typeof item.name !== "string" ||
        !["ict", "infrastructure", "custom"].includes(String(item.kind))
      )
        return [];
      return [
        {
          key: item.key.trim(),
          name: item.name.trim(),
          kind: item.kind as Department["kind"],
        },
      ];
    });
    return departments.length === body.departments.length &&
      departments.length > 0
      ? {
          type: "createTenant",
          slug: body.slug.trim().toLowerCase(),
          name: body.name.trim(),
          departments,
        }
      : null;
  }
  if (
    body.type === "updateTenant" &&
    isUuid(body.tenantId) &&
    typeof body.name === "string" &&
    ["active", "suspended", "archived"].includes(String(body.status))
  ) {
    return {
      type: "updateTenant",
      tenantId: body.tenantId,
      name: body.name.trim(),
      status: body.status as "active" | "suspended" | "archived",
    };
  }
  return null;
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string")
    return json(request, { error: { code: "invalid_request" } }, 400);

  const { data: userData, error: userError } =
    await context.supabaseAdmin.auth.admin.getUserById(actorId);
  const providers = isRecord(userData.user?.app_metadata)
    ? userData.user.app_metadata.providers
    : undefined;
  if (userError || !Array.isArray(providers) || !providers.includes("azure"))
    return json(request, { error: { code: "sso_required" } }, 403);
  const { data: operator, error: operatorError } = await context.supabaseAdmin
    .from("platform_administrators")
    .select("user_id")
    .eq("user_id", actorId)
    .eq("enabled", true)
    .maybeSingle();
  if (operatorError || !operator)
    return json(
      request,
      { error: { code: "platform_operator_required" } },
      403,
    );
  const aal = isRecord(context.jwtClaims) ? context.jwtClaims.aal : undefined;
  if (aal !== "aal2")
    return json(request, { error: { code: "mfa_required" } }, 403);
  await context.supabaseAdmin
    .from("platform_administrators")
    .update({ mfa_verified_at: new Date().toISOString() })
    .eq("user_id", actorId);

  if (action.type === "listTenants") {
    const { data, error } = await context.supabaseAdmin
      .from("tenants")
      .select("id, slug, name, status, created_at, updated_at")
      .order("name", { ascending: true })
      .limit(200);
    if (error)
      return json(request, { error: { code: "tenant_list_failed" } }, 500);
    return json(request, {
      data: { tenants: data ?? [], canTriggerDeployment: false },
    });
  }

  if (action.type === "createTenant") {
    const { data: tenantId, error } = await context.supabaseAdmin.rpc(
      "provision_tenant",
      {
        p_actor_id: actorId,
        p_slug: action.slug,
        p_name: action.name,
        p_initial_admin_user_id: actorId,
        p_departments: action.departments,
      },
    );
    if (error || !isUuid(tenantId))
      return json(
        request,
        { error: { code: "tenant_provisioning_failed" } },
        422,
      );
    return json(request, { data: { tenantId } }, 201);
  }

  if (action.name.length < 2 || action.name.length > 160)
    return json(request, { error: { code: "invalid_tenant_name" } }, 422);
  const { error } = await context.supabaseAdmin
    .from("tenants")
    .update({
      name: action.name,
      status: action.status,
      archived_at:
        action.status === "archived" ? new Date().toISOString() : null,
    })
    .eq("id", action.tenantId);
  if (error)
    return json(request, { error: { code: "tenant_update_failed" } }, 422);
  await context.supabaseAdmin.from("platform_audit_logs").insert({
    actor_id: actorId,
    action: "platform.tenant.updated",
    target_type: "tenant",
    target_id: action.tenantId,
    metadata: { status: action.status },
  });
  return json(request, { data: { updated: true } });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return json(request, {}, 204);
    return handler(request);
  },
};
