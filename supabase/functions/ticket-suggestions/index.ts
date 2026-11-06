import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import { resolveUserFeatureStates } from "../_shared/tenant-features.ts";
import {
  applyDepartmentScope,
  type DepartmentScope,
  loadDepartmentScope,
} from "../_shared/department-scope.ts";
import {
  applyExternalArticleScope,
  customerOrganizationIds,
  KNOWLEDGE_FEATURE,
  publishedKnowledgeScope,
} from "../_shared/knowledge-visibility.ts";
import {
  type Action,
  knowledgeSearchQuery,
  majorityVote,
  OUTCOME_DEDUP_MINUTES,
  OUTCOME_HOURLY_LIMIT,
  plainExcerpt,
  type RecordOutcomeAction,
  similarityText,
  subjectLongEnough,
  type SuggestAction,
  parseAction,
} from "./logic.ts";

/**
 * Suggestions while a ticket is being created:
 *   - matching knowledge articles (same visibility rules as knowledge-base),
 *   - for requesters: their own open tickets on the same topic (duplicates),
 *   - for agents: category / department / priority most similar tickets
 *     share, and similar solved tickets.
 * Similar tickets come from similar_tickets() through the caller's own client
 * (auth.uid() and can_read_ticket apply); knowledge lookups and the outcome
 * log (knowledge_article_outcomes has no client policies) use the service
 * role after explicit membership, feature and visibility checks.
 */

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_ARTICLES = 3;
const MAX_DUPLICATES = 3;
const MAX_SOLVED = 3;
const CLASSIFICATION_SAMPLE = 10;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const lookupFailed = () =>
  new HttpError(
    503,
    "suggestions_unavailable",
    "Die Vorschläge sind gerade nicht verfügbar.",
  );

async function readBody(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)
  ) {
    throw new HttpError(413, "payload_too_large", "Die Anfrage ist zu gross.");
  }
  const text = await request.text().catch(() => null);
  if (
    text === null ||
    new TextEncoder().encode(text).length > MAX_REQUEST_BYTES
  ) {
    throw new HttpError(413, "payload_too_large", "Die Anfrage ist zu gross.");
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type KnowledgeReader = {
  canReadInternal: boolean;
  organizationIds: string[];
  scope: DepartmentScope;
};

/**
 * The caller's knowledge visibility, or null while the module is off for the
 * person (then no article is suggested or recorded).
 */
async function knowledgeReader(
  admin: Client,
  userClient: Client,
  tenantId: string,
  userId: string,
): Promise<KnowledgeReader | null> {
  const [features, permission] = await Promise.all([
    resolveUserFeatureStates(admin, tenantId, userId, [KNOWLEDGE_FEATURE]),
    userClient.rpc("has_tenant_permission", {
      p_tenant_id: tenantId,
      p_permission_code: "knowledge.read",
    }),
  ]);
  if (features === null) throw lookupFailed();
  if (features[KNOWLEDGE_FEATURE] !== true) return null;
  if (permission.error || typeof permission.data !== "boolean") {
    throw lookupFailed();
  }
  const canReadInternal = permission.data;
  const [organizationIds, scope] = await Promise.all([
    canReadInternal
      ? Promise.resolve([] as string[])
      : customerOrganizationIds(admin, userId, tenantId),
    canReadInternal
      ? loadDepartmentScope(admin, tenantId, userId, KNOWLEDGE_FEATURE)
      : publishedKnowledgeScope(admin, tenantId),
  ]);
  if (organizationIds === null || scope === null) throw lookupFailed();
  return { canReadInternal, organizationIds, scope };
}

/** Readable articles among `ids` (not archived, in scope, external rules). */
async function readableArticles(
  admin: Client,
  tenantId: string,
  reader: KnowledgeReader,
  ids: string[],
): Promise<Row[]> {
  if (!ids.length) return [];
  let query = admin
    .from("knowledge_articles")
    .select(
      "id, title, visibility, status, department_id, current_revision, published_revision",
    )
    .eq("tenant_id", tenantId)
    // Only published articles are suggested (no drafts or reviews).
    .eq("status", "published")
    .in("id", ids);
  query = applyDepartmentScope(query, reader.scope);
  if (!reader.canReadInternal) {
    query = applyExternalArticleScope(query, reader.organizationIds);
  }
  const { data, error } = await query;
  if (error) throw lookupFailed();
  return (data ?? []) as Row[];
}

async function suggestArticles(
  admin: Client,
  userClient: Client,
  userId: string,
  action: SuggestAction,
) {
  const search = knowledgeSearchQuery(action.subject, action.description);
  if (!search) return [];
  const reader = await knowledgeReader(
    admin,
    userClient,
    action.tenantId,
    userId,
  );
  if (!reader) return [];
  const { data: matches, error } = await admin.rpc(
    "search_knowledge_article_ids",
    {
      p_tenant_id: action.tenantId,
      p_query: search,
      p_can_read_internal: reader.canReadInternal,
      p_customer_organization_ids: reader.organizationIds,
    },
  );
  if (error) throw lookupFailed();
  const ranks = new Map<string, number>();
  for (const match of matches ?? []) {
    if (!isRecord(match) || !isUuid(match.article_id)) continue;
    ranks.set(
      match.article_id,
      typeof match.rank === "number" ? match.rank : 0,
    );
  }
  // The search is ranked; a few more candidates than shown leave room for
  // articles that are outside the caller's department scope.
  const candidates = [...ranks.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 25)
    .map(([id]) => id);
  const articles = (
    await readableArticles(admin, action.tenantId, reader, candidates)
  )
    .sort(
      (left, right) =>
        (ranks.get(String(right.id)) ?? 0) - (ranks.get(String(left.id)) ?? 0),
    )
    .slice(0, MAX_ARTICLES);

  // Internal readers see the current text, everyone else the published one.
  const revisions = await Promise.all(
    articles.map((article) => {
      const revision = reader.canReadInternal
        ? article.current_revision
        : article.published_revision;
      return Number.isInteger(revision)
        ? admin
            .from("knowledge_article_revisions")
            .select("title_snapshot, body, summary")
            .eq("article_id", article.id)
            .eq("revision", revision)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null });
    }),
  );
  return articles.flatMap((article, index) => {
    const { data: revision, error: revisionError } = revisions[index] as {
      data: Row | null;
      error: unknown;
    };
    if (revisionError || !revision) return [];
    const title =
      !reader.canReadInternal && typeof revision.title_snapshot === "string"
        ? revision.title_snapshot
        : String(article.title ?? "");
    const excerpt =
      plainExcerpt(revision.body) || plainExcerpt(revision.summary);
    return [
      {
        id: String(article.id),
        title,
        excerpt,
        visibility: article.visibility === "external" ? "external" : "internal",
      },
    ];
  });
}

type SimilarTicket = {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  statusLabel: string;
  isClosed: boolean;
  categoryId: string | null;
  departmentId: string | null;
  priorityId: string | null;
};

async function similarTickets(
  userClient: Client,
  tenantId: string,
  text: string,
  options: { onlyClosed: boolean; onlyOwn: boolean; limit: number },
): Promise<SimilarTicket[]> {
  const { data, error } = await userClient.rpc("similar_tickets", {
    p_tenant_id: tenantId,
    p_text: text,
    p_exclude_ticket_id: null,
    p_only_closed: options.onlyClosed,
    p_only_own: options.onlyOwn,
    p_limit: options.limit,
  });
  if (error) throw lookupFailed();
  const optionalId = (value: unknown) => (isUuid(value) ? value : null);
  return ((data ?? []) as Row[]).flatMap((row) =>
    isUuid(row.ticket_id) && typeof row.subject === "string"
      ? [
          {
            ticketId: row.ticket_id,
            ticketNumber: String(row.ticket_number ?? ""),
            subject: row.subject,
            statusLabel: String(row.status_label ?? ""),
            isClosed: row.is_closed === true,
            categoryId: optionalId(row.category_id),
            departmentId: optionalId(row.department_id),
            priorityId: optionalId(row.priority_id),
          },
        ]
      : [],
  );
}

function ticketLink(ticket: SimilarTicket) {
  return {
    id: ticket.ticketId,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    statusLabel: ticket.statusLabel,
  };
}

/** Category, department and priority shared by most similar tickets. */
async function classification(
  admin: Client,
  tenantId: string,
  sample: SimilarTicket[],
) {
  const category = majorityVote(sample.map((ticket) => ticket.categoryId));
  const department = majorityVote(sample.map((ticket) => ticket.departmentId));
  const priority = majorityVote(sample.map((ticket) => ticket.priorityId));
  const none = Promise.resolve({ data: null, error: null });
  const [categoryRow, departmentRow, priorityRow] = await Promise.all([
    category
      ? admin
          .from("ticket_categories")
          .select("id, name, department_id, parent_id")
          .eq("tenant_id", tenantId)
          .eq("id", category.id)
          .eq("active", true)
          .maybeSingle()
      : none,
    department
      ? admin
          .from("departments")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .eq("id", department.id)
          .eq("active", true)
          .maybeSingle()
      : none,
    priority
      ? admin
          .from("ticket_priorities")
          .select("id, key, label")
          .eq("tenant_id", tenantId)
          .eq("id", priority.id)
          .maybeSingle()
      : none,
  ]);
  if (categoryRow.error || departmentRow.error || priorityRow.error) {
    throw lookupFailed();
  }
  const c = categoryRow.data as Row | null;
  const d = departmentRow.data as Row | null;
  const p = priorityRow.data as Row | null;
  return {
    sampleSize: sample.length,
    category:
      category && c && c.parent_id === null
        ? {
            id: category.id,
            name: String(c.name),
            departmentId: String(c.department_id),
            matches: category.matches,
          }
        : null,
    department:
      department && d
        ? {
            id: department.id,
            name: String(d.name),
            matches: department.matches,
          }
        : null,
    priority:
      priority && p
        ? {
            id: priority.id,
            key: String(p.key),
            name: String(p.label),
            matches: priority.matches,
          }
        : null,
  };
}

async function suggest(
  admin: Client,
  userClient: Client,
  userId: string,
  action: SuggestAction,
) {
  if (!subjectLongEnough(action.subject)) {
    return {
      mode: action.mode,
      articles: [],
      duplicates: [],
      classification: null,
      solvedTickets: [],
    };
  }
  // Agent suggestions need ticket work rights; everybody else gets the
  // requester view, whatever the client asked for.
  let mode = action.mode;
  if (mode === "agent") {
    const { data, error } = await userClient.rpc("can_work_tickets_in_tenant", {
      p_tenant_id: action.tenantId,
    });
    if (error) throw lookupFailed();
    if (data !== true) mode = "requester";
  }
  const text = similarityText(action.subject, action.description);
  const articlesPromise = suggestArticles(admin, userClient, userId, action);
  if (mode === "requester") {
    const [articles, own] = await Promise.all([
      articlesPromise,
      similarTickets(userClient, action.tenantId, text, {
        onlyClosed: false,
        onlyOwn: true,
        limit: 10,
      }),
    ]);
    return {
      mode,
      articles,
      duplicates: own
        .filter((ticket) => !ticket.isClosed)
        .slice(0, MAX_DUPLICATES)
        .map(ticketLink),
      classification: null,
      solvedTickets: [],
    };
  }
  const [articles, sample, solved] = await Promise.all([
    articlesPromise,
    similarTickets(userClient, action.tenantId, text, {
      onlyClosed: false,
      onlyOwn: false,
      limit: CLASSIFICATION_SAMPLE,
    }),
    similarTickets(userClient, action.tenantId, text, {
      onlyClosed: true,
      onlyOwn: false,
      limit: MAX_SOLVED,
    }),
  ]);
  return {
    mode,
    articles,
    duplicates: [],
    classification:
      sample.length >= 2
        ? await classification(admin, action.tenantId, sample)
        : null,
    solvedTickets: solved.map(ticketLink),
  };
}

async function recordOutcome(
  admin: Client,
  userClient: Client,
  userId: string,
  action: RecordOutcomeAction,
) {
  const reader = await knowledgeReader(
    admin,
    userClient,
    action.tenantId,
    userId,
  );
  const visible = reader
    ? await readableArticles(admin, action.tenantId, reader, [action.articleId])
    : [];
  if (!visible.length) {
    throw new HttpError(
      404,
      "article_not_found",
      "Der Artikel wurde nicht gefunden.",
    );
  }
  // Rate limit: one entry per person and article within a few minutes, and a
  // cap per hour. Ignored entries still answer with success.
  const now = Date.now();
  const [recent, hourly] = await Promise.all([
    admin
      .from("knowledge_article_outcomes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", action.tenantId)
      .eq("actor_id", userId)
      .eq("article_id", action.articleId)
      .gte(
        "created_at",
        new Date(now - OUTCOME_DEDUP_MINUTES * 60_000).toISOString(),
      ),
    admin
      .from("knowledge_article_outcomes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", action.tenantId)
      .eq("actor_id", userId)
      .gte("created_at", new Date(now - 60 * 60_000).toISOString()),
  ]);
  if (recent.error || hourly.error) throw lookupFailed();
  if ((recent.count ?? 0) > 0 || (hourly.count ?? 0) >= OUTCOME_HOURLY_LIMIT) {
    return { recorded: false };
  }
  const { error } = await admin.from("knowledge_article_outcomes").insert({
    tenant_id: action.tenantId,
    article_id: action.articleId,
    kind: action.kind,
    actor_id: userId,
    query_text: action.queryText,
  });
  if (error) {
    throw new HttpError(
      500,
      "outcome_not_saved",
      "Die Rückmeldung konnte nicht gespeichert werden.",
    );
  }
  return { recorded: true };
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") {
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      }
      const action: Action | null = parseAction(await readBody(request));
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) {
        return json(request, { error: { code: "unauthorized" } }, 401);
      }
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
      const admin = context.supabaseAdmin;
      const { data: membership, error: membershipError } = await admin
        .from("tenant_memberships")
        .select("tenant_id")
        .eq("tenant_id", action.tenantId)
        .eq("user_id", actorId)
        .eq("status", "active")
        .maybeSingle();
      if (membershipError) throw lookupFailed();
      if (!membership) {
        return json(
          request,
          {
            error: {
              code: "tenant_membership_required",
              message: "Sie sind in diesem Mandanten nicht aktiv.",
            },
          },
          403,
        );
      }
      const data =
        action.type === "suggest"
          ? await suggest(admin, context.supabase, actorId, action)
          : await recordOutcome(admin, context.supabase, actorId, action);
      return json(request, { data });
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error(
        "ticket_suggestions_failed",
        error instanceof Error ? error.name : "",
      );
      return json(
        request,
        {
          error: {
            code: "ticket_suggestions_failed",
            message: "Die Vorschläge sind gerade nicht verfügbar.",
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
