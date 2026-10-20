import { type SupabaseContext, withSupabase } from "@supabase/server";
import {
  AnthropicKnowledgeDraftError,
  generateKnowledgeDraft,
} from "../_shared/anthropic-knowledge-draft.ts";
import {
  AI_PROVIDER_KEY,
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
const KNOWLEDGE_MANAGE_PERMISSION = "knowledge.manage";
const MAX_REQUEST_BYTES = 12 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;
type AdminClient = SupabaseContext["supabaseAdmin"];
type Visibility = "internal" | "external";
type AnthropicApproval = {
  enabled: boolean;
  allowExternalArticleContent: boolean;
  allowedPurposes: AiPurpose[];
};
type Action =
  | { type: "getAdminConfiguration"; tenantId: string }
  | {
      type: "setAnthropicApproval";
      tenantId: string;
      enabled: boolean;
      allowExternalArticleContent: boolean;
    }
  | {
      type: "prepareKnowledgeArticle";
      tenantId: string;
      visibility: Visibility;
      rawContent: string;
      articleId?: string;
    };

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasOnlyKeys(value: Row, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isUnsafeControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint === undefined ||
    (codePoint >= 0x0001 && codePoint <= 0x0008) ||
    (codePoint >= 0x000b && codePoint <= 0x000c) ||
    (codePoint >= 0x000e && codePoint <= 0x001f) ||
    (codePoint >= 0x007f && codePoint <= 0x009f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function sanitizeRawContent(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    value.includes("\u0000")
  ) {
    return null;
  }
  const sanitized = Array.from(value)
    .filter((character) => !isUnsafeControlCharacter(character))
    .join("")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  const count = Array.from(sanitized).length;
  const secretLike =
    /(?:authorization\s*:\s*bearer|api[ _-]?key\s*[=:]|-----begin [a-z ]*private key-----|(?:sk|pk)_[a-z0-9_-]{16,})/i;
  return count >= 1 &&
    count <= MAX_INPUT_CHARACTERS &&
    !secretLike.test(sanitized)
    ? sanitized
    : null;
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
    value.type === "getAdminConfiguration" &&
    hasOnlyKeys(value, ["type", "tenantId"])
  ) {
    return { type: value.type, tenantId };
  }
  if (
    value.type === "setAnthropicApproval" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "enabled",
      "allowExternalArticleContent",
    ]) &&
    typeof value.enabled === "boolean" &&
    typeof value.allowExternalArticleContent === "boolean"
  ) {
    return {
      type: value.type,
      tenantId,
      enabled: value.enabled,
      allowExternalArticleContent: value.allowExternalArticleContent,
    };
  }
  if (
    value.type === "prepareKnowledgeArticle" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "articleId",
      "visibility",
      "rawContent",
    ]) &&
    (value.visibility === "internal" || value.visibility === "external")
  ) {
    const rawContent = sanitizeRawContent(value.rawContent);
    if (
      !rawContent ||
      (value.articleId !== undefined && !isUuid(value.articleId))
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId,
      visibility: value.visibility,
      rawContent,
      ...(typeof value.articleId === "string"
        ? { articleId: value.articleId.toLowerCase() }
        : {}),
    };
  }
  return null;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
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

function response(request: Request, body: Row, status = 200): Response {
  const headers = corsHeaders(request);
  headers.set("X-Request-Id", crypto.randomUUID());
  if (status === 405) headers.set("Allow", "POST, OPTIONS");
  return new Response(JSON.stringify(body), { status, headers });
}

function deniedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin !== APP_ORIGIN;
}

async function parseJson(request: Request): Promise<unknown | null> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!Number.isSafeInteger(Number(contentLength)) ||
      Number(contentLength) > MAX_REQUEST_BYTES)
  ) {
    return null;
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return null;
  }
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    return bytes.byteLength <= MAX_REQUEST_BYTES
      ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      : null;
  } catch {
    return null;
  }
}

async function activeMembership(
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
  return error ? null : Boolean(data);
}

async function hasTenantPermission(
  admin: AdminClient,
  actorId: string,
  tenantId: string,
  permissionCode: string,
): Promise<boolean | null> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("user_role_assignments")
    .select(
      "roles!user_role_assignments_role_tenant_fk!inner(active, scope, role_permissions!inner(permission_code))",
    )
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  if (error) return null;
  return (data ?? []).some((assignment: any) => {
    const role = assignment.roles;
    return (
      role?.active === true &&
      role.scope === "tenant" &&
      Array.isArray(role.role_permissions) &&
      role.role_permissions.some(
        (permission: any) => permission?.permission_code === permissionCode,
      )
    );
  });
}

async function isTenantAdministrator(
  admin: AdminClient,
  actorId: string,
  tenantId: string,
): Promise<boolean | null> {
  const membership = await activeMembership(admin, actorId, tenantId);
  if (membership !== true) return membership;
  const now = new Date().toISOString();
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "Tenant administrator")
    .eq("scope", "tenant")
    .eq("active", true)
    .maybeSingle();
  if (roleError || !role?.id) return roleError ? null : false;
  const { data, error } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("role_id", role.id)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  return error ? null : Boolean(data);
}

function isPurpose(value: unknown): value is AiPurpose {
  return (
    value === "general_draft" ||
    value === "ticket_reply_draft" ||
    value === "knowledge_article_draft"
  );
}

function safeApproval(value: unknown): AnthropicApproval {
  if (!isRecord(value)) {
    return {
      enabled: false,
      allowExternalArticleContent: false,
      allowedPurposes: [],
    };
  }
  return {
    enabled: value.enabled === true,
    allowExternalArticleContent: value.allow_external_article_content === true,
    allowedPurposes: Array.isArray(value.allowed_purposes)
      ? value.allowed_purposes.filter(isPurpose)
      : [],
  };
}

async function readApproval(
  admin: AdminClient,
  tenantId: string,
): Promise<AnthropicApproval | null> {
  const { data, error } = await admin
    .from("tenant_ai_provider_approvals")
    .select("enabled, allowed_purposes, allow_external_article_content")
    .eq("tenant_id", tenantId)
    .eq("provider_key", AI_PROVIDER_KEY)
    .maybeSingle();
  return error ? null : safeApproval(data);
}

async function writeAudit(
  admin: AdminClient,
  tenantId: string,
  actorId: string,
  action: string,
  metadata: Row,
): Promise<boolean> {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: "ai_provider_approval",
    entity_id: tenantId,
    severity: "security",
    metadata,
  });
  return !error;
}

function anthropicConfiguration(): { apiKey: string; model: string } | null {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
  const model = Deno.env.get("ANTHROPIC_MODEL")?.trim();
  return apiKey && model ? { apiKey, model } : null;
}

const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    const action = parseAction(await parseJson(request));
    const actorId = context.userClaims?.id;
    if (!action || !isUuid(actorId)) {
      return response(request, { error: { code: "invalid_request" } }, 400);
    }
    const admin = context.supabaseAdmin;

    if (
      action.type === "getAdminConfiguration" ||
      action.type === "setAnthropicApproval"
    ) {
      const administrator = await isTenantAdministrator(
        admin,
        actorId,
        action.tenantId,
      );
      if (administrator === null) {
        return response(
          request,
          { error: { code: "authorization_check_failed" } },
          503,
        );
      }
      if (!administrator) {
        return response(
          request,
          { error: { code: "tenant_admin_required" } },
          403,
        );
      }
      if (action.type === "getAdminConfiguration") {
        const approval = await readApproval(admin, action.tenantId);
        if (approval === null) {
          return response(
            request,
            { error: { code: "ai_governance_unavailable" } },
            503,
          );
        }
        return response(request, {
          data: {
            provider: "Anthropic",
            approval,
            providerConfigured: anthropicConfiguration() !== null,
          },
        });
      }
      const approvedAt = new Date().toISOString();
      const { error } = await admin.from("tenant_ai_provider_approvals").upsert(
        {
          tenant_id: action.tenantId,
          provider_key: AI_PROVIDER_KEY,
          enabled: action.enabled,
          allowed_purposes: ["general_draft", "knowledge_article_draft"],
          allow_external_article_content: action.allowExternalArticleContent,
          approved_by: actorId,
          approved_at: approvedAt,
          expires_at: null,
          max_requests_per_hour: 10,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          max_cost_cents_per_request: MAX_COST_CENTS,
          updated_at: approvedAt,
        },
        { onConflict: "tenant_id,provider_key" },
      );
      if (
        error ||
        !(await writeAudit(
          admin,
          action.tenantId,
          actorId,
          "ai.anthropic_approval.updated",
          {
            enabled: action.enabled,
            allow_external_article_content: action.allowExternalArticleContent,
            purpose_count: 2,
          },
        ))
      ) {
        return response(
          request,
          { error: { code: "ai_governance_update_failed" } },
          500,
        );
      }
      return response(request, { data: { updated: true } });
    }

    const member = await activeMembership(admin, actorId, action.tenantId);
    if (member === null)
      return response(
        request,
        { error: { code: "authorization_check_failed" } },
        503,
      );
    if (!member)
      return response(
        request,
        { error: { code: "tenant_membership_required" } },
        403,
      );
    const permitted = await hasTenantPermission(
      admin,
      actorId,
      action.tenantId,
      KNOWLEDGE_MANAGE_PERMISSION,
    );
    if (permitted === null)
      return response(
        request,
        { error: { code: "authorization_check_failed" } },
        503,
      );
    if (!permitted)
      return response(
        request,
        { error: { code: "article_manage_denied" } },
        403,
      );

    const governance = await resolveAiGovernance(admin, action.tenantId);
    if (!governance.ok) {
      return response(
        request,
        { error: { code: governance.code } },
        governance.status,
      );
    }
    if (
      action.visibility === "external" &&
      !governance.policy.allowExternalArticleContent
    ) {
      return response(
        request,
        { error: { code: "ai_external_article_content_not_approved" } },
        403,
      );
    }
    const purpose: AiPurpose = action.articleId
      ? "knowledge_article_draft"
      : "general_draft";
    const object: AiDraftObject = action.articleId
      ? { type: "knowledge_article", id: action.articleId }
      : { type: "none", id: null };
    const purposeFailure = validateAiPurpose(governance.policy, purpose);
    const budgetFailure = validateAiBudget(
      governance.policy,
      MAX_OUTPUT_TOKENS,
      MAX_COST_CENTS,
    );
    if (purposeFailure) {
      return response(
        request,
        { error: { code: purposeFailure.code } },
        purposeFailure.status,
      );
    }
    if (budgetFailure)
      return response(
        request,
        { error: { code: budgetFailure.code } },
        budgetFailure.status,
      );
    const provider = anthropicConfiguration();
    if (!provider) {
      return response(
        request,
        { error: { code: "ai_provider_not_configured" } },
        503,
      );
    }
    const queued = await queueMinimalAiDraftRequest(admin, {
      tenantId: action.tenantId,
      actorId,
      purpose,
      object,
      inputCharacterCount: Array.from(action.rawContent).length,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxCostCents: MAX_COST_CENTS,
      // Existing articles are checked against their locked database visibility
      // inside the queue RPC. For a new article this is the explicit current
      // classification chosen before any article exists.
      externalArticleContent: action.visibility === "external",
    });
    if (!queued.ok)
      return response(request, { error: { code: queued.code } }, queued.status);
    if (
      !(await writeAudit(
        admin,
        action.tenantId,
        actorId,
        "knowledge.article.ai_draft_requested",
        {
          provider: AI_PROVIDER_KEY,
          purpose,
          request_id: queued.requestId,
          external_visibility: action.visibility === "external",
        },
      ))
    ) {
      return response(request, { error: { code: "ai_audit_failed" } }, 500);
    }
    try {
      const draft = await generateKnowledgeDraft({
        ...provider,
        rawContent: action.rawContent,
        maxTokens: MAX_OUTPUT_TOKENS,
      });
      if (
        !(await writeAudit(
          admin,
          action.tenantId,
          actorId,
          "knowledge.article.ai_draft_completed",
          {
            provider: AI_PROVIDER_KEY,
            purpose,
            request_id: queued.requestId,
          },
        ))
      ) {
        return response(request, { error: { code: "ai_audit_failed" } }, 500);
      }
      return response(request, { data: draft });
    } catch (error) {
      const code =
        error instanceof AnthropicKnowledgeDraftError
          ? error.code
          : "ai_provider_request_failed";
      await writeAudit(
        admin,
        action.tenantId,
        actorId,
        "knowledge.article.ai_draft_failed",
        {
          provider: AI_PROVIDER_KEY,
          purpose,
          request_id: queued.requestId,
          failure_code: code,
        },
      );
      return response(request, { error: { code } }, 503);
    }
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      if (deniedOrigin(request))
        return response(
          request,
          { error: { code: "origin_not_allowed" } },
          403,
        );
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (deniedOrigin(request))
      return response(request, { error: { code: "origin_not_allowed" } }, 403);
    if (request.method !== "POST")
      return response(request, { error: { code: "method_not_allowed" } }, 405);
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      return response(
        request,
        { error: { code: "unsupported_media_type" } },
        415,
      );
    }
    const result = await handler(request);
    if (result.headers.has("x-supabase-server-error")) {
      return response(
        request,
        {
          error: {
            code:
              result.status === 401
                ? "authentication_required"
                : "permission_denied",
          },
        },
        result.status === 401 ? 401 : 403,
      );
    }
    return new Response(result.body, {
      status: result.status,
      headers: corsHeaders(request),
    });
  },
};
