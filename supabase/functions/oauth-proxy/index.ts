// OAuth-Vermittler für Programme, die kein PKCE senden (z. B. die Connectors
// von Gemini Enterprise). Der Supabase-OAuth-Server verlangt PKCE immer.
//
// Ablauf:
//   1. /authorize  Das Programm startet die Anmeldung. Der Vermittler erzeugt
//                  PKCE selbst, merkt sich den Vorgang und leitet zum
//                  Supabase-OAuth-Server (und damit zur nextDesk-Zustimmung).
//   2. /callback   Supabase kommt mit einem Code zurück. Der Vermittler tauscht
//                  ihn mit seinem PKCE-Schlüssel gegen die Token der Person und
//                  gibt dem Programm einen eigenen, einmal gültigen Code.
//   3. /token      Das Programm tauscht diesen Code (oder ein Refresh-Token)
//                  gegen die Token. Es sind die Supabase-Token der Person; alle
//                  Aktionen laufen weiter mit deren Rechten.
//
// Geheimnisse (Supabase-Secrets):
//   OAUTH_PROXY_CLIENT_ID / OAUTH_PROXY_CLIENT_SECRET
//       Zugangsdaten, die das Programm gegenüber dem Vermittler verwendet.
//   OAUTH_PROXY_UPSTREAM_CLIENT_ID / OAUTH_PROXY_UPSTREAM_CLIENT_SECRET
//       Der vertrauliche OAuth-Client in Supabase (Redirect-URI = /callback).
//   OAUTH_PROXY_ENC_KEY
//       32 zufällige Bytes, base64, verschlüsselt die Token zwischen /callback
//       und /token.
//   OAUTH_PROXY_ALLOWED_REDIRECTS (optional, kommagetrennt)
//       Standard: https://vertexaisearch.cloud.google.com/oauth-redirect

const DEFAULT_REDIRECTS = [
  "https://vertexaisearch.cloud.google.com/oauth-redirect",
];
const DEFAULT_SCOPE = "openid profile email";
const FLOW_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 15_000;

type Json = Record<string, unknown>;

export type Flow = {
  clientRedirectUri: string;
  clientState: string | null;
  codeExpiresAt: string | null;
  expiresAt: string;
  proxyCode: string | null;
  state: string;
  tokensEncrypted: string | null;
  verifier: string;
};

/** Speicher für die Zwischenzustände. Produktiv: Tabelle oauth_proxy_flows. */
export type Store = {
  attachCode(
    state: string,
    proxyCode: string,
    tokensEncrypted: string,
    codeExpiresAt: string,
  ): Promise<boolean>;
  consumeCode(proxyCode: string): Promise<Flow | null>;
  deleteExpired(): Promise<void>;
  findByState(state: string): Promise<Flow | null>;
  insert(flow: Flow): Promise<void>;
};

export type Config = {
  allowedRedirects: string[];
  clientId: string;
  clientSecret: string;
  encKey: string;
  supabaseUrl: string;
  upstreamClientId: string;
  upstreamClientSecret: string;
};

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------- Krypto

function b64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return b64url(new Uint8Array(digest));
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

/** Vergleich ohne Zeitunterschied, indem beide Werte zuerst gehasht werden. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index]! ^ right[index]!;
  }
  return diff === 0;
}

function fromBase64(value: string): Uint8Array {
  const text = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

async function aesKey(encKey: string): Promise<CryptoKey> {
  const raw = fromBase64(encKey);
  if (raw.length !== 32) throw new Error("invalid_enc_key");
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptJson(
  value: unknown,
  encKey: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await aesKey(encKey),
      data,
    ),
  );
  return `${b64url(iv)}.${b64url(cipher)}`;
}

export async function decryptJson(
  value: string,
  encKey: string,
): Promise<unknown> {
  const [iv, cipher] = value.split(".");
  if (!iv || !cipher) throw new Error("invalid_ciphertext");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    await aesKey(encKey),
    fromBase64(cipher),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---------------------------------------------------------------- HTTP

function respond(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...headers,
    },
  });
}

function oauthError(
  error: string,
  description: string,
  status = 400,
): Response {
  return respond({ error, error_description: description }, status);
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

function callbackUrl(config: Config): string {
  return `${config.supabaseUrl}/functions/v1/oauth-proxy/callback`;
}

/** Liest die Zugangsdaten des Programms (Basic-Header oder Formularfelder). */
async function authenticateClient(
  request: Request,
  form: URLSearchParams,
  config: Config,
): Promise<boolean> {
  let id = form.get("client_id") ?? "";
  let secret = form.get("client_secret") ?? "";
  const header = request.headers.get("authorization") ?? "";
  const basic = /^Basic\s+(\S+)$/i.exec(header);
  if (basic) {
    try {
      const decoded = new TextDecoder().decode(fromBase64(basic[1]!));
      const separator = decoded.indexOf(":");
      if (separator > 0) {
        id = decodeURIComponent(decoded.slice(0, separator));
        secret = decodeURIComponent(decoded.slice(separator + 1));
      }
    } catch {
      return false;
    }
  }
  if (!id || !secret) return false;
  const [idOk, secretOk] = await Promise.all([
    safeEqual(id, config.clientId),
    safeEqual(secret, config.clientSecret),
  ]);
  return idOk && secretOk;
}

async function upstreamToken(
  config: Config,
  form: Record<string, string>,
): Promise<Response> {
  const body = new URLSearchParams(form);
  return await fetch(`${config.supabaseUrl}/auth/v1/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${btoa(
        `${encodeURIComponent(config.upstreamClientId)}:${encodeURIComponent(config.upstreamClientSecret)}`,
      )}`,
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Gibt nur die Felder weiter, die ein Programm für den Token-Austausch braucht. */
function publicTokens(tokens: Json): Json {
  const result: Json = {};
  for (const key of [
    "access_token",
    "token_type",
    "expires_in",
    "refresh_token",
    "scope",
  ]) {
    if (tokens[key] !== undefined) result[key] = tokens[key];
  }
  return result;
}

// ---------------------------------------------------------------- Abläufe

async function handleAuthorize(
  url: URL,
  config: Config,
  store: Store,
): Promise<Response> {
  const params = url.searchParams;
  const redirectUri = params.get("redirect_uri") ?? "";
  // Ohne gültige Rückkehradresse darf nirgendwohin weitergeleitet werden.
  if (!config.allowedRedirects.includes(redirectUri)) {
    return oauthError("invalid_request", "redirect_uri ist nicht erlaubt.");
  }
  const clientState = params.get("state");
  const fail = (error: string) => {
    const target = new URL(redirectUri);
    target.searchParams.set("error", error);
    if (clientState) target.searchParams.set("state", clientState);
    return redirect(target.toString());
  };
  if (!(await safeEqual(params.get("client_id") ?? "", config.clientId))) {
    return fail("unauthorized_client");
  }
  if (params.get("response_type") !== "code")
    return fail("unsupported_response_type");

  await store.deleteExpired();
  const verifier = randomToken(48);
  const state = randomToken(32);
  await store.insert({
    clientRedirectUri: redirectUri,
    clientState: clientState && clientState.length <= 2048 ? clientState : null,
    codeExpiresAt: null,
    expiresAt: new Date(Date.now() + FLOW_TTL_MS).toISOString(),
    proxyCode: null,
    state,
    tokensEncrypted: null,
    verifier,
  });

  const upstream = new URL(`${config.supabaseUrl}/auth/v1/oauth/authorize`);
  upstream.searchParams.set("response_type", "code");
  upstream.searchParams.set("client_id", config.upstreamClientId);
  upstream.searchParams.set("redirect_uri", callbackUrl(config));
  upstream.searchParams.set(
    "scope",
    params.get("scope")?.trim() || DEFAULT_SCOPE,
  );
  upstream.searchParams.set("state", state);
  upstream.searchParams.set("code_challenge", await pkceChallenge(verifier));
  upstream.searchParams.set("code_challenge_method", "S256");
  return redirect(upstream.toString());
}

async function handleCallback(
  url: URL,
  config: Config,
  store: Store,
): Promise<Response> {
  const state = url.searchParams.get("state") ?? "";
  const flow = state ? await store.findByState(state) : null;
  if (!flow || flow.proxyCode || Date.parse(flow.expiresAt) < Date.now()) {
    return oauthError(
      "invalid_request",
      "Der Anmeldevorgang ist ungültig oder abgelaufen.",
    );
  }
  const back = new URL(flow.clientRedirectUri);
  if (flow.clientState) back.searchParams.set("state", flow.clientState);
  const upstreamError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (upstreamError || !code) {
    back.searchParams.set(
      "error",
      upstreamError === "access_denied" ? "access_denied" : "server_error",
    );
    return redirect(back.toString());
  }

  const response = await upstreamToken(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(config),
    code_verifier: flow.verifier,
  }).catch(() => null);
  const tokens: unknown = response
    ? await response.json().catch(() => null)
    : null;
  if (
    !response?.ok ||
    !isRecord(tokens) ||
    typeof tokens.access_token !== "string"
  ) {
    back.searchParams.set("error", "server_error");
    return redirect(back.toString());
  }

  const proxyCode = randomToken(32);
  const stored = await store.attachCode(
    state,
    proxyCode,
    await encryptJson(publicTokens(tokens), config.encKey),
    new Date(Date.now() + CODE_TTL_MS).toISOString(),
  );
  if (!stored) {
    back.searchParams.set("error", "server_error");
    return redirect(back.toString());
  }
  back.searchParams.set("code", proxyCode);
  return redirect(back.toString());
}

async function handleToken(
  request: Request,
  config: Config,
  store: Store,
): Promise<Response> {
  const form = new URLSearchParams(await request.text());
  if (!(await authenticateClient(request, form, config))) {
    return respond(
      { error: "invalid_client", error_description: "Ungültige Zugangsdaten." },
      401,
      { "WWW-Authenticate": 'Basic realm="nextdesk-oauth-proxy"' },
    );
  }
  const grant = form.get("grant_type");

  if (grant === "authorization_code") {
    const code = form.get("code") ?? "";
    const flow = code ? await store.consumeCode(code) : null;
    if (
      !flow ||
      !flow.tokensEncrypted ||
      (flow.codeExpiresAt !== null &&
        Date.parse(flow.codeExpiresAt) < Date.now()) ||
      form.get("redirect_uri") !== flow.clientRedirectUri
    ) {
      return oauthError(
        "invalid_grant",
        "Der Code ist ungültig oder abgelaufen.",
      );
    }
    try {
      return respond(await decryptJson(flow.tokensEncrypted, config.encKey));
    } catch {
      return oauthError(
        "server_error",
        "Die Token konnten nicht gelesen werden.",
        500,
      );
    }
  }

  if (grant === "refresh_token") {
    const refreshToken = form.get("refresh_token") ?? "";
    if (!refreshToken)
      return oauthError("invalid_request", "refresh_token fehlt.");
    const response = await upstreamToken(config, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).catch(() => null);
    const tokens: unknown = response
      ? await response.json().catch(() => null)
      : null;
    if (!response?.ok || !isRecord(tokens)) {
      return oauthError("invalid_grant", "Das Refresh-Token ist ungültig.");
    }
    return respond(publicTokens(tokens));
  }
  return oauthError(
    "unsupported_grant_type",
    "Nicht unterstützter grant_type.",
  );
}

export async function handleRequest(
  request: Request,
  config: Config,
  store: Store,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (request.method === "GET" && path.endsWith("/authorize")) {
    return await handleAuthorize(url, config, store);
  }
  if (request.method === "GET" && path.endsWith("/callback")) {
    return await handleCallback(url, config, store);
  }
  if (request.method === "POST" && path.endsWith("/token")) {
    return await handleToken(request, config, store);
  }
  return respond({ error: "not_found" }, 404);
}

// ---------------------------------------------------------------- Produktion

function readConfig(): Config | null {
  const get = (name: string) => Deno.env.get(name) ?? "";
  const supabaseUrl = get("SUPABASE_URL").replace(/\/$/, "");
  const config: Config = {
    allowedRedirects: (
      get("OAUTH_PROXY_ALLOWED_REDIRECTS") || DEFAULT_REDIRECTS.join(",")
    )
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    clientId: get("OAUTH_PROXY_CLIENT_ID"),
    clientSecret: get("OAUTH_PROXY_CLIENT_SECRET"),
    encKey: get("OAUTH_PROXY_ENC_KEY"),
    supabaseUrl,
    upstreamClientId: get("OAUTH_PROXY_UPSTREAM_CLIENT_ID"),
    upstreamClientSecret: get("OAUTH_PROXY_UPSTREAM_CLIENT_SECRET"),
  };
  const complete =
    supabaseUrl &&
    config.clientId &&
    config.clientSecret.length >= 32 &&
    config.encKey &&
    config.upstreamClientId &&
    config.upstreamClientSecret &&
    config.allowedRedirects.every((entry) => entry.startsWith("https://"));
  return complete ? config : null;
}

function rowToFlow(row: Json): Flow {
  return {
    clientRedirectUri: String(row.client_redirect_uri),
    clientState: typeof row.client_state === "string" ? row.client_state : null,
    codeExpiresAt:
      typeof row.code_expires_at === "string" ? row.code_expires_at : null,
    expiresAt: String(row.expires_at),
    proxyCode: typeof row.proxy_code === "string" ? row.proxy_code : null,
    state: String(row.state),
    tokensEncrypted:
      typeof row.tokens_encrypted === "string" ? row.tokens_encrypted : null,
    verifier: String(row.verifier),
  };
}

function restStore(supabaseUrl: string, serviceKey: string): Store {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const base = `${supabaseUrl}/rest/v1/oauth_proxy_flows`;
  const call = (path: string, init: RequestInit) =>
    fetch(`${base}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  const eq = (value: string) => `eq.${encodeURIComponent(value)}`;
  return {
    async insert(flow) {
      const response = await call("", {
        method: "POST",
        headers,
        body: JSON.stringify({
          state: flow.state,
          client_redirect_uri: flow.clientRedirectUri,
          client_state: flow.clientState,
          verifier: flow.verifier,
          expires_at: flow.expiresAt,
        }),
      });
      if (!response.ok) throw new Error("flow_insert_failed");
    },
    async findByState(state) {
      const response = await call(`?state=${eq(state)}&limit=1`, { headers });
      const rows: unknown = await response.json().catch(() => null);
      return response.ok && Array.isArray(rows) && isRecord(rows[0])
        ? rowToFlow(rows[0])
        : null;
    },
    async attachCode(state, proxyCode, tokensEncrypted, codeExpiresAt) {
      const response = await call(`?state=${eq(state)}&proxy_code=is.null`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({
          proxy_code: proxyCode,
          tokens_encrypted: tokensEncrypted,
          code_expires_at: codeExpiresAt,
        }),
      });
      const rows: unknown = await response.json().catch(() => null);
      return response.ok && Array.isArray(rows) && rows.length === 1;
    },
    async consumeCode(proxyCode) {
      // Atomar: nur ein einziger Aufruf erhält die Zeile.
      const response = await call(
        `?proxy_code=${eq(proxyCode)}&used_at=is.null&code_expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
        {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify({ used_at: new Date().toISOString() }),
        },
      );
      const rows: unknown = await response.json().catch(() => null);
      return response.ok && Array.isArray(rows) && isRecord(rows[0])
        ? rowToFlow(rows[0])
        : null;
    },
    async deleteExpired() {
      const now = encodeURIComponent(new Date().toISOString());
      await call(`?expires_at=lt.${now}`, { method: "DELETE", headers }).catch(
        () => undefined,
      );
    },
  };
}

export default {
  fetch(request: Request): Response | Promise<Response> {
    const config = readConfig();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!config || !serviceKey)
      return respond({ error: "not_configured" }, 503);
    return handleRequest(
      request,
      config,
      restStore(config.supabaseUrl, serviceKey),
    );
  },
};
