/**
 * IPAM discovery: pure logic shared by the edge functions `ipam-agent`
 * (reports from the on-prem agent) and `ipam-discovery` (administration).
 *
 * - Agent tokens (format, hash, constant-time compare)
 * - Agent configuration (validated; never contains credentials)
 * - Report validation (observations, MAC tables, LLDP, DHCP, DNS)
 * - Switch-port resolution from LLDP neighbours and MAC tables
 * - Evaluation of observations against the documentation → plan with
 *   observation rows, address updates and findings (applied by the SQL
 *   function `ipam_discovery_apply`)
 * - DNS comparison (A/PTR vs. IPAM hostname) and zone helpers for jobs
 *
 * No database access in here, so everything can be tested with `deno test`.
 */

import { lookupVendor, normalizeMac } from "./ipam-oui.ts";

export { lookupVendor, normalizeMac };

// ---------------------------------------------------------------------------
// Constants

export const OBSERVATION_SOURCES = ["ping", "arp", "snmp", "dhcp", "ndp"] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

export const JOB_KINDS = [
  "scan_now",
  "dhcp_reserve",
  "dhcp_release",
  "dns_upsert_a",
  "dns_upsert_ptr",
  "dns_delete",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export type FindingKind =
  | "ghost"
  | "conflict"
  | "foreign_mac"
  | "dns_mismatch"
  | "stale"
  | "outside_prefix";
export type FindingSeverity = "info" | "warning" | "critical";

export const FINDING_SEVERITY: Record<FindingKind, FindingSeverity> = {
  conflict: "critical",
  foreign_mac: "critical",
  ghost: "warning",
  dns_mismatch: "warning",
  stale: "info",
  outside_prefix: "info",
};

/** Report limits (per request). */
export const LIMITS = {
  bodyBytes: 4 * 1024 * 1024,
  observations: 5000,
  macTable: 20000,
  lldp: 2000,
  dhcpServers: 10,
  dhcpScopes: 1000,
  dhcpLeases: 20000,
  dnsZones: 50,
  dnsRecords: 20000,
  errors: 50,
} as const;

/** Agent counts as online when it said hello within this time. */
export const AGENT_ONLINE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Small helpers

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isUuidText(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,62}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,62}[a-z0-9_])?)*$/i;

/** DNS host / FQDN: lowercase, without trailing dot; null if invalid. */
export function normalizeHostname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\.$/, "").toLowerCase();
  return HOSTNAME_PATTERN.test(name) ? name : null;
}

/** Server name or IP address as configured for SNMP/DHCP/DNS targets. */
export function normalizeTargetHost(value: unknown): string | null {
  const ip = parseIp(value);
  if (ip) return ip.address;
  return normalizeHostname(value);
}

// ---------------------------------------------------------------------------
// IP addresses

export type ParsedIp = { family: 4 | 6; address: string };

/** Parses an IPv4/IPv6 host address («/32» and «/128» allowed). */
export function parseIp(value: unknown): ParsedIp | null {
  if (typeof value !== "string") return null;
  let input = value.trim();
  if (!input || input.length > 60) return null;
  if (input.endsWith("/32") && !input.includes(":")) input = input.slice(0, -3);
  if (input.endsWith("/128")) input = input.slice(0, -4);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(input)) {
    const parts = input.split(".");
    if (parts.some((part) => (part.length > 1 && part.startsWith("0")) || Number(part) > 255)) {
      return null;
    }
    return { family: 4, address: parts.map(Number).join(".") };
  }
  if (!input.includes(":") || input.includes("%") || !/^[0-9a-f:.]+$/i.test(input)) return null;
  try {
    const host = new URL(`http://[${input}]/`).hostname;
    return { family: 6, address: host.slice(1, -1) };
  } catch {
    return null;
  }
}

function ipv4Number(address: string): number {
  return address.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
}

/** Full 32-nibble form of an IPv6 address (input must be canonical or valid). */
export function expandIpv6(address: string): string {
  let value = address.toLowerCase();
  const embedded = value.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) {
    const n = ipv4Number(embedded[1]);
    value = value.slice(0, -embedded[1].length) +
      `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = value.includes("::") ? value.split("::") : [value, null];
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail ? tail.split(":").filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const groups = tail === null
    ? headParts
    : [...headParts, ...Array<string>(Math.max(missing, 0)).fill("0"), ...tailParts];
  return groups.map((group) => group.padStart(4, "0")).join("");
}

/**
 * Addresses worth documenting: no loopback, link-local, multicast,
 * broadcast or unspecified addresses.
 */
export function isUsefulAddress(ip: ParsedIp): boolean {
  if (ip.family === 4) {
    const [a, b] = ip.address.split(".").map(Number);
    if (a === 0 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    return true;
  }
  const nibbles = expandIpv6(ip.address);
  if (/^0{31}[01]$/.test(nibbles)) return false; // :: and ::1
  if (nibbles.startsWith("ff")) return false; // multicast
  if (/^fe[89ab]/.test(nibbles)) return false; // link-local fe80::/10
  return true;
}

/** «10.20.30.21» → «21.30.20.10.in-addr.arpa»; IPv6 → nibble format in ip6.arpa. */
export function reverseName(address: string): string | null {
  const ip = parseIp(address);
  if (!ip) return null;
  if (ip.family === 4) return `${ip.address.split(".").reverse().join(".")}.in-addr.arpa`;
  return `${expandIpv6(ip.address).split("").reverse().join(".")}.ip6.arpa`;
}

/** Reverse name → address, or null when it is not a complete host name. */
export function reverseNameToIp(name: string): string | null {
  const value = name.trim().toLowerCase().replace(/\.$/, "");
  const v4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.in-addr\.arpa$/);
  if (v4) return parseIp([v4[4], v4[3], v4[2], v4[1]].join("."))?.address ?? null;
  const v6 = value.match(/^((?:[0-9a-f]\.){32})ip6\.arpa$/);
  if (v6) {
    const nibbles = v6[1].replaceAll(".", "").split("").reverse().join("");
    return parseIp(nibbles.match(/.{4}/g)!.join(":"))?.address ?? null;
  }
  return null;
}

export function isReverseZone(zone: string): boolean {
  return /(^|\.)(in-addr|ip6)\.arpa$/i.test(zone.replace(/\.$/, ""));
}

/** Most specific reverse zone of the list containing the address. */
export function reverseZoneFor(address: string, zones: readonly string[]): string | null {
  const name = reverseName(address);
  if (!name) return null;
  let best: string | null = null;
  for (const raw of zones) {
    const zone = raw.trim().toLowerCase().replace(/\.$/, "");
    if (!isReverseZone(zone)) continue;
    if (name.endsWith(`.${zone}`) && (!best || zone.length > best.length)) best = zone;
  }
  return best;
}

/** Most specific forward zone for a FQDN. */
export function forwardZoneFor(fqdn: string, zones: readonly string[]): string | null {
  const name = fqdn.trim().toLowerCase().replace(/\.$/, "");
  let best: string | null = null;
  for (const raw of zones) {
    const zone = raw.trim().toLowerCase().replace(/\.$/, "");
    if (!zone || isReverseZone(zone)) continue;
    if ((name === zone || name.endsWith(`.${zone}`)) && (!best || zone.length > best.length)) {
      best = zone;
    }
  }
  return best;
}

/** Name relative to its zone («dru-01.schule.local», «schule.local» → «dru-01»; apex → «@»). */
export function relativeName(fqdn: string, zone: string): string {
  const name = fqdn.toLowerCase().replace(/\.$/, "");
  const suffix = zone.toLowerCase().replace(/\.$/, "");
  if (name === suffix) return "@";
  return name.endsWith(`.${suffix}`) ? name.slice(0, -(suffix.length + 1)) : name;
}

/** Same host: equal FQDN, or equal first label when one side is a short name. */
export function sameHost(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = a.trim().toLowerCase().replace(/\.$/, "");
  const right = b.trim().toLowerCase().replace(/\.$/, "");
  if (left === right) return true;
  if (!left.includes(".") || !right.includes(".")) {
    return left.split(".")[0] === right.split(".")[0];
  }
  return false;
}

// ---------------------------------------------------------------------------
// Agent tokens

const encoder = new TextEncoder();
export const AGENT_TOKEN_PATTERN = /^ndip_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** New token «ndip_<agent id hex>_<43 chars secret>»; shown once. */
export function createAgentToken(agentId: string): string {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return `ndip_${agentId.replaceAll("-", "").toLowerCase()}_${base64Url(secret)}`;
}

/** Agent id encoded in a token, or null if the token is malformed. */
export function agentIdFromToken(token: string): string | null {
  const match = AGENT_TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const hex = match[1];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Short, non-secret hint for the UI («ndip_1a2b…»). */
export function tokenHint(token: string): string {
  return `${token.slice(0, 9)}…${token.slice(-4)}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two hex strings (same length expected). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Agent configuration (stored in ipam_agents.config, delivered on hello)

export const SNMP_AUTH_PROTOCOLS = ["md5", "sha", "sha224", "sha256", "sha384", "sha512"] as const;
export const SNMP_PRIV_PROTOCOLS = ["des", "aes", "aes256b", "aes256r"] as const;

export type SnmpTarget = {
  host: string;
  version: "v2c" | "v3";
  /** SNMPv3 user name (the keys stay in the agent's config.json). */
  user: string | null;
  authProtocol: (typeof SNMP_AUTH_PROTOCOLS)[number] | null;
  privProtocol: (typeof SNMP_PRIV_PROTOCOLS)[number] | null;
  /** What to read: ARP table, MAC table (FDB), LLDP neighbours. */
  collect: ("arp" | "fdb" | "lldp")[];
};

export type AgentConfig = {
  scanAllActive: boolean;
  prefixIds: string[];
  scheduleMinutes: number;
  pingTimeoutMs: number;
  pingConcurrency: number;
  snmpTargets: SnmpTarget[];
  dhcpServers: string[];
  dnsServers: string[];
  dnsZones: string[];
  dnsDefaultZone: string | null;
  allowWrites: boolean;
  vrfId: string | null;
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  scanAllActive: true,
  prefixIds: [],
  scheduleMinutes: 60,
  pingTimeoutMs: 1000,
  pingConcurrency: 64,
  snmpTargets: [],
  dhcpServers: [],
  dnsServers: [],
  dnsZones: [],
  dnsDefaultZone: null,
  allowWrites: false,
  vrfId: null,
};

const SECRET_KEYS = /^(community|authkey|privkey|authpassword|privpassword|password|secret|token|key)$/i;

/** True when the value contains something that looks like a credential. */
export function containsSecret(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (Array.isArray(value)) return value.some((entry) => containsSecret(entry, depth + 1));
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, entry]) =>
    SECRET_KEYS.test(key) || containsSecret(entry, depth + 1)
  );
}

function hostList(value: unknown, max: number): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const hosts: string[] = [];
  for (const entry of value) {
    const host = normalizeTargetHost(entry);
    if (!host) return null;
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

export type ConfigResult = { ok: true; config: AgentConfig } | { ok: false; code: string };

/** Validates an agent configuration from the UI (or the stored JSON). */
export function parseAgentConfig(value: unknown): ConfigResult {
  if (value === undefined || value === null) return { ok: true, config: { ...DEFAULT_AGENT_CONFIG } };
  if (!isObject(value)) return { ok: false, code: "config_invalid" };
  if (containsSecret(value)) return { ok: false, code: "config_contains_secret" };
  const prefixIds = value.prefixIds ?? [];
  if (!Array.isArray(prefixIds) || prefixIds.length > 500 || !prefixIds.every(isUuidText)) {
    return { ok: false, code: "config_prefixes_invalid" };
  }
  const scheduleMinutes = boundedInt(value.scheduleMinutes, 60, 5, 1440);
  const pingTimeoutMs = boundedInt(value.pingTimeoutMs, 1000, 200, 5000);
  const pingConcurrency = boundedInt(value.pingConcurrency, 64, 1, 256);
  if (scheduleMinutes === null || pingTimeoutMs === null || pingConcurrency === null) {
    return { ok: false, code: "config_schedule_invalid" };
  }
  const rawTargets = value.snmpTargets ?? [];
  if (!Array.isArray(rawTargets) || rawTargets.length > 200) {
    return { ok: false, code: "config_snmp_invalid" };
  }
  const snmpTargets: SnmpTarget[] = [];
  for (const entry of rawTargets) {
    if (!isObject(entry)) return { ok: false, code: "config_snmp_invalid" };
    const host = normalizeTargetHost(entry.host);
    const version = entry.version === "v3" ? "v3" : entry.version === "v2c" ? "v2c" : null;
    if (!host || !version) return { ok: false, code: "config_snmp_invalid" };
    const user = version === "v3" ? text(entry.user, 64) : null;
    if (version === "v3" && (!user || !/^[A-Za-z0-9._@-]+$/.test(user))) {
      return { ok: false, code: "config_snmp_user_invalid" };
    }
    const authProtocol = version === "v3" && entry.authProtocol !== null && entry.authProtocol !== undefined
      ? (SNMP_AUTH_PROTOCOLS as readonly unknown[]).includes(entry.authProtocol)
        ? entry.authProtocol as SnmpTarget["authProtocol"]
        : undefined
      : null;
    const privProtocol = version === "v3" && entry.privProtocol !== null && entry.privProtocol !== undefined
      ? (SNMP_PRIV_PROTOCOLS as readonly unknown[]).includes(entry.privProtocol)
        ? entry.privProtocol as SnmpTarget["privProtocol"]
        : undefined
      : null;
    if (authProtocol === undefined || privProtocol === undefined || (privProtocol && !authProtocol)) {
      return { ok: false, code: "config_snmp_protocol_invalid" };
    }
    const collectRaw = Array.isArray(entry.collect) ? entry.collect : ["arp", "fdb", "lldp"];
    const collect = (["arp", "fdb", "lldp"] as const).filter((item) => collectRaw.includes(item));
    if (snmpTargets.some((target) => target.host === host)) continue;
    snmpTargets.push({ host, version, user, authProtocol, privProtocol, collect });
  }
  const dhcpServers = hostList(value.dhcpServers, 10);
  const dnsServers = hostList(value.dnsServers, 10);
  if (!dhcpServers || !dnsServers) return { ok: false, code: "config_servers_invalid" };
  const zonesRaw = value.dnsZones ?? [];
  if (!Array.isArray(zonesRaw) || zonesRaw.length > 100) return { ok: false, code: "config_zones_invalid" };
  const dnsZones: string[] = [];
  for (const zone of zonesRaw) {
    const normalized = normalizeHostname(zone);
    if (!normalized) return { ok: false, code: "config_zones_invalid" };
    if (!dnsZones.includes(normalized)) dnsZones.push(normalized);
  }
  const dnsDefaultZone = value.dnsDefaultZone === undefined || value.dnsDefaultZone === null ||
      value.dnsDefaultZone === ""
    ? null
    : normalizeHostname(value.dnsDefaultZone);
  if (dnsDefaultZone === null && value.dnsDefaultZone) return { ok: false, code: "config_zones_invalid" };
  const vrfId = value.vrfId === undefined || value.vrfId === null || value.vrfId === "" ? null : value.vrfId;
  if (vrfId !== null && !isUuidText(vrfId)) return { ok: false, code: "config_vrf_invalid" };
  return {
    ok: true,
    config: {
      scanAllActive: value.scanAllActive === undefined ? true : value.scanAllActive === true,
      prefixIds: [...new Set((prefixIds as string[]).map((id) => id.toLowerCase()))],
      scheduleMinutes,
      pingTimeoutMs,
      pingConcurrency,
      snmpTargets,
      dhcpServers,
      dnsServers,
      dnsZones,
      dnsDefaultZone,
      allowWrites: value.allowWrites === true,
      vrfId: vrfId === null ? null : (vrfId as string).toLowerCase(),
    },
  };
}

// ---------------------------------------------------------------------------
// Reports from the agent

export type ObservationInput = {
  address: string;
  family: 4 | 6;
  mac: string | null;
  source: ObservationSource;
  hostname: string | null;
  vendor: string | null;
  vrfId: string | null;
  switchName: string | null;
  switchPort: string | null;
  vlan: number | null;
};

export type MacTableEntry = { switchName: string; port: string; mac: string; vlan: number | null };

export type LldpNeighbor = {
  switchName: string;
  localPort: string;
  chassisMac: string | null;
  sysName: string | null;
  portId: string | null;
  mgmtAddress: string | null;
  capabilities: string[];
};

export type DhcpScopeInput = {
  scopeId: string;
  subnetMask: string | null;
  name: string | null;
  description: string | null;
  state: string | null;
  startRange: string | null;
  endRange: string | null;
  leaseDurationSeconds: number | null;
  inUse: number | null;
  free: number | null;
  reserved: number | null;
};

export type DhcpLeaseInput = {
  scopeId: string;
  address: string;
  mac: string | null;
  clientId: string | null;
  hostname: string | null;
  state: string | null;
  expiresAt: string | null;
  reservation: boolean;
  reservationName: string | null;
};

export type DhcpServerReport = { server: string; scopes: DhcpScopeInput[]; leases: DhcpLeaseInput[] };

export type DnsRecordInput = {
  name: string;
  type: "A" | "AAAA" | "PTR" | "CNAME";
  value: string;
  address: string | null;
  ttl: number | null;
};

export type DnsZoneReport = { server: string; zone: string; records: DnsRecordInput[] };

export type RunInfo = {
  key: string;
  trigger: "schedule" | "manual" | "startup";
  jobId: string | null;
  final: boolean;
  stats: Record<string, number>;
  errors: string[];
};

export type AgentReport = {
  run: RunInfo;
  observations: ObservationInput[];
  macTable: MacTableEntry[];
  lldp: LldpNeighbor[];
  dhcp: DhcpServerReport[];
  dns: DnsZoneReport[];
  skipped: number;
};

export type ReportResult = { ok: true; report: AgentReport } | { ok: false; code: string };

function arrayOrEmpty(value: unknown, max: number): unknown[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  return value;
}

function vlanNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4094 ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 2 ** 31
    ? Math.round(value)
    : null;
}

function isoTime(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Parses one observation; null when unusable. */
export function parseObservation(value: unknown): ObservationInput | null {
  if (!isObject(value)) return null;
  const ip = parseIp(value.address);
  if (!ip || !isUsefulAddress(ip)) return null;
  const source = (OBSERVATION_SOURCES as readonly unknown[]).includes(value.source)
    ? value.source as ObservationSource
    : null;
  if (!source) return null;
  const vrfId = isUuidText(value.vrfId) ? value.vrfId.toLowerCase() : null;
  return {
    address: ip.address,
    family: ip.family,
    mac: normalizeMac(value.mac),
    source,
    hostname: normalizeHostname(value.hostname),
    vendor: text(value.vendor, 160),
    vrfId,
    switchName: text(value.switchName, 160),
    switchPort: text(value.switchPort, 80),
    vlan: vlanNumber(value.vlan),
  };
}

function parseDnsRecord(zone: string, value: unknown): DnsRecordInput | null {
  if (!isObject(value)) return null;
  const type = ["A", "AAAA", "PTR", "CNAME"].includes(String(value.type).toUpperCase())
    ? String(value.type).toUpperCase() as DnsRecordInput["type"]
    : null;
  if (!type || typeof value.name !== "string") return null;
  const rawName = value.name.trim().toLowerCase().replace(/\.$/, "");
  const name = !rawName || rawName === "@"
    ? zone
    : rawName === zone || rawName.endsWith(`.${zone}`)
    ? rawName
    : `${rawName}.${zone}`;
  if (!normalizeHostname(name)) return null;
  const ttl = count(value.ttl);
  if (type === "A" || type === "AAAA") {
    const ip = parseIp(value.value);
    if (!ip || (ip.family === 4) !== (type === "A")) return null;
    return { name, type, value: ip.address, address: ip.address, ttl };
  }
  const target = normalizeHostname(value.value);
  if (!target) return null;
  return { name, type, value: target, address: type === "PTR" ? reverseNameToIp(name) : null, ttl };
}

/** Validates a report body (structure and limits). Invalid entries are skipped and counted. */
export function parseReport(body: unknown): ReportResult {
  if (!isObject(body) || !isObject(body.run)) return { ok: false, code: "invalid_report" };
  const key = text(body.run.key, 80);
  if (!key || !/^[A-Za-z0-9._:-]+$/.test(key)) return { ok: false, code: "invalid_run" };
  const trigger = body.run.trigger === "manual" || body.run.trigger === "startup"
    ? body.run.trigger
    : "schedule";
  const stats: Record<string, number> = {};
  if (isObject(body.run.stats)) {
    for (const [name, value] of Object.entries(body.run.stats).slice(0, 30)) {
      const numeric = count(value);
      if (numeric !== null && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name)) stats[name] = numeric;
    }
  }
  const errorsRaw = arrayOrEmpty(body.run.errors, LIMITS.errors);
  if (!errorsRaw) return { ok: false, code: "too_many_errors" };
  const errors = errorsRaw.flatMap((entry) => {
    const message = text(entry, 300);
    return message ? [message] : [];
  });
  const run: RunInfo = {
    key,
    trigger,
    jobId: isUuidText(body.run.jobId) ? body.run.jobId.toLowerCase() : null,
    final: body.run.final === true,
    stats,
    errors,
  };

  let skipped = 0;
  const observationsRaw = arrayOrEmpty(body.observations, LIMITS.observations);
  const macRaw = arrayOrEmpty(body.macTable, LIMITS.macTable);
  const lldpRaw = arrayOrEmpty(body.lldp, LIMITS.lldp);
  const dhcpRaw = arrayOrEmpty(body.dhcp, LIMITS.dhcpServers);
  const dnsRaw = arrayOrEmpty(body.dns, LIMITS.dnsZones);
  if (!observationsRaw) return { ok: false, code: "too_many_observations" };
  if (!macRaw) return { ok: false, code: "too_many_mac_entries" };
  if (!lldpRaw) return { ok: false, code: "too_many_lldp_entries" };
  if (!dhcpRaw) return { ok: false, code: "too_many_dhcp_servers" };
  if (!dnsRaw) return { ok: false, code: "too_many_dns_zones" };

  const observations: ObservationInput[] = [];
  for (const entry of observationsRaw) {
    const parsed = parseObservation(entry);
    if (parsed) observations.push(parsed);
    else skipped += 1;
  }

  const macTable: MacTableEntry[] = [];
  for (const entry of macRaw) {
    const mac = isObject(entry) ? normalizeMac(entry.mac) : null;
    const switchName = isObject(entry) ? text(entry.switchName, 160) : null;
    const port = isObject(entry) ? text(entry.port, 80) : null;
    if (!mac || !switchName || !port) {
      skipped += 1;
      continue;
    }
    macTable.push({ switchName, port, mac, vlan: vlanNumber((entry as Record<string, unknown>).vlan) });
  }

  const lldp: LldpNeighbor[] = [];
  for (const entry of lldpRaw) {
    if (!isObject(entry)) {
      skipped += 1;
      continue;
    }
    const switchName = text(entry.switchName, 160);
    const localPort = text(entry.localPort, 80);
    if (!switchName || !localPort) {
      skipped += 1;
      continue;
    }
    const mgmt = parseIp(entry.mgmtAddress);
    lldp.push({
      switchName,
      localPort,
      chassisMac: normalizeMac(entry.chassisMac),
      sysName: text(entry.sysName, 160),
      portId: text(entry.portId, 80),
      mgmtAddress: mgmt && isUsefulAddress(mgmt) ? mgmt.address : null,
      capabilities: Array.isArray(entry.capabilities)
        ? entry.capabilities.filter((cap): cap is string => typeof cap === "string").slice(0, 10)
        : [],
    });
  }

  const dhcp: DhcpServerReport[] = [];
  let scopeTotal = 0;
  let leaseTotal = 0;
  for (const entry of dhcpRaw) {
    if (!isObject(entry)) return { ok: false, code: "invalid_dhcp" };
    const server = normalizeTargetHost(entry.server);
    const scopesRaw = arrayOrEmpty(entry.scopes, LIMITS.dhcpScopes);
    const leasesRaw = arrayOrEmpty(entry.leases, LIMITS.dhcpLeases);
    if (!server || !scopesRaw || !leasesRaw) return { ok: false, code: "invalid_dhcp" };
    scopeTotal += scopesRaw.length;
    leaseTotal += leasesRaw.length;
    if (scopeTotal > LIMITS.dhcpScopes || leaseTotal > LIMITS.dhcpLeases) {
      return { ok: false, code: "too_many_dhcp_entries" };
    }
    const scopes: DhcpScopeInput[] = [];
    for (const scope of scopesRaw) {
      const scopeId = isObject(scope) ? parseIp(scope.scopeId) : null;
      if (!scopeId || scopeId.family !== 4) {
        skipped += 1;
        continue;
      }
      const s = scope as Record<string, unknown>;
      scopes.push({
        scopeId: scopeId.address,
        subnetMask: parseIp(s.subnetMask)?.address ?? null,
        name: text(s.name, 200),
        description: text(s.description, 500),
        state: text(s.state, 40),
        startRange: parseIp(s.startRange)?.address ?? null,
        endRange: parseIp(s.endRange)?.address ?? null,
        leaseDurationSeconds: count(s.leaseDurationSeconds),
        inUse: count(s.inUse),
        free: count(s.free),
        reserved: count(s.reserved),
      });
    }
    const scopeIds = new Set(scopes.map((scope) => scope.scopeId));
    const leases: DhcpLeaseInput[] = [];
    for (const lease of leasesRaw) {
      if (!isObject(lease)) {
        skipped += 1;
        continue;
      }
      const address = parseIp(lease.address);
      const scopeId = parseIp(lease.scopeId)?.address ?? null;
      if (!address || !scopeId || !scopeIds.has(scopeId)) {
        skipped += 1;
        continue;
      }
      const state = text(lease.state, 40);
      leases.push({
        scopeId,
        address: address.address,
        mac: normalizeMac(lease.mac ?? lease.clientId),
        clientId: text(lease.clientId, 120),
        hostname: normalizeHostname(lease.hostname),
        state,
        expiresAt: isoTime(lease.expiresAt),
        reservation: lease.reservation === true || /reservation/i.test(state ?? ""),
        reservationName: text(lease.reservationName, 200),
      });
    }
    dhcp.push({ server, scopes, leases });
  }

  const dns: DnsZoneReport[] = [];
  let recordTotal = 0;
  for (const entry of dnsRaw) {
    if (!isObject(entry)) return { ok: false, code: "invalid_dns" };
    const server = normalizeTargetHost(entry.server);
    const zone = normalizeHostname(entry.zone);
    const recordsRaw = arrayOrEmpty(entry.records, LIMITS.dnsRecords);
    if (!server || !zone || !recordsRaw) return { ok: false, code: "invalid_dns" };
    recordTotal += recordsRaw.length;
    if (recordTotal > LIMITS.dnsRecords) return { ok: false, code: "too_many_dns_records" };
    const records: DnsRecordInput[] = [];
    const seen = new Set<string>();
    for (const record of recordsRaw) {
      const parsed = parseDnsRecord(zone, record);
      if (!parsed) {
        skipped += 1;
        continue;
      }
      const key = `${parsed.name}|${parsed.type}|${parsed.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(parsed);
    }
    dns.push({ server, zone, records });
  }

  return { ok: true, report: { run, observations, macTable, lldp, dhcp, dns, skipped } };
}

// ---------------------------------------------------------------------------
// Switch ports from LLDP and MAC tables

export type MacLocation = {
  mac: string;
  switchName: string;
  switchPort: string;
  vlan: number | null;
  source: "lldp" | "fdb";
};

export type IpHint = { address: string; switchName: string; switchPort: string; hostname: string | null };

const INFRA_CAPABILITIES = ["bridge", "router"];
const EDGE_CAPABILITIES = ["wlanAccessPoint", "telephone", "station"];

/**
 * Resolves where each MAC is connected: the access port (not an uplink) with
 * the fewest MACs. Uplinks are ports with an LLDP neighbour that is a switch
 * or router (but not an access point or phone) and ports with more than
 * `maxEdgeMacs` MACs. LLDP neighbours with a chassis MAC win over the FDB.
 */
export function resolveMacLocations(
  macTable: readonly MacTableEntry[],
  lldp: readonly LldpNeighbor[],
  options: { maxEdgeMacs?: number } = {},
): { locations: MacLocation[]; ipHints: IpHint[] } {
  const maxEdgeMacs = options.maxEdgeMacs ?? 48;
  const portKey = (switchName: string, port: string) => `${switchName.toLowerCase()}|${port}`;
  const uplinks = new Set<string>();
  const edgeNeighbourPorts = new Set<string>();
  for (const neighbour of lldp) {
    const key = portKey(neighbour.switchName, neighbour.localPort);
    const infra = neighbour.capabilities.some((cap) => INFRA_CAPABILITIES.includes(cap));
    const edge = neighbour.capabilities.some((cap) => EDGE_CAPABILITIES.includes(cap));
    if (infra && !edge) uplinks.add(key);
    if (edge) edgeNeighbourPorts.add(key);
  }
  const portCounts = new Map<string, number>();
  for (const entry of macTable) {
    const key = portKey(entry.switchName, entry.port);
    portCounts.set(key, (portCounts.get(key) ?? 0) + 1);
  }
  for (const [key, total] of portCounts) {
    if (total > maxEdgeMacs && !edgeNeighbourPorts.has(key)) uplinks.add(key);
  }

  const best = new Map<string, { entry: MacTableEntry; total: number }>();
  for (const entry of macTable) {
    const key = portKey(entry.switchName, entry.port);
    if (uplinks.has(key)) continue;
    const total = portCounts.get(key) ?? 1;
    const current = best.get(entry.mac);
    if (!current || total < current.total) best.set(entry.mac, { entry, total });
  }
  const locations = new Map<string, MacLocation>();
  for (const [mac, { entry }] of best) {
    locations.set(mac, {
      mac,
      switchName: entry.switchName,
      switchPort: entry.port,
      vlan: entry.vlan,
      source: "fdb",
    });
  }
  const ipHints: IpHint[] = [];
  for (const neighbour of lldp) {
    const infra = neighbour.capabilities.some((cap) => INFRA_CAPABILITIES.includes(cap)) &&
      !neighbour.capabilities.some((cap) => EDGE_CAPABILITIES.includes(cap));
    if (neighbour.chassisMac && !infra) {
      locations.set(neighbour.chassisMac, {
        mac: neighbour.chassisMac,
        switchName: neighbour.switchName,
        switchPort: neighbour.localPort,
        vlan: locations.get(neighbour.chassisMac)?.vlan ?? null,
        source: "lldp",
      });
    }
    if (neighbour.mgmtAddress && !infra) {
      ipHints.push({
        address: neighbour.mgmtAddress,
        switchName: neighbour.switchName,
        switchPort: neighbour.localPort,
        hostname: normalizeHostname(neighbour.sysName),
      });
    }
  }
  return { locations: [...locations.values()], ipHints };
}

// ---------------------------------------------------------------------------
// Observations → plan

export type MergedObservation = {
  vrfId: string | null;
  address: string;
  macs: string[];
  sources: ObservationSource[];
  hostname: string | null;
  vendor: string | null;
  switchName: string | null;
  switchPort: string | null;
  vlan: number | null;
};

const SOURCE_ORDER: ObservationSource[] = ["ping", "arp", "ndp", "snmp", "dhcp"];

/** Merges several sightings of the same address (per VRF). */
export function mergeObservations(
  observations: readonly ObservationInput[],
  ipHints: readonly IpHint[] = [],
): MergedObservation[] {
  const merged = new Map<string, MergedObservation>();
  for (const item of observations) {
    const key = `${item.vrfId ?? ""}|${item.address}`;
    const current = merged.get(key) ?? {
      vrfId: item.vrfId,
      address: item.address,
      macs: [],
      sources: [],
      hostname: null,
      vendor: null,
      switchName: null,
      switchPort: null,
      vlan: null,
    };
    if (item.mac && !current.macs.includes(item.mac)) current.macs.push(item.mac);
    if (!current.sources.includes(item.source)) current.sources.push(item.source);
    current.hostname ??= item.hostname;
    current.vendor ??= item.vendor;
    if (item.switchName && item.switchPort && !current.switchName) {
      current.switchName = item.switchName;
      current.switchPort = item.switchPort;
    }
    current.vlan ??= item.vlan;
    merged.set(key, current);
  }
  for (const hint of ipHints) {
    const key = `|${hint.address}`;
    const current = merged.get(key);
    if (current) {
      current.switchName = hint.switchName;
      current.switchPort = hint.switchPort;
      current.hostname ??= hint.hostname;
      if (!current.sources.includes("snmp")) current.sources.push("snmp");
    } else {
      merged.set(key, {
        vrfId: null,
        address: hint.address,
        macs: [],
        sources: ["snmp"],
        hostname: hint.hostname,
        vendor: null,
        switchName: hint.switchName,
        switchPort: hint.switchPort,
        vlan: null,
      });
    }
  }
  for (const item of merged.values()) {
    item.sources.sort((a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b));
  }
  return [...merged.values()];
}

/** Context per address as returned by the SQL function `ipam_discovery_context`. */
export type AddressContext = {
  address: string;
  addressId: string | null;
  status: "active" | "reserved" | "dhcp" | "deprecated" | null;
  mac: string | null;
  hostname: string | null;
  vendor: string | null;
  switchName: string | null;
  switchPort: string | null;
  lastSeenAt: string | null;
  prefixId: string | null;
  inDhcpRange: boolean;
  lease: { mac: string | null; hostname: string | null; reservation: boolean; active: boolean } | null;
  observation: { mac: string | null; runKey: string | null; runMacs: string[] } | null;
};

export type ObservationRow = {
  address: string;
  mac: string | null;
  source: ObservationSource;
  sources: ObservationSource[];
  switch_name: string | null;
  switch_port: string | null;
  vlan: number | null;
  hostname: string | null;
  vendor: string | null;
  run_macs: string[];
};

export type AddressUpdate = {
  addressId: string;
  source: string;
  mac?: string;
  vendor?: string;
  switchName?: string;
  switchPort?: string;
  event?: { kind: "seen" | "mac_changed"; details: Record<string, unknown> };
};

export type FindingOpen = {
  address: string;
  vrfId?: string | null;
  kind: FindingKind;
  severity: FindingSeverity;
  addressId: string | null;
  prefixId: string | null;
  details: Record<string, unknown>;
};

export type DiscoveryPlan = {
  vrfId: string | null;
  runKey: string | null;
  observations: ObservationRow[];
  addressUpdates: AddressUpdate[];
  open: FindingOpen[];
  resolve: { address: string; kinds: FindingKind[] }[];
  resolveOtherKinds?: FindingKind[];
};

/** Parses the JSON from `ipam_discovery_context` defensively. */
export function parseContext(value: unknown): { addresses: AddressContext[]; macLocations: MacLocation[] } {
  const root = isObject(value) ? value : {};
  const str = (entry: unknown) => (typeof entry === "string" && entry ? entry : null);
  const addresses = (Array.isArray(root.addresses) ? root.addresses : []).flatMap((entry) => {
    if (!isObject(entry) || typeof entry.address !== "string") return [];
    const status = ["active", "reserved", "dhcp", "deprecated"].includes(String(entry.status))
      ? entry.status as AddressContext["status"]
      : null;
    const lease = isObject(entry.lease)
      ? {
        mac: normalizeMac(entry.lease.mac),
        hostname: str(entry.lease.hostname),
        reservation: entry.lease.reservation === true,
        active: entry.lease.active === true,
      }
      : null;
    const observation = isObject(entry.observation)
      ? {
        mac: normalizeMac(entry.observation.mac),
        runKey: str(entry.observation.runKey),
        runMacs: Array.isArray(entry.observation.runMacs)
          ? entry.observation.runMacs.flatMap((mac) => {
            const normalized = normalizeMac(mac);
            return normalized ? [normalized] : [];
          })
          : [],
      }
      : null;
    return [{
      address: parseIp(entry.address)?.address ?? entry.address,
      addressId: str(entry.addressId),
      status,
      mac: normalizeMac(entry.mac),
      hostname: str(entry.hostname),
      vendor: str(entry.vendor),
      switchName: str(entry.switchName),
      switchPort: str(entry.switchPort),
      lastSeenAt: str(entry.lastSeenAt),
      prefixId: str(entry.prefixId),
      inDhcpRange: entry.inDhcpRange === true,
      lease,
      observation,
    }];
  });
  const macLocations = (Array.isArray(root.macLocations) ? root.macLocations : []).flatMap((entry) => {
    if (!isObject(entry)) return [];
    const mac = normalizeMac(entry.mac);
    const switchName = str(entry.switchName);
    const switchPort = str(entry.switchPort);
    if (!mac || !switchName || !switchPort) return [];
    return [{
      mac,
      switchName,
      switchPort,
      vlan: vlanNumber(entry.vlan),
      source: entry.source === "lldp" ? "lldp" as const : "fdb" as const,
    }];
  });
  return { addresses, macLocations };
}

/**
 * Compares observations with the documentation and returns what to write.
 *
 * - observation row per address (MACs of this run merged across chunks)
 * - documented address: last seen, MAC/vendor if unknown (or changed for DHCP
 *   addresses: event «mac_changed»), switch port; first sighting → «seen»
 * - findings: ghost (seen, not documented, no lease, outside DHCP range),
 *   conflict (≥ 2 MACs in the same run), foreign_mac (active/reserved address
 *   with stored MAC answers with another MAC), outside_prefix (no prefix)
 * - findings that no longer apply are resolved
 */
export function planObservations(args: {
  vrfId: string | null;
  runKey: string;
  observations: readonly MergedObservation[];
  contexts: readonly AddressContext[];
  macLocations: readonly MacLocation[];
  vendorLookup?: (mac: string) => string | null;
}): DiscoveryPlan {
  const vendorOf = args.vendorLookup ?? lookupVendor;
  const contexts = new Map(args.contexts.map((context) => [context.address, context]));
  const locations = new Map(args.macLocations.map((location) => [location.mac, location]));
  const plan: DiscoveryPlan = {
    vrfId: args.vrfId,
    runKey: args.runKey,
    observations: [],
    addressUpdates: [],
    open: [],
    resolve: [],
  };

  for (const item of args.observations) {
    const context = contexts.get(item.address);
    const previousRunMacs = context?.observation?.runKey === args.runKey
      ? context.observation.runMacs
      : [];
    const runMacs = [...new Set([...previousRunMacs, ...item.macs])];
    const mac = item.macs[0] ?? null;
    const location = mac ? locations.get(mac) : undefined;
    const switchName = item.switchName ?? location?.switchName ?? null;
    const switchPort = item.switchPort ?? location?.switchPort ?? null;
    const vlan = item.vlan ?? location?.vlan ?? null;
    const vendor = item.vendor ?? (mac ? vendorOf(mac) : null);
    const hostname = item.hostname ?? context?.lease?.hostname ?? null;
    const source = item.sources[0] ?? "ping";

    plan.observations.push({
      address: item.address,
      mac,
      source,
      sources: item.sources,
      switch_name: switchName,
      switch_port: switchPort,
      vlan,
      hostname,
      vendor,
      run_macs: runMacs,
    });

    const open = (kind: FindingKind, details: Record<string, unknown>) =>
      plan.open.push({
        address: item.address,
        kind,
        severity: FINDING_SEVERITY[kind],
        addressId: context?.addressId ?? null,
        prefixId: context?.prefixId ?? null,
        details,
      });
    const resolve: FindingKind[] = [];
    // Keys read by part A's «adoptFinding»: hostname, dnsName, mac, vendor,
    // switchName, switchPort, source.
    const seenDetails = {
      mac,
      vendor,
      hostname: hostname ? hostname.split(".")[0] : null,
      dnsName: hostname && hostname.includes(".") ? hostname : null,
      source,
      sources: item.sources,
      switchName,
      switchPort,
    };

    // Documented address.
    if (context?.addressId) {
      const update: AddressUpdate = {
        addressId: context.addressId,
        source: item.sources.join(",").slice(0, 40),
      };
      const protectedMac = context.status === "active" || context.status === "reserved";
      const foreign = Boolean(context.mac && mac && protectedMac && !runMacs.includes(context.mac));
      if (mac && !context.mac) {
        update.mac = mac;
        if (vendor && !context.vendor) update.vendor = vendor;
      } else if (mac && context.mac && mac !== context.mac && !protectedMac) {
        update.mac = mac;
        if (vendor) update.vendor = vendor;
        update.event = { kind: "mac_changed", details: { from: context.mac, to: mac, vendor } };
      } else if (mac && mac === context.mac && vendor && !context.vendor) {
        update.vendor = vendor;
      }
      if (switchName && switchPort && !foreign &&
        (switchName !== context.switchName || switchPort !== context.switchPort)) {
        update.switchName = switchName;
        update.switchPort = switchPort;
      }
      if (!context.lastSeenAt) {
        update.event = { kind: "seen", details: { first: true, mac, vendor, sources: item.sources } };
      } else if (!update.event && update.mac && !context.mac) {
        update.event = { kind: "mac_changed", details: { from: null, to: mac, vendor } };
      }
      plan.addressUpdates.push(update);

      if (foreign) {
        open("foreign_mac", {
          expectedMac: context.mac,
          observedMac: mac,
          vendor,
          switchName,
          switchPort,
          hostname: context.hostname,
          status: context.status,
        });
      } else if (runMacs.length || !context.mac || !protectedMac) {
        // A sighting without MAC (ping only) neither confirms nor clears it.
        resolve.push("foreign_mac");
      }
      resolve.push("ghost");
    } else {
      const leased = Boolean(context?.lease?.active);
      if (context?.prefixId && !leased && !context.inDhcpRange) {
        open("ghost", seenDetails);
      } else {
        resolve.push("ghost");
      }
    }

    if (runMacs.length >= 2) {
      open("conflict", {
        macs: runMacs,
        vendors: runMacs.map((entry) => vendorOf(entry)),
        switchName,
        switchPort,
      });
    } else if (runMacs.length === 1) {
      resolve.push("conflict");
    }

    if (context && !context.prefixId) {
      open("outside_prefix", seenDetails);
    } else {
      resolve.push("outside_prefix");
    }

    if (resolve.length) plan.resolve.push({ address: item.address, kinds: resolve });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// DNS comparison

export type DnsContextEntry = {
  addressId: string;
  address: string;
  vrfId: string | null;
  status: string | null;
  hostname: string | null;
  dnsName: string | null;
  aNames: string[];
  ptrTargets: string[];
  nameTargets: string[];
};

export type DnsIssueKind = "missing_a" | "a_mismatch" | "a_other_name" | "missing_ptr" | "ptr_mismatch";

export type DnsIssue = {
  addressId: string;
  address: string;
  vrfId: string | null;
  expectedName: string;
  issue: DnsIssueKind;
  current: string[];
  action: "create_a" | "fix_a" | "create_ptr" | "fix_ptr";
};

/** Issues that become a «dns_mismatch» finding (the rest is shown as diff only). */
export const DNS_FINDING_ISSUES: DnsIssueKind[] = ["a_mismatch", "a_other_name", "ptr_mismatch"];

export function parseDnsContext(value: unknown): DnsContextEntry[] {
  if (!Array.isArray(value)) return [];
  const strings = (entry: unknown) =>
    Array.isArray(entry) ? entry.filter((item): item is string => typeof item === "string") : [];
  return value.flatMap((entry) => {
    if (!isObject(entry) || typeof entry.addressId !== "string" || typeof entry.address !== "string") {
      return [];
    }
    return [{
      addressId: entry.addressId,
      address: entry.address,
      vrfId: typeof entry.vrfId === "string" ? entry.vrfId : null,
      status: typeof entry.status === "string" ? entry.status : null,
      hostname: typeof entry.hostname === "string" ? entry.hostname : null,
      dnsName: typeof entry.dnsName === "string" ? entry.dnsName : null,
      aNames: strings(entry.aNames),
      ptrTargets: strings(entry.ptrTargets),
      nameTargets: strings(entry.nameTargets),
    }];
  });
}

/** All DNS deviations of a documented address (IPAM name is the reference). */
export function dnsIssues(entry: DnsContextEntry): DnsIssue[] {
  const expectedName = (entry.dnsName ?? entry.hostname)?.trim().toLowerCase().replace(/\.$/, "");
  if (!expectedName) return [];
  const base = { addressId: entry.addressId, address: entry.address, vrfId: entry.vrfId, expectedName };
  const issues: DnsIssue[] = [];
  if (entry.nameTargets.length && !entry.nameTargets.includes(entry.address)) {
    issues.push({ ...base, issue: "a_mismatch", current: entry.nameTargets, action: "fix_a" });
  } else if (!entry.nameTargets.length) {
    if (entry.aNames.length && !entry.aNames.some((name) => sameHost(name, expectedName))) {
      issues.push({ ...base, issue: "a_other_name", current: entry.aNames, action: "create_a" });
    } else if (!entry.aNames.length) {
      issues.push({ ...base, issue: "missing_a", current: [], action: "create_a" });
    }
  }
  if (!entry.ptrTargets.length) {
    issues.push({ ...base, issue: "missing_ptr", current: [], action: "create_ptr" });
  } else if (!entry.ptrTargets.some((target) => sameHost(target, expectedName))) {
    issues.push({ ...base, issue: "ptr_mismatch", current: entry.ptrTargets, action: "fix_ptr" });
  }
  return issues;
}

/** Findings for the whole tenant (all other open dns_mismatch are resolved). */
export function planDnsFindings(entries: readonly DnsContextEntry[]): DiscoveryPlan {
  const open: FindingOpen[] = [];
  for (const entry of entries) {
    const issues = dnsIssues(entry).filter((issue) => DNS_FINDING_ISSUES.includes(issue.issue));
    if (!issues.length) continue;
    open.push({
      address: entry.address,
      vrfId: entry.vrfId,
      kind: "dns_mismatch",
      severity: FINDING_SEVERITY.dns_mismatch,
      addressId: entry.addressId,
      prefixId: null,
      details: {
        expectedName: issues[0].expectedName,
        issues: issues.map((issue) => ({ issue: issue.issue, current: issue.current })),
      },
    });
  }
  return {
    vrfId: null,
    runKey: null,
    observations: [],
    addressUpdates: [],
    open,
    resolve: [],
    resolveOtherKinds: ["dns_mismatch"],
  };
}

// ---------------------------------------------------------------------------
// Jobs

export type JobPayloadResult = { ok: true; payload: Record<string, unknown> } | { ok: false; code: string };

/**
 * Validates job payloads (the agent validates them again before it runs
 * PowerShell). Names are DNS-safe, addresses parsed, MACs normalised.
 */
export function validateJobPayload(kind: JobKind, payload: unknown): JobPayloadResult {
  if (!isObject(payload)) return { ok: false, code: "payload_invalid" };
  if (kind === "scan_now") {
    const prefixIds = payload.prefixIds ?? [];
    if (!Array.isArray(prefixIds) || prefixIds.length > 100 || !prefixIds.every(isUuidText)) {
      return { ok: false, code: "payload_invalid" };
    }
    return { ok: true, payload: { prefixIds } };
  }
  const server = normalizeTargetHost(payload.server);
  if (!server) return { ok: false, code: "server_missing" };
  const address = parseIp(payload.address);
  if (kind === "dhcp_reserve" || kind === "dhcp_release") {
    const scopeId = parseIp(payload.scopeId);
    if (!address || address.family !== 4 || !scopeId || scopeId.family !== 4) {
      return { ok: false, code: "address_invalid" };
    }
    if (kind === "dhcp_release") {
      return { ok: true, payload: { server, scopeId: scopeId.address, address: address.address } };
    }
    const mac = normalizeMac(payload.mac);
    if (!mac) return { ok: false, code: "mac_missing" };
    const name = payload.name === undefined || payload.name === null ? null : normalizeHostname(payload.name);
    if (payload.name && !name) return { ok: false, code: "name_invalid" };
    const description = text(payload.description, 200)?.replace(/[`$"\\\r\n]/g, "") ?? null;
    return {
      ok: true,
      payload: { server, scopeId: scopeId.address, address: address.address, mac, name, description },
    };
  }
  const zone = normalizeHostname(payload.zone);
  if (!zone) return { ok: false, code: "zone_missing" };
  const ttl = payload.ttl === undefined || payload.ttl === null ? null : count(payload.ttl);
  if (kind === "dns_upsert_a") {
    const fqdn = normalizeHostname(payload.fqdn);
    if (!address || !fqdn || forwardZoneFor(fqdn, [zone]) !== zone) return { ok: false, code: "name_invalid" };
    const reverseZone = payload.reverseZone ? normalizeHostname(payload.reverseZone) : null;
    if (payload.reverseZone && (!reverseZone || reverseZoneFor(address.address, [reverseZone]) !== reverseZone)) {
      return { ok: false, code: "reverse_zone_invalid" };
    }
    return {
      ok: true,
      payload: {
        server,
        zone,
        fqdn,
        name: relativeName(fqdn, zone),
        address: address.address,
        type: address.family === 4 ? "A" : "AAAA",
        createPtr: payload.createPtr === true,
        reverseZone,
        replace: payload.replace !== false,
        ttl,
      },
    };
  }
  if (kind === "dns_upsert_ptr") {
    const target = normalizeHostname(payload.target);
    if (!address || !target) return { ok: false, code: "name_invalid" };
    if (reverseZoneFor(address.address, [zone]) !== zone) return { ok: false, code: "reverse_zone_invalid" };
    const reverse = reverseName(address.address)!;
    return {
      ok: true,
      payload: {
        server,
        zone,
        address: address.address,
        name: relativeName(reverse, zone),
        target,
        replace: payload.replace !== false,
        ttl,
      },
    };
  }
  // dns_delete
  const type = ["A", "AAAA", "PTR", "CNAME"].includes(String(payload.type)) ? String(payload.type) : null;
  const name = normalizeHostname(payload.fqdn);
  const value = typeof payload.value === "string" ? payload.value.trim().toLowerCase().replace(/\.$/, "") : "";
  if (!type || !name || !value || value.length > 253) return { ok: false, code: "payload_invalid" };
  if ((type === "A" || type === "AAAA") && !parseIp(value)) return { ok: false, code: "payload_invalid" };
  if ((type === "PTR" || type === "CNAME") && !normalizeHostname(value)) return { ok: false, code: "payload_invalid" };
  return {
    ok: true,
    payload: { server, zone, fqdn: name, name: relativeName(name, zone), type, value },
  };
}
