import { type SupabaseContext, withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_TEXT_LENGTH = 50_000;
const MAX_METADATA_BYTES = 32 * 1024;
const PAGE_SIZE = 500;
// PostgREST GET filters encode each UUID in the URL. A catalogue page may hold
// 500 assets, but resolving all of their optional Intune links in one `.in()`
// filter exceeds practical request-URI limits. Keep this lookup deliberately
// bounded; it changes only the batching, never the visible asset set.
const INTUNE_PRIMARY_PERSON_LOOKUP_PAGE_SIZE = 100;
const MAX_CATALOG_ROWS = 10_000;
const MAX_TICKET_SEARCH_RESULTS = 30;
const SERVICE_SELECT =
  "id, tenant_id, name, description, criticality, status, status_public, active, created_at, updated_at";
const ASSET_SELECT =
  "id, tenant_id, service_id, name, asset_tag, inventory_number, serial_number, manufacturer, model, operating_system, kind, status, customer_organization_id, metadata, active, created_at, updated_at";
const PROBLEM_SELECT =
  "id, tenant_id, title, description, status, workaround, root_cause, owner_id, created_by, created_at, updated_at";
const TICKET_SUMMARY_SELECT =
  "id, ticket_number, subject, status:ticket_statuses!inner(label)";
const PROBLEM_TICKET_SUMMARY_SELECT = `tickets!inner(${TICKET_SUMMARY_SELECT})`;

// Requests use `type`; update/archive/resolve require serviceId, assetId or
// problemId, respectively. Updates are partial, but must change at least one
// allowed field. Immutable IDs, tenant IDs, actors and timestamps are never
// accepted as writable fields.
type JsonValue =
  | null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type Kind = "service" | "asset" | "problem";
type ManageType = "manageService" | "manageAsset" | "manageProblem";
type Operation = "create" | "update" | "archive" | "restore" | "resolve";
type Action =
  | {
      type: "listCatalog";
      tenantId: string;
      includeArchivedServices: boolean;
    }
  | { type: "listProblemOwners"; tenantId: string }
  | { type: "listProblemTickets"; tenantId: string; problemId: string }
  | { type: "searchTickets"; tenantId: string; query: string }
  | {
      type: ManageType;
      tenantId: string;
      operation: Operation;
      id?: string;
      values: Record<string, JsonValue>;
    }
  | {
      type: "linkTicket" | "unlinkTicket";
      tenantId: string;
      ticketId: string;
      kind: Kind;
      targetId: string;
    };
type CallerClient = SupabaseContext["supabase"];
type AdminClient = SupabaseContext["supabaseAdmin"];
type DatabaseError = { code?: string };
type Row = Record<string, unknown>;
type TicketSummary = {
  id: string;
  ticketNumber: string;
  subject: string;
  statusLabel: string;
};
const INVALID = Symbol("invalid");
type Validator = (value: unknown) => JsonValue | typeof INVALID;
type Field = { column: string; validate: Validator };

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

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function validString(value: unknown): value is string {
  // PostgreSQL text/jsonb cannot store NUL or unpaired UTF-16 surrogates.
  return (
    typeof value === "string" &&
    !value.includes("\u0000") &&
    value.isWellFormed()
  );
}

function text(min: number, max: number, trim = true): Validator {
  return (value) => {
    if (!validString(value)) return INVALID;
    const result = trim ? value.trim() : value;
    const length = [...result].length;
    return length >= min && length <= max ? result : INVALID;
  };
}

function nullable(validate: Validator): Validator {
  return (value) => (value === null ? null : validate(value));
}

function enumeration(values: string[]): Validator {
  return (value) =>
    typeof value === "string" && values.includes(value) ? value : INVALID;
}

const uuid: Validator = (value) =>
  isUuid(value) ? value.toLowerCase() : INVALID;
const boolean: Validator = (value) =>
  typeof value === "boolean" ? value : INVALID;
const description = text(0, MAX_TEXT_LENGTH, false);

function metadata(value: unknown): JsonValue | typeof INVALID {
  if (!isRecord(value)) return INVALID;
  let nodes = 0;
  function validJson(item: unknown, depth: number): boolean {
    if (depth > 8 || ++nodes > 2_000) return false;
    if (item === null || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item === "string") return validString(item);
    if (Array.isArray(item)) {
      return item.every((entry) => validJson(entry, depth + 1));
    }
    if (!isRecord(item)) return false;
    return Object.entries(item).every(
      ([key, entry]) => validString(key) && validJson(entry, depth + 1),
    );
  }
  if (!validJson(value, 0)) return INVALID;
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    MAX_METADATA_BYTES
  ) {
    return INVALID;
  }
  return value as { [key: string]: JsonValue };
}

const SERVICE_FIELDS: Record<string, Field> = {
  name: { column: "name", validate: text(1, 240) },
  description: { column: "description", validate: nullable(description) },
  criticality: {
    column: "criticality",
    validate: enumeration(["low", "medium", "high", "critical"]),
  },
  status: {
    column: "status",
    validate: enumeration([
      "operational",
      "degraded",
      "partial_outage",
      "major_outage",
      "maintenance",
    ]),
  },
  statusPublic: { column: "status_public", validate: boolean },
};
const ASSET_FIELDS: Record<string, Field> = {
  name: { column: "name", validate: text(1, 240) },
  serviceId: { column: "service_id", validate: nullable(uuid) },
  assetTag: { column: "asset_tag", validate: nullable(text(1, 160)) },
  inventoryNumber: {
    column: "inventory_number",
    validate: nullable(text(1, 160)),
  },
  serialNumber: { column: "serial_number", validate: nullable(text(1, 160)) },
  manufacturer: { column: "manufacturer", validate: nullable(text(1, 160)) },
  model: { column: "model", validate: nullable(text(1, 160)) },
  operatingSystem: {
    column: "operating_system",
    validate: nullable(text(1, 160)),
  },
  kind: { column: "kind", validate: text(1, 64) },
  status: { column: "status", validate: text(1, 64) },
  customerOrganizationId: {
    column: "customer_organization_id",
    validate: nullable(uuid),
  },
  metadata: { column: "metadata", validate: metadata },
  active: { column: "active", validate: boolean },
};
const PROBLEM_FIELDS: Record<string, Field> = {
  title: { column: "title", validate: text(3, 240) },
  description: { column: "description", validate: description },
  status: {
    column: "status",
    validate: enumeration(["open", "investigating", "known_error", "resolved"]),
  },
  workaround: { column: "workaround", validate: nullable(description) },
  rootCause: { column: "root_cause", validate: nullable(description) },
  ownerId: { column: "owner_id", validate: nullable(uuid) },
};
const RESOLUTION_FIELDS: Record<string, Field> = {
  workaround: PROBLEM_FIELDS.workaround,
  rootCause: PROBLEM_FIELDS.rootCause,
};
const RESOURCES = {
  manageService: {
    table: "services",
    select: SERVICE_SELECT,
    key: "service",
    idKey: "serviceId",
    required: "name",
    fields: SERVICE_FIELDS,
  },
  manageAsset: {
    table: "assets",
    select: ASSET_SELECT,
    key: "asset",
    idKey: "assetId",
    required: "name",
    fields: ASSET_FIELDS,
  },
  manageProblem: {
    table: "problems",
    select: PROBLEM_SELECT,
    key: "problem",
    idKey: "problemId",
    required: "title",
    fields: PROBLEM_FIELDS,
  },
} as const;
const LINKS = {
  service: {
    table: "ticket_services",
    column: "service_id",
    targetTable: "services",
  },
  asset: {
    table: "ticket_assets",
    column: "asset_id",
    targetTable: "assets",
  },
  problem: {
    table: "problem_tickets",
    column: "problem_id",
    targetTable: "problems",
  },
} as const;

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  if (value.type === "listCatalog") {
    if (
      !hasOnlyKeys(value, ["type", "tenantId", "includeArchivedServices"]) ||
      (Object.hasOwn(value, "includeArchivedServices") &&
        typeof value.includeArchivedServices !== "boolean")
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId,
      includeArchivedServices: value.includeArchivedServices === true,
    };
  }
  if (value.type === "listProblemOwners") {
    return hasOnlyKeys(value, ["type", "tenantId"])
      ? { type: value.type, tenantId }
      : null;
  }
  if (value.type === "listProblemTickets") {
    if (
      !hasOnlyKeys(value, ["type", "tenantId", "problemId"]) ||
      !isUuid(value.problemId)
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId,
      problemId: value.problemId.toLowerCase(),
    };
  }
  if (value.type === "searchTickets") {
    if (!hasOnlyKeys(value, ["type", "tenantId", "query"])) return null;
    const query = text(2, 120)(value.query);
    if (typeof query !== "string") return null;
    return { type: value.type, tenantId, query };
  }
  if (value.type === "linkTicket" || value.type === "unlinkTicket") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "tenantId",
        "ticketId",
        "kind",
        "targetId",
      ]) ||
      !isUuid(value.ticketId) ||
      !isUuid(value.targetId) ||
      (value.kind !== "service" &&
        value.kind !== "asset" &&
        value.kind !== "problem")
    )
      return null;
    return {
      type: value.type,
      tenantId,
      ticketId: value.ticketId.toLowerCase(),
      kind: value.kind,
      targetId: value.targetId.toLowerCase(),
    };
  }
  if (
    value.type !== "manageService" &&
    value.type !== "manageAsset" &&
    value.type !== "manageProblem"
  )
    return null;
  const resource = RESOURCES[value.type];
  const operation = value.operation;
  if (
    operation !== "create" &&
    operation !== "update" &&
    !(value.type !== "manageProblem" && operation === "archive") &&
    !(value.type === "manageService" && operation === "restore") &&
    !(value.type === "manageProblem" && operation === "resolve")
  )
    return null;
  const fields =
    operation === "archive" || operation === "restore"
      ? {}
      : operation === "resolve"
        ? RESOLUTION_FIELDS
        : resource.fields;
  const allowedKeys = ["type", "tenantId", "operation", ...Object.keys(fields)];
  if (operation !== "create") allowedKeys.push(resource.idKey);
  if (!hasOnlyKeys(value, allowedKeys)) return null;
  const id = operation === "create" ? undefined : value[resource.idKey];
  if (operation !== "create" && !isUuid(id)) return null;
  if (operation === "create" && !Object.hasOwn(value, resource.required)) {
    return null;
  }
  const values: Record<string, JsonValue> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (!Object.hasOwn(value, key)) continue;
    const validated = field.validate(value[key]);
    if (validated === INVALID) return null;
    values[field.column] = validated;
  }
  if (operation === "update" && Object.keys(values).length === 0) return null;
  return {
    type: value.type,
    tenantId,
    operation,
    ...(typeof id === "string" ? { id: id.toLowerCase() } : {}),
    values,
  };
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

function databaseFailure(error: DatabaseError): never {
  // Never send PostgreSQL messages, details, hints, constraint names or rows.
  switch (error.code) {
    case "23505":
      throw new HttpError(
        409,
        "conflict",
        "Der Eintrag oder die Verknüpfung besteht bereits.",
      );
    case "23503":
      throw new HttpError(
        422,
        "invalid_reference",
        "Eine Referenz ist für diesen Mandanten nicht verfügbar.",
      );
    case "23514":
    case "23502":
    case "22001":
    case "22021":
    case "22023":
    case "22P02":
    case "22P05":
      throw new HttpError(
        422,
        "invalid_data",
        "Die Daten verletzen eine zulässige Datenbankbedingung.",
      );
    case "42501":
      throw new HttpError(
        403,
        "permission_denied",
        "Für diese Aktion fehlt die Berechtigung.",
      );
    case "42P01":
    case "42883":
    case "PGRST202":
    case "PGRST204":
    case "PGRST205":
      throw new HttpError(
        503,
        "database_unavailable",
        "Der Datenzugriff ist derzeit nicht verfügbar.",
      );
    default:
      throw new HttpError(
        500,
        "operation_failed",
        "Die Aktion konnte nicht abgeschlossen werden.",
      );
  }
}

async function requirePermission(
  client: CallerClient,
  rpc:
    | "is_active_tenant_member"
    | "has_tenant_permission"
    | "has_ticket_permission",
  args: Record<string, string>,
  deniedCode: string,
): Promise<void> {
  const { data, error } = await client.rpc(rpc, args);
  if (error || typeof data !== "boolean") {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  }
  if (data !== true) {
    throw new HttpError(
      403,
      deniedCode,
      "Für diese Aktion fehlt die Berechtigung.",
    );
  }
}

async function readCatalog(
  client: CallerClient,
  tenantId: string,
  resource: { table: string; select: string; key: Kind },
  active = true,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client
      .from(resource.table)
      .select(resource.select)
      .eq("tenant_id", tenantId);
    query =
      resource.key === "problem"
        ? query
            .in("status", ["open", "investigating", "known_error"])
            .order("updated_at", { ascending: false })
        : query.eq("active", active).order("name");
    const { data, error } = await query
      .order("id")
      .range(from, from + PAGE_SIZE - 1)
      .overrideTypes<Row[], { merge: false }>();
    if (error) databaseFailure(error);
    if (!data) {
      throw new HttpError(
        500,
        "catalog_read_failed",
        "Der Katalog konnte nicht vollständig gelesen werden.",
      );
    }
    rows.push(...data);
    if (rows.length > MAX_CATALOG_ROWS) {
      throw new HttpError(
        413,
        "catalog_limit_exceeded",
        "Der Katalog ist für eine einzelne Anfrage zu groß.",
      );
    }
    if (data.length < PAGE_SIZE) return rows;
  }
}

async function readIntunePrimaryPersonNames(
  admin: AdminClient,
  tenantId: string,
  assets: Row[],
): Promise<Row[]> {
  const assetIds = new Set(
    assets.flatMap((asset) => (isUuid(asset.id) ? [asset.id] : [])),
  );
  if (assetIds.size === 0) {
    return assets.map((asset) => ({
      ...asset,
      intune_primary_person_name: null,
    }));
  }

  const links: Row[] = [];
  const assetIdList = [...assetIds];
  for (
    let index = 0;
    index < assetIdList.length;
    index += INTUNE_PRIMARY_PERSON_LOOKUP_PAGE_SIZE
  ) {
    const { data, error } = await admin
      .from("asset_intune_primary_person_links")
      .select("asset_id, entra_object_id")
      .eq("tenant_id", tenantId)
      .in(
        "asset_id",
        assetIdList.slice(
          index,
          index + INTUNE_PRIMARY_PERSON_LOOKUP_PAGE_SIZE,
        ),
      )
      .overrideTypes<Row[], { merge: false }>();
    if (error) databaseFailure(error);
    if (!data) {
      throw new HttpError(
        500,
        "catalog_read_failed",
        "Der Katalog konnte nicht vollständig gelesen werden.",
      );
    }
    links.push(
      ...data.filter(
        (link) => isUuid(link.asset_id) && assetIds.has(link.asset_id),
      ),
    );
  }

  const personIds = [
    ...new Set(
      links.flatMap((link) =>
        isUuid(link.entra_object_id) ? [link.entra_object_id] : [],
      ),
    ),
  ];
  const namesByPersonId = new Map<string, string>();
  for (let index = 0; index < personIds.length; index += PAGE_SIZE) {
    const { data, error } = await admin
      .from("tenant_entra_directory_people")
      .select("entra_object_id, display_name")
      .eq("tenant_id", tenantId)
      .eq("account_enabled", true)
      .is("inactive_at", null)
      .in("entra_object_id", personIds.slice(index, index + PAGE_SIZE))
      .overrideTypes<Row[], { merge: false }>();
    if (error) databaseFailure(error);
    for (const person of data ?? []) {
      if (
        isUuid(person.entra_object_id) &&
        validString(person.display_name) &&
        person.display_name.trim()
      ) {
        namesByPersonId.set(person.entra_object_id, person.display_name.trim());
      }
    }
  }

  const personByAssetId = new Map<string, string>();
  for (const link of links) {
    if (!isUuid(link.asset_id) || !isUuid(link.entra_object_id)) continue;
    const displayName = namesByPersonId.get(link.entra_object_id);
    if (displayName) personByAssetId.set(link.asset_id, displayName);
  }
  return assets.map((asset) => ({
    ...asset,
    intune_primary_person_name: isUuid(asset.id)
      ? (personByAssetId.get(asset.id) ?? null)
      : null,
  }));
}

function ticketSummary(row: unknown): TicketSummary | null {
  if (!isRecord(row) || !isUuid(row.id)) return null;
  if (!validString(row.ticket_number) || !validString(row.subject)) return null;
  const status = row.status;
  if (!isRecord(status) || !validString(status.label)) return null;
  return {
    id: row.id.toLowerCase(),
    ticketNumber: row.ticket_number,
    subject: row.subject,
    statusLabel: status.label,
  };
}

function requiredTicketSummary(row: unknown): TicketSummary {
  const summary = ticketSummary(row);
  if (!summary) {
    throw new HttpError(
      500,
      "ticket_read_failed",
      "Die Ticketdaten konnten nicht sicher gelesen werden.",
    );
  }
  return summary;
}

function uniqueTicketSummaries(
  rows: unknown[],
  limit = Number.POSITIVE_INFINITY,
): TicketSummary[] {
  const seen = new Set<string>();
  const tickets: TicketSummary[] = [];
  for (const row of rows) {
    const ticket = requiredTicketSummary(row);
    if (seen.has(ticket.id)) continue;
    seen.add(ticket.id);
    tickets.push(ticket);
    if (tickets.length === limit) break;
  }
  return tickets;
}

function escapeLikePattern(value: string): string {
  // Escape SQL LIKE metacharacters so a short query cannot turn into an
  // unbounded wildcard search. The Supabase query builder encodes the value.
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replaceAll("*", "\\*");
}

async function requireReadableProblem(
  client: CallerClient,
  tenantId: string,
  problemId: string,
): Promise<void> {
  // This caller-scoped SELECT is the problem-read authorization boundary. It
  // deliberately relies on the current problem RLS policy rather than a
  // service-role lookup or a caller-supplied tenant relationship.
  const { data, error } = await client
    .from("problems")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", problemId)
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data) {
    throw new HttpError(
      404,
      "problem_not_found",
      "Der Fall ist nicht verfügbar.",
    );
  }
}

async function listProblemOwners(
  request: Request,
  client: CallerClient,
  admin: AdminClient,
  action: Extract<Action, { type: "listProblemOwners" }>,
): Promise<Response> {
  await requirePermission(
    client,
    "has_tenant_permission",
    {
      p_tenant_id: action.tenantId,
      p_permission_code: "asset.manage",
    },
    "asset_manage_required",
  );
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("user_id, user_profiles!inner(display_name)")
    .eq("tenant_id", action.tenantId)
    .eq("status", "active")
    .order("user_id")
    .limit(500)
    .overrideTypes<Row[], { merge: false }>();
  if (error) databaseFailure(error);
  const owners = (data ?? []).flatMap((membership) => {
    const profile = membership.user_profiles;
    return typeof membership.user_id === "string" &&
      isRecord(profile) &&
      validString(profile.display_name) &&
      profile.display_name.trim()
      ? [{ id: membership.user_id, displayName: profile.display_name.trim() }]
      : [];
  });
  owners.sort((left, right) =>
    left.displayName.localeCompare(right.displayName, "de-CH"),
  );
  return json(request, { data: { owners } });
}

async function listProblemTickets(
  request: Request,
  client: CallerClient,
  action: Extract<Action, { type: "listProblemTickets" }>,
): Promise<Response> {
  await requireReadableProblem(client, action.tenantId, action.problemId);
  // Both the link-table policy and the nested tickets relation use the caller
  // client. Consequently an active member can receive only ticket rows that
  // existing ticket RLS permits them to read.
  const { data, error } = await client
    .from("problem_tickets")
    .select(PROBLEM_TICKET_SUMMARY_SELECT)
    .eq("tenant_id", action.tenantId)
    .eq("problem_id", action.problemId)
    .order("created_at", { ascending: false })
    .overrideTypes<Row[], { merge: false }>();
  if (error) databaseFailure(error);
  if (!data) {
    throw new HttpError(
      500,
      "ticket_read_failed",
      "Die Ticketdaten konnten nicht sicher gelesen werden.",
    );
  }
  const tickets = uniqueTicketSummaries(
    data.map((row) => (isRecord(row) ? row.tickets : null)),
  );
  return json(request, { data: { tickets } });
}

async function searchTickets(
  request: Request,
  client: CallerClient,
  action: Extract<Action, { type: "searchTickets" }>,
): Promise<Response> {
  const pattern = `%${escapeLikePattern(action.query)}%`;
  // Use two parameterized filters instead of inserting the query into a raw
  // PostgREST `or` expression. Both reads remain scoped to the caller's RLS.
  const [numberResult, subjectResult] = await Promise.all([
    client
      .from("tickets")
      .select(TICKET_SUMMARY_SELECT)
      .eq("tenant_id", action.tenantId)
      .ilike("ticket_number", pattern)
      .order("ticket_number")
      .limit(MAX_TICKET_SEARCH_RESULTS)
      .overrideTypes<Row[], { merge: false }>(),
    client
      .from("tickets")
      .select(TICKET_SUMMARY_SELECT)
      .eq("tenant_id", action.tenantId)
      .ilike("subject", pattern)
      .order("ticket_number")
      .limit(MAX_TICKET_SEARCH_RESULTS)
      .overrideTypes<Row[], { merge: false }>(),
  ]);
  if (numberResult.error) databaseFailure(numberResult.error);
  if (subjectResult.error) databaseFailure(subjectResult.error);
  const tickets = uniqueTicketSummaries(
    [...(numberResult.data ?? []), ...(subjectResult.data ?? [])],
    MAX_TICKET_SEARCH_RESULTS,
  );
  return json(request, { data: { tickets } });
}

async function manageResource(
  request: Request,
  client: CallerClient,
  actorId: string,
  action: Extract<Action, { type: ManageType }>,
): Promise<Response> {
  await requirePermission(
    client,
    "has_tenant_permission",
    {
      p_tenant_id: action.tenantId,
      p_permission_code: "asset.manage",
    },
    "asset_manage_required",
  );
  const resource = RESOURCES[action.type];
  // The resource is selected from a finite, server-owned table map. Avoid
  // expanding PostgREST's full table-union here; values were strictly parsed
  // above and the same tenant filters are applied in every mutation branch.
  const resourceClient: any = client.from(resource.table);
  if (action.operation === "create") {
    const { data, error } = await resourceClient
      .insert({
        ...action.values,
        tenant_id: action.tenantId,
        ...(resource.key === "problem" ? { created_by: actorId } : {}),
      })
      .select(resource.select)
      .single();
    if (error) databaseFailure(error);
    if (!data) {
      throw new HttpError(
        500,
        "operation_failed",
        "Die Aktion konnte nicht abgeschlossen werden.",
      );
    }
    return json(request, { data: { [resource.key]: data } }, 201);
  }
  // Tenant and row filters are mandatory even though the caller's RLS also
  // protects every write. Constraints enforce cross-tenant references and the
  // migration's triggers handle timestamps, immutable identity and audit logs.
  const values =
    action.operation === "archive"
      ? action.type === "manageService"
        ? { active: false, status_public: false }
        : { active: false }
      : action.operation === "restore"
        ? { active: true }
        : action.operation === "resolve"
        ? { ...action.values, status: "resolved" }
        : action.values;
  const { data, error } = await resourceClient
    .update(values)
    .eq("tenant_id", action.tenantId)
    .eq("id", action.id!)
    .select(resource.select)
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data) {
    throw new HttpError(
      404,
      "resource_not_found",
      "Der Eintrag ist nicht verfügbar.",
    );
  }
  return json(request, { data: { [resource.key]: data } });
}

async function mutateTicketLink(
  request: Request,
  client: CallerClient,
  actorId: string,
  action: Extract<Action, { type: "linkTicket" | "unlinkTicket" }>,
): Promise<Response> {
  // Read the actual ticket with caller-scoped SELECT/RLS, never a supplied
  // department and never an admin client. asset.manage cannot grant linking.
  const { data: ticket, error: ticketError } = await client
    .from("tickets")
    .select("id, tenant_id, department_id")
    .eq("tenant_id", action.tenantId)
    .eq("id", action.ticketId)
    .maybeSingle();
  if (ticketError) databaseFailure(ticketError);
  if (!ticket) {
    throw new HttpError(
      404,
      "ticket_not_found",
      "Das Ticket ist nicht verfügbar.",
    );
  }
  if (!isUuid(ticket.department_id) || ticket.tenant_id !== action.tenantId) {
    throw new HttpError(
      500,
      "operation_failed",
      "Die Aktion konnte nicht abgeschlossen werden.",
    );
  }
  await requirePermission(
    client,
    "has_ticket_permission",
    {
      p_tenant_id: ticket.tenant_id,
      p_department_id: ticket.department_id,
      p_permission_code: "ticket.update",
    },
    "ticket_update_required",
  );
  const link = LINKS[action.kind];
  const { data: target, error: targetError } = await client
    .from(link.targetTable)
    .select("id")
    .eq("tenant_id", action.tenantId)
    .eq("id", action.targetId)
    .maybeSingle();
  if (targetError) databaseFailure(targetError);
  if (!target) {
    throw new HttpError(
      404,
      "target_not_found",
      "Das Verknüpfungsziel ist nicht verfügbar.",
    );
  }
  const columns = `tenant_id, ticket_id, ${link.column}, linked_by, created_at`;
  // No upsert: duplicates are conflicts, not updates of the original actor.
  const result =
    action.type === "linkTicket"
      ? await client
          .from(link.table)
          .insert({
            tenant_id: action.tenantId,
            ticket_id: action.ticketId,
            [link.column]: action.targetId,
            linked_by: actorId,
          })
          .select(columns)
          .single()
      : await client
          .from(link.table)
          .delete()
          .eq("tenant_id", action.tenantId)
          .eq("ticket_id", action.ticketId)
          .eq(link.column, action.targetId)
          .select(columns)
          .maybeSingle();
  if (result.error) databaseFailure(result.error);
  if (!result.data) {
    throw new HttpError(
      404,
      "link_not_found",
      "Die Verknüpfung ist nicht verfügbar.",
    );
  }
  return json(
    request,
    {
      data: {
        link: {
          tenantId: action.tenantId,
          ticketId: action.ticketId,
          kind: action.kind,
          targetId: action.targetId,
          linked: action.type === "linkTicket",
        },
      },
    },
    action.type === "linkTicket" ? 201 : 200,
  );
}

const handler = withSupabase(
  // The library defaults to wildcard CORS; handle CORS ourselves, including
  // authentication failures. Business queries exclusively use ctx.supabase.
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    try {
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) {
        throw new HttpError(
          401,
          "authentication_required",
          "Eine gültige Benutzeranmeldung ist erforderlich.",
        );
      }
      const action = parseAction(await request.json().catch(() => null));
      if (!action) {
        throw new HttpError(
          400,
          "invalid_request",
          "Die Anfrage enthält ungültige oder unbekannte Felder.",
        );
      }
      const client = context.supabase;
      await requirePermission(
        client,
        "is_active_tenant_member",
        {
          p_tenant_id: action.tenantId,
        },
        "tenant_membership_required",
      );
      const featureStates = await resolveTenantFeatureStates(
        context.supabaseAdmin,
        action.tenantId,
        ["assets.management"],
      );
      if (!featureStates) {
        throw new HttpError(
          503,
          "tenant_feature_lookup_failed",
          "Die Funktionsberechtigung konnte nicht geprüft werden.",
        );
      }
      if (featureStates["assets.management"] !== true) {
        throw new HttpError(
          403,
          "asset_feature_disabled",
          "Das Asset-Management ist für diesen Mandanten deaktiviert.",
        );
      }
      if (action.type === "listCatalog") {
        const [services, assets, problems, assetManage] = await Promise.all([
          readCatalog(client, action.tenantId, RESOURCES.manageService),
          readCatalog(client, action.tenantId, RESOURCES.manageAsset),
          readCatalog(client, action.tenantId, RESOURCES.manageProblem),
          client.rpc("has_tenant_permission", {
            p_tenant_id: action.tenantId,
            p_permission_code: "asset.manage",
          }),
        ]);
        if (assetManage.error || typeof assetManage.data !== "boolean") {
          throw new HttpError(
            503,
            "authorization_check_failed",
            "Die Berechtigung konnte nicht geprüft werden.",
          );
        }
        const archivedServices =
          action.includeArchivedServices && assetManage.data
            ? await readCatalog(
                client,
                action.tenantId,
                RESOURCES.manageService,
                false,
              )
            : [];
        const resolvedAssets = assetManage.data
          ? await readIntunePrimaryPersonNames(
              context.supabaseAdmin,
              action.tenantId,
              assets,
            )
          : assets.map((asset) => ({
              ...asset,
              intune_primary_person_name: null,
            }));
        return json(request, {
          data: {
            services,
            archivedServices,
            canManageServices: assetManage.data,
            assets: resolvedAssets,
            problems,
          },
        });
      }
      if (action.type === "listProblemOwners") {
        return await listProblemOwners(
          request,
          client,
          context.supabaseAdmin,
          action,
        );
      }
      if (action.type === "listProblemTickets") {
        return await listProblemTickets(request, client, action);
      }
      if (action.type === "searchTickets") {
        return await searchTickets(request, client, action);
      }
      if ("operation" in action) {
        return await manageResource(request, client, actorId, action);
      }
      return await mutateTicketLink(request, client, actorId, action);
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
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)
  ) {
    throw new HttpError(413, "request_too_large", "Die Anfrage ist zu groß.");
  }
  if (!request.body) {
    throw new HttpError(
      400,
      "invalid_request",
      "Ein JSON-Objekt ist erforderlich.",
    );
  }
  // Bound the stream before the middleware buffers the body; Content-Length
  // alone is not trustworthy and is absent for chunked requests.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
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
  const body = new Uint8Array(size);
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
    // Origin-less requests are permitted for authenticated non-browser clients;
    // CORS headers are emitted for exactly the application origin, never '*'.
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
      return json(request, {}, 204);
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
      const result = await handler(await boundedRequest(request));
      if (result.headers.has("x-supabase-server-error")) {
        // Normalize middleware failures as well: no configuration diagnostics
        // or raw authentication errors escape the public error envelope.
        if (result.status === 401) {
          return failure(
            request,
            new HttpError(
              401,
              "authentication_required",
              "Eine gültige Benutzeranmeldung ist erforderlich.",
            ),
          );
        }
        if (result.status === 403) {
          return failure(
            request,
            new HttpError(
              403,
              "permission_denied",
              "Für diese Aktion fehlt die Berechtigung.",
            ),
          );
        }
        return failure(
          request,
          new HttpError(
            503,
            "authentication_unavailable",
            "Die Anmeldung konnte derzeit nicht geprüft werden.",
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
              "Die Aktion konnte nicht abgeschlossen werden.",
            ),
      );
    }
  },
};
