import { type SupabaseContext, withSupabase } from "@supabase/server";
import {
  EVENT_SPACE_WORKSPACE_PAGE_SIZE,
  eventSpaceWorkspacePage,
} from "../_shared/event-space-pagination.ts";
import {
  eventSpaceConflictSnapshot,
  isEventSpaceConflictSnapshot,
  parseEventSpaceEquipment,
  parseEventSpaceOccurrences,
  overlaps,
  summarizeEventSpaceConflicts,
  type EventSpaceEquipment,
  type EventSpaceOccurrence,
  type EventSpaceRecurrence,
} from "../_shared/event-space-schedule.ts";

const APP_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_CONFLICT_CANDIDATES = 500;

type CallerClient = SupabaseContext["supabase"];
type AdminClient = SupabaseContext["supabaseAdmin"];
type RequestStatus =
  "planned" | "in_preparation" | "ready" | "conducted" | "completed";
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
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
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
      ["planned", "in_preparation", "ready", "conducted", "completed"].includes(
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
      }),
    ),
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
      "Für Veranstaltungsräume fehlt Ihnen die erforderliche Berechtigung.",
    );
  }
  const from = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  // A bounded weekly series may contain up to 52 occurrences. Keep the
  // complete planned year visible instead of silently hiding its later dates.
  const until = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
  const [roomsResult, requestsResult] = await Promise.all([
    admin
      .from("event_spaces")
      .select("id, name, kind, location, capacity")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name"),
    admin
      .from("event_space_requests")
      .select(
        "id, space_id, title, organizer, expected_participants, starts_at, ends_at, responsible_user_id, status, recurrence_kind, series_id, series_index, conflicts_acknowledged",
      )
      .eq("tenant_id", tenantId)
      .gte("starts_at", from)
      .lt("starts_at", until)
      .order("starts_at")
      .order("id")
      .range(offset, offset + EVENT_SPACE_WORKSPACE_PAGE_SIZE),
  ]);
  if (roomsResult.error) databaseFailure(roomsResult.error);
  if (requestsResult.error) databaseFailure(requestsResult.error);
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
      requestRows
        .map((row) => row.responsible_user_id)
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
        first.displayName.localeCompare(second.displayName, "de-CH"),
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

  const tasksByRequest = new Map<string, Array<Record<string, unknown>>>();
  for (const row of tasksResult.data ?? []) {
    if (typeof row.request_id !== "string" || typeof row.id !== "string")
      continue;
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
    )
      continue;
    const current = equipmentByRequest.get(row.request_id) ?? [];
    current.push(row.equipment_key);
    equipmentByRequest.set(row.request_id, current);
  }
  return {
    rooms,
    people,
    permissions: { canRequest, canManage },
    pagination: {
      hasMore: requestPage.hasMore,
      nextOffset: requestPage.nextOffset,
    },
    requests: requestRows.map((row) => ({
      id: String(row.id),
      spaceId: String(row.space_id),
      title: typeof row.title === "string" ? row.title : "Raumauftrag",
      organizer: typeof row.organizer === "string" ? row.organizer : null,
      expectedParticipants:
        typeof row.expected_participants === "number"
          ? row.expected_participants
          : null,
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      responsibleName:
        typeof row.responsible_user_id === "string"
          ? (responsibleNames.get(row.responsible_user_id) ??
            "Verantwortliche Person")
          : null,
      status: String(row.status),
      recurrence: String(row.recurrence_kind),
      seriesId: typeof row.series_id === "string" ? row.series_id : null,
      seriesIndex: typeof row.series_index === "number" ? row.series_index : 1,
      conflictsAcknowledged: row.conflicts_acknowledged === true,
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
  const createdCount =
    result && typeof result === "object" ? (result as Row).created_count : null;
  const roomConflictCount =
    result && typeof result === "object"
      ? (result as Row).room_conflict_count
      : null;
  const equipmentConflictCount =
    result && typeof result === "object"
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
    .select("id")
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!data)
    throw new HttpError(
      404,
      "event_space_request_not_found",
      "Der Raumauftrag ist nicht mehr verfügbar.",
    );
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
  if (!data)
    throw new HttpError(
      404,
      "event_space_task_not_found",
      "Die Aufgabe ist nicht mehr verfügbar.",
    );
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
      if (!action)
        throw new HttpError(
          400,
          "invalid_request",
          "Die Anfrage enthält ungültige Felder.",
        );
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
        error instanceof HttpError
          ? error
          : new HttpError(
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
      if (origin !== APP_ORIGIN)
        return failure(
          request,
          new HttpError(
            403,
            "origin_not_allowed",
            "Dieser Ursprung ist nicht erlaubt.",
          ),
        );
      return json(request, {}, 204);
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
        error instanceof HttpError
          ? error
          : new HttpError(
              500,
              "event_space_operation_failed",
              "Die Aktion konnte nicht abgeschlossen werden.",
            ),
      );
    }
  },
};
