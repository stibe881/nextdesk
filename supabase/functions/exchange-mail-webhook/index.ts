import { withSupabase } from "@supabase/server";

const MAX_VALIDATION_TOKEN_LENGTH = 4096;

type Row = Record<string, unknown>;

function response(status: number, body?: Row): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: body
      ? {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        }
      : { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

// Microsoft Graph supports no reliable delegated subscriptions for shared
// mailboxes. Delegated channels are intentionally polled by exchange-mail-worker.
// This legacy endpoint remains publicly reachable only for the provider's
// validation handshake and ignores all subsequent notification payloads.
const handler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request) => {
    const validationToken = new URL(request.url).searchParams.get(
      "validationToken",
    );
    if (validationToken !== null) {
      if (validationToken.length > MAX_VALIDATION_TOKEN_LENGTH)
        return new Response(null, { status: 400 });
      return new Response(validationToken, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    return response(202, { data: { accepted: true, processed: false } });
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handler(request);
    } catch {
      return response(500, { error: { code: "webhook_failed" } });
    }
  },
};
