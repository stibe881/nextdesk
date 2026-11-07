import { withSupabase } from "@supabase/server";

import {
  AUDIT_EXPORT_MAX_ROWS,
  AUDIT_LIST_DEFAULT_LIMIT,
  AUDIT_LIST_MAX_LIMIT,
  auditAreaPrefixFilter,
  auditCsvHeaderLine,
  auditCsvRow,
  auditEntityLink,
  auditEntityTypeLabel,
  type AuditExportEntry,
  type AuditFilters,
  isAuditUuid,
  parseAuditFilters,
  redactAuditSecrets,
} from "../_shared/audit-view.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 64 * 1024;
const EXPORT_BATCH_SIZE = 1_000;
const ACTOR_SEARCH_LIMIT = 20;

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
  audit_log_entry_not_found: {
    title: "Eintrag nicht gefunden",
    detail: "Der Protokolleintrag existiert nicht oder ist nicht verfügbar.",
    retryable: false,
  },
  audit_log_actor_read_failed: {
    title: "Änderungsprotokoll unvollständig",
    detail:
      "Die zugehörigen Benutzerinformationen konnten nicht geladen werden.",
    retryable: true,
  },
  audit_log_export_failed: {
    title: "Export nicht verfügbar",
    detail: "Der Export konnte nicht sicher protokolliert werden.",
    retryable: true,
  },
} as const;

type ErrorCode = keyof typeof ERROR_MESSAGES;

export type AuditCursor = { id: string; occurredAt: string };
export type AuditRequest =
  | {
      type: "list";
      tenantId: string;
      filters: AuditFilters;
      cursor?: AuditCursor;
      limit: number;
    }
  | { type: "detail"; tenantId: string; id: string }
  | { type: "actors"; tenantId: string; query?: string }
  | { type: "facets"; tenantId: string }
  | {
      type: "export";
      tenantId: string;
      filters: AuditFilters;
      format: "csv" | "json";
    };

type AuditLogRow = {
  id: string;
  action: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  severity: string;
  occurred_at: string;
  request_id: string | null;
  metadata: unknown;
  before_data: unknown;
  after_data: unknown;
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

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    !value.includes("\u0000") &&
    Number.isFinite(Date.parse(value))
  );
}

export function decodeCursor(value: unknown): AuditCursor | null {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(atob(base64));
    if (
      !isRecord(parsed) ||
      !isAuditUuid(parsed.id) ||
      !isoTimestamp(parsed.occurredAt)
    ) {
      return null;
    }
    return { id: parsed.id.toLowerCase(), occurredAt: parsed.occurredAt };
  } catch {
    return null;
  }
}

export function encodeCursor(row: { id: string; occurred_at: string }): string {
  return btoa(JSON.stringify({ id: row.id, occurredAt: row.occurred_at }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function parseRequest(value: unknown): AuditRequest | null {
  if (
    !isRecord(value) ||
    !isAuditUuid(value.tenantId) ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  const tenantId = value.tenantId.toLowerCase();

  switch (value.type) {
    case "list": {
      if (
        !hasOnlyKeys(value, ["type", "tenantId", "filters", "cursor", "limit"])
      ) {
        return null;
      }
      const filters = parseAuditFilters(value.filters);
      if (!filters) return null;
      if (
        value.limit !== undefined &&
        (typeof value.limit !== "number" ||
          !Number.isInteger(value.limit) ||
          value.limit < 1 ||
          value.limit > AUDIT_LIST_MAX_LIMIT)
      ) {
        return null;
      }
      const cursor =
        value.cursor === undefined || value.cursor === null
          ? undefined
          : decodeCursor(value.cursor);
      if (cursor === null) return null;
      return {
        type: "list",
        tenantId,
        filters,
        ...(cursor ? { cursor } : {}),
        limit:
          typeof value.limit === "number"
            ? value.limit
            : AUDIT_LIST_DEFAULT_LIMIT,
      };
    }
    case "detail": {
      if (!hasOnlyKeys(value, ["type", "tenantId", "id"])) return null;
      if (!isAuditUuid(value.id)) return null;
      return { type: "detail", tenantId, id: value.id.toLowerCase() };
    }
    case "actors": {
      if (!hasOnlyKeys(value, ["type", "tenantId", "query"])) return null;
      if (value.query === undefined || value.query === null) {
        return { type: "actors", tenantId };
      }
      if (
        typeof value.query !== "string" ||
        value.query.length > 120 ||
        !value.query.isWellFormed() ||
        // deno-lint-ignore no-control-regex
        /[\u0000-\u001f\u007f]/.test(value.query)
      ) {
        return null;
      }
      const query = value.query.trim();
      return query
        ? { type: "actors", tenantId, query }
        : { type: "actors", tenantId };
    }
    case "facets": {
      if (!hasOnlyKeys(value, ["type", "tenantId"])) return null;
      return { type: "facets", tenantId };
    }
    case "export": {
      if (!hasOnlyKeys(value, ["type", "tenantId", "filters", "format"])) {
        return null;
      }
      if (value.format !== "csv" && value.format !== "json") return null;
      const filters = parseAuditFilters(value.filters);
      if (!filters) return null;
      return { type: "export", tenantId, filters, format: value.format };
    }
    default:
      return null;
  }
}

/** Parameter für public.audit_log_search (Migration 0227). */
export function searchParameters(
  tenantId: string,
  filters: AuditFilters,
  cursor: AuditCursor | undefined,
  limit: number,
): Record<string, unknown> {
  const area = filters.area ? auditAreaPrefixFilter(filters.area) : null;
  return {
    p_tenant_id: tenantId,
    p_actor_id: filters.actorId ?? null,
    p_action: filters.action ?? null,
    p_action_prefixes: area?.include ?? null,
    p_excluded_prefixes: area && area.exclude.length > 0 ? area.exclude : null,
    p_entity_type: filters.entityType ?? null,
    p_entity_id: filters.entityId ?? null,
    p_severity: filters.severity ?? null,
    p_start_at: filters.startAt ?? null,
    p_end_at: filters.endAt ?? null,
    p_query: filters.freeText ?? null,
    p_cursor_at: cursor?.occurredAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: limit,
  };
}

/** Metadaten des Exports im Änderungsprotokoll: die tatsächlichen Filter. */
export function exportAuditMetadata(
  format: "csv" | "json",
  filters: AuditFilters,
  exportedRows: number,
  truncated: boolean,
): Record<string, unknown> {
  return {
    format,
    exportedRows,
    truncated,
    maxRows: AUDIT_EXPORT_MAX_ROWS,
    filters: { ...filters },
  };
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
      "Content-Disposition, X-Request-Id, X-NextDesk-Export-Truncated, X-NextDesk-Export-Rows",
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
    .select("role_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .limit(50);
  if (assignmentError) return "error";

  const roleIds = [
    ...new Set(
      (assignments ?? [])
        .map((assignment: any) => assignment.role_id)
        .filter((roleId: unknown): roleId is string => isAuditUuid(roleId)),
    ),
  ];
  if (roleIds.length === 0) return "forbidden";

  // Resolve roles in a second, explicitly tenant-scoped query. This avoids
  // relying on an embedded composite-FK relationship in the access-critical
  // request path and keeps the result unambiguous for all PostgREST versions.
  const { data: roles, error: roleError } = await admin
    .from("roles")
    .select("name, scope, active")
    .eq("tenant_id", tenantId)
    .in("id", roleIds)
    .limit(roleIds.length);
  if (roleError) return "error";

  const allowed = (roles ?? []).some(
    (role: any) =>
      role?.name === "Tenant administrator" &&
      role.scope === "tenant" &&
      role.active === true,
  );
  return allowed ? "allowed" : "forbidden";
}

function validateRows(value: unknown): AuditLogRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: AuditLogRow[] = [];
  for (const row of value) {
    if (
      !isRecord(row) ||
      !isAuditUuid(row.id) ||
      (row.actor_id !== null && !isAuditUuid(row.actor_id)) ||
      typeof row.action !== "string" ||
      typeof row.entity_type !== "string" ||
      (row.entity_id !== null && !isAuditUuid(row.entity_id)) ||
      typeof row.severity !== "string" ||
      !isoTimestamp(row.occurred_at)
    ) {
      return null;
    }
    rows.push({
      id: row.id.toLowerCase(),
      action: row.action,
      actor_id: row.actor_id === null ? null : row.actor_id.toLowerCase(),
      entity_type: row.entity_type,
      entity_id: row.entity_id === null ? null : row.entity_id.toLowerCase(),
      severity: row.severity,
      occurred_at: row.occurred_at,
      request_id: isAuditUuid(row.request_id) ? row.request_id : null,
      metadata: row.metadata ?? {},
      before_data: row.before_data ?? null,
      after_data: row.after_data ?? null,
    });
  }
  return rows;
}

async function searchRows(
  admin: any,
  tenantId: string,
  filters: AuditFilters,
  cursor: AuditCursor | undefined,
  limit: number,
): Promise<AuditLogRow[]> {
  const { data, error } = await admin.rpc(
    "audit_log_search",
    searchParameters(tenantId, filters, cursor, limit),
  );
  if (error) throw new HttpError(500, "audit_log_read_failed");
  const rows = validateRows(data ?? []);
  if (!rows) throw new HttpError(500, "audit_log_read_failed");
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
      if (!isRecord(profile) || !isAuditUuid(profile.id)) continue;
      actorNames.set(
        profile.id.toLowerCase(),
        typeof profile.display_name === "string" ? profile.display_name : null,
      );
    }
  }
  return actorNames;
}

function actorName(
  actorId: string | null,
  actorNames: ReadonlyMap<string, string | null>,
): string {
  return actorId
    ? actorNames.get(actorId)?.trim() || "Benutzerkonto"
    : "System";
}

function summaryEntry(
  row: AuditLogRow,
  actorNames: ReadonlyMap<string, string | null>,
) {
  const link = auditEntityLink(row.entity_type, row.entity_id, row.metadata);
  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    severity: row.severity,
    occurredAt: row.occurred_at,
    actorId: row.actor_id,
    actorName: actorName(row.actor_id, actorNames),
    ticketId: link?.kind === "ticket" ? link.ticketId : null,
    hasChanges: row.before_data !== null || row.after_data !== null,
  };
}

function exportEntry(
  row: AuditLogRow,
  actorNames: ReadonlyMap<string, string | null>,
): AuditExportEntry {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    action: row.action,
    actorId: row.actor_id,
    actorName: actorName(row.actor_id, actorNames),
    entityType: row.entity_type,
    entityId: row.entity_id,
    severity: row.severity,
    metadata: redactAuditSecrets(row.metadata),
    beforeData: redactAuditSecrets(row.before_data),
    afterData: redactAuditSecrets(row.after_data),
  };
}

async function listAuditEntries(
  request: Request,
  admin: any,
  input: Extract<AuditRequest, { type: "list" }>,
): Promise<Response> {
  const rows = await searchRows(
    admin,
    input.tenantId,
    input.filters,
    input.cursor,
    input.limit + 1,
  );
  const visibleRows = rows.slice(0, input.limit);
  const hasMore = rows.length > input.limit;
  const actorNames = await actorNamesForRows(admin, visibleRows);
  return json(request, {
    data: {
      entries: visibleRows.map((row) => summaryEntry(row, actorNames)),
      nextCursor:
        hasMore && visibleRows.length > 0
          ? encodeCursor(visibleRows[visibleRows.length - 1])
          : null,
      truncated: hasMore,
    },
  });
}

async function auditEntryDetail(
  request: Request,
  admin: any,
  input: Extract<AuditRequest, { type: "detail" }>,
): Promise<Response> {
  const { data, error } = await admin
    .from("audit_logs")
    .select(
      "id, action, actor_id, entity_type, entity_id, severity, occurred_at, request_id, metadata, before_data, after_data",
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.id)
    .maybeSingle();
  if (error) throw new HttpError(500, "audit_log_read_failed");
  if (!data) throw new HttpError(404, "audit_log_entry_not_found");
  const rows = validateRows([data]);
  if (!rows) throw new HttpError(500, "audit_log_read_failed");
  const row = rows[0];
  const actorNames = await actorNamesForRows(admin, rows);
  return json(request, {
    data: {
      entry: {
        ...summaryEntry(row, actorNames),
        requestId: row.request_id,
        metadata: redactAuditSecrets(row.metadata),
        beforeData: redactAuditSecrets(row.before_data),
        afterData: redactAuditSecrets(row.after_data),
      },
    },
  });
}

async function searchActors(
  request: Request,
  admin: any,
  input: Extract<AuditRequest, { type: "actors" }>,
): Promise<Response> {
  const { data, error } = await admin.rpc("audit_log_actor_search", {
    p_tenant_id: input.tenantId,
    p_query: input.query ?? null,
    p_limit: ACTOR_SEARCH_LIMIT,
  });
  if (error || !Array.isArray(data)) {
    throw new HttpError(500, "audit_log_actor_read_failed");
  }
  const actors = data.flatMap((row: unknown) => {
    if (!isRecord(row) || !isAuditUuid(row.user_id)) return [];
    const name =
      typeof row.display_name === "string" ? row.display_name.trim() : "";
    const email = typeof row.email === "string" ? row.email : null;
    return [
      {
        id: row.user_id.toLowerCase(),
        name: name || email || "Benutzerkonto",
        email,
      },
    ];
  });
  return json(request, { data: { actors } });
}

async function auditFacets(
  request: Request,
  admin: any,
  input: Extract<AuditRequest, { type: "facets" }>,
): Promise<Response> {
  const { data, error } = await admin.rpc("audit_log_entity_types", {
    p_tenant_id: input.tenantId,
  });
  if (error || !Array.isArray(data)) {
    throw new HttpError(500, "audit_log_read_failed");
  }
  const entityTypes = data.flatMap((row: unknown) =>
    isRecord(row) && typeof row.entity_type === "string"
      ? [
          {
            value: row.entity_type,
            label: auditEntityTypeLabel(row.entity_type),
          },
        ]
      : [],
  );
  return json(request, { data: { entityTypes } });
}

/**
 * Lädt höchstens AUDIT_EXPORT_MAX_ROWS + 1 Einträge in Blöcken zu 1000
 * (Keyset), damit eine Kürzung zuverlässig erkannt wird.
 */
export async function collectExportRows<
  Row extends { id: string; occurred_at: string },
>(
  fetchBatch: (
    cursor: AuditCursor | undefined,
    limit: number,
  ) => Promise<Row[]>,
  maxRows = AUDIT_EXPORT_MAX_ROWS,
  batchSize = EXPORT_BATCH_SIZE,
): Promise<{ rows: Row[]; truncated: boolean }> {
  const rows: Row[] = [];
  let cursor: AuditCursor | undefined;
  while (rows.length <= maxRows) {
    const wanted = Math.min(batchSize, maxRows + 1 - rows.length);
    const batch = await fetchBatch(cursor, wanted);
    rows.push(...batch);
    if (batch.length < wanted) break;
    const last = batch[batch.length - 1];
    cursor = { id: last.id, occurredAt: last.occurred_at };
  }
  return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
}

async function exportAuditEntries(
  request: Request,
  admin: any,
  actorId: string,
  input: Extract<AuditRequest, { type: "export" }>,
): Promise<Response> {
  const { rows, truncated } = await collectExportRows((cursor, limit) =>
    searchRows(admin, input.tenantId, input.filters, cursor, limit),
  );
  const actorNames = await actorNamesForRows(admin, rows);
  const entries = rows.map((row) => exportEntry(row, actorNames));

  // Fail closed: without a written audit entry no export leaves the server.
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: input.tenantId,
    actor_id: actorId,
    action: "audit.exported",
    entity_type: "audit_log_export",
    entity_id: null,
    severity: "security",
    metadata: exportAuditMetadata(
      input.format,
      input.filters,
      entries.length,
      truncated,
    ),
  });
  if (error) throw new HttpError(500, "audit_log_export_failed");

  const date = new Date().toISOString().slice(0, 10);
  const headers = corsHeaders(request);
  headers.set("X-Request-Id", crypto.randomUUID());
  headers.set("X-NextDesk-Export-Truncated", String(truncated));
  headers.set("X-NextDesk-Export-Rows", String(entries.length));

  if (input.format === "json") {
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set(
      "Content-Disposition",
      `attachment; filename="nextdesk-audit-${date}.json"`,
    );
    return new Response(
      JSON.stringify({
        exportedAt: new Date().toISOString(),
        filters: input.filters,
        truncated,
        count: entries.length,
        entries,
      }),
      { status: 200, headers },
    );
  }

  // Stream the CSV line by line so the full document never exists as one
  // additional string in memory.
  headers.set("Content-Type", "text/csv; charset=utf-8");
  headers.set(
    "Content-Disposition",
    `attachment; filename="nextdesk-audit-${date}.csv"`,
  );
  const encoder = new TextEncoder();
  let index = -1;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === -1) {
        controller.enqueue(encoder.encode(`﻿${auditCsvHeaderLine()}\r\n`));
      } else if (index < entries.length) {
        const chunk = entries
          .slice(index, index + 200)
          .map((entry) => `${auditCsvRow(entry)}\r\n`)
          .join("");
        controller.enqueue(encoder.encode(chunk));
      } else {
        controller.close();
        return;
      }
      index = index === -1 ? 0 : index + 200;
    },
  });
  return new Response(body, { status: 200, headers });
}

const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    try {
      const actorId = context.userClaims?.id;
      if (!isAuditUuid(actorId)) {
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

      const admin = context.supabaseAdmin;
      switch (input.type) {
        case "list":
          return await listAuditEntries(request, admin, input);
        case "detail":
          return await auditEntryDetail(request, admin, input);
        case "actors":
          return await searchActors(request, admin, input);
        case "facets":
          return await auditFacets(request, admin, input);
        case "export":
          return await exportAuditEntries(
            request,
            admin,
            actorId.toLowerCase(),
            input,
          );
      }
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
