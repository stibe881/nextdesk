import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const KNOWLEDGE_MANAGE_PERMISSION = "knowledge.manage";
const KNOWLEDGE_READ_PERMISSION = "knowledge.read";
const KNOWLEDGE_PUBLISH_PERMISSION = "knowledge.publish";
const MAX_TITLE_LENGTH = 240;
const MAX_BODY_LENGTH = 100_000;
const MAX_QUERY_LENGTH = 120;
const ARTICLE_SELECT =
  "id, title, slug, visibility, status, current_revision, published_revision, review_requested_at, published_at, created_at, updated_at";
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
    }
  | { type: "archiveArticle"; tenantId: string; articleId: string };

type AuthorizationResult =
  { ok: true } | { ok: false; status: 403 | 500; code: string };

type ArticleAuditData = {
  title: string;
  visibility: Visibility;
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

  if (value.type === "requestReview" && isUuid(value.articleId))
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

  if (value.type === "archiveArticle" && isUuid(value.articleId))
    return {
      type: value.type,
      tenantId: value.tenantId,
      articleId: value.articleId,
    };

  if (value.type === "saveArticle") {
    const article = optionalUuid(value.articleId);
    const title = requiredText(value.title, 3, MAX_TITLE_LENGTH);
    if (
      !article.valid ||
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

async function customerOrganizationIds(
  admin: any,
  userId: string,
  tenantId: string,
): Promise<string[] | null> {
  const { data, error } = await admin
    .from("customer_memberships")
    .select("customer_organization_id, customer_organizations!inner(id)")
    .eq("user_id", userId)
    .eq("access", "company")
    .eq("customer_organizations.tenant_id", tenantId)
    .eq("customer_organizations.active", true);
  if (error) return null;
  return (data ?? [])
    .map((membership: any) => membership.customer_organization_id)
    .filter(
      (id: unknown): id is string => typeof id === "string" && isUuid(id),
    );
}

function applyExternalArticleScope(query: any, organizationIds: string[]): any {
  const scope = ["customer_organization_id.is.null"];
  if (organizationIds.length) {
    scope.push(`customer_organization_id.in.(${organizationIds.join(",")})`);
  }
  return query
    .eq("visibility", "external")
    .neq("status", "archived")
    .not("published_revision", "is", null)
    .or(scope.join(","));
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

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  const originDenied = denyDisallowedOrigin(request);
  if (originDenied) return originDenied;
  if (request.method !== "POST")
    return json(request, { error: { code: "method_not_allowed" } }, 405);

  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string")
    return json(request, { error: { code: "invalid_request" } }, 400);

  const admin = context.supabaseAdmin;
  const mutation =
    action.type === "saveArticle" ||
    action.type === "archiveArticle" ||
    action.type === "createCollection" ||
    action.type === "setArticleCollections" ||
    action.type === "requestReview" ||
    action.type === "decideReview";
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

  const featureStates = await resolveTenantFeatureStates(
    admin,
    action.tenantId,
    ["knowledge.base"],
  );
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

  if (action.type === "listCollections") {
    const canReadInternal = await hasTenantPermission(
      admin,
      actorId,
      action.tenantId,
      KNOWLEDGE_READ_PERMISSION,
    );
    if (canReadInternal !== true)
      return json(request, { error: { code: "article_read_denied" } }, 403);
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
    let existingQuery = admin
      .from("knowledge_collections")
      .select("id")
      .eq("tenant_id", action.tenantId)
      .eq("name", action.name);
    existingQuery = action.parentId
      ? existingQuery.eq("parent_id", action.parentId)
      : existingQuery.is("parent_id", null);
    const { data: existing, error: existingError } =
      await existingQuery.maybeSingle();
    if (existingError)
      return json(request, { error: { code: "collection_read_failed" } }, 500);
    if (existing)
      return json(
        request,
        { error: { code: "collection_name_conflict" } },
        409,
      );

    if (action.parentId) {
      const { data: parent, error: parentError } = await admin
        .from("knowledge_collections")
        .select("id")
        .eq("tenant_id", action.tenantId)
        .eq("id", action.parentId)
        .eq("active", true)
        .is("parent_id", null)
        .maybeSingle();
      if (parentError)
        return json(
          request,
          { error: { code: "collection_parent_read_failed" } },
          500,
        );
      if (!parent)
        return json(
          request,
          { error: { code: "collection_parent_not_found" } },
          422,
        );
    }

    const slug = createSlug(
      action.parentId
        ? `${action.parentId.slice(0, 8)}-${action.name}`
        : action.name,
    );
    const { data, error } = await admin
      .from("knowledge_collections")
      .insert({
        tenant_id: action.tenantId,
        name: action.name,
        slug,
        parent_id: action.parentId ?? null,
        created_by: actorId,
      })
      .select("id, name, slug, parent_id, active")
      .single();
    if (error || !data)
      return json(
        request,
        { error: { code: "collection_create_failed" } },
        422,
      );
    await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "knowledge.collection.created",
      data.id,
      null,
      {
        title: data.name,
        visibility: "internal",
        status: "active",
        currentRevision: null,
        bodyLength: 0,
      },
    );
    return json(request, { data: { collection: data } }, 201);
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
    const { data: article, error: articleError } = await admin
      .from("knowledge_articles")
      .select("id")
      .eq("tenant_id", action.tenantId)
      .eq("id", action.articleId)
      .maybeSingle();
    if (articleError)
      return json(request, { error: { code: "article_read_failed" } }, 500);
    if (!article)
      return json(request, { error: { code: "article_not_found" } }, 404);
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
    const { data: article, error: articleError } = await admin
      .from("knowledge_articles")
      .select(ARTICLE_SELECT)
      .eq("tenant_id", action.tenantId)
      .eq("id", action.articleId)
      .neq("status", "archived")
      .maybeSingle();
    if (articleError)
      return json(request, { error: { code: "article_read_failed" } }, 500);
    if (!article)
      return json(request, { error: { code: "article_not_found" } }, 404);

    if (action.collectionIds.length) {
      const { data: collections, error: collectionError } = await admin
        .from("knowledge_collections")
        .select("id")
        .eq("tenant_id", action.tenantId)
        .eq("active", true)
        .in("id", action.collectionIds);
      if (collectionError)
        return json(
          request,
          { error: { code: "collection_read_failed" } },
          500,
        );
      if ((collections ?? []).length !== action.collectionIds.length)
        return json(request, { error: { code: "collection_not_found" } }, 422);
    }

    const { error: deleteError } = await admin
      .from("knowledge_article_collections")
      .delete()
      .eq("tenant_id", action.tenantId)
      .eq("article_id", action.articleId);
    if (deleteError)
      return json(
        request,
        { error: { code: "collection_assignment_failed" } },
        500,
      );
    if (action.collectionIds.length) {
      const { error: insertError } = await admin
        .from("knowledge_article_collections")
        .insert(
          action.collectionIds.map((collectionId) => ({
            tenant_id: action.tenantId,
            article_id: action.articleId,
            collection_id: collectionId,
            created_by: actorId,
          })),
        );
      if (insertError)
        return json(
          request,
          { error: { code: "collection_assignment_failed" } },
          500,
        );
    }
    await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "knowledge.article.collections_updated",
      action.articleId,
      auditData(article, null),
      auditData(article, null),
    );
    return json(request, {
      data: {
        articleId: action.articleId,
        collectionIds: action.collectionIds,
      },
    });
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

    if (action.type === "listArticles") {
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
          return json(request, { data: { articles: [] } });
        }
      }

      let query = admin
        .from("knowledge_articles")
        .select(ARTICLE_SELECT)
        .eq("tenant_id", action.tenantId)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .limit(200);
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
      return json(request, {
        data: {
          articles: articles.map((article: any) => ({
            ...articleResponse(
              article,
              revisions.data.get(article.id) ?? null,
              canReadInternal,
              articleCollections.data.get(article.id) ?? [],
            ),
            revision: revisions.data.has(article.id)
              ? revisionResponse(revisions.data.get(article.id))
              : null,
          })),
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
    if (!article)
      return json(request, { error: { code: "article_not_found" } }, 404);

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
    return json(request, {
      data: {
        article: articleResponse(
          article,
          revision.data,
          canReadInternal,
          articleCollections.data.get(article.id) ?? [],
        ),
        revision: revisionResponse(revision.data),
      },
    });
  }

  if (action.type === "saveArticle") {
    const updatedAt = new Date().toISOString();

    if (!action.articleId) {
      const { data: article, error } = await admin
        .from("knowledge_articles")
        .insert({
          tenant_id: action.tenantId,
          title: action.title,
          slug: createSlug(action.title),
          visibility: action.visibility,
          status: "draft",
          current_revision: 1,
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
      return json(request, { data: { article, revision } }, 201);
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
    if (!existing)
      return json(request, { error: { code: "article_not_found" } }, 404);

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
        current_revision: nextRevision,
        // A previous published revision remains readable to customers. The new
        // text always returns to a draft and requires a fresh review.
        status: "draft",
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
    return json(request, { data: { article, revision } });
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
  if (!existing)
    return json(request, { error: { code: "article_not_found" } }, 404);

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
