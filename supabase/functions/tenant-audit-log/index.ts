import { withSupabase } from "@supabase/server";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuditRequest = {
  type: "list";
  tenantId: string;
  limit: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function parseRequest(value: unknown): AuditRequest | null {
  if (
    !isRecord(value) ||
    value.type !== "list" ||
    !isUuid(value.tenantId) ||
    (value.limit !== undefined &&
      (typeof value.limit !== "number" ||
        !Number.isInteger(value.limit) ||
        value.limit < 1 ||
        value.limit > 100))
  ) {
    return null;
  }

  return {
    type: "list",
    tenantId: value.tenantId,
    limit: typeof value.limit === "number" ? value.limit : 50,
  };
}

function corsHeaders(request: Request): HeadersInit {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
    headers["Access-Control-Allow-Headers"] =
      "authorization, apikey, content-type, x-client-info";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return headers;
}

function json(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function isTenantAdministrator(
  admin: any,
  actorId: string,
  tenantId: string,
): Promise<"allowed" | "forbidden" | "error"> {
  const { data: membership, error: membershipError } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) return "error";
  if (!membership) return "forbidden";

  const now = new Date().toISOString();
  const { data: assignments, error: assignmentError } = await admin
    .from("user_role_assignments")
    .select(
      "roles!user_role_assignments_role_tenant_fk!inner(name, scope, active)",
    )
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .limit(50);
  if (assignmentError) return "error";

  const allowed = (assignments ?? []).some((assignment: any) => {
    const role = assignment.roles as
      | { name?: string; scope?: string; active?: boolean }
      | Array<{ name?: string; scope?: string; active?: boolean }>
      | null;
    const candidate = Array.isArray(role) ? role[0] : role;
    return (
      candidate?.name === "Tenant administrator" &&
      candidate.scope === "tenant" &&
      candidate.active === true
    );
  });
  return allowed ? "allowed" : "forbidden";
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  }

  const body = await request.json().catch(() => null);
  const input = parseRequest(body);
  const actorId = context.userClaims?.id;
  if (!input || !isUuid(actorId)) {
    return json(request, { error: { code: "invalid_request" } }, 400);
  }

  const authorization = await isTenantAdministrator(
    context.supabaseAdmin,
    actorId,
    input.tenantId,
  );
  if (authorization === "error") {
    return json(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  }
  if (authorization !== "allowed") {
    return json(request, { error: { code: "tenant_admin_required" } }, 403);
  }

  const { data, error } = await context.supabaseAdmin
    .from("audit_logs")
    .select(
      "id, actor_id, action, entity_type, entity_id, severity, occurred_at",
    )
    .eq("tenant_id", input.tenantId)
    .order("occurred_at", { ascending: false })
    .limit(input.limit + 1);
  if (error) {
    return json(request, { error: { code: "audit_log_read_failed" } }, 500);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    actor_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    severity: string;
    occurred_at: string;
  }>;
  const actorIds = [
    ...new Set(
      rows
        .map((row) => row.actor_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const { data: profiles, error: profileError } =
    actorIds.length === 0
      ? { data: [], error: null }
      : await context.supabaseAdmin
          .from("user_profiles")
          .select("id, display_name")
          .in("id", actorIds)
          .limit(100);
  if (profileError) {
    return json(
      request,
      { error: { code: "audit_log_actor_read_failed" } },
      500,
    );
  }

  const actorNames = new Map(
    (
      (profiles ?? []) as Array<{ id: string; display_name: string | null }>
    ).map((profile) => [profile.id, profile.display_name]),
  );
  const entries = rows.slice(0, input.limit).map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    severity: row.severity,
    occurredAt: row.occurred_at,
    actorName: row.actor_id
      ? actorNames.get(row.actor_id)?.trim() || "Benutzerkonto"
      : "System",
  }));

  return json(request, {
    data: { entries, truncated: rows.length > input.limit },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    return handler(request);
  },
};
