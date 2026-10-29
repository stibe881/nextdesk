import { type SupabaseContext, withSupabase } from "@supabase/server";
import {
  EVENT_SPACE_WORKSPACE_PAGE_SIZE,
  eventSpaceWorkspacePage,
} from "../_shared/event-space-pagination.ts";
import {
  eventSpaceEmailIntakeBodyFromStoredTicket,
  failEventSpaceEmailTicketIntake,
  processEventSpaceEmailTicketIntake,
} from "../_shared/event-space-email-ticket-intake.ts";
import {
  eventSpaceConflictSnapshot,
  type EventSpaceEquipment,
  type EventSpaceOccurrence,
  type EventSpaceRecurrence,
  isEventSpaceConflictSnapshot,
  overlaps,
  parseEventSpaceEquipment,
  parseEventSpaceOccurrences,
  summarizeEventSpaceConflicts,
} from "../_shared/event-space-schedule.ts";

const APP_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_CONFLICT_CANDIDATES = 500;

type CallerClient = SupabaseContext["supabase"];
type AdminClient = SupabaseContext["supabaseAdmin"];
type RequestStatus =
  | "planned"
  | "in_preparation"
  | "ready"
  | "conducted"
  | "completed"
  | "clarification_required";
type TaskStatus = "open" | "in_progress" | "completed";
type SpaceKind = "meeting_room" | "event_room" | "other";

type RequestInput = {
  tenantId: string;
  spaceId: string;
  title: string;
  organizer: string | null;
  expectedParticipants: number | null;
  responsibleUserId: string;
  equipmentKeys: EventSpaceEquipment[];
  recurrence: EventSpaceRecurrence;
  occurrences: EventSpaceOccurrence[];
};

type Action =
  | { type: "listWorkspace"; tenantId: string; offset: number }
  | { type: "navigationSummary"; tenantId: string }
  | ({ type: "previewConflicts" } & RequestInput)
  | ({
    type: "createRequest";
    confirmConflicts: boolean;
    conflictSnapshot: string | null;
  } & RequestInput)
  | {
    type: "createSpace";
    tenantId: string;
    name: string;
    kind: SpaceKind;
    location: string | null;
    capacity: number | null;
  }
  | {
    type: "updateRequestStatus";
    tenantId: string;
    requestId: string;
    status: RequestStatus;
  }
  | {
    type: "assignResponsible";
    tenantId: string;
    requestId: string;
    responsibleUserId: string;
  }
  | {
    type: "updateRequestDetails";
    tenantId: string;
    requestId: string;
    spaceId: string;
    responsibleUserId: string | null;
    organizer: string | null;
    startsAt: string;
    endsAt: string;
  }
  | {
    type: "assignAgent";
    tenantId: string;
    requestId: string;
    agentId: string | null;
  }
  | {
    type: "deleteRequest";
    tenantId: string;
    requestId: string;
  }
  | {
    type: "resolveEmailIntake";
    tenantId: string;
    requestId: string;
    spaceId: string;
    agentId: string;
    startsAt: string;
    endsAt: string;
  }
  | {
    type: "retryEmailTicketIntake";
    tenantId: string;
    ticketId: string;
  }
  | {
    type: "updateTaskStatus";
    tenantId: string;
    taskId: string;
    status: TaskStatus;
  };

type Row = Record<string, unknown>;
type DatabaseError = { code?: string };

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly data?: Record<string, unknown>,
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

function validText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !value.includes("\u0000") &&
    value.isWellFormed()
  );
}

function text(value: unknown, minimum: number, maximum: number): string | null {
  if (!validText(value)) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  const length = Array.from(normalized).length;
  return length >= minimum && length <= maximum ? normalized : null;
}

function nullableText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null | undefined {
  if (value === null || value === undefined) return null;
  return text(value, minimum, maximum) ?? undefined;
}

function optionalPositiveInteger(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 10000
    ? value
    : undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const known = new Set(keys);
  return Object.keys(value).every((key) => known.has(key));
}

function parseRequestInput(
  value: Record<string, unknown>,
): RequestInput | null {
  if (!isUuid(value.tenantId) || !isUuid(value.spaceId)) return null;
  const title = text(value.title, 3, 240);
  const organizer = nullableText(value.organizer, 2, 160);
  const expectedParticipants = optionalPositiveInteger(
    value.expectedParticipants,
  );
  const responsibleUserId = isUuid(value.responsibleUserId)
    ? value.responsibleUserId.toLowerCase()
    : undefined;
  const recurrence = value.recurrence;
  if (
    !title ||
    organizer === undefined ||
    expectedParticipants === undefined ||
    responsibleUserId === undefined ||
    (recurrence !== "none" &&
      recurrence !== "weekly" &&
      recurrence !== "monthly")
  ) {
    return null;
  }
  const occurrences = parseEventSpaceOccurrences(value.occurrences, recurrence);
  const equipmentKeys = parseEventSpaceEquipment(value.equipmentKeys);
  if (!occurrences || !equipmentKeys) return null;
  return {
    tenantId: value.tenantId.toLowerCase(),
    spaceId: value.spaceId.toLowerCase(),
    title,
    organizer,
    expectedParticipants,
    responsibleUserId,
    equipmentKeys,
    recurrence,
    occurrences,
  };
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "listWorkspace") {
    const offset = value.offset ?? 0;
    return isUuid(value.tenantId) &&
        Number.isInteger(offset) &&
        typeof offset === "number" &&
        offset >= 0 &&
        offset <= 100_000 &&
        hasOnlyKeys(value, ["type", "tenantId", "offset"])
      ? { type: value.type, tenantId: value.tenantId.toLowerCase(), offset }
      : null;
  }
  if (value.type === "navigationSummary") {
    return isUuid(value.tenantId) && hasOnlyKeys(value, ["type", "tenantId"])
      ? { type: value.type, tenantId: value.tenantId.toLowerCase() }
      : null;
  }
  if (value.type === "previewConflicts") {
    return hasOnlyKeys(value, [
        "type",
        "tenantId",
        "spaceId",
        "title",
        "organizer",
        "expectedParticipants",
        "responsibleUserId",
        "equipmentKeys",
        "recurrence",
        "occurrences",
      ])
      ? (() => {
        const input = parseRequestInput(value);
        return input ? { type: value.type, ...input } : null;
      })()
      : null;
  }
  if (value.type === "createRequest") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "tenantId",
        "spaceId",
        "title",
        "organizer",
        "expectedParticipants",
        "responsibleUserId",
        "equipmentKeys",
        "recurrence",
        "occurrences",
        "confirmConflicts",
        "conflictSnapshot",
      ]) ||
      typeof value.confirmConflicts !== "boolean"
    ) {
      return null;
    }
    const input = parseRequestInput(value);
    const conflictSnapshot = isEventSpaceConflictSnapshot(
        value.conflictSnapshot,
      )
      ? value.conflictSnapshot
      : null;
    return input
      ? value.confirmConflicts === (conflictSnapshot !== null)
        ? {
          type: value.type,
          confirmConflicts: value.confirmConflicts,
          conflictSnapshot,
          ...input,
        }
        : null
      : null;
  }
  if (value.type === "createSpace") {
    const name = text(value.name, 2, 160);
    const location = nullableText(value.location, 2, 240);
    const capacity = optionalPositiveInteger(value.capacity);
    return isUuid(value.tenantId) &&
        name !== null &&
        location !== undefined &&
        capacity !== undefined &&
        (value.kind === "meeting_room" ||
          value.kind === "event_room" ||
          value.kind === "other") &&
        hasOnlyKeys(value, [
          "type",
          "tenantId",
          "name",
          "kind",
          "location",
          "capacity",
        ])
      ? {
        type: value.type,
        tenantId: value.tenantId.toLowerCase(),
        name,
        kind: value.kind,
        location,
        capacity,
      }
      : null;
  }
  if (value.type === "updateRequestStatus") {
    return isUuid(value.tenantId) &&
        isUuid(value.requestId) &&
        ["planned", "in_preparation", "ready", "conducted", "completed"]
          .includes(
            String(value.status),
          ) &&
        hasOnlyKeys(value, ["type", "tenantId", "requestId", "status"])
      ? {
        type: value.type,
        tenantId: value.tenantId.toLowerCase(),
        requestId: value.requestId.toLowerCase(),
        status: value.status as RequestStatus,
      }
      : null;
  }
  if (value.type === "assignResponsible") {
    return isUuid(value.tenantId) &&
        isUuid(value.requestId) &&
        isUuid(value.responsibleUserId) &&
        hasOnlyKeys(value, [
          "type",
          "tenantId",
          "requestId",
          "responsibleUserId",
        ])
      ? {
        type: value.type,
        tenantId: value.tenantId.toLowerCase(),
        requestId: value.requestId.toLowerCase(),
        responsibleUserId: value.responsibleUserId.toLowerCase(),
      }
      : null;
  }
  if (value.type === "updateRequestDetails") {
    const occurrences = parseEventSpaceOccurrences(
      [{ startsAt: value.startsAt, endsAt: value.endsAt }],
      "none",
    );
    const organizer = nullableText(value.organizer, 2, 160);
    const responsibleUserId = value.responsibleUserId === null
      ? null
      : isUuid(value.responsibleUserId)
      ? value.responsibleUserId.toLowerCase()
      : undefined;
    return isUuid(value.tenantId) &&
        isUuid(value.requestId) &&
        isUuid(value.spaceId) &&
        organizer !== undefined &&
        responsibleUserId !== undefined &&
        occurrences?.length === 1 &&
        hasOnlyKeys(value, [
          "type",
          "tenantId",
          "requestId",
          "spaceId",
          "responsibleUserId",
          "organizer",
          "startsAt",
          "endsAt",
        ])
      ? {
        type: value.type,
        tenantId: value.tenantId.toLowerCase(),
        requestId: value.requestId.toLowerCase(),
        spaceId: value.spaceId.toLowerCase(),
        responsibleUserId,
        organizer,
        startsAt: occurrences[0]!.startsAt,
        endsAt: occurrences[0]!.endsAt,
      }
      : null;
  }
  if (value.type === "assignAgent") {
    return isUuid(value.tenantId) &&
        isUuid(value.requestId) &&
        (value.agentId === null || isUuid(value.agentId)) &&
        hasOnlyKeys(value, ["type", "tenantId", "requestId", "agentId"])
      ? {
        type: value.type,
        tenantId: value.tenantId.toLowerCase(),
        requestId: value.requestId.toLowerCase(),
        agentId: typeof value.agentId === "string"
          ? value.agentId.toLowerCase()
          : null,
      }
      : null;
  }
  if (value.type === "deleteRequest") {
    return isUuid(value.tenantId) &&
        isUuid(value.requestId) &&
        hasOnlyKeys(value, ["type", "tenantId", "requestId"])
      ? {
        type: value.type,
        tenantId: value.tenantId.toLowerCase(),
        requestId: value.requestId.toLowerCase(),
      }
      : null;
  }
  if (value.type === "resolveEmailIntake") {
    const occurrences = parseEventSpaceOccurrences(
      [{ startsAt: value.startsAt, endsAt: value.endsAt }],
      "none",
    );
    return isUuid(value.tenantId) &&
        isUuid(value.requestId) &&
        isUuid(value.spaceId) &&
        isUuid(value.agentId) &&
        occurrences?.length === 1 &&
        Date.parse(occurrences[0]!.endsAt) -
              Date.parse(occurrences[0]!.startsAt) ===
          30 * 60 * 1_000 &&
        hasOnlyKeys(value, [
          "type",
          "tenantId",
          "requestId",
          "spaceId",
          "agentId",
          "startsAt",
          "endsAt",
        ])
      ? {
        type: value.type,
        tenantId: value.tenantId.toLowerCase(),
        requestId: value.requestId.toLowerCase(),
        spaceId: value.spaceId.toLowerCase(),
        agentId: value.agentId.toLowerCase(),
        startsAt: occurrences[0]!.startsAt,
        endsAt: occurrences[0]!.endsAt,
      }
      : null;
  }
  if (value.type === "retryEmailTicketIntake") {
    return isUuid(value.tenantId) &&
        isUuid(value.ticketId) &&
        hasOnlyKeys(value, ["type", "tenantId", "ticketId"])
      ? {
        type: value.type,
        tenantId: value.tenantId.toLowerCase(),
        ticketId: value.ticketId.toLowerCase(),
      }
      : null;
  }
  if (value.type === "updateTaskStatus") {
    return isUuid(value.tenantId) &&
        isUuid(value.taskId) &&
        ["open", "in_progress", "completed"].includes(String(value.status)) &&
        hasOnlyKeys(value, ["type", "tenantId", "taskId", "status"])
      ? {
        type: value.type,
        tenantId: value.tenantId.toLowerCase(),
        taskId: value.taskId.toLowerCase(),
        status: value.status as TaskStatus,
      }
      : null;
  }
  return null;
}

function corsHeaders(request: Request): Headers {
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
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.data ? { data: error.data } : {}),
      },
    },
    error.status,
  );
}

function databaseFailure(error: DatabaseError): never {
  switch (error.code) {
    case "23505":
      throw new HttpError(
        409,
        "event_space_conflict",
        "Der Eintrag besteht bereits.",
      );
    case "23503":
      throw new HttpError(
        422,
        "event_space_reference_invalid",
        "Der Raum oder die verantwortliche Person ist nicht verfügbar.",
      );
    case "23514":
    case "23502":
    case "22001":
    case "22021":
    case "22023":
    case "22P02":
      throw new HttpError(
        422,
        "event_space_input_invalid",
        "Die Eingaben sind unvollständig oder ungültig.",
      );
    case "42501":
      throw new HttpError(
        403,
        "event_space_permission_denied",
        "Für diese Aktion fehlt die erforderliche Berechtigung.",
      );
    case "42P01":
    case "42883":
    case "PGRST202":
    case "PGRST204":
    case "PGRST205":
      throw new HttpError(
        503,
        "event_space_service_unavailable",
        "Die Raumplanung ist derzeit nicht verfügbar.",
      );
    default:
      throw new HttpError(
        500,
        "event_space_operation_failed",
        "Die Aktion konnte nicht abgeschlossen werden.",
      );
  }
}

async function requirePermission(
  client: CallerClient,
  tenantId: string,
  permission: "event.spaces.request" | "event.spaces.manage",
): Promise<void> {
  const { data, error } = await client.rpc("has_event_space_permission", {
    p_tenant_id: tenantId,
    p_permission_code: permission,
  });
  if (error || typeof data !== "boolean") {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  }
  if (!data) {
    throw new HttpError(
      403,
      "event_space_permission_denied",
      "Für diese Aktion fehlt die erforderliche Berechtigung.",
    );
  }
}

async function requireMembership(
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
      "Die Berechtigung konnte nicht geprüft werden.",
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

async function hasPermission(
  client: CallerClient,
  tenantId: string,
  permission: "event.spaces.request" | "event.spaces.manage",
): Promise<boolean> {
  const { data, error } = await client.rpc("has_event_space_permission", {
    p_tenant_id: tenantId,
    p_permission_code: permission,
  });
  if (error || typeof data !== "boolean") {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  }
  return data;
}

async function assertAvailableSpace(
  admin: AdminClient,
  tenantId: string,
  spaceId: string,
) {
  const { data, error } = await admin
    .from("event_spaces")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", spaceId)
    .eq("active", true)
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data) {
    throw new HttpError(
      422,
      "event_space_reference_invalid",
      "Der ausgewählte Raum ist nicht verfügbar.",
    );
  }
}

async function assertResponsibleMember(
  admin: AdminClient,
  tenantId: string,
  responsibleUserId: string,
) {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", responsibleUserId)
    .eq("status", "active")
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data) {
    throw new HttpError(
      422,
      "event_space_reference_invalid",
      "Die verantwortliche Person ist nicht verfügbar.",
    );
  }
}

function roleAllowsEventSpaceAssignment(role: Row, tenantId: string): boolean {
  if (role.tenant_id !== tenantId || role.active !== true) return false;
  const permissions = role.role_permissions;
  return (
    Array.isArray(permissions) &&
    permissions.some(
      (permission) =>
        isRecord(permission) &&
        (permission.permission_code === "ticket.read.assigned" ||
          permission.permission_code === "ticket.update" ||
          permission.permission_code === "tenant.settings.manage"),
    )
  );
}

function assignmentAllowsEventSpaceAssignment(
  assignment: unknown,
  tenantId: string,
  activeDepartmentIds: ReadonlySet<string>,
): boolean {
  if (!isRecord(assignment)) return false;
  const roles = assignment.roles;
  const role = Array.isArray(roles) ? roles[0] : roles;
  if (!isRecord(role) || !roleAllowsEventSpaceAssignment(role, tenantId)) {
    return false;
  }
  if (role.scope === "tenant") return true;
  return (
    role.scope === "department" &&
    typeof assignment.department_id === "string" &&
    activeDepartmentIds.has(assignment.department_id)
  );
}

async function assertAssignableEventSpaceAgent(
  admin: AdminClient,
  tenantId: string,
  responsibleUserId: string,
) {
  const now = new Date().toISOString();
  const [membershipResult, departmentMembershipsResult, assignmentsResult] =
    await Promise.all([
      admin
        .from("tenant_memberships")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("user_id", responsibleUserId)
        .eq("status", "active")
        .maybeSingle(),
      admin
        .from("department_memberships")
        .select("department_id")
        .eq("tenant_id", tenantId)
        .eq("user_id", responsibleUserId)
        .eq("status", "active")
        .limit(1000),
      admin
        .from("user_role_assignments")
        .select(
          "department_id, roles!user_role_assignments_role_tenant_fk!inner(tenant_id, active, scope, role_permissions!inner(permission_code))",
        )
        .eq("tenant_id", tenantId)
        .eq("user_id", responsibleUserId)
        .lte("starts_at", now)
        .or(`expires_at.is.null,expires_at.gt.${now}`),
    ]);
  if (membershipResult.error) databaseFailure(membershipResult.error);
  if (departmentMembershipsResult.error) {
    databaseFailure(departmentMembershipsResult.error);
  }
  if (assignmentsResult.error) databaseFailure(assignmentsResult.error);
  const activeDepartmentIds = new Set(
    (departmentMembershipsResult.data ?? [])
      .map((membership: Row) => membership.department_id)
      .filter(
        (departmentId): departmentId is string =>
          typeof departmentId === "string",
      ),
  );
  const isAgent = (assignmentsResult.data ?? []).some((assignment: Row) =>
    assignmentAllowsEventSpaceAssignment(
      assignment,
      tenantId,
      activeDepartmentIds,
    )
  );
  if (!membershipResult.data || !isAgent) {
    throw new HttpError(
      422,
      "event_space_reference_invalid",
      "Die ausgewählte Agent:in ist nicht verfügbar.",
    );
  }
}

async function listAssignableEventSpaceAgents(
  admin: AdminClient,
  tenantId: string,
) {
  const now = new Date().toISOString();
  const [membershipsResult, departmentMembershipsResult, assignmentsResult] =
    await Promise.all([
      admin
        .from("tenant_memberships")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .limit(1000),
      admin
        .from("department_memberships")
        .select("user_id, department_id")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .limit(2000),
      admin
        .from("user_role_assignments")
        .select(
          "user_id, department_id, roles!user_role_assignments_role_tenant_fk!inner(tenant_id, active, scope, role_permissions!inner(permission_code))",
        )
        .eq("tenant_id", tenantId)
        .lte("starts_at", now)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .limit(2000),
    ]);
  if (membershipsResult.error) databaseFailure(membershipsResult.error);
  if (departmentMembershipsResult.error) {
    databaseFailure(departmentMembershipsResult.error);
  }
  if (assignmentsResult.error) databaseFailure(assignmentsResult.error);
  const activeMemberIds = new Set(
    (membershipsResult.data ?? [])
      .map((membership: Row) => membership.user_id)
      .filter((userId): userId is string => typeof userId === "string"),
  );
  const activeDepartmentIdsByUser = new Map<string, Set<string>>();
  for (const membership of departmentMembershipsResult.data ?? []) {
    if (
      typeof membership.user_id !== "string" ||
      typeof membership.department_id !== "string"
    ) {
      continue;
    }
    const departmentIds = activeDepartmentIdsByUser.get(membership.user_id) ??
      new Set<string>();
    departmentIds.add(membership.department_id);
    activeDepartmentIdsByUser.set(membership.user_id, departmentIds);
  }
  const agentIds = new Set<string>();
  for (const assignment of assignmentsResult.data ?? []) {
    if (
      typeof assignment.user_id === "string" &&
      activeMemberIds.has(assignment.user_id) &&
      assignmentAllowsEventSpaceAssignment(
        assignment,
        tenantId,
        activeDepartmentIdsByUser.get(assignment.user_id) ?? new Set<string>(),
      )
    ) {
      agentIds.add(assignment.user_id);
    }
  }
  if (agentIds.size === 0) {
    return [] as Array<{ id: string; displayName: string }>;
  }

  const { data: profiles, error: profilesError } = await admin
    .from("user_profiles")
    .select("id, display_name")
    .in("id", [...agentIds])
    .limit(agentIds.size);
  if (profilesError) databaseFailure(profilesError);
  const profileNames = new Map(
    (profiles ?? [])
      .filter((profile: Row) => typeof profile.id === "string")
      .map((profile: Row) => [
        profile.id as string,
        typeof profile.display_name === "string" && profile.display_name.trim()
          ? profile.display_name.trim()
          : "Aktive Agent:in",
      ]),
  );
  return [...agentIds]
    .map((id) => ({
      id,
      displayName: profileNames.get(id) ?? "Aktive Agent:in",
    }))
    .sort(
      (first, second) =>
        first.displayName.localeCompare(second.displayName, "de-CH", {
          sensitivity: "base",
        }) || first.id.localeCompare(second.id),
    );
}

async function conflictSummary(admin: AdminClient, input: RequestInput) {
  const earliestStart = input.occurrences[0]!.startsAt;
  const latestEnd = input.occurrences[input.occurrences.length - 1]!.endsAt;
  const { data: candidates, error: candidatesError } = await admin
    .from("event_space_requests")
    .select("id, space_id, starts_at, ends_at")
    .eq("tenant_id", input.tenantId)
    .neq("status", "completed")
    .lt("starts_at", latestEnd)
    .gt("ends_at", earliestStart)
    .order("starts_at")
    .limit(MAX_CONFLICT_CANDIDATES + 1);
  if (candidatesError) databaseFailure(candidatesError);
  if ((candidates ?? []).length > MAX_CONFLICT_CANDIDATES) {
    throw new HttpError(
      409,
      "event_space_conflict_check_too_broad",
      "Zu viele bestehende Raumaufträge überlappen diesen Zeitraum. Bitte planen Sie einen kürzeren Zeitraum oder eine kleinere Serie.",
    );
  }
  const possible = (candidates ?? []).filter(
    (row: Row) =>
      typeof row.id === "string" &&
      typeof row.space_id === "string" &&
      typeof row.starts_at === "string" &&
      typeof row.ends_at === "string",
  ) as Array<{
    id: string;
    space_id: string;
    starts_at: string;
    ends_at: string;
  }>;
  const overlapping = possible.filter((candidate) =>
    input.occurrences.some((occurrence) =>
      overlaps(occurrence, {
        startsAt: candidate.starts_at,
        endsAt: candidate.ends_at,
      })
    )
  );
  const roomConflictingRequestIds = overlapping
    .filter((candidate) => candidate.space_id === input.spaceId)
    .map((candidate) => candidate.id);
  let equipmentConflictingRequestIds: string[] = [];
  if (input.equipmentKeys.length > 0 && overlapping.length > 0) {
    const { data: equipmentRows, error: equipmentError } = await admin
      .from("event_space_request_equipment")
      .select("request_id")
      .eq("tenant_id", input.tenantId)
      .in(
        "request_id",
        overlapping.map((candidate) => candidate.id),
      )
      .in("equipment_key", input.equipmentKeys)
      .limit(MAX_CONFLICT_CANDIDATES + 1);
    if (equipmentError) databaseFailure(equipmentError);
    if ((equipmentRows ?? []).length > MAX_CONFLICT_CANDIDATES) {
      throw new HttpError(
        409,
        "event_space_conflict_check_too_broad",
        "Zu viele bestehende Technikaufträge überlappen diesen Zeitraum. Bitte planen Sie einen kürzeren Zeitraum oder eine kleinere Serie.",
      );
    }
    equipmentConflictingRequestIds = (equipmentRows ?? [])
      .map((row: Row) => row.request_id)
      .filter(
        (requestId): requestId is string => typeof requestId === "string",
      );
  }
  const conflictIds = {
    roomConflictingRequestIds,
    equipmentConflictingRequestIds,
  };
  return {
    conflicts: summarizeEventSpaceConflicts(conflictIds),
    conflictSnapshot: await eventSpaceConflictSnapshot(conflictIds),
  };
}

async function audit(
  admin: AdminClient,
  tenantId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, boolean | number | string | null>,
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

function publicRoom(row: Row) {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind),
    location: typeof row.location === "string" ? row.location : null,
    capacity: typeof row.capacity === "number" ? row.capacity : null,
  };
}

async function navigationSummary(
  client: CallerClient,
  admin: AdminClient,
  tenantId: string,
) {
  await requireMembership(client, tenantId);
  const [canRequest, canManage] = await Promise.all([
    hasPermission(client, tenantId, "event.spaces.request"),
    hasPermission(client, tenantId, "event.spaces.manage"),
  ]);
  if (!canRequest && !canManage) {
    throw new HttpError(
      403,
      "event_space_permission_denied",
      "Für die Raumplanung fehlt Ihnen die erforderliche Berechtigung.",
    );
  }
  const { count, error } = await admin
    .from("event_space_requests")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .neq("status", "completed")
    .or("assigned_agent_id.is.null,status.eq.clarification_required");
  if (error) databaseFailure(error);
  return { attentionCount: Math.max(0, count ?? 0), canAccess: true };
}

async function listWorkspace(
  client: CallerClient,
  admin: AdminClient,
  tenantId: string,
  actorId: string,
  offset: number,
) {
  await requireMembership(client, tenantId);
  const [canRequest, canManage] = await Promise.all([
    hasPermission(client, tenantId, "event.spaces.request"),
    hasPermission(client, tenantId, "event.spaces.manage"),
  ]);
  if (!canRequest && !canManage) {
    throw new HttpError(
      403,
      "event_space_permission_denied",
      "Für die Raumplanung fehlt Ihnen die erforderliche Berechtigung.",
    );
  }
  const from = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  // A bounded weekly series may contain up to 52 occurrences. Keep the
  // complete planned year visible instead of silently hiding its later dates.
  const until = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
  const [
    roomsResult,
    requestsResult,
    clarificationsResult,
    emailIntakesResult,
  ] = await Promise.all([
    admin
      .from("event_spaces")
      .select("id, name, kind, location, capacity")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name"),
    admin
      .from("event_space_requests")
      .select(
        "id, space_id, title, organizer, remarks, expected_participants, starts_at, ends_at, responsible_user_id, assigned_agent_id, status, recurrence_kind, series_id, series_index, conflicts_acknowledged, intake_source, room_reservation_requested, phone_number",
      )
      .eq("tenant_id", tenantId)
      .gte("starts_at", from)
      .lt("starts_at", until)
      .order("starts_at")
      .order("id")
      .range(offset, offset + EVENT_SPACE_WORKSPACE_PAGE_SIZE),
    canManage
      ? admin
        .from("event_space_requests")
        .select(
          "id, title, organizer, remarks, assigned_agent_id, source_order_number, requested_space_text, requested_starts_at, requested_ends_at, requested_equipment_keys, clarification_reasons, room_reservation_requested, phone_number",
        )
        .eq("tenant_id", tenantId)
        .eq("status", "clarification_required")
        .order("created_at", { ascending: false })
        .limit(100)
      : Promise.resolve({ data: [], error: null }),
    canManage
      ? admin
        .from("event_space_ticket_intake_outbox")
        .select(
          "ticket_id, status, manual_retry_count, retry_lease_expires_at",
        )
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "failed", "retrying"])
        .order("created_at")
        .limit(50)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (roomsResult.error) databaseFailure(roomsResult.error);
  if (requestsResult.error) databaseFailure(requestsResult.error);
  if (clarificationsResult.error) databaseFailure(clarificationsResult.error);
  if (emailIntakesResult.error) databaseFailure(emailIntakesResult.error);
  const rooms = (roomsResult.data ?? []).map((row: Row) => publicRoom(row));
  const requestPage = eventSpaceWorkspacePage(
    requestsResult.data ?? [],
    offset,
  );
  const requestRows = requestPage.items.filter(
    (row: Row) =>
      typeof row.id === "string" && typeof row.space_id === "string",
  ) as Row[];
  const requestIds = requestRows.map((row) => String(row.id));
  const [tasksResult, equipmentResult] = requestIds.length
    ? await Promise.all([
      admin
        .from("event_space_tasks")
        .select("id, request_id, title, position, status")
        .eq("tenant_id", tenantId)
        .in("request_id", requestIds)
        .order("position")
        .limit(EVENT_SPACE_WORKSPACE_PAGE_SIZE * 6),
      admin
        .from("event_space_request_equipment")
        .select("request_id, equipment_key")
        .eq("tenant_id", tenantId)
        .in("request_id", requestIds)
        .order("equipment_key")
        .limit(EVENT_SPACE_WORKSPACE_PAGE_SIZE * 6),
    ])
    : [
      { data: [], error: null },
      { data: [], error: null },
    ];
  if (tasksResult.error) databaseFailure(tasksResult.error);
  if (equipmentResult.error) databaseFailure(equipmentResult.error);

  const responsibleIds = [
    ...new Set(
      [...requestRows, ...(canManage ? (clarificationsResult.data ?? []) : [])]
        .flatMap((row: Row) => [row.responsible_user_id, row.assigned_agent_id])
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const { data: profileRows, error: profilesError } = responsibleIds.length
    ? await admin
      .from("user_profiles")
      .select("id, display_name")
      .in("id", responsibleIds)
      .limit(responsibleIds.length)
    : { data: [], error: null };
  if (profilesError) databaseFailure(profilesError);
  const responsibleNames = new Map(
    (profileRows ?? [])
      .filter((row: Row) => typeof row.id === "string")
      .map((row: Row) => [
        row.id as string,
        typeof row.display_name === "string" && row.display_name.trim()
          ? row.display_name.trim()
          : "Verantwortliche Person",
      ]),
  );

  let people: Array<{ id: string; displayName: string }> = [];
  if (canManage) {
    const { data: memberships, error: membershipError } = await admin
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .limit(1000);
    if (membershipError) databaseFailure(membershipError);
    const userIds = (memberships ?? [])
      .map((row: Row) => row.user_id)
      .filter((id): id is string => typeof id === "string");
    const missingIds = userIds.filter((id) => !responsibleNames.has(id));
    if (missingIds.length) {
      const { data: additionalProfiles, error: additionalProfilesError } =
        await admin
          .from("user_profiles")
          .select("id, display_name")
          .in("id", missingIds)
          .limit(missingIds.length);
      if (additionalProfilesError) databaseFailure(additionalProfilesError);
      for (const row of additionalProfiles ?? []) {
        if (typeof row.id === "string") {
          responsibleNames.set(
            row.id,
            typeof row.display_name === "string" && row.display_name.trim()
              ? row.display_name.trim()
              : "Ohne Namen",
          );
        }
      }
    }
    people = userIds
      .map((id) => ({
        id,
        displayName: responsibleNames.get(id) ?? "Ohne Namen",
      }))
      .sort((first, second) =>
        first.displayName.localeCompare(second.displayName, "de-CH")
      );
  } else if (canRequest) {
    if (!responsibleNames.has(actorId)) {
      const { data: profile, error: profileError } = await admin
        .from("user_profiles")
        .select("id, display_name")
        .eq("id", actorId)
        .maybeSingle();
      if (profileError) databaseFailure(profileError);
      responsibleNames.set(
        actorId,
        typeof profile?.display_name === "string" && profile.display_name.trim()
          ? profile.display_name.trim()
          : "Ich",
      );
    }
    people = [
      { id: actorId, displayName: responsibleNames.get(actorId) ?? "Ich" },
    ];
  }
  const agents = canManage
    ? await listAssignableEventSpaceAgents(admin, tenantId)
    : [];

  const tasksByRequest = new Map<string, Array<Record<string, unknown>>>();
  for (const row of tasksResult.data ?? []) {
    if (typeof row.request_id !== "string" || typeof row.id !== "string") {
      continue;
    }
    const current = tasksByRequest.get(row.request_id) ?? [];
    current.push({
      id: row.id,
      title: typeof row.title === "string" ? row.title : "Aufgabe",
      status: typeof row.status === "string" ? row.status : "open",
    });
    tasksByRequest.set(row.request_id, current);
  }
  const equipmentByRequest = new Map<string, string[]>();
  for (const row of equipmentResult.data ?? []) {
    if (
      typeof row.request_id !== "string" ||
      typeof row.equipment_key !== "string"
    ) {
      continue;
    }
    const current = equipmentByRequest.get(row.request_id) ?? [];
    current.push(row.equipment_key);
    equipmentByRequest.set(row.request_id, current);
  }
  return {
    rooms,
    people,
    agents,
    permissions: { canRequest, canManage },
    pagination: {
      hasMore: requestPage.hasMore,
      nextOffset: requestPage.nextOffset,
    },
    clarifications: canManage
      ? (clarificationsResult.data ?? [])
        .filter((row: Row) => typeof row.id === "string")
        .map((row: Row) => ({
          id: String(row.id),
          title: typeof row.title === "string" ? row.title : "Raumauftrag",
          organizer: typeof row.organizer === "string" ? row.organizer : null,
          remarks: typeof row.remarks === "string" ? row.remarks : null,
          assignedAgent: typeof row.assigned_agent_id === "string"
            ? {
              id: row.assigned_agent_id,
              displayName: responsibleNames.get(row.assigned_agent_id) ??
                "Zugewiesene Agent:in",
            }
            : null,
          sourceOrderNumber: typeof row.source_order_number === "string"
            ? row.source_order_number
            : null,
          requestedSpaceText: typeof row.requested_space_text === "string"
            ? row.requested_space_text
            : null,
          requestedStartsAt: typeof row.requested_starts_at === "string"
            ? row.requested_starts_at
            : null,
          requestedEndsAt: typeof row.requested_ends_at === "string"
            ? row.requested_ends_at
            : null,
          roomReservationRequested: row.room_reservation_requested === true,
          phoneNumber: typeof row.phone_number === "string"
            ? row.phone_number
            : null,
          requestedEquipment: Array.isArray(row.requested_equipment_keys)
            ? row.requested_equipment_keys.filter(
              (item): item is string => typeof item === "string",
            )
            : [],
          reasons: Array.isArray(row.clarification_reasons)
            ? row.clarification_reasons.filter(
              (item): item is string => typeof item === "string",
            )
            : [],
        }))
      : [],
    emailIntakes: canManage
      ? (emailIntakesResult.data ?? [])
        .filter(
          (row: Row) =>
            typeof row.ticket_id === "string" &&
            (row.status === "pending" ||
              row.status === "failed" ||
              row.status === "retrying") &&
            Number.isInteger(row.manual_retry_count) &&
            typeof row.manual_retry_count === "number" &&
            row.manual_retry_count >= 0 &&
            row.manual_retry_count <= 3,
        )
        .map((row: Row) => {
          const state = row.status as "pending" | "failed" | "retrying";
          const retryCount = row.manual_retry_count as number;
          const leaseExpiresAt = typeof row.retry_lease_expires_at === "string"
            ? Date.parse(row.retry_lease_expires_at)
            : Number.NaN;
          return {
            ticketId: String(row.ticket_id),
            state,
            retryCount,
            canRetry: ((state === "pending" || state === "failed") &&
              retryCount < 3) ||
              (state === "retrying" &&
                retryCount < 3 &&
                Number.isFinite(leaseExpiresAt) &&
                leaseExpiresAt <= Date.now()),
          };
        })
      : [],
    requests: requestRows.map((row) => ({
      id: String(row.id),
      spaceId: String(row.space_id),
      title: typeof row.title === "string" ? row.title : "Raumauftrag",
      organizer: typeof row.organizer === "string" ? row.organizer : null,
      remarks: typeof row.remarks === "string" ? row.remarks : null,
      expectedParticipants: typeof row.expected_participants === "number"
        ? row.expected_participants
        : null,
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      requesterUserId: typeof row.responsible_user_id === "string"
        ? row.responsible_user_id
        : null,
      requesterName: row.intake_source === "email_ticket"
        ? typeof row.organizer === "string" ? row.organizer : null
        : typeof row.responsible_user_id === "string"
        ? (responsibleNames.get(row.responsible_user_id) ??
          "Verantwortliche Person")
        : null,
      assignedAgent: typeof row.assigned_agent_id === "string"
        ? {
          id: row.assigned_agent_id,
          displayName: responsibleNames.get(row.assigned_agent_id) ??
            "Zugewiesene Agent:in",
        }
        : null,
      intakeSource: row.intake_source === "email_ticket"
        ? "email_ticket"
        : "manual",
      status: String(row.status),
      recurrence: String(row.recurrence_kind),
      seriesId: typeof row.series_id === "string" ? row.series_id : null,
      seriesIndex: typeof row.series_index === "number" ? row.series_index : 1,
      conflictsAcknowledged: row.conflicts_acknowledged === true,
      roomReservationRequested: row.room_reservation_requested === true,
      phoneNumber: typeof row.phone_number === "string"
        ? row.phone_number
        : null,
      equipment: equipmentByRequest.get(String(row.id)) ?? [],
      tasks: tasksByRequest.get(String(row.id)) ?? [],
    })),
  };
}

async function createRequest(
  admin: AdminClient,
  actorId: string,
  input: RequestInput,
  confirmConflicts: boolean,
  conflictSnapshot: string | null,
) {
  await assertResponsibleMember(admin, input.tenantId, input.responsibleUserId);
  const preview = await conflictSummary(admin, input);
  if (preview.conflicts.hasConflicts && !confirmConflicts) {
    throw new HttpError(
      409,
      "event_space_conflicts_confirmation_required",
      "Bitte bestätigen Sie die angezeigte Überschneidung ausdrücklich oder passen Sie den Auftrag an.",
      preview,
    );
  }
  const { data, error } = await admin.rpc("create_event_space_request_series", {
    p_tenant_id: input.tenantId,
    p_space_id: input.spaceId,
    p_title: input.title,
    p_organizer: input.organizer,
    p_expected_participants: input.expectedParticipants,
    p_responsible_user_id: input.responsibleUserId,
    p_recurrence_kind: input.recurrence,
    p_starts_at: input.occurrences.map((occurrence) => occurrence.startsAt),
    p_ends_at: input.occurrences.map((occurrence) => occurrence.endsAt),
    p_equipment_keys: input.equipmentKeys,
    p_conflicts_acknowledged: confirmConflicts,
    p_conflict_snapshot: conflictSnapshot,
    p_actor_id: actorId,
  });
  if (error) databaseFailure(error);
  const result = Array.isArray(data) ? data[0] : data;
  const createdCount = result && typeof result === "object"
    ? (result as Row).created_count
    : null;
  const roomConflictCount = result && typeof result === "object"
    ? (result as Row).room_conflict_count
    : null;
  const equipmentConflictCount = result && typeof result === "object"
    ? (result as Row).equipment_conflict_count
    : null;
  if (
    typeof createdCount !== "number" ||
    typeof roomConflictCount !== "number" ||
    typeof equipmentConflictCount !== "number"
  ) {
    throw new HttpError(
      500,
      "event_space_operation_failed",
      "Der Raumauftrag konnte nicht vollständig erstellt werden.",
    );
  }
  if (createdCount === 0) {
    const refreshed = await conflictSummary(admin, input);
    throw new HttpError(
      409,
      "event_space_conflicts_confirmation_required",
      "Seit der Prüfung ist eine neue Überschneidung entstanden. Bitte prüfen und bestätigen Sie den Auftrag erneut.",
      {
        conflicts: refreshed.conflicts,
        conflictSnapshot: refreshed.conflictSnapshot,
      },
    );
  }
  if (createdCount !== input.occurrences.length) {
    throw new HttpError(
      500,
      "event_space_operation_failed",
      "Der Raumauftrag konnte nicht vollständig erstellt werden.",
    );
  }
  return { createdCount };
}

async function updateRequestStatus(
  admin: AdminClient,
  actorId: string,
  tenantId: string,
  requestId: string,
  status: RequestStatus,
) {
  const { data, error } = await admin
    .from("event_space_requests")
    .update({ status })
    .eq("tenant_id", tenantId)
    .eq("id", requestId)
    .neq("status", "clarification_required")
    .select("id")
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data) {
    throw new HttpError(
      404,
      "event_space_request_not_found",
      "Der Raumauftrag ist nicht mehr verfügbar.",
    );
  }
  await audit(
    admin,
    tenantId,
    actorId,
    "event_spaces.request.status_changed",
    "event_space_request",
    requestId,
    { status },
  );
}

async function assignResponsible(
  admin: AdminClient,
  actorId: string,
  tenantId: string,
  requestId: string,
  responsibleUserId: string,
) {
  await assertResponsibleMember(admin, tenantId, responsibleUserId);
  const { data, error } = await admin
    .from("event_space_requests")
    .update({ responsible_user_id: responsibleUserId })
    .eq("tenant_id", tenantId)
    .eq("id", requestId)
    .eq("intake_source", "manual")
    .neq("status", "completed")
    .select("id")
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data) {
    throw new HttpError(
      404,
      "event_space_request_not_found",
      "Der Raumauftrag ist nicht mehr verfügbar.",
    );
  }
  await audit(
    admin,
    tenantId,
    actorId,
    "event_spaces.request.responsible_assigned",
    "event_space_request",
    requestId,
    { assigned: true },
  );
}

async function updateRequestDetails(
  admin: AdminClient,
  actorId: string,
  action: Extract<Action, { type: "updateRequestDetails" }>,
) {
  await assertAvailableSpace(admin, action.tenantId, action.spaceId);
  if (action.responsibleUserId !== null) {
    await assertResponsibleMember(
      admin,
      action.tenantId,
      action.responsibleUserId,
    );
  }
  const { data, error } = await admin.rpc(
    "update_event_space_request_details",
    {
      p_tenant_id: action.tenantId,
      p_request_id: action.requestId,
      p_space_id: action.spaceId,
      p_responsible_user_id: action.responsibleUserId,
      p_organizer: action.organizer,
      p_starts_at: action.startsAt,
      p_ends_at: action.endsAt,
      p_actor_id: actorId,
    },
  );
  if (error) databaseFailure(error);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || (result as Row).updated !== true) {
    throw new HttpError(
      409,
      "event_space_clarification_conflict",
      "Der Raum oder die benötigte Technik ist im gewünschten Zeitraum nicht verfügbar.",
    );
  }
}

async function assignAgent(
  admin: AdminClient,
  actorId: string,
  tenantId: string,
  requestId: string,
  agentId: string | null,
) {
  if (agentId !== null) {
    await assertAssignableEventSpaceAgent(admin, tenantId, agentId);
  }
  const { data, error } = await admin
    .from("event_space_requests")
    .update({ assigned_agent_id: agentId })
    .eq("tenant_id", tenantId)
    .eq("id", requestId)
    .neq("status", "completed")
    .select("id")
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data) {
    throw new HttpError(
      404,
      "event_space_request_not_found",
      "Der Raumauftrag ist nicht mehr verfügbar.",
    );
  }
  await audit(
    admin,
    tenantId,
    actorId,
    "event_spaces.request.agent_assignment_changed",
    "event_space_request",
    requestId,
    { assigned: agentId !== null },
  );
}

/**
 * Equipment and tasks are removed by their cascading foreign keys; the
 * equipment delete trigger also releases any inventory reserved for the plan.
 */
async function deleteRequest(
  admin: AdminClient,
  actorId: string,
  tenantId: string,
  requestId: string,
) {
  const { data, error } = await admin
    .from("event_space_requests")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", requestId)
    .select("id")
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data) {
    throw new HttpError(
      404,
      "event_space_request_not_found",
      "Der Raumauftrag ist nicht mehr verfügbar.",
    );
  }
  await audit(
    admin,
    tenantId,
    actorId,
    "event_spaces.request.deleted",
    "event_space_request",
    requestId,
    {},
  );
}

async function resolveEmailIntake(
  admin: AdminClient,
  actorId: string,
  tenantId: string,
  requestId: string,
  spaceId: string,
  agentId: string,
  startsAt: string,
  endsAt: string,
) {
  await assertAssignableEventSpaceAgent(admin, tenantId, agentId);
  const { data, error } = await admin.rpc(
    "resolve_event_space_email_ticket_request",
    {
      p_tenant_id: tenantId,
      p_request_id: requestId,
      p_space_id: spaceId,
      p_responsible_user_id: agentId,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_actor_id: actorId,
    },
  );
  if (error) databaseFailure(error);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || (result as Row).resolved !== true) {
    throw new HttpError(
      409,
      "event_space_clarification_conflict",
      "Der Raum oder die benötigte Technik ist im gewünschten Zeitraum nicht verfügbar.",
    );
  }
}

async function retryEmailTicketIntake(
  client: CallerClient,
  admin: AdminClient,
  actorId: string,
  tenantId: string,
  ticketId: string,
) {
  // Permission checks intentionally happen before the service-role claim. The
  // claim repeats active-membership and ticket/outbox relationship checks in
  // the database so a browser-supplied UUID cannot cross a tenant boundary.
  await requireMembership(client, tenantId);
  await requirePermission(client, tenantId, "event.spaces.manage");
  const { data, error } = await admin.rpc(
    "claim_event_space_email_ticket_intake_retry",
    {
      p_tenant_id: tenantId,
      p_ticket_id: ticketId,
      p_actor_id: actorId,
    },
  );
  if (error) databaseFailure(error);
  const claim = Array.isArray(data) ? data[0] : data;
  const claimOutcome = claim &&
      typeof claim === "object" &&
      typeof (claim as Row).outcome === "string"
    ? (claim as Row).outcome
    : null;
  if (claimOutcome !== "claimed") {
    // A concurrent click, terminal intake or exhausted limit is intentionally
    // indistinguishable to the UI. It exposes no ticket or mail information.
    return { state: "unavailable" as const };
  }

  const retryCount = typeof (claim as Row).retry_count === "number" &&
      Number.isSafeInteger((claim as Row).retry_count)
    ? ((claim as Row).retry_count as number)
    : null;
  const ticketSubject = (claim as Row).ticket_subject;
  const sourceDescription = eventSpaceEmailIntakeBodyFromStoredTicket(
    (claim as Row).ticket_description,
  );
  const outcome = typeof ticketSubject === "string" && sourceDescription
    ? await processEventSpaceEmailTicketIntake(admin, {
      tenantId,
      ticketId,
      subject: ticketSubject,
      description: sourceDescription,
    })
    : (await failEventSpaceEmailTicketIntake(
      admin,
      { tenantId, ticketId },
      "event_space_intake_source_unavailable",
    ),
      "failed" as const);

  // The transactional claim is already an audit record even if this optional
  // completion record cannot be persisted. A missing audit write must not
  // turn a completed source ticket into an HTTP delivery failure.
  try {
    await audit(
      admin,
      tenantId,
      actorId,
      "event_spaces.email_ticket_intake.retry_finished",
      "event_space_ticket_intake_outbox",
      ticketId,
      { outcome, retryCount },
    );
  } catch {
    // The started audit and the outbox state remain the durable recovery trail.
  }
  return { state: outcome };
}

async function updateTaskStatus(
  admin: AdminClient,
  actorId: string,
  tenantId: string,
  taskId: string,
  status: TaskStatus,
) {
  const { data, error } = await admin
    .from("event_space_tasks")
    .update({
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", taskId)
    .select("id, request_id")
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data) {
    throw new HttpError(
      404,
      "event_space_task_not_found",
      "Die Aufgabe ist nicht mehr verfügbar.",
    );
  }
  await audit(
    admin,
    tenantId,
    actorId,
    "event_spaces.task.status_changed",
    "event_space_task",
    taskId,
    { status },
  );
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
          "Die Anfrage enthält ungültige Felder.",
        );
      }
      if (action.type === "listWorkspace") {
        return json(request, {
          data: await listWorkspace(
            context.supabase,
            context.supabaseAdmin,
            action.tenantId,
            actorId,
            action.offset,
          ),
        });
      }
      if (action.type === "navigationSummary") {
        return json(request, {
          data: await navigationSummary(
            context.supabase,
            context.supabaseAdmin,
            action.tenantId,
          ),
        });
      }
      if (action.type === "previewConflicts") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          "event.spaces.request",
        );
        await assertAvailableSpace(
          context.supabaseAdmin,
          action.tenantId,
          action.spaceId,
        );
        await assertResponsibleMember(
          context.supabaseAdmin,
          action.tenantId,
          action.responsibleUserId,
        );
        return json(request, {
          data: {
            ...(await conflictSummary(context.supabaseAdmin, action)),
          },
        });
      }
      if (action.type === "createRequest") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          "event.spaces.request",
        );
        const created = await createRequest(
          context.supabaseAdmin,
          actorId,
          action,
          action.confirmConflicts,
          action.conflictSnapshot,
        );
        return json(request, { data: created }, 201);
      }
      if (action.type === "createSpace") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          "event.spaces.manage",
        );
        const { data, error } = await context.supabaseAdmin
          .from("event_spaces")
          .insert({
            tenant_id: action.tenantId,
            name: action.name,
            kind: action.kind,
            location: action.location,
            capacity: action.capacity,
            created_by: actorId,
          })
          .select("id")
          .single();
        if (error) databaseFailure(error);
        await audit(
          context.supabaseAdmin,
          action.tenantId,
          actorId,
          "event_spaces.space.created",
          "event_space",
          data.id,
          {
            kind: action.kind,
            hasCapacity: action.capacity !== null,
            hasLocation: action.location !== null,
          },
        );
        return json(request, { data: { id: data.id } }, 201);
      }
      if (action.type === "updateRequestStatus") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          "event.spaces.manage",
        );
        await updateRequestStatus(
          context.supabaseAdmin,
          actorId,
          action.tenantId,
          action.requestId,
          action.status,
        );
        return json(request, { data: { updated: true } });
      }
      if (action.type === "assignResponsible") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          "event.spaces.manage",
        );
        await assignResponsible(
          context.supabaseAdmin,
          actorId,
          action.tenantId,
          action.requestId,
          action.responsibleUserId,
        );
        return json(request, { data: { updated: true } });
      }
      if (action.type === "updateRequestDetails") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          "event.spaces.manage",
        );
        await updateRequestDetails(context.supabaseAdmin, actorId, action);
        return json(request, { data: { updated: true } });
      }
      if (action.type === "assignAgent") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          "event.spaces.manage",
        );
        await assignAgent(
          context.supabaseAdmin,
          actorId,
          action.tenantId,
          action.requestId,
          action.agentId,
        );
        return json(request, { data: { updated: true } });
      }
      if (action.type === "deleteRequest") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          "event.spaces.manage",
        );
        await deleteRequest(
          context.supabaseAdmin,
          actorId,
          action.tenantId,
          action.requestId,
        );
        return json(request, { data: { deleted: true } });
      }
      if (action.type === "resolveEmailIntake") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          "event.spaces.manage",
        );
        await resolveEmailIntake(
          context.supabaseAdmin,
          actorId,
          action.tenantId,
          action.requestId,
          action.spaceId,
          action.agentId,
          action.startsAt,
          action.endsAt,
        );
        return json(request, { data: { resolved: true } });
      }
      if (action.type === "retryEmailTicketIntake") {
        return json(request, {
          data: await retryEmailTicketIntake(
            context.supabase,
            context.supabaseAdmin,
            actorId,
            action.tenantId,
            action.ticketId,
          ),
        });
      }
      await requirePermission(
        context.supabase,
        action.tenantId,
        "event.spaces.manage",
      );
      await updateTaskStatus(
        context.supabaseAdmin,
        actorId,
        action.tenantId,
        action.taskId,
        action.status,
      );
      return json(request, { data: { updated: true } });
    } catch (error) {
      return failure(
        request,
        error instanceof HttpError ? error : new HttpError(
          500,
          "event_space_operation_failed",
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
    if (origin !== null && origin !== APP_ORIGIN) {
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
      if (origin !== APP_ORIGIN) {
        return failure(
          request,
          new HttpError(
            403,
            "origin_not_allowed",
            "Dieser Ursprung ist nicht erlaubt.",
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
        ?.trim()
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
      const response = await handler(await boundedRequest(request));
      if (response.headers.has("x-supabase-server-error")) {
        return failure(
          request,
          new HttpError(
            response.status === 401 ? 401 : 503,
            response.status === 401
              ? "authentication_required"
              : "authentication_unavailable",
            response.status === 401
              ? "Eine gültige Benutzeranmeldung ist erforderlich."
              : "Die Anmeldung konnte derzeit nicht geprüft werden.",
          ),
        );
      }
      return new Response(response.body, {
        status: response.status,
        headers: corsHeaders(request),
      });
    } catch (error) {
      return failure(
        request,
        error instanceof HttpError ? error : new HttpError(
          500,
          "event_space_operation_failed",
          "Die Aktion konnte nicht abgeschlossen werden.",
        ),
      );
    }
  },
};
