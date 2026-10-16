export type JsonObject = Record<string, unknown>;

function configuredOrigins(): Set<string> {
  return new Set(
    (Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  const allowedOrigins = configuredOrigins();
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : "";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(
  request: Request,
  body: JsonObject,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "X-Request-Id": crypto.randomUUID(),
    },
  });
}

export function noContent(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function parseJsonObject(
  request: Request,
): Promise<JsonObject | null> {
  try {
    const value: unknown = await request.json();
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
