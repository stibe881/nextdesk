// Verwaltung der IPAM-REST-API (Funktion ipam-sync: apiSettings …):
// Antworten prüfen und Texte aufbereiten.

type Row = Record<string, unknown>;

export const IPAM_WEBHOOK_EVENTS = [
  { key: "address.reserved", label: "Adresse reserviert" },
  { key: "address.released", label: "Adresse freigegeben" },
  { key: "address.updated", label: "Adresse geändert" },
  { key: "prefix.created", label: "Subnetz angelegt" },
  { key: "finding.opened", label: "Neuer Fund" },
] as const;

export type IpamWebhookEvent = (typeof IPAM_WEBHOOK_EVENTS)[number]["key"];

export type IpamApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: ("read" | "write")[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type IpamWebhook = {
  id: string;
  name: string;
  url: string;
  events: IpamWebhookEvent[];
  active: boolean;
  lastStatus: number | null;
  lastError: string | null;
  lastDeliveryAt: string | null;
};

export type IpamDelivery = {
  id: number;
  webhookId: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
};

export type IpamApiSettingsData = {
  keys: IpamApiKey[];
  webhooks: IpamWebhook[];
  deliveries: IpamDelivery[];
};

function asRecord(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Row)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((row): row is Row => row !== null)
    : [];
}

const EVENT_KEYS = new Set<string>(
  IPAM_WEBHOOK_EVENTS.map((event) => event.key),
);

export function parseIpamApiSettings(
  value: unknown,
): IpamApiSettingsData | null {
  const data = asRecord(value);
  if (!data || !Array.isArray(data.keys) || !Array.isArray(data.webhooks)) {
    return null;
  }
  return {
    keys: rows(data.keys).flatMap((row) => {
      const id = str(row.id);
      const name = str(row.name);
      const prefix = str(row.key_prefix);
      const createdAt = str(row.created_at);
      if (!id || !name || !prefix || !createdAt) return [];
      const scopes = Array.isArray(row.scopes)
        ? row.scopes.filter(
            (scope): scope is "read" | "write" =>
              scope === "read" || scope === "write",
          )
        : [];
      return [
        {
          id,
          name,
          prefix,
          scopes,
          createdAt,
          lastUsedAt: str(row.last_used_at),
          revokedAt: str(row.revoked_at),
        },
      ];
    }),
    webhooks: rows(data.webhooks).flatMap((row) => {
      const id = str(row.id);
      const name = str(row.name);
      const url = str(row.url);
      if (!id || !name || !url) return [];
      return [
        {
          id,
          name,
          url,
          events: Array.isArray(row.events)
            ? row.events.filter((event): event is IpamWebhookEvent =>
                EVENT_KEYS.has(String(event)),
              )
            : [],
          active: row.active === true,
          lastStatus: num(row.last_status),
          lastError: str(row.last_error),
          lastDeliveryAt: str(row.last_delivery_at),
        },
      ];
    }),
    deliveries: rows(data.deliveries).flatMap((row) => {
      const id = num(row.id);
      const webhookId = str(row.webhook_id);
      const status = row.status;
      const createdAt = str(row.created_at);
      if (
        id === null ||
        !webhookId ||
        !createdAt ||
        (status !== "pending" && status !== "delivered" && status !== "failed")
      ) {
        return [];
      }
      return [
        {
          id,
          webhookId,
          event: str(row.event) ?? "",
          status,
          attempts: num(row.attempts) ?? 0,
          lastStatus: num(row.last_status),
          lastError: str(row.last_error),
          createdAt,
        },
      ];
    }),
  };
}

export function webhookEventLabel(event: string): string {
  return (
    IPAM_WEBHOOK_EVENTS.find((entry) => entry.key === event)?.label ??
    (event === "ping" ? "Test" : event)
  );
}

export function deliveryStatusLabel(delivery: IpamDelivery): string {
  if (delivery.status === "delivered") return "Zugestellt";
  if (delivery.status === "failed") return "Fehlgeschlagen";
  return delivery.attempts > 0
    ? `Wird wiederholt (${delivery.attempts}. Versuch)`
    : "Ausstehend";
}

export function webhookStatusLabel(webhook: IpamWebhook): string {
  if (!webhook.active) return "Pausiert";
  if (webhook.lastStatus === null && !webhook.lastError)
    return "Noch nicht zugestellt";
  if (
    webhook.lastStatus !== null &&
    webhook.lastStatus >= 200 &&
    webhook.lastStatus < 300
  ) {
    return `OK (HTTP ${webhook.lastStatus})`;
  }
  return webhook.lastError ?? `HTTP ${webhook.lastStatus}`;
}

/** Nur öffentliche HTTPS-Adressen (die Prüfung wiederholt der Server). */
export function webhookUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "Bitte eine vollständige Adresse mit https:// angeben.";
  }
  if (url.protocol !== "https:") return "Nur HTTPS-Adressen sind erlaubt.";
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(10|127)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return "Interne Adressen sind nicht erlaubt.";
  }
  return null;
}

export function ipamApiBaseUrl(supabaseUrl: string | undefined): string {
  return supabaseUrl
    ? `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/ipam-api`
    : "/functions/v1/ipam-api";
}
