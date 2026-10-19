const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const TOKEN_SAFETY_WINDOW_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

type JsonRecord = Record<string, unknown>;
type CachedToken = {
  accessToken: string;
  expiresAt: number;
  overBroadPermissions: boolean;
};

const tokenCache = new Map<string, CachedToken>();

export class ExchangeMailError extends Error {
  constructor(
    readonly code:
      | "exchange_platform_not_configured"
      | "exchange_app_not_consented"
      | "exchange_mailbox_not_found"
      | "exchange_access_denied"
      | "exchange_throttled"
      | "exchange_unavailable",
    readonly status: number,
    readonly retryAfterSeconds?: number,
    readonly graphErrorCode?: string,
    readonly graphRequestId?: string,
  ) {
    super(code);
  }
}

export type ExchangeAccessToken = {
  accessToken: string;
  overBroadPermissions: boolean;
  expiresAt: number;
};

function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configured(): { clientId: string; clientSecret: string } | null {
  const clientId = Deno.env.get("EXCHANGE_MAIL_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("EXCHANGE_MAIL_CLIENT_SECRET")?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function isExchangeMailPlatformConfigured(): boolean {
  return configured() !== null;
}

export function exchangeMailClientId(): string | null {
  return configured()?.clientId ?? null;
}

function base64UrlJson(value: string): JsonRecord | null {
  try {
    const padded = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (item) => item.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const parsed: unknown = JSON.parse(decoded);
    return record(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function tokenHasOverBroadMailRoles(accessToken: string): boolean {
  const payload = accessToken.split(".")[1];
  if (!payload) return true;
  const parsed = base64UrlJson(payload);
  if (!parsed) return true;
  const roles = parsed?.roles;
  // Exchange Application RBAC can issue a valid app-only Graph token without
  // a roles claim. Any declared Graph role, however, must be a well-formed
  // string and none may grant the broad Mail.* application surface.
  if (roles === undefined) return false;
  if (!Array.isArray(roles)) return true;
  return roles.some(
    (role) => typeof role !== "string" || role.startsWith("Mail."),
  );
}

function retryAfter(response: Response): number | undefined {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  if (/^\d{1,8}$/.test(raw)) return Math.max(1, Math.min(Number(raw), 86_400));
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(
    1,
    Math.min(Math.ceil((timestamp - Date.now()) / 1000), 86_400),
  );
}

async function responseText(response: Response): Promise<string> {
  return await response.text().catch(() => "");
}

function safeGraphCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,120}$/.test(value)
    ? value
    : undefined;
}

function safeRequestId(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
    ? value.toLowerCase()
    : undefined;
}

function graphErrorDetails(
  response: Response,
  payloadText: string,
): { code?: string; requestId?: string } {
  try {
    const payload: unknown = JSON.parse(payloadText);
    const error =
      record(payload) && record(payload.error) ? payload.error : null;
    const inner = error && record(error.innerError) ? error.innerError : null;
    return {
      code: safeGraphCode(error?.code),
      requestId:
        safeRequestId(response.headers.get("request-id")) ??
        safeRequestId(inner?.["request-id"]),
    };
  } catch {
    return { requestId: safeRequestId(response.headers.get("request-id")) };
  }
}

function graphErrorFromResponse(
  response: Response,
  payloadText: string,
): ExchangeMailError {
  const lowered = payloadText.toLowerCase();
  const details = graphErrorDetails(response, payloadText);
  if (
    lowered.includes("aadsts700016") ||
    lowered.includes("aadsts7000229") ||
    lowered.includes("application with identifier")
  ) {
    return new ExchangeMailError(
      "exchange_app_not_consented",
      422,
      undefined,
      details.code,
      details.requestId,
    );
  }
  if (
    response.status === 404 ||
    lowered.includes("errorinvaliduser") ||
    lowered.includes("resourcenotfound")
  ) {
    return new ExchangeMailError(
      "exchange_mailbox_not_found",
      422,
      undefined,
      details.code,
      details.requestId,
    );
  }
  if (response.status === 403 || lowered.includes("erroraccessdenied")) {
    return new ExchangeMailError(
      "exchange_access_denied",
      403,
      undefined,
      details.code,
      details.requestId,
    );
  }
  if (response.status === 429) {
    return new ExchangeMailError(
      "exchange_throttled",
      429,
      retryAfter(response),
      details.code,
      details.requestId,
    );
  }
  if (response.status === 503 || response.status >= 500) {
    return new ExchangeMailError(
      "exchange_unavailable",
      503,
      retryAfter(response),
      details.code,
      details.requestId,
    );
  }
  return new ExchangeMailError(
    "exchange_unavailable",
    503,
    undefined,
    details.code,
    details.requestId,
  );
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

export async function getExchangeAccessToken(
  entraTenantId: string,
): Promise<ExchangeAccessToken> {
  const tenantId = entraTenantId.trim().toLowerCase();
  const existing = tokenCache.get(tenantId);
  if (existing && existing.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()) {
    return existing;
  }
  const configuration = configured();
  if (!configuration)
    throw new ExchangeMailError("exchange_platform_not_configured", 503);

  const body = new URLSearchParams({
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await timedFetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  const text = await responseText(response);
  if (!response.ok) throw graphErrorFromResponse(response, text);

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
  const cached: CachedToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
    overBroadPermissions: tokenHasOverBroadMailRoles(payload.access_token),
  };
  tokenCache.set(tenantId, cached);
  return cached;
}

export async function graphRequest<T = JsonRecord>(
  entraTenantId: string,
  path: string,
  init: RequestInit = {},
): Promise<{
  data: T;
  headers: Headers;
  status: number;
  overBroadPermissions: boolean;
}> {
  const token = await getExchangeAccessToken(entraTenantId);
  const response = await timedFetch(`${GRAPH_ROOT}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token.accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await responseText(response);
  if (!response.ok) throw graphErrorFromResponse(response, text);
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
    overBroadPermissions: token.overBroadPermissions,
  };
}

export function graphMailboxIdentifier(
  mailboxObjectId: string | null | undefined,
  mailboxAddress: string,
): string {
  return encodeURIComponent(mailboxObjectId?.trim() || mailboxAddress.trim());
}

export async function graphDeleteSubscription(
  entraTenantId: string,
  subscriptionId: string,
): Promise<void> {
  try {
    await graphRequest(
      entraTenantId,
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: "DELETE",
      },
    );
  } catch (error) {
    if (
      error instanceof ExchangeMailError &&
      error.code === "exchange_mailbox_not_found"
    )
      return;
    throw error;
  }
}

export async function graphCreateSubscription(
  entraTenantId: string,
  input: {
    mailboxIdentifier: string;
    notificationUrl: string;
    lifecycleNotificationUrl: string;
    clientState: string;
    expirationDateTime: string;
  },
): Promise<{ id: string; resource: string; expirationDateTime: string }> {
  const resource = `/users/${input.mailboxIdentifier}/mailFolders('inbox')/messages`;
  const { data } = await graphRequest<JsonRecord>(
    entraTenantId,
    "/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        changeType: "created",
        notificationUrl: input.notificationUrl,
        lifecycleNotificationUrl: input.lifecycleNotificationUrl,
        resource,
        expirationDateTime: input.expirationDateTime,
        clientState: input.clientState,
      }),
    },
  );
  if (
    typeof data.id !== "string" ||
    typeof data.resource !== "string" ||
    typeof data.expirationDateTime !== "string"
  ) {
    throw new ExchangeMailError("exchange_unavailable", 503);
  }
  return {
    id: data.id,
    resource: data.resource,
    expirationDateTime: data.expirationDateTime,
  };
}

export async function graphRenewSubscription(
  entraTenantId: string,
  subscriptionId: string,
  expirationDateTime: string,
): Promise<{ expirationDateTime: string }> {
  const { data } = await graphRequest<JsonRecord>(
    entraTenantId,
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: "PATCH", body: JSON.stringify({ expirationDateTime }) },
  );
  if (typeof data.expirationDateTime !== "string")
    throw new ExchangeMailError("exchange_unavailable", 503);
  return { expirationDateTime: data.expirationDateTime };
}
