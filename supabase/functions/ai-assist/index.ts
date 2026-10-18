import { type SupabaseContext, withSupabase } from "@supabase/server";
import {
  type AiDraftObject,
  type AiPurpose,
  MAX_COST_CENTS,
  MAX_INPUT_CHARACTERS,
  MAX_OUTPUT_TOKENS,
  queueMinimalAiDraftRequest,
  resolveAiGovernance,
  validateAiBudget,
  validateAiPurpose,
} from "../_shared/ai-governance.ts";

const APP_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 12 * 1024;
const MIN_OUTPUT_TOKENS = 16;
const MIN_COST_CENTS = 1;

const PURPOSE_OBJECT_TYPES: Readonly<Record<AiPurpose, AiDraftObject["type"]>> =
  {
    general_draft: "none",
    ticket_reply_draft: "ticket",
    knowledge_article_draft: "knowledge_article",
  };

type Row = Record<string, unknown>;
type AdminClient = SupabaseContext["supabaseAdmin"];
type Action =
  | { type: "getCapabilities"; tenantId: string }
  | {
      type: "createDraftRequest";
      tenantId: string;
      purpose: AiPurpose;
      object: AiDraftObject;
      /** Exists only for request validation and in-memory character counting. */
      sanitizedInput: string;
      maxOutputTokens: number;
      maxCostCents: number;
    };

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Row, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isPurpose(value: unknown): value is AiPurpose {
  return (
    value === "general_draft" ||
    value === "ticket_reply_draft" ||
    value === "knowledge_article_draft"
  );
}

function isUnsafeControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return true;
  return (
    (codePoint >= 0x0001 && codePoint <= 0x0008) ||
    (codePoint >= 0x000b && codePoint <= 0x000c) ||
    (codePoint >= 0x000e && codePoint <= 0x001f) ||
    (codePoint >= 0x007f && codePoint <= 0x009f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function removeUnsafeControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => !isUnsafeControlCharacter(character))
    .join("");
}

/**
 * Keep the input small and well-formed. It never leaves this handler: no
 * database field, audit record, error response, model request, or log gets it.
 */
function sanitizeUserInput(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    value.includes("\u0000")
  ) {
    return null;
  }

  const sanitized = removeUnsafeControlCharacters(
    value.normalize("NFC").replace(/\r\n?/g, "\n"),
  )
    // Non-printing controls (except tab/newline) and bidi isolate/override
    // controls are removed before the request is evaluated or counted.
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  const characterCount = Array.from(sanitized).length;
  if (characterCount < 1 || characterCount > MAX_INPUT_CHARACTERS) return null;

  // Never treat credential-looking material as ordinary draft context. Reject
  // rather than redact so no secret fragment can be persisted or echoed later.
  const secretLike =
    /(?:authorization\s*:\s*bearer|api[ _-]?key\s*[=:]|-----begin [a-z ]*private key-----|(?:sk|pk)_[a-z0-9_-]{16,})/i;
  return secretLike.test(sanitized) ? null : sanitized;
}

function parseDraftObject(value: unknown): AiDraftObject | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (
    value.type === "none" &&
    hasOnlyKeys(value, ["type", "id"]) &&
    value.id === null
  ) {
    return { type: "none", id: null };
  }
  if (
    (value.type === "ticket" || value.type === "knowledge_article") &&
    hasOnlyKeys(value, ["type", "id"]) &&
    isUuid(value.id)
  ) {
    return { type: value.type, id: value.id.toLowerCase() };
  }
  return null;
}

function parseAction(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    !isUuid(value.tenantId) ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  const tenantId = value.tenantId.toLowerCase();

  if (
    value.type === "getCapabilities" &&
    hasOnlyKeys(value, ["type", "tenantId"])
  ) {
    return { type: "getCapabilities", tenantId };
  }

  if (
    value.type !== "createDraftRequest" ||
    !hasOnlyKeys(value, [
      "type",
      "tenantId",
      "purpose",
      "object",
      "input",
      "maxOutputTokens",
      "maxCostCents",
    ]) ||
    !isPurpose(value.purpose)
  ) {
    return null;
  }

  const object = parseDraftObject(value.object);
  const sanitizedInput = sanitizeUserInput(value.input);
  if (
    object === null ||
    sanitizedInput === null ||
    PURPOSE_OBJECT_TYPES[value.purpose] !== object.type ||
    !isIntegerInRange(
      value.maxOutputTokens,
      MIN_OUTPUT_TOKENS,
      MAX_OUTPUT_TOKENS,
    ) ||
    !isIntegerInRange(value.maxCostCents, MIN_COST_CENTS, MAX_COST_CENTS)
  ) {
    return null;
  }

  return {
    type: "createDraftRequest",
    tenantId,
    purpose: value.purpose,
    object,
    sanitizedInput,
    maxOutputTokens: value.maxOutputTokens,
    maxCostCents: value.maxCostCents,
  };
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  // Native clients have no browser Origin header. Browser CORS is intentionally
  // limited to the production web app; no wildcard, localhost, or custom scheme
  // is trusted here.
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

function response(request: Request, body: Row, status = 200): Response {
  const headers = corsHeaders(request);
  headers.set("X-Request-Id", crypto.randomUUID());
  if (status === 405) headers.set("Allow", "POST, OPTIONS");
  return new Response(JSON.stringify(body), { status, headers });
}

function originDenied(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin !== APP_ORIGIN;
}

async function parseLimitedJson(request: Request): Promise<unknown | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_REQUEST_BYTES
    ) {
      return null;
    }
  }
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) return null;

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_REQUEST_BYTES) return null;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

async function isActiveTenantMember(
  admin: AdminClient,
  actorId: string,
  tenantId: string,
): Promise<boolean | null> {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  if (error) return null;
  return Boolean(data);
}

const handler = withSupabase(
  {
    auth: "user",
    cors: "disabled",
    errors: { detailed: false },
  },
  async (request, context) => {
    if (request.method !== "POST") {
      return response(
        request,
        {
          error: {
            code: "method_not_allowed",
            message: "Nur POST-Anfragen sind erlaubt.",
          },
        },
        405,
      );
    }

    const action = parseAction(await parseLimitedJson(request));
    const actorId = context.userClaims?.id;
    if (!isUuid(actorId)) {
      return response(
        request,
        {
          error: {
            code: "authentication_required",
            message: "Eine gültige Benutzeranmeldung ist erforderlich.",
          },
        },
        401,
      );
    }
    if (!action) {
      return response(
        request,
        {
          error: {
            code: "invalid_request",
            message: "Die Anfrage enthält ungültige oder unbekannte Felder.",
          },
        },
        400,
      );
    }

    const admin = context.supabaseAdmin;
    const membership = await isActiveTenantMember(
      admin,
      actorId,
      action.tenantId,
    );
    if (membership === null) {
      return response(
        request,
        {
          error: {
            code: "authorization_check_failed",
            message: "Die Berechtigung konnte nicht geprüft werden.",
          },
        },
        503,
      );
    }
    if (!membership) {
      return response(
        request,
        {
          error: {
            code: "tenant_membership_required",
            message:
              "Für diese Aktion ist eine aktive Mandantenmitgliedschaft erforderlich.",
          },
        },
        403,
      );
    }

    const governance = await resolveAiGovernance(admin, action.tenantId);
    if (!governance.ok) {
      return response(
        request,
        { error: { code: governance.code, message: governance.message } },
        governance.status,
      );
    }

    if (action.type === "getCapabilities") {
      return response(request, {
        data: {
          draftRequestsEnabled: true,
          providerInvocation: false,
          purposes: governance.policy.allowedPurposes,
          limits: {
            maxInputCharacters: MAX_INPUT_CHARACTERS,
            maxOutputTokens: Math.min(
              MAX_OUTPUT_TOKENS,
              governance.policy.maxOutputTokens,
            ),
            maxCostCents: Math.min(
              MAX_COST_CENTS,
              governance.policy.maxCostCentsPerRequest,
            ),
            maxRequestsPerHour: governance.policy.maxRequestsPerHour,
          },
        },
      });
    }

    const purposeError = validateAiPurpose(governance.policy, action.purpose);
    if (purposeError) {
      return response(
        request,
        { error: { code: purposeError.code, message: purposeError.message } },
        purposeError.status,
      );
    }

    const budgetError = validateAiBudget(
      governance.policy,
      action.maxOutputTokens,
      action.maxCostCents,
    );
    if (budgetError) {
      return response(
        request,
        { error: { code: budgetError.code, message: budgetError.message } },
        budgetError.status,
      );
    }

    // `sanitizedInput` is intentionally not passed to the queue RPC, audit logs,
    // response, or a provider. Only its post-sanitization character count is used.
    const queued = await queueMinimalAiDraftRequest(admin, {
      tenantId: action.tenantId,
      actorId,
      purpose: action.purpose,
      object: action.object,
      inputCharacterCount: Array.from(action.sanitizedInput).length,
      maxOutputTokens: action.maxOutputTokens,
      maxCostCents: action.maxCostCents,
    });
    if (!queued.ok) {
      return response(
        request,
        { error: { code: queued.code, message: queued.message } },
        queued.status,
      );
    }

    return response(
      request,
      {
        data: {
          requestId: queued.requestId,
          state: "prepared",
          providerInvocation: false,
        },
      },
      201,
    );
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      if (originDenied(request)) {
        return response(
          request,
          {
            error: {
              code: "origin_not_allowed",
              message: "Dieser Ursprung ist nicht erlaubt.",
            },
          },
          403,
        );
      }
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (originDenied(request)) {
      return response(
        request,
        {
          error: {
            code: "origin_not_allowed",
            message: "Dieser Ursprung ist nicht erlaubt.",
          },
        },
        403,
      );
    }
    if (request.method !== "POST") {
      return response(
        request,
        {
          error: {
            code: "method_not_allowed",
            message: "Nur POST-Anfragen sind erlaubt.",
          },
        },
        405,
      );
    }
    if (
      request.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      return response(
        request,
        {
          error: {
            code: "unsupported_media_type",
            message: "Content-Type application/json ist erforderlich.",
          },
        },
        415,
      );
    }
    const result = await handler(request);
    if (result.headers.has("x-supabase-server-error")) {
      if (result.status === 401) {
        return response(
          request,
          {
            error: {
              code: "authentication_required",
              message: "Eine gültige Benutzeranmeldung ist erforderlich.",
            },
          },
          401,
        );
      }
      if (result.status === 403) {
        return response(
          request,
          {
            error: {
              code: "permission_denied",
              message: "Für diese Aktion fehlt die Berechtigung.",
            },
          },
          403,
        );
      }
      return response(
        request,
        {
          error: {
            code: "authentication_unavailable",
            message: "Die Anmeldung konnte derzeit nicht geprüft werden.",
          },
        },
        503,
      );
    }
    return new Response(result.body, {
      status: result.status,
      headers: corsHeaders(request),
    });
  },
};
