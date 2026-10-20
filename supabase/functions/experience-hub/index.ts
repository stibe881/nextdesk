import { type SupabaseContext, withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_FOLLOW_UP_LIMIT = 50;
const MAX_FOLLOW_UP_LIMIT = 100;
const WORKSPACE_FEATURE = "experience.workspace";
const PORTAL_FEATURE = "portal.self-service";

/**
 * Public data contract:
 * - workspace_preferences(tenant_id, user_id, preferences jsonb, updated_at)
 * - experience_follow_ups(id, tenant_id, owner_id, ticket_id, title,
 *   description, due_at, priority, resolved_at, resolved_by, created_at,
 *   updated_at)
 * - ticket_resolution_confirmations(id, tenant_id, ticket_id, confirmed_by,
 *   confirmed, comment, confirmed_at)
 *
 * All reads and writes use the caller-scoped client. A missing or incompatible
 * migration returns experience_hub_not_configured; no service-role fallback is
 * used for tenant-owned Experience data.
 */

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type Row = Record<string, unknown>;
type DatabaseError = { code?: unknown };
type CallerClient = SupabaseContext["supabase"];
type AdminClient = SupabaseContext["supabaseAdmin"];

type WorkspacePreferences = {
  theme?: "system" | "light" | "dark";
  density?: "comfortable" | "compact";
  landingPage?: string;
  showKeyboardShortcuts?: boolean;
};

type Action =
  | { type: "getWorkspacePreferences"; tenantId: string }
  | {
      type: "saveWorkspacePreferences";
      tenantId: string;
      preferences: WorkspacePreferences;
    }
  | {
      type: "listFollowUps";
      tenantId: string;
      includeResolved: boolean;
      limit: number;
      focusFollowUpId?: string;
      ticketId?: string;
    }
  | {
      type: "saveFollowUp";
      tenantId: string;
      followUpId?: string;
      title: string;
      description: string | null;
      dueAt: string | null;
      priority: "low" | "normal" | "high";
      ticketId: string | null;
    }
  | { type: "resolveFollowUp"; tenantId: string; followUpId: string }
  | { type: "listServiceCatalog"; tenantId: string }
  | {
      type: "confirmResolution";
      tenantId: string;
      ticketId: string;
      confirmed: boolean;
      comment: string | null;
    }
  | { type: "listResolutionConfirmations"; tenantId: string; ticketId: string };

type FollowUpRow = {
  id: string;
  tenant_id: string;
  owner_id: string;
  ticket_id: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  priority: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
};

type WorkspacePreferencesRow = {
  tenant_id: string;
  user_id: string;
  preferences: unknown;
  updated_at?: string;
};

type TicketContext = {
  id: string;
  tenant_id: string;
  department_id: string;
  requester_id: string | null;
  affected_user_id: string | null;
  assigned_agent_id: string | null;
  resolved_at: string | null;
};

type ResolutionConfirmationRow = {
  id: string;
  ticket_id: string;
  confirmed: boolean;
  comment: string | null;
  confirmed_by: string;
  confirmed_at: string;
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

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Row, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function validString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !value.includes("\u0000") &&
    value.isWellFormed()
  );
}

function validatedText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null {
  if (!validString(value)) return null;
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  return length >= minimum && length <= maximum ? normalized : null;
}

function nullableText(
  value: unknown,
  maximum: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return validatedText(value, 1, maximum);
}

function isoTimestamp(value: unknown): string | null {
  if (!validString(value) || value.length > 64) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = new Date(parsed).toISOString();
  return normalized === value ? normalized : null;
}

function validatedWorkspacePreferences(
  value: unknown,
): WorkspacePreferences | null {
  if (!isRecord(value)) return null;
  if (
    !hasOnlyKeys(value, [
      "theme",
      "density",
      "landingPage",
      "showKeyboardShortcuts",
    ])
  ) {
    return null;
  }
  if (
    value.theme !== undefined &&
    value.theme !== "system" &&
    value.theme !== "light" &&
    value.theme !== "dark"
  ) {
    return null;
  }
  if (
    value.density !== undefined &&
    value.density !== "comfortable" &&
    value.density !== "compact"
  ) {
    return null;
  }
  if (
    value.landingPage !== undefined &&
    validatedText(value.landingPage, 1, 120) === null
  ) {
    return null;
  }
  if (
    value.showKeyboardShortcuts !== undefined &&
    typeof value.showKeyboardShortcuts !== "boolean"
  ) {
    return null;
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 4096) {
    return null;
  }
  return value as WorkspacePreferences;
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

  if (
    value.type === "getWorkspacePreferences" &&
    hasOnlyKeys(value, ["type", "tenantId"])
  ) {
    return { type: value.type, tenantId };
  }

  if (
    value.type === "saveWorkspacePreferences" &&
    hasOnlyKeys(value, ["type", "tenantId", "preferences"])
  ) {
    const preferences = validatedWorkspacePreferences(value.preferences);
    return preferences ? { type: value.type, tenantId, preferences } : null;
  }

  if (
    value.type === "listFollowUps" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "includeResolved",
      "limit",
      "focusFollowUpId",
      "ticketId",
    ])
  ) {
    if (
      (value.includeResolved !== undefined &&
        typeof value.includeResolved !== "boolean") ||
      (value.limit !== undefined &&
        (!Number.isInteger(value.limit) ||
          typeof value.limit !== "number" ||
          value.limit < 1 ||
          value.limit > MAX_FOLLOW_UP_LIMIT)) ||
      (value.ticketId !== undefined && !isUuid(value.ticketId)) ||
      (value.focusFollowUpId !== undefined && !isUuid(value.focusFollowUpId))
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId,
      includeResolved: value.includeResolved === true,
      limit:
        typeof value.limit === "number" ? value.limit : DEFAULT_FOLLOW_UP_LIMIT,
      ...(typeof value.ticketId === "string"
        ? { ticketId: value.ticketId.toLowerCase() }
        : {}),
      ...(typeof value.focusFollowUpId === "string"
        ? { focusFollowUpId: value.focusFollowUpId.toLowerCase() }
        : {}),
    };
  }

  if (
    value.type === "saveFollowUp" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "followUpId",
      "title",
      "description",
      "dueAt",
      "priority",
      "ticketId",
    ])
  ) {
    const title = validatedText(value.title, 1, 240);
    const description = nullableText(value.description, 5000);
    const dueAt = value.dueAt === null ? null : isoTimestamp(value.dueAt);
    const ticketId = value.ticketId === null ? null : value.ticketId;
    if (
      !title ||
      description === undefined ||
      (value.dueAt !== null && !dueAt) ||
      (ticketId !== null && !isUuid(ticketId)) ||
      (value.followUpId !== undefined && !isUuid(value.followUpId)) ||
      (value.priority !== "low" &&
        value.priority !== "normal" &&
        value.priority !== "high")
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId,
      ...(typeof value.followUpId === "string"
        ? { followUpId: value.followUpId.toLowerCase() }
        : {}),
      title,
      description,
      dueAt,
      priority: value.priority,
      ticketId: ticketId === null ? null : ticketId.toLowerCase(),
    };
  }

  if (
    value.type === "resolveFollowUp" &&
    hasOnlyKeys(value, ["type", "tenantId", "followUpId"]) &&
    isUuid(value.followUpId)
  ) {
    return {
      type: value.type,
      tenantId,
      followUpId: value.followUpId.toLowerCase(),
    };
  }

  if (
    value.type === "listServiceCatalog" &&
    hasOnlyKeys(value, ["type", "tenantId"])
  ) {
    return { type: value.type, tenantId };
  }

  if (
    value.type === "confirmResolution" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "ticketId",
      "confirmed",
      "comment",
    ]) &&
    isUuid(value.ticketId) &&
    typeof value.confirmed === "boolean"
  ) {
    const comment = nullableText(value.comment, 3000);
    if (comment === undefined) return null;
    return {
      type: value.type,
      tenantId,
      ticketId: value.ticketId.toLowerCase(),
      confirmed: value.confirmed,
      comment,
    };
  }

  if (
    value.type === "listResolutionConfirmations" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId"]) &&
    isUuid(value.ticketId)
  ) {
    return {
      type: value.type,
      tenantId,
      ticketId: value.ticketId.toLowerCase(),
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
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
  }
  return headers;
}

function json(request: Request, body: Row, status = 200): Response {
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
  const code = typeof error.code === "string" ? error.code : "";
  if (
    code === "42P01" ||
    code === "42703" ||
    code === "42883" ||
    code === "PGRST202" ||
    code === "PGRST204" ||
    code === "PGRST205"
  ) {
    throw new HttpError(
      503,
      "experience_hub_not_configured",
      "Die Experience-Hub-Konfiguration ist für diesen Mandanten noch nicht bereitgestellt.",
    );
  }
  if (code === "23505") {
    throw new HttpError(409, "conflict", "Der Eintrag besteht bereits.");
  }
  if (
    code === "23503" ||
    code === "23514" ||
    code === "22001" ||
    code === "22023"
  ) {
    throw new HttpError(
      422,
      "invalid_data",
      "Die Angaben sind nicht zulässig.",
    );
  }
  if (code === "42501") {
    throw new HttpError(
      403,
      "permission_denied",
      "Für diese Aktion fehlt die Berechtigung.",
    );
  }
  throw new HttpError(
    500,
    "operation_failed",
    "Die Aktion konnte nicht abgeschlossen werden.",
  );
}

async function requireActiveTenantMembership(
  client: CallerClient,
  tenantId: string,
): Promise<void> {
  const { data, error } = await client.rpc("is_active_tenant_member", {
    p_tenant_id: tenantId,
  });
  if (error || typeof data !== "boolean") {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Mandantenmitgliedschaft konnte nicht geprüft werden.",
    );
  }
  if (!data) {
    throw new HttpError(
      403,
      "tenant_membership_required",
      "Für diese Aktion ist eine aktive Mandantenmitgliedschaft erforderlich.",
    );
  }
}

export async function requireTicketWorkspaceAccess(
  client: CallerClient,
  tenantId: string,
): Promise<void> {
  const { data, error } = await client.rpc("can_work_tickets_in_tenant", {
    p_tenant_id: tenantId,
  });
  if (error || typeof data !== "boolean") {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Arbeitsberechtigung konnte nicht geprüft werden.",
    );
  }
  if (!data) {
    throw new HttpError(
      403,
      "ticket_workspace_access_required",
      "Wiedervorlagen stehen nur berechtigten Agent:innen zur Verfügung.",
    );
  }
}

async function requireFeature(
  admin: AdminClient,
  tenantId: string,
  featureKey: string,
): Promise<void> {
  const states = await resolveTenantFeatureStates(admin, tenantId, [
    featureKey,
  ]);
  if (!states) {
    throw new HttpError(
      503,
      "tenant_feature_lookup_failed",
      "Die Funktionsberechtigung konnte nicht geprüft werden.",
    );
  }
  if (states[featureKey] !== true) {
    throw new HttpError(
      403,
      "experience_feature_disabled",
      "Diese Experience-Hub-Funktion ist für den Mandanten deaktiviert.",
    );
  }
}

function publicPreferences(row: WorkspacePreferencesRow | null) {
  if (!row) return null;
  const preferences = validatedWorkspacePreferences(row.preferences);
  if (!preferences) {
    throw new HttpError(
      500,
      "invalid_stored_data",
      "Gespeicherte Einstellungen konnten nicht sicher gelesen werden.",
    );
  }
  return {
    preferences,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

async function getWorkspacePreferences(
  request: Request,
  client: CallerClient,
  tenantId: string,
  actorId: string,
): Promise<Response> {
  const { data, error } = await client
    .from("workspace_preferences")
    .select("tenant_id, user_id, preferences, updated_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .maybeSingle();
  if (error) databaseFailure(error);
  return json(request, {
    data: { workspacePreferences: publicPreferences(data) },
  });
}

async function saveWorkspacePreferences(
  request: Request,
  client: CallerClient,
  action: Extract<Action, { type: "saveWorkspacePreferences" }>,
  actorId: string,
): Promise<Response> {
  const { data, error } = await client
    .from("workspace_preferences")
    .upsert(
      {
        tenant_id: action.tenantId,
        user_id: actorId,
        preferences: action.preferences,
      },
      { onConflict: "tenant_id,user_id" },
    )
    .select("tenant_id, user_id, preferences, updated_at")
    .single();
  if (error) databaseFailure(error);
  return json(request, {
    data: { workspacePreferences: publicPreferences(data) },
  });
}

function publicFollowUp(row: unknown) {
  if (!isRecord(row) || !isUuid(row.id) || !isUuid(row.tenant_id)) {
    throw new HttpError(
      500,
      "invalid_stored_data",
      "Follow-ups konnten nicht sicher gelesen werden.",
    );
  }
  if (
    !validString(row.title) ||
    (row.description !== null && !validString(row.description)) ||
    (row.due_at !== null && !validString(row.due_at)) ||
    (row.resolved_at !== null && !validString(row.resolved_at)) ||
    !validString(row.created_at) ||
    !validString(row.updated_at) ||
    (row.ticket_id !== null && !isUuid(row.ticket_id)) ||
    (row.priority !== "low" &&
      row.priority !== "normal" &&
      row.priority !== "high")
  ) {
    throw new HttpError(
      500,
      "invalid_stored_data",
      "Follow-ups konnten nicht sicher gelesen werden.",
    );
  }
  return {
    id: row.id.toLowerCase(),
    ticketId: row.ticket_id === null ? null : row.ticket_id.toLowerCase(),
    title: row.title,
    description: row.description,
    dueAt: row.due_at,
    priority: row.priority,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const FOLLOW_UP_SELECT =
  "id, tenant_id, owner_id, ticket_id, title, description, due_at, priority, resolved_at, resolved_by, created_at, updated_at";

async function requireReadableTicket(
  client: CallerClient,
  tenantId: string,
  ticketId: string,
): Promise<void> {
  const { data, error } = await client
    .from("tickets")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data) {
    throw new HttpError(
      404,
      "ticket_not_available",
      "Das Ticket ist nicht verfügbar.",
    );
  }
}

async function listFollowUps(
  request: Request,
  client: CallerClient,
  action: Extract<Action, { type: "listFollowUps" }>,
  actorId: string,
): Promise<Response> {
  if (action.ticketId) {
    await requireReadableTicket(client, action.tenantId, action.ticketId);
  }
  let query = client
    .from("experience_follow_ups")
    .select(FOLLOW_UP_SELECT)
    .eq("tenant_id", action.tenantId)
    .eq("owner_id", actorId)
    .order("resolved_at", { ascending: true, nullsFirst: true })
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(action.limit + 1);
  if (!action.includeResolved) query = query.is("resolved_at", null);
  if (action.ticketId) query = query.eq("ticket_id", action.ticketId);
  const { data, error } = await query;
  if (error) databaseFailure(error);
  const rows = data ?? [];
  if (
    action.focusFollowUpId &&
    !rows.some((row: FollowUpRow) => row.id === action.focusFollowUpId)
  ) {
    const { data: focusedData, error: focusedError } = await client
      .from("experience_follow_ups")
      .select(FOLLOW_UP_SELECT)
      .eq("tenant_id", action.tenantId)
      .eq("id", action.focusFollowUpId)
      .eq("owner_id", actorId)
      .maybeSingle();
    if (focusedError) databaseFailure(focusedError);
    if (focusedData) rows.push(focusedData as FollowUpRow);
  }
  return json(request, {
    data: {
      followUps: rows.slice(0, action.limit).map(publicFollowUp),
      truncated: rows.length > action.limit,
    },
  });
}

async function saveFollowUp(
  request: Request,
  client: CallerClient,
  action: Extract<Action, { type: "saveFollowUp" }>,
  actorId: string,
): Promise<Response> {
  if (action.ticketId) {
    await requireReadableTicket(client, action.tenantId, action.ticketId);
  }

  if (action.followUpId) {
    const { data: existingData, error: existingError } = await client
      .from("experience_follow_ups")
      .select(FOLLOW_UP_SELECT)
      .eq("tenant_id", action.tenantId)
      .eq("id", action.followUpId)
      .eq("owner_id", actorId)
      .maybeSingle();
    if (existingError) databaseFailure(existingError);
    const existing = existingData as FollowUpRow | null;
    if (!existing) {
      throw new HttpError(
        404,
        "follow_up_not_found",
        "Das Follow-up ist nicht verfügbar.",
      );
    }
    if (existing.resolved_at !== null) {
      throw new HttpError(
        409,
        "follow_up_already_resolved",
        "Ein erledigtes Follow-up kann nicht geändert werden.",
      );
    }

    const { data, error } = await client
      .from("experience_follow_ups")
      .update({
        ticket_id: action.ticketId,
        title: action.title,
        description: action.description,
        due_at: action.dueAt,
        priority: action.priority,
      })
      .eq("tenant_id", action.tenantId)
      .eq("id", action.followUpId)
      .eq("owner_id", actorId)
      .is("resolved_at", null)
      .select(FOLLOW_UP_SELECT)
      .maybeSingle();
    if (error) databaseFailure(error);
    if (!data) {
      throw new HttpError(
        409,
        "follow_up_changed_concurrently",
        "Das Follow-up wurde zwischenzeitlich geändert.",
      );
    }
    return json(request, { data: { followUp: publicFollowUp(data) } });
  }

  const { data, error } = await client
    .from("experience_follow_ups")
    .insert({
      tenant_id: action.tenantId,
      owner_id: actorId,
      ticket_id: action.ticketId,
      title: action.title,
      description: action.description,
      due_at: action.dueAt,
      priority: action.priority,
    })
    .select(FOLLOW_UP_SELECT)
    .single();
  if (error) databaseFailure(error);
  return json(request, { data: { followUp: publicFollowUp(data) } }, 201);
}

async function resolveFollowUp(
  request: Request,
  client: CallerClient,
  action: Extract<Action, { type: "resolveFollowUp" }>,
  actorId: string,
): Promise<Response> {
  const { data: existingData, error: existingError } = await client
    .from("experience_follow_ups")
    .select(FOLLOW_UP_SELECT)
    .eq("tenant_id", action.tenantId)
    .eq("id", action.followUpId)
    .eq("owner_id", actorId)
    .maybeSingle();
  if (existingError) databaseFailure(existingError);
  const existing = existingData as FollowUpRow | null;
  if (!existing) {
    throw new HttpError(
      404,
      "follow_up_not_found",
      "Das Follow-up ist nicht verfügbar.",
    );
  }
  if (existing.resolved_at !== null) {
    return json(request, {
      data: { followUp: publicFollowUp(existing), changed: false },
    });
  }

  const resolvedAt = new Date().toISOString();
  const { data, error } = await client
    .from("experience_follow_ups")
    .update({ resolved_at: resolvedAt, resolved_by: actorId })
    .eq("tenant_id", action.tenantId)
    .eq("id", action.followUpId)
    .eq("owner_id", actorId)
    .is("resolved_at", null)
    .select(FOLLOW_UP_SELECT)
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data) {
    throw new HttpError(
      409,
      "follow_up_changed_concurrently",
      "Das Follow-up wurde zwischenzeitlich geändert.",
    );
  }
  return json(request, {
    data: { followUp: publicFollowUp(data), changed: true },
  });
}

async function listServiceCatalog(
  request: Request,
  client: CallerClient,
  tenantId: string,
): Promise<Response> {
  const { data, error } = await client
    .from("services")
    .select("id, name, description, criticality")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("name", { ascending: true })
    .limit(500);
  if (error) databaseFailure(error);
  const services = (data ?? []).map((service: Row) => {
    if (
      !isUuid(service.id) ||
      !validString(service.name) ||
      (service.description !== null && !validString(service.description)) ||
      (service.criticality !== "low" &&
        service.criticality !== "medium" &&
        service.criticality !== "high" &&
        service.criticality !== "critical")
    ) {
      throw new HttpError(
        500,
        "invalid_stored_data",
        "Der Servicekatalog konnte nicht sicher gelesen werden.",
      );
    }
    return {
      id: service.id.toLowerCase(),
      name: service.name,
      description: service.description,
      criticality: service.criticality,
    };
  });
  return json(request, { data: { services } });
}

async function loadReadableTicket(
  client: CallerClient,
  tenantId: string,
  ticketId: string,
): Promise<TicketContext> {
  const { data, error } = await client
    .from("tickets")
    .select(
      "id, tenant_id, department_id, requester_id, affected_user_id, assigned_agent_id, resolved_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data) {
    throw new HttpError(
      404,
      "ticket_not_available",
      "Das Ticket ist nicht verfügbar.",
    );
  }
  const ticket = data as TicketContext;
  if (
    !isUuid(ticket.id) ||
    !isUuid(ticket.tenant_id) ||
    !isUuid(ticket.department_id) ||
    (ticket.requester_id !== null && !isUuid(ticket.requester_id)) ||
    (ticket.affected_user_id !== null && !isUuid(ticket.affected_user_id)) ||
    (ticket.assigned_agent_id !== null && !isUuid(ticket.assigned_agent_id)) ||
    (ticket.resolved_at !== null && !validString(ticket.resolved_at))
  ) {
    throw new HttpError(
      500,
      "invalid_stored_data",
      "Das Ticket konnte nicht sicher gelesen werden.",
    );
  }
  return ticket;
}

async function hasTicketPermission(
  client: CallerClient,
  tenantId: string,
  departmentId: string,
  permissionCode: "ticket.read.assigned" | "ticket.read.department",
): Promise<boolean> {
  const { data, error } = await client.rpc("has_ticket_permission", {
    p_tenant_id: tenantId,
    p_department_id: departmentId,
    p_permission_code: permissionCode,
  });
  if (error || typeof data !== "boolean") {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Ticketberechtigung konnte nicht geprüft werden.",
    );
  }
  return data;
}

async function requireResolutionConfirmationListAccess(
  client: CallerClient,
  ticket: TicketContext,
  actorId: string,
): Promise<void> {
  if (ticket.requester_id === actorId || ticket.affected_user_id === actorId) {
    return;
  }
  const hasDepartmentRead = await hasTicketPermission(
    client,
    ticket.tenant_id,
    ticket.department_id,
    "ticket.read.department",
  );
  const hasAssignedRead =
    ticket.assigned_agent_id === actorId &&
    (await hasTicketPermission(
      client,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.read.assigned",
    ));
  if (!hasDepartmentRead && !hasAssignedRead) {
    throw new HttpError(
      403,
      "resolution_confirmation_not_allowed",
      "Für Lösungsbestätigungen dieses Tickets fehlt die Berechtigung.",
    );
  }
}

function publicConfirmation(
  row: unknown,
  displayNames: ReadonlyMap<string, string | null>,
) {
  if (
    !isRecord(row) ||
    !isUuid(row.id) ||
    !isUuid(row.ticket_id) ||
    !isUuid(row.confirmed_by)
  ) {
    throw new HttpError(
      500,
      "invalid_stored_data",
      "Lösungsbestätigungen konnten nicht sicher gelesen werden.",
    );
  }
  if (
    typeof row.confirmed !== "boolean" ||
    (row.comment !== null && !validString(row.comment)) ||
    !validString(row.confirmed_at)
  ) {
    throw new HttpError(
      500,
      "invalid_stored_data",
      "Lösungsbestätigungen konnten nicht sicher gelesen werden.",
    );
  }
  return {
    id: row.id.toLowerCase(),
    ticketId: row.ticket_id.toLowerCase(),
    confirmed: row.confirmed,
    comment: row.comment,
    confirmedAt: row.confirmed_at,
    confirmedByDisplayName:
      displayNames.get(row.confirmed_by.toLowerCase()) ?? null,
  };
}

async function listResolutionConfirmations(
  request: Request,
  client: CallerClient,
  admin: AdminClient,
  action: Extract<Action, { type: "listResolutionConfirmations" }>,
  actorId: string,
): Promise<Response> {
  const ticket = await loadReadableTicket(
    client,
    action.tenantId,
    action.ticketId,
  );
  await requireResolutionConfirmationListAccess(client, ticket, actorId);
  const { data, error } = await client
    .from("ticket_resolution_confirmations")
    .select("id, ticket_id, confirmed, comment, confirmed_by, confirmed_at")
    .eq("tenant_id", action.tenantId)
    .eq("ticket_id", ticket.id)
    .order("confirmed_at", { ascending: false })
    .limit(100);
  if (error) databaseFailure(error);
  const rows = (data ?? []) as ResolutionConfirmationRow[];
  const actorIds = [
    ...new Set(rows.map((row) => row.confirmed_by).filter(isUuid)),
  ];
  const displayNames = new Map<string, string | null>();
  if (actorIds.length > 0) {
    const { data: profiles, error: profileError } = await admin
      .from("user_profiles")
      .select("id, display_name")
      .in("id", actorIds);
    if (profileError) {
      throw new HttpError(
        503,
        "experience_hub_not_configured",
        "Die Experience-Hub-Konfiguration ist für diesen Mandanten noch nicht bereitgestellt.",
      );
    }
    for (const profile of profiles ?? []) {
      if (!isRecord(profile) || !isUuid(profile.id)) continue;
      displayNames.set(
        profile.id.toLowerCase(),
        typeof profile.display_name === "string" ? profile.display_name : null,
      );
    }
  }
  return json(request, {
    data: {
      confirmations: rows.map((row) => publicConfirmation(row, displayNames)),
    },
  });
}

async function confirmResolution(
  request: Request,
  client: CallerClient,
  action: Extract<Action, { type: "confirmResolution" }>,
  actorId: string,
): Promise<Response> {
  // This action has no tickets UPDATE. It records a response only and can never
  // resolve, close, reopen, reassign or otherwise alter a ticket.
  const ticket = await loadReadableTicket(
    client,
    action.tenantId,
    action.ticketId,
  );
  if (ticket.requester_id !== actorId && ticket.affected_user_id !== actorId) {
    throw new HttpError(
      403,
      "resolution_confirmation_not_allowed",
      "Nur die anfragende oder betroffene Person kann die Lösung bestätigen.",
    );
  }
  if (
    typeof ticket.resolved_at !== "string" ||
    !Number.isFinite(Date.parse(ticket.resolved_at))
  ) {
    throw new HttpError(
      422,
      "ticket_not_resolved",
      "Eine Lösung kann erst nach der Ticketlösung bestätigt werden.",
    );
  }

  const { data, error } = await client
    .from("ticket_resolution_confirmations")
    .insert({
      tenant_id: action.tenantId,
      ticket_id: ticket.id,
      confirmed_by: actorId,
      confirmed: action.confirmed,
      comment: action.comment,
    })
    .select("id, ticket_id, confirmed, confirmed_at")
    .single();
  if (error) databaseFailure(error);
  if (!isRecord(data) || !isUuid(data.id) || !isUuid(data.ticket_id)) {
    throw new HttpError(
      500,
      "operation_failed",
      "Die Lösungsbestätigung konnte nicht sicher gespeichert werden.",
    );
  }
  return json(
    request,
    {
      data: {
        confirmation: {
          id: data.id.toLowerCase(),
          ticketId: data.ticket_id.toLowerCase(),
          confirmed: data.confirmed,
          confirmedAt: data.confirmed_at,
        },
      },
    },
    201,
  );
}

function featureForAction(action: Action): string {
  return action.type === "listServiceCatalog" ||
    action.type === "confirmResolution" ||
    action.type === "listResolutionConfirmations"
    ? PORTAL_FEATURE
    : WORKSPACE_FEATURE;
}

const handler = withSupabase(
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
      await requireActiveTenantMembership(client, action.tenantId);
      await requireFeature(
        context.supabaseAdmin,
        action.tenantId,
        featureForAction(action),
      );
      if (
        action.type === "listFollowUps" ||
        action.type === "saveFollowUp" ||
        action.type === "resolveFollowUp"
      ) {
        await requireTicketWorkspaceAccess(client, action.tenantId);
      }

      if (action.type === "getWorkspacePreferences") {
        return await getWorkspacePreferences(
          request,
          client,
          action.tenantId,
          actorId,
        );
      }
      if (action.type === "saveWorkspacePreferences") {
        return await saveWorkspacePreferences(request, client, action, actorId);
      }
      if (action.type === "listFollowUps") {
        return await listFollowUps(request, client, action, actorId);
      }
      if (action.type === "saveFollowUp") {
        return await saveFollowUp(request, client, action, actorId);
      }
      if (action.type === "resolveFollowUp") {
        return await resolveFollowUp(request, client, action, actorId);
      }
      if (action.type === "listServiceCatalog") {
        return await listServiceCatalog(request, client, action.tenantId);
      }
      if (action.type === "listResolutionConfirmations") {
        return await listResolutionConfirmations(
          request,
          client,
          context.supabaseAdmin,
          action,
          actorId,
        );
      }
      return await confirmResolution(request, client, action, actorId);
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
    throw new HttpError(413, "request_too_large", "Die Anfrage ist zu gross.");
  }
  if (!request.body) {
    throw new HttpError(
      400,
      "invalid_request",
      "Ein JSON-Objekt ist erforderlich.",
    );
  }
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
          "Die Anfrage ist zu gross.",
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
        ?.split(";", 1)[0]
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
        if (result.status === 401) {
          throw new HttpError(
            401,
            "authentication_required",
            "Eine gültige Benutzeranmeldung ist erforderlich.",
          );
        }
        if (result.status === 403) {
          throw new HttpError(
            403,
            "permission_denied",
            "Für diese Aktion fehlt die Berechtigung.",
          );
        }
        throw new HttpError(
          503,
          "authentication_unavailable",
          "Die Anmeldung konnte derzeit nicht geprüft werden.",
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
