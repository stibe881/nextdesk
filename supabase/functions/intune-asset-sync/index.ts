import { withSupabase, type SupabaseContext } from "@supabase/server";
import { HttpError, runIntuneAssetSync } from "./runner.ts";

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

async function run(
  request: Request,
  admin: AdminClient,
  actorId: string,
  action: Action,
): Promise<Response> {
  return response(request, {
    data: await runIntuneAssetSync(admin, actorId, action),
  });
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
