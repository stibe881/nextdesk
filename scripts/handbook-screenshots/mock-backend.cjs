// In-browser fake of the Supabase backend for the handbook screenshots.
//
// Every request to https://demo.supabase.test/** is answered by Playwright
// route handlers: auth, PostgREST tables and RPCs (rest-handlers.cjs), edge
// functions (function-handlers.cjs) and the realtime websocket. Unknown calls
// get an empty but well-formed answer and are reported as MISS, so new screens
// that need data are easy to spot with `capture.mjs --explore`.

const D = require("./demo-data.cjs");
const { restResponse } = require("./rest-handlers.cjs");
const { functionResponse } = require("./function-handlers.cjs");

const SUPABASE_URL = "https://demo.supabase.test";
const STORAGE_KEY = "sb-demo-auth-token";

const PERSONAS = {
  employee: { ...D.U.lena, canWorkTickets: false, isTenantAdmin: false },
  agent: { ...D.U.mara, canWorkTickets: true, isTenantAdmin: false },
  admin: { ...D.U.daniel, canWorkTickets: true, isTenantAdmin: true },
};

const b64u = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function sessionFor(persona) {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: persona.id,
    aud: "authenticated",
    role: "authenticated",
    email: persona.email,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: persona.name },
    identities: [{ provider: "email" }],
    created_at: "2025-03-01T08:00:00Z",
    last_sign_in_at: new Date().toISOString(),
  };
  const jwt = [
    b64u({ alg: "HS256", typ: "JWT" }),
    b64u({ sub: persona.id, exp: now + 86400, role: "authenticated", aud: "authenticated", email: persona.email }),
    "signature",
  ].join(".");
  return {
    user,
    session: { access_token: jwt, refresh_token: "demo-refresh", token_type: "bearer", expires_in: 86400, expires_at: now + 86400, user },
  };
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "*",
  "access-control-expose-headers": "*",
};

/** Answers the Phoenix protocol of supabase realtime so channels stay quiet. */
async function installRealtime(context) {
  await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!Array.isArray(message)) return;
      const [joinRef, ref, topic, event, payload] = message;
      if (event === "phx_join") {
        const changes = (payload?.config?.postgres_changes ?? []).map((change, index) => ({ ...change, id: index + 1 }));
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: changes } }]));
      } else if (event === "heartbeat" || event === "access_token" || event === "phx_leave") {
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
      }
    });
  });
}

/**
 * Installs the fake backend on a browser context.
 * @param {import('playwright').BrowserContext} context
 * @param {keyof PERSONAS | null} personaKey  null = signed out (login page)
 * @param {{ log?: boolean, onMiss?: (line: string) => void, seenTour?: boolean }} options
 */
async function install(context, personaKey, options = {}) {
  const persona = personaKey ? PERSONAS[personaKey] : null;
  const auth = persona ? sessionFor(persona) : null;
  const state = { persona, personaKey, misses: [] };

  await context.addInitScript(
    ({ key, session, userId }) => {
      try {
        if (session && !sessionStorage.getItem("handbook-session-injected")) {
          localStorage.setItem(key, session);
          sessionStorage.setItem("handbook-session-injected", "1");
        }
        if (userId) {
          // Onboarding tour and intro tips are shown once per person.
          localStorage.setItem(`nextdesk.tour.agent.v1.${userId}`, "done");
        }
      } catch {
        // Storage can be unavailable on about:blank.
      }
    },
    { key: STORAGE_KEY, session: auth ? JSON.stringify(auth.session) : null, userId: persona?.id ?? null },
  );

  await installRealtime(context);

  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 200, headers: CORS });
    }
    let body = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }

    const ctx = { persona, state, request, url, body, method: request.method(), headers: request.headers() };
    let result = null;
    const path = url.pathname;
    if (path.startsWith("/auth/v1/")) {
      result = authResponse(path, ctx, auth);
    } else if (path.startsWith("/functions/v1/")) {
      result = persona ? functionResponse(path.split("/")[3], body ?? {}, ctx) : { status: 401, json: { error: { code: "unauthorized" } } };
    } else if (path.startsWith("/rest/v1/")) {
      result = restResponse(path.slice("/rest/v1/".length), ctx);
    } else if (path.startsWith("/storage/v1/")) {
      result = { status: 404, json: { error: "not_found" } };
    }

    const line = `${request.method()} ${path}${decodeURIComponent(url.search).slice(0, 160)} ${body ? JSON.stringify(body).slice(0, 200) : ""}`;
    if (!result || result.miss) {
      state.misses.push(line);
      options.onMiss?.(line);
    }
    if (options.log) console.log(result && !result.miss ? "OK  " : "MISS", line);
    if (!result) {
      result = { json: path.startsWith("/rest") ? [] : { data: {} } };
    }
    if (result.delayMs) await new Promise((resolve) => setTimeout(resolve, result.delayMs));
    return route.fulfill({
      status: result.status ?? 200,
      headers: { ...CORS, ...(result.headers ?? {}) },
      ...(result.body !== undefined ? { body: result.body } : { json: result.json ?? null }),
    });
  });

  return state;
}

function authResponse(path, ctx, auth) {
  if (path === "/auth/v1/user") return auth ? { json: auth.user } : { status: 401, json: { code: 401, msg: "not signed in" } };
  if (path === "/auth/v1/logout") return { status: 204, body: "" };
  if (path === "/auth/v1/settings") {
    return { json: { external: { azure: true, email: true }, disable_signup: true, mailer_autoconfirm: false } };
  }
  if (path === "/auth/v1/token") return auth ? { json: auth.session } : { status: 400, json: { error: "invalid_grant" } };
  if (path === "/auth/v1/otp" || path === "/auth/v1/recover") return { json: {} };
  return null;
}

module.exports = { install, PERSONAS, TENANT: D.TENANT, SUPABASE_URL };
