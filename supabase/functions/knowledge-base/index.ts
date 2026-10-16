import { withSupabase } from "@supabase/server";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const KNOWLEDGE_MANAGE_PERMISSION = "knowledge.manage";
const KNOWLEDGE_READ_PERMISSION = "knowledge.read";
const MAX_TITLE_LENGTH = 240;
const MAX_BODY_LENGTH = 100_000;
const MAX_QUERY_LENGTH = 120;
const ARTICLE_SELECT =
  "id, tenant_id, title, slug, visibility, customer_organization_id, status, current_revision, created_by, published_at, created_at, updated_at";
const REVISION_SELECT =
  "id, article_id, revision, body, summary, author_id, created_at";

type Visibility = "internal" | "external";
type Action =
  | { type: "listCollections"; tenantId: string }
  | { type: "listArticles"; tenantId: string; query?: string }
  | { type: "getArticle"; tenantId: string; articleId: string }
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

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
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
      !newestByArticle.has(revision.article_id)
    ) {
      newestByArticle.set(revision.article_id, revision);
    }
  }
  return { data: newestByArticle, error: false };
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
    action.type === "saveArticle" || action.type === "archiveArticle";
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

  // Collections are not part of the knowledge_articles schema.
  if (action.type === "listCollections") {
    return json(request, { error: { code: "feature_not_available" } }, 501);
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

    if (action.type === "listArticles") {
      let query = admin
        .from("knowledge_articles")
        .select(ARTICLE_SELECT)
        .eq("tenant_id", action.tenantId)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (!canReadInternal) query = query.eq("visibility", "external");
      if (action.query)
        query = query.ilike("title", `%${escapeIlikePattern(action.query)}%`);

      const { data, error } = await query;
      if (error)
        return json(request, { error: { code: "article_list_failed" } }, 500);

      const articles = data ?? [];
      const revisions = await fetchLatestRevisions(admin, articles);
      if (revisions.error)
        return json(
          request,
          { error: { code: "article_revision_list_failed" } },
          500,
        );
      return json(request, {
        data: {
          articles: articles.map((article: any) => ({
            ...article,
            revision: revisions.data.get(article.id) ?? null,
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
    if (!canReadInternal) query = query.eq("visibility", "external");
    const { data: article, error } = await query.maybeSingle();
    if (error)
      return json(request, { error: { code: "article_read_failed" } }, 500);
    if (!article)
      return json(request, { error: { code: "article_not_found" } }, 404);

    const revision = await fetchCurrentRevision(admin, article);
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
    return json(request, { data: { article, revision: revision.data } });
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
