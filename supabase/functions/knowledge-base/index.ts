import { withSupabase } from "@supabase/server";
import { resolveUserFeatureStates } from "../_shared/tenant-features.ts";
import {
  applyDepartmentScope,
  type DepartmentScope,
  departmentVisible,
  loadDepartmentScope,
  resolveRecordDepartment,
  scopeDepartmentOptions,
} from "../_shared/department-scope.ts";
import {
  applyExternalArticleScope,
  customerOrganizationIds,
  publishedKnowledgeScope,
} from "../_shared/knowledge-visibility.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const KNOWLEDGE_MANAGE_PERMISSION = "knowledge.manage";
const KNOWLEDGE_READ_PERMISSION = "knowledge.read";
const KNOWLEDGE_PUBLISH_PERMISSION = "knowledge.publish";
const KNOWLEDGE_FEATURE = "knowledge.base";
const MAX_TITLE_LENGTH = 240;
const MAX_BODY_LENGTH = 100_000;
const MAX_QUERY_LENGTH = 120;
/** Request bodies: article texts stay well below 1 MB; images up to 5 MB. */
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_IMAGE_REQUEST_BYTES = 7 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_BUCKET = "knowledge-article-images";
const IMAGE_URL_TTL_SECONDS = 60 * 60;
const MAX_RESOLVED_IMAGES = 300;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const IMAGE_REFERENCE =
  /kb-image:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
const ARTICLE_SELECT =
  "id, title, slug, visibility, status, department_id, current_revision, published_revision, review_requested_at, published_at, created_at, updated_at";
const REVISION_SELECT =
  "id, article_id, revision, title_snapshot, body, summary, created_at";

type Visibility = "internal" | "external";
type Action =
  | { type: "listCollections"; tenantId: string }
  | {
      type: "createCollection";
      tenantId: string;
      name: string;
      parentId?: string;
    }
  | {
      type: "updateCollection";
      tenantId: string;
      collectionId: string;
      name: string;
    }
  | { type: "listArticles"; tenantId: string; query?: string }
  | { type: "getArticle"; tenantId: string; articleId: string }
  | { type: "listRevisions"; tenantId: string; articleId: string }
  | {
      type: "setArticleCollections";
      tenantId: string;
      articleId: string;
      collectionIds: string[];
    }
  | { type: "requestReview"; tenantId: string; articleId: string }
  | { type: "publishArticle"; tenantId: string; articleId: string }
  | {
      type: "decideReview";
      tenantId: string;
      articleId: string;
      decision: "approved" | "rejected";
      note?: string;
    }
  | {
      type: "saveArticle";
      tenantId: string;
      articleId?: string;
      title: string;
      bodyMarkdown: string;
      visibility: Visibility;
      departmentId?: string;
    }
  | { type: "archiveArticle"; tenantId: string; articleId: string }
  | { type: "deleteArticle"; tenantId: string; articleId: string }
  | { type: "deleteCollection"; tenantId: string; collectionId: string }
  | {
      type: "uploadArticleImage";
      tenantId: string;
      fileName: string;
      contentType: string;
      data: string;
    };

type AuthorizationResult =
  { ok: true } | { ok: false; status: 403 | 500; code: string };

type ArticleAuditData = {
  title: string;
  visibility: Visibility;
  departmentId: string | null;
  status: string;
  currentRevision: number | null;
  bodyLength: number;
};

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

function requiredText(
  value: unknown,
  minLength: number,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= minLength && trimmed.length <= maxLength
    ? trimmed
    : null;
}

function optionalQuery(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= MAX_QUERY_LENGTH ? trimmed : null;
}

function optionalUuid(
  value: unknown,
): { valid: true; value?: string | null } | { valid: false } {
  if (value === undefined || value === null) return { valid: true, value };
  return isUuid(value) ? { valid: true, value } : { valid: false };
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;

  if (value.type === "listCollections")
    return { type: value.type, tenantId: value.tenantId };

  if (value.type === "createCollection") {
    const name = requiredText(value.name, 2, 100);
    const parent = optionalUuid(value.parentId);
    if (!name || !parent.valid) return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      name,
      ...(typeof parent.value === "string" ? { parentId: parent.value } : {}),
    };
  }

  if (value.type === "updateCollection") {
    const name = requiredText(value.name, 2, 100);
    if (!isUuid(value.collectionId) || !name) return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      collectionId: value.collectionId,
      name,
    };
  }

  if (value.type === "listArticles") {
    const query = optionalQuery(value.query);
    if (query === null) return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      ...(query !== undefined && query.length > 0 ? { query } : {}),
    };
  }

  if (value.type === "getArticle" && isUuid(value.articleId))
    return {
      type: value.type,
      tenantId: value.tenantId,
      articleId: value.articleId,
    };

  if (value.type === "listRevisions" && isUuid(value.articleId))
    return {
      type: value.type,
      tenantId: value.tenantId,
      articleId: value.articleId,
    };

  if (value.type === "setArticleCollections" && isUuid(value.articleId)) {
    if (
      !Array.isArray(value.collectionIds) ||
      value.collectionIds.length > 12 ||
      !value.collectionIds.every(isUuid) ||
      new Set(value.collectionIds).size !== value.collectionIds.length
    )
      return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      articleId: value.articleId,
      collectionIds: value.collectionIds,
    };
  }

  if (
    (value.type === "requestReview" || value.type === "publishArticle") &&
    isUuid(value.articleId)
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      articleId: value.articleId,
    };

  if (value.type === "decideReview" && isUuid(value.articleId)) {
    const note = optionalQuery(value.note);
    if (
      (value.decision !== "approved" && value.decision !== "rejected") ||
      note === null
    )
      return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      articleId: value.articleId,
      decision: value.decision,
      ...(note?.length ? { note } : {}),
    };
  }

  if (
    (value.type === "archiveArticle" || value.type === "deleteArticle") &&
    isUuid(value.articleId)
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      articleId: value.articleId,
    };

  if (value.type === "deleteCollection" && isUuid(value.collectionId))
    return {
      type: value.type,
      tenantId: value.tenantId,
      collectionId: value.collectionId,
    };

  if (value.type === "uploadArticleImage") {
    const fileName = requiredText(value.fileName, 1, 200);
    if (
      fileName === null ||
      typeof value.contentType !== "string" ||
      !IMAGE_EXTENSIONS[value.contentType] ||
      typeof value.data !== "string" ||
      value.data.length === 0 ||
      value.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)
    )
      return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      fileName,
      contentType: value.contentType,
      data: value.data,
    };
  }

  if (value.type === "saveArticle") {
    const article = optionalUuid(value.articleId);
    const department = optionalUuid(value.departmentId);
    const title = requiredText(value.title, 3, MAX_TITLE_LENGTH);
    if (
      !article.valid ||
      !department.valid ||
      title === null ||
      typeof value.bodyMarkdown !== "string" ||
      value.bodyMarkdown.length > MAX_BODY_LENGTH ||
      (value.visibility !== "internal" && value.visibility !== "external")
    )
      return null;

    return {
      type: value.type,
      tenantId: value.tenantId,
      ...(typeof article.value === "string"
        ? { articleId: article.value }
        : {}),
      title,
      bodyMarkdown: value.bodyMarkdown,
      visibility: value.visibility,
      ...(typeof department.value === "string"
        ? { departmentId: department.value.toLowerCase() }
        : {}),
    };
  }

  return null;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return headers;
}

function json(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: corsHeaders(request),
  });
}

function denyDisallowedOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== ALLOWED_ORIGIN)
    return json(request, { error: { code: "origin_not_allowed" } }, 403);
  return null;
}

async function isActiveTenantMember(
  admin: any,
  userId: string,
  tenantId: string,
): Promise<boolean | null> {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) return null;
  return Boolean(data);
}

async function hasTenantPermission(
  admin: any,
  userId: string,
  tenantId: string,
  permissionCode: string,
): Promise<boolean | null> {
  const now = new Date().toISOString();
  const { data: assignments, error } = await admin
    .from("user_role_assignments")
    .select(
      "roles!user_role_assignments_role_tenant_fk!inner(active, scope, role_permissions!inner(permission_code))",
    )
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  if (error) return null;

  return (assignments ?? []).some((assignment: any) => {
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

async function requireAuthorization(
  admin: any,
  userId: string,
  tenantId: string,
  mutation: boolean,
): Promise<AuthorizationResult> {
  const member = await isActiveTenantMember(admin, userId, tenantId);
  if (member === null)
    return { ok: false, status: 500, code: "authorization_check_failed" };
  if (!member)
    return { ok: false, status: 403, code: "tenant_membership_required" };
  if (!mutation) return { ok: true };

  const permitted = await hasTenantPermission(
    admin,
    userId,
    tenantId,
    KNOWLEDGE_MANAGE_PERMISSION,
  );
  if (permitted === null)
    return { ok: false, status: 500, code: "authorization_check_failed" };
  return permitted
    ? { ok: true }
    : { ok: false, status: 403, code: "article_manage_denied" };
}

function createSlug(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return `${base || "article"}-${crypto.randomUUID().slice(0, 8)}`;
}

function auditData(article: any, revision: any | null): ArticleAuditData {
  return {
    title: typeof article.title === "string" ? article.title : "",
    visibility: article.visibility === "external" ? "external" : "internal",
    departmentId:
      typeof article.department_id === "string" ? article.department_id : null,
    status: typeof article.status === "string" ? article.status : "",
    currentRevision:
      typeof article.current_revision === "number"
        ? article.current_revision
        : null,
    bodyLength: typeof revision?.body === "string" ? revision.body.length : 0,
  };
}

async function writeAudit(
  admin: any,
  tenantId: string,
  actorId: string,
  action: string,
  articleId: string,
  beforeData: ArticleAuditData | null,
  afterData: ArticleAuditData | null,
): Promise<boolean> {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: "article",
    entity_id: articleId,
    severity: "info",
    before_data: beforeData,
    after_data: afterData,
    metadata: { articleId },
  });
  return !error;
}

async function fetchCurrentRevision(
  admin: any,
  article: any,
): Promise<{ data: any | null; error: boolean }> {
  const { data, error } = await admin
    .from("knowledge_article_revisions")
    .select(REVISION_SELECT)
    .eq("article_id", article.id)
    .eq("revision", article.current_revision)
    .maybeSingle();
  return { data: data ?? null, error: Boolean(error) };
}

async function fetchLatestRevisions(
  admin: any,
  articles: any[],
  publishedOnly = false,
): Promise<{ data: Map<string, any>; error: boolean }> {
  if (articles.length === 0) return { data: new Map(), error: false };

  const articleIds = articles.map((article) => article.id);
  const { data, error } = await admin
    .from("knowledge_article_revisions")
    .select(REVISION_SELECT)
    .in("article_id", articleIds)
    .order("revision", { ascending: false });
  if (error) return { data: new Map(), error: true };

  const newestByArticle = new Map<string, any>();
  for (const revision of data ?? []) {
    if (
      typeof revision.article_id === "string" &&
      (!publishedOnly ||
        revision.revision ===
          articles.find((article) => article.id === revision.article_id)
            ?.published_revision) &&
      !newestByArticle.has(revision.article_id)
    ) {
      newestByArticle.set(revision.article_id, revision);
    }
  }
  return { data: newestByArticle, error: false };
}

function articleResponse(
  article: any,
  revision: any | null,
  canReadInternal: boolean,
  collectionIds: string[],
): Record<string, unknown> {
  const title =
    !canReadInternal && typeof revision?.title_snapshot === "string"
      ? revision.title_snapshot
      : article.title;
  return { ...article, title, collection_ids: collectionIds };
}

const OUTCOME_WINDOW_DAYS = 90;
const NEEDS_REVISION_NOT_HELPFUL = 3;

type ArticleOutcomes = {
  windowDays: number;
  resolvedRecent: number;
  deflectedRecent: number;
  notHelpfulRecent: number;
  resolvedTotal: number;
  deflectedTotal: number;
  notHelpfulTotal: number;
  needsRevision: boolean;
};

function outcomeCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 0;
}

/**
 * How often each article helped (knowledge_article_outcomes, migration 0184),
 * for internal readers only and only for articles already filtered by the
 * reader's visibility. A missing table or function yields no counts.
 */
async function fetchArticleOutcomes(
  admin: any,
  tenantId: string,
  articles: any[],
): Promise<Map<string, ArticleOutcomes>> {
  const result = new Map<string, ArticleOutcomes>();
  const articleIds = articles
    .map((article: any) => article?.id)
    .filter((id: unknown) => isUuid(id));
  if (articleIds.length === 0) return result;
  const since = new Date(
    Date.now() - OUTCOME_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await admin.rpc("knowledge_article_outcome_counts", {
    p_tenant_id: tenantId,
    p_article_ids: articleIds,
    p_since: since,
  });
  const rows = new Map<string, any>();
  if (!error && Array.isArray(data)) {
    for (const row of data) {
      if (isRecord(row) && isUuid(row.article_id))
        rows.set(row.article_id, row);
    }
  }
  for (const article of articles) {
    if (!isUuid(article?.id)) continue;
    const row = rows.get(article.id) ?? {};
    const outcomes = {
      windowDays: OUTCOME_WINDOW_DAYS,
      resolvedRecent: outcomeCount(row.resolved_recent),
      deflectedRecent: outcomeCount(row.deflected_recent),
      notHelpfulRecent: outcomeCount(row.not_helpful_recent),
      resolvedTotal: outcomeCount(row.resolved_total),
      deflectedTotal: outcomeCount(row.deflected_total),
      notHelpfulTotal: outcomeCount(row.not_helpful_total),
    };
    result.set(article.id, {
      ...outcomes,
      needsRevision:
        article.status === "published" &&
        outcomes.notHelpfulRecent >= NEEDS_REVISION_NOT_HELPFUL &&
        outcomes.resolvedRecent === 0 &&
        outcomes.deflectedRecent === 0,
    });
  }
  return result;
}

function revisionResponse(revision: any): Record<string, unknown> {
  const { title_snapshot: _titleSnapshot, ...visibleRevision } = revision;
  return visibleRevision;
}

async function fetchArticleCollectionIds(
  admin: any,
  tenantId: string,
  articleIds: string[],
): Promise<{ data: Map<string, string[]>; error: boolean }> {
  if (!articleIds.length) return { data: new Map(), error: false };
  const { data, error } = await admin
    .from("knowledge_article_collections")
    .select("article_id, collection_id")
    .eq("tenant_id", tenantId)
    .in("article_id", articleIds);
  if (error) return { data: new Map(), error: true };
  const byArticle = new Map<string, string[]>();
  for (const row of data ?? []) {
    if (
      typeof row.article_id !== "string" ||
      typeof row.collection_id !== "string"
    )
      continue;
    byArticle.set(row.article_id, [
      ...(byArticle.get(row.article_id) ?? []),
      row.collection_id,
    ]);
  }
  return { data: byArticle, error: false };
}

/**
 * Reads the JSON body with a hard size bound (also for chunked requests).
 * Image uploads may be larger than all other actions.
 */
async function readRequestBody(
  request: Request,
): Promise<{ value: unknown; tooLarge: boolean }> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAX_IMAGE_REQUEST_BYTES)
  )
    return { value: null, tooLarge: true };
  if (!request.body) return { value: null, tooLarge: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_IMAGE_REQUEST_BYTES) {
        await reader.cancel();
        return { value: null, tooLarge: true };
      }
      chunks.push(chunk.value);
    }
  } catch {
    return { value: null, tooLarge: false };
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return { value: null, tooLarge: false };
  }
  // Only image uploads may use the larger bound.
  if (
    bytes > MAX_REQUEST_BYTES &&
    !(isRecord(value) && value.type === "uploadArticleImage")
  )
    return { value: null, tooLarge: true };
  return { value, tooLarge: false };
}

/** Decodes an uploaded image and checks that its content matches the type. */
function decodeArticleImage(
  data: string,
  contentType: string,
): Uint8Array | null {
  let bytes: Uint8Array;
  try {
    const binary = atob(data);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  const matches =
    (contentType === "image/jpeg" &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (contentType === "image/png" &&
      bytes[0] === 0x89 &&
      ascii(1, 4) === "PNG" &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a) ||
    (contentType === "image/webp" &&
      ascii(0, 4) === "RIFF" &&
      ascii(8, 12) === "WEBP") ||
    (contentType === "image/gif" &&
      (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a"));
  return matches ? bytes : null;
}

/** Alternative text for an uploaded image, safe inside Markdown brackets. */
function imageAltText(fileName: string): string {
  const alt = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[\[\]()\\!*_`<>#\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return alt || "Bild";
}

/** Image identifiers referenced as kb-image:<id> in Markdown texts. */
function referencedImageIds(bodies: unknown[]): string[] {
  const ids = new Set<string>();
  for (const body of bodies) {
    if (typeof body !== "string") continue;
    for (const match of body.matchAll(IMAGE_REFERENCE)) {
      ids.add(match[1].toLowerCase());
      if (ids.size >= MAX_RESOLVED_IMAGES) return [...ids];
    }
  }
  return [...ids];
}

/**
 * Short-lived signed URLs for the kb-image references of the given Markdown
 * texts (id → URL). Only images of the same tenant are resolved; the stored
 * Markdown stays unchanged.
 */
async function resolveImageUrls(
  admin: any,
  tenantId: string,
  bodies: unknown[],
): Promise<Record<string, string>> {
  const ids = referencedImageIds(bodies);
  const urls: Record<string, string> = {};
  if (ids.length === 0) return urls;
  const { data, error } = await admin
    .from("knowledge_article_images")
    .select("id, storage_path")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (error || !Array.isArray(data) || data.length === 0) return urls;
  const paths = data.map((row: any) => String(row.storage_path));
  const { data: signed } = await admin.storage
    .from(IMAGE_BUCKET)
    .createSignedUrls(paths, IMAGE_URL_TTL_SECONDS);
  data.forEach((row: any, index: number) => {
    const url = signed?.[index]?.signedUrl;
    if (typeof url === "string") urls[String(row.id)] = url;
  });
  return urls;
}

/**
 * Removes the images of a deleted article that no other article of the
 * tenant references in any revision. Best effort: a failure leaves the
 * (harmless, private) files in place.
 */
async function removeUnreferencedImages(
  admin: any,
  tenantId: string,
  imageIds: string[],
): Promise<void> {
  if (imageIds.length === 0) return;
  const { data: images, error } = await admin
    .from("knowledge_article_images")
    .select("id, storage_path")
    .eq("tenant_id", tenantId)
    .in("id", imageIds);
  if (error || !Array.isArray(images)) return;
  const unused: { id: string; storage_path: string }[] = [];
  for (const image of images) {
    const { data: users, error: usageError } = await admin
      .from("knowledge_article_revisions")
      .select("id, knowledge_articles!inner(tenant_id)")
      .eq("knowledge_articles.tenant_id", tenantId)
      .like("body", `%kb-image:${image.id}%`)
      .limit(1);
    if (!usageError && Array.isArray(users) && users.length === 0)
      unused.push(image);
  }
  if (unused.length === 0) return;
  const { error: storageError } = await admin.storage
    .from(IMAGE_BUCKET)
    .remove(unused.map((image) => image.storage_path));
  if (storageError) return;
  await admin
    .from("knowledge_article_images")
    .delete()
    .eq("tenant_id", tenantId)
    .in(
      "id",
      unused.map((image) => image.id),
    );
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  const originDenied = denyDisallowedOrigin(request);
  if (originDenied) return originDenied;
  if (request.method !== "POST")
    return json(request, { error: { code: "method_not_allowed" } }, 405);

  const body = await readRequestBody(request);
  if (body.tooLarge)
    return json(request, { error: { code: "payload_too_large" } }, 413);
  const action = parseAction(body.value);
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string")
    return json(request, { error: { code: "invalid_request" } }, 400);

  const admin = context.supabaseAdmin;
  const mutation =
    action.type === "saveArticle" ||
    action.type === "archiveArticle" ||
    action.type === "deleteArticle" ||
    action.type === "uploadArticleImage" ||
    action.type === "createCollection" ||
    action.type === "deleteCollection" ||
    action.type === "updateCollection" ||
    action.type === "setArticleCollections" ||
    action.type === "requestReview" ||
    action.type === "publishArticle" ||
    action.type === "decideReview";
  // The feature lookup is independent of the authorization check, so both run
  // at once; an authorization failure is still reported first.
  const featureStatesPromise = resolveUserFeatureStates(
    admin,
    action.tenantId,
    actorId,
    ["knowledge.base"],
  );
  featureStatesPromise.catch(() => undefined);
  const authorization = await requireAuthorization(
    admin,
    actorId,
    action.tenantId,
    mutation,
  );
  if (!authorization.ok)
    return json(
      request,
      { error: { code: authorization.code } },
      authorization.status,
    );

  const featureStates = await featureStatesPromise;
  if (featureStates === null)
    return json(
      request,
      { error: { code: "tenant_feature_lookup_failed" } },
      503,
    );
  if (featureStates["knowledge.base"] !== true)
    return json(
      request,
      { error: { code: "knowledge_feature_disabled" } },
      403,
    );

  // Agents and members see and edit the articles of their departments (plus
  // articles without a department); collections stay shared.
  let agentScope: DepartmentScope | null | undefined;
  const loadAgentScope = async (): Promise<DepartmentScope | null> => {
    if (agentScope === undefined)
      agentScope = await loadDepartmentScope(
        admin,
        action.tenantId,
        actorId,
        KNOWLEDGE_FEATURE,
      );
    return agentScope;
  };
  const scopeFailed = () =>
    json(request, { error: { code: "department_scope_lookup_failed" } }, 503);
  const articleNotFound = () =>
    json(request, { error: { code: "article_not_found" } }, 404);

  if (action.type === "listCollections") {
    const canReadInternal = await hasTenantPermission(
      admin,
      actorId,
      action.tenantId,
      KNOWLEDGE_READ_PERMISSION,
    );
    const canManage =
      canReadInternal === true
        ? false
        : await hasTenantPermission(
            admin,
            actorId,
            action.tenantId,
            KNOWLEDGE_MANAGE_PERMISSION,
          );
    if (canReadInternal === null || canManage === null)
      return json(
        request,
        { error: { code: "authorization_check_failed" } },
        500,
      );
    // Requesters browse published articles by collection too; collection
    // names carry no article content.
    const { data, error } = await admin
      .from("knowledge_collections")
      .select("id, name, slug, parent_id, active")
      .eq("tenant_id", action.tenantId)
      .eq("active", true)
      .order("name", { ascending: true })
      .limit(100);
    if (error)
      return json(request, { error: { code: "collection_list_failed" } }, 500);
    return json(request, { data: { collections: data ?? [] } });
  }

  if (action.type === "createCollection") {
    const { data, error } = await admin.rpc("create_knowledge_collection", {
      p_tenant_id: action.tenantId,
      p_name: action.name,
      p_parent_id: action.parentId ?? null,
      p_actor_id: actorId,
    });
    const collection =
      Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (error || !collection)
      return json(
        request,
        {
          error: {
            code:
              error?.code === "23505"
                ? "collection_name_conflict"
                : "collection_create_failed",
          },
        },
        error?.code === "23505" ? 409 : 422,
      );
    return json(request, { data: { collection } }, 201);
  }

  if (action.type === "deleteCollection") {
    // A category goes with its subcategories in one transaction (SQL function
    // of migration 0186, which also writes the audit record). Articles stay;
    // only their assignments to the deleted collections disappear (cascade).
    const { data, error } = await admin.rpc("delete_knowledge_collection", {
      p_tenant_id: action.tenantId,
      p_collection_id: action.collectionId,
      p_actor_id: actorId,
    });
    if (error?.code === "P0002")
      return json(request, { error: { code: "collection_not_found" } }, 404);
    const deleted = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (error || !isRecord(deleted) || !isUuid(deleted.collection_id))
      return json(
        request,
        { error: { code: "collection_delete_failed" } },
        500,
      );
    const deletedCollectionIds = Array.isArray(deleted.deleted_collection_ids)
      ? deleted.deleted_collection_ids.map((id: unknown) => String(id))
      : [deleted.collection_id];
    return json(request, {
      data: {
        collectionId: deleted.collection_id,
        deletedCollectionIds,
        deletedSubcategories: outcomeCount(deleted.deleted_subcategories),
        removedAssignments: outcomeCount(deleted.removed_assignments),
      },
    });
  }

  if (action.type === "uploadArticleImage") {
    const bytes = decodeArticleImage(action.data, action.contentType);
    if (!bytes) return json(request, { error: { code: "image_invalid" } }, 422);
    const id = crypto.randomUUID();
    const path = `${action.tenantId}/${id}.${IMAGE_EXTENSIONS[action.contentType]}`;
    const { error: uploadError } = await admin.storage
      .from(IMAGE_BUCKET)
      .upload(path, bytes, { contentType: action.contentType, upsert: false });
    if (uploadError)
      return json(request, { error: { code: "image_upload_failed" } }, 500);
    const { error: insertError } = await admin
      .from("knowledge_article_images")
      .insert({
        id,
        tenant_id: action.tenantId,
        storage_path: path,
        content_type: action.contentType,
        byte_size: bytes.length,
        uploaded_by: actorId,
      });
    if (insertError) {
      await admin.storage.from(IMAGE_BUCKET).remove([path]);
      return json(request, { error: { code: "image_upload_failed" } }, 500);
    }
    const { data: signed } = await admin.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(path, IMAGE_URL_TTL_SECONDS);
    return json(
      request,
      {
        data: {
          id,
          markdown: `![${imageAltText(action.fileName)}](kb-image:${id})`,
          url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
        },
      },
      201,
    );
  }

  if (action.type === "updateCollection") {
    const { data, error } = await admin.rpc("rename_knowledge_collection", {
      p_tenant_id: action.tenantId,
      p_collection_id: action.collectionId,
      p_name: action.name,
      p_actor_id: actorId,
    });
    const collection =
      Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (error || !collection)
      return json(
        request,
        {
          error: {
            code:
              error?.code === "23505"
                ? "collection_name_conflict"
                : error?.code === "P0002"
                  ? "collection_not_found"
                  : "collection_update_failed",
          },
        },
        error?.code === "P0002" ? 404 : error?.code === "23505" ? 409 : 422,
      );
    return json(request, { data: { collection } });
  }

  if (action.type === "decideReview") {
    const permitted = await hasTenantPermission(
      admin,
      actorId,
      action.tenantId,
      KNOWLEDGE_PUBLISH_PERMISSION,
    );
    if (permitted !== true)
      return json(request, { error: { code: "article_publish_denied" } }, 403);
  }

  if (action.type === "listRevisions") {
    const permitted = await hasTenantPermission(
      admin,
      actorId,
      action.tenantId,
      KNOWLEDGE_MANAGE_PERMISSION,
    );
    if (permitted !== true)
      return json(request, { error: { code: "article_manage_denied" } }, 403);
    const scope = await loadAgentScope();
    if (!scope) return scopeFailed();
    const { data: article, error: articleError } = await admin
      .from("knowledge_articles")
      .select("id, department_id")
      .eq("tenant_id", action.tenantId)
      .eq("id", action.articleId)
      .maybeSingle();
    if (articleError)
      return json(request, { error: { code: "article_read_failed" } }, 500);
    if (!article || !departmentVisible(scope, article.department_id))
      return articleNotFound();
    const { data, error } = await admin
      .from("knowledge_article_revisions")
      .select("id, article_id, revision, summary, created_at")
      .eq("article_id", action.articleId)
      .order("revision", { ascending: false })
      .limit(50);
    if (error)
      return json(
        request,
        { error: { code: "article_revision_list_failed" } },
        500,
      );
    return json(request, { data: { revisions: data ?? [] } });
  }

  if (action.type === "setArticleCollections") {
    const scope = await loadAgentScope();
    if (!scope) return scopeFailed();
    const { data: target, error: targetError } = await admin
      .from("knowledge_articles")
      .select("id, department_id")
      .eq("tenant_id", action.tenantId)
      .eq("id", action.articleId)
      .maybeSingle();
    if (targetError)
      return json(request, { error: { code: "article_read_failed" } }, 500);
    if (!target || !departmentVisible(scope, target.department_id))
      return articleNotFound();
    const { data, error } = await admin.rpc(
      "replace_knowledge_article_collections",
      {
        p_tenant_id: action.tenantId,
        p_article_id: action.articleId,
        p_collection_ids: action.collectionIds,
        p_actor_id: actorId,
      },
    );
    if (error || !Array.isArray(data))
      return json(
        request,
        {
          error: {
            code:
              error?.code === "P0002"
                ? "article_not_found"
                : "collection_assignment_failed",
          },
        },
        error?.code === "P0002" ? 404 : 422,
      );
    return json(request, {
      data: {
        articleId: action.articleId,
        collectionIds: data,
      },
    });
  }

  // Entwurf ohne Freigabe-Schritt veröffentlichen (z. B. KI-Entwürfe).
  if (action.type === "publishArticle") {
    const { data: article, error: articleError } = await admin
      .from("knowledge_articles")
      .select(ARTICLE_SELECT)
      .eq("tenant_id", action.tenantId)
      .eq("id", action.articleId)
      .in("status", ["draft", "review"])
      .maybeSingle();
    if (articleError)
      return json(request, { error: { code: "article_read_failed" } }, 500);
    const scope = await loadAgentScope();
    if (!scope) return scopeFailed();
    if (!article || !departmentVisible(scope, article.department_id))
      return articleNotFound();
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from("knowledge_articles")
      .update({
        status: "published",
        published_revision: article.current_revision,
        published_at: now,
        review_requested_at: null,
        review_requested_by: null,
        reviewed_at: null,
        reviewed_by: null,
        updated_at: now,
      })
      .eq("tenant_id", action.tenantId)
      .eq("id", article.id)
      .eq("current_revision", article.current_revision)
      .in("status", ["draft", "review"])
      .select(ARTICLE_SELECT)
      .maybeSingle();
    if (updateError || !updated)
      return json(request, { error: { code: "article_update_conflict" } }, 409);
    await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "knowledge.article.published",
      article.id,
      auditData(article, null),
      auditData(updated, null),
    );
    return json(request, { data: { article: updated } });
  }

  if (action.type === "requestReview") {
    const { data: article, error: articleError } = await admin
      .from("knowledge_articles")
      .select(ARTICLE_SELECT)
      .eq("tenant_id", action.tenantId)
      .eq("id", action.articleId)
      .eq("status", "draft")
      .maybeSingle();
    if (articleError)
      return json(request, { error: { code: "article_read_failed" } }, 500);
    const scope = await loadAgentScope();
    if (!scope) return scopeFailed();
    if (article && !departmentVisible(scope, article.department_id))
      return articleNotFound();
    if (!article)
      return json(
        request,
        { error: { code: "article_not_ready_for_review" } },
        409,
      );
    const now = new Date().toISOString();
    const { error: reviewError } = await admin
      .from("knowledge_article_reviews")
      .upsert(
        {
          tenant_id: action.tenantId,
          article_id: action.articleId,
          revision: article.current_revision,
          requested_by: actorId,
          requested_at: now,
          decided_by: null,
          decided_at: null,
          decision: null,
          note: null,
        },
        { onConflict: "article_id,revision" },
      );
    if (reviewError)
      return json(
        request,
        { error: { code: "article_review_request_failed" } },
        500,
      );
    const { data: updated, error: updateError } = await admin
      .from("knowledge_articles")
      .update({
        status: "review",
        review_requested_at: now,
        review_requested_by: actorId,
        updated_at: now,
      })
      .eq("tenant_id", action.tenantId)
      .eq("id", action.articleId)
      .eq("current_revision", article.current_revision)
      .eq("status", "draft")
      .select(ARTICLE_SELECT)
      .maybeSingle();
    if (updateError || !updated)
      return json(
        request,
        { error: { code: "article_review_request_conflict" } },
        409,
      );
    await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "knowledge.article.review_requested",
      article.id,
      auditData(article, null),
      auditData(updated, null),
    );
    return json(request, { data: { article: updated } });
  }

  if (action.type === "decideReview") {
    const { data: article, error: articleError } = await admin
      .from("knowledge_articles")
      .select(ARTICLE_SELECT)
      .eq("tenant_id", action.tenantId)
      .eq("id", action.articleId)
      .eq("status", "review")
      .maybeSingle();
    if (articleError)
      return json(request, { error: { code: "article_read_failed" } }, 500);
    const scope = await loadAgentScope();
    if (!scope) return scopeFailed();
    if (article && !departmentVisible(scope, article.department_id))
      return articleNotFound();
    if (!article)
      return json(request, { error: { code: "article_not_in_review" } }, 409);
    const now = new Date().toISOString();
    const { data: review, error: reviewError } = await admin
      .from("knowledge_article_reviews")
      .update({
        decision: action.decision,
        note: action.note ?? null,
        decided_by: actorId,
        decided_at: now,
      })
      .eq("tenant_id", action.tenantId)
      .eq("article_id", article.id)
      .eq("revision", article.current_revision)
      .is("decision", null)
      .select("id")
      .maybeSingle();
    if (reviewError || !review)
      return json(
        request,
        { error: { code: "article_review_decision_conflict" } },
        409,
      );
    const approved = action.decision === "approved";
    const { data: updated, error: updateError } = await admin
      .from("knowledge_articles")
      .update({
        status: approved ? "published" : "draft",
        ...(approved
          ? { published_revision: article.current_revision, published_at: now }
          : {}),
        reviewed_at: now,
        reviewed_by: actorId,
        updated_at: now,
      })
      .eq("tenant_id", action.tenantId)
      .eq("id", article.id)
      .eq("current_revision", article.current_revision)
      .eq("status", "review")
      .select(ARTICLE_SELECT)
      .maybeSingle();
    if (updateError || !updated)
      return json(
        request,
        { error: { code: "article_review_decision_conflict" } },
        409,
      );
    await writeAudit(
      admin,
      action.tenantId,
      actorId,
      `knowledge.article.${approved ? "published" : "review_rejected"}`,
      article.id,
      auditData(article, null),
      auditData(updated, null),
    );
    return json(request, { data: { article: updated } });
  }

  if (action.type === "listArticles" || action.type === "getArticle") {
    const canReadInternal = await hasTenantPermission(
      admin,
      actorId,
      action.tenantId,
      KNOWLEDGE_READ_PERMISSION,
    );
    if (canReadInternal === null)
      return json(
        request,
        { error: { code: "authorization_check_failed" } },
        500,
      );

    const organizationIds = canReadInternal
      ? []
      : await customerOrganizationIds(admin, actorId, action.tenantId);
    if (organizationIds === null)
      return json(
        request,
        { error: { code: "authorization_check_failed" } },
        500,
      );

    // Internal readers see their departments; requesters and customers read
    // the published external articles of every department with the module.
    const readScope = canReadInternal
      ? await loadAgentScope()
      : await publishedKnowledgeScope(admin, action.tenantId);
    if (!readScope) return scopeFailed();

    if (action.type === "listArticles") {
      // Department options for the editor: everybody who may create or edit
      // articles (knowledge.manage) gets the departments of the own scope,
      // also without knowledge.read.
      const canEditArticles = canReadInternal
        ? true
        : await hasTenantPermission(
            admin,
            actorId,
            action.tenantId,
            KNOWLEDGE_MANAGE_PERMISSION,
          );
      if (canEditArticles === null)
        return json(
          request,
          { error: { code: "authorization_check_failed" } },
          500,
        );
      const editScope =
        canReadInternal || canEditArticles ? await loadAgentScope() : null;
      if ((canReadInternal || canEditArticles) && !editScope)
        return scopeFailed();
      const departments = editScope
        ? await scopeDepartmentOptions(admin, action.tenantId, editScope)
        : [];
      const ranks = new Map<string, number>();
      let matchingArticleIds: string[] | null = null;
      if (action.query) {
        const { data: matches, error: searchError } = await admin.rpc(
          "search_knowledge_article_ids",
          {
            p_tenant_id: action.tenantId,
            p_query: action.query,
            p_can_read_internal: canReadInternal,
            p_customer_organization_ids: organizationIds,
          },
        );
        if (searchError)
          return json(
            request,
            { error: { code: "article_search_failed" } },
            500,
          );
        for (const match of matches ?? []) {
          if (!isRecord(match) || !isUuid(match.article_id)) continue;
          ranks.set(
            match.article_id,
            typeof match.rank === "number" ? match.rank : 0,
          );
        }
        matchingArticleIds = [...ranks.keys()];
        if (matchingArticleIds.length === 0) {
          return json(request, { data: { articles: [], departments } });
        }
      }

      let query = admin
        .from("knowledge_articles")
        .select(ARTICLE_SELECT)
        .eq("tenant_id", action.tenantId)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .limit(200);
      query = applyDepartmentScope(query, readScope);
      if (!canReadInternal) {
        query = applyExternalArticleScope(query, organizationIds);
      }
      if (matchingArticleIds) query = query.in("id", matchingArticleIds);

      const { data, error } = await query;
      if (error)
        return json(request, { error: { code: "article_list_failed" } }, 500);

      const articles = [...(data ?? [])];
      if (matchingArticleIds) {
        articles.sort(
          (left: any, right: any) =>
            (ranks.get(right.id) ?? 0) - (ranks.get(left.id) ?? 0),
        );
      }
      const revisions = await fetchLatestRevisions(
        admin,
        articles,
        !canReadInternal,
      );
      if (revisions.error)
        return json(
          request,
          { error: { code: "article_revision_list_failed" } },
          500,
        );
      const articleCollections = canReadInternal
        ? await fetchArticleCollectionIds(
            admin,
            action.tenantId,
            articles.map((article: any) => article.id),
          )
        : { data: new Map<string, string[]>(), error: false };
      if (articleCollections.error)
        return json(
          request,
          { error: { code: "collection_assignment_read_failed" } },
          500,
        );
      const outcomes = canReadInternal
        ? await fetchArticleOutcomes(admin, action.tenantId, articles)
        : new Map<string, ArticleOutcomes>();
      return json(request, {
        data: {
          articles: articles.map((article: any) => ({
            ...articleResponse(
              article,
              revisions.data.get(article.id) ?? null,
              canReadInternal,
              articleCollections.data.get(article.id) ?? [],
            ),
            ...(outcomes.has(article.id)
              ? { outcomes: outcomes.get(article.id) }
              : {}),
            revision: revisions.data.has(article.id)
              ? revisionResponse(revisions.data.get(article.id))
              : null,
          })),
          departments,
          imageUrls: await resolveImageUrls(
            admin,
            action.tenantId,
            [...revisions.data.values()].map((revision: any) => revision.body),
          ),
        },
      });
    }

    let query = admin
      .from("knowledge_articles")
      .select(ARTICLE_SELECT)
      .eq("tenant_id", action.tenantId)
      .eq("id", action.articleId)
      .neq("status", "archived");
    if (!canReadInternal) {
      query = applyExternalArticleScope(query, organizationIds);
    }
    const { data: article, error } = await query.maybeSingle();
    if (error)
      return json(request, { error: { code: "article_read_failed" } }, 500);
    if (!article || !departmentVisible(readScope, article.department_id))
      return articleNotFound();

    const articleCollections = canReadInternal
      ? await fetchArticleCollectionIds(admin, action.tenantId, [article.id])
      : { data: new Map<string, string[]>(), error: false };
    if (articleCollections.error)
      return json(
        request,
        { error: { code: "collection_assignment_read_failed" } },
        500,
      );

    const revision =
      !canReadInternal && Number.isInteger(article.published_revision)
        ? await admin
            .from("knowledge_article_revisions")
            .select(REVISION_SELECT)
            .eq("article_id", article.id)
            .eq("revision", article.published_revision)
            .maybeSingle()
            .then(({ data, error }: any) => ({
              data: data ?? null,
              error: Boolean(error),
            }))
        : await fetchCurrentRevision(admin, article);
    if (revision.error)
      return json(
        request,
        { error: { code: "article_revision_read_failed" } },
        500,
      );
    if (!revision.data)
      return json(
        request,
        { error: { code: "article_revision_not_found" } },
        500,
      );
    const outcomes = canReadInternal
      ? await fetchArticleOutcomes(admin, action.tenantId, [article])
      : new Map<string, ArticleOutcomes>();
    return json(request, {
      data: {
        article: {
          ...articleResponse(
            article,
            revision.data,
            canReadInternal,
            articleCollections.data.get(article.id) ?? [],
          ),
          ...(outcomes.has(article.id)
            ? { outcomes: outcomes.get(article.id) }
            : {}),
        },
        revision: revisionResponse(revision.data),
        imageUrls: await resolveImageUrls(admin, action.tenantId, [
          revision.data.body,
        ]),
      },
    });
  }

  if (action.type === "saveArticle") {
    const updatedAt = new Date().toISOString();
    const scope = await loadAgentScope();
    if (!scope) return scopeFailed();
    const departmentFailure = (message: string) =>
      json(
        request,
        { error: { code: "article_department_invalid", message } },
        422,
      );

    if (!action.articleId) {
      const department = resolveRecordDepartment(scope, action.departmentId);
      if ("error" in department) return departmentFailure(department.error);
      const { data: article, error } = await admin
        .from("knowledge_articles")
        .insert({
          tenant_id: action.tenantId,
          department_id: department.departmentId,
          title: action.title,
          slug: createSlug(action.title),
          visibility: action.visibility,
          // Gespeicherte Artikel sind sofort veröffentlicht (kein Freigabe-Schritt).
          status: "published",
          current_revision: 1,
          published_revision: 1,
          published_at: updatedAt,
          created_by: actorId,
          updated_at: updatedAt,
        })
        .select(ARTICLE_SELECT)
        .single();
      if (error || !article)
        return json(request, { error: { code: "article_create_failed" } }, 422);

      const { data: revision, error: revisionError } = await admin
        .from("knowledge_article_revisions")
        .insert({
          article_id: article.id,
          revision: 1,
          title_snapshot: action.title,
          body: action.bodyMarkdown,
          author_id: actorId,
        })
        .select(REVISION_SELECT)
        .single();
      if (revisionError || !revision) {
        await admin
          .from("knowledge_articles")
          .delete()
          .eq("tenant_id", action.tenantId)
          .eq("id", article.id);
        return json(
          request,
          { error: { code: "article_revision_create_failed" } },
          500,
        );
      }

      if (
        !(await writeAudit(
          admin,
          action.tenantId,
          actorId,
          "knowledge.article.created",
          article.id,
          null,
          auditData(article, revision),
        ))
      )
        return json(request, { error: { code: "article_audit_failed" } }, 500);
      return json(
        request,
        {
          data: {
            article,
            revision,
            imageUrls: await resolveImageUrls(admin, action.tenantId, [
              revision.body,
            ]),
          },
        },
        201,
      );
    }

    const { data: existing, error: existingError } = await admin
      .from("knowledge_articles")
      .select(ARTICLE_SELECT)
      .eq("tenant_id", action.tenantId)
      .eq("id", action.articleId)
      .neq("status", "archived")
      .maybeSingle();
    if (existingError)
      return json(request, { error: { code: "article_read_failed" } }, 500);
    if (!existing || !departmentVisible(scope, existing.department_id))
      return articleNotFound();

    // Editing may move the article to another department of the caller.
    let departmentChange: { department_id: string | null } | null = null;
    if (
      action.departmentId !== undefined &&
      action.departmentId !== existing.department_id
    ) {
      const department = resolveRecordDepartment(scope, action.departmentId);
      if ("error" in department) return departmentFailure(department.error);
      departmentChange = { department_id: department.departmentId };
    }

    const previousRevision = await fetchCurrentRevision(admin, existing);
    if (previousRevision.error)
      return json(
        request,
        { error: { code: "article_revision_read_failed" } },
        500,
      );
    if (!previousRevision.data || !Number.isInteger(existing.current_revision))
      return json(
        request,
        { error: { code: "article_revision_not_found" } },
        500,
      );

    const nextRevision = existing.current_revision + 1;
    const { data: revision, error: revisionError } = await admin
      .from("knowledge_article_revisions")
      .insert({
        article_id: existing.id,
        revision: nextRevision,
        title_snapshot: action.title,
        body: action.bodyMarkdown,
        author_id: actorId,
      })
      .select(REVISION_SELECT)
      .single();
    if (revisionError || !revision)
      return json(
        request,
        { error: { code: "article_revision_create_failed" } },
        500,
      );

    const { data: article, error: updateError } = await admin
      .from("knowledge_articles")
      .update({
        title: action.title,
        visibility: action.visibility,
        ...(departmentChange ?? {}),
        current_revision: nextRevision,
        // Speichern veröffentlicht die neue Revision direkt.
        status: "published",
        published_revision: nextRevision,
        published_at: updatedAt,
        review_requested_at: null,
        review_requested_by: null,
        reviewed_at: null,
        reviewed_by: null,
        updated_at: updatedAt,
      })
      .eq("tenant_id", action.tenantId)
      .eq("id", action.articleId)
      .eq("current_revision", existing.current_revision)
      .neq("status", "archived")
      .select(ARTICLE_SELECT)
      .maybeSingle();
    if (updateError)
      return json(request, { error: { code: "article_update_failed" } }, 500);
    if (!article)
      return json(request, { error: { code: "article_update_conflict" } }, 409);
    if (
      !(await writeAudit(
        admin,
        action.tenantId,
        actorId,
        "knowledge.article.updated",
        article.id,
        auditData(existing, previousRevision.data),
        auditData(article, revision),
      ))
    )
      return json(request, { error: { code: "article_audit_failed" } }, 500);
    return json(request, {
      data: {
        article,
        revision,
        imageUrls: await resolveImageUrls(admin, action.tenantId, [
          revision.body,
        ]),
      },
    });
  }

  if (action.type === "deleteArticle") {
    // Hard delete: revisions, reviews, collection and ticket links cascade.
    const scope = await loadAgentScope();
    if (!scope) return scopeFailed();
    const { data: existing, error: existingError } = await admin
      .from("knowledge_articles")
      .select(ARTICLE_SELECT)
      .eq("tenant_id", action.tenantId)
      .eq("id", action.articleId)
      .maybeSingle();
    if (existingError)
      return json(request, { error: { code: "article_read_failed" } }, 500);
    if (!existing || !departmentVisible(scope, existing.department_id))
      return articleNotFound();
    const { data: revisions, error: revisionsError } = await admin
      .from("knowledge_article_revisions")
      .select("body")
      .eq("article_id", existing.id);
    if (revisionsError)
      return json(
        request,
        { error: { code: "article_revision_read_failed" } },
        500,
      );
    const imageIds = referencedImageIds(
      (revisions ?? []).map((revision: any) => revision.body),
    );
    const { data: deleted, error: deleteError } = await admin
      .from("knowledge_articles")
      .delete()
      .eq("tenant_id", action.tenantId)
      .eq("id", existing.id)
      .select("id")
      .maybeSingle();
    if (deleteError)
      return json(request, { error: { code: "article_delete_failed" } }, 500);
    if (!deleted) return articleNotFound();
    // Images that no other article uses are removed as well.
    await removeUnreferencedImages(admin, action.tenantId, imageIds);
    if (
      !(await writeAudit(
        admin,
        action.tenantId,
        actorId,
        "knowledge.article.deleted",
        existing.id,
        auditData(existing, null),
        null,
      ))
    )
      return json(request, { error: { code: "article_audit_failed" } }, 500);
    return json(request, { data: { articleId: existing.id, deleted: true } });
  }

  const archiveScope = await loadAgentScope();
  if (!archiveScope) return scopeFailed();
  const { data: existing, error: existingError } = await admin
    .from("knowledge_articles")
    .select(ARTICLE_SELECT)
    .eq("tenant_id", action.tenantId)
    .eq("id", action.articleId)
    .neq("status", "archived")
    .maybeSingle();
  if (existingError)
    return json(request, { error: { code: "article_read_failed" } }, 500);
  if (!existing || !departmentVisible(archiveScope, existing.department_id))
    return articleNotFound();

  const existingRevision = await fetchCurrentRevision(admin, existing);
  if (existingRevision.error)
    return json(
      request,
      { error: { code: "article_revision_read_failed" } },
      500,
    );

  const archivedAt = new Date().toISOString();
  const { data: article, error: archiveError } = await admin
    .from("knowledge_articles")
    .update({ status: "archived", updated_at: archivedAt })
    .eq("tenant_id", action.tenantId)
    .eq("id", action.articleId)
    .neq("status", "archived")
    .select(ARTICLE_SELECT)
    .maybeSingle();
  if (archiveError)
    return json(request, { error: { code: "article_archive_failed" } }, 500);
  if (!article)
    return json(request, { error: { code: "article_not_found" } }, 404);
  if (
    !(await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "knowledge.article.archived",
      article.id,
      auditData(existing, existingRevision.data),
      auditData(article, existingRevision.data),
    ))
  )
    return json(request, { error: { code: "article_audit_failed" } }, 500);
  return json(request, { data: { article } });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      if (request.headers.get("origin") !== ALLOWED_ORIGIN)
        return new Response(null, { status: 403, headers: { Vary: "Origin" } });
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    return handler(request);
  },
};
