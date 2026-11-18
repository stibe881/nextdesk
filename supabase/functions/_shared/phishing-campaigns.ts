// Phishing campaigns and indicators of compromise (IOC), migration 0313.
//
// Reports of different mails belong to one campaign when they share the
// sender domain plus subject or link domains. Indicators (sender, domains,
// URLs, sending IP) of cases with a verdict form the IOC list; every new
// report is checked against it. Pure helpers plus the database calls used
// by the report intake and the security-cases function.

import { domainOf, isPrivateIp, organizationalDomain } from "./phishing-analysis.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

export type IndicatorKind = "domain" | "url" | "ip" | "sender";
export type Indicator = { kind: IndicatorKind; value: string };

/**
 * Domains that are used by everybody (free mail, large platforms). They are
 * neither campaign keys nor domain IOCs, otherwise every mail from such a
 * sender would match. The full sender address still counts.
 */
export const COMMON_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "msn.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "gmx.ch",
  "gmx.net", "gmx.de", "web.de", "bluewin.ch", "sunrise.ch", "hispeed.ch",
  "protonmail.com", "proton.me", "microsoft.com", "office.com", "office365.com",
  "microsoftonline.com", "sharepoint.com", "onedrive.com", "live.net",
  "aka.ms", "google.com", "apple.com", "linkedin.com", "facebook.com",
  "instagram.com", "twitter.com", "x.com", "youtube.com", "w3.org",
  "safelinks.protection.outlook.com",
]);

const SUBJECT_PREFIX =
  /^\s*(?:(?:re|aw|wg|fw|fwd|tr|sv|vs|antw|wtr)\s*(?:\[\d+\])?\s*:|\[(?:extern|external|ext|spam|phishing\??)\]|\*+\s*(?:extern|external|spam)\s*\*+|(?:extern|external)\s*:)\s*/i;

/** Lower case, without «AW:/WG:/[EXTERN]», numbers as «#», no punctuation. */
export function normalizeSubject(subject: string | null | undefined): string | null {
  let value = (subject ?? "").normalize("NFKC");
  for (let index = 0; index < 10 && SUBJECT_PREFIX.test(value); index += 1) {
    value = value.replace(SUBJECT_PREFIX, "");
  }
  value = value.toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .replace(/(?:#\s*)+/g, "# ")
    .replace(/\s+/g, " ")
    .trim();
  // Two characters or a lone number say nothing about a campaign.
  return value.replace(/[#\s]/g, "").length >= 3 ? value.slice(0, 200) : null;
}

/** Host of a URL, lower case, without «www.» (null for mailto: etc.). */
export function urlHost(href: string): string | null {
  try {
    const url = new URL(href.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/^\[|\]$/g, "") || null;
  } catch {
    return null;
  }
}

/** URL without fragment, scheme and host in lower case. */
export function normalizeUrl(href: string): string | null {
  try {
    const url = new URL(href.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    const text = url.toString();
    return text.length <= 500 ? text : null;
  } catch {
    return null;
  }
}

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function isIpLiteral(value: string): boolean {
  return IPV4.test(value) || (value.includes(":") && /^[0-9a-f:.]+$/i.test(value));
}

function isCommon(host: string | null, reference: ReadonlySet<string>): boolean {
  if (!host) return true;
  const organization = organizationalDomain(host);
  return COMMON_DOMAINS.has(host) || (organization !== null &&
    (COMMON_DOMAINS.has(organization) || reference.has(organization))) || reference.has(host);
}

type StoredAnalysis = {
  headers?: Row;
  links?: unknown;
};

function headersOf(analysis: unknown): Row {
  const record = analysis && typeof analysis === "object" ? analysis as StoredAnalysis : {};
  return record.headers && typeof record.headers === "object" ? record.headers : {};
}

function linksOf(analysis: unknown): string[] {
  const record = analysis && typeof analysis === "object" ? analysis as StoredAnalysis : {};
  return (Array.isArray(record.links) ? record.links : [])
    .map((entry) =>
      entry && typeof entry === "object" && typeof (entry as Row).href === "string"
        ? String((entry as Row).href)
        : ""
    )
    .filter(Boolean)
    .slice(0, 100);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Campaign keys of a stored analysis (see storedAnalysis). */
export function campaignKeys(
  analysis: unknown,
  referenceDomains: readonly string[] = [],
): { senderDomain: string | null; subjectKey: string | null; linkDomains: string[] } {
  const reference = new Set(referenceDomains.map((entry) => entry.toLowerCase()));
  const headers = headersOf(analysis);
  const from = str(headers.fromDomain) ?? domainOf(str(headers.fromAddress));
  const senderDomain = from && !isCommon(from.toLowerCase(), reference) ? from.toLowerCase() : null;
  const linkDomains = [
    ...new Set(
      linksOf(analysis)
        .map(urlHost)
        .filter((host): host is string => host !== null && !isCommon(host, reference))
        .map((host) => isIpLiteral(host) ? host : organizationalDomain(host) ?? host),
    ),
  ].sort().slice(0, 30);
  return { senderDomain, subjectKey: normalizeSubject(str(headers.subject)), linkDomains };
}

/**
 * Indicators of a stored analysis: sender address, sender / reply-to domain,
 * public sending IP, link hosts and URLs. Common platforms and the tenant's
 * own domains are left out.
 */
export function extractIndicators(
  analysis: unknown,
  referenceDomains: readonly string[] = [],
): Indicator[] {
  const reference = new Set(referenceDomains.map((entry) => entry.toLowerCase()));
  const headers = headersOf(analysis);
  const result = new Map<string, Indicator>();
  const add = (kind: IndicatorKind, value: string | null) => {
    const clean = value?.trim().toLowerCase();
    if (!clean || clean.length > 500) return;
    result.set(`${kind}:${clean}`, { kind, value: clean });
  };
  const fromAddress = str(headers.fromAddress)?.toLowerCase() ?? null;
  const fromDomain = domainOf(fromAddress);
  if (fromAddress && fromDomain && !reference.has(fromDomain) &&
    !reference.has(organizationalDomain(fromDomain) ?? "")) {
    add("sender", fromAddress);
  }
  for (const domain of [str(headers.fromDomain) ?? fromDomain, str(headers.replyToDomain)]) {
    if (domain && !isCommon(domain.toLowerCase(), reference)) add("domain", domain);
  }
  const ip = str(headers.sendingIp);
  if (ip && isIpLiteral(ip) && !isPrivateIp(ip)) add("ip", ip);
  for (const href of linksOf(analysis).slice(0, 30)) {
    const host = urlHost(href);
    if (!host || isCommon(host, reference)) continue;
    if (isIpLiteral(host)) add("ip", host);
    else add("domain", host);
    add("url", normalizeUrl(href));
  }
  return [...result.values()].slice(0, 100);
}

/** IPs and hosts of a mail that are checked against the IP management. */
export function networkCandidates(analysis: unknown): { ips: string[]; hosts: string[] } {
  const headers = headersOf(analysis);
  const ips = new Set<string>();
  const hosts = new Set<string>();
  const sending = str(headers.sendingIp);
  if (sending && isIpLiteral(sending)) ips.add(sending.toLowerCase());
  const received = Array.isArray(headers.received) ? headers.received : [];
  for (const hop of received.slice(0, 15)) {
    const ip = hop && typeof hop === "object" ? str((hop as Row).ip) : null;
    if (ip && isIpLiteral(ip)) ips.add(ip.toLowerCase());
  }
  for (const href of linksOf(analysis).slice(0, 50)) {
    const host = urlHost(href);
    if (!host) continue;
    if (isIpLiteral(host)) ips.add(host);
    else hosts.add(host);
  }
  for (const key of ["fromDomain", "replyToDomain", "returnPathDomain"]) {
    const domain = str(headers[key]);
    if (domain) hosts.add(domain.toLowerCase());
  }
  return { ips: [...ips].slice(0, 30), hosts: [...hosts].slice(0, 40) };
}

export type CampaignAssignment = {
  campaignId: string | null;
  created: boolean;
  caseLinked: boolean;
  reports: number;
  reporters: number;
  cases: number;
  notified: number;
};

export function parseCampaignAssignment(value: unknown): CampaignAssignment {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
  const count = (key: string) =>
    typeof row[key] === "number" && Number.isFinite(row[key]) ? row[key] as number : 0;
  return {
    campaignId: str(row.campaignId),
    created: row.created === true,
    caseLinked: row.caseLinked === true,
    reports: count("reports"),
    reporters: count("reporters"),
    cases: count("cases"),
    notified: count("notified"),
  };
}

export type IocHit = { id: string; kind: IndicatorKind; value: string; verdict: string; caseCount: number };

export function parseIocHits(value: unknown): IocHit[] {
  return (Array.isArray(value) ? value : []).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Row;
    const id = str(row.id);
    const kind = row.kind;
    const hitValue = str(row.value);
    if (!id || !hitValue || (kind !== "domain" && kind !== "url" && kind !== "ip" && kind !== "sender")) {
      return [];
    }
    return [{
      id,
      kind,
      value: hitValue,
      verdict: str(row.verdict) ?? "phishing",
      caseCount: typeof row.caseCount === "number" ? row.caseCount : 1,
    }];
  });
}

export const INDICATOR_LABELS: Record<IndicatorKind, string> = {
  domain: "Domain",
  url: "URL",
  ip: "IP",
  sender: "Absender",
};

/** Internal note for IOC hits (values are defanged by the caller). */
export function iocHitNote(hits: readonly { kind: IndicatorKind; value: string }[]): string {
  const lines = hits.slice(0, 15).map((hit) => `• ${INDICATOR_LABELS[hit.kind]}: ${hit.value}`);
  return [
    `Achtung: IOC-Treffer: Diese Meldung enthält ${hits.length === 1 ? "einen bekannten Indikator" : `${hits.length} bekannte Indikatoren`} aus früheren Fällen.`,
    ...lines,
  ].join("\n");
}

/**
 * Groups the report into a campaign and checks it against the IOC list.
 * Best effort: errors never undo the report.
 */
export async function processReportIntel(
  admin: Admin,
  input: {
    tenantId: string;
    reportId: string;
    ticketId: string;
    analysis: unknown;
    referenceDomains?: readonly string[];
  },
): Promise<{ campaign: CampaignAssignment | null; hits: IocHit[] }> {
  const reference = input.referenceDomains ?? [];
  let campaign: CampaignAssignment | null = null;
  let hits: IocHit[] = [];
  try {
    const keys = campaignKeys(input.analysis, reference);
    const { data, error } = await admin.rpc("security_campaign_assign", {
      p_tenant_id: input.tenantId,
      p_report_id: input.reportId,
      p_sender_domain: keys.senderDomain,
      p_subject_key: keys.subjectKey,
      p_link_domains: keys.linkDomains,
    });
    if (!error) campaign = parseCampaignAssignment(data);
  } catch {
    campaign = null;
  }
  try {
    const indicators = extractIndicators(input.analysis, reference);
    if (indicators.length) {
      const { data, error } = await admin.rpc("security_ioc_match", {
        p_tenant_id: input.tenantId,
        p_ticket_id: input.ticketId,
        p_indicators: indicators,
      });
      if (!error) hits = parseIocHits(data);
    }
  } catch {
    hits = [];
  }
  return { campaign, hits };
}
