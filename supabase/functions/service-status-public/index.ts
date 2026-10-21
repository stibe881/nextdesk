import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const MAX_SERVICES = 500;
const MAX_EVENTS = 15_000;
const STATUS_VALUES = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
] as const;

type ServiceStatus = (typeof STATUS_VALUES)[number];
type PublicService = {
  name: string;
  status: ServiceStatus;
  updatedAt: string;
  history: Array<{ changedAt: string; status: ServiceStatus }>;
};
type PublicStatusPayload = {
  accentColor: string | null;
  generatedAt: string;
  logoUrl: string | null;
  overallStatus: ServiceStatus;
  services: PublicService[];
  title: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isStatus(value: unknown): value is ServiceStatus {
  return (
    typeof value === "string" && STATUS_VALUES.includes(value as ServiceStatus)
  );
}

function safeText(value: unknown, min: number, max: number): string | null {
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    !value.isWellFormed()
  ) {
    return null;
  }
  const trimmed = value.trim();
  return [...trimmed].length >= min && [...trimmed].length <= max
    ? trimmed
    : null;
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function safeColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim()
    : null;
}

function corsHeaders(request: Request, { badge = false } = {}): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (badge) {
    // The badge is intentionally public and never receives credentials. This
    // permits SharePoint image web parts or their proxy to request the SVG.
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  } else if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  }
  return headers;
}

function json(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (status === 405) headers.set("Allow", "GET, OPTIONS");
  return new Response(JSON.stringify(body), { status, headers });
}

function unavailable(request: Request, status = 404): Response {
  return json(request, { error: { code: "status_page_unavailable" } }, status);
}

function severity(status: ServiceStatus): number {
  return {
    operational: 0,
    maintenance: 1,
    degraded: 2,
    partial_outage: 3,
    major_outage: 4,
  }[status];
}

function overallStatus(services: readonly PublicService[]): ServiceStatus {
  return services.reduce<ServiceStatus>(
    (current, service) =>
      severity(service.status) > severity(current) ? service.status : current,
    "operational",
  );
}

function badgeLabel(status: ServiceStatus): string {
  return {
    operational: "Alle Dienste verfügbar",
    maintenance: "Dienste werden gewartet",
    degraded: "Dienste beeinträchtigt",
    partial_outage: "Teilweiser Dienstausfall",
    major_outage: "Schwerwiegender Ausfall",
  }[status];
}

function badgeColours(status: ServiceStatus): {
  fill: string;
  foreground: string;
} {
  return {
    operational: { fill: "#31a85a", foreground: "#ffffff" },
    maintenance: { fill: "#2563eb", foreground: "#ffffff" },
    degraded: { fill: "#b7791f", foreground: "#ffffff" },
    partial_outage: { fill: "#d97706", foreground: "#ffffff" },
    major_outage: { fill: "#c2412d", foreground: "#ffffff" },
  }[status];
}

function badgeResponse(
  request: Request,
  payload: PublicStatusPayload,
): Response {
  const label = badgeLabel(payload.overallStatus);
  const colours = badgeColours(payload.overallStatus);
  const width = Math.max(235, 92 + label.length * 7);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="48" viewBox="0 0 ${width} 48" role="img" aria-labelledby="title"><title id="title">Systemstatus: ${label}</title><rect width="${width}" height="48" rx="5" fill="#174260"/><rect x="10" y="8" width="${width - 20}" height="32" rx="4" fill="${colours.fill}"/><circle cx="28" cy="24" r="9" fill="${colours.foreground}" opacity=".96"/><path d="m23.5 24 3 3.2 5.5-6" fill="none" stroke="${colours.fill}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><text x="45" y="29" fill="${colours.foreground}" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700">${label}</text></svg>`;
  const headers = corsHeaders(request, { badge: true });
  headers.set("Content-Type", "image/svg+xml; charset=utf-8");
  headers.set(
    "Content-Disposition",
    "inline; filename=nextdesk-systemstatus.svg",
  );
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(svg, { status: 200, headers });
}

function unavailableBadge(request: Request): Response {
  const headers = corsHeaders(request, { badge: true });
  headers.set("Content-Type", "image/svg+xml; charset=utf-8");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="245" height="48" viewBox="0 0 245 48" role="img" aria-label="Systemstatus nicht verfügbar"><rect width="245" height="48" rx="5" fill="#475569"/><text x="16" y="29" fill="#ffffff" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700">Systemstatus nicht verfügbar</text></svg>';
  return new Response(svg, { status: 404, headers });
}

async function readPublicStatus(
  admin: any,
  publicId: string,
): Promise<PublicStatusPayload | null> {
  const pageResult = await admin
    .from("service_status_pages")
    .select("tenant_id, title")
    .eq("public_id", publicId)
    .eq("public_enabled", true)
    .maybeSingle();
  if (pageResult.error) throw new Error("page_lookup_failed");
  const page = pageResult.data;
  const title = safeText(page?.title, 2, 120);
  if (!page || !isUuid(page.tenant_id) || !title) return null;

  const featureStates = await resolveTenantFeatureStates(
    admin,
    page.tenant_id,
    ["assets.management"],
  );
  if (!featureStates) throw new Error("feature_lookup_failed");
  if (featureStates["assets.management"] !== true) return null;

  const cutoff = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
  const [servicesResult, eventsResult, brandingResult] = await Promise.all([
    admin
      .from("services")
      .select("id, name, status, updated_at")
      .eq("tenant_id", page.tenant_id)
      .eq("active", true)
      .eq("status_public", true)
      .order("name")
      .limit(MAX_SERVICES + 1),
    admin
      .from("service_status_events")
      .select("service_id, status, changed_at")
      .eq("tenant_id", page.tenant_id)
      .gte("changed_at", cutoff)
      .order("changed_at", { ascending: true })
      .limit(MAX_EVENTS + 1),
    admin
      .from("tenant_branding")
      .select("logo_path, accent_color")
      .eq("tenant_id", page.tenant_id)
      .maybeSingle(),
  ]);
  if (servicesResult.error || eventsResult.error || brandingResult.error) {
    throw new Error("status_data_failed");
  }
  if ((servicesResult.data?.length ?? 0) > MAX_SERVICES) {
    throw new Error("service_limit_exceeded");
  }
  if ((eventsResult.data?.length ?? 0) > MAX_EVENTS) {
    throw new Error("event_limit_exceeded");
  }

  const serviceRows = (servicesResult.data ?? []).map((service: unknown) => {
    const name = isRecord(service) ? safeText(service.name, 1, 240) : null;
    if (
      !isRecord(service) ||
      !isUuid(service.id) ||
      !name ||
      !isStatus(service.status) ||
      typeof service.updated_at !== "string"
    ) {
      return null;
    }
    return {
      id: service.id,
      name,
      status: service.status,
      updatedAt: service.updated_at,
    };
  });
  if (serviceRows.some((service: unknown) => service === null)) {
    throw new Error("service_data_invalid");
  }
  const services = serviceRows as Array<{
    id: string;
    name: string;
    status: ServiceStatus;
    updatedAt: string;
  }>;
  const serviceIds = new Set(services.map((service) => service.id));
  const baselineResult =
    services.length === 0
      ? { data: [], error: null }
      : await admin.rpc("service_status_history_baselines", {
          p_tenant_id: page.tenant_id,
          p_service_ids: services.map((service) => service.id),
          p_before: cutoff,
        });
  if (baselineResult.error) throw new Error("history_baseline_failed");
  const eventsByService = new Map<
    string,
    Array<{ changedAt: string; status: ServiceStatus }>
  >();
  for (const event of [
    ...(baselineResult.data ?? []),
    ...(eventsResult.data ?? []),
  ]) {
    if (
      !isRecord(event) ||
      !isUuid(event.service_id) ||
      !serviceIds.has(event.service_id) ||
      !isStatus(event.status) ||
      typeof event.changed_at !== "string"
    ) {
      continue;
    }
    const list = eventsByService.get(event.service_id) ?? [];
    list.push({ changedAt: event.changed_at, status: event.status });
    eventsByService.set(event.service_id, list);
  }

  const publicServices: PublicService[] = services.map((service) => ({
    name: service.name,
    status: service.status,
    updatedAt: service.updatedAt,
    history: eventsByService.get(service.id) ?? [],
  }));
  return {
    accentColor: safeColor(brandingResult.data?.accent_color),
    generatedAt: new Date().toISOString(),
    logoUrl: safeHttpsUrl(brandingResult.data?.logo_path),
    overallStatus: overallStatus(publicServices),
    services: publicServices,
    title,
  };
}

const handler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    const url = new URL(request.url);
    const publicId = url.searchParams.get("id");
    const format = url.searchParams.get("format") ?? "page";
    if (!isUuid(publicId) || (format !== "page" && format !== "badge")) {
      return format === "badge"
        ? unavailableBadge(request)
        : unavailable(request);
    }
    try {
      const payload = await readPublicStatus(
        context.supabaseAdmin,
        publicId.toLowerCase(),
      );
      if (!payload) {
        return format === "badge"
          ? unavailableBadge(request)
          : unavailable(request);
      }
      return format === "badge"
        ? badgeResponse(request, payload)
        : json(request, { data: payload });
    } catch {
      return format === "badge"
        ? unavailableBadge(request)
        : unavailable(request, 503);
    }
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    const isBadgeRequest =
      new URL(request.url).searchParams.get("format") === "badge";
    if (origin !== null && origin !== ALLOWED_ORIGIN && !isBadgeRequest) {
      return unavailable(request, 403);
    }
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN && !isBadgeRequest) {
        return unavailable(request, 403);
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, { badge: isBadgeRequest }),
      });
    }
    if (request.method !== "GET") {
      return json(request, { error: { code: "method_not_allowed" } }, 405);
    }
    return handler(request);
  },
};
