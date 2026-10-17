import { withSupabase, type SupabaseContext } from "@supabase/server";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_QUERY_LENGTH = 160;
const MAX_RESULTS = 50;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIFECYCLE_STATES = [
  "ordered",
  "stock",
  "active",
  "repair",
  "retired",
  "disposed",
] as const;

type LifecycleState = (typeof LIFECYCLE_STATES)[number];
type Row = Record<string, unknown>;
type CallerClient = SupabaseContext["supabase"];
type AdminClient = SupabaseContext["supabaseAdmin"];

type Action =
  | { type: "listAssets"; tenantId: string; query: string }
  | { type: "getAsset"; tenantId: string; assetId: string }
  | { type: "lookupAsset"; tenantId: string; code: string }
  | {
      type: "transitionLifecycle";
      tenantId: string;
      assetId: string;
      lifecycleState: LifecycleState;
    }
  | { type: "getIntuneConfiguration"; tenantId: string }
  | {
      type: "updateIntuneConfiguration";
      tenantId: string;
      enabled: boolean;
      directoryTenantId: string | null;
      syncEnabled: boolean;
    }
  | { type: "listIntuneRuns"; tenantId: string };

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null {
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    !value.isWellFormed()
  ) {
    return null;
  }
  const normalized = value.trim();
  const size = Array.from(normalized).length;
  return size >= minimum && size <= maximum ? normalized : null;
}

function hasOnlyKeys(value: Row, keys: readonly string[]): boolean {
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
  if (value.type === "listAssets") {
    if (!hasOnlyKeys(value, ["type", "tenantId", "query"])) return null;
    const query = validText(value.query, 0, MAX_QUERY_LENGTH);
    return query === null ? null : { type: value.type, tenantId, query };
  }
  if (value.type === "getAsset") {
    return hasOnlyKeys(value, ["type", "tenantId", "assetId"]) &&
      isUuid(value.assetId)
      ? { type: value.type, tenantId, assetId: value.assetId.toLowerCase() }
      : null;
  }
  if (value.type === "lookupAsset") {
    if (!hasOnlyKeys(value, ["type", "tenantId", "code"])) return null;
    const code = validText(value.code, 1, 200);
    return code === null ? null : { type: value.type, tenantId, code };
  }
  if (value.type === "transitionLifecycle") {
    return hasOnlyKeys(value, [
      "type",
      "tenantId",
      "assetId",
      "lifecycleState",
    ]) &&
      isUuid(value.assetId) &&
      typeof value.lifecycleState === "string" &&
      (LIFECYCLE_STATES as readonly string[]).includes(value.lifecycleState)
      ? {
          type: value.type,
          tenantId,
          assetId: value.assetId.toLowerCase(),
          lifecycleState: value.lifecycleState as LifecycleState,
        }
      : null;
  }
  if (
    value.type === "getIntuneConfiguration" ||
    value.type === "listIntuneRuns"
  ) {
    return hasOnlyKeys(value, ["type", "tenantId"])
      ? { type: value.type, tenantId }
      : null;
  }
  if (value.type === "updateIntuneConfiguration") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "tenantId",
        "enabled",
        "directoryTenantId",
        "syncEnabled",
      ]) ||
      typeof value.enabled !== "boolean" ||
      typeof value.syncEnabled !== "boolean" ||
      (value.directoryTenantId !== null && !isUuid(value.directoryTenantId))
    ) {
      return null;
    }
    if (value.enabled && value.directoryTenantId === null) return null;
    return {
      type: value.type,
      tenantId,
      enabled: value.enabled,
      directoryTenantId:
        typeof value.directoryTenantId === "string"
          ? value.directoryTenantId.toLowerCase()
          : null,
      syncEnabled: value.syncEnabled,
    };
  }
  return null;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return headers;
}

function response(request: Request, body: Row, status = 200): Response {
  const headers = corsHeaders(request);
  if (status === 405) headers.set("Allow", "POST, OPTIONS");
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

function failure(request: Request, error: HttpError): Response {
  return response(
    request,
    { error: { code: error.code, message: error.message } },
    error.status,
  );
}

function databaseFailure(error: { code?: string } | null): never {
  switch (error?.code) {
    case "42501":
      throw new HttpError(
        403,
        "permission_denied",
        "Für diese Aktion fehlt die Berechtigung.",
      );
    case "23505":
      throw new HttpError(409, "conflict", "Der Eintrag besteht bereits.");
    case "23503":
    case "23514":
    case "22001":
    case "22021":
    case "22023":
    case "22P02":
      throw new HttpError(
        422,
        "invalid_data",
        "Die Angaben sind nicht zulässig.",
      );
    default:
      throw new HttpError(
        500,
        "operation_failed",
        "Die Aktion konnte nicht abgeschlossen werden.",
      );
  }
}

async function requireRpcPermission(
  client: CallerClient,
  rpc: "is_active_tenant_member" | "has_tenant_permission",
  args: Row,
  code: string,
): Promise<void> {
  const { data, error } = await client.rpc(rpc, args);
  if (error || typeof data !== "boolean") {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  }
  if (!data)
    throw new HttpError(403, code, "Für diese Aktion fehlt die Berechtigung.");
}

async function requireTenantMember(
  client: CallerClient,
  tenantId: string,
): Promise<void> {
  await requireRpcPermission(
    client,
    "is_active_tenant_member",
    { p_tenant_id: tenantId },
    "tenant_membership_required",
  );
}

async function requireAssetManage(
  client: CallerClient,
  tenantId: string,
): Promise<void> {
  await requireRpcPermission(
    client,
    "has_tenant_permission",
    { p_tenant_id: tenantId, p_permission_code: "asset.manage" },
    "asset_manage_required",
  );
}

async function requireIntegrationManage(
  client: CallerClient,
  tenantId: string,
): Promise<void> {
  await requireRpcPermission(
    client,
    "has_tenant_permission",
    { p_tenant_id: tenantId, p_permission_code: "asset.integration.manage" },
    "asset_integration_manage_required",
  );
}

function canonicalCode(value: string): string {
  return value.trim().toLocaleLowerCase("de-CH");
}

const ASSET_SELECT =
  "id, tenant_id, name, asset_tag, inventory_number, serial_number, manufacturer, model, operating_system, kind, status, lifecycle_state, active, intune_device_id, intune_compliance_state, intune_encrypted, intune_last_sync_at, intune_last_seen_at, location_id, service_id, customer_organization_id, updated_at";

function asAsset(row: unknown): Row {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.name !== "string"
  ) {
    throw new HttpError(
      500,
      "asset_read_failed",
      "Die Assetdaten sind unvollständig.",
    );
  }
  return row;
}

async function listAssets(
  request: Request,
  client: CallerClient,
  action: Extract<Action, { type: "listAssets" }>,
): Promise<Response> {
  const query = action.query.trim();
  const base = () =>
    client
      .from("assets")
      .select(ASSET_SELECT)
      .eq("tenant_id", action.tenantId)
      .eq("active", true)
      .order("name")
      .limit(MAX_RESULTS);
  if (!query) {
    const { data, error } = await base();
    if (error) databaseFailure(error);
    return response(request, { data: { assets: (data ?? []).map(asAsset) } });
  }
  const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const [names, identifiers] = await Promise.all([
    base().ilike("name", pattern),
    client
      .from("asset_identifiers")
      .select("asset_id")
      .eq("tenant_id", action.tenantId)
      .ilike("canonical_value", `%${canonicalCode(query)}%`)
      .limit(MAX_RESULTS),
  ]);
  if (names.error) databaseFailure(names.error);
  if (identifiers.error) databaseFailure(identifiers.error);
  const ids = new Set((names.data ?? []).map((asset) => asset.id));
  for (const identifier of identifiers.data ?? []) ids.add(identifier.asset_id);
  if (ids.size === 0) return response(request, { data: { assets: [] } });
  const { data, error } = await client
    .from("assets")
    .select(ASSET_SELECT)
    .eq("tenant_id", action.tenantId)
    .eq("active", true)
    .in("id", [...ids].slice(0, MAX_RESULTS))
    .order("name");
  if (error) databaseFailure(error);
  return response(request, { data: { assets: (data ?? []).map(asAsset) } });
}

async function assetById(
  client: CallerClient,
  tenantId: string,
  assetId: string,
): Promise<Row> {
  const { data, error } = await client
    .from("assets")
    .select(ASSET_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", assetId)
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data)
    throw new HttpError(
      404,
      "asset_not_found",
      "Das Asset ist nicht verfügbar.",
    );
  return asAsset(data);
}

async function getAsset(
  request: Request,
  client: CallerClient,
  admin: AdminClient,
  action: Extract<Action, { type: "getAsset" }>,
): Promise<Response> {
  const asset = await assetById(client, action.tenantId, action.assetId);
  const canManage = await client.rpc("has_tenant_permission", {
    p_tenant_id: action.tenantId,
    p_permission_code: "asset.manage",
  });
  if (canManage.error || typeof canManage.data !== "boolean") {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  }
  const [
    { data: location, error: locationError },
    { data: tickets, error: ticketError },
  ] = await Promise.all([
    asset.location_id
      ? client
          .from("asset_locations")
          .select("id, name")
          .eq("tenant_id", action.tenantId)
          .eq("id", asset.location_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    client
      .from("ticket_assets")
      .select(
        "tickets!inner(id, ticket_number, subject, status:ticket_statuses!inner(label))",
      )
      .eq("tenant_id", action.tenantId)
      .eq("asset_id", action.assetId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (locationError) databaseFailure(locationError);
  if (ticketError) databaseFailure(ticketError);
  if (!canManage.data) {
    return response(request, {
      data: {
        asset,
        location,
        tickets: tickets ?? [],
        integration: null,
        assignments: [],
      },
    });
  }
  const [
    { data: integration, error: integrationError },
    { data: assignments, error: assignmentError },
    { data: lifecycle, error: lifecycleError },
  ] = await Promise.all([
    admin
      .from("asset_intune_devices")
      .select(
        "external_device_id, device_name, managed_device_name, serial_number, manufacturer, model, operating_system, os_version, user_display_name, user_principal_name, compliance_state, is_encrypted, last_sync_at, last_seen_at, synced_at",
      )
      .eq("tenant_id", action.tenantId)
      .eq("asset_id", action.assetId)
      .maybeSingle(),
    admin
      .from("asset_assignments")
      .select("id, requester_id, assigned_at, returned_at")
      .eq("tenant_id", action.tenantId)
      .eq("asset_id", action.assetId)
      .order("assigned_at", { ascending: false })
      .limit(20),
    admin
      .from("asset_lifecycle_events")
      .select("id, previous_state, next_state, occurred_at")
      .eq("tenant_id", action.tenantId)
      .eq("asset_id", action.assetId)
      .order("occurred_at", { ascending: false })
      .limit(30),
  ]);
  if (integrationError) databaseFailure(integrationError);
  if (assignmentError) databaseFailure(assignmentError);
  if (lifecycleError) databaseFailure(lifecycleError);
  return response(request, {
    data: {
      asset,
      location,
      tickets: tickets ?? [],
      integration,
      assignments: assignments ?? [],
      lifecycle: lifecycle ?? [],
    },
  });
}

async function lookupAsset(
  request: Request,
  client: CallerClient,
  admin: AdminClient,
  action: Extract<Action, { type: "lookupAsset" }>,
): Promise<Response> {
  const code = canonicalCode(action.code);
  const { data: identifiers, error } = await client
    .from("asset_identifiers")
    .select("asset_id")
    .eq("tenant_id", action.tenantId)
    .eq("canonical_value", code)
    .limit(4);
  if (error) databaseFailure(error);
  const ids = [...new Set((identifiers ?? []).map((row) => row.asset_id))];
  if (ids.length === 0) {
    throw new HttpError(
      404,
      "asset_lookup_not_found",
      "Für diesen Code wurde kein Asset gefunden.",
    );
  }
  if (ids.length > 1) {
    const { data: matches, error: matchError } = await client
      .from("assets")
      .select("id, name, asset_tag, inventory_number, serial_number")
      .eq("tenant_id", action.tenantId)
      .in("id", ids)
      .order("name");
    if (matchError) databaseFailure(matchError);
    return response(
      request,
      { data: { match: "ambiguous", assets: matches ?? [] } },
      409,
    );
  }
  return await getAsset(request, client, admin, {
    type: "getAsset",
    tenantId: action.tenantId,
    assetId: ids[0],
  });
}

async function transitionLifecycle(
  request: Request,
  client: CallerClient,
  action: Extract<Action, { type: "transitionLifecycle" }>,
): Promise<Response> {
  await requireAssetManage(client, action.tenantId);
  const { data, error } = await client
    .from("assets")
    .update({
      lifecycle_state: action.lifecycleState,
      lifecycle_changed_at: new Date().toISOString(),
    })
    .eq("tenant_id", action.tenantId)
    .eq("id", action.assetId)
    .select(ASSET_SELECT)
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data)
    throw new HttpError(
      404,
      "asset_not_found",
      "Das Asset ist nicht verfügbar.",
    );
  return response(request, { data: { asset: asAsset(data) } });
}

async function intuneConfiguration(
  request: Request,
  client: CallerClient,
  action: Extract<
    Action,
    { type: "getIntuneConfiguration" | "updateIntuneConfiguration" }
  >,
): Promise<Response> {
  await requireIntegrationManage(client, action.tenantId);
  if (action.type === "updateIntuneConfiguration") {
    const { error } = await client.from("asset_intune_connections").upsert({
      tenant_id: action.tenantId,
      enabled: action.enabled,
      directory_tenant_id: action.directoryTenantId,
      sync_enabled: action.enabled && action.syncEnabled,
      last_status: action.enabled ? "ready" : "not_configured",
    });
    if (error) databaseFailure(error);
  }
  const { data, error } = await client
    .from("asset_intune_connections")
    .select(
      "enabled, directory_tenant_id, sync_enabled, last_success_at, last_attempt_at, last_status, last_error_code, updated_at",
    )
    .eq("tenant_id", action.tenantId)
    .maybeSingle();
  if (error) databaseFailure(error);
  return response(request, { data: { configuration: data ?? null } });
}

async function listIntuneRuns(
  request: Request,
  client: CallerClient,
  action: Extract<Action, { type: "listIntuneRuns" }>,
): Promise<Response> {
  await requireIntegrationManage(client, action.tenantId);
  const { data, error } = await client
    .from("asset_intune_sync_runs")
    .select(
      "id, mode, status, started_at, finished_at, devices_seen, assets_created, assets_updated, error_code",
    )
    .eq("tenant_id", action.tenantId)
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) databaseFailure(error);
  return response(request, { data: { runs: data ?? [] } });
}

const securedHandler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (!isUuid(context.userClaims?.id)) {
        throw new HttpError(
          401,
          "authentication_required",
          "Eine gültige Benutzeranmeldung ist erforderlich.",
        );
      }
      const action = parseAction(await request.json().catch(() => null));
      if (!action)
        throw new HttpError(
          400,
          "invalid_request",
          "Die Anfrage enthält ungültige oder unbekannte Felder.",
        );
      await requireTenantMember(context.supabase, action.tenantId);
      if (action.type === "listAssets")
        return await listAssets(request, context.supabase, action);
      if (action.type === "getAsset")
        return await getAsset(
          request,
          context.supabase,
          context.supabaseAdmin,
          action,
        );
      if (action.type === "lookupAsset")
        return await lookupAsset(
          request,
          context.supabase,
          context.supabaseAdmin,
          action,
        );
      if (action.type === "transitionLifecycle")
        return await transitionLifecycle(request, context.supabase, action);
      if (
        action.type === "getIntuneConfiguration" ||
        action.type === "updateIntuneConfiguration"
      ) {
        return await intuneConfiguration(request, context.supabase, action);
      }
      return await listIntuneRuns(request, context.supabase, action);
    } catch (error) {
      return failure(
        request,
        error instanceof HttpError
          ? error
          : new HttpError(
              500,
              "operation_failed",
              "Die Aktion konnte nicht abgeschlossen werden.",
            ),
      );
    }
  },
);

async function boundedRequest(request: Request): Promise<Request> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)
  ) {
    throw new HttpError(413, "request_too_large", "Die Anfrage ist zu groß.");
  }
  if (!request.body)
    throw new HttpError(
      400,
      "invalid_request",
      "Ein JSON-Objekt ist erforderlich.",
    );
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new HttpError(
          413,
          "request_too_large",
          "Die Anfrage ist zu groß.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new HttpError(
      400,
      "invalid_request",
      "Gültiges UTF-8-JSON ist erforderlich.",
    );
  }
  return new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body,
    signal: request.signal,
  });
}

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
      if (origin !== ALLOWED_ORIGIN)
        return failure(
          request,
          new HttpError(
            403,
            "origin_not_allowed",
            "Dieser Ursprung ist nicht erlaubt.",
          ),
        );
      const requestedMethod = request.headers.get(
        "access-control-request-method",
      );
      if (requestedMethod !== null && requestedMethod !== "POST") {
        return failure(
          request,
          new HttpError(
            405,
            "method_not_allowed",
            "Nur POST-Anfragen sind erlaubt.",
          ),
        );
      }
      return response(request, {}, 204);
    }
    if (request.method !== "POST")
      return failure(
        request,
        new HttpError(
          405,
          "method_not_allowed",
          "Nur POST-Anfragen sind erlaubt.",
        ),
      );
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
      return await securedHandler(await boundedRequest(request));
    } catch (error) {
      return failure(
        request,
        error instanceof HttpError
          ? error
          : new HttpError(
              500,
              "operation_failed",
              "Die Aktion konnte nicht abgeschlossen werden.",
            ),
      );
    }
  },
};
