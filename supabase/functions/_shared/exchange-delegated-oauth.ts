import { ExchangeMailError } from "./exchange-graph.ts";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const TOKEN_SAFETY_WINDOW_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const CALLBACK_URL =
  "https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/exchange-mail-connect";
const REQUIRED_SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Mail.Send",
  "Mail.Read.Shared",
  "Mail.Send.Shared",
] as const;

type Row = Record<string, unknown>;
type CachedToken = { accessToken: string; expiresAt: number };
type SigningKey = JsonWebKey & { kid?: string };
type JsonWebKeySet = { keys?: SigningKey[] };

export type DelegatedConnection = {
  id: string;
  tenant_id: string;
  entra_tenant_id: string;
  connector_object_id: string;
  connector_principal: string;
  status: "connected" | "reauthorization_required" | "disconnected";
};

export type DelegatedIdentity = {
  entraTenantId: string;
  connectorObjectId: string;
  connectorPrincipal: string;
  grantedScopes: string[];
};

const tokenCache = new Map<string, CachedToken>();
const jwksCache = new Map<string, { expiresAt: number; keys: SigningKey[] }>();

function record(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64Url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function bytesFromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (item) => item.charCodeAt(0));
  } catch {
    return null;
  }
}

function bytesFromBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    return Uint8Array.from(atob(value), (item) => item.charCodeAt(0));
  } catch {
    return null;
  }
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}

function jsonFromBase64Url(value: string): Row | null {
  const bytes = bytesFromBase64Url(value);
  if (!bytes) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return record(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function email(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : null;
}

function platformConfiguration(): {
  clientId: string;
  clientSecret: string;
  tokenKey: Uint8Array;
} | null {
  const clientId = Deno.env.get("EXCHANGE_MAIL_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("EXCHANGE_MAIL_CLIENT_SECRET")?.trim();
  const tokenKey = bytesFromBase64(
    Deno.env.get("EXCHANGE_MAIL_TOKEN_ENCRYPTION_KEY")?.trim() ?? "",
  );
  return clientId && clientSecret && tokenKey?.byteLength === 32
    ? { clientId, clientSecret, tokenKey }
    : null;
}

export function isDelegatedExchangeMailConfigured(): boolean {
  return platformConfiguration() !== null;
}

export function delegatedExchangeClientId(): string | null {
  return platformConfiguration()?.clientId ?? null;
}

export function delegatedExchangeCallbackUrl(): string {
  return CALLBACK_URL;
}

export function delegatedExchangeScopes(): readonly string[] {
  return REQUIRED_SCOPES;
}

export function randomUrlSafe(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(value: string): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  return base64Url(bytes);
}

function retryAfter(response: Response): number | undefined {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  if (/^\d{1,8}$/.test(raw)) return Math.max(1, Math.min(Number(raw), 86_400));
  const date = Date.parse(raw);
  return Number.isFinite(date)
    ? Math.max(1, Math.min(Math.ceil((date - Date.now()) / 1000), 86_400))
    : undefined;
}

async function timedFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch {
    throw new ExchangeMailError("exchange_unavailable", 503);
  } finally {
    clearTimeout(timeout);
  }
}

function graphError(response: Response, text: string): ExchangeMailError {
  let code: string | undefined;
  let requestId: string | undefined;
  try {
    const payload: unknown = JSON.parse(text);
    const error =
      record(payload) && record(payload.error) ? payload.error : null;
    code =
      typeof error?.code === "string" ? error.code.slice(0, 120) : undefined;
    const inner = error && record(error.innerError) ? error.innerError : null;
    requestId =
      typeof inner?.["request-id"] === "string"
        ? inner["request-id"].slice(0, 120)
        : undefined;
  } catch {
    // Error details stay intentionally minimal and do not include provider text.
  }
  if (response.status === 404)
    return new ExchangeMailError(
      "exchange_mailbox_not_found",
      422,
      undefined,
      code,
      requestId,
    );
  if (response.status === 403)
    return new ExchangeMailError(
      "exchange_access_denied",
      403,
      undefined,
      code,
      requestId,
    );
  if (response.status === 429)
    return new ExchangeMailError(
      "exchange_throttled",
      429,
      retryAfter(response),
      code,
      requestId,
    );
  return new ExchangeMailError(
    "exchange_unavailable",
    503,
    retryAfter(response),
    code,
    requestId,
  );
}

async function encryptionKey(): Promise<CryptoKey> {
  const configuration = platformConfiguration();
  if (!configuration)
    throw new ExchangeMailError("exchange_platform_not_configured", 503);
  return await crypto.subtle.importKey(
    "raw",
    arrayBuffer(configuration.tokenKey),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptRefreshToken(value: string): Promise<string> {
  if (value.length < 16 || value.length > 12_000)
    throw new ExchangeMailError("exchange_unavailable", 503);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await encryptionKey(),
      new TextEncoder().encode(value),
    ),
  );
  const packed = new Uint8Array(iv.byteLength + encrypted.byteLength);
  packed.set(iv);
  packed.set(encrypted, iv.byteLength);
  return base64Url(packed);
}

export async function decryptRefreshToken(value: string): Promise<string> {
  const packed = bytesFromBase64Url(value);
  if (!packed || packed.byteLength < 29)
    throw new ExchangeMailError("exchange_reauthorization_required", 422);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: packed.slice(0, 12) },
      await encryptionKey(),
      packed.slice(12),
    );
    const token = new TextDecoder().decode(plaintext);
    if (token.length < 16 || token.length > 12_000)
      throw new Error("refresh_token_invalid");
    return token;
  } catch (error) {
    if (error instanceof ExchangeMailError) throw error;
    throw new ExchangeMailError("exchange_reauthorization_required", 422);
  }
}

function tokenPayload(value: string): Row | null {
  const payload = value.split(".")[1];
  return payload ? jsonFromBase64Url(payload) : null;
}

async function updateReauthorizationRequired(
  admin: any,
  connection: DelegatedConnection,
): Promise<void> {
  tokenCache.delete(connection.id);
  await admin
    .from("exchange_mail_connections")
    .update({
      status: "reauthorization_required",
      last_error_code: "exchange_reauthorization_required",
      last_error_message: "Microsoft 365 verlangt eine erneute Anmeldung.",
    })
    .eq("id", connection.id)
    .eq("tenant_id", connection.tenant_id)
    .eq("status", "connected");
}

function isInvalidGrant(response: Response, text: string): boolean {
  return (
    response.status === 400 &&
    (text.toLowerCase().includes("invalid_grant") ||
      text.toLowerCase().includes("interaction_required"))
  );
}

async function refreshConnectionToken(
  admin: any,
  connection: DelegatedConnection,
): Promise<CachedToken> {
  if (connection.status !== "connected")
    throw new ExchangeMailError("exchange_reauthorization_required", 422);
  const configuration = platformConfiguration();
  if (!configuration)
    throw new ExchangeMailError("exchange_platform_not_configured", 503);
  const credentials = await admin
    .schema("mail_private")
    .from("exchange_mail_connection_credentials")
    .select("refresh_token_ciphertext")
    .eq("connection_id", connection.id)
    .eq("tenant_id", connection.tenant_id)
    .maybeSingle();
  if (
    credentials.error ||
    typeof credentials.data?.refresh_token_ciphertext !== "string"
  ) {
    await updateReauthorizationRequired(admin, connection);
    throw new ExchangeMailError("exchange_reauthorization_required", 422);
  }
  const refreshToken = await decryptRefreshToken(
    credentials.data.refresh_token_ciphertext,
  );
  const response = await timedFetch(
    `https://login.microsoftonline.com/${encodeURIComponent(connection.entra_tenant_id)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: REQUIRED_SCOPES.join(" "),
      }),
    },
  );
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    if (isInvalidGrant(response, text)) {
      await updateReauthorizationRequired(admin, connection);
      throw new ExchangeMailError("exchange_reauthorization_required", 422);
    }
    throw graphError(response, text);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ExchangeMailError("exchange_unavailable", 503);
  }
  if (
    !record(payload) ||
    typeof payload.access_token !== "string" ||
    typeof payload.expires_in !== "number" ||
    payload.expires_in < 60
  ) {
    throw new ExchangeMailError("exchange_unavailable", 503);
  }
  if (typeof payload.refresh_token === "string") {
    const ciphertext = await encryptRefreshToken(payload.refresh_token);
    const stored = await admin
      .schema("mail_private")
      .from("exchange_mail_connection_credentials")
      .update({
        refresh_token_ciphertext: ciphertext,
        updated_at: new Date().toISOString(),
      })
      .eq("connection_id", connection.id)
      .eq("tenant_id", connection.tenant_id);
    if (stored.error) throw new ExchangeMailError("exchange_unavailable", 503);
  }
  const token = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
  tokenCache.set(connection.id, token);
  return token;
}

export async function delegatedGraphRequest<T = Row>(
  admin: any,
  connection: DelegatedConnection,
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; headers: Headers; status: number }> {
  if (!path.startsWith("/"))
    throw new ExchangeMailError("exchange_unavailable", 503);
  const cached = tokenCache.get(connection.id);
  const token =
    cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()
      ? cached
      : await refreshConnectionToken(admin, connection);
  const response = await timedFetch(`${GRAPH_ROOT}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token.accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) throw graphError(response, text);
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ExchangeMailError("exchange_unavailable", 503);
    }
  }
  return {
    data: data as T,
    headers: response.headers,
    status: response.status,
  };
}

async function microsoftSigningKey(
  tenantId: string,
  kid: string,
): Promise<SigningKey> {
  const cached = jwksCache.get(tenantId);
  const now = Date.now();
  const cachedMatch = cached?.keys.find((key) => key.kid === kid);
  if (cached && cachedMatch && cached.expiresAt > now) return cachedMatch;
  const response = await timedFetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/discovery/v2.0/keys`,
    { headers: { Accept: "application/json" } },
  );
  const body = await response.text().catch(() => "");
  if (!response.ok) throw new ExchangeMailError("exchange_unavailable", 503);
  let payload: JsonWebKeySet;
  try {
    payload = JSON.parse(body) as JsonWebKeySet;
  } catch {
    throw new ExchangeMailError("exchange_unavailable", 503);
  }
  const keys: SigningKey[] = Array.isArray(payload.keys) ? payload.keys : [];
  jwksCache.set(tenantId, { keys, expiresAt: now + 6 * 60 * 60_000 });
  const matching = keys.find((key) => key.kid === kid);
  if (!matching) throw new ExchangeMailError("exchange_unavailable", 503);
  return matching;
}

export async function validateMicrosoftIdToken(
  idToken: string,
  expectedNonceHash: string,
): Promise<{
  entraTenantId: string;
  connectorObjectId: string;
}> {
  const parts = idToken.split(".");
  if (parts.length !== 3)
    throw new ExchangeMailError("exchange_unavailable", 503);
  const header = jsonFromBase64Url(parts[0]);
  const payload = jsonFromBase64Url(parts[1]);
  const signature = bytesFromBase64Url(parts[2]);
  if (
    !header ||
    !payload ||
    !signature ||
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    !isUuid(payload.tid) ||
    !isUuid(payload.oid) ||
    typeof payload.aud !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new ExchangeMailError("exchange_unavailable", 503);
  }
  const configuration = platformConfiguration();
  if (!configuration || payload.aud !== configuration.clientId)
    throw new ExchangeMailError("exchange_platform_not_configured", 503);
  if (payload.exp * 1000 < Date.now() - 60_000)
    throw new ExchangeMailError("exchange_unavailable", 503);
  if ((await sha256Hex(payload.nonce)) !== expectedNonceHash)
    throw new ExchangeMailError("exchange_unavailable", 503);
  const tenantId = payload.tid.toLowerCase();
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  if (payload.iss !== issuer)
    throw new ExchangeMailError("exchange_unavailable", 503);
  const key = await microsoftSigningKey(tenantId, header.kid);
  const imported = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    imported,
    arrayBuffer(signature),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new ExchangeMailError("exchange_unavailable", 503);
  return {
    entraTenantId: tenantId,
    connectorObjectId: payload.oid.toLowerCase(),
  };
}

export async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  idToken: string;
  scopes: string[];
}> {
  const configuration = platformConfiguration();
  if (!configuration)
    throw new ExchangeMailError("exchange_platform_not_configured", 503);
  const response = await timedFetch(
    "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: CALLBACK_URL,
        code_verifier: verifier,
        scope: REQUIRED_SCOPES.join(" "),
      }),
    },
  );
  const text = await response.text().catch(() => "");
  if (!response.ok) throw graphError(response, text);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ExchangeMailError("exchange_unavailable", 503);
  }
  if (
    !record(payload) ||
    typeof payload.access_token !== "string" ||
    typeof payload.refresh_token !== "string" ||
    typeof payload.id_token !== "string" ||
    typeof payload.scope !== "string"
  ) {
    throw new ExchangeMailError("exchange_unavailable", 503);
  }
  const scopes = payload.scope.split(/\s+/).filter(Boolean);
  const granted = new Set(scopes.map((scope) => scope.toLowerCase()));
  if (
    ![
      "mail.read",
      "mail.send",
      "mail.read.shared",
      "mail.send.shared",
      "offline_access",
    ].every((scope) => granted.has(scope))
  ) {
    throw new ExchangeMailError("exchange_access_denied", 403);
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    idToken: payload.id_token,
    scopes,
  };
}

export async function graphIdentityFromAccessToken(
  accessToken: string,
): Promise<{ id: string; principal: string }> {
  const response = await timedFetch(
    `${GRAPH_ROOT}/me?$select=id,userPrincipalName,mail`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const text = await response.text().catch(() => "");
  if (!response.ok) throw graphError(response, text);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ExchangeMailError("exchange_unavailable", 503);
  }
  if (!record(payload) || !isUuid(payload.id))
    throw new ExchangeMailError("exchange_unavailable", 503);
  const principal = email(payload.mail) ?? email(payload.userPrincipalName);
  if (!principal) throw new ExchangeMailError("exchange_unavailable", 503);
  return { id: payload.id.toLowerCase(), principal };
}

export async function graphMailboxIdentity(
  admin: any,
  connection: DelegatedConnection,
  identifier: string,
): Promise<{ id: string; address: string }> {
  const response = await delegatedGraphRequest<Row>(
    admin,
    connection,
    `/users/${encodeURIComponent(identifier)}?$select=id,mail,userPrincipalName`,
  );
  const id = isUuid(response.data.id) ? response.data.id.toLowerCase() : null;
  const address =
    email(response.data.mail) ?? email(response.data.userPrincipalName);
  if (!id || !address)
    throw new ExchangeMailError("exchange_mailbox_not_found", 422);
  return { id, address };
}
