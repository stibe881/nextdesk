import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";

/**
 * Monitoring (PRTG) administration: read and save the tenant's webhook
 * configuration, rotate the webhook token (shown once) and list recent
 * alerts. Requires an active membership and tenant.settings.manage; rows are
 * read and written with the service role after these checks.
 * Deploy with `[functions.monitoring-integrations] verify_jwt = true`.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 8 * 1024;
const CREATE_ON = ["down", "down_and_warning"] as const;
const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// The ticket settings of the first PRTG version (department, priority,
// auto-resolve) are no longer used: PRTG opens incidents, not tickets. The
// columns stay in the database; older clients may still send the fields and
// they are ignored.
export type ConfigInput = {
  enabled: boolean;
  teamId: string | null;
  createOn: (typeof CREATE_ON)[number];
  setServiceStatus: boolean;
  /** Minutes until an unacknowledged incident alarms again; 0 = never. */
  realertMinutes: number;
  groupDependencies: boolean;
  suppressInMaintenance: boolean;
};

type Action =
  | { type: "get"; tenantId: string }
  | { type: "save"; tenantId: string; config: ConfigInput }
  | { type: "rotateToken"; tenantId: string }
  | { type: "listAlerts"; tenantId: string }
  | { type: "closeAlert"; tenantId: string; alertId: string };

export function parseConfig(value: unknown): ConfigInput | null {
  if (!isRecord(value)) return null;
  const teamId =
    value.teamId === null || value.teamId === undefined || value.teamId === ""
      ? null
      : isUuid(value.teamId)
        ? value.teamId.toLowerCase()
        : undefined;
  const createOn = (CREATE_ON as readonly unknown[]).includes(value.createOn)
    ? (value.createOn as ConfigInput["createOn"])
    : undefined;
  // Incident options; older clients do not send them, so defaults apply.
  const realertMinutes =
    value.realertMinutes === undefined
      ? 15
      : typeof value.realertMinutes === "number" &&
          Number.isInteger(value.realertMinutes) &&
          value.realertMinutes >= 0 &&
          value.realertMinutes <= 1440
        ? value.realertMinutes
        : undefined;
  const flag = (entry: unknown) =>
    entry === undefined ? true : typeof entry === "boolean" ? entry : undefined;
  const groupDependencies = flag(value.groupDependencies);
  const suppressInMaintenance = flag(value.suppressInMaintenance);
  if (
    realertMinutes === undefined ||
    groupDependencies === undefined ||
    suppressInMaintenance === undefined ||
    typeof value.enabled !== "boolean" ||
    typeof value.setServiceStatus !== "boolean" ||
    teamId === undefined ||
    !createOn
  ) {
    return null;
  }
  return {
    enabled: value.enabled,
    teamId,
    createOn,
    setServiceStatus: value.setServiceStatus,
    realertMinutes,
    groupDependencies,
    suppressInMaintenance,
  };
}

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  switch (value.type) {
    case "get":
    case "rotateToken":
    case "listAlerts":
      return { type: value.type, tenantId };
    case "save": {
      const config = parseConfig(value.config);
      return config ? { type: "save", tenantId, config } : null;
    }
    case "closeAlert":
      return isUuid(value.alertId)
        ? { type: "closeAlert", tenantId, alertId: value.alertId.toLowerCase() }
        : null;
    default:
      return null;
  }
}

/** 32 random bytes as base64url (43 characters). */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function webhookUrl(supabaseUrl: string, token: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/monitoring-webhook?token=${encodeURIComponent(
    token,
  )}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function dbFailure(): HttpError {
  return new HttpError(
    500,
    "database_error",
    "Die Daten konnten nicht verarbeitet werden.",
  );
}

async function readBody(request: Request): Promise<unknown> {
  const body = await request.text().catch(() => null);
  if (body === null || encoder.encode(body).length > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "payload_too_large", "Die Anfrage ist zu gross.");
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function requireTenantAdmin(
  admin: Admin,
  tenantId: string,
  actorId: string,
): Promise<void> {
  const membership = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  if (membership.error) throw dbFailure();
  if (!membership.data) {
    throw new HttpError(
      403,
      "tenant_access_denied",
      "Kein Zugriff auf diesen Mandanten.",
    );
  }
  const allowed = await admin.rpc("user_has_tenant_permission", {
    p_user_id: actorId,
    p_tenant_id: tenantId,
    p_permission_code: "tenant.settings.manage",
  });
  if (allowed.error || allowed.data !== true) {
    throw new HttpError(
      403,
      "forbidden",
      "Für die Monitoring-Einstellungen fehlt Ihnen die Berechtigung.",
    );
  }
}

function configFromRow(row: Row | null) {
  return {
    configured: row !== null,
    enabled: row?.enabled === true,
    teamId: (row?.team_id as string | null) ?? null,
    createOn: (row?.create_on as string | undefined) ?? "down",
    setServiceStatus: row?.set_service_status === true,
    realertMinutes:
      typeof row?.realert_minutes === "number" ? row.realert_minutes : 15,
    groupDependencies: row?.group_dependencies !== false,
    suppressInMaintenance: row?.suppress_in_maintenance !== false,
    hasToken: typeof row?.token_hash === "string",
    tokenRotatedAt: (row?.token_rotated_at as string | null) ?? null,
    lastReceivedAt: (row?.last_received_at as string | null) ?? null,
  };
}

async function loadIntegration(admin: Admin, tenantId: string) {
  const { data, error } = await admin
    .from("monitoring_integrations")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw dbFailure();
  return (data as Row | null) ?? null;
}

async function listAlerts(admin: Admin, tenantId: string) {
  const { data, error } = await admin
    .from("monitoring_alerts")
    .select(
      "id, external_key, device_name, sensor_name, asset_id, ticket_id, state, last_status, last_message, event_count, opened_at, resolved_at, last_event_at",
    )
    .eq("tenant_id", tenantId)
    .order("opened_at", { ascending: false })
    .limit(50);
  if (error) throw dbFailure();
  const rows = (data ?? []) as Row[];
  const ticketIds = [
    ...new Set(
      rows
        .map((row) => row.ticket_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const tickets = ticketIds.length
    ? await admin
        .from("tickets")
        .select("id, ticket_number")
        .is("deleted_at", null)
        .eq("tenant_id", tenantId)
        .in("id", ticketIds)
    : { data: [], error: null };
  if (tickets.error) throw dbFailure();
  const numbers = new Map(
    ((tickets.data ?? []) as Row[]).map((row) => [
      String(row.id),
      String(row.ticket_number),
    ]),
  );
  return rows.map((row) => ({
    id: row.id,
    deviceName: row.device_name ?? null,
    sensorName: row.sensor_name ?? null,
    assetId: row.asset_id ?? null,
    ticketId: row.ticket_id ?? null,
    ticketNumber:
      typeof row.ticket_id === "string"
        ? (numbers.get(row.ticket_id) ?? null)
        : null,
    state: row.state,
    lastStatus: row.last_status ?? null,
    lastMessage: row.last_message ?? null,
    eventCount: row.event_count ?? 1,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at ?? null,
    lastEventAt: row.last_event_at ?? null,
  }));
}

async function get(request: Request, admin: Admin, tenantId: string) {
  const [integration, departments, teams, alerts] =
    await Promise.all([
    loadIntegration(admin, tenantId),
    admin
      .from("departments")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name"),
    admin
      .from("teams")
      .select("id, name, department_id")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name"),
    listAlerts(admin, tenantId),
  ]);
  if (departments.error || teams.error) throw dbFailure();
  return json(request, {
    data: {
      config: configFromRow(integration),
      departments: ((departments.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        name: row.name,
      })),
      teams: ((teams.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        name: row.name,
        departmentId: row.department_id ?? null,
      })),
      alerts,
    },
  });
}

/**
 * Closes an open alert by hand, e.g. when PRTG's «Up» never arrived. Services
 * monitoring had set go back to operational unless another open alert still
 * holds them; manual outages and maintenance stay untouched.
 */
async function closeAlert(
  request: Request,
  admin: Admin,
  actorId: string,
  tenantId: string,
  alertId: string,
) {
  const { data: alert, error } = await admin
    .from("monitoring_alerts")
    .select(
      "id, state, service_id, service_ids, service_statuses, service_status_applied",
    )
    .eq("tenant_id", tenantId)
    .eq("id", alertId)
    .maybeSingle();
  if (error) throw dbFailure();
  if (!alert) {
    throw new HttpError(404, "alert_not_found", "Der Alarm ist nicht verfügbar.");
  }
  if (alert.state !== "open") {
    return json(request, { data: { closed: false, restoredServices: 0 } });
  }
  const now = new Date().toISOString();
  const closed = await admin
    .from("monitoring_alerts")
    .update({
      state: "resolved",
      resolved_at: now,
      last_message: "Manuell beendet",
      last_event_at: now,
    })
    .eq("tenant_id", tenantId)
    .eq("id", alertId)
    .eq("state", "open");
  if (closed.error) throw dbFailure();

  const applied = (alert.service_statuses ?? {}) as Record<string, string>;
  const serviceIds = Object.keys(applied).length
    ? Object.keys(applied)
    : alert.service_id && alert.service_status_applied
    ? [String(alert.service_id)]
    : [];
  let restored = 0;
  for (const serviceId of serviceIds) {
    const others = await admin
      .from("monitoring_alerts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("state", "open")
      .not(`service_statuses->>${serviceId}`, "is", null)
      .neq("id", alertId)
      .limit(1);
    if (others.error) throw dbFailure();
    if ((others.data ?? []).length > 0) continue;
    const updated = await admin
      .from("services")
      .update({ status: "operational" })
      .eq("tenant_id", tenantId)
      .eq("id", serviceId)
      .in("status", ["degraded", "partial_outage"])
      .select("id");
    if (!updated.error) restored += (updated.data ?? []).length;
  }
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "monitoring.alert.closed",
    entity_type: "monitoring_alert",
    entity_id: alertId,
    severity: "info",
    metadata: { provider: "prtg", restoredServices: restored },
  });
  return json(request, { data: { closed: true, restoredServices: restored } });
}

async function save(
  request: Request,
  admin: Admin,
  actorId: string,
  tenantId: string,
  config: ConfigInput,
) {
  if (config.teamId) {
    const { data, error } = await admin
      .from("teams")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", config.teamId)
      .eq("active", true)
      .maybeSingle();
    if (error) throw dbFailure();
    if (!data) {
      throw new HttpError(
        422,
        "team_invalid",
        "Das Team ist nicht verfügbar.",
      );
    }
  }
  const { data, error } = await admin
    .from("monitoring_integrations")
    .upsert(
      {
        tenant_id: tenantId,
        provider: "prtg",
        enabled: config.enabled,
        team_id: config.teamId,
        create_on: config.createOn,
        set_service_status: config.setServiceStatus,
        realert_minutes: config.realertMinutes,
        group_dependencies: config.groupDependencies,
        suppress_in_maintenance: config.suppressInMaintenance,
      },
      { onConflict: "tenant_id" },
    )
    .select("*")
    .single();
  if (error || !data) throw dbFailure();
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "monitoring.integration.updated",
    entity_type: "monitoring_integration",
    entity_id: data.id,
    severity: "info",
    metadata: { provider: "prtg", enabled: config.enabled },
  });
  return json(request, { data: { config: configFromRow(data as Row) } });
}

async function rotateToken(
  request: Request,
  admin: Admin,
  actorId: string,
  tenantId: string,
) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    throw new HttpError(
      503,
      "configuration_missing",
      "Die Webhook-Adresse ist nicht konfiguriert.",
    );
  }
  const token = generateToken();
  const { data, error } = await admin
    .from("monitoring_integrations")
    .upsert(
      {
        tenant_id: tenantId,
        provider: "prtg",
        token_hash: await sha256Hex(token),
        token_rotated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    )
    .select("*")
    .single();
  if (error || !data) throw dbFailure();
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "monitoring.integration.token_rotated",
    entity_type: "monitoring_integration",
    entity_id: data.id,
    severity: "security",
    metadata: { provider: "prtg" },
  });
  return json(request, {
    data: {
      token,
      webhookUrl: webhookUrl(supabaseUrl, token),
      config: configFromRow(data as Row),
    },
  });
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
        return json(
          request,
          {
            error: {
              code: "invalid_request",
              message: "Die Angaben sind unvollständig oder ungültig.",
            },
          },
          422,
        );
      }
      const admin = context.supabaseAdmin;
      await requireTenantAdmin(admin, action.tenantId, actorId);
      switch (action.type) {
        case "get":
          return await get(request, admin, action.tenantId);
        case "save":
          return await save(
            request,
            admin,
            actorId,
            action.tenantId,
            action.config,
          );
        case "rotateToken":
          return await rotateToken(request, admin, actorId, action.tenantId);
        case "listAlerts":
          return json(request, {
            data: { alerts: await listAlerts(admin, action.tenantId) },
          });
        case "closeAlert":
          return await closeAlert(
            request,
            admin,
            actorId,
            action.tenantId,
            action.alertId,
          );
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error("monitoring_integrations_failed", error);
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
