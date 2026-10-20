import { type SupabaseContext, withSupabase } from "@supabase/server";

const APP_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 48 * 1024;

type Client = SupabaseContext["supabase"];
type Admin = SupabaseContext["supabaseAdmin"];
type Row = Record<string, unknown>;
type TaskStatus = "open" | "in_progress" | "blocked" | "completed";
type Action =
  | { type: "listWorkspace"; tenantId: string; focusEntryId?: string }
  | {
      type: "createEntry";
      tenantId: string;
      employeeName: string;
      startsOn: string;
      organisationUnit: string | null;
      location: string | null;
      managerUserId: string;
      ictResponsibleUserId: string;
      templateId: string;
    }
  | {
      type: "updateTaskStatus";
      tenantId: string;
      taskId: string;
      status: TaskStatus;
    }
  | {
      type: "linkExceptionTicket";
      tenantId: string;
      entryId: string;
      taskId: string | null;
      ticketNumber: string;
      reason: string;
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
function safeText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    value.includes("\u0000")
  )
    return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  const length = Array.from(normalized).length;
  return length >= minimum && length <= maximum ? normalized : null;
}
function nullableText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return safeText(value, minimum, maximum) ?? undefined;
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}
function onlyKeys(value: Row, keys: string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "listWorkspace") {
    return isUuid(value.tenantId) &&
      (value.focusEntryId === undefined || isUuid(value.focusEntryId)) &&
      onlyKeys(value, ["type", "tenantId", "focusEntryId"])
      ? {
          type: value.type,
          tenantId: value.tenantId.toLowerCase(),
          ...(typeof value.focusEntryId === "string"
            ? { focusEntryId: value.focusEntryId.toLowerCase() }
            : {}),
        }
      : null;
  }
  if (value.type === "createEntry") {
    const employeeName = safeText(value.employeeName, 2, 160);
    const organisationUnit = safeText(value.organisationUnit, 2, 160);
    const location = safeText(value.location, 2, 160);
    return isUuid(value.tenantId) &&
      employeeName !== null &&
      validDate(value.startsOn) &&
      organisationUnit !== null &&
      location !== null &&
      isUuid(value.managerUserId) &&
      isUuid(value.ictResponsibleUserId) &&
      isUuid(value.templateId) &&
      onlyKeys(value, [
        "type",
        "tenantId",
        "employeeName",
        "startsOn",
        "organisationUnit",
        "location",
        "managerUserId",
        "ictResponsibleUserId",
        "templateId",
      ])
      ? {
          type: value.type,
          tenantId: value.tenantId.toLowerCase(),
          employeeName,
          startsOn: value.startsOn,
          organisationUnit,
          location,
          managerUserId: value.managerUserId.toLowerCase(),
          ictResponsibleUserId: value.ictResponsibleUserId.toLowerCase(),
          templateId: value.templateId.toLowerCase(),
        }
      : null;
  }
  if (value.type === "updateTaskStatus") {
    return isUuid(value.tenantId) &&
      isUuid(value.taskId) &&
      ["open", "in_progress", "blocked", "completed"].includes(
        String(value.status),
      ) &&
      onlyKeys(value, ["type", "tenantId", "taskId", "status"])
      ? {
          type: value.type,
          tenantId: value.tenantId.toLowerCase(),
          taskId: value.taskId.toLowerCase(),
          status: value.status as TaskStatus,
        }
      : null;
  }
  if (value.type === "linkExceptionTicket") {
    const reason = safeText(value.reason, 3, 500);
    const taskId =
      value.taskId === null
        ? null
        : isUuid(value.taskId)
          ? value.taskId.toLowerCase()
          : undefined;
    const ticketNumber = safeText(value.ticketNumber, 2, 80);
    return isUuid(value.tenantId) &&
      isUuid(value.entryId) &&
      taskId !== undefined &&
      ticketNumber !== null &&
      reason !== null &&
      onlyKeys(value, [
        "type",
        "tenantId",
        "entryId",
        "taskId",
        "ticketNumber",
        "reason",
      ])
      ? {
          type: value.type,
          tenantId: value.tenantId.toLowerCase(),
          entryId: value.entryId.toLowerCase(),
          taskId,
          ticketNumber,
          reason,
        }
      : null;
  }
  return null;
}

function corsHeaders(request: Request) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === APP_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", APP_ORIGIN);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return headers;
}
function json(request: Request, body: Record<string, unknown>, status = 200) {
  const headers = corsHeaders(request);
  if (status === 405) headers.set("Allow", "POST, OPTIONS");
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers,
  });
}
function failure(request: Request, error: HttpError) {
  return json(
    request,
    { error: { code: error.code, message: error.message } },
    error.status,
  );
}
async function requestJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "invalid_request", "Die Anfrage ist zu gross.");
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "invalid_request", "Die Anfrage ist zu gross.");
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    return null;
  }
}
function databaseFailure(error: { code?: string }): never {
  switch (error.code) {
    case "23503":
      throw new HttpError(
        422,
        "onboarding_reference_invalid",
        "Die gewählte Person, Vorlage oder Ticketreferenz ist nicht mehr verfügbar.",
      );
    case "23505":
      throw new HttpError(
        409,
        "onboarding_conflict",
        "Diese Verknüpfung besteht bereits.",
      );
    case "42501":
      throw new HttpError(
        403,
        "onboarding_permission_denied",
        "Für diese Aktion fehlt die erforderliche Berechtigung.",
      );
    case "22001":
    case "22023":
    case "22P02":
    case "23502":
    case "23514":
      throw new HttpError(
        422,
        "onboarding_input_invalid",
        "Die Eingaben sind unvollständig oder ungültig.",
      );
    case "42P01":
    case "42883":
    case "PGRST202":
    case "PGRST204":
      throw new HttpError(
        503,
        "onboarding_service_unavailable",
        "Das Onboarding ist derzeit nicht verfügbar.",
      );
    default:
      throw new HttpError(
        500,
        "onboarding_operation_failed",
        "Die Aktion konnte nicht abgeschlossen werden.",
      );
  }
}
async function requireMembership(client: Client, tenantId: string) {
  const { data, error } = await client.rpc("is_active_tenant_member", {
    p_tenant_id: tenantId,
  });
  if (error || typeof data !== "boolean")
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  if (!data)
    throw new HttpError(
      403,
      "tenant_membership_required",
      "Für diese Anfrage ist eine aktive Mandantenmitgliedschaft erforderlich.",
    );
}
async function hasPermission(
  client: Client,
  tenantId: string,
  code: "onboarding.request" | "onboarding.manage",
) {
  const { data, error } = await client.rpc("has_onboarding_permission", {
    p_tenant_id: tenantId,
    p_permission_code: code,
  });
  if (error || typeof data !== "boolean")
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  return data;
}
async function requirePermission(
  client: Client,
  tenantId: string,
  code: "onboarding.request" | "onboarding.manage",
) {
  if (!(await hasPermission(client, tenantId, code)))
    throw new HttpError(
      403,
      "onboarding_permission_denied",
      "Für diese Aktion fehlt die erforderliche Berechtigung.",
    );
}
async function audit(
  admin: Admin,
  tenantId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, string | number | boolean | null>,
) {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    severity: "info",
    metadata,
  });
  if (error) databaseFailure(error);
}

function displayName(row: Row) {
  return typeof row.display_name === "string" && row.display_name.trim()
    ? row.display_name.trim()
    : "Ohne Namen";
}
async function peopleForTenant(admin: Admin, tenantId: string) {
  const { data: memberships, error: membershipsError } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .limit(1000);
  if (membershipsError) databaseFailure(membershipsError);
  const ids = (memberships ?? [])
    .map((row: Row) => row.user_id)
    .filter((id): id is string => typeof id === "string");
  const { data: profiles, error: profilesError } = ids.length
    ? await admin
        .from("user_profiles")
        .select("id, display_name")
        .in("id", ids)
        .limit(ids.length)
    : { data: [], error: null };
  if (profilesError) databaseFailure(profilesError);
  const names = new Map(
    (profiles ?? [])
      .filter((row: Row) => typeof row.id === "string")
      .map((row: Row) => [String(row.id), displayName(row)]),
  );
  return {
    ids,
    names,
    people: ids
      .map((id) => ({ id, displayName: names.get(id) ?? "Ohne Namen" }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "de-CH")),
  };
}
async function listWorkspace(
  client: Client,
  admin: Admin,
  tenantId: string,
  actorId: string,
  focusEntryId?: string,
) {
  await requireMembership(client, tenantId);
  const [canRequest, canManage] = await Promise.all([
    hasPermission(client, tenantId, "onboarding.request"),
    hasPermission(client, tenantId, "onboarding.manage"),
  ]);
  const [templatesResult, peopleResult] = await Promise.all([
    admin
      .from("onboarding_templates")
      .select("id, template_key, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name")
      .limit(20),
    peopleForTenant(admin, tenantId),
  ]);
  if (templatesResult.error) databaseFailure(templatesResult.error);
  let entriesQuery = admin
    .from("onboarding_entries")
    .select(
      "id, employee_name, starts_on, organisation_unit, location, manager_user_id, ict_responsible_user_id, created_by, template_id",
    )
    .eq("tenant_id", tenantId)
    .order("starts_on")
    .order("created_at", { ascending: false })
    .limit(250);
  if (!canManage)
    entriesQuery = entriesQuery.or(
      `created_by.eq.${actorId},manager_user_id.eq.${actorId},ict_responsible_user_id.eq.${actorId}`,
    );
  const { data: entryRows, error: entriesError } = await entriesQuery;
  if (entriesError) databaseFailure(entriesError);
  const entries = (entryRows ?? []).filter(
    (row: Row) => typeof row.id === "string",
  ) as Row[];
  if (focusEntryId && !entries.some((entry) => entry.id === focusEntryId)) {
    const { data: focusedEntry, error: focusedEntryError } = await admin
      .from("onboarding_entries")
      .select(
        "id, employee_name, starts_on, organisation_unit, location, manager_user_id, ict_responsible_user_id, created_by, template_id",
      )
      .eq("tenant_id", tenantId)
      .eq("id", focusEntryId)
      .maybeSingle();
    if (focusedEntryError) databaseFailure(focusedEntryError);
    if (
      focusedEntry &&
      (canManage ||
        focusedEntry.created_by === actorId ||
        focusedEntry.manager_user_id === actorId ||
        focusedEntry.ict_responsible_user_id === actorId)
    ) {
      entries.push(focusedEntry as Row);
    }
  }
  const entryIds = entries.map((row) => String(row.id));
  const [tasksResult, exceptionsResult] = entryIds.length
    ? await Promise.all([
        admin
          .from("onboarding_tasks")
          .select(
            "id, entry_id, title, due_on, responsible_user_id, status, position",
          )
          .eq("tenant_id", tenantId)
          .in("entry_id", entryIds)
          .order("position")
          .limit(1500),
        admin
          .from("onboarding_exception_tickets")
          .select("entry_id, task_id, ticket_id, reason")
          .eq("tenant_id", tenantId)
          .in("entry_id", entryIds)
          .limit(500),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (tasksResult.error) databaseFailure(tasksResult.error);
  if (exceptionsResult.error) databaseFailure(exceptionsResult.error);
  const ticketIds = [
    ...new Set(
      (exceptionsResult.data ?? [])
        .map((row: Row) => row.ticket_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const { data: ticketRows, error: ticketError } = ticketIds.length
    ? await client
        .from("tickets")
        .select("id, ticket_number")
        .eq("tenant_id", tenantId)
        .in("id", ticketIds)
        .limit(ticketIds.length)
    : { data: [], error: null };
  if (ticketError) databaseFailure(ticketError);
  const ticketNumbers = new Map(
    (ticketRows ?? [])
      .filter((row: Row) => typeof row.id === "string")
      .map((row: Row) => [
        String(row.id),
        typeof row.ticket_number === "string" ? row.ticket_number : "Ticket",
      ]),
  );
  const tasksByEntry = new Map<string, Row[]>();
  for (const task of tasksResult.data ?? []) {
    if (typeof task.entry_id === "string")
      tasksByEntry.set(task.entry_id, [
        ...(tasksByEntry.get(task.entry_id) ?? []),
        task,
      ]);
  }
  const exceptionsByTask = new Map<
    string,
    { ticketNumber: string; reason: string }
  >();
  for (const exception of exceptionsResult.data ?? [])
    if (
      typeof exception.task_id === "string" &&
      typeof exception.ticket_id === "string" &&
      ticketNumbers.has(exception.ticket_id)
    )
      exceptionsByTask.set(exception.task_id, {
        ticketNumber: ticketNumbers.get(exception.ticket_id) as string,
        reason:
          typeof exception.reason === "string" ? exception.reason : "Ausnahme",
      });
  return {
    permissions: { canRequest, canManage },
    people: peopleResult.people,
    templates: (templatesResult.data ?? []).map((row: Row) => ({
      id: String(row.id),
      key: String(row.template_key),
      name: String(row.name),
    })),
    entries: entries.map((entry) => ({
      id: String(entry.id),
      employeeName: String(entry.employee_name),
      startsOn: String(entry.starts_on),
      organisationUnit:
        typeof entry.organisation_unit === "string"
          ? entry.organisation_unit
          : null,
      location: typeof entry.location === "string" ? entry.location : null,
      managerName:
        peopleResult.names.get(String(entry.manager_user_id)) ??
        "Führungsperson",
      ictResponsibleName:
        peopleResult.names.get(String(entry.ict_responsible_user_id)) ??
        "ICT-Verantwortung",
      templateId: String(entry.template_id),
      tasks: (tasksByEntry.get(String(entry.id)) ?? []).map((task) => ({
        id: String(task.id),
        title: String(task.title),
        dueOn: String(task.due_on),
        responsibleName:
          peopleResult.names.get(String(task.responsible_user_id)) ??
          "Verantwortliche Person",
        status: String(task.status),
        canUpdate: canManage || task.responsible_user_id === actorId,
        exception: exceptionsByTask.get(String(task.id)) ?? null,
      })),
    })),
  };
}
async function createEntry(
  client: Client,
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "createEntry" }>,
) {
  await requirePermission(client, action.tenantId, "onboarding.request");
  const { data, error } = await admin.rpc("create_onboarding_entry", {
    p_tenant_id: action.tenantId,
    p_employee_name: action.employeeName,
    p_starts_on: action.startsOn,
    p_organisation_unit: action.organisationUnit,
    p_location: action.location,
    p_manager_user_id: action.managerUserId,
    p_ict_responsible_user_id: action.ictResponsibleUserId,
    p_template_id: action.templateId,
    p_actor_id: actorId,
  });
  if (error) databaseFailure(error);
  if (!isUuid(data))
    throw new HttpError(
      500,
      "onboarding_operation_failed",
      "Der Eintritt konnte nicht vollständig erstellt werden.",
    );
  return { entryId: data };
}
async function updateTaskStatus(
  client: Client,
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "updateTaskStatus" }>,
) {
  await requireMembership(client, action.tenantId);
  const canManage = await hasPermission(
    client,
    action.tenantId,
    "onboarding.manage",
  );
  const { data: task, error: taskError } = await admin
    .from("onboarding_tasks")
    .select("id, responsible_user_id, entry_id")
    .eq("tenant_id", action.tenantId)
    .eq("id", action.taskId)
    .maybeSingle();
  if (taskError) databaseFailure(taskError);
  if (!task)
    throw new HttpError(
      404,
      "onboarding_task_not_found",
      "Die Onboarding-Aufgabe ist nicht mehr verfügbar.",
    );
  if (!canManage && task.responsible_user_id !== actorId)
    throw new HttpError(
      403,
      "onboarding_permission_denied",
      "Für diese Aufgabe fehlt Ihnen die erforderliche Berechtigung.",
    );
  const { error } = await admin
    .from("onboarding_tasks")
    .update({
      status: action.status,
      completed_at:
        action.status === "completed" ? new Date().toISOString() : null,
    })
    .eq("tenant_id", action.tenantId)
    .eq("id", action.taskId);
  if (error) databaseFailure(error);
  await audit(
    admin,
    action.tenantId,
    actorId,
    "onboarding.task.status_changed",
    "onboarding_task",
    action.taskId,
    { status: action.status },
  );
}
async function linkExceptionTicket(
  client: Client,
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "linkExceptionTicket" }>,
) {
  await requireMembership(client, action.tenantId);
  const canManage = await hasPermission(
    client,
    action.tenantId,
    "onboarding.manage",
  );
  const { data: entry, error: entryError } = await admin
    .from("onboarding_entries")
    .select("id, created_by, manager_user_id, ict_responsible_user_id")
    .eq("tenant_id", action.tenantId)
    .eq("id", action.entryId)
    .maybeSingle();
  if (entryError) databaseFailure(entryError);
  if (!entry)
    throw new HttpError(
      404,
      "onboarding_entry_not_found",
      "Der Eintritt ist nicht mehr verfügbar.",
    );
  if (
    !canManage &&
    ![
      entry.created_by,
      entry.manager_user_id,
      entry.ict_responsible_user_id,
    ].includes(actorId)
  )
    throw new HttpError(
      403,
      "onboarding_permission_denied",
      "Für diesen Eintritt fehlt Ihnen die erforderliche Berechtigung.",
    );
  if (action.taskId) {
    const { data: task, error } = await admin
      .from("onboarding_tasks")
      .select("id")
      .eq("tenant_id", action.tenantId)
      .eq("id", action.taskId)
      .eq("entry_id", action.entryId)
      .maybeSingle();
    if (error) databaseFailure(error);
    if (!task)
      throw new HttpError(
        422,
        "onboarding_reference_invalid",
        "Die Aufgabe gehört nicht zu diesem Eintritt.",
      );
  }
  const { data: ticket, error: ticketError } = await client
    .from("tickets")
    .select("id")
    .eq("tenant_id", action.tenantId)
    .eq("ticket_number", action.ticketNumber)
    .maybeSingle();
  if (ticketError) databaseFailure(ticketError);
  if (!ticket)
    throw new HttpError(
      422,
      "onboarding_reference_invalid",
      "Das Ticket gehört nicht zu diesem Mandanten oder ist nicht mehr verfügbar.",
    );
  const { error } = await admin.from("onboarding_exception_tickets").insert({
    tenant_id: action.tenantId,
    entry_id: action.entryId,
    task_id: action.taskId,
    ticket_id: ticket.id,
    reason: action.reason,
    created_by: actorId,
  });
  if (error) databaseFailure(error);
  await audit(
    admin,
    action.tenantId,
    actorId,
    "onboarding.exception_ticket.linked",
    "onboarding_entry",
    action.entryId,
    { linkedToTask: action.taskId !== null },
  );
}

const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method === "OPTIONS") return json(request, {}, 204);
      if (request.method !== "POST")
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId))
        throw new HttpError(
          401,
          "authentication_required",
          "Eine gültige Benutzeranmeldung ist erforderlich.",
        );
      const action = parseAction(await requestJson(request));
      if (!action)
        throw new HttpError(
          400,
          "invalid_request",
          "Die Anfrage enthält ungültige Felder.",
        );
      if (action.type === "listWorkspace")
        return json(request, {
          data: await listWorkspace(
            context.supabase,
            context.supabaseAdmin,
            action.tenantId,
            actorId,
            action.focusEntryId,
          ),
        });
      if (action.type === "createEntry")
        return json(
          request,
          {
            data: await createEntry(
              context.supabase,
              context.supabaseAdmin,
              actorId,
              action,
            ),
          },
          201,
        );
      if (action.type === "updateTaskStatus") {
        await updateTaskStatus(
          context.supabase,
          context.supabaseAdmin,
          actorId,
          action,
        );
        return json(request, { data: { updated: true } });
      }
      await linkExceptionTicket(
        context.supabase,
        context.supabaseAdmin,
        actorId,
        action,
      );
      return json(request, { data: { linked: true } }, 201);
    } catch (error) {
      return failure(
        request,
        error instanceof HttpError
          ? error
          : new HttpError(
              500,
              "onboarding_operation_failed",
              "Die Aktion konnte nicht abgeschlossen werden.",
            ),
      );
    }
  },
);
export default {
  fetch(request: Request): Response | Promise<Response> {
    return handler(request);
  },
};
