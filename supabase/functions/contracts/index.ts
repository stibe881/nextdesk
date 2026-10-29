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
  // undefined: not sent (older clients); an update then leaves it unchanged.
  reminderDaysBefore?: number | null;
  // The fields below are optional so that older clients keep working; an
  // update leaves anything that was not sent unchanged.
  cancelled?: boolean;
  cancelledOn?: string | null;
  costAmount?: number | null;
  costCurrency?: "CHF" | "EUR" | "USD";
  costPeriod?: "one_time" | "monthly" | "quarterly" | "yearly" | null;
  autoRenew?: boolean;
  renewalMonths?: number | null;
  assetIds?: string[];
  responsibleUserId: string | null;
  notes: string | null;
};
type Action =
  | { type: "list"; tenantId: string; includeArchived: boolean }
  | { type: "listPeople"; tenantId: string }
  | { type: "listAssets"; tenantId: string }
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
        "cancelled",
        "cancelledOn",
        "costAmount",
        "costCurrency",
        "costPeriod",
        "autoRenew",
        "renewalMonths",
        "assetIds",
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
  const reminderDaysBefore = !("reminderDaysBefore" in value)
    ? null
    : value.reminderDaysBefore === null || value.reminderDaysBefore === ""
      ? null
      : typeof value.reminderDaysBefore === "number" &&
          Number.isInteger(value.reminderDaysBefore) &&
          value.reminderDaysBefore >= 1 &&
          value.reminderDaysBefore <= 3650
        ? value.reminderDaysBefore
        : undefined;
  const cancelled = "cancelled" in value ? value.cancelled : undefined;
  const cancelledOn = "cancelledOn" in value ? optionalDate(value.cancelledOn) : undefined;
  const costAmount = !("costAmount" in value)
    ? undefined
    : value.costAmount === null || value.costAmount === ""
      ? null
      : typeof value.costAmount === "number" &&
          Number.isFinite(value.costAmount) &&
          value.costAmount >= 0 &&
          value.costAmount <= 9_999_999_999.99
        ? Math.round(value.costAmount * 100) / 100
        : Number.NaN;
  const costCurrency = "costCurrency" in value ? value.costCurrency : undefined;
  const costPeriod = !("costPeriod" in value)
    ? undefined
    : value.costPeriod === null || value.costPeriod === ""
      ? null
      : value.costPeriod;
  const autoRenew = "autoRenew" in value ? value.autoRenew : undefined;
  const renewalMonths = !("renewalMonths" in value)
    ? undefined
    : value.renewalMonths === null || value.renewalMonths === ""
      ? null
      : typeof value.renewalMonths === "number" &&
          Number.isInteger(value.renewalMonths) &&
          value.renewalMonths >= 1 &&
          value.renewalMonths <= 120
        ? value.renewalMonths
        : Number.NaN;
  const assetIds = !("assetIds" in value)
    ? undefined
    : Array.isArray(value.assetIds) &&
        value.assetIds.length <= 100 &&
        value.assetIds.every(isUuid)
      ? [...new Set((value.assetIds as string[]).map((id) => id.toLowerCase()))]
      : null;
  if (
    (cancelled !== undefined && typeof cancelled !== "boolean") ||
    cancelledOn === undefined && "cancelledOn" in value ||
    (cancelledOn && cancelled !== true) ||
    Number.isNaN(costAmount) ||
    (costCurrency !== undefined &&
      !["CHF", "EUR", "USD"].includes(costCurrency as string)) ||
    (costPeriod !== undefined &&
      costPeriod !== null &&
      !["one_time", "monthly", "quarterly", "yearly"].includes(costPeriod as string)) ||
    (costAmount !== undefined && costAmount !== null && !costPeriod) ||
    (autoRenew !== undefined && typeof autoRenew !== "boolean") ||
    Number.isNaN(renewalMonths) ||
    (renewalMonths !== undefined && renewalMonths !== null && autoRenew !== true) ||
    assetIds === null ||
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
    ...("reminderDaysBefore" in value ? { reminderDaysBefore } : {}),
    ...(cancelled !== undefined ? { cancelled: cancelled as boolean } : {}),
    ...(cancelledOn !== undefined ? { cancelledOn } : {}),
    ...(costAmount !== undefined ? { costAmount: costAmount as number | null } : {}),
    ...(costCurrency !== undefined ? { costCurrency: costCurrency as "CHF" | "EUR" | "USD" } : {}),
    ...(costPeriod !== undefined ? { costPeriod: costPeriod as Values["costPeriod"] } : {}),
    ...(autoRenew !== undefined ? { autoRenew: autoRenew as boolean } : {}),
    ...(renewalMonths !== undefined ? { renewalMonths: renewalMonths as number | null } : {}),
    ...(assetIds !== undefined ? { assetIds: assetIds as string[] } : {}),
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
    value.type === "listAssets" &&
    Object.keys(value).every((key) => ["type", "tenantId"].includes(key))
  )
    return { type: "listAssets", tenantId };
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
const rowToContract = (row: Row, assetIds: string[] = []) => ({
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
  cancelled: row.cancelled === true,
  cancelledOn: row.cancelled_on ?? null,
  costAmount: row.cost_amount === null || row.cost_amount === undefined
    ? null
    : Number(row.cost_amount),
  costCurrency: row.cost_currency ?? "CHF",
  costPeriod: row.cost_period ?? null,
  autoRenew: row.auto_renew === true,
  renewalMonths: row.renewal_months ?? null,
  assetIds,
  responsibleUserId: row.responsible_user_id,
  notes: row.notes,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
async function readAssetIds(
  admin: Admin,
  tenantId: string,
  contractIds: string[],
): Promise<Map<string, string[]>> {
  const byContract = new Map<string, string[]>();
  if (contractIds.length === 0) return byContract;
  const { data, error } = await admin
    .from("contract_assets")
    .select("contract_id, asset_id")
    .eq("tenant_id", tenantId)
    .in("contract_id", contractIds)
    .limit(10_000);
  if (error) {
    throw new HttpError(503, "contracts_unavailable", "Verknüpfte Assets konnten nicht geladen werden.");
  }
  for (const link of data ?? []) {
    const row = link as Row;
    const list = byContract.get(String(row.contract_id)) ?? [];
    list.push(String(row.asset_id));
    byContract.set(String(row.contract_id), list);
  }
  return byContract;
}
async function syncAssetLinks(
  admin: Admin,
  tenantId: string,
  contractId: string,
  assetIds: string[],
): Promise<void> {
  if (assetIds.length > 0) {
    const { data, error } = await admin
      .from("assets")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", assetIds);
    if (error) {
      throw new HttpError(503, "contracts_unavailable", "Assets konnten nicht geprüft werden.");
    }
    if ((data ?? []).length !== assetIds.length) {
      throw new HttpError(422, "asset_invalid", "Mindestens ein Asset gehört nicht zu diesem Mandanten.");
    }
  }
  const existing = (await readAssetIds(admin, tenantId, [contractId])).get(contractId) ?? [];
  const toRemove = existing.filter((id) => !assetIds.includes(id));
  const toAdd = assetIds.filter((id) => !existing.includes(id));
  if (toRemove.length > 0) {
    const { error } = await admin
      .from("contract_assets")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("contract_id", contractId)
      .in("asset_id", toRemove);
    if (error) throw new HttpError(503, "contract_assets_failed", "Die Asset-Verknüpfung konnte nicht gespeichert werden.");
  }
  if (toAdd.length > 0) {
    const { error } = await admin.from("contract_assets").insert(
      toAdd.map((assetId) => ({ tenant_id: tenantId, contract_id: contractId, asset_id: assetId })),
    );
    if (error) throw new HttpError(503, "contract_assets_failed", "Die Asset-Verknüpfung konnte nicht gespeichert werden.");
  }
}
async function handler(
  request: Request,
  context: SupabaseContext,
): Promise<Response> {
  const actorId = context.userClaims?.id;
  const action = parseAction(await request.json().catch(() => null));
  if (!isUuid(actorId) || !action)
    throw new HttpError(400, "invalid_request", "Die Anfrage ist ungültig.");
  await authorize(context.supabaseAdmin, actorId, action.tenantId);
  if (action.type === "listAssets") {
    const { data, error } = await context.supabaseAdmin
      .from("assets")
      .select("id, name, asset_tag, kind")
      .eq("tenant_id", action.tenantId)
      .eq("active", true)
      .order("name")
      .limit(2000);
    if (error)
      throw new HttpError(503, "contracts_unavailable", "Assets konnten nicht geladen werden.");
    return reply(request, {
      data: {
        assets: (data ?? []).map((item: any) => ({
          id: item.id,
          name: item.name,
          tag: item.asset_tag ?? null,
          kind: item.kind ?? null,
        })),
      },
    });
  }
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
        "id, title, counterparty_name, reference_number, contract_type, status, starts_on, ends_on, notice_period_days, reminder_days_before, reminder_sent_for, cancelled, cancelled_on, cost_amount, cost_currency, cost_period, auto_renew, renewal_months, responsible_user_id, notes, archived_at, created_at, updated_at",
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
    const links = await readAssetIds(
      context.supabaseAdmin,
      action.tenantId,
      (data ?? []).map((item) => String((item as Row).id)),
    );
    return reply(request, {
      data: {
        contracts: (data ?? []).map((item) =>
          rowToContract(item as Row, links.get(String((item as Row).id)) ?? []),
        ),
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
      ...(action.values.reminderDaysBefore !== undefined
        ? { reminder_days_before: action.values.reminderDaysBefore }
        : {}),
      ...(action.values.cancelled !== undefined
        ? {
          cancelled: action.values.cancelled,
          cancelled_on: action.values.cancelled
            ? (action.values.cancelledOn ?? null)
            : null,
        }
        : {}),
      ...(action.values.costAmount !== undefined
        ? {
          cost_amount: action.values.costAmount,
          cost_period: action.values.costAmount === null
            ? null
            : (action.values.costPeriod ?? null),
        }
        : {}),
      ...(action.values.costCurrency !== undefined
        ? { cost_currency: action.values.costCurrency }
        : {}),
      ...(action.values.autoRenew !== undefined
        ? {
          auto_renew: action.values.autoRenew,
          renewal_months: action.values.autoRenew
            ? (action.values.renewalMonths ?? null)
            : null,
        }
        : {}),
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
    if (result.error) {
      console.error(
        "contract save failed",
        result.error.code,
        result.error.message,
      );
    }
    if (result.error)
      throw new HttpError(
        result.error.code === "23505" ? 422 : 503,
        result.error.code === "23505"
          ? "reference_number_taken"
          : "contract_save_failed",
        result.error.code === "23505"
          ? "Die Vertragsnummer wird bereits verwendet."
          : `Der Vertrag konnte nicht gespeichert werden. (Datenbankfehler ${result.error.code ?? "unbekannt"})`,
      );
    if (!result.data)
      throw new HttpError(
        404,
        "contract_not_found",
        "Der Vertrag wurde nicht gefunden.",
      );
    const saved = result.data as Row;
    if (action.values.assetIds !== undefined) {
      await syncAssetLinks(
        context.supabaseAdmin,
        action.tenantId,
        String(saved.id),
        action.values.assetIds,
      );
    }
    const savedLinks = await readAssetIds(context.supabaseAdmin, action.tenantId, [
      String(saved.id),
    ]);
    return reply(
      request,
      {
        data: {
          contract: rowToContract(saved, savedLinks.get(String(saved.id)) ?? []),
        },
      },
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
  const archivedLinks = await readAssetIds(context.supabaseAdmin, action.tenantId, [
    String((data as Row).id),
  ]);
  return reply(request, {
    data: {
      contract: rowToContract(
        data as Row,
        archivedLinks.get(String((data as Row).id)) ?? [],
      ),
    },
  });
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
