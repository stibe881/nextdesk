import { type SupabaseContext, withSupabase } from "@supabase/server";

const APP_ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_QUERY_LENGTH = 120;

type Client = SupabaseContext["supabase"];
type SearchResult = {
  resultType:
    "ticket" | "follow_up" | "knowledge" | "event_space" | "onboarding";
  entityId: string;
  title: string;
  detail: string;
  section:
    | "Tickets"
    | "Wiedervorlagen"
    | "Wissen"
    | "Veranstaltungsräume"
    | "Eintritte";
  ticketId: string | null;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

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

function queryText(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    value.includes("\u0000")
  ) {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length >= 2 && normalized.length <= MAX_QUERY_LENGTH
    ? normalized
    : null;
}

async function requestJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new HttpError(
      413,
      "request_too_large",
      "Die Suchanfrage ist zu gross.",
    );
  }
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        throw new HttpError(
          413,
          "request_too_large",
          "Die Suchanfrage ist zu gross.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
}

function parseSearch(
  value: unknown,
): { tenantId: string; query: string } | null {
  if (!isRecord(value) || value.type !== "search" || !isUuid(value.tenantId)) {
    return null;
  }
  const query = queryText(value.query);
  return query ? { tenantId: value.tenantId, query } : null;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
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

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request),
  });
}

function parseResults(value: unknown): SearchResult[] | null {
  if (!Array.isArray(value)) return null;
  const allowed = new Set<SearchResult["resultType"]>([
    "ticket",
    "follow_up",
    "knowledge",
    "event_space",
    "onboarding",
  ]);
  const sections = new Set<SearchResult["section"]>([
    "Tickets",
    "Wiedervorlagen",
    "Wissen",
    "Veranstaltungsräume",
    "Eintritte",
  ]);
  const result: SearchResult[] = [];
  for (const row of value) {
    if (
      !isRecord(row) ||
      !allowed.has(row.result_type as SearchResult["resultType"]) ||
      !isUuid(row.entity_id) ||
      typeof row.title !== "string" ||
      typeof row.detail !== "string" ||
      !sections.has(row.section as SearchResult["section"]) ||
      (row.ticket_id !== null && !isUuid(row.ticket_id))
    ) {
      return null;
    }
    result.push({
      resultType: row.result_type as SearchResult["resultType"],
      entityId: row.entity_id,
      title: row.title,
      detail: row.detail,
      section: row.section as SearchResult["section"],
      ticketId: row.ticket_id,
    });
  }
  return result;
}

async function requireMembership(
  client: Client,
  tenantId: string,
): Promise<void> {
  const { data, error } = await client.rpc("is_active_tenant_member", {
    p_tenant_id: tenantId,
  });
  if (error || typeof data !== "boolean") {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  }
  if (!data) {
    throw new HttpError(
      403,
      "tenant_membership_required",
      "Für diese Suche ist eine aktive Mandantenmitgliedschaft erforderlich.",
    );
  }
}

const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== APP_ORIGIN) {
      return json(request, { error: { code: "origin_not_allowed" } }, 403);
    }
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (request.method !== "POST") {
      return json(request, { error: { code: "method_not_allowed" } }, 405);
    }
    try {
      const action = parseSearch(await requestJson(request));
      if (!action) {
        throw new HttpError(
          400,
          "invalid_request",
          "Die Suchanfrage enthält ungültige Felder.",
        );
      }
      await requireMembership(context.supabase, action.tenantId);
      const { data, error } = await context.supabase.rpc(
        "search_global_workspace",
        {
          p_tenant_id: action.tenantId,
          p_query: action.query,
          p_limit: 40,
        },
      );
      if (error) {
        throw new HttpError(
          503,
          "global_search_failed",
          "Die globale Suche ist momentan nicht verfügbar.",
        );
      }
      const results = parseResults(data);
      if (!results) {
        throw new HttpError(
          500,
          "global_search_response_invalid",
          "Die globale Suche konnte nicht gelesen werden.",
        );
      }
      return json(request, { data: { results } });
    } catch (error) {
      const failure =
        error instanceof HttpError
          ? error
          : new HttpError(
              500,
              "global_search_failed",
              "Die globale Suche ist momentan nicht verfügbar.",
            );
      return json(request, { error: { code: failure.code } }, failure.status);
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    return handler(request);
  },
};
