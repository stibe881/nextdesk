import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 420 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Visibility = "internal" | "external";
type TicketReference = { tenantId: string; ticketId: string };
type Action = TicketReference &
  (
    | { type: "list" }
    | { type: "searchArticles"; query: string }
    | { type: "attach"; articleId: string; visibility: Visibility }
    | { type: "detach" | "sendToRequester"; articleId: string }
    | {
        type: "createAndAttach";
        title: string;
        bodyMarkdown: string;
        visibility: Visibility;
      }
  );

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value)
    ? value.toLowerCase()
    : null;
}

function onlyKeys(value: Record<string, unknown>, extra: string[]): boolean {
  const allowed = new Set(["type", "tenantId", "ticketId", ...extra]);
  return Object.keys(value).every((key) => allowed.has(key));
}

function text(
  value: unknown,
  min: number,
  max: number,
  trim = true,
): string | null {
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    /\p{Cs}/u.test(value)
  )
    return null;
  const result = trim ? value.trim() : value;
  const length = [...result].length;
  return length >= min && length <= max && result.trim().length > 0
    ? result
    : null;
}

function visibility(value: unknown): value is Visibility {
  return value === "internal" || value === "external";
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value)) return null;
  const tenantId = uuid(value.tenantId);
  const ticketId = uuid(value.ticketId);
  if (!tenantId || !ticketId) return null;
  const reference = { tenantId, ticketId };
  switch (value.type) {
    case "list":
      return onlyKeys(value, []) ? { ...reference, type: "list" } : null;
    case "searchArticles": {
      const query = text(value.query, 2, 120);
      return query && onlyKeys(value, ["query"])
        ? { ...reference, type: "searchArticles", query }
        : null;
    }
    case "attach": {
      const articleId = uuid(value.articleId);
      return articleId &&
        visibility(value.visibility) &&
        onlyKeys(value, ["articleId", "visibility"])
        ? {
            ...reference,
            type: "attach",
            articleId,
            visibility: value.visibility,
          }
        : null;
    }
    case "detach":
    case "sendToRequester": {
      const articleId = uuid(value.articleId);
      return articleId && onlyKeys(value, ["articleId"])
        ? { ...reference, type: value.type, articleId }
        : null;
    }
    case "createAndAttach": {
      const title = text(value.title, 3, 240);
      const bodyMarkdown = text(value.bodyMarkdown, 1, 100_000, false);
      return title &&
        bodyMarkdown &&
        visibility(value.visibility) &&
        onlyKeys(value, ["title", "bodyMarkdown", "visibility"])
        ? {
            ...reference,
            type: "createAndAttach",
            title,
            bodyMarkdown,
            visibility: value.visibility,
          }
        : null;
    }
    default:
      return null;
  }
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({ Vary: "Origin", "Cache-Control": "no-store" });
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
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Request-Id", crypto.randomUUID());
  return new Response(JSON.stringify(body), { status, headers });
}

function error(request: Request, code: string, status: number): Response {
  // Never expose database messages, SQL details, supplied content, actor names,
  // email addresses, or whether a resource exists outside the authorized tenant.
  return json(request, { error: { code } }, status);
}

function withCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const key of [...headers.keys()]) {
    if (key.toLowerCase().startsWith("access-control-")) headers.delete(key);
  }
  corsHeaders(request).forEach((value, key) => headers.set(key, value));
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readAction(
  request: Request,
): Promise<{ action: Action | null; tooLarge: boolean }> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)
  )
    return { action: null, tooLarge: true };
  if (!request.body) return { action: null, tooLarge: false };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    // Enforce the actual stream size too: a missing/false Content-Length is not
    // a way around the bound. This permits 100k Unicode Markdown characters.
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { action: null, tooLarge: true };
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return { action: parseAction(JSON.parse(body)), tooLarge: false };
  } catch {
    await reader.cancel().catch(() => undefined);
    return { action: null, tooLarge: false };
  } finally {
    reader.releaseLock();
  }
}

function rpcError(request: Request, code: unknown): Response {
  switch (code) {
    case "42501":
      return error(request, "permission_denied", 403);
    case "P0002":
      return error(request, "not_found_or_access_denied", 404);
    case "23505":
      return error(request, "link_visibility_conflict", 409);
    case "22023":
    case "23503":
    case "23514":
    case "22P02":
      return error(request, "invalid_operation", 422);
    default:
      return error(request, "ticket_knowledge_failed", 500);
  }
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    if (request.method !== "POST") {
      return error(request, "method_not_allowed", 405);
    }
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers.get("content-type") ?? "",
      )
    ) {
      return error(request, "json_content_type_required", 415);
    }
    const parsed = await readAction(request);
    if (parsed.tooLarge) return error(request, "payload_too_large", 413);
    const action = parsed.action;
    if (!action) return error(request, "invalid_request", 422);
    const actorId = uuid(context.userClaims?.id);
    if (!actorId) {
      return error(request, "unauthorized", 401);
    }

    const { data: membership, error: membershipError } =
      await context.supabaseAdmin
        .from("tenant_memberships")
        .select("tenant_id")
        .eq("tenant_id", action.tenantId)
        .eq("user_id", actorId)
        .eq("status", "active")
        .maybeSingle();
    if (membershipError) {
      return error(request, "tenant_feature_lookup_failed", 503);
    }
    if (!membership) return error(request, "permission_denied", 403);

    const featureStates = await resolveTenantFeatureStates(
      context.supabaseAdmin,
      action.tenantId,
      ["ticketing.detail"],
    );
    if (!featureStates)
      return error(request, "tenant_feature_lookup_failed", 503);
    if (featureStates["ticketing.detail"] !== true)
      return error(request, "ticket_feature_disabled", 403);

    // The caller-scoped client preserves auth.uid() and never uses service-role
    // bypass. SQL rechecks membership, can_read_ticket, ticket.update, and (for
    // creation) knowledge.manage inside the same transaction as the mutation.
    if (action.type === "list" || action.type === "searchArticles") {
      const { data, error: failure } = await context.supabase.rpc(
        "ticket_knowledge_read",
        {
          p_tenant_id: action.tenantId,
          p_ticket_id: action.ticketId,
          p_query: action.type === "searchArticles" ? action.query : null,
        },
      );
      if (failure) return rpcError(request, failure.code);
      if (!isRecord(data)) {
        return error(request, "ticket_knowledge_failed", 500);
      }
      return json(request, { data });
    }

    const { data, error: failure } = await context.supabase.rpc(
      "ticket_knowledge_mutate",
      {
        p_action: action.type,
        p_tenant_id: action.tenantId,
        p_ticket_id: action.ticketId,
        p_article_id: "articleId" in action ? action.articleId : null,
        p_visibility: "visibility" in action ? action.visibility : null,
        p_title: action.type === "createAndAttach" ? action.title : null,
        p_body_markdown:
          action.type === "createAndAttach" ? action.bodyMarkdown : null,
      },
    );
    if (failure) return rpcError(request, failure.code);
    if (!isRecord(data)) return error(request, "ticket_knowledge_failed", 500);
    return json(
      request,
      { data },
      action.type === "createAndAttach" ? 201 : 200,
    );
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ALLOWED_ORIGIN) {
      return error(request, "origin_not_allowed", 403);
    }
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) {
        return error(request, "origin_not_allowed", 403);
      }
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    try {
      return withCors(request, await handler(request));
    } catch {
      return error(request, "ticket_knowledge_failed", 500);
    }
  },
};
