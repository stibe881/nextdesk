// IPAM-Integrationen, gemeinsam für ipam-sync (Benutzeraktionen) und
// ipam-api (REST-API und Cron):
//  * Intune-Geräte mit MAC-Adressen aus Microsoft Graph lesen und speichern
//  * Webhooks signieren (HMAC-SHA256) und zustellen
//  * API-Schlüssel und Webhook-Geheimnisse erzeugen

import {
  type FetchLike,
  IntuneGraphError,
  readIntuneGraphCredentials,
  requestIntuneGraphAccessToken,
} from "./intune-managed-devices-graph.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const GRAPH_PATH = "/v1.0/deviceManagement/managedDevices";
const GRAPH_SELECT = [
  "id",
  "deviceName",
  "wiFiMacAddress",
  "ethernetMacAddress",
  "userPrincipalName",
  "managementState",
  "lastSyncDateTime",
].join(",");
const GRAPH_MAX_PAGES = 200;
const GRAPH_TIMEOUT_MS = 15_000;

export const WEBHOOK_EVENTS = [
  "address.reserved",
  "address.released",
  "address.updated",
  "prefix.created",
  "finding.opened",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const API_SCOPES = ["read", "write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

const isRecord = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------- Intune

export type IntuneMacDevice = {
  id: string;
  device_name: string | null;
  wifi_mac: string | null;
  ethernet_mac: string | null;
  user_principal_name: string | null;
  management_state: string | null;
  last_sync_at: string | null;
};

/** «AABBCCDDEEFF», «aa-bb-…», «aa:bb:…» → «aa:bb:cc:dd:ee:ff» oder null. */
export function normalizeMac(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.replace(/[\s:.-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  if (hex === "000000000000" || hex === "ffffffffffff") return null;
  return hex.match(/.{2}/g)!.join(":");
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return Array.from(trimmed).slice(0, max).join("");
}

export function parseIntuneMacDevice(value: unknown): IntuneMacDevice | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 200);
  if (!id) return null;
  const synced =
    typeof value.lastSyncDateTime === "string" &&
    Number.isFinite(Date.parse(value.lastSyncDateTime))
      ? new Date(Date.parse(value.lastSyncDateTime)).toISOString()
      : null;
  return {
    id: id.toLowerCase(),
    device_name: text(value.deviceName, 240),
    wifi_mac: normalizeMac(value.wiFiMacAddress),
    ethernet_mac: normalizeMac(value.ethernetMacAddress),
    user_principal_name: text(value.userPrincipalName, 320),
    management_state: text(value.managementState, 40),
    last_sync_at: synced,
  };
}

function nextGraphUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.origin === GRAPH_ORIGIN &&
      url.pathname === GRAPH_PATH
      ? url
      : null;
  } catch {
    return null;
  }
}

/** Liest alle verwalteten Geräte mit MAC-Adressen (Client-Credentials). */
export async function fetchIntuneMacDevices(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<IntuneMacDevice[]> {
  const devices: IntuneMacDevice[] = [];
  let url: URL | null = new URL(`${GRAPH_ORIGIN}${GRAPH_PATH}`);
  url.searchParams.set("$select", GRAPH_SELECT);
  url.searchParams.set("$top", "500");
  for (let page = 0; url && page < GRAPH_MAX_PAGES; page += 1) {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    }).catch(() => {
      throw new IntuneGraphError("provider_unavailable");
    });
    if (response.status === 429)
      throw new IntuneGraphError("provider_rate_limited");
    if (!response.ok) throw new IntuneGraphError("provider_unavailable");
    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload) || !Array.isArray(payload.value)) {
      throw new IntuneGraphError("provider_payload_invalid");
    }
    for (const entry of payload.value) {
      const device = parseIntuneMacDevice(entry);
      if (device) devices.push(device);
    }
    url = nextGraphUrl(payload["@odata.nextLink"]);
  }
  return devices;
}

export type IntuneRefreshResult =
  | { status: "ok"; devices: number }
  | { status: "not_configured" | "failed"; code: string };

/**
 * Holt die Intune-Geräte des Mandanten (wenn die Intune-Anbindung aktiv und
 * die Server-Zugangsdaten gesetzt sind) und speichert sie für den Abgleich.
 */
export async function refreshIntuneDevices(
  admin: Admin,
  tenantId: string,
  actorId: string | null,
  trigger: "manual" | "cron",
  fetchImpl: FetchLike = fetch,
): Promise<IntuneRefreshResult> {
  const { data: connection, error } = await admin
    .from("asset_intune_connections")
    .select("enabled, directory_tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return { status: "failed", code: "database_error" };
  if (
    !connection?.enabled ||
    typeof connection.directory_tenant_id !== "string"
  ) {
    return { status: "not_configured", code: "intune_not_connected" };
  }
  const credentials = readIntuneGraphCredentials();
  if (!credentials)
    return { status: "not_configured", code: "provider_not_configured" };

  const run = await admin
    .from("ipam_sync_runs")
    .insert({
      tenant_id: tenantId,
      source: "intune_graph",
      trigger_kind: trigger,
      started_by: actorId,
    })
    .select("id")
    .single();
  const runId = run.data?.id as string | undefined;
  const finish = async (
    status: "succeeded" | "failed",
    summary: Row,
    code: string | null,
  ) => {
    if (!runId) return;
    await admin
      .from("ipam_sync_runs")
      .update({
        status,
        summary,
        error_code: code,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
  };
  try {
    const token = await requestIntuneGraphAccessToken(
      connection.directory_tenant_id,
      credentials,
      fetchImpl,
    );
    const devices = await fetchIntuneMacDevices(token, fetchImpl);
    const stored = await admin.rpc("ipam_intune_store", {
      p_tenant_id: tenantId,
      p_devices: devices,
    });
    if (stored.error) {
      await finish("failed", {}, "database_error");
      return { status: "failed", code: "database_error" };
    }
    await finish("succeeded", { devices: devices.length }, null);
    return { status: "ok", devices: devices.length };
  } catch (cause) {
    const code =
      cause instanceof IntuneGraphError ? cause.code : "provider_unavailable";
    await finish("failed", {}, code);
    return { status: "failed", code };
  }
}

// ---------------------------------------------------------------- Schlüssel

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomToken(bytes: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const API_KEY_PATTERN = /^ndk_ipam_[A-Za-z0-9_-]{32}$/;

/** Neuer API-Schlüssel: nur einmal anzeigen, gespeichert wird der Hash. */
export async function generateApiKey(): Promise<{
  key: string;
  prefix: string;
  hash: string;
}> {
  const key = `ndk_ipam_${randomToken(24)}`;
  return { key, prefix: key.slice(0, 17), hash: await sha256Hex(key) };
}

export function generateWebhookSecret(): string {
  return `whsec_${randomToken(32)}`;
}

// ---------------------------------------------------------------- Webhooks

/** Signatur-Header: «t=<unix>,v1=<hex HMAC-SHA256 von "<t>.<body>">». */
export async function signWebhook(
  secret: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${hex}`;
}

function privateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** Nur öffentliche HTTPS-Ziele (kein localhost, keine internen IPs). */
export function isSafeWebhookUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 12 || value.length > 500)
    return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (!host.includes(".") && !host.includes(":"))
  ) {
    return false;
  }
  if (host.includes(":")) {
    // IPv6-Literal: nur globale Adressen (2000::/3).
    return /^[23][0-9a-f]{0,3}:/.test(host);
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return !privateIpv4(host);
  return true;
}

export type OutboxDelivery = {
  id: number | string;
  event: string;
  payload: Row;
  url: string;
  secret: string;
};

export type DeliveryResult = {
  ok: boolean;
  status: number | null;
  error: string | null;
};

export async function deliverWebhook(
  delivery: OutboxDelivery,
  fetchImpl: FetchLike = fetch,
  now: () => number = () => Date.now(),
): Promise<DeliveryResult> {
  if (!isSafeWebhookUrl(delivery.url)) {
    return { ok: false, status: null, error: "Ziel-URL nicht zulässig" };
  }
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(now() / 1000);
  try {
    const response = await fetchImpl(delivery.url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "nextDesk-IPAM-Webhook/1.0",
        "X-NextDesk-Event": delivery.event,
        "X-NextDesk-Delivery": String(delivery.id),
        "X-NextDesk-Signature": await signWebhook(
          delivery.secret,
          timestamp,
          body,
        ),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel().catch(() => undefined);
    const ok = response.status >= 200 && response.status < 300;
    return {
      ok,
      status: response.status,
      error: ok ? null : `HTTP ${response.status}`,
    };
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "";
    return {
      ok: false,
      status: null,
      error:
        name === "TimeoutError"
          ? "Zeitüberschreitung"
          : "Verbindung fehlgeschlagen",
    };
  }
}

/** Holt fällige Zustellungen aus der Outbox und stellt sie zu. */
export async function deliverDueWebhooks(
  admin: Admin,
  fetchImpl: FetchLike = fetch,
  limit = 50,
): Promise<{ delivered: number; failed: number }> {
  const { data, error } = await admin.rpc("ipam_webhook_claim", {
    p_limit: limit,
  });
  if (error || !Array.isArray(data)) return { delivered: 0, failed: 0 };
  let delivered = 0;
  let failed = 0;
  const rows = (data as Row[]).filter(
    (row) =>
      typeof row.url === "string" &&
      typeof row.secret === "string" &&
      isRecord(row.payload),
  );
  for (let index = 0; index < rows.length; index += 5) {
    await Promise.all(
      rows.slice(index, index + 5).map(async (row) => {
        const result = await deliverWebhook(
          {
            id: row.id as number,
            event: String(row.event),
            payload: row.payload as Row,
            url: row.url as string,
            secret: row.secret as string,
          },
          fetchImpl,
        );
        if (result.ok) delivered += 1;
        else failed += 1;
        await admin.rpc("ipam_webhook_complete", {
          p_id: row.id,
          p_ok: result.ok,
          p_status: result.status,
          p_error: result.error,
        });
      }),
    );
  }
  return { delivered, failed };
}
