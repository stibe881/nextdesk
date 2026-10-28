import { type SupabaseContext, withSupabase } from "@supabase/server";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_SERVICES = 500;
const MAX_EVENTS = 15_000;
const MAX_MAINTENANCES = 500;
const MAX_MAINTENANCE_SERVICES = 100;
const MAX_MAINTENANCE_SERVICE_LINKS = MAX_MAINTENANCES *
  MAX_MAINTENANCE_SERVICES;
const STATUS_VALUES = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
] as const;
const MAINTENANCE_STATES = [
  "scheduled",
  "active",
  "completed",
  "cancelled",
] as const;

type ServiceStatus = (typeof STATUS_VALUES)[number];
type MaintenanceState = (typeof MAINTENANCE_STATES)[number];
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
  | { type: "rotateStatusPageId"; tenantId: string }
  | {
    type: "manageMaintenance";
    tenantId: string;
    operation: "create" | "update";
    maintenanceId?: string;
    title: string;
    description: string | null;
    startsAt: string;
    endsAt: string;
    state: MaintenanceState;
    publicEnabled: boolean;
    serviceIds: string[];
  };

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

type StatusMaintenance = {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  state: MaintenanceState;
  publicEnabled: boolean;
  serviceIds: string[];
  updatedAt: string;
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
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(
        value,
      )
  );
}

function isStatus(value: unknown): value is ServiceStatus {
  return (
    typeof value === "string" && STATUS_VALUES.includes(value as ServiceStatus)
  );
}

function isMaintenanceState(value: unknown): value is MaintenanceState {
  return (
    typeof value === "string" &&
    MAINTENANCE_STATES.includes(value as MaintenanceState)
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

function parseIsoTimestamp(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !value.isWellFormed() ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i
      .test(
        value,
      )
  ) {
    return null;
  }
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
}

function parseServiceIds(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_MAINTENANCE_SERVICES
  ) {
    return null;
  }
  const ids = value.map((serviceId) =>
    isUuid(serviceId) ? serviceId.toLowerCase() : null
  );
  if (ids.some((serviceId) => serviceId === null)) return null;
  const normalized = ids as string[];
  return new Set(normalized).size === normalized.length ? normalized : null;
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
  if (
    value.type !== "manageMaintenance" ||
    (value.operation !== "create" && value.operation !== "update")
  ) {
    return null;
  }
  const allowedKeys = [
    "type",
    "tenantId",
    "operation",
    "title",
    "description",
    "startsAt",
    "endsAt",
    "state",
    "publicEnabled",
    "serviceIds",
  ];
  if (value.operation === "update") allowedKeys.push("maintenanceId");
  if (!hasOnlyKeys(value, allowedKeys)) return null;
  if (
    !isSafeText(value.title, 2, 180) ||
    (value.description !== null && !isSafeText(value.description, 0, 2_000)) ||
    !isMaintenanceState(value.state) ||
    typeof value.publicEnabled !== "boolean"
  ) {
    return null;
  }
  const startsAt = parseIsoTimestamp(value.startsAt);
  const endsAt = parseIsoTimestamp(value.endsAt);
  const serviceIds = parseServiceIds(value.serviceIds);
  if (
    !startsAt ||
    !endsAt ||
    Date.parse(endsAt) <= Date.parse(startsAt) ||
    !serviceIds
  ) {
    return null;
  }
  const maintenanceId = value.operation === "update"
    ? value.maintenanceId
    : undefined;
  if (value.operation === "update" && !isUuid(maintenanceId)) return null;
  return {
    type: value.type,
    tenantId,
    operation: value.operation,
    ...(typeof maintenanceId === "string"
      ? { maintenanceId: maintenanceId.toLowerCase() }
      : {}),
    title: value.title.trim(),
    description: value.description === null ? null : value.description.trim(),
    startsAt,
    endsAt,
    state: value.state,
    publicEnabled: value.publicEnabled,
    serviceIds,
  };
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
  client: CallerClient,
  tenantId: string,
): Promise<void> {
  // The SECURITY DEFINER gate exposes only an effective boolean to an active
  // member. This keeps all user-bound checks ahead of service-role data access.
  const result = await client.rpc("is_asset_management_client_enabled", {
    p_tenant_id: tenantId,
  });
  if (result.error || typeof result.data !== "boolean") {
    throw new HttpError(
      503,
      "tenant_feature_lookup_failed",
      "Die Funktionsberechtigung konnte nicht geprüft werden.",
    );
  }
  if (result.data !== true) {
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
    id: value.id.toLowerCase(),
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
    !serviceIds.has(value.service_id.toLowerCase()) ||
    !isStatus(value.status) ||
    typeof value.changed_at !== "string"
  ) {
    return null;
  }
  return {
    serviceId: value.service_id.toLowerCase(),
    status: value.status,
    changedAt: value.changed_at,
  };
}

function parseMaintenance(
  value: unknown,
): Omit<StatusMaintenance, "serviceIds"> | null {
  if (!isRecord(value)) return null;
  const startsAt = parseIsoTimestamp(value.starts_at);
  const endsAt = parseIsoTimestamp(value.ends_at);
  if (
    !isUuid(value.id) ||
    !isSafeText(value.title, 2, 180) ||
    (value.description !== null && !isSafeText(value.description, 0, 2_000)) ||
    !startsAt ||
    !endsAt ||
    Date.parse(endsAt) <= Date.parse(startsAt) ||
    !isMaintenanceState(value.state) ||
    typeof value.public_enabled !== "boolean" ||
    typeof value.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: value.id.toLowerCase(),
    title: value.title.trim(),
    description: value.description === null ? null : value.description.trim(),
    startsAt,
    endsAt,
    state: value.state,
    publicEnabled: value.public_enabled,
    updatedAt: value.updated_at,
  };
}

async function readMaintenances(
  admin: AdminClient,
  tenantId: string,
): Promise<StatusMaintenance[]> {
  const maintenanceResult = await admin
    .from("service_status_maintenances")
    .select(
      "id, title, description, starts_at, ends_at, state, public_enabled, updated_at",
    )
    .eq("tenant_id", tenantId)
    .order("starts_at", { ascending: false })
    .order("id")
    .limit(MAX_MAINTENANCES + 1);
  if (maintenanceResult.error) {
    throw new HttpError(
      503,
      "maintenance_data_unavailable",
      "Die Wartungsdaten konnten nicht geladen werden.",
    );
  }
  if ((maintenanceResult.data?.length ?? 0) > MAX_MAINTENANCES) {
    throw new HttpError(
      413,
      "maintenance_limit_exceeded",
      "Es sind zu viele Wartungsfenster für eine einzelne Statusansicht vorhanden.",
    );
  }
  const maintenances = (maintenanceResult.data ?? []).map(parseMaintenance);
  if (maintenances.some((maintenance) => maintenance === null)) {
    throw new HttpError(
      503,
      "maintenance_data_invalid",
      "Die Wartungsdaten konnten nicht geladen werden.",
    );
  }
  const validMaintenances = maintenances as Array<
    Omit<StatusMaintenance, "serviceIds">
  >;
  if (validMaintenances.length === 0) return [];

  const maintenanceIds = validMaintenances.map((maintenance) => maintenance.id);
  const maintenanceIdSet = new Set(maintenanceIds);
  const servicesResult = await admin
    .from("service_status_maintenance_services")
    .select("maintenance_id, service_id")
    .eq("tenant_id", tenantId)
    .in("maintenance_id", maintenanceIds)
    .order("maintenance_id")
    .order("service_id")
    .limit(MAX_MAINTENANCE_SERVICE_LINKS + 1);
  if (servicesResult.error) {
    throw new HttpError(
      503,
      "maintenance_data_unavailable",
      "Die Wartungsdaten konnten nicht geladen werden.",
    );
  }
  if ((servicesResult.data?.length ?? 0) > MAX_MAINTENANCE_SERVICE_LINKS) {
    throw new HttpError(
      413,
      "maintenance_service_limit_exceeded",
      "Die Servicezuordnungen sind für eine einzelne Statusansicht zu umfangreich.",
    );
  }

  const serviceIdsByMaintenance = new Map<string, string[]>();
  for (const link of servicesResult.data ?? []) {
    if (
      !isRecord(link) ||
      !isUuid(link.maintenance_id) ||
      !maintenanceIdSet.has(link.maintenance_id.toLowerCase()) ||
      !isUuid(link.service_id)
    ) {
      throw new HttpError(
        503,
        "maintenance_data_invalid",
        "Die Wartungsdaten konnten nicht geladen werden.",
      );
    }
    const maintenanceId = link.maintenance_id.toLowerCase();
    const links = serviceIdsByMaintenance.get(maintenanceId) ?? [];
    links.push(link.service_id.toLowerCase());
    serviceIdsByMaintenance.set(maintenanceId, links);
  }

  return validMaintenances.map((maintenance) => {
    const serviceIds = serviceIdsByMaintenance.get(maintenance.id) ?? [];
    if (
      serviceIds.length < 1 ||
      serviceIds.length > MAX_MAINTENANCE_SERVICES ||
      new Set(serviceIds).size !== serviceIds.length
    ) {
      throw new HttpError(
        503,
        "maintenance_data_invalid",
        "Die Wartungsdaten konnten nicht geladen werden.",
      );
    }
    return { ...maintenance, serviceIds };
  });
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
  maintenances: StatusMaintenance[];
}> {
  const cutoff = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
  const [pageResult, servicesResult, eventsResult, maintenances] = await Promise
    .all([
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
      readMaintenances(admin, tenantId),
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
  const baselineResult = services.length === 0
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
    maintenances,
  };
}

async function writePageAudit(
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
  await writePageAudit(
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
  await writePageAudit(
    admin,
    tenantId,
    actorId,
    "service_status_page.rotated",
  );
}

async function manageMaintenance(
  admin: AdminClient,
  actorId: string,
  action: Extract<Action, { type: "manageMaintenance" }>,
): Promise<void> {
  const result = await admin.rpc("save_service_status_maintenance", {
    p_actor_id: actorId,
    p_tenant_id: action.tenantId,
    p_maintenance_id: action.operation === "update" ? action.maintenanceId! : null,
    p_title: action.title,
    p_description: action.description,
    p_starts_at: action.startsAt,
    p_ends_at: action.endsAt,
    p_state: action.state,
    p_public_enabled: action.publicEnabled,
    p_service_ids: action.serviceIds,
  });
  if (result.error) {
    // Do not forward database errors. The RPC validates and mutates as one
    // transaction, so every unknown failure must remain fail-closed.
    if (result.error.code === "P0002") {
      throw new HttpError(
        404,
        "maintenance_not_found",
        "Das Wartungsfenster ist nicht verfügbar.",
      );
    }
    if (result.error.code === "42501") {
      throw new HttpError(
        403,
        "permission_denied",
        "Für diese Aktion fehlt die Berechtigung.",
      );
    }
    if (
      ["22023", "23502", "23503", "23505", "23514"].includes(
        result.error.code,
      )
    ) {
      throw new HttpError(
        422,
        "maintenance_validation_failed",
        "Das Wartungsfenster oder die gewählten Services sind nicht verfügbar.",
      );
    }
    throw new HttpError(
      503,
      "maintenance_write_failed",
      "Das Wartungsfenster konnte nicht gespeichert werden.",
    );
  }
  if (!isUuid(result.data)) {
    throw new HttpError(
      503,
      "maintenance_write_failed",
      "Das Wartungsfenster konnte nicht gespeichert werden.",
    );
  }
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
    // Keep every user-bound authorization check ahead of the first service-role
    // read or write. The feature RPC is intentionally caller-scoped.
    await requireActiveMembership(context.supabase, action.tenantId);
    await requireAssetFeature(context.supabase, action.tenantId);
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

    if (action.type === "manageMaintenance") {
      await manageMaintenance(
        context.supabaseAdmin,
        actorId,
        action,
      );
    } else {
      // Public page settings retain their existing, stricter publication gate.
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
    }
    const overview = await readOverview(context.supabaseAdmin, action.tenantId);
    const canManagePublication =
      action.type !== "manageMaintenance" || action.publicEnabled ? true : (
        await context.supabase.rpc("has_tenant_permission", {
          p_tenant_id: action.tenantId,
          p_permission_code: "tenant.settings.manage",
        })
      ).data === true;
    return json(request, { data: { ...overview, canManagePublication } });
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
        error instanceof HttpError ? error : new HttpError(
          500,
          "operation_failed",
          "Die Statusaktion konnte nicht abgeschlossen werden.",
        ),
      );
    }
  },
};
