import { type SupabaseContext, withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const FEATURE = "agent.workbench";
const MAX_BYTES = 64 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;
type Client = SupabaseContext["supabase"];
type Admin = SupabaseContext["supabaseAdmin"];
type Action =
  | { type: "listRoutes"; tenantId: string }
  | {
      type: "saveRoute";
      tenantId: string;
      departmentId: string;
      primaryUserId: string;
      backupUserId: string | null;
    }
  | { type: "ticketContext"; tenantId: string; ticketId: string }
  | { type: "ask"; tenantId: string; ticketId: string; question: string }
  | { type: "answer"; tenantId: string; questionId: string; answer: string };

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
  typeof value === "string" && UUID.test(value);
function text(value: unknown, min: number, max: number): string | null {
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    !value.isWellFormed()
  )
    return null;
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  return length >= min && length <= max ? normalized : null;
}
function parseAction(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    !isUuid(value.tenantId)
  )
    return null;
  const tenantId = value.tenantId.toLowerCase();
  if (
    value.type === "listRoutes" &&
    Object.keys(value).every((key) => key === "type" || key === "tenantId")
  )
    return { type: "listRoutes", tenantId };
  if (
    value.type === "saveRoute" &&
    Object.keys(value).every((key) =>
      [
        "type",
        "tenantId",
        "departmentId",
        "primaryUserId",
        "backupUserId",
      ].includes(key),
    ) &&
    isUuid(value.departmentId) &&
    isUuid(value.primaryUserId) &&
    (value.backupUserId === null || isUuid(value.backupUserId))
  )
    return {
      type: "saveRoute",
      tenantId,
      departmentId: value.departmentId.toLowerCase(),
      primaryUserId: value.primaryUserId.toLowerCase(),
      backupUserId:
        typeof value.backupUserId === "string"
          ? value.backupUserId.toLowerCase()
          : null,
    };
  if (
    value.type === "ticketContext" &&
    Object.keys(value).every(
      (key) => key === "type" || key === "tenantId" || key === "ticketId",
    ) &&
    isUuid(value.ticketId)
  )
    return {
      type: "ticketContext",
      tenantId,
      ticketId: value.ticketId.toLowerCase(),
    };
  if (
    value.type === "ask" &&
    Object.keys(value).every((key) =>
      ["type", "tenantId", "ticketId", "question"].includes(key),
    ) &&
    isUuid(value.ticketId)
  ) {
    const question = text(value.question, 3, 3000);
    return question
      ? {
          type: "ask",
          tenantId,
          ticketId: value.ticketId.toLowerCase(),
          question,
        }
      : null;
  }
  if (
    value.type === "answer" &&
    Object.keys(value).every((key) =>
      ["type", "tenantId", "questionId", "answer"].includes(key),
    ) &&
    isUuid(value.questionId)
  ) {
    const answer = text(value.answer, 1, 5000);
    return answer
      ? {
          type: "answer",
          tenantId,
          questionId: value.questionId.toLowerCase(),
          answer,
        }
      : null;
  }
  return null;
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
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}
function failure(request: Request, error: HttpError): Response {
  return reply(
    request,
    { error: { code: error.code, message: error.message } },
    error.status,
  );
}
function db(error: { code?: unknown; message?: unknown } | null): never {
  const message = typeof error?.message === "string" ? error.message : "";
  if (message.includes("department_question_recipient_missing"))
    throw new HttpError(
      409,
      "department_lead_missing",
      "Für diese Abteilung ist noch keine gültige Abteilungsleitung hinterlegt.",
    );
  if (message.includes("department_question_assigned_agent_required"))
    throw new HttpError(
      403,
      "assigned_agent_required",
      "Nur die aktuell zugewiesene Agentin oder der aktuell zugewiesene Agent kann eine Rückfrage stellen.",
    );
  if (message.includes("department_question_answer_forbidden"))
    throw new HttpError(
      403,
      "department_question_answer_forbidden",
      "Nur die konkret adressierte Abteilungsleitung kann diese Rückfrage beantworten.",
    );
  if (message.includes("department_question_already_answered"))
    throw new HttpError(
      409,
      "department_question_already_answered",
      "Diese Rückfrage wurde bereits beantwortet.",
    );
  if (message.includes("department_question_primary_invalid"))
    throw new HttpError(
      422,
      "department_lead_invalid",
      "Die gewählte Abteilungsleitung muss aktiv sein, der Abteilung angehören und Tickets der Abteilung sehen dürfen.",
    );
  if (message.includes("department_question_backup_invalid"))
    throw new HttpError(
      422,
      "department_backup_invalid",
      "Die gewählte Stellvertretung muss aktiv sein, der Abteilung angehören und Tickets der Abteilung sehen dürfen.",
    );
  if (message.includes("department_question_route_forbidden"))
    throw new HttpError(
      403,
      "department_route_forbidden",
      "Nur Personen mit Mandantenberechtigung für Abteilungen können die Abteilungsleitung festlegen.",
    );
  const code = typeof error?.code === "string" ? error.code : "";
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code))
    throw new HttpError(
      503,
      "department_questions_not_configured",
      "Abteilungsrückfragen sind noch nicht bereitgestellt.",
    );
  if (code === "42501")
    throw new HttpError(
      403,
      "permission_denied",
      "Für diese Aktion fehlt die Berechtigung.",
    );
  if (["22023", "23503", "23514", "22001"].includes(code))
    throw new HttpError(
      422,
      "invalid_data",
      "Die Angaben sind nicht zulässig.",
    );
  throw new HttpError(
    500,
    "operation_failed",
    "Die Aktion konnte nicht abgeschlossen werden.",
  );
}
async function rpcBoolean(
  client: Client,
  name: string,
  args: Row,
): Promise<boolean> {
  const { data, error } = await client.rpc(name, args);
  if (error || typeof data !== "boolean")
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  return data;
}
async function requireMember(client: Client, tenantId: string): Promise<void> {
  if (
    !(await rpcBoolean(client, "is_active_tenant_member", {
      p_tenant_id: tenantId,
    }))
  )
    throw new HttpError(
      403,
      "tenant_membership_required",
      "Eine aktive Mandantenmitgliedschaft ist erforderlich.",
    );
}
async function requireWorkbench(admin: Admin, tenantId: string): Promise<void> {
  const flags = await resolveTenantFeatureStates(admin, tenantId, [FEATURE]);
  if (!flags)
    throw new HttpError(
      503,
      "tenant_feature_lookup_failed",
      "Die Funktionsfreigabe konnte nicht geprüft werden.",
    );
  if (!flags[FEATURE])
    throw new HttpError(
      403,
      "department_questions_feature_disabled",
      "Die Agentenwerkbank ist für diesen Mandanten deaktiviert.",
    );
}
async function requireTenantDepartmentAdmin(
  client: Client,
  tenantId: string,
): Promise<void> {
  if (
    !(await rpcBoolean(client, "has_tenant_permission", {
      p_tenant_id: tenantId,
      p_permission_code: "department.manage",
    }))
  )
    throw new HttpError(
      403,
      "department_route_forbidden",
      "Für diese Verwaltungsaktion fehlt die Mandantenberechtigung.",
    );
}
async function ticket(
  admin: Admin,
  tenantId: string,
  ticketId: string,
): Promise<any> {
  const result = await admin
    .from("tickets")
    .select(
      "id, tenant_id, department_id, assigned_agent_id, ticket_number, subject",
    )
    .eq("tenant_id", tenantId)
    .eq("id", ticketId)
    .maybeSingle();
  if (result.error) db(result.error);
  if (!result.data)
    throw new HttpError(
      404,
      "ticket_not_available",
      "Das Ticket ist nicht verfügbar.",
    );
  return result.data;
}
async function canReadTicket(client: Client, info: any): Promise<boolean> {
  const args = {
    p_tenant_id: info.tenant_id,
    p_department_id: info.department_id,
  };
  if (
    await rpcBoolean(client, "has_ticket_permission", {
      ...args,
      p_permission_code: "ticket.read.department",
    })
  )
    return true;
  return rpcBoolean(client, "has_ticket_permission", {
    ...args,
    p_permission_code: "ticket.read.assigned",
  });
}
async function displayNames(
  admin: Admin,
  ids: string[],
): Promise<Map<string, string | null>> {
  const distinct = [...new Set(ids.filter(isUuid))];
  if (!distinct.length) return new Map();
  const result = await admin
    .from("user_profiles")
    .select("id, display_name")
    .in("id", distinct);
  if (result.error) db(result.error);
  return new Map(
    (result.data ?? []).map((row: any) => [
      row.id,
      typeof row.display_name === "string" ? row.display_name : null,
    ]),
  );
}
async function listRoutes(
  request: Request,
  client: Client,
  admin: Admin,
  action: Extract<Action, { type: "listRoutes" }>,
): Promise<Response> {
  await requireTenantDepartmentAdmin(client, action.tenantId);
  const departments = await admin
    .from("departments")
    .select("id, name, key")
    .eq("tenant_id", action.tenantId)
    .eq("active", true)
    .order("name");
  if (departments.error) db(departments.error);
  const routes = await admin
    .from("department_question_routes")
    .select("department_id, primary_user_id, backup_user_id, updated_at")
    .eq("tenant_id", action.tenantId);
  if (routes.error) db(routes.error);
  const members = await admin
    .from("department_memberships")
    .select("department_id, user_id")
    .in(
      "department_id",
      (departments.data ?? []).map((department: any) => department.id),
    )
    .eq("status", "active");
  if (members.error) db(members.error);
  const candidateIds = (members.data ?? [])
    .map((member: any) => member.user_id)
    .filter(isUuid);
  const names = await displayNames(admin, candidateIds);
  const routeByDepartment = new Map(
    (routes.data ?? []).map((route: any) => [route.department_id, route]),
  );
  const candidatesByDepartment = new Map<
    string,
    { userId: string; displayName: string | null }[]
  >();
  for (const member of members.data ?? []) {
    if (!isUuid(member.department_id) || !isUuid(member.user_id)) continue;
    const valid = await admin.rpc("is_department_question_route_candidate", {
      p_tenant_id: action.tenantId,
      p_department_id: member.department_id,
      p_user_id: member.user_id,
    });
    if (valid.error) db(valid.error);
    if (valid.data !== true) continue;
    candidatesByDepartment.set(member.department_id, [
      ...(candidatesByDepartment.get(member.department_id) ?? []),
      {
        userId: member.user_id,
        displayName: names.get(member.user_id) ?? null,
      },
    ]);
  }
  return reply(request, {
    data: {
      routes: (departments.data ?? []).map((department: any) => {
        const route = routeByDepartment.get(department.id) as any;
        return {
          department: {
            id: department.id,
            name: department.name,
            key: department.key,
          },
          primaryUserId: route?.primary_user_id ?? null,
          backupUserId: route?.backup_user_id ?? null,
          updatedAt: route?.updated_at ?? null,
          candidates: (candidatesByDepartment.get(department.id) ?? []).sort(
            (left, right) =>
              (left.displayName ?? "").localeCompare(
                right.displayName ?? "",
                "de-CH",
              ),
          ),
        };
      }),
    },
  });
}
async function queueInternalMail(input: {
  admin: Admin;
  tenantId: string;
  ticket: any;
  questionId: string;
  recipientUserId: string | null;
  kind: "department_question" | "department_answer";
}): Promise<boolean> {
  if (!input.recipientUserId) return false;
  const flags = await resolveTenantFeatureStates(input.admin, input.tenantId, [
    "integrations.email",
  ]);
  if (!flags?.["integrations.email"]) return false;
  const channel = await input.admin
    .from("exchange_mail_channels")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("status", "active")
    .maybeSingle();
  if (channel.error || !channel.data) return false;
  const user = await input.admin.auth.admin.getUserById(input.recipientUserId);
  const address = user.data.user?.email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(address)) return false;
  const inserted = await input.admin.from("mail_messages").insert({
    tenant_id: input.tenantId,
    channel_id: channel.data.id,
    direction: "outbound",
    kind: input.kind,
    ticket_id: input.ticket.id,
    department_question_id: input.questionId,
    recipient_user_id: input.recipientUserId,
    to_addresses: [address],
    subject: `[${input.ticket.ticket_number}] ${input.ticket.subject ?? "Ticket"}`,
  });
  return !inserted.error;
}
async function ticketContext(
  request: Request,
  client: Client,
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "ticketContext" }>,
): Promise<Response> {
  const info = await ticket(admin, action.tenantId, action.ticketId);
  if (!(await canReadTicket(client, info)))
    throw new HttpError(
      403,
      "ticket_permission_required",
      "Für dieses Ticket fehlt die Berechtigung.",
    );
  const route = await admin
    .from("department_question_routes")
    .select("primary_user_id, backup_user_id")
    .eq("tenant_id", action.tenantId)
    .eq("department_id", info.department_id)
    .maybeSingle();
  if (route.error) db(route.error);
  const department = await admin
    .from("departments")
    .select("id, name")
    .eq("tenant_id", action.tenantId)
    .eq("id", info.department_id)
    .maybeSingle();
  if (department.error || !department.data) db(department.error);
  const questions = await admin
    .from("ticket_department_questions")
    .select(
      "id, ticket_id, department_id, asked_by, recipient_user_id, question, status, answer, answered_by, answered_at, created_at",
    )
    .eq("tenant_id", action.tenantId)
    .eq("ticket_id", info.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (questions.error) db(questions.error);
  const ids = [
    route.data?.primary_user_id,
    route.data?.backup_user_id,
    ...(questions.data ?? []).flatMap((question: any) => [
      question.asked_by,
      question.recipient_user_id,
      question.answered_by,
    ]),
  ].filter(isUuid);
  const names = await displayNames(admin, ids);
  const canAsk =
    info.assigned_agent_id === actorId &&
    (await rpcBoolean(client, "has_ticket_permission", {
      p_tenant_id: action.tenantId,
      p_department_id: info.department_id,
      p_permission_code: "ticket.update",
    }));
  const recipient = await admin.rpc("department_question_recipient", {
    p_tenant_id: action.tenantId,
    p_department_id: info.department_id,
  });
  if (recipient.error) db(recipient.error);
  const open = (questions.data ?? []).filter(
    (question: any) => question.status === "open",
  ).length;
  return reply(request, {
    data: {
      department: department.data,
      route: {
        primaryUserId: route.data?.primary_user_id ?? null,
        primaryDisplayName: names.get(route.data?.primary_user_id) ?? null,
        backupUserId: route.data?.backup_user_id ?? null,
        backupDisplayName: names.get(route.data?.backup_user_id) ?? null,
        activeRecipientUserId: recipient.data ?? null,
        activeRecipientDisplayName: names.get(recipient.data) ?? null,
      },
      permissions: {
        canView: true,
        canAsk,
        canAnswer: (questions.data ?? []).some(
          (question: any) =>
            question.status === "open" &&
            question.recipient_user_id === actorId,
        ),
      },
      counts: { open, answered: (questions.data ?? []).length - open },
      questions: (questions.data ?? []).map((question: any) => ({
        ...question,
        askedByName: names.get(question.asked_by) ?? null,
        recipientName: names.get(question.recipient_user_id) ?? null,
        answeredByName: names.get(question.answered_by) ?? null,
        canAnswer:
          question.status === "open" && question.recipient_user_id === actorId,
      })),
    },
  });
}
async function ask(
  request: Request,
  client: Client,
  admin: Admin,
  action: Extract<Action, { type: "ask" }>,
): Promise<Response> {
  const result = await client.rpc("create_ticket_department_question", {
    p_tenant_id: action.tenantId,
    p_ticket_id: action.ticketId,
    p_question: action.question,
  });
  if (result.error) db(result.error);
  const question = Array.isArray(result.data) ? result.data[0] : null;
  if (!question || !isUuid(question.id) || !isUuid(question.recipient_user_id))
    throw new HttpError(
      503,
      "operation_failed",
      "Die Rückfrage konnte nicht sicher gespeichert werden.",
    );
  const info = await ticket(admin, action.tenantId, action.ticketId);
  const emailQueued = await queueInternalMail({
    admin,
    tenantId: action.tenantId,
    ticket: info,
    questionId: question.id,
    recipientUserId: question.recipient_user_id,
    kind: "department_question",
  });
  return reply(request, { data: { question, emailQueued } }, 201);
}
async function answer(
  request: Request,
  client: Client,
  admin: Admin,
  action: Extract<Action, { type: "answer" }>,
): Promise<Response> {
  const result = await client.rpc("answer_ticket_department_question", {
    p_tenant_id: action.tenantId,
    p_question_id: action.questionId,
    p_answer: action.answer,
  });
  if (result.error) db(result.error);
  const question = Array.isArray(result.data) ? result.data[0] : null;
  if (!question || !isUuid(question.ticket_id))
    throw new HttpError(
      503,
      "operation_failed",
      "Die Antwort konnte nicht sicher gespeichert werden.",
    );
  const info = await ticket(admin, action.tenantId, question.ticket_id);
  const emailQueued = await queueInternalMail({
    admin,
    tenantId: action.tenantId,
    ticket: info,
    questionId: question.id,
    recipientUserId: isUuid(question.assigned_agent_id)
      ? question.assigned_agent_id
      : null,
    kind: "department_answer",
  });
  return reply(request, {
    data: {
      question,
      emailQueued,
      agentNotified: isUuid(question.assigned_agent_id),
    },
  });
}
async function saveRoute(
  request: Request,
  client: Client,
  action: Extract<Action, { type: "saveRoute" }>,
): Promise<Response> {
  await requireTenantDepartmentAdmin(client, action.tenantId);
  const result = await client.rpc("configure_department_question_route", {
    p_tenant_id: action.tenantId,
    p_department_id: action.departmentId,
    p_primary_user_id: action.primaryUserId,
    p_backup_user_id: action.backupUserId,
  });
  if (result.error || result.data !== true) db(result.error);
  return reply(request, { data: { saved: true } });
}

const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers: headers(request) });
      if (request.method !== "POST")
        return new Response(null, { status: 405, headers: { Allow: "POST" } });
      const size = request.headers.get("content-length");
      if (size && (!/^\d+$/u.test(size) || Number(size) > MAX_BYTES))
        throw new HttpError(
          413,
          "request_too_large",
          "Die Anfrage ist zu gross.",
        );
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
          "Die Anfrage enthält ungültige Angaben.",
        );
      const client = context.supabase;
      const admin = context.supabaseAdmin;
      await requireMember(client, action.tenantId);
      if (action.type === "listRoutes")
        return await listRoutes(request, client, admin, action);
      if (action.type === "saveRoute")
        return await saveRoute(request, client, action);
      await requireWorkbench(admin, action.tenantId);
      if (action.type === "ticketContext")
        return await ticketContext(request, client, admin, actorId, action);
      if (action.type === "ask")
        return await ask(request, client, admin, action);
      return await answer(request, client, admin, action);
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

export default {
  async fetch(request: Request): Promise<Response> {
    return handler(request);
  },
};
