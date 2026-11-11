// IPAM-Integrationen, gemeinsam für ipam-sync (Benutzeraktionen) und
// ipam-api (REST-API und Cron):
//  * Intune-Geräte mit MAC-Adressen aus Microsoft Graph lesen und speichern
//    (gemeinsamer Geräteabruf mit dem Asset-Abgleich, siehe
//    _shared/intune-managed-devices-graph.ts)
//  * Webhooks signieren (HMAC-SHA256) und zustellen
//  * API-Schlüssel und Webhook-Geheimnisse erzeugen

import {
  type FetchLike,
  IntuneGraphError,
  type IntuneManagedDevice,
  normalizeMacAddress,
  readIntuneGraphCredentials,
  readIntuneManagedDevices,
  requestIntuneGraphAccessToken,
} from "./intune-managed-devices-graph.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

// Ein geplanter Abruf (Cron) entfällt, wenn der tägliche gemeinsame Abruf
// (intune-scheduled-sync) die Geräte schon geliefert hat.
const SHARED_FETCH_FRESH_HOURS = 20;

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
export const normalizeMac = normalizeMacAddress;

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

/** Gerät aus dem gemeinsamen Abruf → Zeile für ipam_intune_store. */
export function toIntuneMacDevice(
  device: IntuneManagedDevice,
): IntuneMacDevice {
  return {
    id: device.external_device_id,
    device_name: device.device_name,
    wifi_mac: device.network?.wifi_mac ?? null,
    ethernet_mac: device.network?.ethernet_mac ?? null,
    user_principal_name: device.network?.user_principal_name ?? null,
    management_state: device.network?.management_state ?? null,
    last_sync_at: device.last_sync_at,
  };
}

/**
 * Liest alle verwalteten Geräte mit MAC-Adressen (Client-Credentials) über
 * den gemeinsamen Geräteabruf.
 */
export async function fetchIntuneMacDevices(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<IntuneMacDevice[]> {
  const devices: IntuneMacDevice[] = [];
  await readIntuneManagedDevices(
    accessToken,
    async (page) => {
      devices.push(...page.map(toIntuneMacDevice));
    },
    fetchImpl,
    undefined,
    { includeNetwork: true },
  );
  return devices;
}

export type IntuneRefreshResult =
  | { status: "ok"; devices: number }
  | { status: "skipped"; code: "recent_shared_fetch" }
  | { status: "not_configured" | "failed"; code: string };

export type IntuneRefreshOptions = {
  /**
   * Bereits abgerufene Geräte (gemeinsamer Abruf mit dem Asset-Abgleich):
   * dann wird Graph nicht nochmals gefragt.
   */
  devices?: IntuneMacDevice[];
};

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
  options: IntuneRefreshOptions = {},
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
  const prefetched = options.devices ?? null;
  if (!prefetched && trigger === "cron") {
    // Doppelabruf vermeiden: der tägliche gemeinsame Abruf hat geliefert.
    const since = new Date(
      Date.now() - SHARED_FETCH_FRESH_HOURS * 3_600_000,
    ).toISOString();
    const { data: recent } = await admin
      .from("ipam_sync_runs")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("source", "intune_graph")
      .eq("status", "succeeded")
      .gte("started_at", since)
      .limit(1);
    if (Array.isArray(recent) && recent.length > 0) {
      return { status: "skipped", code: "recent_shared_fetch" };
    }
  }
  const credentials = prefetched ? null : readIntuneGraphCredentials();
  if (!prefetched && !credentials)
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
    const devices =
      prefetched ??
      (await fetchIntuneMacDevices(
        await requestIntuneGraphAccessToken(
          connection.directory_tenant_id,
          credentials!,
          fetchImpl,
        ),
        fetchImpl,
      ));
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
