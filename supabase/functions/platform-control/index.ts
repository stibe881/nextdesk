import { withSupabase } from "@supabase/server";
import { isRecord, json, noContent, parseJsonObject } from "../_shared/http.ts";

type PlatformAction =
  | { type: "listTenants" }
  | {
      type: "createTenant";
      slug: string;
      name: string;
      departments: Array<{
        key: string;
        name: string;
        kind: "ict" | "infrastructure" | "custom";
      }>;
    }
  | {
      type: "updateTenant";
      tenantId: string;
      name: string;
      status: "active" | "suspended" | "archived";
    }
  | { type: "triggerPagesDeploy" };

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function parseAction(body: Record<string, unknown>): PlatformAction | null {
  if (body.type === "listTenants" || body.type === "triggerPagesDeploy") {
    return { type: body.type };
  }
  if (body.type === "createTenant") {
    if (
      typeof body.slug !== "string" ||
      typeof body.name !== "string" ||
      !Array.isArray(body.departments)
    )
      return null;
    const departments = body.departments.flatMap((department) => {
      if (
        !isRecord(department) ||
        typeof department.key !== "string" ||
        typeof department.name !== "string" ||
        !["ict", "infrastructure", "custom"].includes(String(department.kind))
      )
        return [];
      return [
        {
          key: department.key.trim(),
          name: department.name.trim(),
          kind: department.kind as "ict" | "infrastructure" | "custom",
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

async function audit(
  admin: any,
  actorId: string,
  action: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await admin.from("platform_audit_logs").insert({
    actor_id: actorId,
    action,
    target_type: targetId ? "tenant" : "platform",
    target_id: targetId,
    metadata,
  });
  if (error) console.error("Platform audit write failed", { code: error.code });
}

const securedHandler = withSupabase(
  { auth: "user" },
  async (request, context) => {
    if (request.method !== "POST") {
      return json(request, { error: { code: "method_not_allowed" } }, 405);
    }

    const body = await parseJsonObject(request);
    const action = body ? parseAction(body) : null;
    const actorId = context.userClaims?.id;
    if (!action || !isUuid(actorId)) {
      return json(request, { error: { code: "invalid_request" } }, 400);
    }

    const aal = isRecord(context.jwtClaims) ? context.jwtClaims.aal : undefined;
    if (aal !== "aal2") {
      return json(request, { error: { code: "mfa_required" } }, 403);
    }

    const { data: operator, error: operatorError } = await context.supabaseAdmin
      .from("platform_administrators")
      .select("user_id")
      .eq("user_id", actorId)
      .eq("enabled", true)
      .maybeSingle();
    if (operatorError || !operator) {
      return json(
        request,
        { error: { code: "platform_operator_required" } },
        403,
      );
    }

    if (action.type === "listTenants") {
      const { data, error } = await context.supabaseAdmin
        .from("tenants")
        .select(
          "id, slug, name, status, timezone, default_locale, created_at, updated_at",
        )
        .order("name", { ascending: true })
        .limit(200);
      if (error)
        return json(request, { error: { code: "tenant_list_failed" } }, 500);
      return json(request, {
        data: {
          canTriggerPagesDeploy: Boolean(
            Deno.env.get("GITHUB_PAGES_DEPLOY_TOKEN") &&
            Deno.env.get("GITHUB_PAGES_REPOSITORY"),
          ),
          tenants: data ?? [],
        },
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
      if (error || !isUuid(tenantId)) {
        return json(
          request,
          { error: { code: "tenant_provisioning_failed" } },
          error?.code === "42501" ? 403 : 422,
        );
      }
      await audit(
        context.supabaseAdmin,
        actorId,
        "platform.tenant.created",
        tenantId,
        { slug: action.slug },
      );
      return json(request, { data: { tenantId } }, 201);
    }

    if (action.type === "updateTenant") {
      if (action.name.length < 2 || action.name.length > 160) {
        return json(request, { error: { code: "invalid_tenant_name" } }, 422);
      }
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
      await audit(
        context.supabaseAdmin,
        actorId,
        "platform.tenant.updated",
        action.tenantId,
        { status: action.status },
      );
      return json(request, { data: { updated: true } });
    }

    const token = Deno.env.get("GITHUB_PAGES_DEPLOY_TOKEN");
    const repository = Deno.env.get("GITHUB_PAGES_REPOSITORY");
    if (!token || !repository) {
      return json(
        request,
        { error: { code: "pages_deploy_not_configured" } },
        409,
      );
    }
    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/workflows/deploy-pages.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      },
    );
    if (!response.ok) {
      console.error("GitHub Pages dispatch failed", {
        status: response.status,
      });
      return json(request, { error: { code: "pages_deploy_failed" } }, 502);
    }
    await audit(
      context.supabaseAdmin,
      actorId,
      "platform.pages_deploy.triggered",
      null,
      { repository },
    );
    return json(request, { data: { dispatched: true } }, 202);
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    return request.method === "OPTIONS"
      ? noContent(request)
      : securedHandler(request);
  },
};
