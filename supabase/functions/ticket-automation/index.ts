import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const APP_ORIGIN = "https://app.nextdesk.ch";
const POLICY_KEYS = [
  "follow_up",
  "auto_close",
  "duplicate_warning",
  "data_hygiene",
  "quality_check",
  "compliance_warning",
  "operations_report",
] as const;
type PolicyKey = (typeof POLICY_KEYS)[number];
type Policy = {
  key: PolicyKey;
  enabled: boolean;
  afterDays: number;
  requirePreview: boolean;
  updatedAt: string | null;
};
type Action =
  | { type: "get"; tenantId: string }
  | {
      type: "save";
      tenantId: string;
      policyKey: PolicyKey;
      enabled: boolean;
      afterDays: number;
      requirePreview: boolean;
    }
  | { type: "preview"; tenantId: string }
  | {
      type: "executeAutoClose";
      tenantId: string;
      ticketIds: string[];
      confirmed: true;
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
function isPolicyKey(value: unknown): value is PolicyKey {
  return (
    typeof value === "string" &&
    (POLICY_KEYS as readonly string[]).includes(value)
  );
}
function validDays(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 365
  );
}
function headers(request: Request): HeadersInit {
  const values: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
  if (request.headers.get("origin") === APP_ORIGIN)
    values["Access-Control-Allow-Origin"] = APP_ORIGIN;
  return values;
}
function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}
function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  if (
    value.type === "get" &&
    Object.keys(value).every((key) => key === "type" || key === "tenantId")
  )
    return { type: "get", tenantId: value.tenantId };
  if (
    value.type === "preview" &&
    Object.keys(value).every((key) => key === "type" || key === "tenantId")
  )
    return { type: "preview", tenantId: value.tenantId };
  if (
    value.type === "executeAutoClose" &&
    Object.keys(value).every(
      (key) =>
        key === "type" ||
        key === "tenantId" ||
        key === "ticketIds" ||
        key === "confirmed",
    ) &&
    Array.isArray(value.ticketIds) &&
    value.ticketIds.length >= 1 &&
    value.ticketIds.length <= 50 &&
    value.ticketIds.every(isUuid) &&
    new Set(value.ticketIds).size === value.ticketIds.length &&
    value.confirmed === true
  ) {
    return {
      type: "executeAutoClose",
      tenantId: value.tenantId,
      ticketIds: value.ticketIds,
      confirmed: true,
    };
  }
  if (
    value.type === "save" &&
    Object.keys(value).every((key) =>
      [
        "type",
        "tenantId",
        "policyKey",
        "enabled",
        "afterDays",
        "requirePreview",
      ].includes(key),
    ) &&
    isPolicyKey(value.policyKey) &&
    typeof value.enabled === "boolean" &&
    validDays(value.afterDays) &&
    typeof value.requirePreview === "boolean"
  ) {
    return {
      type: "save",
      tenantId: value.tenantId,
      policyKey: value.policyKey,
      enabled: value.enabled,
      afterDays: value.afterDays,
      requirePreview: value.requirePreview,
    };
  }
  return null;
}
function one(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isRecord(candidate) ? candidate : null;
}
function asPolicy(row: unknown): Policy | null {
  if (
    !isRecord(row) ||
    !isPolicyKey(row.policy_key) ||
    typeof row.enabled !== "boolean"
  )
    return null;
  const config = isRecord(row.configuration) ? row.configuration : {};
  return {
    key: row.policy_key,
    enabled: row.enabled,
    afterDays: validDays(config.afterDays) ? config.afterDays : 7,
    requirePreview: config.requirePreview !== false,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}
async function allowed(
  admin: any,
  actorId: string,
  tenantId: string,
): Promise<boolean | null> {
  const now = new Date().toISOString();
  const [
    { data: membership, error: membershipError },
    { data: roles, error: roleError },
  ] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("user_role_assignments")
      .select(
        "roles!user_role_assignments_role_tenant_fk!inner(active, role_permissions!inner(permission_code))",
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`),
  ]);
  if (membershipError || roleError) return null;
  const authorized = (roles ?? []).some((assignment: any) => {
    const role = one(assignment.roles);
    const permissions =
      role && Array.isArray(role.role_permissions) ? role.role_permissions : [];
    return (
      role?.active === true &&
      permissions.some(
        (permission) =>
          isRecord(permission) &&
          permission.permission_code === "automation.manage",
      )
    );
  });
  return Boolean(membership) && authorized;
}
function olderThan(value: unknown, days: number, nowMs: number) {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) && timestamp <= nowMs - days * 86_400_000;
}
function reference(row: Record<string, unknown>) {
  return {
    id: typeof row.id === "string" ? row.id : "",
    ticketNumber:
      typeof row.ticket_number === "string" ? row.ticket_number : "",
    subject: typeof row.subject === "string" ? row.subject.slice(0, 160) : "",
  };
}
function normalizedSubject(value: unknown) {
  return typeof value === "string"
    ? value
        .normalize("NFKC")
        .toLocaleLowerCase("de-CH")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
    : "";
}

async function previewPolicies(
  admin: any,
  tenantId: string,
  policies: Policy[],
) {
  const { data: tickets, error } = await admin
    .from("tickets")
    .select(
      "id, ticket_number, subject, created_at, updated_at, resolved_at, closed_at, requester_contact_id, category_id",
    )
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new Error("automation_ticket_query_failed");
  const rows: Record<string, unknown>[] = (tickets ?? []).filter(isRecord);
  const now = Date.now();
  const closedIds = rows
    .filter((row) => row.closed_at !== null && typeof row.id === "string")
    .map((row) => row.id);
  const { data: qualityRows, error: qualityError } = closedIds.length
    ? await admin
        .from("ticket_quality_reviews")
        .select("ticket_id")
        .in("ticket_id", closedIds)
    : { data: [], error: null };
  if (qualityError) throw new Error("automation_quality_query_failed");
  const reviewed = new Set<string>(
    ((qualityRows ?? []).filter(isRecord) as Record<string, unknown>[])
      .map((row: Record<string, unknown>) => row.ticket_id)
      .filter((id: unknown): id is string => typeof id === "string"),
  );
  const previews = policies.map((policy) => {
    let matches: Record<string, unknown>[] = [];
    let summary = "";
    if (policy.key === "follow_up") {
      matches = rows.filter(
        (row) =>
          row.closed_at === null &&
          olderThan(row.updated_at, policy.afterDays, now),
      );
      summary = "Offene Tickets ohne aktuelle Aktivität";
    }
    if (policy.key === "auto_close") {
      matches = rows.filter(
        (row) =>
          row.closed_at === null &&
          olderThan(row.resolved_at, policy.afterDays, now),
      );
      summary = policy.requirePreview
        ? "Vorgemerkte Schliessungen – vor Ausführung prüfen"
        : "Schliesskandidaten nach Lösungsphase";
    }
    if (policy.key === "data_hygiene") {
      matches = rows.filter(
        (row) =>
          row.closed_at === null &&
          (!row.requester_contact_id || !row.category_id),
      );
      summary = "Offene Tickets ohne Anfragende Person oder Kategorie";
    }
    if (policy.key === "quality_check") {
      matches = rows.filter(
        (row) =>
          row.closed_at !== null &&
          typeof row.id === "string" &&
          !reviewed.has(row.id) &&
          olderThan(row.closed_at, policy.afterDays, now),
      );
      summary = "Abgeschlossene Tickets ohne Qualitätsprüfung";
    }
    if (policy.key === "compliance_warning") {
      matches = rows.filter(
        (row) => row.closed_at === null && !row.requester_contact_id,
      );
      summary = "Tickets mit fehlender Anfragendenzuordnung";
    }
    if (policy.key === "duplicate_warning") {
      const seen = new Map<string, Record<string, unknown>[]>();
      for (const row of rows.filter(
        (candidate) =>
          candidate.closed_at === null &&
          olderThan(candidate.created_at, policy.afterDays, now),
      )) {
        const key = normalizedSubject(row.subject);
        if (key.length >= 5) seen.set(key, [...(seen.get(key) ?? []), row]);
      }
      matches = [...seen.values()].filter((group) => group.length > 1).flat();
      summary = "Ähnliche offene Ticketbetreffe";
    }
    if (policy.key === "operations_report") {
      matches = rows;
      summary = "Betriebsbericht über Tickets im aktuellen Bestand";
    }
    return {
      key: policy.key,
      enabled: policy.enabled,
      afterDays: policy.afterDays,
      requirePreview: policy.requirePreview,
      summary,
      count: matches.length,
      examples: matches.slice(0, 8).map(reference),
    };
  });
  return previews;
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !isUuid(actorId))
    return json(request, { error: { code: "invalid_request" } }, 400);
  const permitted = await allowed(
    context.supabaseAdmin,
    actorId,
    action.tenantId,
  );
  if (permitted === null)
    return json(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  if (!permitted)
    return json(request, { error: { code: "automation_manage_denied" } }, 403);

  const featureStates = await resolveTenantFeatureStates(
    context.supabaseAdmin,
    action.tenantId,
    ["automation.sla"],
  );
  if (featureStates === null)
    return json(
      request,
      { error: { code: "tenant_feature_lookup_failed" } },
      503,
    );
  if (featureStates["automation.sla"] !== true)
    return json(
      request,
      { error: { code: "automation_feature_inactive" } },
      403,
    );

  if (action.type === "save") {
    const { data, error } = await context.supabaseAdmin
      .from("tenant_automation_policies")
      .upsert(
        {
          tenant_id: action.tenantId,
          policy_key: action.policyKey,
          enabled: action.enabled,
          configuration: {
            afterDays: action.afterDays,
            requirePreview: action.requirePreview,
          },
          updated_by: actorId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,policy_key" },
      )
      .select("policy_key, enabled, configuration, updated_at")
      .maybeSingle();
    if (error)
      return json(
        request,
        { error: { code: "automation_policy_save_failed" } },
        422,
      );
    await context.supabaseAdmin.from("audit_logs").insert({
      tenant_id: action.tenantId,
      actor_id: actorId,
      action: "automation.policy.updated",
      entity_type: "tenant_automation_policy",
      entity_id: null,
      severity: "info",
      metadata: {
        policyKey: action.policyKey,
        enabled: action.enabled,
        afterDays: action.afterDays,
        requirePreview: action.requirePreview,
      },
    });
    const policy = asPolicy(data);
    return policy
      ? json(request, { data: { policy } })
      : json(
          request,
          { error: { code: "automation_policy_response_invalid" } },
          500,
        );
  }

  const { data, error } = await context.supabaseAdmin
    .from("tenant_automation_policies")
    .select("policy_key, enabled, configuration, updated_at")
    .eq("tenant_id", action.tenantId)
    .order("policy_key");
  if (error)
    return json(
      request,
      { error: { code: "automation_policy_query_failed" } },
      500,
    );
  const policies = (data ?? [])
    .map(asPolicy)
    .filter((policy): policy is Policy => policy !== null);
  if (action.type === "get") return json(request, { data: { policies } });

  if (action.type === "executeAutoClose") {
    const policy = policies.find((entry) => entry.key === "auto_close");
    if (!policy?.enabled)
      return json(
        request,
        { error: { code: "automation_auto_close_inactive" } },
        422,
      );

    try {
      const previews = await previewPolicies(
        context.supabaseAdmin,
        action.tenantId,
        [policy],
      );
      const candidates = new Set(
        previews[0]?.examples.map((ticket) => ticket.id) ?? [],
      );
      if (!action.ticketIds.every((ticketId) => candidates.has(ticketId)))
        return json(
          request,
          { error: { code: "automation_auto_close_candidates_changed" } },
          409,
        );

      const { data: result, error: closeError } =
        await context.supabaseAdmin.rpc("bulk_update_ticket_statuses", {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_ticket_ids: action.ticketIds,
          p_status_key: "closed",
          p_confirm_close: action.confirmed,
        });
      if (closeError || !isRecord(result))
        return json(
          request,
          { error: { code: "automation_auto_close_failed" } },
          422,
        );
      const updated =
        typeof result.updated === "number" && Number.isInteger(result.updated)
          ? result.updated
          : null;
      if (updated === null)
        return json(
          request,
          { error: { code: "automation_auto_close_failed" } },
          422,
        );
      const { error: runError } = await context.supabaseAdmin
        .from("tenant_automation_runs")
        .insert({
          tenant_id: action.tenantId,
          policy_key: "auto_close",
          initiated_by: actorId,
          mode: "manual",
          result: {
            requested: action.ticketIds.length,
            updated,
            confirmed: action.confirmed,
          },
        });
      if (runError)
        return json(
          request,
          { error: { code: "automation_auto_close_audit_failed" } },
          500,
        );
      await context.supabaseAdmin.from("audit_logs").insert({
        tenant_id: action.tenantId,
        actor_id: actorId,
        action: "automation.auto_close.executed",
        entity_type: "tenant_automation_policy",
        entity_id: null,
        severity: "warning",
        metadata: {
          requested: action.ticketIds.length,
          updated,
          confirmed: action.confirmed,
        },
      });
      return json(request, {
        data: { requested: action.ticketIds.length, updated },
      });
    } catch {
      return json(
        request,
        { error: { code: "automation_auto_close_preview_failed" } },
        500,
      );
    }
  }

  try {
    const previews = await previewPolicies(
      context.supabaseAdmin,
      action.tenantId,
      policies,
    );
    const { error: runError } = await context.supabaseAdmin
      .from("tenant_automation_runs")
      .insert({
        tenant_id: action.tenantId,
        policy_key: "operations_report",
        initiated_by: actorId,
        mode: "preview",
        result: { previews },
      });
    if (runError)
      return json(
        request,
        { error: { code: "automation_preview_audit_failed" } },
        500,
      );
    return json(request, {
      data: { previews, generatedAt: new Date().toISOString() },
    });
  } catch {
    return json(request, { error: { code: "automation_preview_failed" } }, 500);
  }
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    return request.method === "OPTIONS"
      ? new Response(null, { status: 204, headers: headers(request) })
      : handler(request);
  },
};
