import { type SupabaseContext, withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ORIGIN = "https://app.nextdesk.ch";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = ["draft", "active", "terminated", "archived"] as const;
type Status = (typeof STATUSES)[number];
// Built-in keys (service, license, …) or a custom type name.
type ContractType = string;
type Row = Record<string, unknown>;
type Admin = SupabaseContext["supabaseAdmin"];
type Values = {
  title: string;
  counterpartyName: string;
  referenceNumber: string | null;
  contractType: ContractType;
  status: Exclude<Status, "archived">;
  startsOn: string | null;
  endsOn: string | null;
  noticePeriodDays: number | null;
  reminderDaysBefore: number | null;
  responsibleUserId: string | null;
  notes: string | null;
};
type Action =
  | { type: "list"; tenantId: string; includeArchived: boolean }
  | { type: "listPeople"; tenantId: string }
  | { type: "create"; tenantId: string; values: Values }
  | { type: "update"; tenantId: string; contractId: string; values: Values }
  | { type: "archive"; tenantId: string; contractId: string };

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
const cleanText = (value: unknown, min: number, max: number): string | null => {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    value.includes("\u0000")
  )
    return null;
  const text = value.trim().replace(/\s+/g, " ");
  const length = Array.from(text).length;
  return length >= min && length <= max ? text : null;
};
const optionalText = (
  value: unknown,
  max: number,
): string | null | undefined => {
  if (value === null || value === "") return null;
  return cleanText(value, 1, max) ?? undefined;
};
const optionalDate = (value: unknown): string | null | undefined => {
  if (value === null || value === "") return null;
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    ? value
    : undefined;
};
function parseValues(value: unknown): Values | null {
  if (
    !isRecord(value) ||
    !Object.keys(value).every((key) =>
      [
        "title",
        "counterpartyName",
        "referenceNumber",
        "contractType",
        "status",
        "startsOn",
        "endsOn",
        "noticePeriodDays",
        "reminderDaysBefore",
        "responsibleUserId",
        "notes",
      ].includes(key),
    )
  )
    return null;
  const title = cleanText(value.title, 3, 240);
  const counterpartyName = cleanText(value.counterpartyName, 2, 160);
  const referenceNumber = optionalText(value.referenceNumber, 120);
  const notes = optionalText(value.notes, 2000);
  // Built-in keys and custom types are both stored as short, cleaned text.
  const customType = cleanText(value.contractType, 1, 60);
  const startsOn = optionalDate(value.startsOn);
  const endsOn = optionalDate(value.endsOn);
  const responsibleUserId =
    value.responsibleUserId === null || value.responsibleUserId === ""
      ? null
      : isUuid(value.responsibleUserId)
        ? value.responsibleUserId.toLowerCase()
        : undefined;
  const noticePeriodDays =
    value.noticePeriodDays === null || value.noticePeriodDays === ""
      ? null
      : typeof value.noticePeriodDays === "number" &&
          Number.isInteger(value.noticePeriodDays) &&
          value.noticePeriodDays >= 0 &&
          value.noticePeriodDays <= 3650
        ? value.noticePeriodDays
        : undefined;
  const reminderDaysBefore =
    value.reminderDaysBefore === null || value.reminderDaysBefore === ""
      ? null
      : typeof value.reminderDaysBefore === "number" &&
          Number.isInteger(value.reminderDaysBefore) &&
          value.reminderDaysBefore >= 1 &&
          value.reminderDaysBefore <= 3650
        ? value.reminderDaysBefore
        : undefined;
  if (
    !title ||
    !counterpartyName ||
    referenceNumber === undefined ||
    notes === undefined ||
    startsOn === undefined ||
    endsOn === undefined ||
    responsibleUserId === undefined ||
    noticePeriodDays === undefined ||
    reminderDaysBefore === undefined ||
    customType === null ||
    !["draft", "active", "terminated"].includes(value.status as string) ||
    (startsOn && endsOn && endsOn < startsOn)
  )
    return null;
  return {
    title,
    counterpartyName,
    referenceNumber,
    contractType: customType,
    status: value.status as Exclude<Status, "archived">,
    startsOn,
    endsOn,
    noticePeriodDays,
    reminderDaysBefore,
    responsibleUserId,
    notes,
  };
}
function parseAction(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    !isUuid(value.tenantId) ||
    typeof value.type !== "string"
  )
    return null;
  const tenantId = value.tenantId.toLowerCase();
  if (
    value.type === "list" &&
    typeof value.includeArchived === "boolean" &&
    Object.keys(value).every((key) =>
      ["type", "tenantId", "includeArchived"].includes(key),
    )
  )
    return { type: "list", tenantId, includeArchived: value.includeArchived };
  if (
    value.type === "listPeople" &&
    Object.keys(value).every((key) => ["type", "tenantId"].includes(key))
  )
    return { type: "listPeople", tenantId };
  if (
    (value.type === "create" || value.type === "update") &&
    isRecord(value.values)
  ) {
    const values = parseValues(value.values);
    if (!values) return null;
    if (
      value.type === "create" &&
      Object.keys(value).every((key) =>
        ["type", "tenantId", "values"].includes(key),
      )
    )
      return { type: "create", tenantId, values };
    if (
      value.type === "update" &&
      isUuid(value.contractId) &&
      Object.keys(value).every((key) =>
        ["type", "tenantId", "contractId", "values"].includes(key),
      )
    )
      return {
        type: "update",
        tenantId,
        contractId: value.contractId.toLowerCase(),
        values,
      };
  }
  if (
    value.type === "archive" &&
    isUuid(value.contractId) &&
    Object.keys(value).every((key) =>
      ["type", "tenantId", "contractId"].includes(key),
    )
  )
    return {
      type: "archive",
      tenantId,
      contractId: value.contractId.toLowerCase(),
    };
  return null;
}
function headers(request: Request): Headers {
  const result = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === ORIGIN) {
    result.set("Access-Control-Allow-Origin", ORIGIN);
    result.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    result.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return result;
}
const reply = (request: Request, body: Row, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: headers(request) });
async function authorize(
  admin: Admin,
  actorId: string,
  tenantId: string,
): Promise<void> {
  const { data, error } = await admin.rpc(
    "has_contracts_management_permission",
    {
      p_tenant_id: tenantId,
      p_user_id: actorId,
    },
  );
  if (error)
    throw new HttpError(
      503,
      "contracts_authorization_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  if (data !== true)
    throw new HttpError(
      403,
      "contracts_manage_required",
      "Die Berechtigung für Verträge fehlt.",
    );

  const feature = await resolveTenantFeatureStates(admin, tenantId, [
    "contracts.management",
  ]);
  if (!feature)
    throw new HttpError(
      503,
      "contracts_unavailable",
      "Die Vertragsverwaltung ist derzeit nicht verfügbar.",
    );
  if (!feature["contracts.management"])
    throw new HttpError(
      403,
      "contracts_feature_disabled",
      "Die Vertragsverwaltung ist für diesen Mandanten nicht aktiviert.",
    );
}
async function assertResponsible(
  admin: Admin,
  tenantId: string,
  userId: string | null,
): Promise<void> {
  if (!userId) return;
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error)
    throw new HttpError(
      503,
      "contracts_unavailable",
      "Die verantwortliche Person konnte nicht geprüft werden.",
    );
  if (!data)
    throw new HttpError(
      422,
      "responsible_user_invalid",
      "Die verantwortliche Person gehört nicht zum aktiven Mandanten.",
    );
}
const rowToContract = (row: Row) => ({
  id: row.id,
  title: row.title,
  counterpartyName: row.counterparty_name,
  referenceNumber: row.reference_number,
  contractType: row.contract_type,
  status: row.status,
  startsOn: row.starts_on,
  endsOn: row.ends_on,
  noticePeriodDays: row.notice_period_days,
  reminderDaysBefore: row.reminder_days_before,
  reminderSentFor: row.reminder_sent_for,
  responsibleUserId: row.responsible_user_id,
  notes: row.notes,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
async function handler(
  request: Request,
  context: SupabaseContext,
): Promise<Response> {
  const actorId = context.userClaims?.id;
  const action = parseAction(await request.json().catch(() => null));
  if (!isUuid(actorId) || !action)
    throw new HttpError(400, "invalid_request", "Die Anfrage ist ungültig.");
  await authorize(context.supabaseAdmin, actorId, action.tenantId);
  if (action.type === "listPeople") {
    const { data, error } = await context.supabaseAdmin
      .from("tenant_memberships")
      .select("user_id, user_profiles!inner(display_name)")
      .eq("tenant_id", action.tenantId)
      .eq("status", "active")
      .order("user_id")
      .limit(500);
    if (error)
      throw new HttpError(
        503,
        "contracts_unavailable",
        "Personen konnten nicht geladen werden.",
      );
    return reply(request, {
      data: {
        people: (data ?? []).map((item: any) => ({
          id: item.user_id,
          displayName: item.user_profiles?.display_name ?? "Unbekannte Person",
        })),
      },
    });
  }
  if (action.type === "list") {
    let query = context.supabaseAdmin
      .from("contracts")
      .select(
        "id, title, counterparty_name, reference_number, contract_type, status, starts_on, ends_on, notice_period_days, reminder_days_before, reminder_sent_for, responsible_user_id, notes, archived_at, created_at, updated_at",
      )
      .eq("tenant_id", action.tenantId)
      .order("ends_on", { ascending: true, nullsFirst: false })
      .order("title")
      .limit(1000);
    if (!action.includeArchived) query = query.neq("status", "archived");
    const { data, error } = await query;
    if (error)
      throw new HttpError(
        503,
        "contracts_unavailable",
        "Verträge konnten nicht geladen werden.",
      );
    return reply(request, {
      data: {
        contracts: (data ?? []).map((item) => rowToContract(item as Row)),
      },
    });
  }
  if (action.type === "create" || action.type === "update") {
    await assertResponsible(
      context.supabaseAdmin,
      action.tenantId,
      action.values.responsibleUserId,
    );
    const payload = {
      tenant_id: action.tenantId,
      title: action.values.title,
      counterparty_name: action.values.counterpartyName,
      reference_number: action.values.referenceNumber,
      contract_type: action.values.contractType,
      status: action.values.status,
      starts_on: action.values.startsOn,
      ends_on: action.values.endsOn,
      notice_period_days: action.values.noticePeriodDays,
      reminder_days_before: action.values.reminderDaysBefore,
      responsible_user_id: action.values.responsibleUserId,
      notes: action.values.notes,
      updated_by: actorId,
    };
    const result =
      action.type === "create"
        ? await context.supabaseAdmin
            .from("contracts")
            .insert({ ...payload, created_by: actorId })
            .select()
            .single()
        : await context.supabaseAdmin
            .from("contracts")
            .update(payload)
            .eq("id", action.contractId)
            .eq("tenant_id", action.tenantId)
            .select()
            .maybeSingle();
    if (result.error)
      throw new HttpError(
        result.error.code === "23505" ? 422 : 503,
        result.error.code === "23505"
          ? "reference_number_taken"
          : "contract_save_failed",
        result.error.code === "23505"
          ? "Die Vertragsnummer wird bereits verwendet."
          : "Der Vertrag konnte nicht gespeichert werden.",
      );
    if (!result.data)
      throw new HttpError(
        404,
        "contract_not_found",
        "Der Vertrag wurde nicht gefunden.",
      );
    return reply(
      request,
      { data: { contract: rowToContract(result.data as Row) } },
      action.type === "create" ? 201 : 200,
    );
  }
  const { data, error } = await context.supabaseAdmin
    .from("contracts")
    .update({ status: "archived", archived_by: actorId, updated_by: actorId })
    .eq("id", action.contractId)
    .eq("tenant_id", action.tenantId)
    .select()
    .maybeSingle();
  if (error)
    throw new HttpError(
      503,
      "contract_archive_failed",
      "Der Vertrag konnte nicht archiviert werden.",
    );
  if (!data)
    throw new HttpError(
      404,
      "contract_not_found",
      "Der Vertrag wurde nicht gefunden.",
    );
  return reply(request, { data: { contract: rowToContract(data as Row) } });
}
const secured = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  handler,
);
export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ORIGIN)
      return reply(request, { error: { code: "origin_not_allowed" } }, 403);
    if (request.method === "OPTIONS")
      return origin === ORIGIN
        ? new Response(null, { status: 204, headers: headers(request) })
        : reply(request, { error: { code: "origin_not_allowed" } }, 403);
    if (
      request.method !== "POST" ||
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return reply(request, { error: { code: "invalid_request" } }, 400);
    try {
      return await secured(request);
    } catch (error) {
      return reply(
        request,
        {
          error: {
            code:
              error instanceof HttpError ? error.code : "contracts_unavailable",
            message:
              error instanceof HttpError
                ? error.message
                : "Die Vertragsverwaltung ist derzeit nicht verfügbar.",
          },
        },
        error instanceof HttpError ? error.status : 503,
      );
    }
  },
};
