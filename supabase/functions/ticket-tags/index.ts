import { withSupabase } from "@supabase/server";

function headers(request: Request) {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin":
      origin === "https://app.nextdesk.ch" ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

// Kept as a tombstone for the already deployed URL. Tags were replaced by the
// category/subcategory hierarchy and this endpoint no longer exposes data.
const handler = withSupabase({ auth: "user" }, async (request) => {
  if (request.method !== "POST") {
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  }
  return json(request, { error: { code: "ticket_tags_retired" } }, 410);
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return json(request, {}, 204);
    return handler(request);
  },
};
