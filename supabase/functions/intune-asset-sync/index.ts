import { withSupabase, type SupabaseContext } from "@supabase/server";
import {
  IntuneGraphError,
  readIntuneGraphCredentials,
  readIntuneManagedDevices,
  requestIntuneGraphAccessToken,
} from "../_shared/intune-managed-devices-graph.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 2_048;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;
type AdminClient = SupabaseContext["supabaseAdmin"];

type Action = {
  type: "runManualIntuneSync";
  tenantId: string;
  mode: "dry_run" | "synchronize";
  clientRequestId: string;
  retryOfRunId: string | null;
  confirmApply: boolean;
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

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function parseAction(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    value.type !== "runManualIntuneSync" ||
    !isUuid(value.tenantId) ||
    !isUuid(value.clientRequestId) ||
    (value.mode !== "dry_run" && value.mode !== "synchronize") ||
    typeof value.confirmApply !== "boolean" ||
    (value.retryOfRunId !== null && !isUuid(value.retryOfRunId)) ||
    !Object.keys(value).every((key) =>
      [
        "type",
        "tenantId",
        "mode",
        "clientRequestId",
        "retryOfRunId",
        "confirmApply",
      ].includes(key),
    )
  ) {
    return null;
  }
  if (value.mode === "synchronize" && value.confirmApply !== true) return null;
  if (value.mode === "dry_run" && value.confirmApply !== false) return null;
  return {
    type: value.type,
    tenantId: value.tenantId.toLowerCase(),
    mode: value.mode,
    clientRequestId: value.clientRequestId.toLowerCase(),
    retryOfRunId:
      typeof value.retryOfRunId === "string"
        ? value.retryOfRunId.toLowerCase()
        : null,
    confirmApply: value.confirmApply,
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
    result.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    result.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return result;
}

function response(request: Request, body: Row, status = 200): Response {
  const result = headers(request);
  if (status === 405) result.set("Allow", "POST, OPTIONS");
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: result,
  });
}

function failure(request: Request, error: HttpError): Response {
  return response(
    request,
    { error: { code: error.code, message: error.message } },
    error.status,
  );
}

function databaseFailure(error: { code?: string } | null): never {
  switch (error?.code) {
    case "42501":
      throw new HttpError(
        403,
        "asset_integration_manage_required",
        "Die Berechtigung fehlt.",
      );
    case "22023":
    case "22P02":
    case "23514":
      throw new HttpError(422, "invalid_request", "Die Anfrage ist ungültig.");
    case "P0001":
      throw new HttpError(
        409,
        "intune_manual_sync_not_ready",
        "Der manuelle Intune-Abgleich ist noch nicht bereit.",
      );
    case "P0002":
      throw new HttpError(
        409,
        "intune_manual_sync_invalidated",
        "Der manuelle Intune-Abgleich ist nicht mehr gültig.",
      );
    default:
      throw new HttpError(
        503,
        "intune_manual_sync_service_unavailable",
        "Der manuelle Intune-Abgleich ist derzeit nicht verfügbar.",
      );
  }
}

function asRow(value: unknown, code: string): Row {
  if (!isRecord(value)) {
    throw new HttpError(
      503,
      code,
      "Die sichere Serverantwort ist unvollständig.",
    );
  }
  return value;
}

async function failRun(
  admin: AdminClient,
  tenantId: string,
  runId: string,
  resultCode:
    | "provider_not_configured"
    | "provider_unavailable"
    | "provider_rate_limited"
    | "provider_payload_invalid"
    | "run_invalidated"
    | "run_expired",
): Promise<void> {
  const failed = await admin.rpc("fail_asset_intune_manual_sync_run", {
    p_tenant_id: tenantId,
    p_run_id: runId,
    p_result_code: resultCode,
  });
  if (failed.error) {
    throw new HttpError(
      503,
      "intune_manual_sync_cleanup_failed",
      "Der manuelle Intune-Abgleich konnte nicht sicher bereinigt werden.",
    );
  }
}

async function renewFence(
  admin: AdminClient,
  actorId: string,
  tenantId: string,
  runId: string,
  configurationGeneration: number,
  manualSyncGeneration: number,
): Promise<void> {
  const renewed = await admin.rpc("renew_asset_intune_manual_sync_fence", {
    p_actor_id: actorId,
    p_tenant_id: tenantId,
    p_run_id: runId,
    p_configuration_generation: configurationGeneration,
    p_manual_sync_generation: manualSyncGeneration,
  });
  if (renewed.error) databaseFailure(renewed.error);
}

async function run(
  request: Request,
  admin: AdminClient,
  actorId: string,
  action: Action,
): Promise<Response> {
  const claimResult = await admin.rpc("claim_asset_intune_manual_sync_run", {
    p_actor_id: actorId,
    p_tenant_id: action.tenantId,
    p_client_request_id: action.clientRequestId,
    p_mode: action.mode,
    p_retry_of_run_id: action.retryOfRunId,
  });
  if (claimResult.error) databaseFailure(claimResult.error);
  const claim = asRow(
    Array.isArray(claimResult.data) ? claimResult.data[0] : null,
    "intune_manual_sync_service_unavailable",
  );
  if (typeof claim.outcome !== "string" || typeof claim.id !== "string") {
    throw new HttpError(
      503,
      "intune_manual_sync_service_unavailable",
      "Der manuelle Intune-Abgleich konnte nicht sicher gestartet werden.",
    );
  }
  if (claim.outcome === "existing") {
    return response(request, { data: { run: claim, reused: true } });
  }
  if (claim.outcome === "in_progress") {
    throw new HttpError(
      409,
      "intune_manual_sync_in_progress",
      "Für diesen Mandanten läuft bereits ein manueller Intune-Abgleich.",
    );
  }
  if (claim.outcome === "blocked") {
    throw new HttpError(
      409,
      "intune_manual_sync_not_ready",
      "Der manuelle Intune-Abgleich ist für diese Konfiguration noch nicht bereit.",
    );
  }
  if (
    claim.outcome !== "claimed" ||
    !isUuid(claim.entra_tenant_id) ||
    typeof claim.configuration_generation !== "number" ||
    typeof claim.manual_sync_generation !== "number"
  ) {
    throw new HttpError(
      503,
      "intune_manual_sync_service_unavailable",
      "Der manuelle Intune-Abgleich konnte nicht sicher gestartet werden.",
    );
  }

  const runId = claim.id;
  const entraTenantId = claim.entra_tenant_id;
  const configurationGeneration = claim.configuration_generation;
  const manualSyncGeneration = claim.manual_sync_generation;
  const credentials = readIntuneGraphCredentials();
  if (!credentials) {
    try {
      await failRun(admin, action.tenantId, runId, "provider_not_configured");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        503,
        "intune_manual_sync_cleanup_failed",
        "Der manuelle Intune-Abgleich konnte nicht sicher bereinigt werden.",
      );
    }
    throw new HttpError(
      503,
      "intune_provider_not_configured",
      "Die serverseitige Intune-Anbindung ist noch nicht vollständig eingerichtet.",
    );
  }

  try {
    await renewFence(
      admin,
      actorId,
      action.tenantId,
      runId,
      configurationGeneration,
      manualSyncGeneration,
    );
    const accessToken = await requestIntuneGraphAccessToken(
      entraTenantId,
      credentials,
    );
    const contact = await admin.rpc(
      "mark_asset_intune_manual_sync_provider_contact",
      {
        p_actor_id: actorId,
        p_tenant_id: action.tenantId,
        p_run_id: runId,
        p_configuration_generation: configurationGeneration,
        p_manual_sync_generation: manualSyncGeneration,
      },
    );
    if (contact.error) databaseFailure(contact.error);
    await readIntuneManagedDevices(
      accessToken,
      async (devices) => {
        if (devices.length === 0) return;
        const staged = await admin.rpc(
          "stage_asset_intune_manual_sync_devices",
          {
            p_actor_id: actorId,
            p_tenant_id: action.tenantId,
            p_run_id: runId,
            p_configuration_generation: configurationGeneration,
            p_manual_sync_generation: manualSyncGeneration,
            p_devices: devices,
          },
        );
        if (staged.error) databaseFailure(staged.error);
      },
      fetch,
      async () => {
        await renewFence(
          admin,
          actorId,
          action.tenantId,
          runId,
          configurationGeneration,
          manualSyncGeneration,
        );
      },
    );
    const completed = await admin.rpc("complete_asset_intune_manual_sync_run", {
      p_actor_id: actorId,
      p_tenant_id: action.tenantId,
      p_run_id: runId,
      p_configuration_generation: configurationGeneration,
      p_manual_sync_generation: manualSyncGeneration,
    });
    if (completed.error) databaseFailure(completed.error);
    const completedRun = asRow(
      Array.isArray(completed.data) ? completed.data[0] : null,
      "intune_manual_sync_service_unavailable",
    );
    return response(request, { data: { run: completedRun, reused: false } });
  } catch (error) {
    const resultCode =
      error instanceof IntuneGraphError
        ? error.code
        : error instanceof HttpError &&
            error.code === "intune_manual_sync_invalidated"
          ? "run_invalidated"
          : "provider_unavailable";
    try {
      await failRun(admin, action.tenantId, runId, resultCode);
    } catch (cleanupError) {
      if (cleanupError instanceof HttpError) throw cleanupError;
      throw new HttpError(
        503,
        "intune_manual_sync_cleanup_failed",
        "Der manuelle Intune-Abgleich konnte nicht sicher bereinigt werden.",
      );
    }
    if (error instanceof HttpError) throw error;
    if (error instanceof IntuneGraphError) {
      const code =
        error.code === "provider_rate_limited"
          ? "intune_provider_rate_limited"
          : error.code === "provider_payload_invalid"
            ? "intune_provider_response_invalid"
            : "intune_provider_unavailable";
      throw new HttpError(
        error.code === "provider_rate_limited" ? 429 : 503,
        code,
        "Microsoft Intune konnte nicht sicher verarbeitet werden.",
      );
    }
    throw new HttpError(
      503,
      "intune_provider_unavailable",
      "Microsoft Intune ist derzeit nicht verfügbar.",
    );
  }
}

async function boundedRequest(request: Request): Promise<Request> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)
  ) {
    throw new HttpError(413, "request_too_large", "Die Anfrage ist zu gross.");
  }
  if (!request.body)
    throw new HttpError(400, "invalid_request", "JSON ist erforderlich.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
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
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new HttpError(400, "invalid_request", "UTF-8-JSON ist erforderlich.");
  }
  return new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body,
    signal: request.signal,
  });
}

const securedHandler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    if (!isUuid(context.userClaims?.id)) {
      throw new HttpError(
        401,
        "authentication_required",
        "Eine Anmeldung ist erforderlich.",
      );
    }
    const action = parseAction(await request.json().catch(() => null));
    if (!action) {
      throw new HttpError(400, "invalid_request", "Die Anfrage ist ungültig.");
    }
    return await run(
      request,
      context.supabaseAdmin,
      context.userClaims.id,
      action,
    );
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ALLOWED_ORIGIN) {
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
      if (origin !== ALLOWED_ORIGIN) {
        return failure(
          request,
          new HttpError(
            403,
            "origin_not_allowed",
            "Dieser Ursprung ist nicht erlaubt.",
          ),
        );
      }
      if (
        !["POST", null].includes(
          request.headers.get("access-control-request-method"),
        )
      ) {
        return failure(
          request,
          new HttpError(405, "method_not_allowed", "Nur POST ist erlaubt."),
        );
      }
      return response(request, {}, 204);
    }
    if (request.method !== "POST") {
      return failure(
        request,
        new HttpError(405, "method_not_allowed", "Nur POST ist erlaubt."),
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
      return await securedHandler(await boundedRequest(request));
    } catch (error) {
      return failure(
        request,
        error instanceof HttpError
          ? error
          : new HttpError(
              503,
              "intune_manual_sync_service_unavailable",
              "Der manuelle Intune-Abgleich ist derzeit nicht verfügbar.",
            ),
      );
    }
  },
};
