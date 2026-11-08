import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import {
  availableIntuneActions,
  CONFIRMATION_REQUIRED_ACTIONS,
  type IntuneDeviceAction,
  IntuneActionError,
  type IntuneActionErrorCode,
  intuneActionApiVersion,
  intuneActionErrorMessage,
  intunePlatform,
  isIntuneDeviceAction,
  requestIntuneActionAccessToken,
  runIntuneDeviceAction,
} from "../_shared/intune-device-actions-graph.ts";
import {
  type FetchLike,
  readIntuneGraphCredentials,
} from "../_shared/intune-managed-devices-graph.ts";
import { resolveUserFeatureStates } from "../_shared/tenant-features.ts";
import {
  TicketPersonAssetsError,
  ticketPersonAssetIds,
} from "../_shared/ticket-person-assets.ts";

/**
 * Intune-Aktionen: remote actions on Intune managed devices from the ticket
 * detail or the asset list.
 *
 *  - listTicketDevices: Intune managed devices of a ticket (linked assets and
 *    devices of the requesting / affected person) with the actions their
 *    platform supports,
 *  - listAssetActions: the same for up to 100 given assets,
 *  - runAction: runs one action through Microsoft Graph and logs it in
 *    intune_device_actions, the audit log and (with a ticket) the ticket
 *    history.
 *
 * Requires the permission asset.intune.actions and the module
 * assets.management; actions from a ticket additionally need ticket.update
 * in the ticket's department. Provider device IDs never leave the server.
 */

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_ASSETS = 100;
const DEVICE_LIMIT = 30;
const PERMISSION = "asset.intune.actions";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Action =
  | { type: "listTicketDevices"; tenantId: string; ticketId: string }
  | { type: "listAssetActions"; tenantId: string; assetIds: string[] }
  | {
      type: "runAction";
      tenantId: string;
      assetId: string;
      ticketId: string | null;
      action: IntuneDeviceAction;
      confirmed: boolean;
    };

function hasOnlyKeys(value: Row, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  if (value.type === "listTicketDevices") {
    if (!hasOnlyKeys(value, ["type", "tenantId", "ticketId"])) return null;
    if (!isUuid(value.ticketId)) return null;
    return {
      type: "listTicketDevices",
      tenantId,
      ticketId: value.ticketId.toLowerCase(),
    };
  }
  if (value.type === "listAssetActions") {
    if (!hasOnlyKeys(value, ["type", "tenantId", "assetIds"])) return null;
    if (
      !Array.isArray(value.assetIds) ||
      value.assetIds.length > MAX_ASSETS ||
      !value.assetIds.every(isUuid)
    ) {
      return null;
    }
    return {
      type: "listAssetActions",
      tenantId,
      assetIds: [
        ...new Set(value.assetIds.map((id: string) => id.toLowerCase())),
      ],
    };
  }
  if (value.type === "runAction") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "tenantId",
        "assetId",
        "ticketId",
        "action",
        "confirmed",
      ])
    ) {
      return null;
    }
    if (
      !isUuid(value.assetId) ||
      (value.ticketId !== null &&
        value.ticketId !== undefined &&
        !isUuid(value.ticketId)) ||
      !isIntuneDeviceAction(value.action) ||
      (value.confirmed !== undefined && typeof value.confirmed !== "boolean")
    ) {
      return null;
    }
    return {
      type: "runAction",
      tenantId,
      assetId: value.assetId.toLowerCase(),
      ticketId: isUuid(value.ticketId) ? value.ticketId.toLowerCase() : null,
      action: value.action,
      confirmed: value.confirmed === true,
    };
  }
  return null;
}

export function requiresConfirmation(action: IntuneDeviceAction): boolean {
  return CONFIRMATION_REQUIRED_ACTIONS.includes(action);
}

/** HTTP status for an action error (the action itself is logged anyway). */
export function actionErrorStatus(code: IntuneActionErrorCode): number {
  switch (code) {
    case "permission_missing":
    case "consent_missing":
      return 403;
    case "device_not_found":
      return 404;
    case "action_not_supported":
    case "invalid_device":
      return 422;
    case "rate_limited":
      return 429;
    case "provider_not_configured":
      return 409;
    default:
      return 502;
  }
}

function databaseFailure(error: { code?: string } | null): never {
  switch (error?.code) {
    case "42501":
      throw new HttpError(
        403,
        "intune_actions_permission_required",
        "Für Intune-Aktionen fehlt die Berechtigung.",
      );
    case "P0001":
      throw new HttpError(
        409,
        "intune_connection_not_ready",
        "Die Intune-Anbindung ist für diesen Mandanten nicht aktiv.",
      );
    case "P0002":
      throw new HttpError(
        404,
        "intune_device_not_found",
        "Das Gerät wird nicht über Intune verwaltet.",
      );
    case "22023":
    case "22P02":
    case "23514":
      throw new HttpError(422, "invalid_request", "Die Anfrage ist ungültig.");
    default:
      throw new HttpError(
        503,
        "intune_actions_unavailable",
        "Die Intune-Aktionen sind derzeit nicht verfügbar.",
      );
  }
}

async function requireAccess(
  client: Client,
  admin: Client,
  tenantId: string,
  actorId: string,
): Promise<void> {
  const { data, error } = await client.rpc("has_tenant_permission", {
    p_tenant_id: tenantId,
    p_permission_code: PERMISSION,
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
      "intune_actions_permission_required",
      "Für Intune-Aktionen fehlt die Berechtigung.",
    );
  }
  const features = await resolveUserFeatureStates(admin, tenantId, actorId, [
    "assets.management",
  ]);
  if (features === null) {
    throw new HttpError(
      503,
      "tenant_feature_lookup_failed",
      "Die Funktionsfreigabe konnte nicht geprüft werden.",
    );
  }
  if (features["assets.management"] !== true) {
    throw new HttpError(
      403,
      "asset_feature_disabled",
      "Asset-Management ist für diesen Mandanten derzeit deaktiviert.",
    );
  }
}

/** Ticket read with the caller's client; the caller must edit tickets there. */
async function loadTicketForUpdate(
  client: Client,
  tenantId: string,
  ticketId: string,
): Promise<Row> {
  const { data: ticket, error } = await client
    .from("tickets")
    .select(
      "id, tenant_id, department_id, requester_id, affected_user_id, requester_contact_id",
    )
    .eq("tenant_id", tenantId)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) databaseFailure(error);
  if (!ticket || !isUuid(ticket.department_id)) {
    throw new HttpError(
      404,
      "ticket_not_found",
      "Das Ticket ist nicht verfügbar.",
    );
  }
  const permission = await client.rpc("has_ticket_permission", {
    p_tenant_id: tenantId,
    p_department_id: ticket.department_id,
    p_permission_code: "ticket.update",
  });
  if (permission.error) {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  }
  if (permission.data !== true) {
    throw new HttpError(
      403,
      "ticket_update_required",
      "Für diese Aktion fehlt die Berechtigung.",
    );
  }
  return ticket;
}

/** Linked assets and person devices of the ticket (asset IDs). */
async function ticketAssetIds(
  admin: Client,
  tenantId: string,
  ticket: Row,
): Promise<string[]> {
  const { data: linked, error } = await admin
    .from("ticket_assets")
    .select("asset_id")
    .eq("tenant_id", tenantId)
    .eq("ticket_id", ticket.id)
    .limit(50);
  if (error) databaseFailure(error);
  let personIds: string[] = [];
  try {
    const person = await ticketPersonAssetIds(admin, tenantId, ticket);
    personIds = [...person.assignedIds, ...person.intuneIds];
  } catch (personError) {
    databaseFailure(
      personError instanceof TicketPersonAssetsError
        ? (personError.dbError as { code?: string } | null)
        : null,
    );
  }
  return [
    ...new Set([
      ...(linked ?? []).map((row: Row) => row.asset_id).filter(isUuid),
      ...personIds,
    ]),
  ].slice(0, MAX_ASSETS);
}

type Device = {
  assetId: string;
  name: string;
  assetTag: string | null;
  operatingSystem: string | null;
  platform: string;
  actions: IntuneDeviceAction[];
  confirmationRequired: IntuneDeviceAction[];
};

/**
 * Intune managed, caller-visible assets among assetIds. Assets are read with
 * the caller's client (asset RLS and department scope); the Intune link and
 * platform come from the service-role RPC.
 */
async function intuneDevices(
  client: Client,
  admin: Client,
  actorId: string,
  tenantId: string,
  assetIds: string[],
): Promise<{ devices: Device[]; connectionReady: boolean }> {
  if (assetIds.length === 0) return { devices: [], connectionReady: false };
  const targets = await admin.rpc("intune_device_action_targets", {
    p_actor_id: actorId,
    p_tenant_id: tenantId,
    p_asset_ids: assetIds,
  });
  if (targets.error) databaseFailure(targets.error);
  const targetRows: Row[] = Array.isArray(targets.data) ? targets.data : [];
  const osByAsset = new Map<string, string | null>();
  let connectionReady = false;
  for (const row of targetRows) {
    if (!isUuid(row.asset_id)) continue;
    osByAsset.set(
      row.asset_id,
      typeof row.operating_system === "string" ? row.operating_system : null,
    );
    if (row.connection_ready === true) connectionReady = true;
  }
  if (osByAsset.size === 0) return { devices: [], connectionReady };
  const { data: assets, error } = await client
    .from("assets")
    .select("id, name, asset_tag")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .in("id", [...osByAsset.keys()])
    .order("name")
    .limit(DEVICE_LIMIT);
  if (error) databaseFailure(error);
  const devices: Device[] = [];
  for (const asset of (assets ?? []) as Row[]) {
    if (!isUuid(asset.id) || typeof asset.name !== "string") continue;
    const operatingSystem = osByAsset.get(asset.id) ?? null;
    const actions = availableIntuneActions(operatingSystem);
    devices.push({
      assetId: asset.id,
      name: asset.name,
      assetTag: typeof asset.asset_tag === "string" ? asset.asset_tag : null,
      operatingSystem,
      platform: intunePlatform(operatingSystem),
      actions,
      confirmationRequired: actions.filter(requiresConfirmation),
    });
  }
  return { devices, connectionReady };
}

export type RunDependencies = {
  fetchImpl: FetchLike;
  credentials: ReturnType<typeof readIntuneGraphCredentials>;
};

async function runAction(
  request: Request,
  client: Client,
  admin: Client,
  actorId: string,
  action: Extract<Action, { type: "runAction" }>,
  dependencies: RunDependencies,
): Promise<Response> {
  if (requiresConfirmation(action.action) && !action.confirmed) {
    throw new HttpError(
      428,
      "confirmation_required",
      "Diese Aktion muss zuerst bestätigt werden.",
    );
  }
  // The device must be visible to the caller and, with a ticket, belong to it.
  if (action.ticketId) {
    const ticket = await loadTicketForUpdate(
      client,
      action.tenantId,
      action.ticketId,
    );
    const ids = await ticketAssetIds(admin, action.tenantId, ticket);
    if (!ids.includes(action.assetId)) {
      throw new HttpError(
        404,
        "intune_device_not_found",
        "Das Gerät gehört nicht zu diesem Ticket.",
      );
    }
  }
  const { devices } = await intuneDevices(
    client,
    admin,
    actorId,
    action.tenantId,
    [action.assetId],
  );
  const device = devices.find((entry) => entry.assetId === action.assetId);
  if (!device) {
    throw new HttpError(
      404,
      "intune_device_not_found",
      "Das Gerät wird nicht über Intune verwaltet.",
    );
  }
  if (!device.actions.includes(action.action)) {
    throw new HttpError(
      422,
      "intune_action_not_supported",
      "Diese Aktion wird für die Plattform des Geräts nicht unterstützt.",
    );
  }

  const begun = await admin.rpc("begin_intune_device_action", {
    p_actor_id: actorId,
    p_tenant_id: action.tenantId,
    p_asset_id: action.assetId,
    p_ticket_id: action.ticketId,
    p_action: action.action,
  });
  if (begun.error) databaseFailure(begun.error);
  const started = (Array.isArray(begun.data) ? begun.data[0] : null) as
    Row | null | undefined;
  if (
    !started ||
    !isUuid(started.action_id) ||
    typeof started.entra_tenant_id !== "string" ||
    typeof started.managed_device_id !== "string"
  ) {
    throw new HttpError(
      503,
      "intune_actions_unavailable",
      "Die Intune-Aktion konnte nicht sicher gestartet werden.",
    );
  }

  let graphStatus: number | null = null;
  let errorCode: IntuneActionErrorCode | null = null;
  try {
    if (!dependencies.credentials) {
      throw new IntuneActionError("provider_not_configured");
    }
    const token = await requestIntuneActionAccessToken(
      started.entra_tenant_id,
      dependencies.credentials,
      dependencies.fetchImpl,
    );
    const result = await runIntuneDeviceAction(
      action.action,
      started.managed_device_id,
      token,
      dependencies.fetchImpl,
    );
    graphStatus = result.graphStatus;
  } catch (error) {
    errorCode =
      error instanceof IntuneActionError ? error.code : "provider_unavailable";
    graphStatus = error instanceof IntuneActionError ? error.graphStatus : null;
  }

  const finished = await admin.rpc("finish_intune_device_action", {
    p_tenant_id: action.tenantId,
    p_action_id: started.action_id,
    p_succeeded: errorCode === null,
    p_graph_api_version: intuneActionApiVersion(action.action),
    p_graph_status: graphStatus,
    p_error_code: errorCode,
  });
  const logged = !finished.error;

  if (errorCode !== null) {
    throw new HttpError(
      actionErrorStatus(errorCode),
      `intune_${errorCode}`,
      intuneActionErrorMessage(errorCode),
    );
  }
  return json(request, {
    data: {
      actionId: started.action_id,
      action: action.action,
      status: "succeeded",
      graphStatus,
      logged,
    },
  });
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "request_too_large", "Die Anfrage ist zu gross.");
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function handleAction(
  request: Request,
  client: Client,
  admin: Client,
  actorId: string,
  action: Action,
  dependencies: RunDependencies,
): Promise<Response> {
  await requireAccess(client, admin, action.tenantId, actorId);
  switch (action.type) {
    case "listTicketDevices": {
      const ticket = await loadTicketForUpdate(
        client,
        action.tenantId,
        action.ticketId,
      );
      const ids = await ticketAssetIds(admin, action.tenantId, ticket);
      const result = await intuneDevices(
        client,
        admin,
        actorId,
        action.tenantId,
        ids,
      );
      return json(request, { data: result });
    }
    case "listAssetActions": {
      const result = await intuneDevices(
        client,
        admin,
        actorId,
        action.tenantId,
        action.assetIds,
      );
      return json(request, { data: result });
    }
    case "runAction":
      return await runAction(
        request,
        client,
        admin,
        actorId,
        action,
        dependencies,
      );
  }
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") {
        return json(
          request,
          {
            error: {
              code: "method_not_allowed",
              message: "Nur POST ist erlaubt.",
            },
          },
          405,
        );
      }
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) {
        return json(
          request,
          {
            error: {
              code: "unauthorized",
              message: "Eine Anmeldung ist erforderlich.",
            },
          },
          401,
        );
      }
      const action = parseAction(await readBody(request));
      if (!action) {
        return json(
          request,
          {
            error: {
              code: "invalid_request",
              message: "Die Anfrage ist ungültig.",
            },
          },
          422,
        );
      }
      return await handleAction(
        request,
        context.supabase,
        context.supabaseAdmin,
        actorId,
        action,
        { fetchImpl: fetch, credentials: readIntuneGraphCredentials() },
      );
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error("intune_actions_failed", error);
      return json(
        request,
        {
          error: {
            code: "internal_error",
            message: "Die Intune-Aktion konnte nicht abgeschlossen werden.",
          },
        },
        500,
      );
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};
