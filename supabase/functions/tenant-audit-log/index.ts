import { withSupabase } from "@supabase/server";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const DEFAULT_EXPORT_LIMIT = 1_000;
const MAX_EXPORT_LIMIT = 2_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ERROR_MESSAGES = {
  authentication_required: {
    title: "Anmeldung erforderlich",
    detail: "Für diese Funktion ist eine gültige Anmeldung erforderlich.",
    retryable: false,
  },
  method_not_allowed: {
    title: "Methode nicht erlaubt",
    detail: "Verwenden Sie für diese Funktion eine POST-Anfrage.",
    retryable: false,
  },
  unsupported_media_type: {
    title: "Nicht unterstützter Inhaltstyp",
    detail: "Verwenden Sie Content-Type application/json.",
    retryable: false,
  },
  request_too_large: {
    title: "Anfrage zu gross",
    detail: "Die Anfrage überschreitet die erlaubte Grösse.",
    retryable: false,
  },
  origin_not_allowed: {
    title: "Ursprung nicht erlaubt",
    detail: "Diese Anfrage darf von diesem Ursprung nicht ausgeführt werden.",
    retryable: false,
  },
  invalid_request: {
    title: "Ungültige Anfrage",
    detail:
      "Prüfen Sie Mandant, Filter und Eingaben und versuchen Sie es erneut.",
    retryable: false,
  },
  authorization_check_failed: {
    title: "Berechtigung nicht prüfbar",
    detail: "Die Berechtigungsprüfung ist vorübergehend nicht verfügbar.",
    retryable: true,
  },
  tenant_admin_required: {
    title: "Berechtigung erforderlich",
    detail:
      "Das Änderungsprotokoll ist nur für Mandantenadministratoren verfügbar.",
    retryable: false,
  },
  audit_log_read_failed: {
    title: "Änderungsprotokoll nicht verfügbar",
    detail: "Das Änderungsprotokoll konnte vorübergehend nicht geladen werden.",
    retryable: true,
  },
  audit_log_actor_read_failed: {
    title: "Änderungsprotokoll unvollständig",
    detail:
      "Die zugehörigen Benutzerinformationen konnten nicht geladen werden.",
    retryable: true,
  },
  audit_log_export_failed: {
    title: "CSV-Export nicht verfügbar",
    detail: "Der CSV-Export konnte nicht sicher protokolliert werden.",
    retryable: true,
  },
} as const;

type ErrorCode = keyof typeof ERROR_MESSAGES;
type AuditCursor = { id: string; occurredAt: string };
type AuditFilters = {
  action?: string;
  actorId?: string;
  endAt?: string;
  entityId?: string;
  entityType?: string;
  freeText?: string;
  startAt?: string;
};
type AuditListRequest = {
  cursor?: AuditCursor;
  filters: AuditFilters;
  limit: number;
  tenantId: string;
  type: "list";
};
type AuditExportRequest = {
  filters: AuditFilters;
  limit: number;
  tenantId: string;
  type: "exportCsv";
};
type AuditRequest = AuditListRequest | AuditExportRequest;
type AuditLogRow = {
  action: string;
  actor_id: string | null;
  entity_id: string | null;
  entity_type: string;
  id: string;
  occurred_at: string;
  severity: string;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
  ) {
    super(ERROR_MESSAGES[code].detail);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    !value.includes("\u0000") &&
    value.isWellFormed() &&
    Array.from(value.trim()).length >= 1 &&
    Array.from(value.trim()).length <= maximum
  );
}

function optionalText(
  value: unknown,
  maximum: number,
): string | undefined | null {
  if (value === undefined) return undefined;
  if (!validText(value, maximum)) return null;
  return value.trim();
}

function isoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    !value.includes("\u0000") &&
    Number.isFinite(Date.parse(value))
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseFilters(value: Record<string, unknown>): AuditFilters | null {
  if (
    !hasOnlyKeys(value, [
      "startAt",
      "endAt",
      "action",
      "actorId",
      "entityType",
      "entityId",
      "freeText",
    ])
  ) {
    return null;
  }

  const action = optionalText(value.action, 120);
  const entityType = optionalText(value.entityType, 120);
  const freeText = optionalText(value.freeText, 120);
  if (action === null || entityType === null || freeText === null) return null;
  if (
    (value.startAt !== undefined && !isoTimestamp(value.startAt)) ||
    (value.endAt !== undefined && !isoTimestamp(value.endAt)) ||
    (value.actorId !== undefined && !isUuid(value.actorId)) ||
    (value.entityId !== undefined && !isUuid(value.entityId))
  ) {
    return null;
  }
  if (
    typeof value.startAt === "string" &&
    typeof value.endAt === "string" &&
    Date.parse(value.startAt) > Date.parse(value.endAt)
  ) {
    return null;
  }

  // PostgREST's .or() syntax cannot safely carry structural characters from a
  // search term. Keep the server-side free-text filter deliberately narrow.
  if (freeText !== undefined && !/^[\p{L}\p{N}\s._:/-]+$/u.test(freeText)) {
    return null;
  }

  return {
    ...(action ? { action } : {}),
    ...(typeof value.actorId === "string"
      ? { actorId: value.actorId.toLowerCase() }
      : {}),
    ...(typeof value.endAt === "string" ? { endAt: value.endAt } : {}),
    ...(typeof value.entityId === "string"
      ? { entityId: value.entityId.toLowerCase() }
      : {}),
    ...(entityType ? { entityType } : {}),
    ...(freeText ? { freeText } : {}),
    ...(typeof value.startAt === "string" ? { startAt: value.startAt } : {}),
  };
}

function decodeCursor(value: unknown): AuditCursor | null {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(atob(base64));
    if (
      !isRecord(parsed) ||
      !isUuid(parsed.id) ||
      !isoTimestamp(parsed.occurredAt)
    ) {
      return null;
    }
    return { id: parsed.id.toLowerCase(), occurredAt: parsed.occurredAt };
  } catch {
    return null;
  }
}

function encodeCursor(row: AuditLogRow): string {
  return btoa(JSON.stringify({ id: row.id, occurredAt: row.occurred_at }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseRequest(value: unknown): AuditRequest | null {
  if (
    !isRecord(value) ||
    !isUuid(value.tenantId) ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  const tenantId = value.tenantId.toLowerCase();
  const filters = parseFilters(
    Object.fromEntries(
      [
        "startAt",
        "endAt",
        "action",
        "actorId",
        "entityType",
        "entityId",
        "freeText",
      ].flatMap((key) => (key in value ? [[key, value[key]]] : [])),
    ),
  );
  if (!filters) return null;

  if (value.type === "list") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "tenantId",
        "limit",
        "cursor",
        "startAt",
        "endAt",
        "action",
        "actorId",
        "entityType",
        "entityId",
        "freeText",
      ]) ||
      (value.limit !== undefined &&
        (typeof value.limit !== "number" ||
          !Number.isInteger(value.limit) ||
          value.limit < 1 ||
          value.limit > MAX_LIST_LIMIT))
    ) {
      return null;
    }
    const cursor =
      value.cursor === undefined ? undefined : decodeCursor(value.cursor);
    if (value.cursor !== undefined && !cursor) return null;
    return {
      cursor: cursor ?? undefined,
      filters,
      limit: typeof value.limit === "number" ? value.limit : DEFAULT_LIST_LIMIT,
      tenantId,
      type: "list",
    };
  }

  if (value.type === "exportCsv") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "tenantId",
        "limit",
        "startAt",
        "endAt",
        "action",
        "actorId",
        "entityType",
        "entityId",
        "freeText",
      ]) ||
      (value.limit !== undefined &&
        (typeof value.limit !== "number" ||
          !Number.isInteger(value.limit) ||
          value.limit < 1 ||
          value.limit > MAX_EXPORT_LIMIT))
    ) {
      return null;
    }
    return {
      filters,
      limit:
        typeof value.limit === "number" ? value.limit : DEFAULT_EXPORT_LIMIT,
      tenantId,
      type: "exportCsv",
    };
  }

  return null;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
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
    headers.set(
      "Access-Control-Expose-Headers",
      "X-Request-Id, X-NextDesk-Export-Truncated",
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
  const requestId = crypto.randomUUID();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Request-Id", requestId);
  if (status === 405) headers.set("Allow", "POST, OPTIONS");
  return new Response(JSON.stringify({ ...body, requestId }), {
    status,
    headers,
  });
}

function failure(request: Request, code: ErrorCode, status: number): Response {
  return json(request, { error: { code, ...ERROR_MESSAGES[code] } }, status);
}

function csvResponse(
  request: Request,
  csv: string,
  truncated: boolean,
): Response {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "text/csv; charset=utf-8");
  headers.set(
    "Content-Disposition",
    `attachment; filename="nextdesk-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  headers.set("X-Request-Id", crypto.randomUUID());
  headers.set("X-NextDesk-Export-Truncated", String(truncated));
  return new Response(`\uFEFF${csv}`, { status: 200, headers });
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

function auditQuery(admin: any, tenantId: string, filters: AuditFilters) {
  let query = admin
    .from("audit_logs")
    .select(
      "id, actor_id, action, entity_type, entity_id, severity, occurred_at",
    )
    .eq("tenant_id", tenantId);
  if (filters.startAt) query = query.gte("occurred_at", filters.startAt);
  if (filters.endAt) query = query.lte("occurred_at", filters.endAt);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.entityId) query = query.eq("entity_id", filters.entityId);
  return query;
}

function searchAndCursorFilter(
  filters: AuditFilters,
  cursor: AuditCursor | undefined,
): string | null {
  const cursorFilter = cursor
    ? `or(occurred_at.lt.${cursor.occurredAt},and(occurred_at.eq.${cursor.occurredAt},id.lt.${cursor.id}))`
    : null;
  if (!filters.freeText) return cursorFilter?.slice(3, -1) ?? null;

  const actionFilter = `action.ilike.*${filters.freeText}*`;
  const entityFilter = `entity_type.ilike.*${filters.freeText}*`;
  if (!cursorFilter) return `or(${actionFilter},${entityFilter})`;
  return `or(and(${actionFilter},${cursorFilter}),and(${entityFilter},${cursorFilter}))`;
}

function validateRows(value: unknown): AuditLogRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: AuditLogRow[] = [];
  for (const row of value) {
    if (
      !isRecord(row) ||
      !isUuid(row.id) ||
      (row.actor_id !== null && !isUuid(row.actor_id)) ||
      !validText(row.action, 240) ||
      !validText(row.entity_type, 240) ||
      (row.entity_id !== null && !isUuid(row.entity_id)) ||
      !validText(row.severity, 80) ||
      !isoTimestamp(row.occurred_at)
    ) {
      return null;
    }
    rows.push({
      action: row.action,
      actor_id: row.actor_id,
      entity_id: row.entity_id,
      entity_type: row.entity_type,
      id: row.id.toLowerCase(),
      occurred_at: row.occurred_at,
      severity: row.severity,
    });
  }
  return rows;
}

async function actorNamesForRows(
  admin: any,
  rows: readonly AuditLogRow[],
): Promise<Map<string, string | null>> {
  const actorIds = [
    ...new Set(
      rows
        .map((row) => row.actor_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const actorNames = new Map<string, string | null>();
  for (let index = 0; index < actorIds.length; index += 100) {
    const { data: profiles, error } = await admin
      .from("user_profiles")
      .select("id, display_name")
      .in("id", actorIds.slice(index, index + 100))
      .limit(100);
    if (error) throw new HttpError(500, "audit_log_actor_read_failed");
    for (const profile of profiles ?? []) {
      if (!isRecord(profile) || !isUuid(profile.id)) continue;
      actorNames.set(
        profile.id.toLowerCase(),
        typeof profile.display_name === "string" ? profile.display_name : null,
      );
    }
  }
  return actorNames;
}

function publicEntries(
  rows: readonly AuditLogRow[],
  actorNames: ReadonlyMap<string, string | null>,
) {
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    severity: row.severity,
    occurredAt: row.occurred_at,
    actorId: row.actor_id,
    actorName: row.actor_id
      ? actorNames.get(row.actor_id)?.trim() || "Benutzerkonto"
      : "System",
  }));
}

function csvCell(value: string | null): string {
  const normalized = value ?? "";
  return /[";\r\n]/.test(normalized)
    ? `"${normalized.replaceAll('"', '""')}"`
    : normalized;
}

function asCsv(
  rows: readonly AuditLogRow[],
  actorNames: ReadonlyMap<string, string | null>,
): string {
  const header = [
    "Zeitpunkt",
    "Aktion",
    "Person",
    "Personen-ID",
    "Objekttyp",
    "Objekt-ID",
    "Schweregrad",
    "Audit-ID",
  ];
  const records = rows.map((row) => [
    row.occurred_at,
    row.action,
    row.actor_id
      ? actorNames.get(row.actor_id)?.trim() || "Benutzerkonto"
      : "System",
    row.actor_id,
    row.entity_type,
    row.entity_id,
    row.severity,
    row.id,
  ]);
  return [header, ...records]
    .map((row) => row.map(csvCell).join(";"))
    .join("\r\n");
}

function exportMetadata(
  filters: AuditFilters,
  exportedRows: number,
  truncated: boolean,
) {
  return {
    exportedRows,
    truncated,
    filters: {
      action: Boolean(filters.action),
      actor: Boolean(filters.actorId),
      entity: Boolean(filters.entityType || filters.entityId),
      freeText: Boolean(filters.freeText),
      period: Boolean(filters.startAt || filters.endAt),
    },
  };
}

async function writeExportAudit(
  admin: any,
  tenantId: string,
  actorId: string,
  filters: AuditFilters,
  exportedRows: number,
  truncated: boolean,
): Promise<void> {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "tenant.audit_log.exported",
    entity_type: "audit_log_export",
    entity_id: null,
    metadata: exportMetadata(filters, exportedRows, truncated),
  });
  if (error) throw new HttpError(500, "audit_log_export_failed");
}

async function listAuditEntries(
  request: Request,
  admin: any,
  input: AuditListRequest,
): Promise<Response> {
  let query = auditQuery(admin, input.tenantId, input.filters);
  const searchFilter = searchAndCursorFilter(input.filters, input.cursor);
  if (searchFilter) query = query.or(searchFilter);
  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.limit + 1);
  if (error) throw new HttpError(500, "audit_log_read_failed");
  const rows = validateRows(data ?? []);
  if (!rows) throw new HttpError(500, "audit_log_read_failed");

  const visibleRows = rows.slice(0, input.limit);
  const actorNames = await actorNamesForRows(admin, visibleRows);
  const truncated = rows.length > input.limit;
  return json(request, {
    data: {
      entries: publicEntries(visibleRows, actorNames),
      nextCursor:
        truncated && visibleRows.length > 0
          ? encodeCursor(visibleRows[visibleRows.length - 1])
          : null,
      truncated,
    },
  });
}

async function exportAuditEntries(
  request: Request,
  admin: any,
  actorId: string,
  input: AuditExportRequest,
): Promise<Response> {
  const { data, error } = await auditQuery(admin, input.tenantId, input.filters)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.limit + 1);
  if (error) throw new HttpError(500, "audit_log_read_failed");
  const rows = validateRows(data ?? []);
  if (!rows) throw new HttpError(500, "audit_log_read_failed");

  const visibleRows = rows.slice(0, input.limit);
  const truncated = rows.length > input.limit;
  const actorNames = await actorNamesForRows(admin, visibleRows);
  await writeExportAudit(
    admin,
    input.tenantId,
    actorId,
    input.filters,
    visibleRows.length,
    truncated,
  );
  return csvResponse(request, asCsv(visibleRows, actorNames), truncated);
}

const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    try {
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) {
        throw new HttpError(401, "authentication_required");
      }
      const input = parseRequest(await request.json().catch(() => null));
      if (!input) throw new HttpError(400, "invalid_request");

      const authorization = await isTenantAdministrator(
        context.supabaseAdmin,
        actorId,
        input.tenantId,
      );
      if (authorization === "error") {
        throw new HttpError(503, "authorization_check_failed");
      }
      if (authorization !== "allowed") {
        throw new HttpError(403, "tenant_admin_required");
      }

      return input.type === "list"
        ? await listAuditEntries(request, context.supabaseAdmin, input)
        : await exportAuditEntries(
            request,
            context.supabaseAdmin,
            actorId.toLowerCase(),
            input,
          );
    } catch (error) {
      if (error instanceof HttpError) {
        return failure(request, error.code, error.status);
      }
      return failure(request, "audit_log_read_failed", 500);
    }
  },
);

async function boundedRequest(request: Request): Promise<Request> {
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)
  ) {
    throw new HttpError(413, "request_too_large");
  }
  if (!request.body) throw new HttpError(400, "invalid_request");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "request_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new HttpError(400, "invalid_request");
  }
  return new Request(request.url, {
    body,
    headers: request.headers,
    method: "POST",
    signal: request.signal,
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ALLOWED_ORIGIN) {
      return failure(request, "origin_not_allowed", 403);
    }
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) {
        return failure(request, "origin_not_allowed", 403);
      }
      const requestedMethod = request.headers.get(
        "access-control-request-method",
      );
      if (requestedMethod !== null && requestedMethod !== "POST") {
        return failure(request, "method_not_allowed", 405);
      }
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "POST") {
      return failure(request, "method_not_allowed", 405);
    }
    if (
      request.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      return failure(request, "unsupported_media_type", 415);
    }

    try {
      const result = await handler(await boundedRequest(request));
      if (result.headers.has("x-supabase-server-error")) {
        if (result.status === 401) {
          throw new HttpError(401, "authentication_required");
        }
        if (result.status === 403) {
          throw new HttpError(403, "tenant_admin_required");
        }
        throw new HttpError(503, "authorization_check_failed");
      }
      const headers = new Headers(result.headers);
      corsHeaders(request).forEach((value, key) => headers.set(key, value));
      return new Response(result.body, {
        status: result.status,
        headers,
      });
    } catch (error) {
      return failure(
        request,
        error instanceof HttpError ? error.code : "audit_log_read_failed",
        error instanceof HttpError ? error.status : 500,
      );
    }
  },
};
