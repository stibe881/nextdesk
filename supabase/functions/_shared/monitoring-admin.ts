// Shared request handling for the monitoring automation admin endpoints
// (expiry-monitoring, backup-monitoring): permission check, option lists and
// validation of referenced records.

import { isRecord, isUuid } from "./http.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function dbFailure(): HttpError {
  return new HttpError(500, "database_error", "Die Daten konnten nicht verarbeitet werden.");
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const body = await request.text().catch(() => null);
  if (body === null || new TextEncoder().encode(body).length > maxBytes) {
    throw new HttpError(413, "payload_too_large", "Die Anfrage ist zu gross.");
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Active membership plus tenant.settings.manage (like monitoring-integrations). */
export async function requireMonitoringAdmin(
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
    throw new HttpError(403, "tenant_access_denied", "Kein Zugriff auf diesen Mandanten.");
  }
  const allowed = await admin.rpc("user_has_tenant_permission", {
    p_user_id: actorId,
    p_tenant_id: tenantId,
    p_permission_code: "tenant.settings.manage",
  });
  if (allowed.error || allowed.data !== true) {
    throw new HttpError(403, "forbidden", "Für die Monitoring-Einstellungen fehlt Ihnen die Berechtigung.");
  }
}

/** Optional uuid: null for empty values, undefined when invalid. */
export function optionalUuid(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return isUuid(value) ? value.toLowerCase() : undefined;
}

export function optionalPriorityKey(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && /^[a-z0-9_-]{1,64}$/i.test(value) ? value : undefined;
}

export function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return null;
  return text.length <= max ? text : undefined;
}

export function optionalInteger(
  value: unknown,
  min: number,
  max: number,
): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number >= min && number <= max
    ? number
    : undefined;
}

export type MonitoringOptions = {
  departments: { id: string; name: string }[];
  priorities: { key: string; label: string }[];
  assets: { id: string; name: string; hostname: string | null }[];
  services: { id: string; name: string }[];
};

export async function loadMonitoringOptions(admin: Admin, tenantId: string): Promise<MonitoringOptions> {
  const [departments, priorities, infra, services] = await Promise.all([
    admin.from("departments").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name"),
    admin.from("ticket_priorities").select("key, label, sort_order").eq("tenant_id", tenantId).order("sort_order"),
    admin.from("asset_infrastructure").select("asset_id, hostname").eq("tenant_id", tenantId).limit(2000),
    admin.from("services").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name").limit(1000),
  ]);
  if (departments.error || priorities.error || infra.error || services.error) throw dbFailure();
  const infraRows = (infra.data ?? []) as Row[];
  const hostnames = new Map(infraRows.map((row) => [String(row.asset_id), row.hostname]));
  const assets = infraRows.length
    ? await admin
      .from("assets")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .in("id", [...hostnames.keys()])
      .order("name")
    : { data: [], error: null };
  if (assets.error) throw dbFailure();
  return {
    departments: ((departments.data ?? []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name) })),
    priorities: ((priorities.data ?? []) as Row[]).map((row) => ({ key: String(row.key), label: String(row.label) })),
    assets: ((assets.data ?? []) as Row[]).map((row) => {
      const hostname = hostnames.get(String(row.id));
      return {
        id: String(row.id),
        name: String(row.name),
        hostname: typeof hostname === "string" && hostname ? hostname : null,
      };
    }),
    services: ((services.data ?? []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name) })),
  };
}

/** Checks that referenced records belong to the tenant (and are active). */
export async function validateReferences(
  admin: Admin,
  tenantId: string,
  refs: {
    departmentId?: string | null;
    priorityKeys?: (string | null)[];
    assetId?: string | null;
    serviceId?: string | null;
  },
): Promise<void> {
  const check = async (query: Promise<{ data: unknown; error: unknown }>, code: string, message: string) => {
    const { data, error } = await query;
    if (error) throw dbFailure();
    if (!data) throw new HttpError(422, code, message);
  };
  const checks: Promise<void>[] = [];
  if (refs.departmentId) {
    checks.push(check(
      admin.from("departments").select("id").eq("tenant_id", tenantId).eq("id", refs.departmentId)
        .eq("active", true).maybeSingle(),
      "department_invalid",
      "Die Abteilung ist nicht verfügbar.",
    ));
  }
  for (const key of refs.priorityKeys ?? []) {
    if (!key) continue;
    checks.push(check(
      admin.from("ticket_priorities").select("id").eq("tenant_id", tenantId).eq("key", key).maybeSingle(),
      "priority_invalid",
      "Die Priorität ist nicht verfügbar.",
    ));
  }
  if (refs.assetId) {
    checks.push(check(
      admin.from("assets").select("id").eq("tenant_id", tenantId).eq("id", refs.assetId).maybeSingle(),
      "asset_invalid",
      "Das Asset ist nicht verfügbar.",
    ));
  }
  if (refs.serviceId) {
    checks.push(check(
      admin.from("services").select("id").eq("tenant_id", tenantId).eq("id", refs.serviceId).maybeSingle(),
      "service_invalid",
      "Der Dienst ist nicht verfügbar.",
    ));
  }
  await Promise.all(checks);
}

export async function ticketNumbers(
  admin: Admin,
  tenantId: string,
  ids: unknown[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
  if (!unique.length) return new Map();
  const { data, error } = await admin
    .from("tickets")
    .select("id, ticket_number")
    .eq("tenant_id", tenantId)
    .in("id", unique);
  if (error) throw dbFailure();
  return new Map(((data ?? []) as Row[]).map((row) => [String(row.id), String(row.ticket_number)]));
}

/** Verifies the cron dispatch secret (stored only in the database). */
export async function verifyDispatchSecret(admin: Admin, request: Request): Promise<boolean> {
  const provided = request.headers.get("x-nextdesk-dispatch-secret") ?? "";
  if (provided.length < 32 || provided.length > 200) return false;
  const { data, error } = await admin.rpc("monitoring_automation_verify_dispatch_secret", {
    p_secret: provided,
  });
  return !error && data === true;
}

export function parseTenantRequest(value: unknown): { type: string; tenantId: string; body: Row } | null {
  if (!isRecord(value) || !isUuid(value.tenantId) || typeof value.type !== "string") return null;
  return { type: value.type, tenantId: value.tenantId.toLowerCase(), body: value };
}
