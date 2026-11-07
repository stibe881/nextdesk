import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import {
  AI_PROVIDER_KEY,
  type AiDraftObject,
  MAX_COST_CENTS,
  MAX_OUTPUT_TOKENS,
  queueMinimalAiDraftRequest,
  resolveAiGovernance,
  validateAiBudget,
  validateAiPurpose,
} from "../_shared/ai-governance.ts";
import {
  AnthropicKnowledgeDraftError,
  generateKnowledgeDraft,
} from "../_shared/anthropic-knowledge-draft.ts";
import {
  departmentVisible,
  type DepartmentScope,
  loadDepartmentScope,
  resolveRecordDepartment,
} from "../_shared/department-scope.ts";
import { resolveUserFeatureStates } from "../_shared/tenant-features.ts";
import {
  buildClusterSource,
  CLUSTER_ARTICLE_INSTRUCTIONS,
  clusterSolvedTickets,
  MAX_SOURCE_TICKETS,
  type SolvedTicket,
  solutionTexts,
  type SuggestionCluster,
} from "./clustering.ts";

/**
 * Knowledge article suggestions ("Artikelvorschläge"): clusters of similar
 * solved tickets of the last 120 days for which no published article exists
 * yet, and an AI draft built from the whole cluster.
 *
 *  - list: open and drafted suggestions with sample tickets; recomputes the
 *    clusters first when the last computation is older than 24 hours,
 *  - refresh: recomputes the clusters now,
 *  - draft: writes an internal draft article with the AI (same governance,
 *    budget and redaction as ai-assist) and links it to the tickets,
 *  - dismiss: hides a suggestion for good (the fingerprint stays blocked).
 *
 * Requires knowledge.manage and the knowledge module like creating articles
 * in the knowledge base. Clustering reads with the service role; sample
 * tickets and the AI source are read with the caller's client, so only
 * tickets the person may see appear or leave nextDesk.
 */

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 8 * 1024;
const WINDOW_DAYS = 120;
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SAMPLE_TICKETS = 5;
const MAX_LINKED_TICKETS = 30;
const KNOWLEDGE_MANAGE_PERMISSION = "knowledge.manage";
const KNOWLEDGE_FEATURE = "knowledge.base";

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Action =
  | { type: "list"; tenantId: string }
  | { type: "refresh"; tenantId: string }
  | { type: "draft"; tenantId: string; suggestionId: string }
  | { type: "dismiss"; tenantId: string; suggestionId: string };

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  const keys = Object.keys(value);
  switch (value.type) {
    case "list":
    case "refresh":
      return keys.every((key) => key === "type" || key === "tenantId")
        ? { type: value.type, tenantId }
        : null;
    case "draft":
    case "dismiss":
      return isUuid(value.suggestionId) &&
          keys.every((key) =>
            key === "type" || key === "tenantId" || key === "suggestionId"
          )
        ? {
          type: value.type,
          tenantId,
          suggestionId: value.suggestionId.toLowerCase(),
        }
        : null;
    default:
      return null;
  }
}

/** True when the clusters have to be recomputed before listing them. */
export function refreshDue(
  refreshedAt: string | null,
  now: number = Date.now(),
): boolean {
  if (!refreshedAt) return true;
  const time = Date.parse(refreshedAt);
  return Number.isNaN(time) || now - time >= REFRESH_INTERVAL_MS;
}

async function readBody(request: Request): Promise<unknown> {
  const body = await request.text().catch(() => null);
  if (body === null || new TextEncoder().encode(body).length > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "payload_too_large", "Die Anfrage ist zu gross.");
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function requireKnowledgeManager(
  client: Client,
  admin: Client,
  tenantId: string,
  actorId: string,
): Promise<void> {
  const [permission, features] = await Promise.all([
    client.rpc("has_tenant_permission", {
      p_tenant_id: tenantId,
      p_permission_code: KNOWLEDGE_MANAGE_PERMISSION,
    }),
    resolveUserFeatureStates(admin, tenantId, actorId, [KNOWLEDGE_FEATURE]),
  ]);
  if (permission.error) {
    throw new HttpError(503, "authorization_check_failed", "Die Berechtigung konnte nicht geprüft werden.");
  }
  if (permission.data !== true) {
    throw new HttpError(403, "article_manage_denied", "Für Artikelvorschläge fehlt Ihnen die Berechtigung zur Wissensverwaltung.");
  }
  if (features === null) {
    throw new HttpError(503, "tenant_feature_lookup_failed", "Die Module konnten nicht geprüft werden.");
  }
  if (features[KNOWLEDGE_FEATURE] !== true) {
    throw new HttpError(403, "knowledge_feature_disabled", "Die Wissensdatenbank ist nicht aktiviert.");
  }
}

async function requireScope(
  admin: Client,
  tenantId: string,
  actorId: string,
): Promise<DepartmentScope> {
  const scope = await loadDepartmentScope(admin, tenantId, actorId, KNOWLEDGE_FEATURE);
  if (!scope) {
    throw new HttpError(503, "department_scope_lookup_failed", "Die Abteilungen konnten nicht geladen werden.");
  }
  return scope;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Recomputes the clusters of a tenant and stores them as suggestions. */
async function refreshTenant(admin: Client, tenantId: string, actorId: string) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const [source, existing] = await Promise.all([
    admin.rpc("knowledge_suggestion_source_tickets", {
      p_tenant_id: tenantId,
      p_since: since,
      p_limit: 2000,
    }),
    admin
      .from("knowledge_suggestions")
      .select("id, fingerprint, status, ticket_ids")
      .eq("tenant_id", tenantId)
      .limit(5000),
  ]);
  if (source.error || existing.error) {
    throw new HttpError(500, "suggestions_refresh_failed", "Die Artikelvorschläge konnten nicht berechnet werden.");
  }
  const tickets: SolvedTicket[] = ((source.data ?? []) as Row[]).map((row) => ({
    id: String(row.ticket_id),
    subject: typeof row.subject === "string" ? row.subject : "",
    categoryName: typeof row.category_name === "string" ? row.category_name : null,
    departmentId: typeof row.department_id === "string" ? row.department_id : null,
    solvedAt: String(row.solved_at ?? ""),
  }));
  const rows = (existing.data ?? []) as Row[];
  const blocked = new Set<string>();
  const excluded = new Set<string>();
  const openByFingerprint = new Map<string, string>();
  for (const row of rows) {
    if (row.status === "open") {
      openByFingerprint.set(String(row.fingerprint), String(row.id));
    } else {
      blocked.add(String(row.fingerprint));
      stringArray(row.ticket_ids).forEach((id) => excluded.add(id));
    }
  }
  const clusters: SuggestionCluster[] = clusterSolvedTickets(tickets, {
    blockedFingerprints: blocked,
    excludedTicketIds: excluded,
  });

  const now = new Date().toISOString();
  const keep = new Set<string>();
  const inserts: Row[] = [];
  for (const cluster of clusters) {
    const values = {
      department_id: cluster.departmentId,
      title_hint: cluster.titleHint,
      ticket_ids: cluster.ticketIds,
      ticket_count: cluster.ticketIds.length,
      updated_at: now,
    };
    const id = openByFingerprint.get(cluster.fingerprint);
    if (id) {
      keep.add(id);
      const { error } = await admin
        .from("knowledge_suggestions")
        .update(values)
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .eq("status", "open");
      if (error) {
        throw new HttpError(500, "suggestions_refresh_failed", "Die Artikelvorschläge konnten nicht gespeichert werden.");
      }
    } else {
      inserts.push({ tenant_id: tenantId, fingerprint: cluster.fingerprint, status: "open", ...values });
    }
  }
  if (inserts.length) {
    const { error } = await admin
      .from("knowledge_suggestions")
      .upsert(inserts, { onConflict: "tenant_id,fingerprint", ignoreDuplicates: true });
    if (error) {
      throw new HttpError(500, "suggestions_refresh_failed", "Die Artikelvorschläge konnten nicht gespeichert werden.");
    }
  }
  // Open suggestions whose tickets no longer form a cluster are outdated.
  const outdated = [...openByFingerprint.values()].filter((id) => !keep.has(id));
  if (outdated.length) {
    await admin
      .from("knowledge_suggestions")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("status", "open")
      .in("id", outdated);
  }
  await admin.from("knowledge_suggestion_refreshes").upsert(
    { tenant_id: tenantId, refreshed_at: now, refreshed_by: actorId },
    { onConflict: "tenant_id" },
  );
  return { refreshedAt: now, suggestions: clusters.length };
}

/** Drafted suggestions follow their article: published or deleted. */
async function syncDraftedSuggestions(admin: Client, tenantId: string, rows: Row[]) {
  const drafted = rows.filter((row) => row.status === "drafted");
  if (!drafted.length) return;
  const articleIds = drafted
    .map((row) => row.article_id)
    .filter((id): id is string => typeof id === "string");
  const { data, error } = articleIds.length
    ? await admin
      .from("knowledge_articles")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .in("id", articleIds)
    : { data: [], error: null };
  if (error) return;
  const statuses = new Map(
    ((data ?? []) as Row[]).map((row) => [String(row.id), String(row.status)]),
  );
  const now = new Date().toISOString();
  for (const row of drafted) {
    const status = typeof row.article_id === "string"
      ? statuses.get(row.article_id)
      : undefined;
    const next = status === "published"
      ? "published"
      : status === undefined
      ? "open"
      : null;
    if (!next) continue;
    const { error: updateError } = await admin
      .from("knowledge_suggestions")
      .update({
        status: next,
        ...(next === "open" ? { article_id: null } : {}),
        updated_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("id", row.id)
      .eq("status", "drafted");
    if (!updateError) row.status = next;
  }
}

async function aiAvailability(admin: Client, tenantId: string) {
  const governance = await resolveAiGovernance(admin, tenantId);
  if (!governance.ok) return { available: false, code: governance.code };
  const purpose = validateAiPurpose(governance.policy, "knowledge_article_draft");
  if (purpose) return { available: false, code: purpose.code };
  if (!anthropicConfiguration()) {
    return { available: false, code: "ai_provider_not_configured" };
  }
  return { available: true, code: null };
}

async function list(
  request: Request,
  client: Client,
  admin: Client,
  actorId: string,
  tenantId: string,
  force: boolean,
) {
  const scope = await requireScope(admin, tenantId, actorId);
  const { data: refresh, error: refreshError } = await admin
    .from("knowledge_suggestion_refreshes")
    .select("refreshed_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (refreshError) {
    throw new HttpError(500, "suggestions_failed", "Die Artikelvorschläge konnten nicht geladen werden.");
  }
  let refreshedAt: string | null = typeof refresh?.refreshed_at === "string"
    ? refresh.refreshed_at
    : null;
  if (force || refreshDue(refreshedAt)) {
    refreshedAt = (await refreshTenant(admin, tenantId, actorId)).refreshedAt;
  }

  const { data, error } = await admin
    .from("knowledge_suggestions")
    .select("id, department_id, title_hint, ticket_ids, ticket_count, status, article_id, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .in("status", ["open", "drafted"])
    .order("ticket_count", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) {
    throw new HttpError(500, "suggestions_failed", "Die Artikelvorschläge konnten nicht geladen werden.");
  }
  const rows = ((data ?? []) as Row[]).filter((row) =>
    departmentVisible(scope, row.department_id)
  );
  await syncDraftedSuggestions(admin, tenantId, rows);
  const visibleRows = rows.filter((row) =>
    row.status === "open" || row.status === "drafted"
  );

  // Sample tickets through the caller's client: only tickets the person may read.
  const sampleIds = [
    ...new Set(
      visibleRows.flatMap((row) => stringArray(row.ticket_ids).slice(0, SAMPLE_TICKETS)),
    ),
  ];
  const samples = new Map<string, Row>();
  for (let index = 0; index < sampleIds.length; index += 200) {
    const { data: tickets, error: ticketError } = await client
      .from("tickets")
      .select("id, ticket_number, subject, resolved_at, closed_at")
      .eq("tenant_id", tenantId)
      .in("id", sampleIds.slice(index, index + 200));
    if (ticketError) {
      throw new HttpError(500, "tickets_failed", "Die Tickets konnten nicht geladen werden.");
    }
    for (const ticket of (tickets ?? []) as Row[]) samples.set(String(ticket.id), ticket);
  }

  return json(request, {
    data: {
      windowDays: WINDOW_DAYS,
      refreshedAt,
      ai: await aiAvailability(admin, tenantId),
      suggestions: visibleRows.map((row) => ({
        id: row.id,
        departmentId: row.department_id ?? null,
        titleHint: row.title_hint,
        ticketCount: row.ticket_count,
        status: row.status,
        articleId: row.article_id ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sampleTickets: stringArray(row.ticket_ids)
          .slice(0, SAMPLE_TICKETS)
          .map((id) => samples.get(id))
          .filter((ticket): ticket is Row => Boolean(ticket))
          .map((ticket) => ({
            id: ticket.id,
            ticketNumber: ticket.ticket_number,
            subject: ticket.subject,
            solvedAt: ticket.resolved_at ?? ticket.closed_at ?? null,
          })),
      })),
    },
  });
}

async function loadSuggestion(
  admin: Client,
  scope: DepartmentScope,
  tenantId: string,
  suggestionId: string,
): Promise<Row> {
  const { data, error } = await admin
    .from("knowledge_suggestions")
    .select("id, department_id, title_hint, ticket_ids, status, article_id")
    .eq("tenant_id", tenantId)
    .eq("id", suggestionId)
    .maybeSingle();
  if (error) {
    throw new HttpError(500, "suggestions_failed", "Der Vorschlag konnte nicht geladen werden.");
  }
  if (!data || !departmentVisible(scope, data.department_id)) {
    throw new HttpError(404, "suggestion_not_found", "Der Vorschlag ist nicht mehr verfügbar.");
  }
  return data as Row;
}

async function dismiss(
  request: Request,
  admin: Client,
  actorId: string,
  action: Extract<Action, { type: "dismiss" }>,
) {
  const scope = await requireScope(admin, action.tenantId, actorId);
  const suggestion = await loadSuggestion(admin, scope, action.tenantId, action.suggestionId);
  if (suggestion.status !== "open" && suggestion.status !== "drafted") {
    throw new HttpError(409, "suggestion_closed", "Der Vorschlag wurde bereits abgeschlossen.");
  }
  const now = new Date().toISOString();
  const { error } = await admin
    .from("knowledge_suggestions")
    .update({ status: "dismissed", dismissed_by: actorId, dismissed_at: now, updated_at: now })
    .eq("tenant_id", action.tenantId)
    .eq("id", action.suggestionId);
  if (error) {
    throw new HttpError(500, "suggestion_update_failed", "Der Vorschlag konnte nicht verworfen werden.");
  }
  await admin.from("audit_logs").insert({
    tenant_id: action.tenantId,
    actor_id: actorId,
    action: "knowledge.suggestion.dismissed",
    entity_type: "knowledge_suggestion",
    entity_id: action.suggestionId,
    severity: "info",
    metadata: {},
  });
  return json(request, { data: { dismissed: true } });
}

function anthropicConfiguration(): { apiKey: string; model: string } | null {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
  const model = Deno.env.get("ANTHROPIC_MODEL")?.trim();
  return apiKey && model ? { apiKey, model } : null;
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

/** How long a started draft blocks further attempts (AI call plus margin). */
const DRAFT_CLAIM_MS = 3 * 60_000;

/**
 * Claims the suggestion before the AI call so a double click or a second
 * person cannot create two drafts; the claim is released when drafting fails.
 */
async function draft(
  request: Request,
  client: Client,
  admin: Client,
  actorId: string,
  action: Extract<Action, { type: "draft" }>,
) {
  const scope = await requireScope(admin, action.tenantId, actorId);
  const suggestion = await loadSuggestion(admin, scope, action.tenantId, action.suggestionId);
  if (suggestion.status === "drafted" && typeof suggestion.article_id === "string") {
    return json(request, { data: { articleId: suggestion.article_id, existing: true } });
  }
  if (suggestion.status !== "open") {
    throw new HttpError(409, "suggestion_closed", "Der Vorschlag wurde bereits abgeschlossen.");
  }
  const now = new Date();
  const { data: claimed, error: claimError } = await admin
    .from("knowledge_suggestions")
    .update({ drafting_started_at: now.toISOString(), drafting_by: actorId })
    .eq("tenant_id", action.tenantId)
    .eq("id", action.suggestionId)
    .eq("status", "open")
    .or(
      `drafting_started_at.is.null,drafting_started_at.lt.${
        new Date(now.getTime() - DRAFT_CLAIM_MS).toISOString()
      }`,
    )
    .select("id")
    .maybeSingle();
  if (claimError) {
    throw new HttpError(503, "database_failure", "Der Vorschlag ist gerade nicht verfügbar.");
  }
  if (!claimed) {
    throw new HttpError(
      409,
      "draft_in_progress",
      "Für diesen Vorschlag wird gerade ein Entwurf erstellt. Bitte warten Sie einen Moment.",
    );
  }
  let response: Response | null = null;
  try {
    response = await draftClaimed(request, client, admin, actorId, action);
    return response;
  } finally {
    if (!response || response.status !== 201) {
      await admin
        .from("knowledge_suggestions")
        .update({ drafting_started_at: null, drafting_by: null })
        .eq("tenant_id", action.tenantId)
        .eq("id", action.suggestionId);
    }
  }
}

async function draftClaimed(
  request: Request,
  client: Client,
  admin: Client,
  actorId: string,
  action: Extract<Action, { type: "draft" }>,
) {
  const scope = await requireScope(admin, action.tenantId, actorId);
  const suggestion = await loadSuggestion(admin, scope, action.tenantId, action.suggestionId);
  if (suggestion.status === "drafted" && typeof suggestion.article_id === "string") {
    return json(request, { data: { articleId: suggestion.article_id, existing: true } });
  }
  if (suggestion.status !== "open") {
    throw new HttpError(409, "suggestion_closed", "Der Vorschlag wurde bereits abgeschlossen.");
  }

  // Same governance, budget and provider checks as ai-assist.
  const governance = await resolveAiGovernance(admin, action.tenantId);
  if (!governance.ok) {
    return json(request, { error: { code: governance.code } }, governance.status);
  }
  const purposeFailure = validateAiPurpose(governance.policy, "knowledge_article_draft");
  if (purposeFailure) {
    return json(request, { error: { code: purposeFailure.code } }, purposeFailure.status);
  }
  const budgetFailure = validateAiBudget(governance.policy, MAX_OUTPUT_TOKENS, MAX_COST_CENTS);
  if (budgetFailure) {
    return json(request, { error: { code: budgetFailure.code } }, budgetFailure.status);
  }
  const provider = anthropicConfiguration();
  if (!provider) {
    return json(request, { error: { code: "ai_provider_not_configured" } }, 503);
  }

  // Source tickets with the caller's client (row-level security decides).
  const clusterIds = stringArray(suggestion.ticket_ids);
  const { data: ticketRows, error: ticketError } = await client
    .from("tickets")
    .select("id, subject, description")
    .eq("tenant_id", action.tenantId)
    .in("id", clusterIds.slice(0, MAX_LINKED_TICKETS));
  if (ticketError) {
    throw new HttpError(503, "ticket_read_failed", "Die Tickets konnten nicht gelesen werden.");
  }
  const visible = new Map(((ticketRows ?? []) as Row[]).map((row) => [String(row.id), row]));
  const visibleIds = clusterIds.filter((id) => visible.has(id));
  if (!visibleIds.length) {
    throw new HttpError(404, "tickets_not_found", "Die Tickets dieses Vorschlags sind für Sie nicht verfügbar.");
  }
  const sourceIds = visibleIds.slice(0, MAX_SOURCE_TICKETS);
  const { data: comments, error: commentError } = await client
    .from("ticket_comments")
    .select("ticket_id, visibility, body, created_at")
    .in("ticket_id", sourceIds)
    .order("created_at", { ascending: false })
    .limit(400);
  if (commentError) {
    throw new HttpError(503, "ticket_read_failed", "Die Tickets konnten nicht gelesen werden.");
  }
  const solutions = solutionTexts(
    ((comments ?? []) as Row[]).map((row) => ({
      ticketId: String(row.ticket_id),
      visibility: String(row.visibility),
      body: typeof row.body === "string" ? row.body : "",
      createdAt: String(row.created_at),
    })),
  );
  const source = buildClusterSource(
    String(suggestion.title_hint ?? ""),
    sourceIds.map((id) => {
      const ticket = visible.get(id)!;
      const solution = solutions.get(id);
      return {
        subject: typeof ticket.subject === "string" ? ticket.subject : "",
        description: typeof ticket.description === "string" ? ticket.description : "",
        reply: solution?.reply ?? null,
        note: solution?.note ?? null,
      };
    }),
  );

  // The draft goes to the cluster's department when it is one of the agent's
  // knowledge departments, otherwise to the agent's only department.
  const department = resolveRecordDepartment(
    scope,
    typeof suggestion.department_id === "string" &&
      scope.departments.includes(suggestion.department_id)
      ? suggestion.department_id
      : undefined,
  );
  if ("error" in department) {
    return json(
      request,
      { error: { code: "article_department_required", message: department.error } },
      422,
    );
  }

  const queued = await queueMinimalAiDraftRequest(admin, {
    tenantId: action.tenantId,
    actorId,
    purpose: "knowledge_article_draft",
    object: { type: "ticket", id: sourceIds[0] } as AiDraftObject,
    inputCharacterCount: Math.max(1, Array.from(source).length),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxCostCents: MAX_COST_CENTS,
    externalArticleContent: false,
  });
  if (!queued.ok) {
    return json(request, { error: { code: queued.code } }, queued.status);
  }
  await admin.from("audit_logs").insert({
    tenant_id: action.tenantId,
    actor_id: actorId,
    action: "knowledge.article.ai_suggestion_draft_requested",
    entity_type: "knowledge_suggestion",
    entity_id: action.suggestionId,
    severity: "security",
    metadata: {
      provider: AI_PROVIDER_KEY,
      request_id: queued.requestId,
      ticket_count: sourceIds.length,
    },
  });

  let generated: { title: string; bodyMarkdown: string };
  try {
    generated = await generateKnowledgeDraft({
      ...provider,
      rawContent: source,
      maxTokens: MAX_OUTPUT_TOKENS,
      extraInstructions: CLUSTER_ARTICLE_INSTRUCTIONS,
    });
  } catch (error) {
    const code = error instanceof AnthropicKnowledgeDraftError
      ? error.code
      : "ai_provider_request_failed";
    await admin.from("audit_logs").insert({
      tenant_id: action.tenantId,
      actor_id: actorId,
      action: "knowledge.article.ai_draft_failed",
      entity_type: "knowledge_suggestion",
      entity_id: action.suggestionId,
      severity: "security",
      metadata: { provider: AI_PROVIDER_KEY, request_id: queued.requestId, failure_code: code },
    });
    return json(request, { error: { code } }, 503);
  }

  // Always an internal draft: a person has to review, edit and publish it.
  const now = new Date().toISOString();
  const { data: article, error: articleError } = await admin
    .from("knowledge_articles")
    .insert({
      tenant_id: action.tenantId,
      department_id: department.departmentId,
      title: generated.title,
      slug: articleSlug(generated.title),
      visibility: "internal",
      status: "draft",
      current_revision: 1,
      created_by: actorId,
      updated_at: now,
    })
    .select("id, title")
    .single();
  if (articleError || !article) {
    return json(request, { error: { code: "article_create_failed" } }, 422);
  }
  const { error: revisionError } = await admin
    .from("knowledge_article_revisions")
    .insert({
      article_id: article.id,
      revision: 1,
      title_snapshot: generated.title,
      body: generated.bodyMarkdown,
      author_id: actorId,
    });
  if (revisionError) {
    await admin
      .from("knowledge_articles")
      .delete()
      .eq("tenant_id", action.tenantId)
      .eq("id", article.id);
    return json(request, { error: { code: "article_revision_create_failed" } }, 500);
  }
  await admin.from("audit_logs").insert({
    tenant_id: action.tenantId,
    actor_id: actorId,
    action: "knowledge.article.created",
    entity_type: "knowledge_article",
    entity_id: article.id,
    severity: "info",
    metadata: {
      source: "ai_suggestion_draft",
      suggestion_id: action.suggestionId,
      request_id: queued.requestId,
    },
  });
  await admin
    .from("knowledge_suggestions")
    .update({ status: "drafted", article_id: article.id, updated_at: now })
    .eq("tenant_id", action.tenantId)
    .eq("id", action.suggestionId);

  // Link the draft to the tickets as internal knowledge (caller's own rights).
  // Once the article is published these tickets count as covered.
  let linked = 0;
  for (const ticketId of visibleIds) {
    const { error: linkError } = await client.rpc("ticket_knowledge_mutate", {
      p_action: "attach",
      p_tenant_id: action.tenantId,
      p_ticket_id: ticketId,
      p_article_id: article.id,
      p_visibility: "internal",
      p_title: null,
      p_body_markdown: null,
    });
    if (!linkError) linked += 1;
  }

  return json(
    request,
    { data: { articleId: article.id, title: article.title, linkedTickets: linked } },
    201,
  );
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") {
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      }
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) return json(request, { error: { code: "unauthorized" } }, 401);
      const action = parseAction(await readBody(request));
      if (!action) {
        return json(
          request,
          { error: { code: "invalid_request", message: "Die Anfrage ist ungültig." } },
          422,
        );
      }
      const admin = context.supabaseAdmin;
      await requireKnowledgeManager(context.supabase, admin, action.tenantId, actorId);
      switch (action.type) {
        case "list":
          return await list(request, context.supabase, admin, actorId, action.tenantId, false);
        case "refresh":
          return await list(request, context.supabase, admin, actorId, action.tenantId, true);
        case "draft":
          return await draft(request, context.supabase, admin, actorId, action);
        case "dismiss":
          return await dismiss(request, admin, actorId, action);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error("knowledge_suggestions_failed", error);
      return json(request, { error: { code: "internal_error" } }, 500);
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};
