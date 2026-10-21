import { type SupabaseContext, withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_SERVICES = 500;
const MAX_EVENTS = 15_000;
const STATUS_VALUES = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
] as const;

type ServiceStatus = (typeof STATUS_VALUES)[number];
type CallerClient = SupabaseContext["supabase"];
type AdminClient = SupabaseContext["supabaseAdmin"];
type Action =
  | { type: "getStatusOverview"; tenantId: string }
  | {
      type: "saveStatusPage";
      tenantId: string;
      title: string;
      publicEnabled: boolean;
    }
  | { type: "rotateStatusPageId"; tenantId: string };

type StatusService = {
  id: string;
  name: string;
  status: ServiceStatus;
  statusPublic: boolean;
  updatedAt: string;
};

type StatusEvent = {
  serviceId: string;
  status: ServiceStatus;
  changedAt: string;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

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

function isStatus(value: unknown): value is ServiceStatus {
  return (
    typeof value === "string" && STATUS_VALUES.includes(value as ServiceStatus)
  );
}

function isSafeText(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === "string" &&
    !value.includes("\u0000") &&
    value.isWellFormed() &&
    [...value.trim()].length >= min &&
    [...value.trim()].length <= max
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseAction(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    !isUuid(value.tenantId) ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  const tenantId = value.tenantId.toLowerCase();
  if (value.type === "getStatusOverview") {
    return hasOnlyKeys(value, ["type", "tenantId"])
      ? { type: value.type, tenantId }
      : null;
  }
  if (value.type === "rotateStatusPageId") {
    return hasOnlyKeys(value, ["type", "tenantId"])
      ? { type: value.type, tenantId }
      : null;
  }
  if (
    value.type === "saveStatusPage" &&
    hasOnlyKeys(value, ["type", "tenantId", "title", "publicEnabled"]) &&
    isSafeText(value.title, 2, 120) &&
    typeof value.publicEnabled === "boolean"
  ) {
    return {
      type: value.type,
      tenantId,
      title: value.title.trim(),
      publicEnabled: value.publicEnabled,
    };
  }
  return null;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
  }
  return headers;
}

function json(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  const headers = corsHeaders(request);
  if (status === 405) headers.set("Allow", "POST, OPTIONS");
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

function failure(request: Request, error: HttpError): Response {
  return json(
    request,
    { error: { code: error.code, message: error.message } },
    error.status,
  );
}

async function parseBoundedAction(request: Request): Promise<Action> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)
  ) {
    throw new HttpError(413, "request_too_large", "Die Anfrage ist zu gross.");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "request_too_large", "Die Anfrage ist zu gross.");
  }
  try {
    const action = parseAction(JSON.parse(body) as unknown);
    if (!action) throw new Error("invalid");
    return action;
  } catch {
    throw new HttpError(
      400,
      "invalid_request",
      "Die Anfrage enthält ungültige oder unbekannte Felder.",
    );
  }
}

async function requirePermission(
  client: CallerClient,
  tenantId: string,
  permission: "asset.manage" | "tenant.settings.manage",
): Promise<void> {
  const result = await client.rpc("has_tenant_permission", {
    p_tenant_id: tenantId,
    p_permission_code: permission,
  });
  if (result.error || typeof result.data !== "boolean") {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  }
  if (!result.data) {
    throw new HttpError(
      403,
      "permission_denied",
      "Für diese Aktion fehlt die Berechtigung.",
    );
  }
}

async function requireActiveMembership(
  client: CallerClient,
  tenantId: string,
): Promise<void> {
  const result = await client.rpc("is_active_tenant_member", {
    p_tenant_id: tenantId,
  });
  if (result.error || typeof result.data !== "boolean") {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  }
  if (!result.data) {
    throw new HttpError(
      403,
      "tenant_membership_required",
      "Für diese Aktion fehlt die Berechtigung.",
    );
  }
}

async function requireAssetFeature(
  admin: AdminClient,
  tenantId: string,
): Promise<void> {
  const states = await resolveTenantFeatureStates(admin, tenantId, [
    "assets.management",
  ]);
  if (!states) {
    throw new HttpError(
      503,
      "tenant_feature_lookup_failed",
      "Die Funktionsberechtigung konnte nicht geprüft werden.",
    );
  }
  if (states["assets.management"] !== true) {
    throw new HttpError(
      403,
      "asset_feature_disabled",
      "Das Asset-Management ist für diesen Mandanten deaktiviert.",
    );
  }
}

function parseService(value: unknown): StatusService | null {
  if (!isRecord(value)) return null;
  if (
    !isUuid(value.id) ||
    !isSafeText(value.name, 1, 240) ||
    !isStatus(value.status) ||
    typeof value.status_public !== "boolean" ||
    typeof value.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name.trim(),
    status: value.status,
    statusPublic: value.status_public,
    updatedAt: value.updated_at,
  };
}

function parseEvent(
  value: unknown,
  serviceIds: ReadonlySet<string>,
): StatusEvent | null {
  if (!isRecord(value)) return null;
  if (
    !isUuid(value.service_id) ||
    !serviceIds.has(value.service_id) ||
    !isStatus(value.status) ||
    typeof value.changed_at !== "string"
  ) {
    return null;
  }
  return {
    serviceId: value.service_id,
    status: value.status,
    changedAt: value.changed_at,
  };
}

async function readOverview(
  admin: AdminClient,
  tenantId: string,
): Promise<{
  page: {
    publicEnabled: boolean;
    publicId: string | null;
    title: string;
    updatedAt: string | null;
  };
  services: StatusService[];
  events: StatusEvent[];
}> {
  const cutoff = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
  const [pageResult, servicesResult, eventsResult] = await Promise.all([
    admin
      .from("service_status_pages")
      .select("public_id, title, public_enabled, updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("services")
      .select("id, name, status, status_public, updated_at")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name")
      .limit(MAX_SERVICES + 1),
    admin
      .from("service_status_events")
      .select("service_id, status, changed_at")
      .eq("tenant_id", tenantId)
      .gte("changed_at", cutoff)
      .order("changed_at", { ascending: true })
      .limit(MAX_EVENTS + 1),
  ]);
  if (pageResult.error || servicesResult.error || eventsResult.error) {
    throw new HttpError(
      503,
      "status_data_unavailable",
      "Die Statusdaten konnten nicht geladen werden.",
    );
  }
  if ((servicesResult.data?.length ?? 0) > MAX_SERVICES) {
    throw new HttpError(
      413,
      "status_service_limit_exceeded",
      "Es sind zu viele Services für eine einzelne Statusansicht vorhanden.",
    );
  }
  if ((eventsResult.data?.length ?? 0) > MAX_EVENTS) {
    throw new HttpError(
      413,
      "status_history_limit_exceeded",
      "Der Statusverlauf ist für eine einzelne Ansicht zu umfangreich.",
    );
  }

  const services = (servicesResult.data ?? [])
    .map(parseService)
    .filter((service): service is StatusService => service !== null);
  if (services.length !== (servicesResult.data ?? []).length) {
    throw new HttpError(
      503,
      "status_data_invalid",
      "Die Statusdaten konnten nicht geladen werden.",
    );
  }
  const serviceIds = new Set(services.map((service) => service.id));
  const baselineResult =
    services.length === 0
      ? { data: [], error: null }
      : await admin.rpc("service_status_history_baselines", {
          p_tenant_id: tenantId,
          p_service_ids: services.map((service) => service.id),
          p_before: cutoff,
        });
  if (baselineResult.error) {
    throw new HttpError(
      503,
      "status_history_unavailable",
      "Der Statusverlauf konnte nicht geladen werden.",
    );
  }
  const events = [...(baselineResult.data ?? []), ...(eventsResult.data ?? [])]
    .map((event) => parseEvent(event, serviceIds))
    .filter((event): event is StatusEvent => event !== null)
    .sort(
      (left, right) =>
        new Date(left.changedAt).getTime() -
        new Date(right.changedAt).getTime(),
    );

  const page = pageResult.data;
  if (
    page &&
    (!isUuid(page.public_id) ||
      !isSafeText(page.title, 2, 120) ||
      typeof page.public_enabled !== "boolean" ||
      typeof page.updated_at !== "string")
  ) {
    throw new HttpError(
      503,
      "status_page_invalid",
      "Die Statusdaten konnten nicht geladen werden.",
    );
  }

  return {
    page: {
      publicEnabled: page?.public_enabled === true,
      publicId: page?.public_id ?? null,
      title: page?.title.trim() || "Systemstatus",
      updatedAt: page?.updated_at ?? null,
    },
    services,
    events,
  };
}

async function writeAudit(
  admin: AdminClient,
  tenantId: string,
  actorId: string,
  action: "service_status_page.updated" | "service_status_page.rotated",
): Promise<void> {
  const result = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: "service_status_page",
    entity_id: null,
    severity: "info",
    metadata: { source: "service_status" },
  });
  if (result.error) {
    throw new HttpError(
      503,
      "audit_unavailable",
      "Die Änderung konnte nicht nachvollziehbar gespeichert werden.",
    );
  }
}

async function savePage(
  admin: AdminClient,
  actorId: string,
  action: Extract<Action, { type: "saveStatusPage" }>,
): Promise<void> {
  const result = await admin.from("service_status_pages").upsert(
    {
      tenant_id: action.tenantId,
      title: action.title,
      public_enabled: action.publicEnabled,
      updated_by: actorId,
    },
    { onConflict: "tenant_id" },
  );
  if (result.error) {
    throw new HttpError(
      503,
      "status_page_write_failed",
      "Die Veröffentlichungseinstellungen konnten nicht gespeichert werden.",
    );
  }
  await writeAudit(
    admin,
    action.tenantId,
    actorId,
    "service_status_page.updated",
  );
}

async function rotatePage(
  admin: AdminClient,
  actorId: string,
  tenantId: string,
): Promise<void> {
  const result = await admin.from("service_status_pages").upsert(
    {
      tenant_id: tenantId,
      public_id: crypto.randomUUID(),
      updated_by: actorId,
    },
    { onConflict: "tenant_id" },
  );
  if (result.error) {
    throw new HttpError(
      503,
      "status_page_write_failed",
      "Die öffentliche Adresse konnte nicht ersetzt werden.",
    );
  }
  await writeAudit(admin, tenantId, actorId, "service_status_page.rotated");
}

const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    const actorId = context.userClaims?.id;
    if (!isUuid(actorId)) {
      throw new HttpError(
        401,
        "authentication_required",
        "Eine gültige Benutzeranmeldung ist erforderlich.",
      );
    }
    const action = await parseBoundedAction(request);
    await requireActiveMembership(context.supabase, action.tenantId);
    await requireAssetFeature(context.supabaseAdmin, action.tenantId);
    await requirePermission(context.supabase, action.tenantId, "asset.manage");

    if (action.type === "getStatusOverview") {
      const overview = await readOverview(
        context.supabaseAdmin,
        action.tenantId,
      );
      const publication = await context.supabase.rpc("has_tenant_permission", {
        p_tenant_id: action.tenantId,
        p_permission_code: "tenant.settings.manage",
      });
      if (publication.error || typeof publication.data !== "boolean") {
        throw new HttpError(
          503,
          "authorization_check_failed",
          "Die Berechtigung konnte nicht geprüft werden.",
        );
      }
      return json(request, {
        data: { ...overview, canManagePublication: publication.data },
      });
    }

    await requirePermission(
      context.supabase,
      action.tenantId,
      "tenant.settings.manage",
    );
    if (action.type === "saveStatusPage") {
      await savePage(context.supabaseAdmin, actorId, action);
    } else {
      await rotatePage(context.supabaseAdmin, actorId, action.tenantId);
    }
    const overview = await readOverview(context.supabaseAdmin, action.tenantId);
    return json(request, { data: { ...overview, canManagePublication: true } });
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ALLOWED_ORIGIN) {
      return failure(
        request,
        new HttpError(
          403,
          "origin_not_allowed",
          "Dieser Ursprung ist nicht erlaubt.",
        ),
      );
    }
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) {
        return failure(
          request,
          new HttpError(
            403,
            "origin_not_allowed",
            "Dieser Ursprung ist nicht erlaubt.",
          ),
        );
      }
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "POST") {
      return failure(
        request,
        new HttpError(
          405,
          "method_not_allowed",
          "Nur POST-Anfragen sind erlaubt.",
        ),
      );
    }
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      return failure(
        request,
        new HttpError(
          415,
          "unsupported_media_type",
          "Content-Type application/json ist erforderlich.",
        ),
      );
    }
    try {
      const result = await handler(request);
      if (result.headers.has("x-supabase-server-error")) {
        return failure(
          request,
          new HttpError(
            result.status === 401 ? 401 : result.status === 403 ? 403 : 503,
            result.status === 401
              ? "authentication_required"
              : result.status === 403
                ? "permission_denied"
                : "authentication_unavailable",
            result.status === 401
              ? "Eine gültige Benutzeranmeldung ist erforderlich."
              : result.status === 403
                ? "Für diese Aktion fehlt die Berechtigung."
                : "Die Anmeldung konnte derzeit nicht geprüft werden.",
          ),
        );
      }
      return new Response(result.body, {
        status: result.status,
        headers: corsHeaders(request),
      });
    } catch (error) {
      return failure(
        request,
        error instanceof HttpError
          ? error
          : new HttpError(
              500,
              "operation_failed",
              "Die Statusaktion konnte nicht abgeschlossen werden.",
            ),
      );
    }
  },
};
