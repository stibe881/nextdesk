// External status sources: catalog and parsers for the official status feeds
// of the providers. Pure functions (no I/O), see index.ts for fetching.

export type ExternalIssue = {
  /** Stable id of the issue at the provider (part of the incident key). */
  id: string;
  title: string;
  severity: "down" | "warning";
  url: string | null;
  message: string | null;
  startedAt: string | null;
};

export type SourceKey =
  | "microsoft365"
  | "github"
  | "claude"
  | "gemini"
  | "apple_app_store"
  | "google_play"
  | "init7";

export type SourceDefinition = {
  key: SourceKey;
  label: string;
  description: string;
  statusUrl: string;
  /** Needs a permission in the tenant's Entra app (Microsoft 365). */
  requiresEntra?: boolean;
};

export const SOURCES: readonly SourceDefinition[] = [
  {
    key: "microsoft365",
    label: "Microsoft 365",
    description:
      "Alle Dienste Ihres Mandanten: Teams, Outlook/Exchange, OneDrive, SharePoint und weitere (Dienststatus aus dem Microsoft 365 Admin Center).",
    statusUrl: "https://admin.microsoft.com/#/servicehealth",
    requiresEntra: true,
  },
  {
    key: "github",
    label: "GitHub",
    description: "Offizielle Statusseite von GitHub.",
    statusUrl: "https://www.githubstatus.com",
  },
  {
    key: "claude",
    label: "Claude",
    description: "Offizielle Statusseite von Claude.ai und der Claude-API.",
    statusUrl: "https://status.claude.com",
  },
  {
    key: "gemini",
    label: "Google Gemini",
    description:
      "Gemini in Google Workspace und die Gemini-API (Google Cloud Vertex AI).",
    statusUrl: "https://www.google.com/appsstatus/dashboard/",
  },
  {
    key: "apple_app_store",
    label: "Apple App Store",
    description: "App Store und Mac App Store (Apple Systemstatus).",
    statusUrl: "https://www.apple.com/de/support/systemstatus/",
  },
  {
    key: "google_play",
    label: "Google Play Store",
    description: "Offizielles Status-Dashboard von Google Play.",
    statusUrl: "https://status.play.google.com",
  },
  {
    key: "init7",
    label: "Init7",
    description: "Aktuelle Störungen im Netz von Init7 (ohne geplante Wartungen).",
    statusUrl: "https://www.as13030.net/status.php",
  },
];

export const SOURCE_KEYS = SOURCES.map((source) => source.key);

export function sourceDefinition(key: string): SourceDefinition | null {
  return SOURCES.find((source) => source.key === key) ?? null;
}

type Row = Record<string, unknown>;
const isRecord = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 300): string | null => {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
};
const list = (value: unknown): Row[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

/** Strips markdown and HTML for short messages. */
export function plain(value: unknown, max = 1000): string | null {
  if (typeof value !== "string") return null;
  return text(
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[*_#`]+/g, ""),
    max,
  );
}

/**
 * Atlassian Statuspage (GitHub, Claude): /api/v2/summary.json lists the
 * unresolved incidents.
 */
export function parseStatuspage(value: unknown, statusUrl: string): ExternalIssue[] {
  if (!isRecord(value)) throw new Error("statuspage_invalid");
  return list(value.incidents).flatMap((incident) => {
    const id = text(incident.id, 80);
    const name = text(incident.name);
    const status = String(incident.status ?? "");
    if (!id || !name || status === "resolved" || status === "postmortem") return [];
    const impact = String(incident.impact ?? "");
    const updates = list(incident.incident_updates);
    return [{
      id,
      title: name,
      severity: impact === "major" || impact === "critical" ? "down" : "warning",
      url: text(incident.shortlink, 500) ?? statusUrl,
      message: plain(updates[0]?.body),
      startedAt: text(incident.started_at ?? incident.created_at, 40),
    } satisfies ExternalIssue];
  });
}

/**
 * Google status dashboards (Workspace, Google Cloud, Google Play):
 * incidents.json; an incident without «end» is ongoing. Pure information
 * (SERVICE_INFORMATION) is left out.
 */
export function parseGoogleDashboard(
  value: unknown,
  baseUrl: string,
  productFilter: ((title: string) => boolean) | null,
): ExternalIssue[] {
  if (!Array.isArray(value)) throw new Error("google_dashboard_invalid");
  return list(value).flatMap((incident) => {
    const id = text(incident.id, 80);
    if (!id || incident.end) return [];
    const products = list(incident.affected_products)
      .map((product) => text(product.title, 120))
      .filter((title): title is string => Boolean(title));
    if (productFilter && !products.some(productFilter)) return [];
    const impact = String(incident.status_impact ?? "");
    if (impact === "SERVICE_INFORMATION") return [];
    const latest = isRecord(incident.most_recent_update)
      ? incident.most_recent_update.text
      : null;
    const summary = plain(incident.external_desc, 400)?.replace(/^Summary:\s*/i, "") ?? null;
    const product = products.filter((title) => !productFilter || productFilter(title))[0] ??
      products[0] ?? "";
    const headline = (summary ?? "Störung").split(/(?<=[.!?])\s|Description:/)[0]!.trim();
    return [{
      id,
      title: `${product ? `${product}: ` : ""}${headline}`.slice(0, 250),
      severity: impact === "SERVICE_OUTAGE" ? "down" : "warning",
      url: text(incident.uri, 300) ? `${baseUrl.replace(/\/$/, "")}/${String(incident.uri)}` : baseUrl,
      message: plain(latest) ?? summary,
      startedAt: text(incident.begin, 40),
    } satisfies ExternalIssue];
  });
}

/**
 * Apple system status (system_status_*.js, JSON or jsonCallback(...)):
 * ongoing events of the named services. Maintenance counts as warning.
 */
export function parseAppleStatus(
  body: string,
  services: readonly string[],
  statusUrl: string,
): ExternalIssue[] {
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("apple_status_invalid");
  const value = JSON.parse(body.slice(start, end + 1)) as unknown;
  if (!isRecord(value)) throw new Error("apple_status_invalid");
  return list(value.services).flatMap((service) => {
    const name = text(service.serviceName, 120);
    if (!name || !services.includes(name)) return [];
    return list(service.events).flatMap((event) => {
      const status = String(event.eventStatus ?? "").toLowerCase();
      if (status === "resolved" || status === "completed" || status === "cancelled") return [];
      const id = text(event.messageId, 80) ?? `${name}-${String(event.epochStartDate ?? "")}`;
      const type = String(event.statusType ?? "");
      const started = typeof event.epochStartDate === "number"
        ? new Date(event.epochStartDate).toISOString()
        : null;
      return [{
        id,
        title: `${name}: ${type === "Maintenance" ? "Wartung" : type === "Outage" ? "Ausfall" : "Problem"}`,
        severity: type === "Outage" ? "down" : "warning",
        url: statusUrl,
        message: plain(event.message),
        startedAt: started,
      } satisfies ExternalIssue];
    });
  });
}

/**
 * Init7 status page (as13030.net/status.php): the «Current Issues» section
 * lists ongoing outages (planned maintenance follows below and is left out).
 * Titles come from the RSS feed when it names the same ticket.
 */
export function parseInit7(html: string, rss: string | null, statusUrl: string): ExternalIssue[] {
  const start = html.search(/Current Issues/i);
  if (start < 0) throw new Error("init7_status_invalid");
  const rest = html.slice(start);
  const stop = rest.search(/Planned Maintenance/i);
  const section = (stop > 0 ? rest.slice(0, stop) : rest).replace(/<[^>]*>/g, " ");
  if (/no outage/i.test(section)) return [];
  const tickets = [...new Set([...section.matchAll(/#?\b(\d{6,10})\b/g)].map((match) => match[1]!))];
  const titles = new Map<string, string>();
  for (const item of (rss ?? "").matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<\/item>/g)) {
    const raw = item[1] ?? "";
    const ticket = raw.match(/#(\d{6,10})/)?.[1];
    const title = plain(raw.replace(/^\s*#\d+\s*(\([^)]*\))?:?\s*/, ""), 250);
    if (title && ticket) titles.set(ticket, title);
  }
  if (!tickets.length) {
    const message = plain(section, 600);
    return message
      ? [{ id: "current", title: "Init7: Störung im Netz", severity: "down", url: statusUrl, message, startedAt: null }]
      : [];
  }
  return tickets.map((ticket) => ({
    id: ticket,
    title: `Init7: ${titles.get(ticket) ?? `Störung #${ticket}`}`.slice(0, 250),
    severity: "down" as const,
    url: `https://as13030.net/status/?ticket=${ticket}`,
    message: null,
    startedAt: null,
  }));
}

/**
 * Microsoft 365 service health (Graph /admin/serviceAnnouncement/issues):
 * unresolved issues classified as «incident». Advisories (minor, often
 * long-running) are left out so they do not alarm.
 */
export function parseMicrosoftIssues(value: unknown): ExternalIssue[] {
  if (!isRecord(value)) throw new Error("graph_issues_invalid");
  return list(value.value).flatMap((issue) => {
    const id = text(issue.id, 80);
    if (!id || issue.isResolved === true) return [];
    if (String(issue.classification ?? "").toLowerCase() !== "incident") return [];
    const service = text(issue.service, 80) ?? "Microsoft 365";
    const title = text(issue.title, 220) ?? "Störung";
    return [{
      id,
      title: `${service}: ${title}`.slice(0, 250),
      severity: "down",
      url: `https://admin.microsoft.com/#/servicehealth/:/alerts/${encodeURIComponent(id)}`,
      message: plain(issue.impactDescription),
      startedAt: text(issue.startDateTime, 40),
    } satisfies ExternalIssue];
  });
}
