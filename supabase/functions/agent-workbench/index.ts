import { type SupabaseContext, withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const FEATURE = "agent.workbench";
const MAX_BYTES = 64 * 1024;
const ACTIONS = [
  "listMacros",
  "saveMacro",
  "previewMacro",
  "listMentions",
  "markMentionRead",
  "createMentions",
  "listDelegations",
  "saveDelegation",
  "endDelegation",
  "suggestAssignees",
  "teamQueues",
  "myMetrics",
  "ticketContext",
  "knowledgeDraftFromTicket",
  "listIncidentNotices",
  "saveIncidentNotice",
  "listReopenRequests",
  "decideReopenRequest",
] as const;
type ActionName = (typeof ACTIONS)[number];
type Row = Record<string, unknown>;
type Client = SupabaseContext["supabase"];
type Admin = SupabaseContext["supabaseAdmin"];
type Action = { type: ActionName; tenantId: string } & Row;

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
const text = (value: unknown, min: number, max: number): string | null => {
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    !value.isWellFormed()
  )
    return null;
  const result = value.trim();
  const length = Array.from(result).length;
  return length >= min && length <= max ? result : null;
};
const optionalText = (
  value: unknown,
  max: number,
): string | null | undefined =>
  value === undefined ? undefined : value === null ? null : text(value, 1, max);
const timestamp = (value: unknown): string | null => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return null;
  return new Date(value).toISOString() === value ? value : null;
};

function parseAction(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    !isUuid(value.tenantId) ||
    typeof value.type !== "string"
  )
    return null;
  if (!(ACTIONS as readonly string[]).includes(value.type)) return null;
  return {
    ...value,
    type: value.type as ActionName,
    tenantId: value.tenantId.toLowerCase(),
  };
}
function headers(request: Request): Headers {
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
    headers: headers(request),
  });
  if (status === 405) result.headers.set("Allow", "POST, OPTIONS");
  return result;
}
function fail(request: Request, error: HttpError): Response {
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
      "agent_workbench_not_configured",
      "Die Agentenwerkbank ist noch nicht bereitgestellt.",
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
async function rpcTrue(
  client: Client,
  name: string,
  args: Row,
  failureCode: string,
  message: string,
): Promise<void> {
  const { data, error } = await client.rpc(name, args);
  if (error || typeof data !== "boolean")
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  if (!data) throw new HttpError(403, failureCode, message);
}
async function requireBase(
  client: Client,
  admin: Admin,
  tenantId: string,
): Promise<void> {
  await rpcTrue(
    client,
    "is_active_tenant_member",
    { p_tenant_id: tenantId },
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
      "agent_workbench_feature_disabled",
      "Die Agentenwerkbank ist für diesen Mandanten deaktiviert.",
    );
  await rpcTrue(
    client,
    "is_tenant_ticket_agent",
    { p_tenant_id: tenantId },
    "agent_ticket_permission_required",
    "Für die Agentenwerkbank sind Ticketrechte erforderlich.",
  );
}
async function tenantPermission(
  client: Client,
  tenantId: string,
  permission: string,
): Promise<void> {
  await rpcTrue(
    client,
    "has_tenant_permission",
    { p_tenant_id: tenantId, p_permission_code: permission },
    "tenant_permission_required",
    "Für diese Verwaltungsaktion fehlt die Mandantenberechtigung.",
  );
}
async function ticket(
  admin: Admin,
  tenantId: string,
  ticketId: unknown,
): Promise<Row> {
  if (!isUuid(ticketId))
    throw new HttpError(
      400,
      "invalid_request",
      "Eine gültige Ticket-ID ist erforderlich.",
    );
  const { data, error } = await admin
    .from("tickets")
    .select(
      "id, tenant_id, department_id, requester_id, affected_user_id, assigned_agent_id, category_id, priority_id, status_id, subject, description, ticket_number, created_at, first_responded_at, resolved_at, response_due_at, resolution_due_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) db(error);
  if (!data)
    throw new HttpError(
      404,
      "ticket_not_available",
      "Das Ticket ist nicht verfügbar.",
    );
  return data as Row;
}
async function ticketPermission(
  client: Client,
  data: Row,
  permission: string,
): Promise<void> {
  const tenantId = data.tenant_id;
  const departmentId = data.department_id;
  if (!isUuid(tenantId) || !isUuid(departmentId))
    throw new HttpError(
      500,
      "invalid_stored_data",
      "Das Ticket ist fehlerhaft gespeichert.",
    );
  await rpcTrue(
    client,
    "has_ticket_permission",
    {
      p_tenant_id: tenantId,
      p_department_id: departmentId,
      p_permission_code: permission,
    },
    "ticket_permission_required",
    "Für dieses Ticket fehlt die Berechtigung.",
  );
}
async function audit(
  admin: Admin,
  tenantId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Row = {},
): Promise<void> {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });
  if (error) db(error);
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
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) db(error);
  if (!data)
    throw new HttpError(
      422,
      "inactive_tenant_member",
      "Die Person ist kein aktives Mandantenmitglied.",
    );
  return userId.toLowerCase();
}
function nullableUuid(value: unknown): string | null | undefined {
  return value === undefined
    ? undefined
    : value === null
      ? null
      : isUuid(value)
        ? value.toLowerCase()
        : undefined;
}

async function listMacros(
  request: Request,
  client: Client,
  admin: Admin,
  action: Action,
): Promise<Response> {
  await tenantPermission(client, action.tenantId, "ticket.template.manage");
  const { data, error } = await admin
    .from("tenant_macros")
    .select(
      "id, name, template_id, response_text, category_id, subcategory_id, priority_id, created_at, updated_at",
    )
    .eq("tenant_id", action.tenantId)
    .order("name")
    .limit(500);
  if (error) db(error);
  return reply(request, { data: { macros: data ?? [] } });
}

async function saveMacro(
  request: Request,
  client: Client,
  admin: Admin,
  action: Action,
  actorId: string,
): Promise<Response> {
  await tenantPermission(client, action.tenantId, "ticket.template.manage");
  const name = text(action.name, 1, 160);
  const responseText = optionalText(action.responseText, 10000);
  const templateId = nullableUuid(action.templateId);
  const categoryId = nullableUuid(action.categoryId);
  const subcategoryId = nullableUuid(action.subcategoryId);
  const priorityId = nullableUuid(action.priorityId);
  if (
    !name ||
    responseText === undefined ||
    templateId === undefined ||
    categoryId === undefined ||
    subcategoryId === undefined ||
    priorityId === undefined
  )
    throw new HttpError(
      400,
      "invalid_request",
      "Die Makroangaben sind ungültig.",
    );
  const values = {
    tenant_id: action.tenantId,
    name,
    response_text: responseText,
    template_id: templateId,
    category_id: categoryId,
    subcategory_id: subcategoryId,
    priority_id: priorityId,
    updated_by: actorId,
  };
  let data: Row | null = null;
  if (action.macroId === undefined) {
    const result = await admin
      .from("tenant_macros")
      .insert({ ...values, created_by: actorId })
      .select(
        "id, name, template_id, response_text, category_id, subcategory_id, priority_id, created_at, updated_at",
      )
      .single();
    if (result.error) db(result.error);
    data = result.data as Row;
  } else {
    if (!isUuid(action.macroId))
      throw new HttpError(400, "invalid_request", "Die Makro-ID ist ungültig.");
    const result = await admin
      .from("tenant_macros")
      .update(values)
      .eq("tenant_id", action.tenantId)
      .eq("id", action.macroId)
      .select(
        "id, name, template_id, response_text, category_id, subcategory_id, priority_id, created_at, updated_at",
      )
      .maybeSingle();
    if (result.error) db(result.error);
    if (!result.data)
      throw new HttpError(
        404,
        "macro_not_found",
        "Das Makro ist nicht verfügbar.",
      );
    data = result.data as Row;
  }
  await audit(
    admin,
    action.tenantId,
    actorId,
    "agent.macro.saved",
    "tenant_macro",
    typeof data.id === "string" ? data.id : null,
  );
  return reply(
    request,
    { data: { macro: data } },
    action.macroId === undefined ? 201 : 200,
  );
}
async function previewMacro(
  request: Request,
  client: Client,
  admin: Admin,
  action: Action,
): Promise<Response> {
  if (action.ticketId !== undefined) {
    const value = await ticket(admin, action.tenantId, action.ticketId);
    await ticketPermission(client, value, "ticket.update");
  }
  let source: Row = action;
  if (action.macroId !== undefined) {
    if (!isUuid(action.macroId))
      throw new HttpError(400, "invalid_request", "Die Makro-ID ist ungültig.");
    const result = await admin
      .from("tenant_macros")
      .select("id, response_text, category_id, subcategory_id, priority_id")
      .eq("tenant_id", action.tenantId)
      .eq("id", action.macroId)
      .maybeSingle();
    if (result.error) db(result.error);
    if (!result.data)
      throw new HttpError(
        404,
        "macro_not_found",
        "Das Makro ist nicht verfügbar.",
      );
    source = result.data as Row;
  }
  return reply(request, {
    data: {
      preview: {
        responseText: source.response_text ?? source.responseText ?? null,
        categoryId: source.category_id ?? source.categoryId ?? null,
        subcategoryId: source.subcategory_id ?? source.subcategoryId ?? null,
        priorityId: source.priority_id ?? source.priorityId ?? null,
      },
      applied: false,
    },
  });
}
async function listMentions(
  request: Request,
  client: Client,
  action: Action,
  actorId: string,
): Promise<Response> {
  let query = client
    .from("ticket_mentions")
    .select(
      "id, ticket_id, comment_id, mentioned_user_id, author_id, read_at, created_at",
    )
    .eq("tenant_id", action.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (action.onlyMine !== false) query = query.eq("mentioned_user_id", actorId);
  const { data, error } = await query;
  if (error) db(error);
  return reply(request, { data: { mentions: data ?? [] } });
}
async function markMentionRead(
  request: Request,
  admin: Admin,
  action: Action,
  actorId: string,
): Promise<Response> {
  if (!isUuid(action.mentionId))
    throw new HttpError(
      400,
      "invalid_request",
      "Die Erwähnungs-ID ist ungültig.",
    );
  const current = await admin
    .from("ticket_mentions")
    .select("id, mentioned_user_id, read_at")
    .eq("tenant_id", action.tenantId)
    .eq("id", action.mentionId)
    .maybeSingle();
  if (current.error) db(current.error);
  if (!current.data || current.data.mentioned_user_id !== actorId)
    throw new HttpError(
      404,
      "mention_not_found",
      "Die Erwähnung ist nicht verfügbar.",
    );
  const changed = current.data.read_at === null;
  const result = changed
    ? await admin
        .from("ticket_mentions")
        .update({ read_at: new Date().toISOString() })
        .eq("tenant_id", action.tenantId)
        .eq("id", action.mentionId)
        .select("id, read_at")
        .single()
    : { data: current.data, error: null };
  if (result.error) db(result.error);
  if (changed)
    await audit(
      admin,
      action.tenantId,
      actorId,
      "agent.mention.read",
      "ticket_mention",
      action.mentionId,
    );
  return reply(request, { data: { mention: result.data, changed } });
}
async function createMentions(
  request: Request,
  client: Client,
  admin: Admin,
  action: Action,
  actorId: string,
): Promise<Response> {
  const info = await ticket(admin, action.tenantId, action.ticketId);
  await ticketPermission(client, info, "ticket.internal_notes.read");
  if (
    !isUuid(action.commentId) ||
    !Array.isArray(action.mentionedUserIds) ||
    action.mentionedUserIds.length < 1 ||
    action.mentionedUserIds.length > 50
  )
    throw new HttpError(
      400,
      "invalid_request",
      "Interne Notiz und mindestens eine erwähnte Person sind erforderlich.",
    );
  const comment = await admin
    .from("ticket_comments")
    .select("id, ticket_id, visibility")
    .eq("id", action.commentId)
    .maybeSingle();
  if (comment.error) db(comment.error);
  if (
    !comment.data ||
    comment.data.ticket_id !== info.id ||
    comment.data.visibility !== "internal"
  )
    throw new HttpError(
      422,
      "internal_comment_required",
      "Erwähnungen sind nur in einer internen Notiz möglich.",
    );
  const people = [
    ...new Set(
      action.mentionedUserIds.map((entry) =>
        isUuid(entry) ? entry.toLowerCase() : "",
      ),
    ),
  ]
    .filter(Boolean)
    .filter((entry) => entry !== actorId);
  if (people.length < 1)
    throw new HttpError(
      400,
      "invalid_request",
      "Es muss eine andere aktive Person erwähnt werden.",
    );
  for (const person of people)
    await activeMember(admin, action.tenantId, person);
  const rows = people.map((mentioned_user_id) => ({
    tenant_id: action.tenantId,
    ticket_id: info.id,
    comment_id: action.commentId,
    mentioned_user_id,
    author_id: actorId,
  }));
  const result = await admin
    .from("ticket_mentions")
    .upsert(rows, {
      onConflict: "comment_id,mentioned_user_id",
      ignoreDuplicates: true,
    })
    .select("id, mentioned_user_id, created_at");
  if (result.error) db(result.error);
  await audit(
    admin,
    action.tenantId,
    actorId,
    "agent.mentions.created",
    "ticket",
    info.id as string,
    { commentId: action.commentId, count: people.length },
  );
  return reply(request, { data: { mentions: result.data ?? [] } }, 201);
}
async function listDelegations(
  request: Request,
  client: Client,
  admin: Admin,
  action: Action,
  actorId: string,
): Promise<Response> {
  const target =
    action.agentId === undefined
      ? actorId
      : await activeMember(admin, action.tenantId, action.agentId);
  if (target !== actorId)
    await tenantPermission(client, action.tenantId, "ticket.manage");
  const { data, error } = await admin
    .from("agent_delegations")
    .select(
      "id, agent_id, delegate_id, starts_at, ends_at, ended_at, note, created_at, updated_at",
    )
    .eq("tenant_id", action.tenantId)
    .eq("agent_id", target)
    .order("starts_at", { ascending: false })
    .limit(200);
  if (error) db(error);
  return reply(request, { data: { delegations: data ?? [] } });
}
async function saveDelegation(
  request: Request,
  client: Client,
  admin: Admin,
  action: Action,
  actorId: string,
): Promise<Response> {
  const agentId =
    action.agentId === undefined
      ? actorId
      : await activeMember(admin, action.tenantId, action.agentId);
  if (agentId !== actorId)
    await tenantPermission(client, action.tenantId, "ticket.manage");
  const delegateId = await activeMember(
    admin,
    action.tenantId,
    action.delegateId,
  );
  const startsAt = timestamp(action.startsAt);
  const endsAt = timestamp(action.endsAt);
  const note = optionalText(action.note, 2000);
  if (
    !startsAt ||
    !endsAt ||
    Date.parse(endsAt) <= Date.parse(startsAt) ||
    note === undefined ||
    agentId === delegateId
  )
    throw new HttpError(
      400,
      "invalid_request",
      "Die Stellvertretungsangaben sind ungültig.",
    );
  const values = {
    tenant_id: action.tenantId,
    agent_id: agentId,
    delegate_id: delegateId,
    starts_at: startsAt,
    ends_at: endsAt,
    note,
    created_by: actorId,
  };
  const result = isUuid(action.delegationId)
    ? await admin
        .from("agent_delegations")
        .update({
          delegate_id: delegateId,
          starts_at: startsAt,
          ends_at: endsAt,
          note,
        })
        .eq("tenant_id", action.tenantId)
        .eq("id", action.delegationId)
        .select("id, agent_id, delegate_id, starts_at, ends_at, ended_at, note")
        .maybeSingle()
    : await admin
        .from("agent_delegations")
        .insert(values)
        .select("id, agent_id, delegate_id, starts_at, ends_at, ended_at, note")
        .single();
  if (result.error) db(result.error);
  if (!result.data)
    throw new HttpError(
      404,
      "delegation_not_found",
      "Die Stellvertretung ist nicht verfügbar.",
    );
  await audit(
    admin,
    action.tenantId,
    actorId,
    "agent.delegation.saved",
    "agent_delegation",
    result.data.id as string,
  );
  return reply(
    request,
    { data: { delegation: result.data } },
    isUuid(action.delegationId) ? 200 : 201,
  );
}
async function endDelegation(
  request: Request,
  client: Client,
  admin: Admin,
  action: Action,
  actorId: string,
): Promise<Response> {
  if (!isUuid(action.delegationId))
    throw new HttpError(
      400,
      "invalid_request",
      "Die Stellvertretungs-ID ist ungültig.",
    );
  const current = await admin
    .from("agent_delegations")
    .select("id, agent_id, ended_at")
    .eq("tenant_id", action.tenantId)
    .eq("id", action.delegationId)
    .maybeSingle();
  if (current.error) db(current.error);
  if (!current.data)
    throw new HttpError(
      404,
      "delegation_not_found",
      "Die Stellvertretung ist nicht verfügbar.",
    );
  if (current.data.agent_id !== actorId)
    await tenantPermission(client, action.tenantId, "ticket.manage");
  const result =
    current.data.ended_at === null
      ? await admin
          .from("agent_delegations")
          .update({ ended_at: new Date().toISOString() })
          .eq("tenant_id", action.tenantId)
          .eq("id", action.delegationId)
          .select("id, ended_at")
          .single()
      : { data: current.data, error: null };
  if (result.error) db(result.error);
  if (current.data.ended_at === null)
    await audit(
      admin,
      action.tenantId,
      actorId,
      "agent.delegation.ended",
      "agent_delegation",
      action.delegationId,
    );
  return reply(request, {
    data: { delegation: result.data, changed: current.data.ended_at === null },
  });
}

async function suggestAssignees(
  request: Request,
  client: Client,
  admin: Admin,
  action: Action,
): Promise<Response> {
  const info = await ticket(admin, action.tenantId, action.ticketId);
  await ticketPermission(client, info, "ticket.update");
  const candidates = await admin
    .from("department_memberships")
    .select("user_id")
    .eq("tenant_id", action.tenantId)
    .eq("department_id", info.department_id as string)
    .eq("status", "active");
  if (candidates.error) db(candidates.error);
  const ids = [
    ...new Set(
      (candidates.data ?? []).map((row) => row.user_id).filter(isUuid),
    ),
  ];
  const now = new Date().toISOString();
  const result: Row[] = [];
  for (const userId of ids) {
    const open = await admin
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", action.tenantId)
      .eq("assigned_agent_id", userId)
      .is("closed_at", null);
    const experience = info.category_id
      ? await admin
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", action.tenantId)
          .eq("assigned_agent_id", userId)
          .eq("category_id", info.category_id as string)
      : { count: 0, error: null };
    const absence = await admin
      .from("agent_delegations")
      .select("delegate_id")
      .eq("tenant_id", action.tenantId)
      .eq("agent_id", userId)
      .is("ended_at", null)
      .lte("starts_at", now)
      .gte("ends_at", now)
      .limit(1);
    if (open.error) db(open.error);
    if (experience.error) db(experience.error);
    if (absence.error) db(absence.error);
    const workload = open.count ?? 0;
    const categoryExperience = experience.count ?? 0;
    const delegated = (absence.data ?? []).length > 0;
    result.push({
      userId,
      score: Math.max(
        0,
        100 - workload * 10 + categoryExperience * 5 - (delegated ? 35 : 0),
      ),
      reasons: [
        `${workload} offene Tickets`,
        `${categoryExperience} Tickets in derselben Kategorie`,
        delegated
          ? "Aktuell als abwesend/stelligvertreten erfasst"
          : "Keine aktuelle Abwesenheit erfasst",
      ],
      automaticAssignment: false,
    });
  }
  result.sort((left, right) => Number(right.score) - Number(left.score));
  return reply(request, {
    data: {
      suggestions: result.slice(0, 20),
      notice:
        "Dies sind erklärbare Vorschläge. Es wird keine Zuweisung vorgenommen.",
    },
  });
}
async function teamQueues(
  request: Request,
  client: Client,
  action: Action,
): Promise<Response> {
  const { data, error } = await client
    .from("tickets")
    .select(
      "department_id, assigned_team_id, status_id, ticket_statuses!inner(is_closed)",
    )
    .eq("tenant_id", action.tenantId)
    .is("closed_at", null)
    .limit(5000);
  if (error) db(error);
  const counts = new Map<string, number>();
  for (const entry of data ?? []) {
    const row = entry as Row;
    const status = row.ticket_statuses;
    const closed = isRecord(status) && status.is_closed === true;
    if (closed) continue;
    const key = `${typeof row.department_id === "string" ? row.department_id : ""}:${typeof row.assigned_team_id === "string" ? row.assigned_team_id : "unassigned"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return reply(request, {
    data: {
      queues: [...counts.entries()].map(([key, openTickets]) => {
        const [departmentId, teamId] = key.split(":");
        return {
          departmentId,
          teamId: teamId === "unassigned" ? null : teamId,
          openTickets,
        };
      }),
    },
  });
}
async function myMetrics(
  request: Request,
  admin: Admin,
  action: Action,
  actorId: string,
): Promise<Response> {
  const rows = await admin
    .from("tickets")
    .select("id, created_at, first_responded_at, resolved_at")
    .eq("tenant_id", action.tenantId)
    .eq("assigned_agent_id", actorId)
    .limit(5000);
  if (rows.error) db(rows.error);
  const today = new Date().toISOString().slice(0, 10);
  const responseMinutes: number[] = [];
  let open = 0;
  let solvedToday = 0;
  for (const entry of rows.data ?? []) {
    if (entry.resolved_at === null) open += 1;
    if (
      typeof entry.resolved_at === "string" &&
      entry.resolved_at.slice(0, 10) === today
    )
      solvedToday += 1;
    if (
      typeof entry.created_at === "string" &&
      typeof entry.first_responded_at === "string"
    )
      responseMinutes.push(
        (Date.parse(entry.first_responded_at) - Date.parse(entry.created_at)) /
          60000,
      );
  }
  responseMinutes.sort((a, b) => a - b);
  const median = responseMinutes.length
    ? responseMinutes[Math.floor(responseMinutes.length / 2)]
    : null;
  const due = await admin
    .from("experience_follow_ups")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", action.tenantId)
    .eq("owner_id", actorId)
    .is("resolved_at", null)
    .lte("due_at", new Date().toISOString());
  if (due.error) db(due.error);
  return reply(request, {
    data: {
      metrics: {
        open,
        solvedToday,
        medianFirstResponseMinutes: median,
        dueFollowUps: due.count ?? 0,
      },
    },
  });
}
async function ticketContext(
  request: Request,
  client: Client,
  admin: Admin,
  action: Action,
): Promise<Response> {
  const info = await ticket(admin, action.tenantId, action.ticketId);
  await ticketPermission(client, info, "ticket.read.department");
  const related = await admin
    .from("tickets")
    .select("id, ticket_number, subject, resolved_at, created_at")
    .eq("tenant_id", action.tenantId)
    .eq("requester_id", info.requester_id as string)
    .neq("id", info.id as string)
    .order("created_at", { ascending: false })
    .limit(20);
  const links = await admin
    .from("ticket_assets")
    .select("asset_id")
    .eq("tenant_id", action.tenantId)
    .eq("ticket_id", info.id as string)
    .limit(100);
  if (related.error) db(related.error);
  if (links.error) db(links.error);
  const assetIds = (links.data ?? [])
    .map((entry) => entry.asset_id)
    .filter(isUuid);
  const assets = assetIds.length
    ? await admin
        .from("assets")
        .select("id, name, asset_tag, lifecycle_state")
        .eq("tenant_id", action.tenantId)
        .in("id", assetIds)
    : { data: [], error: null };
  const history = assetIds.length
    ? await admin
        .from("asset_lifecycle_events")
        .select("asset_id, previous_state, next_state, reason, occurred_at")
        .eq("tenant_id", action.tenantId)
        .in("asset_id", assetIds)
        .order("occurred_at", { ascending: false })
        .limit(200)
    : { data: [], error: null };
  const confirmations = await admin
    .from("ticket_resolution_confirmations")
    .select("id, confirmed, comment, confirmed_at")
    .eq("tenant_id", action.tenantId)
    .eq("ticket_id", info.id as string)
    .order("confirmed_at", { ascending: false })
    .limit(20);
  if (assets.error) db(assets.error);
  if (history.error) db(history.error);
  if (confirmations.error) db(confirmations.error);
  return reply(request, {
    data: {
      ticket: info,
      requesterTickets: related.data ?? [],
      assets: assets.data ?? [],
      assetHistory: history.data ?? [],
      resolutionConfirmations: confirmations.data ?? [],
    },
  });
}
async function knowledgeDraftFromTicket(
  request: Request,
  client: Client,
  admin: Admin,
  action: Action,
  actorId: string,
): Promise<Response> {
  const knowledgeFlags = await resolveTenantFeatureStates(
    admin,
    action.tenantId,
    ["knowledge.base"],
  );
  if (!knowledgeFlags)
    throw new HttpError(
      503,
      "tenant_feature_lookup_failed",
      "Die Funktionsfreigabe konnte nicht geprüft werden.",
    );
  if (!knowledgeFlags["knowledge.base"])
    throw new HttpError(
      403,
      "knowledge_base_feature_disabled",
      "Die Wissensbasis ist für diesen Mandanten deaktiviert.",
    );
  const info = await ticket(admin, action.tenantId, action.ticketId);
  await ticketPermission(client, info, "ticket.update");
  await tenantPermission(client, action.tenantId, "knowledge.manage");
  const title = text(
    action.title ?? `Entwurf: ${info.subject ?? "Ticket"}`,
    3,
    240,
  );
  const body = text(action.body ?? info.description, 1, 50000);
  if (!title || !body)
    throw new HttpError(
      400,
      "invalid_request",
      "Titel und Inhalt für den Wissensentwurf sind ungültig.",
    );
  const slug = `ticket-${String(info.ticket_number ?? info.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${Date.now()}`.slice(0, 180);
  const article = await admin
    .from("knowledge_articles")
    .insert({
      tenant_id: action.tenantId,
      title,
      slug,
      visibility: "internal",
      status: "review",
      current_revision: 1,
      created_by: actorId,
      review_requested_at: new Date().toISOString(),
      review_requested_by: actorId,
    })
    .select("id, title, slug, status, current_revision")
    .single();
  if (article.error) db(article.error);
  const revision = await admin.from("knowledge_article_revisions").insert({
    article_id: article.data.id,
    revision: 1,
    body,
    author_id: actorId,
  });
  if (revision.error) db(revision.error);
  const review = await admin.from("knowledge_article_reviews").insert({
    tenant_id: action.tenantId,
    article_id: article.data.id,
    revision: 1,
    requested_by: actorId,
  });
  if (review.error) db(review.error);
  await audit(
    admin,
    action.tenantId,
    actorId,
    "knowledge.article.draft_from_ticket",
    "knowledge_article",
    article.data.id,
    { ticketId: info.id as string },
  );
  return reply(
    request,
    {
      data: { article: article.data, reviewRequested: true, published: false },
    },
    201,
  );
}
async function listIncidentNotices(
  request: Request,
  admin: Admin,
  action: Action,
): Promise<Response> {
  const { data, error } = await admin
    .from("service_incident_notices")
    .select(
      "id, title, description, status, category_id, department_id, starts_at, resolved_at, created_at, updated_at",
    )
    .eq("tenant_id", action.tenantId)
    .order("starts_at", { ascending: false })
    .limit(200);
  if (error) db(error);
  return reply(request, { data: { notices: data ?? [] } });
}
async function saveIncidentNotice(
  request: Request,
  client: Client,
  admin: Admin,
  action: Action,
  actorId: string,
): Promise<Response> {
  await tenantPermission(client, action.tenantId, "ticket.manage");
  const title = text(action.title, 3, 240);
  const description = text(action.description, 3, 10000);
  const status = action.status;
  const startsAt =
    action.startsAt === undefined
      ? new Date().toISOString()
      : timestamp(action.startsAt);
  const categoryId = nullableUuid(action.categoryId);
  const departmentId = nullableUuid(action.departmentId);
  if (
    !title ||
    !description ||
    !startsAt ||
    !["investigating", "identified", "monitoring", "resolved"].includes(
      String(status),
    ) ||
    categoryId === undefined ||
    departmentId === undefined
  )
    throw new HttpError(
      400,
      "invalid_request",
      "Die Störungsmeldung ist ungültig.",
    );
  const values = {
    tenant_id: action.tenantId,
    title,
    description,
    status,
    starts_at: startsAt,
    category_id: categoryId,
    department_id: departmentId,
    resolved_at: status === "resolved" ? new Date().toISOString() : null,
    updated_by: actorId,
  };
  const result = isUuid(action.noticeId)
    ? await admin
        .from("service_incident_notices")
        .update(values)
        .eq("tenant_id", action.tenantId)
        .eq("id", action.noticeId)
        .select("id, title, description, status, starts_at, resolved_at")
        .maybeSingle()
    : await admin
        .from("service_incident_notices")
        .insert({ ...values, created_by: actorId })
        .select("id, title, description, status, starts_at, resolved_at")
        .single();
  if (result.error) db(result.error);
  if (!result.data)
    throw new HttpError(
      404,
      "incident_notice_not_found",
      "Die Störungsmeldung ist nicht verfügbar.",
    );
  await audit(
    admin,
    action.tenantId,
    actorId,
    "service.incident_notice.saved",
    "service_incident_notice",
    result.data.id as string,
  );
  return reply(
    request,
    { data: { notice: result.data } },
    isUuid(action.noticeId) ? 200 : 201,
  );
}
async function listReopenRequests(
  request: Request,
  client: Client,
  action: Action,
): Promise<Response> {
  const { data, error } = await client
    .from("ticket_reopen_requests")
    .select(
      "id, ticket_id, requested_by, reason, status, decided_by, decided_at, created_at",
    )
    .eq("tenant_id", action.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) db(error);
  return reply(request, { data: { reopenRequests: data ?? [] } });
}
async function decideReopenRequest(
  request: Request,
  client: Client,
  admin: Admin,
  action: Action,
  actorId: string,
): Promise<Response> {
  if (
    !isUuid(action.reopenRequestId) ||
    (action.decision !== "accepted" && action.decision !== "declined")
  )
    throw new HttpError(
      400,
      "invalid_request",
      "Die Wiedereröffnungsentscheidung ist ungültig.",
    );
  const current = await admin
    .from("ticket_reopen_requests")
    .select("id, ticket_id, status")
    .eq("tenant_id", action.tenantId)
    .eq("id", action.reopenRequestId)
    .maybeSingle();
  if (current.error) db(current.error);
  if (!current.data)
    throw new HttpError(
      404,
      "reopen_request_not_found",
      "Die Wiedereröffnungsanfrage ist nicht verfügbar.",
    );
  if (current.data.status !== "pending")
    throw new HttpError(
      409,
      "reopen_request_already_decided",
      "Die Wiedereröffnungsanfrage wurde bereits entschieden.",
    );
  const info = await ticket(admin, action.tenantId, current.data.ticket_id);
  await ticketPermission(client, info, "ticket.update");
  const result = await admin
    .from("ticket_reopen_requests")
    .update({
      status: action.decision,
      decided_by: actorId,
      decided_at: new Date().toISOString(),
    })
    .eq("tenant_id", action.tenantId)
    .eq("id", current.data.id)
    .eq("status", "pending")
    .select("id, ticket_id, status, decided_by, decided_at")
    .maybeSingle();
  if (result.error) db(result.error);
  if (!result.data)
    throw new HttpError(
      409,
      "reopen_request_changed_concurrently",
      "Die Wiedereröffnungsanfrage wurde zwischenzeitlich geändert.",
    );
  await audit(
    admin,
    action.tenantId,
    actorId,
    "ticket.reopen_request.decided",
    "ticket_reopen_request",
    current.data.id,
    { decision: action.decision },
  );
  return reply(request, {
    data: {
      reopenRequest: result.data,
      ticketReopened: false,
      notice: "Die Entscheidung ändert den Ticketstatus nicht automatisch.",
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
      const action = parseAction(await request.json().catch(() => null));
      if (!action)
        throw new HttpError(
          400,
          "invalid_request",
          "Die Anfrage enthält ungültige oder unbekannte Felder.",
        );
      const client = context.supabase;
      const admin = context.supabaseAdmin;
      await requireBase(client, admin, action.tenantId);
      if (action.type === "listMacros")
        return await listMacros(request, client, admin, action);
      if (action.type === "saveMacro")
        return await saveMacro(request, client, admin, action, actorId);
      if (action.type === "previewMacro")
        return await previewMacro(request, client, admin, action);
      if (action.type === "listMentions")
        return await listMentions(request, client, action, actorId);
      if (action.type === "markMentionRead")
        return await markMentionRead(request, admin, action, actorId);
      if (action.type === "createMentions")
        return await createMentions(request, client, admin, action, actorId);
      if (action.type === "listDelegations")
        return await listDelegations(request, client, admin, action, actorId);
      if (action.type === "saveDelegation")
        return await saveDelegation(request, client, admin, action, actorId);
      if (action.type === "endDelegation")
        return await endDelegation(request, client, admin, action, actorId);
      if (action.type === "suggestAssignees")
        return await suggestAssignees(request, client, admin, action);
      if (action.type === "teamQueues")
        return await teamQueues(request, client, action);
      if (action.type === "myMetrics")
        return await myMetrics(request, admin, action, actorId);
      if (action.type === "ticketContext")
        return await ticketContext(request, client, admin, action);
      if (action.type === "knowledgeDraftFromTicket")
        return await knowledgeDraftFromTicket(
          request,
          client,
          admin,
          action,
          actorId,
        );
      if (action.type === "listIncidentNotices")
        return await listIncidentNotices(request, admin, action);
      if (action.type === "saveIncidentNotice")
        return await saveIncidentNotice(
          request,
          client,
          admin,
          action,
          actorId,
        );
      if (action.type === "listReopenRequests")
        return await listReopenRequests(request, client, action);
      return await decideReopenRequest(request, client, admin, action, actorId);
    } catch (error) {
      return fail(
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
      return fail(
        request,
        new HttpError(
          403,
          "origin_not_allowed",
          "Dieser Ursprung ist nicht erlaubt.",
        ),
      );
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN)
        return fail(
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
      return fail(
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
      return fail(
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
        headers: headers(request),
      });
    } catch (error) {
      return fail(
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
