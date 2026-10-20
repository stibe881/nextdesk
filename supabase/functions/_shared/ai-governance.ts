import type { SupabaseContext } from "@supabase/server";
import { resolveTenantFeatureStates } from "./tenant-features.ts";

/**
 * AI is deliberately opt-in twice: the tenant feature flag has to be enabled
 * and a separate, current provider approval with bounded limits has to exist.
 * The approval and queue RPC are deployed together with the later AI schema.
 * Until then every write path remains unavailable (fail closed).
 */
export const AI_ASSIST_FEATURE_KEY = "ai.assist";
export const AI_PROVIDER_KEY = "anthropic";
export const AI_DRAFT_QUEUE_RPC = "queue_ai_draft_request";

export const MAX_INPUT_CHARACTERS = 1_200;
export const MAX_OUTPUT_TOKENS = 1_024;
export const MAX_COST_CENTS = 50;

const MAX_TENANT_RATE_PER_HOUR = 10_000;
const MAX_TENANT_OUTPUT_TOKENS = 8_192;
const MAX_TENANT_COST_CENTS = 10_000;

type Row = Record<string, unknown>;
type DatabaseError = { code?: unknown; message?: unknown; details?: unknown };
type AdminClient = SupabaseContext["supabaseAdmin"];

export type AiPurpose =
  "general_draft" | "ticket_reply_draft" | "knowledge_article_draft";

export type AiDraftObject =
  | { type: "none"; id: null }
  | { type: "ticket"; id: string }
  | { type: "knowledge_article"; id: string };

export type AiProviderPolicy = {
  allowedPurposes: readonly AiPurpose[];
  allowExternalArticleContent: boolean;
  maxRequestsPerHour: number;
  maxOutputTokens: number;
  maxCostCentsPerRequest: number;
};

type AiFeatureDisabledFailure = {
  ok: false;
  status: 403;
  code: "ai_feature_disabled";
  /** Intentionally neutral: no provider, schema, or tenant configuration detail. */
  message: string;
};

type AiProviderNotApprovedFailure = {
  ok: false;
  status: 403;
  code: "ai_provider_not_approved";
  message: string;
};

type AiPurposeNotApprovedFailure = {
  ok: false;
  status: 403;
  code: "ai_purpose_not_approved";
  message: string;
};

type AiBudgetExceededFailure = {
  ok: false;
  status: 429;
  code: "ai_budget_exceeded";
  message: string;
};

type AiGovernanceUnavailableFailure = {
  ok: false;
  status: 503;
  code: "ai_governance_unavailable";
  message: string;
};

type AiObjectUnavailableFailure = {
  ok: false;
  status: 404;
  code: "ai_object_not_available";
  message: string;
};

type AiExternalArticleContentNotApprovedFailure = {
  ok: false;
  status: 403;
  code: "ai_external_article_content_not_approved";
  message: string;
};

export type AiGovernanceFailure =
  | AiFeatureDisabledFailure
  | AiProviderNotApprovedFailure
  | AiPurposeNotApprovedFailure
  | AiBudgetExceededFailure
  | AiGovernanceUnavailableFailure
  | AiObjectUnavailableFailure
  | AiExternalArticleContentNotApprovedFailure;

export type AiGovernanceSuccess = {
  ok: true;
  policy: AiProviderPolicy;
};

export type AiGovernanceResult = AiGovernanceSuccess | AiGovernanceFailure;

export type QueuedAiDraft =
  | { ok: true; requestId: string }
  | AiGovernanceUnavailableFailure
  | AiProviderNotApprovedFailure
  | AiBudgetExceededFailure
  | AiObjectUnavailableFailure
  | AiExternalArticleContentNotApprovedFailure;

type ProviderApprovalRow = {
  provider_key?: unknown;
  enabled?: unknown;
  allowed_purposes?: unknown;
  allow_external_article_content?: unknown;
  approved_at?: unknown;
  expires_at?: unknown;
  max_requests_per_hour?: unknown;
  max_output_tokens?: unknown;
  max_cost_cents_per_request?: unknown;
};

function unavailable(): AiGovernanceUnavailableFailure {
  return {
    ok: false,
    status: 503,
    code: "ai_governance_unavailable",
    message: "Die KI-Governance ist derzeit nicht verfügbar.",
  };
}

function providerNotApproved(): AiProviderNotApprovedFailure {
  return {
    ok: false,
    status: 403,
    code: "ai_provider_not_approved",
    message: "Für diesen Mandanten ist keine KI-Providerfreigabe aktiv.",
  };
}

function purposeNotApproved(): AiPurposeNotApprovedFailure {
  return {
    ok: false,
    status: 403,
    code: "ai_purpose_not_approved",
    message: "Dieser KI-Zweck ist für den Mandanten nicht freigegeben.",
  };
}

function isRecord(value: unknown): value is Row {
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

function isPositiveInteger(value: unknown, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= maximum
  );
}

function isAiPurpose(value: unknown): value is AiPurpose {
  return (
    value === "general_draft" ||
    value === "ticket_reply_draft" ||
    value === "knowledge_article_draft"
  );
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function approvalPolicy(
  value: unknown,
  now = Date.now(),
): AiProviderPolicy | "not_approved" | "invalid" {
  if (!isRecord(value)) return "invalid";
  const row = value as ProviderApprovalRow;
  if (row.provider_key !== AI_PROVIDER_KEY || row.enabled !== true) {
    return "not_approved";
  }
  if (!validTimestamp(row.approved_at) || Date.parse(row.approved_at) > now) {
    return "not_approved";
  }
  if (
    row.expires_at !== null &&
    row.expires_at !== undefined &&
    (!validTimestamp(row.expires_at) || Date.parse(row.expires_at) <= now)
  ) {
    return "not_approved";
  }
  if (
    !Array.isArray(row.allowed_purposes) ||
    row.allowed_purposes.length < 1 ||
    row.allowed_purposes.length > 3 ||
    !row.allowed_purposes.every(isAiPurpose) ||
    new Set(row.allowed_purposes).size !== row.allowed_purposes.length ||
    typeof row.allow_external_article_content !== "boolean" ||
    !isPositiveInteger(row.max_requests_per_hour, MAX_TENANT_RATE_PER_HOUR) ||
    !isPositiveInteger(row.max_output_tokens, MAX_TENANT_OUTPUT_TOKENS) ||
    !isPositiveInteger(row.max_cost_cents_per_request, MAX_TENANT_COST_CENTS)
  ) {
    // A permission that does not carry finite rate and cost ceilings is never
    // sufficient for a server-side AI request.
    return "invalid";
  }

  return {
    allowedPurposes: row.allowed_purposes,
    allowExternalArticleContent: row.allow_external_article_content,
    maxRequestsPerHour: row.max_requests_per_hour,
    maxOutputTokens: row.max_output_tokens,
    maxCostCentsPerRequest: row.max_cost_cents_per_request,
  };
}

function isSchemaCapabilityError(
  error: DatabaseError | null | undefined,
): boolean {
  const code = typeof error?.code === "string" ? error.code : "";
  const text = [error?.message, error?.details]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();
  return (
    code === "42P01" ||
    code === "42883" ||
    code === "42501" ||
    code === "PGRST202" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    text.includes("does not exist") ||
    text.includes("permission denied") ||
    text.includes("row-level security")
  );
}

/**
 * Resolves only a non-secret tenant approval record. `tenant_ai_provider_approvals`
 * is intentionally mandatory; there is no environment-variable or global-provider
 * fallback. A missing schema, missing policy, malformed policy, or database error
 * denies AI use rather than silently permitting it.
 */
async function resolveProviderPolicy(
  admin: AdminClient,
  tenantId: string,
): Promise<AiProviderPolicy | AiGovernanceFailure> {
  const { data, error } = await admin
    .from("tenant_ai_provider_approvals")
    .select(
      "provider_key, enabled, allowed_purposes, allow_external_article_content, approved_at, expires_at, max_requests_per_hour, max_output_tokens, max_cost_cents_per_request",
    )
    .eq("tenant_id", tenantId)
    .eq("provider_key", AI_PROVIDER_KEY)
    .maybeSingle();

  if (error) {
    // This includes the expected preparatory state where the explicit approval
    // schema has not yet been deployed. Do not reveal which condition applies.
    return unavailable();
  }
  if (!data) return providerNotApproved();

  const policy = approvalPolicy(data);
  if (policy === "not_approved") return providerNotApproved();
  if (policy === "invalid") return unavailable();
  return policy;
}

/**
 * Enforces the feature switch plus the tenant-specific provider consent. This
 * resolver is server-side only and has no model-provider dependency.
 */
export async function resolveAiGovernance(
  admin: AdminClient,
  tenantId: string,
): Promise<AiGovernanceResult> {
  const featureStates = await resolveTenantFeatureStates(admin, tenantId, [
    AI_ASSIST_FEATURE_KEY,
  ]);
  if (featureStates === null) return unavailable();
  if (featureStates[AI_ASSIST_FEATURE_KEY] !== true) {
    return {
      ok: false,
      status: 403,
      code: "ai_feature_disabled",
      message: "KI-Unterstützung ist für diesen Mandanten nicht verfügbar.",
    };
  }

  const policy = await resolveProviderPolicy(admin, tenantId);
  return "ok" in policy ? policy : { ok: true, policy };
}

/**
 * Applies fixed service ceilings and the narrower tenant approval ceilings.
 * The accompanying database RPC must re-check these limits atomically before
 * persisting or reserving capacity, because isolate-local counters are not a
 * safe rate-limit mechanism.
 */
export function validateAiBudget(
  policy: AiProviderPolicy,
  maxOutputTokens: number,
  maxCostCents: number,
): Extract<AiGovernanceFailure, { code: "ai_budget_exceeded" }> | null {
  if (
    !isPositiveInteger(maxOutputTokens, MAX_OUTPUT_TOKENS) ||
    !isPositiveInteger(maxCostCents, MAX_COST_CENTS) ||
    maxOutputTokens > policy.maxOutputTokens ||
    maxCostCents > policy.maxCostCentsPerRequest
  ) {
    return {
      ok: false,
      status: 429,
      code: "ai_budget_exceeded",
      message: "Der KI-Anforderungsrahmen für diesen Mandanten ist erreicht.",
    };
  }
  return null;
}

/** A tenant approval explicitly lists the permitted business purposes. */
export function validateAiPurpose(
  policy: AiProviderPolicy,
  purpose: AiPurpose,
): AiPurposeNotApprovedFailure | null {
  return policy.allowedPurposes.includes(purpose) ? null : purposeNotApproved();
}

/**
 * Queues a metadata-only draft intent through an atomic, schema-owned RPC.
 * No input text, secret, prompt, completion, audit payload, or model endpoint
 * is supplied to the database. The RPC contract is intentionally strict:
 * it must validate tenant/provider approval, enforce the hourly rate and cost
 * budget atomically, verify any object reference, and return `{ request_id }`.
 */
export async function queueMinimalAiDraftRequest(
  admin: AdminClient,
  request: {
    tenantId: string;
    actorId: string;
    purpose: AiPurpose;
    object: AiDraftObject;
    inputCharacterCount: number;
    maxOutputTokens: number;
    maxCostCents: number;
    externalArticleContent: boolean;
  },
): Promise<QueuedAiDraft> {
  const { data, error } = await admin.rpc(AI_DRAFT_QUEUE_RPC, {
    p_tenant_id: request.tenantId,
    p_actor_id: request.actorId,
    p_provider_key: AI_PROVIDER_KEY,
    p_purpose: request.purpose,
    p_object_type: request.object.type,
    p_object_id: request.object.id,
    p_input_character_count: request.inputCharacterCount,
    p_max_output_tokens: request.maxOutputTokens,
    p_max_cost_cents: request.maxCostCents,
    p_external_article_content: request.externalArticleContent,
  });

  if (error) {
    const code = typeof error.code === "string" ? error.code : "";
    // A future RPC can deliberately raise 42501 or P0001 for a rejected,
    // concurrently exhausted rate/cost window. It is still a neutral response.
    if (code === "P0001") {
      return {
        ok: false,
        status: 429,
        code: "ai_budget_exceeded",
        message: "Der KI-Anforderungsrahmen für diesen Mandanten ist erreicht.",
      };
    }
    if (code === "42501") return providerNotApproved();
    if (code === "P0002") {
      return {
        ok: false,
        status: 404,
        code: "ai_object_not_available",
        message: "Das Objekt ist für die KI-Anfrage nicht verfügbar.",
      };
    }
    if (code === "P0003") {
      return {
        ok: false,
        status: 403,
        code: "ai_external_article_content_not_approved",
        message:
          "Externe Artikelinhalte sind für diesen KI-Anbieter nicht freigegeben.",
      };
    }
    // Do not expose PostgREST/PostgreSQL details, including schema names.
    void isSchemaCapabilityError(error as DatabaseError);
    return unavailable();
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!isRecord(result) || !isUuid(result.request_id)) return unavailable();
  return { ok: true, requestId: result.request_id };
}
