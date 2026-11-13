import { msg } from "../_shared/formality.ts";
import { type SupabaseContext, withSupabase } from "@supabase/server";
import { resolveUserFeatureStates } from "../_shared/tenant-features.ts";
import {
  ExtrasDatabaseError,
  licenseRevocationTaskTitle,
  loanReturnTaskTitle,
  offboardingExtras as loadOffboardingExtras,
} from "./offboarding-extras.ts";

const APP_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 48 * 1024;

type Client = SupabaseContext["supabase"];
type Admin = SupabaseContext["supabaseAdmin"];
type Row = Record<string, unknown>;
type TaskStatus = "open" | "in_progress" | "blocked" | "completed";
type EntryKind = "onboarding" | "offboarding";
type Action =
  | { type: "navigationSummary"; tenantId: string }
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
      kind: EntryKind;
    }
  | { type: "listDepartmentTasks"; tenantId: string }
  | {
      type: "saveDepartmentTask";
      tenantId: string;
      id: string | null;
      kind: EntryKind;
      departmentId: string;
      title: string;
      dueOffsetDays: number;
      active: boolean;
    }
  | { type: "deleteDepartmentTask"; tenantId: string; id: string }
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
    }
  | {
      type: "offboardingAssets";
      tenantId: string;
      entryId: string;
      requesterId: string | null;
    }
  | {
      type: "createReturnTasks";
      tenantId: string;
      entryId: string;
      assignmentIds: string[];
      /** Offene Shop-Ausleihen (Bestellpositionen), die zurückkommen. */
      loanLineIds?: string[];
      /** Lizenzzuweisungen, die beim Austritt entzogen werden. */
      licenseAssignmentIds?: string[];
      /** Lagerort für die Rücknahme; ohne Angabe der Standard-Lagerort. */
      returnLocationId?: string;
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
const MAX_RETURN_TASKS = 50;
/** Compares person names case-insensitively with normalized whitespace. */
export function normalizePersonName(value: unknown): string {
  return typeof value === "string"
    ? value
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("de-CH")
    : "";
}
export function namesMatch(left: unknown, right: unknown): boolean {
  const normalized = normalizePersonName(left);
  return normalized.length > 0 && normalized === normalizePersonName(right);
}
/** Title of the return task: «Rückgabe: <Gerät> (<Inventarnummer oder Seriennummer>)». */
export function returnTaskTitle(asset: {
  name: unknown;
  inventoryNumber: unknown;
  serialNumber: unknown;
}): string {
  const clean = (value: unknown) =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  const reference =
    clean(asset.inventoryNumber) || clean(asset.serialNumber) || "";
  const name = clean(asset.name) || "Gerät";
  const suffix = reference
    ? ` (${Array.from(reference).slice(0, 80).join("")})`
    : "";
  const room = 240 - "Rückgabe: ".length - Array.from(suffix).length;
  const shortName =
    Array.from(name).length > room
      ? `${Array.from(name)
          .slice(0, room - 1)
          .join("")}…`
      : name;
  return `Rückgabe: ${shortName}${suffix}`;
}
function onlyKeys(value: Row, keys: string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "navigationSummary") {
    return isUuid(value.tenantId) && onlyKeys(value, ["type", "tenantId"])
      ? { type: value.type, tenantId: value.tenantId.toLowerCase() }
      : null;
  }
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
        "kind",
      ]) &&
      (value.kind === undefined ||
        value.kind === "onboarding" ||
        value.kind === "offboarding")
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
          kind: value.kind === "offboarding" ? "offboarding" : "onboarding",
        }
      : null;
  }
  if (value.type === "listDepartmentTasks") {
    return isUuid(value.tenantId) && onlyKeys(value, ["type", "tenantId"])
      ? { type: value.type, tenantId: value.tenantId.toLowerCase() }
      : null;
  }
  if (value.type === "saveDepartmentTask") {
    const title = safeText(value.title, 2, 240);
    return isUuid(value.tenantId) &&
      (value.id === null || isUuid(value.id)) &&
      (value.kind === "onboarding" || value.kind === "offboarding") &&
      isUuid(value.departmentId) &&
      title !== null &&
      Number.isInteger(value.dueOffsetDays) &&
      Number(value.dueOffsetDays) >= -60 &&
      Number(value.dueOffsetDays) <= 90 &&
      typeof value.active === "boolean" &&
      onlyKeys(value, [
        "type",
        "tenantId",
        "id",
        "kind",
        "departmentId",
        "title",
        "dueOffsetDays",
        "active",
      ])
      ? {
          type: value.type,
          tenantId: value.tenantId.toLowerCase(),
          id: typeof value.id === "string" ? value.id.toLowerCase() : null,
          kind: value.kind,
          departmentId: value.departmentId.toLowerCase(),
          title,
          dueOffsetDays: Number(value.dueOffsetDays),
          active: value.active,
        }
      : null;
  }
  if (value.type === "deleteDepartmentTask") {
    return isUuid(value.tenantId) &&
      isUuid(value.id) &&
      onlyKeys(value, ["type", "tenantId", "id"])
      ? {
          type: value.type,
          tenantId: value.tenantId.toLowerCase(),
          id: value.id.toLowerCase(),
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
  if (value.type === "offboardingAssets") {
    return isUuid(value.tenantId) &&
      isUuid(value.entryId) &&
      (value.requesterId === undefined ||
        value.requesterId === null ||
        isUuid(value.requesterId)) &&
      onlyKeys(value, ["type", "tenantId", "entryId", "requesterId"])
      ? {
          type: value.type,
          tenantId: value.tenantId.toLowerCase(),
          entryId: value.entryId.toLowerCase(),
          requesterId:
            typeof value.requesterId === "string"
              ? value.requesterId.toLowerCase()
              : null,
        }
      : null;
  }
  if (value.type === "createReturnTasks") {
    const ids = Array.isArray(value.assignmentIds) ? value.assignmentIds : [];
    const optionalIds = (entry: unknown): string[] | null =>
      entry === undefined
        ? []
        : Array.isArray(entry) && entry.every(isUuid)
          ? [...new Set(entry.map((id) => String(id).toLowerCase()))]
          : null;
    const loanLineIds = optionalIds(value.loanLineIds);
    const licenseAssignmentIds = optionalIds(value.licenseAssignmentIds);
    const uniqueIds = [...new Set(ids.map((id) => String(id).toLowerCase()))];
    const total =
      uniqueIds.length +
      (loanLineIds?.length ?? 0) +
      (licenseAssignmentIds?.length ?? 0);
    return isUuid(value.tenantId) &&
      isUuid(value.entryId) &&
      Array.isArray(value.assignmentIds) &&
      ids.every(isUuid) &&
      loanLineIds !== null &&
      licenseAssignmentIds !== null &&
      total >= 1 &&
      ids.length +
        (loanLineIds?.length ?? 0) +
        (licenseAssignmentIds?.length ?? 0) <=
        MAX_RETURN_TASKS &&
      (value.returnLocationId === undefined ||
        value.returnLocationId === null ||
        isUuid(value.returnLocationId)) &&
      onlyKeys(value, [
        "type",
        "tenantId",
        "entryId",
        "assignmentIds",
        "loanLineIds",
        "licenseAssignmentIds",
        "returnLocationId",
      ])
      ? {
          type: value.type,
          tenantId: value.tenantId.toLowerCase(),
          entryId: value.entryId.toLowerCase(),
          assignmentIds: uniqueIds,
          ...(loanLineIds?.length ? { loanLineIds } : {}),
          ...(licenseAssignmentIds?.length ? { licenseAssignmentIds } : {}),
          ...(isUuid(value.returnLocationId)
            ? { returnLocationId: value.returnLocationId.toLowerCase() }
            : {}),
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
/**
 * Number of upcoming entries nobody has started on yet (all tasks still
 * open). Only people who manage onboarding see the badge.
 */
async function navigationSummary(
  client: Client,
  admin: Admin,
  tenantId: string,
) {
  await requireMembership(client, tenantId);
  if (!(await hasPermission(client, tenantId, "onboarding.manage"))) {
    return { attentionCount: 0, canAccess: false };
  }
  const today = new Date().toISOString().slice(0, 10);
  const { data: entries, error } = await admin
    .from("onboarding_entries")
    .select("id")
    .eq("tenant_id", tenantId)
    .gte("starts_on", today)
    .limit(500);
  if (error) databaseFailure(error);
  const ids = (entries ?? [])
    .map((row: Row) => row.id)
    .filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return { attentionCount: 0, canAccess: true };
  const { data: started, error: tasksError } = await admin
    .from("onboarding_tasks")
    .select("entry_id")
    .eq("tenant_id", tenantId)
    .in("entry_id", ids)
    .neq("status", "open")
    .limit(5000);
  if (tasksError) databaseFailure(tasksError);
  const startedIds = new Set(
    (started ?? []).map((row: Row) => String(row.entry_id)),
  );
  return {
    attentionCount: ids.filter((id) => !startedIds.has(id)).length,
    canAccess: true,
  };
}

async function actorDepartmentIds(
  admin: Admin,
  tenantId: string,
  actorId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from("department_memberships")
    .select("department_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .limit(200);
  if (error) databaseFailure(error);
  return (data ?? [])
    .map((row: Row) => row.department_id)
    .filter((id): id is string => typeof id === "string");
}
async function entryIdsForDepartments(
  admin: Admin,
  tenantId: string,
  departmentIds: string[],
): Promise<string[]> {
  const { data, error } = await admin
    .from("onboarding_tasks")
    .select("entry_id")
    .eq("tenant_id", tenantId)
    .in("department_id", departmentIds)
    .limit(1000);
  if (error) databaseFailure(error);
  return [
    ...new Set(
      (data ?? [])
        .map((row: Row) => row.entry_id)
        .filter((id): id is string => isUuid(id)),
    ),
  ].slice(0, 200);
}
async function departmentNamesForTenant(
  admin: Admin,
  tenantId: string,
): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from("departments")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .limit(500);
  if (error) databaseFailure(error);
  return new Map(
    (data ?? [])
      .filter((row: Row) => typeof row.id === "string")
      .map((row: Row) => [String(row.id), String(row.name)]),
  );
}
async function listDepartmentTasks(
  client: Client,
  admin: Admin,
  tenantId: string,
) {
  await requirePermission(client, tenantId, "onboarding.manage");
  const [{ data, error }, departments] = await Promise.all([
    admin
      .from("onboarding_department_tasks")
      .select(
        "id, kind, department_id, title, due_offset_days, active, position",
      )
      .eq("tenant_id", tenantId)
      .order("kind")
      .order("position")
      .limit(500),
    admin
      .from("departments")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name")
      .limit(500),
  ]);
  if (error) databaseFailure(error);
  if (departments.error) databaseFailure(departments.error);
  return {
    departments: (departments.data ?? []).map((row: Row) => ({
      id: String(row.id),
      name: String(row.name),
    })),
    tasks: (data ?? []).map((row: Row) => ({
      id: String(row.id),
      kind: row.kind === "offboarding" ? "offboarding" : "onboarding",
      departmentId: String(row.department_id),
      title: String(row.title),
      dueOffsetDays: Number(row.due_offset_days),
      active: row.active === true,
    })),
  };
}
async function saveDepartmentTask(
  client: Client,
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "saveDepartmentTask" }>,
) {
  await requirePermission(client, action.tenantId, "onboarding.manage");
  const { data: department, error: departmentError } = await admin
    .from("departments")
    .select("id")
    .eq("tenant_id", action.tenantId)
    .eq("id", action.departmentId)
    .maybeSingle();
  if (departmentError) databaseFailure(departmentError);
  if (!department)
    throw new HttpError(
      422,
      "onboarding_department_invalid",
      "Die Abteilung gehört nicht zu diesem Mandanten.",
    );
  const values = {
    tenant_id: action.tenantId,
    kind: action.kind,
    department_id: action.departmentId,
    title: action.title,
    due_offset_days: action.dueOffsetDays,
    active: action.active,
    updated_at: new Date().toISOString(),
  };
  const result = action.id
    ? await admin
        .from("onboarding_department_tasks")
        .update(values)
        .eq("tenant_id", action.tenantId)
        .eq("id", action.id)
        .select("id")
        .maybeSingle()
    : await admin
        .from("onboarding_department_tasks")
        .insert({ ...values, created_by: actorId })
        .select("id")
        .single();
  if (result.error) databaseFailure(result.error);
  if (!result.data)
    throw new HttpError(
      404,
      "onboarding_department_task_not_found",
      "Die Teilaufgabe ist nicht mehr vorhanden.",
    );
  await audit(
    admin,
    action.tenantId,
    actorId,
    "onboarding.department_task.saved",
    "onboarding_department_task",
    String(result.data.id),
    { kind: action.kind, departmentId: action.departmentId },
  );
  return { id: String(result.data.id) };
}
async function deleteDepartmentTask(
  client: Client,
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "deleteDepartmentTask" }>,
) {
  await requirePermission(client, action.tenantId, "onboarding.manage");
  const { error } = await admin
    .from("onboarding_department_tasks")
    .delete()
    .eq("tenant_id", action.tenantId)
    .eq("id", action.id);
  if (error) databaseFailure(error);
  await audit(
    admin,
    action.tenantId,
    actorId,
    "onboarding.department_task.deleted",
    "onboarding_department_task",
    action.id,
    {},
  );
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
      "id, employee_name, starts_on, organisation_unit, location, manager_user_id, ict_responsible_user_id, created_by, template_id, source, details, source_ticket_number, kind",
    )
    .eq("tenant_id", tenantId)
    .order("starts_on")
    .order("created_at", { ascending: false })
    .limit(250);
  const myDepartments = await actorDepartmentIds(admin, tenantId, actorId);
  if (!canManage) {
    // Entries with a sub-task of one of the person's departments are visible
    // to that department too.
    const departmentEntryIds = myDepartments.length
      ? await entryIdsForDepartments(admin, tenantId, myDepartments)
      : [];
    entriesQuery = entriesQuery.or(
      [
        `created_by.eq.${actorId}`,
        `manager_user_id.eq.${actorId}`,
        `ict_responsible_user_id.eq.${actorId}`,
        ...(departmentEntryIds.length
          ? [`id.in.(${departmentEntryIds.join(",")})`]
          : []),
      ].join(","),
    );
  }
  const departmentNames = await departmentNamesForTenant(admin, tenantId);
  const { data: entryRows, error: entriesError } = await entriesQuery;
  if (entriesError) databaseFailure(entriesError);
  const entries = (entryRows ?? []).filter(
    (row: Row) => typeof row.id === "string",
  ) as Row[];
  if (focusEntryId && !entries.some((entry) => entry.id === focusEntryId)) {
    const { data: focusedEntry, error: focusedEntryError } = await admin
      .from("onboarding_entries")
      .select(
        "id, employee_name, starts_on, organisation_unit, location, manager_user_id, ict_responsible_user_id, created_by, template_id, source, details, source_ticket_number, kind",
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
            "id, entry_id, title, due_on, responsible_user_id, department_id, status, position",
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
      kind: entry.kind === "offboarding" ? "offboarding" : "onboarding",
      canEdit:
        canManage ||
        [
          entry.created_by,
          entry.manager_user_id,
          entry.ict_responsible_user_id,
        ].includes(actorId),
      source: entry.source === "email" ? "email" : "manual",
      sourceTicketNumber:
        typeof entry.source_ticket_number === "string"
          ? entry.source_ticket_number
          : null,
      details:
        typeof entry.details === "object" &&
        entry.details !== null &&
        !Array.isArray(entry.details)
          ? entry.details
          : {},
      tasks: (tasksByEntry.get(String(entry.id)) ?? []).map((task) => ({
        id: String(task.id),
        title: String(task.title),
        dueOn: String(task.due_on),
        responsibleName:
          typeof task.department_id === "string" && !task.responsible_user_id
            ? (departmentNames.get(task.department_id) ?? "Abteilung")
            : (peopleResult.names.get(String(task.responsible_user_id)) ??
              "Verantwortliche Person"),
        departmentId:
          typeof task.department_id === "string" ? task.department_id : null,
        departmentName:
          typeof task.department_id === "string"
            ? (departmentNames.get(task.department_id) ?? "Abteilung")
            : null,
        status: String(task.status),
        canUpdate:
          canManage ||
          task.responsible_user_id === actorId ||
          (typeof task.department_id === "string" &&
            myDepartments.includes(task.department_id)),
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
  const { data, error } = await admin.rpc("create_onboarding_entry_with_kind", {
    p_tenant_id: action.tenantId,
    p_employee_name: action.employeeName,
    p_starts_on: action.startsOn,
    p_organisation_unit: action.organisationUnit,
    p_location: action.location,
    p_manager_user_id: action.managerUserId,
    p_ict_responsible_user_id: action.ictResponsibleUserId,
    p_template_id: action.templateId,
    p_actor_id: actorId,
    p_kind: action.kind,
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
    .select("id, responsible_user_id, department_id, entry_id")
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
  const departmentMember =
    typeof task.department_id === "string" &&
    (await actorDepartmentIds(admin, action.tenantId, actorId)).includes(
      task.department_id,
    );
  if (!canManage && task.responsible_user_id !== actorId && !departmentMember)
    throw new HttpError(
      403,
      "onboarding_permission_denied",
      msg(
        "Für diese Aufgabe fehlt dir die erforderliche Berechtigung.",
        "Für diese Aufgabe fehlt Ihnen die erforderliche Berechtigung.",
      ),
    );
  const { error } = await admin
    .from("onboarding_tasks")
    .update({
      status: action.status,
      completed_at:
        action.status === "completed" ? new Date().toISOString() : null,
      // Wer abschliesst, bucht Rücknahmen ins Lager (Trigger 0314).
      completed_by: action.status === "completed" ? actorId : null,
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
      msg(
        "Für diesen Eintritt fehlt dir die erforderliche Berechtigung.",
        "Für diesen Eintritt fehlt Ihnen die erforderliche Berechtigung.",
      ),
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

type ReturnEntry = {
  id: string;
  employeeName: string;
  startsOn: string;
  ictResponsibleUserId: string;
};
/**
 * Device returns belong to an offboarding entry. Like the other entry-level
 * writes, onboarding managers and the entry's creator, manager or ICT
 * responsible person may use them.
 */
async function requireOffboardingEntry(
  client: Client,
  admin: Admin,
  actorId: string,
  tenantId: string,
  entryId: string,
): Promise<ReturnEntry> {
  await requireMembership(client, tenantId);
  const canManage = await hasPermission(client, tenantId, "onboarding.manage");
  const { data: entry, error } = await admin
    .from("onboarding_entries")
    .select(
      "id, kind, employee_name, starts_on, created_by, manager_user_id, ict_responsible_user_id",
    )
    .eq("tenant_id", tenantId)
    .eq("id", entryId)
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!entry)
    throw new HttpError(
      404,
      "onboarding_entry_not_found",
      "Der Austritt ist nicht mehr verfügbar.",
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
      msg(
        "Für diesen Austritt fehlt dir die erforderliche Berechtigung.",
        "Für diesen Austritt fehlt Ihnen die erforderliche Berechtigung.",
      ),
    );
  if (entry.kind !== "offboarding")
    throw new HttpError(
      422,
      "onboarding_not_offboarding",
      "Geräte-Rückgaben gibt es nur bei Austritten.",
    );
  return {
    id: String(entry.id),
    employeeName: String(entry.employee_name),
    startsOn: String(entry.starts_on),
    ictResponsibleUserId: String(entry.ict_responsible_user_id),
  };
}
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
type Requester = { id: string; displayName: string; email: string | null };
function asRequester(row: Row): Requester {
  return {
    id: String(row.id),
    displayName:
      typeof row.display_name === "string" && row.display_name.trim()
        ? row.display_name.trim()
        : "Ohne Namen",
    email: typeof row.email === "string" ? row.email : null,
  };
}
function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}
async function requestersByIds(
  admin: Admin,
  tenantId: string,
  ids: string[],
): Promise<Requester[]> {
  const rows: Row[] = [];
  for (const part of chunks(ids, 200)) {
    const { data, error } = await admin
      .from("ticket_requesters")
      .select("id, display_name, email")
      .eq("tenant_id", tenantId)
      .in("id", part)
      .limit(part.length);
    if (error) databaseFailure(error);
    rows.push(...((data ?? []) as Row[]));
  }
  return rows.map(asRequester);
}
async function offboardingAssets(
  client: Client,
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "offboardingAssets" }>,
) {
  const entry = await requireOffboardingEntry(
    client,
    admin,
    actorId,
    action.tenantId,
    action.entryId,
  );
  // Candidates by name: a broad ILIKE narrows the rows, the exact comparison
  // (trimmed, case-insensitive) decides.
  const pattern = `%${escapeLike(entry.employeeName.trim()).replace(/\s+/g, "%")}%`;
  const { data: nameRows, error: nameError } = await admin
    .from("ticket_requesters")
    .select("id, display_name, email")
    .eq("tenant_id", action.tenantId)
    .ilike("display_name", pattern)
    .limit(50);
  if (nameError) databaseFailure(nameError);
  const matches = ((nameRows ?? []) as Row[])
    .filter((row) => namesMatch(row.display_name, entry.employeeName))
    .map(asRequester);
  let selectedRequesterId: string | null = null;
  if (action.requesterId) {
    const known = await requestersByIds(admin, action.tenantId, [
      action.requesterId,
    ]);
    if (!known.length)
      throw new HttpError(
        422,
        "onboarding_reference_invalid",
        "Die gewählte Person ist nicht mehr verfügbar.",
      );
    selectedRequesterId = action.requesterId;
  } else if (matches.length === 1) {
    selectedRequesterId = matches[0].id;
  }
  // Without a unique name match the picker offers everybody who currently
  // holds a device.
  let requesters: Requester[] = [];
  if (matches.length !== 1) {
    const { data: holderRows, error: holderError } = await admin
      .from("asset_assignments")
      .select("requester_id")
      .eq("tenant_id", action.tenantId)
      .is("returned_at", null)
      .limit(5000);
    if (holderError) databaseFailure(holderError);
    const holderIds = [
      ...new Set(
        ((holderRows ?? []) as Row[])
          .map((row) => row.requester_id)
          .filter((id): id is string => isUuid(id)),
      ),
    ];
    requesters = (await requestersByIds(admin, action.tenantId, holderIds))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "de-CH"))
      .slice(0, 1000);
  }
  // Return tasks already created for this entry stay visible after the
  // device came back.
  const { data: entryTasks, error: entryTasksError } = await admin
    .from("onboarding_tasks")
    .select("id")
    .eq("tenant_id", action.tenantId)
    .eq("entry_id", entry.id)
    .limit(200);
  if (entryTasksError) databaseFailure(entryTasksError);
  const entryTaskIds = ((entryTasks ?? []) as Row[]).map((row) =>
    String(row.id),
  );
  const { data: entryLinks, error: entryLinksError } = entryTaskIds.length
    ? await admin
        .from("onboarding_asset_returns")
        .select("assignment_id")
        .eq("tenant_id", action.tenantId)
        .in("task_id", entryTaskIds)
        .limit(200)
    : { data: [], error: null };
  if (entryLinksError) databaseFailure(entryLinksError);
  const linkedAssignmentIds = ((entryLinks ?? []) as Row[]).map((row) =>
    String(row.assignment_id),
  );
  const assignmentRows: Row[] = [];
  if (selectedRequesterId) {
    const { data, error } = await admin
      .from("asset_assignments")
      .select("id, asset_id, requester_id, assigned_at, returned_at")
      .eq("tenant_id", action.tenantId)
      .eq("requester_id", selectedRequesterId)
      .is("returned_at", null)
      .order("assigned_at")
      .limit(200);
    if (error) databaseFailure(error);
    assignmentRows.push(...((data ?? []) as Row[]));
  }
  const missingLinked = linkedAssignmentIds.filter(
    (id) => !assignmentRows.some((row) => row.id === id),
  );
  if (missingLinked.length) {
    const { data, error } = await admin
      .from("asset_assignments")
      .select("id, asset_id, requester_id, assigned_at, returned_at")
      .eq("tenant_id", action.tenantId)
      .in("id", missingLinked)
      .limit(missingLinked.length);
    if (error) databaseFailure(error);
    assignmentRows.push(...((data ?? []) as Row[]));
  }
  const assignmentIds = assignmentRows.map((row) => String(row.id));
  const assetIds = [
    ...new Set(assignmentRows.map((row) => String(row.asset_id))),
  ];
  const [assetsResult, linksResult] = await Promise.all([
    assetIds.length
      ? admin
          .from("assets")
          .select("id, name, inventory_number, serial_number")
          .eq("tenant_id", action.tenantId)
          .in("id", assetIds)
          .limit(assetIds.length)
      : Promise.resolve({ data: [] as Row[], error: null }),
    assignmentIds.length
      ? admin
          .from("onboarding_asset_returns")
          .select("assignment_id, task_id")
          .eq("tenant_id", action.tenantId)
          .in("assignment_id", assignmentIds)
          .limit(assignmentIds.length)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  if (assetsResult.error) databaseFailure(assetsResult.error);
  if (linksResult.error) databaseFailure(linksResult.error);
  const linkRows = (linksResult.data ?? []) as Row[];
  const linkTaskIds = linkRows.map((row) => String(row.task_id));
  const { data: linkTasks, error: linkTasksError } = linkTaskIds.length
    ? await admin
        .from("onboarding_tasks")
        .select("id, entry_id, status")
        .eq("tenant_id", action.tenantId)
        .in("id", linkTaskIds)
        .limit(linkTaskIds.length)
    : { data: [], error: null };
  if (linkTasksError) databaseFailure(linkTasksError);
  const tasksById = new Map(
    ((linkTasks ?? []) as Row[]).map((row) => [String(row.id), row]),
  );
  const taskByAssignment = new Map(
    linkRows.map((row) => [
      String(row.assignment_id),
      tasksById.get(String(row.task_id)),
    ]),
  );
  const assetsById = new Map(
    ((assetsResult.data ?? []) as Row[]).map((row) => [String(row.id), row]),
  );
  let extras: Awaited<ReturnType<typeof loadOffboardingExtras>>;
  try {
    extras = await loadOffboardingExtras(
      admin,
      action.tenantId,
      entry.id,
      entryTaskIds,
      selectedRequesterId,
    );
  } catch (cause) {
    if (cause instanceof ExtrasDatabaseError)
      databaseFailure(cause.databaseError as { code?: string });
    throw cause;
  }
  return {
    entry: { id: entry.id, employeeName: entry.employeeName },
    matches,
    requesters,
    selectedRequesterId,
    ...extras,
    assets: assignmentRows.map((row) => {
      const asset: Row = assetsById.get(String(row.asset_id)) ?? {};
      const task = taskByAssignment.get(String(row.id));
      return {
        assignmentId: String(row.id),
        assetId: String(row.asset_id),
        name: typeof asset.name === "string" ? asset.name : "Gerät",
        inventoryNumber:
          typeof asset.inventory_number === "string"
            ? asset.inventory_number
            : null,
        serialNumber:
          typeof asset.serial_number === "string" ? asset.serial_number : null,
        assignedAt: String(row.assigned_at),
        returnedAt:
          typeof row.returned_at === "string" ? row.returned_at : null,
        returnTask: task
          ? {
              taskId: String(task.id),
              status: String(task.status),
              sameEntry: task.entry_id === entry.id,
            }
          : null,
      };
    }),
  };
}
async function createReturnTasks(
  client: Client,
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "createReturnTasks" }>,
) {
  const entry = await requireOffboardingEntry(
    client,
    admin,
    actorId,
    action.tenantId,
    action.entryId,
  );
  const loanLineIds = action.loanLineIds ?? [];
  const licenseIds = action.licenseAssignmentIds ?? [];
  const found: Row[] = [];
  if (action.assignmentIds.length) {
    const { data: assignments, error: assignmentsError } = await admin
      .from("asset_assignments")
      .select("id, asset_id")
      .eq("tenant_id", action.tenantId)
      .in("id", action.assignmentIds)
      .is("returned_at", null)
      .limit(action.assignmentIds.length);
    if (assignmentsError) databaseFailure(assignmentsError);
    found.push(...((assignments ?? []) as Row[]));
    if (found.length !== action.assignmentIds.length)
      throw new HttpError(
        422,
        "onboarding_assignment_invalid",
        "Mindestens eine Gerätezuweisung ist nicht mehr aktiv.",
      );
  }
  const loanLines: Row[] = [];
  if (loanLineIds.length) {
    const { data, error } = await admin
      .from("shop_order_lines")
      .select("id, order_id, item_name")
      .eq("tenant_id", action.tenantId)
      .in("id", loanLineIds)
      .eq("kind", "loan")
      .eq("status", "issued")
      .limit(loanLineIds.length);
    if (error) databaseFailure(error);
    loanLines.push(...((data ?? []) as Row[]));
    if (loanLines.length !== loanLineIds.length)
      throw new HttpError(
        422,
        "onboarding_loan_invalid",
        "Mindestens eine Ausleihe ist nicht mehr offen.",
      );
  }
  const seats: Row[] = [];
  if (licenseIds.length) {
    const { data, error } = await admin
      .from("license_assignments")
      .select("id, license_id")
      .eq("tenant_id", action.tenantId)
      .in("id", licenseIds)
      .is("released_at", null)
      .limit(licenseIds.length);
    if (error) databaseFailure(error);
    seats.push(...((data ?? []) as Row[]));
    if (seats.length !== licenseIds.length)
      throw new HttpError(
        422,
        "onboarding_license_invalid",
        "Mindestens eine Lizenzzuweisung ist nicht mehr aktiv.",
      );
  }
  if (action.returnLocationId) {
    const { data, error } = await admin
      .from("inventory_locations")
      .select("id")
      .eq("tenant_id", action.tenantId)
      .eq("id", action.returnLocationId)
      .eq("active", true)
      .maybeSingle();
    if (error) databaseFailure(error);
    if (!data)
      throw new HttpError(
        422,
        "onboarding_location_invalid",
        "Der gewählte Lagerort ist nicht mehr verfügbar.",
      );
  }
  const [existingAssets, existingLoans, existingSeats] = await Promise.all([
    action.assignmentIds.length
      ? admin
          .from("onboarding_asset_returns")
          .select("assignment_id")
          .eq("tenant_id", action.tenantId)
          .in("assignment_id", action.assignmentIds)
          .limit(action.assignmentIds.length)
      : Promise.resolve({ data: [] as Row[], error: null }),
    loanLineIds.length
      ? admin
          .from("onboarding_loan_returns")
          .select("order_line_id")
          .eq("tenant_id", action.tenantId)
          .in("order_line_id", loanLineIds)
          .limit(loanLineIds.length)
      : Promise.resolve({ data: [] as Row[], error: null }),
    licenseIds.length
      ? admin
          .from("onboarding_license_revocations")
          .select("license_assignment_id")
          .eq("tenant_id", action.tenantId)
          .in("license_assignment_id", licenseIds)
          .limit(licenseIds.length)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  for (const result of [existingAssets, existingLoans, existingSeats])
    if (result.error) databaseFailure(result.error);
  const linked = new Set(
    ((existingAssets.data ?? []) as Row[]).map((row) =>
      String(row.assignment_id),
    ),
  );
  const linkedLoans = new Set(
    ((existingLoans.data ?? []) as Row[]).map((row) =>
      String(row.order_line_id),
    ),
  );
  const linkedSeats = new Set(
    ((existingSeats.data ?? []) as Row[]).map((row) =>
      String(row.license_assignment_id),
    ),
  );
  const skipped = linked.size + linkedLoans.size + linkedSeats.size;
  // Keep the order in which the devices were listed.
  const pendingAssignments = action.assignmentIds
    .filter((id) => !linked.has(id))
    .map((id) => found.find((row) => row.id === id) as Row);
  const pendingLoans = loanLineIds
    .filter((id) => !linkedLoans.has(id))
    .map((id) => loanLines.find((row) => row.id === id) as Row);
  const pendingSeats = licenseIds
    .filter((id) => !linkedSeats.has(id))
    .map((id) => seats.find((row) => row.id === id) as Row);
  const pendingCount =
    pendingAssignments.length + pendingLoans.length + pendingSeats.length;
  if (!pendingCount) return { created: 0, skipped };
  const assetIds = [
    ...new Set(pendingAssignments.map((row) => String(row.asset_id))),
  ];
  const orderIds = [
    ...new Set(pendingLoans.map((row) => String(row.order_id))),
  ];
  const titleLicenseIds = [
    ...new Set(pendingSeats.map((row) => String(row.license_id))),
  ];
  const [assetsResult, ordersResult, licensesResult, lastTask] =
    await Promise.all([
      assetIds.length
        ? admin
            .from("assets")
            .select("id, name, inventory_number, serial_number")
            .eq("tenant_id", action.tenantId)
            .in("id", assetIds)
            .limit(assetIds.length)
        : Promise.resolve({ data: [] as Row[], error: null }),
      orderIds.length
        ? admin
            .from("shop_orders")
            .select("id, order_number")
            .eq("tenant_id", action.tenantId)
            .in("id", orderIds)
            .limit(orderIds.length)
        : Promise.resolve({ data: [] as Row[], error: null }),
      titleLicenseIds.length
        ? admin
            .from("licenses")
            .select("id, title")
            .eq("tenant_id", action.tenantId)
            .in("id", titleLicenseIds)
            .limit(titleLicenseIds.length)
        : Promise.resolve({ data: [] as Row[], error: null }),
      admin
        .from("onboarding_tasks")
        .select("position")
        .eq("tenant_id", action.tenantId)
        .eq("entry_id", entry.id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  for (const result of [assetsResult, ordersResult, licensesResult, lastTask])
    if (result.error) databaseFailure(result.error);
  const assetsById = new Map(
    ((assetsResult.data ?? []) as Row[]).map((row) => [String(row.id), row]),
  );
  const orderNumbers = new Map(
    ((ordersResult.data ?? []) as Row[]).map((row) => [
      String(row.id),
      String(row.order_number),
    ]),
  );
  const licenseTitles = new Map(
    ((licensesResult.data ?? []) as Row[]).map((row) => [
      String(row.id),
      String(row.title),
    ]),
  );
  const startPosition = Number(lastTask.data?.position ?? 0);
  if (startPosition + pendingCount > 100)
    throw new HttpError(
      422,
      "onboarding_task_limit",
      "Dieser Austritt hat zu viele Aufgaben für weitere Rückgaben.",
    );
  const task = (title: string, index: number) => ({
    id: crypto.randomUUID(),
    tenant_id: action.tenantId,
    entry_id: entry.id,
    title,
    due_on: entry.startsOn,
    responsible_user_id: entry.ictResponsibleUserId,
    position: startPosition + index + 1,
  });
  const assetTasks = pendingAssignments.map((assignment, index) => {
    const asset: Row = assetsById.get(String(assignment.asset_id)) ?? {};
    return task(
      returnTaskTitle({
        name: asset.name,
        inventoryNumber: asset.inventory_number,
        serialNumber: asset.serial_number,
      }),
      index,
    );
  });
  const loanTasks = pendingLoans.map((line, index) =>
    task(
      loanReturnTaskTitle(
        String(line.item_name),
        orderNumbers.get(String(line.order_id)) ?? null,
      ),
      pendingAssignments.length + index,
    ),
  );
  const seatTasks = pendingSeats.map((seat, index) =>
    task(
      licenseRevocationTaskTitle(
        licenseTitles.get(String(seat.license_id)) ?? "Lizenz",
      ),
      pendingAssignments.length + pendingLoans.length + index,
    ),
  );
  const tasks = [...assetTasks, ...loanTasks, ...seatTasks];
  const { error: tasksError } = await admin
    .from("onboarding_tasks")
    .insert(tasks);
  if (tasksError) databaseFailure(tasksError);
  const returnLocationId = action.returnLocationId ?? null;
  const linkResults = await Promise.all([
    assetTasks.length
      ? admin.from("onboarding_asset_returns").insert(
          assetTasks.map((created, index) => ({
            tenant_id: action.tenantId,
            task_id: created.id,
            assignment_id: String(pendingAssignments[index].id),
            asset_id: String(pendingAssignments[index].asset_id),
            return_location_id: returnLocationId,
          })),
        )
      : Promise.resolve({ error: null }),
    loanTasks.length
      ? admin.from("onboarding_loan_returns").insert(
          loanTasks.map((created, index) => ({
            tenant_id: action.tenantId,
            task_id: created.id,
            order_line_id: String(pendingLoans[index].id),
            return_location_id: returnLocationId,
          })),
        )
      : Promise.resolve({ error: null }),
    seatTasks.length
      ? admin.from("onboarding_license_revocations").insert(
          seatTasks.map((created, index) => ({
            tenant_id: action.tenantId,
            task_id: created.id,
            license_assignment_id: String(pendingSeats[index].id),
          })),
        )
      : Promise.resolve({ error: null }),
  ]);
  const linksError = linkResults.find((result) => result.error)?.error;
  if (linksError) {
    // A parallel request linked the same item first: remove the tasks of
    // this attempt so no unlinked task remains (links cascade with them).
    await admin
      .from("onboarding_tasks")
      .delete()
      .eq("tenant_id", action.tenantId)
      .in(
        "id",
        tasks.map((created) => created.id),
      );
    databaseFailure(linksError);
  }
  await audit(
    admin,
    action.tenantId,
    actorId,
    "onboarding.asset_return_tasks.created",
    "onboarding_entry",
    entry.id,
    {
      created: tasks.length,
      skipped,
      devices: assetTasks.length,
      loans: loanTasks.length,
      licenses: seatTasks.length,
    },
  );
  return { created: tasks.length, skipped };
}

const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    try {
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
      const moduleStates = await resolveUserFeatureStates(
        context.supabaseAdmin,
        action.tenantId,
        actorId,
        ["onboarding.entries"],
      );
      if (moduleStates?.["onboarding.entries"] !== true)
        throw new HttpError(
          403,
          "onboarding_feature_disabled",
          msg(
          "Die Eintritte sind für dich nicht eingeschaltet.",
          "Die Eintritte sind für Sie nicht eingeschaltet.",
        ),
        );
      if (action.type === "navigationSummary")
        return json(request, {
          data: await navigationSummary(
            context.supabase,
            context.supabaseAdmin,
            action.tenantId,
          ),
        });
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
      if (action.type === "listDepartmentTasks")
        return json(request, {
          data: await listDepartmentTasks(
            context.supabase,
            context.supabaseAdmin,
            action.tenantId,
          ),
        });
      if (action.type === "saveDepartmentTask")
        return json(request, {
          data: await saveDepartmentTask(
            context.supabase,
            context.supabaseAdmin,
            actorId,
            action,
          ),
        });
      if (action.type === "deleteDepartmentTask") {
        await deleteDepartmentTask(
          context.supabase,
          context.supabaseAdmin,
          actorId,
          action,
        );
        return json(request, { data: { deleted: true } });
      }
      if (action.type === "updateTaskStatus") {
        await updateTaskStatus(
          context.supabase,
          context.supabaseAdmin,
          actorId,
          action,
        );
        return json(request, { data: { updated: true } });
      }
      if (action.type === "offboardingAssets")
        return json(request, {
          data: await offboardingAssets(
            context.supabase,
            context.supabaseAdmin,
            actorId,
            action,
          ),
        });
      if (action.type === "createReturnTasks")
        return json(
          request,
          {
            data: await createReturnTasks(
              context.supabase,
              context.supabaseAdmin,
              actorId,
              action,
            ),
          },
          201,
        );
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
    // withSupabase authenticates before its callback. Browser preflight requests
    // have no Bearer token, so they must be answered before entering that layer.
    if (request.method === "OPTIONS") return json(request, {}, 204);
    if (request.method !== "POST")
      return json(request, { error: { code: "method_not_allowed" } }, 405);
    if (!request.headers.get("authorization")?.trim())
      return failure(
        request,
        new HttpError(
          401,
          "authentication_required",
          "Eine gültige Benutzeranmeldung ist erforderlich.",
        ),
      );
    return handler(request);
  },
};
