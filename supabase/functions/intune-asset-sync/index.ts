import { withSupabase } from "@supabase/server";

function response(requestId: string, status = 409): Response {
  return new Response(
    JSON.stringify({ error: { code: "intune_provider_sync_disabled" } }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    },
  );
}

// P1.5 deliberately leaves Intune provider synchronization disabled. The
// local preflight in asset-registry is the only supported Intune-related
// operation until a separately approved provider design is implemented.
const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request) => {
    const requestId = crypto.randomUUID();
    if (request.method !== "POST") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST", "X-Request-Id": requestId },
      });
    }
    return response(requestId);
  },
);

export default { fetch: handler };
