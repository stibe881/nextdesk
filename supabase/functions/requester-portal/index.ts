import { type SupabaseContext, withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const FEATURE = "requester.portal";
const DEPARTMENT_VIEW_FEATURE = "requester.department-view";
const MAX_BYTES = 64 * 1024;
const ACTIONS = [
  "activeIncidentNotices",
  "myTicketTimeline",
  "slaExpectation",
  "myDevices",
  "myApprovals",
  "requestReopen",
  "exportMyData",
  "listTicketWatchers",
  "addTicketWatcher",
  "removeTicketWatcher",
  "getMyAvailability",
  "setMyAvailability",
  "departmentTickets",
  "searchColleagues",
] as const;
type ActionName = (typeof ACTIONS)[number];
type Row = Record<string, unknown>;
type Action = { type: ActionName; tenantId: string } & Row;
type Client = SupabaseContext["supabase"];
type Admin = SupabaseContext["supabaseAdmin"];
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const isRecord = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const clean = (value: unknown, min: number, max: number): string | null => {
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    !value.isWellFormed()
  )
    return null;
  const result = value.trim();
  return Array.from(result).length >= min && Array.from(result).length <= max
    ? result
    : null;
};
function action(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    !isUuid(value.tenantId) ||
    typeof value.type !== "string" ||
    !(ACTIONS as readonly string[]).includes(value.type)
  )
    return null;
  return {
    ...value,
    type: value.type as ActionName,
    tenantId: value.tenantId.toLowerCase(),
  };
}
function cors(request: Request): Headers {
  const result = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    result.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    result.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    result.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
  }
  return result;
}
function reply(request: Request, body: Row, status = 200): Response {
  const result = new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: cors(request),
  });
  if (status === 405) result.headers.set("Allow", "POST, OPTIONS");
  return result;
}
function failure(request: Request, error: HttpError): Response {
  return reply(
    request,
    { error: { code: error.code, message: error.message } },
    error.status,
  );
}
function db(error: { code?: unknown } | null): never {
  const code = typeof error?.code === "string" ? error.code : "";
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code))
    throw new HttpError(
      503,
      "requester_portal_not_configured",
      "Das Anfragendenportal ist noch nicht bereitgestellt.",
    );
  if (code === "23505")
    throw new HttpError(409, "conflict", "Der Eintrag besteht bereits.");
  if (["23503", "23514", "22001", "22023"].includes(code))
    throw new HttpError(
      422,
      "invalid_data",
      "Die Angaben sind nicht zulässig.",
    );
  if (code === "42501")
    throw new HttpError(
      403,
      "permission_denied",
      "Für diese Aktion fehlt die Berechtigung.",
    );
  throw new HttpError(
    500,
    "operation_failed",
    "Die Aktion konnte nicht abgeschlossen werden.",
  );
}
async function base(
  client: Client,
  admin: Admin,
  tenantId: string,
): Promise<void> {
  const member = await client.rpc("is_active_tenant_member", {
    p_tenant_id: tenantId,
  });
  if (member.error || typeof member.data !== "boolean")
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Mandantenmitgliedschaft konnte nicht geprüft werden.",
    );
  if (!member.data)
    throw new HttpError(
      403,
      "tenant_membership_required",
      "Eine aktive Mandantenmitgliedschaft ist erforderlich.",
    );
  const flags = await resolveTenantFeatureStates(admin, tenantId, [FEATURE]);
  if (!flags)
    throw new HttpError(
      503,
      "tenant_feature_lookup_failed",
      "Die Funktionsfreigabe konnte nicht geprüft werden.",
    );
  if (flags[FEATURE] !== true)
    throw new HttpError(
      403,
      "requester_portal_feature_disabled",
      "Das Anfragendenportal ist für diesen Mandanten deaktiviert.",
    );
}
async function requireDepartmentView(
  admin: Admin,
  tenantId: string,
): Promise<void> {
  const flags = await resolveTenantFeatureStates(admin, tenantId, [
    DEPARTMENT_VIEW_FEATURE,
  ]);
  if (!flags)
    throw new HttpError(
      503,
      "tenant_feature_lookup_failed",
      "Die Funktionsfreigabe konnte nicht geprüft werden.",
    );
  if (flags[DEPARTMENT_VIEW_FEATURE] !== true)
    throw new HttpError(
      403,
      "requester_department_view_feature_disabled",
      "Die Abteilungsansicht ist für diesen Mandanten deaktiviert.",
    );
}
async function ownTicket(
  admin: Admin,
  tenantId: string,
  ticketId: unknown,
  actorId: string,
): Promise<Row> {
  if (!isUuid(ticketId))
    throw new HttpError(
      400,
      "invalid_request",
      "Eine gültige Ticket-ID ist erforderlich.",
    );
  const result = await admin
    .from("tickets")
    .select(
      "id, tenant_id, requester_id, affected_user_id, priority_id, category_id, response_due_at, resolution_due_at, resolved_at, closed_at, subject, ticket_number, created_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", ticketId)
    .maybeSingle();
  if (result.error) db(result.error);
  if (
    !result.data ||
    (result.data.requester_id !== actorId &&
      result.data.affected_user_id !== actorId)
  )
    throw new HttpError(
      404,
      "ticket_not_available",
      "Das Ticket ist nicht verfügbar.",
    );
  return result.data as Row;
}
async function activeMember(
  admin: Admin,
  tenantId: string,
  userId: unknown,
): Promise<string> {
  if (!isUuid(userId))
    throw new HttpError(
      400,
      "invalid_request",
      "Eine gültige Personen-ID ist erforderlich.",
    );
  const result = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (result.error) db(result.error);
  if (!result.data)
    throw new HttpError(
      422,
      "inactive_tenant_member",
      "Die Person ist kein aktives Mandantenmitglied.",
    );
  return userId.toLowerCase();
}
async function audit(
  admin: Admin,
  tenantId: string,
  actorId: string,
  actionName: string,
  entityType: string,
  entityId: string,
  metadata: Row = {},
): Promise<void> {
  const result = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: actionName,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });
  if (result.error) db(result.error);
}
function availabilityFromPreferences(preferences: unknown): string | null {
  if (!isRecord(preferences))
    throw new HttpError(
      500,
      "invalid_stored_data",
      "Die Erreichbarkeit konnte nicht sicher gelesen werden.",
    );
  if (preferences.availability === undefined) return null;
  const availability = clean(preferences.availability, 1, 300);
  if (!availability)
    throw new HttpError(
      500,
      "invalid_stored_data",
      "Die Erreichbarkeit konnte nicht sicher gelesen werden.",
    );
  return availability;
}
async function activeWatcherRows(
  admin: Admin,
  tenantId: string,
  ticketId: string,
): Promise<Row[]> {
  const watchers = await admin
    .from("ticket_watchers")
    .select("user_id, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at")
    .limit(200);
  if (watchers.error) db(watchers.error);
  const watcherIds = [
    ...new Set(
      (watchers.data ?? []).map((entry) => entry.user_id).filter(isUuid),
    ),
  ];
  if (watcherIds.length === 0) return [];
  const memberships = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("user_id", watcherIds);
  if (memberships.error) db(memberships.error);
  const activeIds = new Set(
    (memberships.data ?? []).map((entry) => entry.user_id).filter(isUuid),
  );
  const profiles = await admin
    .from("user_profiles")
    .select("id, display_name")
    .in("id", [...activeIds]);
  if (profiles.error) db(profiles.error);
  const displayNames = new Map(
    (profiles.data ?? [])
      .filter((entry) => isUuid(entry.id))
      .map((entry) => [
        entry.id.toLowerCase(),
        typeof entry.display_name === "string" ? entry.display_name : null,
      ]),
  );
  return (watchers.data ?? [])
    .filter((entry) => isUuid(entry.user_id) && activeIds.has(entry.user_id))
    .map((entry) => ({
      userId: entry.user_id.toLowerCase(),
      displayName: displayNames.get(entry.user_id.toLowerCase()) ?? null,
      createdAt: typeof entry.created_at === "string" ? entry.created_at : null,
    }));
}
// Returns only display names of active people in the same tenant. No e-mail
// addresses, roles or departments are exposed. Used to choose people in copy.
async function searchColleagues(
  request: Request,
  admin: Admin,
  item: Action,
  actorId: string,
): Promise<Response> {
  const query = clean(item.query, 2, 80);
  if (!query)
    throw new HttpError(
      400,
      "invalid_request",
      "Bitte geben Sie mindestens zwei gültige Zeichen ein.",
    );
  const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const memberships = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", item.tenantId)
    .eq("status", "active")
    .limit(5000);
  if (memberships.error) db(memberships.error);
  const memberIds = [
    ...new Set(
      (memberships.data ?? [])
        .map((entry) => entry.user_id)
        .filter(isUuid)
        .map((id) => id.toLowerCase())
        .filter((id) => id !== actorId.toLowerCase()),
    ),
  ];
  const people = new Map<string, string>();
  for (
    let index = 0;
    index < memberIds.length && people.size < 20;
    index += 150
  ) {
    const profiles = await admin
      .from("user_profiles")
      .select("id, display_name")
      .in("id", memberIds.slice(index, index + 150))
      .ilike("display_name", pattern)
      .limit(20);
    if (profiles.error) db(profiles.error);
    for (const profile of profiles.data ?? []) {
      const name =
        typeof profile.display_name === "string"
          ? profile.display_name.trim()
          : "";
      if (
        isUuid(profile.id) &&
        Array.from(name).length >= 2 &&
        Array.from(name).length <= 160 &&
        !name.includes("@")
      )
        people.set(profile.id.toLowerCase(), name);
    }
  }
  const result = [...people.entries()]
    .map(([userId, displayName]) => ({ userId, displayName }))
    .sort((left, right) =>
      left.displayName.localeCompare(right.displayName, "de-CH", {
        sensitivity: "base",
      }),
    )
    .slice(0, 20);
  return reply(request, { data: { people: result } });
}
async function listTicketWatchers(
  request: Request,
  admin: Admin,
  item: Action,
  actorId: string,
): Promise<Response> {
  const current = await ownTicket(admin, item.tenantId, item.ticketId, actorId);
  const watchers = await activeWatcherRows(
    admin,
    item.tenantId,
    current.id as string,
  );
  return reply(request, { data: { watchers } });
}
async function addTicketWatcher(
  request: Request,
  admin: Admin,
  item: Action,
  actorId: string,
): Promise<Response> {
  const current = await ownTicket(admin, item.tenantId, item.ticketId, actorId);
  const watcherId = await activeMember(admin, item.tenantId, item.watcherId);
  const result = await admin
    .from("ticket_watchers")
    .insert({ ticket_id: current.id, user_id: watcherId })
    .select("user_id, created_at")
    .single();
  if (result.error) db(result.error);
  await audit(
    admin,
    item.tenantId,
    actorId,
    "ticket.watcher.added",
    "ticket",
    current.id as string,
    { watcherId },
  );
  return reply(
    request,
    {
      data: {
        watcher: {
          userId: result.data.user_id,
          createdAt: result.data.created_at,
        },
      },
    },
    201,
  );
}
async function removeTicketWatcher(
  request: Request,
  admin: Admin,
  item: Action,
  actorId: string,
): Promise<Response> {
  const current = await ownTicket(admin, item.tenantId, item.ticketId, actorId);
  if (!isUuid(item.watcherId))
    throw new HttpError(
      400,
      "invalid_request",
      "Eine gültige Personen-ID ist erforderlich.",
    );
  const watcherId = item.watcherId.toLowerCase();
  const result = await admin
    .from("ticket_watchers")
    .delete()
    .eq("ticket_id", current.id as string)
    .eq("user_id", watcherId)
    .select("user_id")
    .maybeSingle();
  if (result.error) db(result.error);
  if (!result.data)
    throw new HttpError(
      404,
      "watcher_not_found",
      "Die beobachtende Person ist für dieses Ticket nicht hinterlegt.",
    );
  await audit(
    admin,
    item.tenantId,
    actorId,
    "ticket.watcher.removed",
    "ticket",
    current.id as string,
    { watcherId },
  );
  return reply(request, { data: { removedWatcherId: watcherId } });
}
async function getMyAvailability(
  request: Request,
  admin: Admin,
  item: Action,
  actorId: string,
): Promise<Response> {
  const result = await admin
    .from("workspace_preferences")
    .select("preferences")
    .eq("tenant_id", item.tenantId)
    .eq("user_id", actorId)
    .maybeSingle();
  if (result.error) db(result.error);
  return reply(request, {
    data: {
      availability: result.data
        ? availabilityFromPreferences(result.data.preferences)
        : null,
    },
  });
}
async function setMyAvailability(
  request: Request,
  admin: Admin,
  item: Action,
  actorId: string,
): Promise<Response> {
  const availability =
    item.availability === null ? null : clean(item.availability, 1, 300);
  if (availability === null && item.availability !== null)
    throw new HttpError(
      400,
      "invalid_request",
      "Die Erreichbarkeit ist ungültig.",
    );
  const current = await admin
    .from("workspace_preferences")
    .select("preferences")
    .eq("tenant_id", item.tenantId)
    .eq("user_id", actorId)
    .maybeSingle();
  if (current.error) db(current.error);
  const preferences = current.data?.preferences ?? {};
  if (!isRecord(preferences))
    throw new HttpError(
      500,
      "invalid_stored_data",
      "Die bestehenden Einstellungen konnten nicht sicher gelesen werden.",
    );
  const merged = { ...preferences };
  if (availability === null) delete merged.availability;
  else merged.availability = availability;
  if (new TextEncoder().encode(JSON.stringify(merged)).byteLength > 4096)
    throw new HttpError(
      422,
      "invalid_data",
      "Die Einstellungen sind zu umfangreich.",
    );
  const result = await admin
    .from("workspace_preferences")
    .upsert(
      {
        tenant_id: item.tenantId,
        user_id: actorId,
        preferences: merged,
      },
      { onConflict: "tenant_id,user_id" },
    )
    .select("preferences")
    .single();
  if (result.error) db(result.error);
  return reply(request, {
    data: {
      availability: availabilityFromPreferences(result.data.preferences),
    },
  });
}
async function departmentTickets(
  request: Request,
  admin: Admin,
  item: Action,
  actorId: string,
): Promise<Response> {
  await requireDepartmentView(admin, item.tenantId);
  const directory = await admin
    .from("tenant_member_directory")
    .select("department_id")
    .eq("tenant_id", item.tenantId)
    .eq("user_id", actorId)
    .maybeSingle();
  if (directory.error) db(directory.error);
  if (!directory.data || !isUuid(directory.data.department_id))
    return reply(request, { data: { tickets: [] } });
  const result = await admin
    .from("tickets")
    .select(
      "ticket_number, subject, created_at, updated_at, ticket_statuses!inner(label)",
    )
    .eq("tenant_id", item.tenantId)
    .eq("department_id", directory.data.department_id)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (result.error) db(result.error);
  const tickets = (result.data ?? []).map((entry) => {
    const row = entry as Row;
    const status = row.ticket_statuses;
    if (
      typeof row.ticket_number !== "string" ||
      typeof row.subject !== "string" ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      !isRecord(status) ||
      typeof status.label !== "string"
    )
      throw new HttpError(
        500,
        "invalid_stored_data",
        "Die Abteilungstickets konnten nicht sicher gelesen werden.",
      );
    return {
      ticketNumber: row.ticket_number,
      title: row.subject,
      statusLabel: status.label,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
  return reply(request, { data: { tickets } });
}
async function activeIncidentNotices(
  request: Request,
  admin: Admin,
  item: Action,
): Promise<Response> {
  const result = await admin
    .from("service_incident_notices")
    .select(
      "id, title, description, status, category_id, department_id, starts_at, resolved_at, updated_at",
    )
    .eq("tenant_id", item.tenantId)
    .neq("status", "resolved")
    .order("starts_at", { ascending: false })
    .limit(100);
  if (result.error) db(result.error);
  return reply(request, { data: { notices: result.data ?? [] } });
}
async function myTicketTimeline(
  request: Request,
  client: Client,
  admin: Admin,
  item: Action,
  actorId: string,
): Promise<Response> {
  const current = await ownTicket(admin, item.tenantId, item.ticketId, actorId);
  const comments = await client
    .from("ticket_comments")
    .select("id, body, created_at, author_id, visibility")
    .eq("ticket_id", current.id as string)
    .eq("visibility", "external")
    .order("created_at")
    .limit(500);
  const events = await admin
    .from("ticket_events")
    .select("id, event_type, created_at")
    .eq("ticket_id", current.id as string)
    .in("event_type", [
      "ticket.created",
      "ticket.status_changed",
      "ticket.comment.external",
      "ticket.resolved",
      "ticket.closed",
    ])
    .order("created_at")
    .limit(500);
  if (comments.error) db(comments.error);
  if (events.error) db(events.error);
  const ids = [
    ...new Set(
      (comments.data ?? []).map((entry) => entry.author_id).filter(isUuid),
    ),
  ];
  const profiles = ids.length
    ? await admin.from("user_profiles").select("id, display_name").in("id", ids)
    : { data: [], error: null };
  if (profiles.error) db(profiles.error);
  const names = new Map(
    (profiles.data ?? []).map((entry) => [entry.id, entry.display_name]),
  );
  return reply(request, {
    data: {
      timeline: [
        ...(events.data ?? []).map((entry) => ({
          type: "event",
          id: entry.id,
          eventType: entry.event_type,
          occurredAt: entry.created_at,
        })),
        ...(comments.data ?? []).map((entry) => ({
          type: "comment",
          id: entry.id,
          body: entry.body,
          occurredAt: entry.created_at,
          authorDisplayName: names.get(entry.author_id) ?? null,
        })),
      ].sort((left, right) =>
        String(left.occurredAt).localeCompare(String(right.occurredAt)),
      ),
    },
  });
}
async function slaExpectation(
  request: Request,
  admin: Admin,
  item: Action,
  actorId: string,
): Promise<Response> {
  const current = await ownTicket(admin, item.tenantId, item.ticketId, actorId);
  return reply(request, {
    data: {
      expectation: {
        responseDueAt: current.response_due_at ?? null,
        resolutionDueAt: current.resolution_due_at ?? null,
        message:
          current.response_due_at || current.resolution_due_at
            ? "Die angezeigten Zeiten sind Erwartungen aus den vorhandenen SLA-Daten."
            : "Für dieses Ticket ist keine konkrete SLA-Erwartung hinterlegt.",
      },
    },
  });
}
async function myDevices(
  request: Request,
  admin: Admin,
  item: Action,
  actorId: string,
): Promise<Response> {
  const flags = await resolveTenantFeatureStates(admin, item.tenantId, [
    "assets.management",
  ]);
  if (!flags)
    throw new HttpError(
      503,
      "tenant_feature_lookup_failed",
      "Die Funktionsfreigabe konnte nicht geprüft werden.",
    );
  if (!flags["assets.management"])
    return reply(request, { data: { devices: [], available: false } });
  const requester = await admin
    .from("ticket_requesters")
    .select("id")
    .eq("tenant_id", item.tenantId)
    .eq("user_id", actorId)
    .maybeSingle();
  if (requester.error) db(requester.error);
  if (!requester.data)
    return reply(request, { data: { devices: [], available: true } });
  const assignments = await admin
    .from("asset_assignments")
    .select("asset_id, assigned_at")
    .eq("tenant_id", item.tenantId)
    .eq("requester_id", requester.data.id)
    .is("returned_at", null)
    .limit(200);
  if (assignments.error) db(assignments.error);
  const ids = (assignments.data ?? [])
    .map((entry) => entry.asset_id)
    .filter(isUuid);
  const devices = ids.length
    ? await admin
        .from("assets")
        .select(
          "id, name, asset_tag, lifecycle_state, manufacturer, model, operating_system",
        )
        .eq("tenant_id", item.tenantId)
        .in("id", ids)
    : { data: [], error: null };
  if (devices.error) db(devices.error);
  return reply(request, {
    data: { devices: devices.data ?? [], available: true },
  });
}
async function myApprovals(
  request: Request,
  admin: Admin,
  item: Action,
  actorId: string,
): Promise<Response> {
  const result = await admin
    .from("ticket_approval_requests")
    .select(
      "id, ticket_id, approval_kind, reason, requested_at, required_approvals",
    )
    .eq("tenant_id", item.tenantId)
    .eq("requested_by", actorId)
    .eq("status", "pending")
    .order("requested_at", { ascending: false })
    .limit(200);
  if (result.error) db(result.error);
  return reply(request, { data: { approvals: result.data ?? [] } });
}
async function requestReopen(
  request: Request,
  admin: Admin,
  item: Action,
  actorId: string,
): Promise<Response> {
  const current = await ownTicket(admin, item.tenantId, item.ticketId, actorId);
  if (current.resolved_at === null && current.closed_at === null)
    throw new HttpError(
      422,
      "ticket_not_resolved",
      "Eine Wiedereröffnung kann erst nach Lösung oder Schliessung beantragt werden.",
    );
  const reason = clean(item.reason, 3, 3000);
  if (!reason)
    throw new HttpError(400, "invalid_request", "Die Begründung ist ungültig.");
  const exists = await admin
    .from("ticket_reopen_requests")
    .select("id")
    .eq("tenant_id", item.tenantId)
    .eq("ticket_id", current.id as string)
    .eq("requested_by", actorId)
    .eq("status", "pending")
    .maybeSingle();
  if (exists.error) db(exists.error);
  if (exists.data)
    throw new HttpError(
      409,
      "reopen_request_pending",
      "Für dieses Ticket besteht bereits eine offene Wiedereröffnungsanfrage.",
    );
  const result = await admin
    .from("ticket_reopen_requests")
    .insert({
      tenant_id: item.tenantId,
      ticket_id: current.id,
      requested_by: actorId,
      reason,
    })
    .select("id, ticket_id, reason, status, created_at")
    .single();
  if (result.error) db(result.error);
  await audit(
    admin,
    item.tenantId,
    actorId,
    "ticket.reopen_request.created",
    "ticket_reopen_request",
    result.data.id,
  );
  return reply(
    request,
    { data: { reopenRequest: result.data, ticketChanged: false } },
    201,
  );
}
async function exportMyData(
  request: Request,
  client: Client,
  admin: Admin,
  item: Action,
  actorId: string,
): Promise<Response> {
  const profile = await admin
    .from("user_profiles")
    .select("id, display_name, locale, timezone, created_at, updated_at")
    .eq("id", actorId)
    .maybeSingle();
  const tickets = await admin
    .from("tickets")
    .select(
      "id, ticket_number, subject, description, created_at, updated_at, resolved_at, closed_at, requester_id, affected_user_id",
    )
    .eq("tenant_id", item.tenantId)
    .or(`requester_id.eq.${actorId},affected_user_id.eq.${actorId}`)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (profile.error) db(profile.error);
  if (tickets.error) db(tickets.error);
  const ticketIds = (tickets.data ?? [])
    .map((entry) => entry.id)
    .filter(isUuid);
  const comments = ticketIds.length
    ? await client
        .from("ticket_comments")
        .select(
          "id, ticket_id, body, visibility, author_id, created_at, updated_at",
        )
        .in("ticket_id", ticketIds)
        .eq("visibility", "external")
        .order("created_at")
        .limit(10000)
    : { data: [], error: null };
  if (comments.error) db(comments.error);
  const authorIds = [
    ...new Set(
      (comments.data ?? []).map((entry) => entry.author_id).filter(isUuid),
    ),
  ];
  const authors = authorIds.length
    ? await admin
        .from("user_profiles")
        .select("id, display_name")
        .in("id", authorIds)
    : { data: [], error: null };
  if (authors.error) db(authors.error);
  const names = new Map(
    (authors.data ?? []).map((entry) => [entry.id, entry.display_name]),
  );
  return reply(request, {
    data: {
      exportedAt: new Date().toISOString(),
      profile: profile.data,
      tickets: (tickets.data ?? []).map(
        ({
          requester_id: _requesterId,
          affected_user_id: _affectedUserId,
          ...entry
        }) => entry,
      ),
      comments: (comments.data ?? []).map(({ author_id, ...entry }) => ({
        ...entry,
        authorDisplayName: names.get(author_id) ?? null,
      })),
    },
  });
}

const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    try {
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId))
        throw new HttpError(
          401,
          "authentication_required",
          "Eine gültige Benutzeranmeldung ist erforderlich.",
        );
      const item = action(await request.json().catch(() => null));
      if (!item)
        throw new HttpError(
          400,
          "invalid_request",
          "Die Anfrage enthält ungültige oder unbekannte Felder.",
        );
      await base(context.supabase, context.supabaseAdmin, item.tenantId);
      if (item.type === "activeIncidentNotices")
        return await activeIncidentNotices(
          request,
          context.supabaseAdmin,
          item,
        );
      if (item.type === "myTicketTimeline")
        return await myTicketTimeline(
          request,
          context.supabase,
          context.supabaseAdmin,
          item,
          actorId,
        );
      if (item.type === "slaExpectation")
        return await slaExpectation(
          request,
          context.supabaseAdmin,
          item,
          actorId,
        );
      if (item.type === "myDevices")
        return await myDevices(request, context.supabaseAdmin, item, actorId);
      if (item.type === "myApprovals")
        return await myApprovals(request, context.supabaseAdmin, item, actorId);
      if (item.type === "requestReopen")
        return await requestReopen(
          request,
          context.supabaseAdmin,
          item,
          actorId,
        );
      if (item.type === "listTicketWatchers")
        return await listTicketWatchers(
          request,
          context.supabaseAdmin,
          item,
          actorId,
        );
      if (item.type === "addTicketWatcher")
        return await addTicketWatcher(
          request,
          context.supabaseAdmin,
          item,
          actorId,
        );
      if (item.type === "removeTicketWatcher")
        return await removeTicketWatcher(
          request,
          context.supabaseAdmin,
          item,
          actorId,
        );
      if (item.type === "getMyAvailability")
        return await getMyAvailability(
          request,
          context.supabaseAdmin,
          item,
          actorId,
        );
      if (item.type === "setMyAvailability")
        return await setMyAvailability(
          request,
          context.supabaseAdmin,
          item,
          actorId,
        );
      if (item.type === "searchColleagues")
        return await searchColleagues(
          request,
          context.supabaseAdmin,
          item,
          actorId,
        );
      if (item.type === "departmentTickets")
        return await departmentTickets(
          request,
          context.supabaseAdmin,
          item,
          actorId,
        );
      return await exportMyData(
        request,
        context.supabase,
        context.supabaseAdmin,
        item,
        actorId,
      );
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
async function bounded(request: Request): Promise<Request> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
    throw new HttpError(413, "request_too_large", "Die Anfrage ist zu gross.");
  if (!request.body)
    throw new HttpError(
      400,
      "invalid_request",
      "Ein JSON-Objekt ist erforderlich.",
    );
  const bytes = new Uint8Array(await new Response(request.body).arrayBuffer());
  if (bytes.byteLength > MAX_BYTES)
    throw new HttpError(413, "request_too_large", "Die Anfrage ist zu gross.");
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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
    body: bytes,
    signal: request.signal,
  });
}
export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ALLOWED_ORIGIN)
      return failure(
        request,
        new HttpError(
          403,
          "origin_not_allowed",
          "Dieser Ursprung ist nicht erlaubt.",
        ),
      );
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
      return reply(request, {}, 204);
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
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      return failure(
        request,
        new HttpError(
          415,
          "unsupported_media_type",
          "Content-Type application/json ist erforderlich.",
        ),
      );
    try {
      const result = await handler(await bounded(request));
      if (result.headers.has("x-supabase-server-error"))
        throw new HttpError(
          result.status === 401 ? 401 : result.status === 403 ? 403 : 503,
          result.status === 401
            ? "authentication_required"
            : result.status === 403
              ? "permission_denied"
              : "authentication_unavailable",
          "Die Anmeldung konnte nicht geprüft werden.",
        );
      return new Response(result.body, {
        status: result.status,
        headers: cors(request),
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
