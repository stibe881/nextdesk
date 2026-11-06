import { type SupabaseContext, withSupabase } from "@supabase/server";
import {
  AnthropicKnowledgeDraftError,
  generateKnowledgeDraft,
  type KnowledgeDraftImage,
  TICKET_ARTICLE_INSTRUCTIONS,
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
import {
  departmentVisible,
  loadDepartmentScope,
  resolveRecordDepartment,
} from "../_shared/department-scope.ts";

const APP_ORIGIN = "https://app.nextdesk.ch";
const KNOWLEDGE_MANAGE_PERMISSION = "knowledge.manage";
const KNOWLEDGE_FEATURE = "knowledge.base";
const MAX_REQUEST_BYTES = 12 * 1024;
/** Upper bound for the ticket text sent to the provider (see migration 0162). */
const MAX_TICKET_INPUT_CHARACTERS = 12_000;
const MAX_TICKET_COMMENTS = 80;
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
  | { type: "draftArticleFromTicket"; tenantId: string; ticketId: string }
  | {
      type: "prepareKnowledgeArticle";
      tenantId: string;
      visibility: Visibility;
      rawContent: string;
      articleId?: string;
      imageIds: string[];
    };

const MAX_DRAFT_IMAGES = 6;
const MAX_DRAFT_IMAGE_BYTES = 4 * 1024 * 1024;
const KNOWLEDGE_IMAGE_BUCKET = "knowledge-article-images";
const DRAFT_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Loads the knowledge images the person added to the raw content (only
 * images of this tenant), for the model to look at.
 */
async function loadDraftImages(
  admin: AdminClient,
  tenantId: string,
  imageIds: string[],
): Promise<KnowledgeDraftImage[] | null> {
  if (imageIds.length === 0) return [];
  const { data, error } = await admin
    .from("knowledge_article_images")
    .select("id, storage_path, content_type, byte_size")
    .eq("tenant_id", tenantId)
    .in("id", imageIds);
  if (error) return null;
  const rows = (data ?? []) as Row[];
  const images: KnowledgeDraftImage[] = [];
  for (const id of imageIds) {
    const row = rows.find((item) => item.id === id);
    if (
      !row ||
      typeof row.storage_path !== "string" ||
      !row.storage_path.startsWith(`${tenantId}/`) ||
      !DRAFT_IMAGE_TYPES.has(String(row.content_type)) ||
      Number(row.byte_size) > MAX_DRAFT_IMAGE_BYTES
    ) {
      continue;
    }
    const { data: file, error: downloadError } = await admin.storage
      .from(KNOWLEDGE_IMAGE_BUCKET)
      .download(row.storage_path);
    if (downloadError || !file) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    images.push({
      id,
      mediaType: String(row.content_type) as KnowledgeDraftImage["mediaType"],
      base64: btoa(binary),
    });
  }
  return images;
}

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
    value.type === "draftArticleFromTicket" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId"]) &&
    isUuid(value.ticketId)
  ) {
    return { type: value.type, tenantId, ticketId: value.ticketId.toLowerCase() };
  }
  if (
    value.type === "prepareKnowledgeArticle" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "articleId",
      "visibility",
      "rawContent",
      "imageIds",
    ]) &&
    (value.visibility === "internal" || value.visibility === "external")
  ) {
    const rawContent = sanitizeRawContent(value.rawContent);
    const imageIds = value.imageIds === undefined ? [] : value.imageIds;
    if (
      !rawContent ||
      (value.articleId !== undefined && !isUuid(value.articleId)) ||
      !Array.isArray(imageIds) ||
      imageIds.length > MAX_DRAFT_IMAGES ||
      !imageIds.every(isUuid)
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId,
      visibility: value.visibility,
      rawContent,
      imageIds: [...new Set(imageIds.map((id) => id.toLowerCase()))],
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

/** Removes contact data and secret-like lines before text leaves nextDesk. */
function redactTicketText(value: string): string {
  const secretLike =
    /(?:authorization\s*:\s*bearer|api[ _-]?key\s*[=:]|passw(?:or)?t\s*[=:]|password\s*[=:]|-----begin [a-z ]*private key-----|(?:sk|pk)_[a-z0-9_-]{16,})/i;
  return Array.from(value)
    .filter((character) => !isUnsafeControlCharacter(character))
    .join("")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (secretLike.test(line) ? "[entfernt: vertraulicher Inhalt]" : line))
    .join("\n")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[E-Mail]")
    .replace(/(?:\+|00)\d[\d\s/-]{7,}\d|\b0\d{2}[\s/-]?\d{3}[\s/-]?\d{2}[\s/-]?\d{2}\b/g, "[Telefon]")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clip(value: string, maximum: number): string {
  const characters = Array.from(value);
  return characters.length <= maximum
    ? value
    : `${characters.slice(0, maximum).join("")} …`;
}

/**
 * Reads the ticket with the caller's own client, so row-level security decides
 * what the person may see (e.g. internal notes). Newest history wins when the
 * text has to be shortened.
 */
async function ticketSourceText(
  client: SupabaseContext["supabase"],
  tenantId: string,
  ticketId: string,
): Promise<string | null | "not_found"> {
  const { data: ticket, error } = await client
    .from("tickets")
    .select("id, subject, description")
    .eq("tenant_id", tenantId)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) return null;
  if (!ticket) return "not_found";
  const { data: comments, error: commentsError } = await client
    .from("ticket_comments")
    .select("visibility, body, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(MAX_TICKET_COMMENTS);
  if (commentsError) return null;

  const header = clip(
    redactTicketText(
      [
        `Betreff: ${typeof ticket.subject === "string" ? ticket.subject : ""}`,
        "",
        "Beschreibung:",
        typeof ticket.description === "string" ? ticket.description : "",
      ].join("\n"),
    ),
    4_000,
  );
  let budget = MAX_TICKET_INPUT_CHARACTERS - Array.from(header).length - 40;
  const history: string[] = [];
  for (const comment of (comments ?? []) as Row[]) {
    if (typeof comment.body !== "string" || !comment.body.trim()) continue;
    const label = comment.visibility === "internal" ? "Interne Notiz" : "Antwort";
    const entry = `[${label}] ${clip(redactTicketText(comment.body), 2_000)}`;
    const size = Array.from(entry).length + 2;
    if (size > budget) break;
    budget -= size;
    history.unshift(entry);
  }
  const text = history.length
    ? `${header}\n\nVerlauf (älteste zuerst):\n\n${history.join("\n\n")}`
    : header;
  return clip(text, MAX_TICKET_INPUT_CHARACTERS);
}

function articleSlug(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return `${base || "article"}-${crypto.randomUUID().slice(0, 8)}`;
}

async function draftArticleFromTicket(
  request: Request,
  client: SupabaseContext["supabase"],
  admin: AdminClient,
  actorId: string,
  action: Extract<Action, { type: "draftArticleFromTicket" }>,
  policy: Parameters<typeof validateAiPurpose>[0],
): Promise<Response> {
  const purposeFailure = validateAiPurpose(policy, "knowledge_article_draft");
  if (purposeFailure)
    return response(
      request,
      { error: { code: purposeFailure.code } },
      purposeFailure.status,
    );
  const budgetFailure = validateAiBudget(
    policy,
    MAX_OUTPUT_TOKENS,
    MAX_COST_CENTS,
  );
  if (budgetFailure)
    return response(
      request,
      { error: { code: budgetFailure.code } },
      budgetFailure.status,
    );
  const provider = anthropicConfiguration();
  if (!provider)
    return response(
      request,
      { error: { code: "ai_provider_not_configured" } },
      503,
    );

  const source = await ticketSourceText(client, action.tenantId, action.ticketId);
  if (source === null)
    return response(request, { error: { code: "ticket_read_failed" } }, 503);
  if (source === "not_found")
    return response(request, { error: { code: "ticket_not_found" } }, 404);

  // The draft goes to the ticket's department when it is one of the agent's
  // knowledge departments, otherwise to the agent's only department. This is
  // settled before the provider is called.
  const scope = await loadDepartmentScope(
    admin,
    action.tenantId,
    actorId,
    KNOWLEDGE_FEATURE,
  );
  const { data: ticketRow, error: ticketError } = await admin
    .from("tickets")
    .select("department_id")
    .eq("tenant_id", action.tenantId)
    .eq("id", action.ticketId)
    .maybeSingle();
  if (!scope || ticketError)
    return response(
      request,
      { error: { code: "department_scope_lookup_failed" } },
      503,
    );
  const ticketDepartment =
    typeof ticketRow?.department_id === "string" &&
    scope.departments.includes(ticketRow.department_id)
      ? ticketRow.department_id
      : undefined;
  const department = resolveRecordDepartment(scope, ticketDepartment);
  if ("error" in department)
    return response(
      request,
      {
        error: {
          code: "article_department_required",
          message: department.error,
        },
      },
      422,
    );

  const queued = await queueMinimalAiDraftRequest(admin, {
    tenantId: action.tenantId,
    actorId,
    purpose: "knowledge_article_draft",
    object: { type: "ticket", id: action.ticketId } as AiDraftObject,
    inputCharacterCount: Math.max(1, Array.from(source).length),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxCostCents: MAX_COST_CENTS,
    externalArticleContent: false,
  });
  if (!queued.ok)
    return response(request, { error: { code: queued.code } }, queued.status);
  await writeAudit(
    admin,
    action.tenantId,
    actorId,
    "knowledge.article.ai_ticket_draft_requested",
    { provider: AI_PROVIDER_KEY, request_id: queued.requestId },
  );

  let draft: { title: string; bodyMarkdown: string };
  try {
    draft = await generateKnowledgeDraft({
      ...provider,
      rawContent: source,
      maxTokens: MAX_OUTPUT_TOKENS,
      extraInstructions: TICKET_ARTICLE_INSTRUCTIONS,
    });
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
        request_id: queued.requestId,
        failure_code: code,
      },
    );
    return response(request, { error: { code } }, 503);
  }

  // Always an internal draft: a person has to review, edit and publish it.
  const now = new Date().toISOString();
  const { data: article, error: articleError } = await admin
    .from("knowledge_articles")
    .insert({
      tenant_id: action.tenantId,
      department_id: department.departmentId,
      title: draft.title,
      slug: articleSlug(draft.title),
      visibility: "internal",
      status: "draft",
      current_revision: 1,
      created_by: actorId,
      updated_at: now,
    })
    .select("id, title")
    .single();
  if (articleError || !article)
    return response(request, { error: { code: "article_create_failed" } }, 422);
  const { error: revisionError } = await admin
    .from("knowledge_article_revisions")
    .insert({
      article_id: article.id,
      revision: 1,
      title_snapshot: draft.title,
      body: draft.bodyMarkdown,
      author_id: actorId,
    });
  if (revisionError) {
    await admin
      .from("knowledge_articles")
      .delete()
      .eq("tenant_id", action.tenantId)
      .eq("id", article.id);
    return response(
      request,
      { error: { code: "article_revision_create_failed" } },
      500,
    );
  }
  await admin.from("audit_logs").insert({
    tenant_id: action.tenantId,
    actor_id: actorId,
    action: "knowledge.article.created",
    entity_type: "knowledge_article",
    entity_id: article.id,
    severity: "info",
    metadata: {
      source: "ai_ticket_draft",
      ticket_id: action.ticketId,
      request_id: queued.requestId,
    },
  });

  // Link the draft to the ticket as internal knowledge (caller's own rights).
  const { error: linkError } = await client.rpc("ticket_knowledge_mutate", {
    p_action: "attach",
    p_tenant_id: action.tenantId,
    p_ticket_id: action.ticketId,
    p_article_id: article.id,
    p_visibility: "internal",
    p_title: null,
    p_body_markdown: null,
  });

  return response(
    request,
    {
      data: {
        articleId: article.id,
        title: article.title,
        linkedToTicket: !linkError,
      },
    },
    201,
  );
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
        return response(request, { data: { provider: "Anthropic", approval } });
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
    if (action.type === "draftArticleFromTicket") {
      return await draftArticleFromTicket(
        request,
        context.supabase,
        admin,
        actorId,
        action,
        governance.policy,
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
    if (action.articleId) {
      // Only articles of the agent's knowledge departments may be referenced.
      const scope = await loadDepartmentScope(
        admin,
        action.tenantId,
        actorId,
        KNOWLEDGE_FEATURE,
      );
      const { data: article, error: articleError } = await admin
        .from("knowledge_articles")
        .select("id, department_id")
        .eq("tenant_id", action.tenantId)
        .eq("id", action.articleId)
        .maybeSingle();
      if (!scope || articleError)
        return response(
          request,
          { error: { code: "department_scope_lookup_failed" } },
          503,
        );
      if (!article || !departmentVisible(scope, article.department_id))
        return response(request, { error: { code: "article_not_found" } }, 404);
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
      const images = await loadDraftImages(
        admin,
        action.tenantId,
        action.imageIds,
      );
      if (images === null) {
        return response(
          request,
          { error: { code: "ai_image_lookup_failed" } },
          503,
        );
      }
      const draft = await generateKnowledgeDraft({
        ...provider,
        rawContent: action.rawContent,
        maxTokens: MAX_OUTPUT_TOKENS,
        images,
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
