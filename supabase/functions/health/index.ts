const ALLOWED_ORIGIN = "https://app.nextdesk.ch";

type HealthResponse = {
  status: "ok";
  service: "nextdesk";
  time: string;
};

function headers(request: Request): Headers {
  const result = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    result.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    result.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    result.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
  }
  return result;
}

function response(request: Request, status = 200): Response {
  const body: HealthResponse = {
    status: "ok",
    service: "nextdesk",
    time: new Date().toISOString(),
  };
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

export default {
  fetch(request: Request): Response {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ALLOWED_ORIGIN) {
      return new Response(
        JSON.stringify({
          error: {
            code: "origin_not_allowed",
            message: "Dieser Ursprung ist nicht erlaubt.",
          },
        }),
        { status: 403, headers: headers(request) },
      );
    }
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) {
        return new Response(
          JSON.stringify({
            error: {
              code: "origin_not_allowed",
              message: "Dieser Ursprung ist nicht erlaubt.",
            },
          }),
          { status: 403, headers: headers(request) },
        );
      }
      return response(request, 204);
    }
    if (request.method !== "GET" && request.method !== "POST") {
      const result = new Response(
        JSON.stringify({
          error: {
            code: "method_not_allowed",
            message: "Nur GET- und POST-Anfragen sind erlaubt.",
          },
        }),
        { status: 405, headers: headers(request) },
      );
      result.headers.set("Allow", "GET, POST, OPTIONS");
      return result;
    }
    return response(request);
  },
};
