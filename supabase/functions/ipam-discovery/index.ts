import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import {
  AGENT_ONLINE_MS,
  type AgentConfig,
  createAgentToken,
  DEFAULT_AGENT_CONFIG,
  dnsIssues,
  forwardZoneFor,
  type JobKind,
  normalizeHostname,
  parseAgentConfig,
  parseDnsContext,
  parseIp,
  reverseZoneFor,
  sha256Hex,
  tokenHint,
  validateJobPayload,
} from "../_shared/ipam-discovery.ts";
import { resolveUserFeatureStates } from "../_shared/tenant-features.ts";

/**
 * IPAM discovery administration (web): agents (create with one-time token,
 * rotate, revoke, configure), scan runs, jobs (scan now, DHCP reservation,
 * DNS A/PTR), DHCP scopes/leases and DNS records with the comparison against
 * the IPAM, and «adopt ghost» (document an address from an observation).
 *
 * Reading needs ipam.read, all changes ipam.manage; feature `ipam.management`.
 * Rows are read and written with the service role after these checks.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 64 * 1024;
const FUNCTION_URL_HINT = "/functions/v1/ipam-agent";

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

type Operation = "dhcp_reserve" | "dhcp_release" | "dns_create" | "dns_fix_a" | "dns_create_ptr" | "dns_fix_ptr";
const OPERATIONS: Operation[] = ["dhcp_reserve", "dhcp_release", "dns_create", "dns_fix_a", "dns_create_ptr", "dns_fix_ptr"];

type Action =
  | { type: "overview"; tenantId: string }
  | { type: "createAgent"; tenantId: string; name: string; config: unknown }
  | { type: "updateAgent"; tenantId: string; agentId: string; name: string | null; config: unknown; status: "active" | "disabled" | null }
  | { type: "rotateToken"; tenantId: string; agentId: string }
  | { type: "revokeAgent"; tenantId: string; agentId: string }
  | { type: "scanNow"; tenantId: string; agentId: string; prefixIds: string[] }
  | { type: "queueJob"; tenantId: string; addressId: string; operation: Operation; agentId: string | null }
  | { type: "approveJob"; tenantId: string; jobId: string }
  | { type: "cancelJob"; tenantId: string; jobId: string }
  | { type: "dhcpDns"; tenantId: string; scopeId: string | null; search: string | null }
  | {
    type: "adoptGhost";
    tenantId: string;
    findingId: string;
    hostname: string | null;
    status: "active" | "reserved" | "dhcp";
    description: string | null;
  };

function name(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 120 ? trimmed : null;
}

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  const id = (field: unknown) => (isUuid(field) ? field.toLowerCase() : null);
  switch (value.type) {
    case "overview":
      return { type: "overview", tenantId };
    case "createAgent": {
      const agentName = name(value.name);
      return agentName ? { type: "createAgent", tenantId, name: agentName, config: value.config } : null;
    }
    case "updateAgent": {
      const agentId = id(value.agentId);
      if (!agentId) return null;
      const agentName = value.name === undefined ? null : name(value.name);
      if (value.name !== undefined && !agentName) return null;
      const status = value.status === "active" || value.status === "disabled" ? value.status : null;
      if (value.status !== undefined && !status) return null;
      return { type: "updateAgent", tenantId, agentId, name: agentName, config: value.config, status };
    }
    case "rotateToken":
    case "revokeAgent": {
      const agentId = id(value.agentId);
      return agentId ? { type: value.type, tenantId, agentId } : null;
    }
    case "scanNow": {
      const agentId = id(value.agentId);
      const prefixIds = value.prefixIds === undefined ? [] : value.prefixIds;
      if (!agentId || !Array.isArray(prefixIds) || prefixIds.length > 100 || !prefixIds.every(isUuid)) return null;
      return { type: "scanNow", tenantId, agentId, prefixIds: prefixIds.map((entry) => entry.toLowerCase()) };
    }
    case "queueJob": {
      const addressId = id(value.addressId);
      const operation = OPERATIONS.includes(value.operation as Operation) ? value.operation as Operation : null;
      const agentId = value.agentId === undefined || value.agentId === null ? null : id(value.agentId);
      if (!addressId || !operation || (value.agentId && !agentId)) return null;
      return { type: "queueJob", tenantId, addressId, operation, agentId };
    }
    case "approveJob":
    case "cancelJob": {
      const jobId = id(value.jobId);
      return jobId ? { type: value.type, tenantId, jobId } : null;
    }
    case "dhcpDns": {
      const scopeId = value.scopeId === undefined || value.scopeId === null ? null : id(value.scopeId);
      if (value.scopeId && !scopeId) return null;
      const search = typeof value.search === "string" && value.search.trim()
        ? value.search.trim().slice(0, 80)
        : null;
      return { type: "dhcpDns", tenantId, scopeId, search };
    }
    case "adoptGhost": {
      const findingId = id(value.findingId);
      if (!findingId) return null;
      const hostname = value.hostname === undefined || value.hostname === null || value.hostname === ""
        ? null
        : normalizeHostname(value.hostname);
      if (value.hostname && !hostname) return null;
      const status = value.status === "reserved" || value.status === "dhcp" ? value.status : "active";
      const description = typeof value.description === "string" && value.description.trim()
        ? value.description.trim().slice(0, 1000)
        : null;
      return { type: "adoptGhost", tenantId, findingId, hostname, status, description };
    }
    default:
      return null;
  }
}

async function readBody(request: Request): Promise<unknown> {
  const body = await request.text().catch(() => null);
  if (body === null || new TextEncoder().encode(body).length > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "payload_too_large", "Die Anfrage ist zu gross.");
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function dbFailure(): HttpError {
  return new HttpError(500, "database_error", "Die Daten konnten nicht verarbeitet werden.");
}

async function permissions(client: Client, tenantId: string) {
  const [manage, read] = await Promise.all([
    client.rpc("has_tenant_permission", { p_tenant_id: tenantId, p_permission_code: "ipam.manage" }),
    client.rpc("has_tenant_permission", { p_tenant_id: tenantId, p_permission_code: "ipam.read" }),
  ]);
  if (manage.error || read.error) {
    throw new HttpError(503, "permission_check_failed", "Die Berechtigung konnte nicht geprüft werden.");
  }
  return { canManage: manage.data === true, canRead: manage.data === true || read.data === true };
}

const CONFIG_ERRORS: Record<string, string> = {
  config_contains_secret:
    "Zugangsdaten (Community, Schlüssel, Passwörter) gehören in die lokale config.json des Agenten, nicht in nextDesk.",
  config_schedule_invalid: "Der Zeitplan ist ungültig (5 bis 1440 Minuten).",
  config_snmp_invalid: "Ein SNMP-Ziel ist ungültig.",
  config_snmp_user_invalid: "Für SNMPv3 braucht es einen gültigen Benutzernamen.",
  config_snmp_protocol_invalid: "Die SNMPv3-Protokolle sind ungültig (Verschlüsselung nur mit Authentifizierung).",
  config_servers_invalid: "Ein DHCP- oder DNS-Server ist ungültig.",
  config_zones_invalid: "Eine DNS-Zone ist ungültig.",
  config_prefixes_invalid: "Die Auswahl der Subnetze ist ungültig.",
  config_vrf_invalid: "Das VRF ist ungültig.",
};

function configOrThrow(value: unknown): AgentConfig {
  const parsed = parseAgentConfig(value);
  if (!parsed.ok) {
    throw new HttpError(422, parsed.code, CONFIG_ERRORS[parsed.code] ?? "Die Konfiguration ist ungültig.");
  }
  return parsed.config;
}

function agentView(row: Row, now = Date.now()) {
  const parsed = parseAgentConfig(row.config);
  const lastSeen = typeof row.last_seen_at === "string" ? Date.parse(row.last_seen_at) : NaN;
  const online = row.status === "active" && Number.isFinite(lastSeen) && now - lastSeen <= AGENT_ONLINE_MS;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    connection: row.status !== "active" ? row.status : online ? "online" : row.last_seen_at ? "offline" : "never",
    tokenHint: row.token_hint ?? null,
    tokenRotatedAt: row.token_rotated_at ?? null,
    version: row.version ?? null,
    hostname: row.hostname ?? null,
    platform: row.platform ?? null,
    capabilities: isRecord(row.capabilities) ? row.capabilities : {},
    lastSeenAt: row.last_seen_at ?? null,
    lastReportAt: row.last_report_at ?? null,
    lastError: row.last_error ?? null,
    createdAt: row.created_at ?? null,
    config: parsed.ok ? parsed.config : { ...DEFAULT_AGENT_CONFIG },
  };
}

const AGENT_SELECT =
  "id, name, status, token_hint, token_rotated_at, version, hostname, platform, capabilities, last_seen_at, last_report_at, last_error, created_at, config";

async function loadAgent(admin: Admin, tenantId: string, agentId: string): Promise<Row> {
  const { data, error } = await admin.from("ipam_agents").select(AGENT_SELECT)
    .eq("tenant_id", tenantId).eq("id", agentId).maybeSingle();
  if (error) throw dbFailure();
  if (!data || data.status === "revoked") throw new HttpError(404, "agent_not_found", "Der Agent ist nicht verfügbar.");
  return data;
}

function jobView(row: Row) {
  return {
    id: row.id,
    agentId: row.agent_id,
    kind: row.kind,
    status: row.status,
    payload: isRecord(row.payload) ? row.payload : {},
    result: row.result ?? null,
    error: row.error ?? null,
    addressId: row.address_id ?? null,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
  };
}

async function overview(request: Request, admin: Admin, tenantId: string, canManage: boolean) {
  const [agents, runs, jobs, prefixes, vrfs] = await Promise.all([
    admin.from("ipam_agents").select(AGENT_SELECT).eq("tenant_id", tenantId).neq("status", "revoked")
      .order("name").limit(100),
    admin.from("ipam_agent_runs").select("id, agent_id, run_key, trigger, started_at, finished_at, report_count, stats, errors")
      .eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(30),
    admin.from("ipam_agent_jobs").select("id, agent_id, kind, status, payload, result, error, address_id, created_at, started_at, finished_at")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50),
    admin.from("ipam_prefixes").select("id, prefix, description, status, vrf_id")
      .eq("tenant_id", tenantId).in("status", ["active", "reserved"]).order("prefix").limit(1000),
    admin.from("ipam_vrfs").select("id, name").eq("tenant_id", tenantId).order("name").limit(200),
  ]);
  if (agents.error || runs.error || jobs.error || prefixes.error || vrfs.error) throw dbFailure();
  const now = Date.now();
  return json(request, {
    data: {
      canManage,
      agentEndpoint: FUNCTION_URL_HINT,
      agents: ((agents.data ?? []) as Row[]).map((row) => agentView(row, now)),
      runs: ((runs.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        agentId: row.agent_id,
        runKey: row.run_key,
        trigger: row.trigger,
        startedAt: row.started_at,
        finishedAt: row.finished_at ?? null,
        reportCount: row.report_count ?? 0,
        stats: isRecord(row.stats) ? row.stats : {},
        errors: Array.isArray(row.errors) ? row.errors.slice(0, 10) : [],
      })),
      jobs: ((jobs.data ?? []) as Row[]).map(jobView),
      prefixes: ((prefixes.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        prefix: row.prefix,
        description: row.description ?? null,
        status: row.status,
        vrfId: row.vrf_id ?? null,
      })),
      vrfs: ((vrfs.data ?? []) as Row[]).map((row) => ({ id: row.id, name: row.name })),
    },
  });
}

async function createAgent(request: Request, admin: Admin, actorId: string, action: Extract<Action, { type: "createAgent" }>) {
  const config = configOrThrow(action.config);
  const id = crypto.randomUUID();
  const token = createAgentToken(id);
  const { data, error } = await admin.from("ipam_agents").insert({
    id,
    tenant_id: action.tenantId,
    name: action.name,
    token_hash: await sha256Hex(token),
    token_hint: tokenHint(token),
    config,
    created_by: actorId,
  }).select(AGENT_SELECT).single();
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "agent_exists", "Ein Agent mit diesem Namen existiert bereits.");
    throw dbFailure();
  }
  return json(request, { data: { agent: agentView(data), token } }, 201);
}

async function updateAgent(request: Request, admin: Admin, action: Extract<Action, { type: "updateAgent" }>) {
  await loadAgent(admin, action.tenantId, action.agentId);
  const update: Row = { updated_at: new Date().toISOString() };
  if (action.name) update.name = action.name;
  if (action.config !== undefined) update.config = configOrThrow(action.config);
  if (action.status) update.status = action.status;
  const { data, error } = await admin.from("ipam_agents").update(update)
    .eq("tenant_id", action.tenantId).eq("id", action.agentId).select(AGENT_SELECT).single();
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "agent_exists", "Ein Agent mit diesem Namen existiert bereits.");
    throw dbFailure();
  }
  return json(request, { data: { agent: agentView(data) } });
}

async function rotateToken(request: Request, admin: Admin, action: Extract<Action, { type: "rotateToken" }>) {
  await loadAgent(admin, action.tenantId, action.agentId);
  const token = createAgentToken(action.agentId);
  const { data, error } = await admin.from("ipam_agents").update({
    token_hash: await sha256Hex(token),
    token_hint: tokenHint(token),
    token_rotated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", action.tenantId).eq("id", action.agentId).select(AGENT_SELECT).single();
  if (error) throw dbFailure();
  return json(request, { data: { agent: agentView(data), token } });
}

async function revokeAgent(request: Request, admin: Admin, actorId: string, action: Extract<Action, { type: "revokeAgent" }>) {
  await loadAgent(admin, action.tenantId, action.agentId);
  // The stored hash is replaced, so the old token can never match again.
  const { error } = await admin.from("ipam_agents").update({
    status: "revoked",
    token_hash: await sha256Hex(crypto.randomUUID()),
    revoked_at: new Date().toISOString(),
    revoked_by: actorId,
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", action.tenantId).eq("id", action.agentId);
  if (error) throw dbFailure();
  await admin.from("ipam_agent_jobs").update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("tenant_id", action.tenantId).eq("agent_id", action.agentId).in("status", ["queued", "pending_approval"]);
  return json(request, { data: { revoked: true } });
}

async function insertJob(admin: Admin, row: Row) {
  const { data, error } = await admin.from("ipam_agent_jobs").insert(row)
    .select("id, agent_id, kind, status, payload, result, error, address_id, created_at, started_at, finished_at")
    .single();
  if (error) {
    if (error.code === "42501") {
      throw new HttpError(403, "approval_denied", "Schreibende Aufträge erfordern die Berechtigung zur IP-Verwaltung.");
    }
    throw dbFailure();
  }
  return jobView(data);
}

async function scanNow(request: Request, admin: Admin, actorId: string, action: Extract<Action, { type: "scanNow" }>) {
  const agent = await loadAgent(admin, action.tenantId, action.agentId);
  if (agent.status !== "active") throw new HttpError(409, "agent_disabled", "Der Agent ist deaktiviert.");
  const { data: pending } = await admin.from("ipam_agent_jobs").select("id")
    .eq("agent_id", action.agentId).eq("kind", "scan_now").in("status", ["queued", "running"]).limit(1);
  if (pending?.length) {
    throw new HttpError(409, "scan_pending", "Für diesen Agenten ist bereits ein Scan geplant oder läuft.");
  }
  const job = await insertJob(admin, {
    tenant_id: action.tenantId,
    agent_id: action.agentId,
    kind: "scan_now",
    payload: { prefixIds: action.prefixIds },
    created_by: actorId,
  });
  return json(request, { data: { job } }, 201);
}

type ZoneRow = { server: string; zone: string };

async function knownZones(admin: Admin, tenantId: string): Promise<ZoneRow[]> {
  const { data, error } = await admin.rpc("ipam_dns_zones", { p_tenant_id: tenantId });
  if (error) throw dbFailure();
  return (Array.isArray(data) ? data : []).flatMap((entry: unknown) =>
    isRecord(entry) && typeof entry.server === "string" && typeof entry.zone === "string"
      ? [{ server: entry.server, zone: entry.zone }]
      : []
  );
}

function ipv4Number(address: string): number {
  return address.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
}

/** DHCP scope (network + mask) that contains an IPv4 address. */
export function scopeContains(scopeId: string, subnetMask: string | null, address: string): boolean {
  const scope = parseIp(scopeId);
  const ip = parseIp(address);
  if (!scope || !ip || scope.family !== 4 || ip.family !== 4) return false;
  const mask = subnetMask && parseIp(subnetMask)?.family === 4 ? ipv4Number(subnetMask) : 0xffffff00;
  return ((ipv4Number(ip.address) & mask) >>> 0) === ((ipv4Number(scope.address) & mask) >>> 0);
}

/** Expected FQDN of an address: dns_name, or hostname plus default zone. */
export function expectedFqdn(
  hostname: string | null,
  dnsName: string | null,
  defaultZone: string | null,
  zones: readonly string[],
): string | null {
  const explicit = normalizeHostname(dnsName);
  if (explicit) return explicit;
  const host = normalizeHostname(hostname);
  if (!host) return null;
  if (host.includes(".") && forwardZoneFor(host, zones)) return host;
  const zone = defaultZone ?? (zones.filter((entry) => !/\.arpa$/.test(entry)).length === 1
    ? zones.find((entry) => !/\.arpa$/.test(entry))!
    : null);
  return zone ? `${host.split(".")[0]}.${zone}` : null;
}

async function queueJob(request: Request, admin: Admin, actorId: string, action: Extract<Action, { type: "queueJob" }>) {
  const { data: address, error } = await admin.from("ipam_addresses")
    .select("id, address, vrf_id, hostname, dns_name, mac_address, status, description")
    .eq("tenant_id", action.tenantId).eq("id", action.addressId).maybeSingle();
  if (error) throw dbFailure();
  if (!address) throw new HttpError(404, "address_not_found", "Die Adresse ist nicht verfügbar.");
  const ip = parseIp(String(address.address));
  if (!ip) throw new HttpError(422, "address_invalid", "Die Adresse ist ungültig.");

  const { data: agentRows, error: agentError } = await admin.from("ipam_agents").select(AGENT_SELECT)
    .eq("tenant_id", action.tenantId).eq("status", "active").limit(100);
  if (agentError) throw dbFailure();
  const agents = ((agentRows ?? []) as Row[]).map((row) => agentView(row));
  const pickAgent = (server: string, kind: "dhcp" | "dns") => {
    const candidates = agents.filter((agent) =>
      (!action.agentId || agent.id === action.agentId) &&
      (kind === "dhcp" ? agent.config.dhcpServers : agent.config.dnsServers).includes(server)
    );
    if (!candidates.length) {
      throw new HttpError(422, "agent_missing", `Kein aktiver Agent ist für den Server «${server}» eingerichtet.`);
    }
    const writer = candidates.find((agent) => agent.config.allowWrites);
    if (!writer) {
      throw new HttpError(
        422,
        "writes_disabled",
        "Schreiben ist für diesen Agenten nicht freigegeben. Aktivieren Sie «Änderungen an DHCP/DNS erlauben» in der Agent-Konfiguration.",
      );
    }
    return writer;
  };

  let kind: JobKind;
  let rawPayload: Record<string, unknown>;
  let agentId: string;
  if (action.operation === "dhcp_reserve" || action.operation === "dhcp_release") {
    if (ip.family !== 4) throw new HttpError(422, "dhcp_ipv4_only", "DHCP-Reservierungen gibt es nur für IPv4.");
    const { data: scopes, error: scopeError } = await admin.from("ipam_dhcp_scopes")
      .select("id, server, scope_id, subnet_mask").eq("tenant_id", action.tenantId).limit(1000);
    if (scopeError) throw dbFailure();
    const scope = ((scopes ?? []) as Row[]).find((row) =>
      scopeContains(String(row.scope_id), row.subnet_mask ? String(row.subnet_mask) : null, ip.address)
    );
    if (!scope) {
      throw new HttpError(422, "scope_missing", "Kein bekannter DHCP-Bereich enthält diese Adresse. Lassen Sie den Agenten zuerst scannen.");
    }
    const server = String(scope.server);
    agentId = pickAgent(server, "dhcp").id as string;
    if (action.operation === "dhcp_reserve") {
      if (!address.mac_address) {
        throw new HttpError(422, "mac_missing", "Für eine Reservierung braucht die Adresse eine MAC-Adresse.");
      }
      kind = "dhcp_reserve";
      rawPayload = {
        server,
        scopeId: String(scope.scope_id).replace(/\/32$/, ""),
        address: ip.address,
        mac: address.mac_address,
        name: address.dns_name ?? address.hostname ?? null,
        description: address.description ?? "nextDesk IPAM",
      };
    } else {
      kind = "dhcp_release";
      rawPayload = { server, scopeId: String(scope.scope_id).replace(/\/32$/, ""), address: ip.address };
    }
  } else {
    const zones = await knownZones(admin, action.tenantId);
    const configZones = agents.flatMap((agent) => agent.config.dnsZones);
    const zoneNames = [...new Set([...zones.map((zone) => zone.zone), ...configZones])];
    const defaultZone = agents.find((agent) => agent.config.dnsDefaultZone)?.config.dnsDefaultZone ?? null;
    const fqdn = expectedFqdn(address.hostname ?? null, address.dns_name ?? null, defaultZone, zoneNames);
    if (!fqdn) {
      throw new HttpError(422, "name_missing", "Für DNS braucht die Adresse einen Hostnamen und eine bekannte Zone.");
    }
    const reverseZone = reverseZoneFor(ip.address, zoneNames);
    const serverFor = (zone: string) =>
      zones.find((entry) => entry.zone === zone)?.server ??
        agents.find((agent) => agent.config.dnsZones.includes(zone))?.config.dnsServers[0] ??
        agents.find((agent) => agent.config.dnsServers.length)?.config.dnsServers[0] ?? null;
    if (action.operation === "dns_create" || action.operation === "dns_fix_a") {
      const zone = forwardZoneFor(fqdn, zoneNames);
      if (!zone) throw new HttpError(422, "zone_unknown", `Für «${fqdn}» ist keine DNS-Zone bekannt.`);
      const server = serverFor(zone);
      if (!server) throw new HttpError(422, "agent_missing", "Kein Agent ist für DNS eingerichtet.");
      agentId = pickAgent(server, "dns").id as string;
      kind = "dns_upsert_a";
      rawPayload = {
        server,
        zone,
        fqdn,
        address: ip.address,
        createPtr: action.operation === "dns_create" && reverseZone !== null,
        reverseZone: action.operation === "dns_create" ? reverseZone : null,
        replace: true,
      };
    } else {
      if (!reverseZone) {
        throw new HttpError(422, "reverse_zone_unknown", "Für diese Adresse ist keine Reverse-Zone bekannt.");
      }
      const server = serverFor(reverseZone);
      if (!server) throw new HttpError(422, "agent_missing", "Kein Agent ist für DNS eingerichtet.");
      agentId = pickAgent(server, "dns").id as string;
      kind = "dns_upsert_ptr";
      rawPayload = { server, zone: reverseZone, address: ip.address, target: fqdn, replace: true };
    }
  }
  const validated = validateJobPayload(kind, rawPayload);
  if (!validated.ok) {
    throw new HttpError(422, validated.code, "Der Auftrag konnte nicht erstellt werden (ungültige Angaben).");
  }
  const job = await insertJob(admin, {
    tenant_id: action.tenantId,
    agent_id: agentId,
    kind,
    payload: validated.payload,
    address_id: action.addressId,
    created_by: actorId,
    approved_by: actorId,
    status: "queued",
  });
  return json(request, { data: { job } }, 201);
}

async function approveJob(request: Request, admin: Admin, actorId: string, action: Extract<Action, { type: "approveJob" }>) {
  const { data, error } = await admin.from("ipam_agent_jobs")
    .update({ status: "queued", approved_by: actorId, approved_at: new Date().toISOString() })
    .eq("tenant_id", action.tenantId).eq("id", action.jobId).eq("status", "pending_approval")
    .select("id, agent_id, kind, status, payload, result, error, address_id, created_at, started_at, finished_at")
    .maybeSingle();
  if (error) {
    if (error.code === "42501") throw new HttpError(403, "approval_denied", "Sie dürfen diesen Auftrag nicht freigeben.");
    throw dbFailure();
  }
  if (!data) throw new HttpError(409, "job_not_pending", "Der Auftrag wartet nicht auf eine Freigabe.");
  return json(request, { data: { job: jobView(data) } });
}

async function cancelJob(request: Request, admin: Admin, action: Extract<Action, { type: "cancelJob" }>) {
  const { data, error } = await admin.from("ipam_agent_jobs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("tenant_id", action.tenantId).eq("id", action.jobId).in("status", ["queued", "pending_approval"])
    .select("id, agent_id, kind, status, payload, result, error, address_id, created_at, started_at, finished_at")
    .maybeSingle();
  if (error) throw dbFailure();
  if (!data) throw new HttpError(409, "job_not_cancellable", "Der Auftrag läuft bereits oder ist abgeschlossen.");
  return json(request, { data: { job: jobView(data) } });
}

async function dhcpDns(request: Request, admin: Admin, action: Extract<Action, { type: "dhcpDns" }>) {
  const scopes = await admin.from("ipam_dhcp_scopes")
    .select("id, server, scope_id, subnet_mask, name, state, start_range, end_range, addresses_in_use, addresses_free, addresses_reserved, prefix_id, seen_at")
    .eq("tenant_id", action.tenantId).order("scope_id").limit(1000);
  if (scopes.error) throw dbFailure();
  const scopeRows = (scopes.data ?? []) as Row[];
  const scopeId = action.scopeId ?? (scopeRows[0]?.id as string | undefined) ?? null;
  let leaseQuery = admin.from("ipam_dhcp_leases")
    .select("id, scope_ref, server, address, mac, hostname, state, expires_at, reservation, reservation_name, seen_at")
    .eq("tenant_id", action.tenantId).order("address").limit(1000);
  if (scopeId) leaseQuery = leaseQuery.eq("scope_ref", scopeId);
  let recordQuery = admin.from("ipam_dns_records")
    .select("id, server, zone, name, type, value, address, ttl, seen_at")
    .eq("tenant_id", action.tenantId).order("name").limit(500);
  if (action.search) {
    const pattern = `%${action.search.replace(/[%_,()*\\]/g, "")}%`;
    recordQuery = recordQuery.or(`name.ilike.${pattern},value.ilike.${pattern}`);
  }
  const [leases, records, zones, dnsContext] = await Promise.all([
    scopeId ? leaseQuery : Promise.resolve({ data: [], error: null }),
    recordQuery,
    admin.rpc("ipam_dns_zones", { p_tenant_id: action.tenantId }),
    admin.rpc("ipam_dns_context", { p_tenant_id: action.tenantId }),
  ]);
  if (leases.error || records.error || zones.error || dnsContext.error) throw dbFailure();
  const hasDns = Array.isArray(zones.data) && zones.data.length > 0;
  const diff = hasDns ? parseDnsContext(dnsContext.data).flatMap(dnsIssues).slice(0, 500) : [];
  const strip = (value: unknown) => (typeof value === "string" ? value.replace(/\/(32|128)$/, "") : null);
  return json(request, {
    data: {
      scopes: scopeRows.map((row) => ({
        id: row.id,
        server: row.server,
        scopeId: strip(row.scope_id),
        subnetMask: strip(row.subnet_mask),
        name: row.name ?? null,
        state: row.state ?? null,
        startRange: strip(row.start_range),
        endRange: strip(row.end_range),
        inUse: row.addresses_in_use ?? null,
        free: row.addresses_free ?? null,
        reserved: row.addresses_reserved ?? null,
        prefixId: row.prefix_id ?? null,
        seenAt: row.seen_at,
      })),
      selectedScopeId: scopeId,
      leases: ((leases.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        scopeId: row.scope_ref,
        server: row.server,
        address: strip(row.address),
        mac: row.mac ?? null,
        hostname: row.hostname ?? null,
        state: row.state ?? null,
        expiresAt: row.expires_at ?? null,
        reservation: row.reservation === true,
        reservationName: row.reservation_name ?? null,
      })),
      zones: Array.isArray(zones.data) ? zones.data : [],
      records: ((records.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        server: row.server,
        zone: row.zone,
        name: row.name,
        type: row.type,
        value: row.value,
        ttl: row.ttl ?? null,
      })),
      diff,
    },
  });
}

async function adoptGhost(request: Request, admin: Admin, actorId: string, action: Extract<Action, { type: "adoptGhost" }>) {
  const { data: finding, error } = await admin.from("ipam_findings")
    .select("id, vrf_id, address, kind, status, details")
    .eq("tenant_id", action.tenantId).eq("id", action.findingId).maybeSingle();
  if (error) throw dbFailure();
  if (!finding || finding.kind !== "ghost" || finding.status !== "open") {
    throw new HttpError(404, "finding_not_found", "Der Fund ist nicht mehr offen.");
  }
  const address = String(finding.address).replace(/\/(32|128)$/, "");
  let observationQuery = admin.from("ipam_observations")
    .select("mac, hostname, vendor, switch_name, switch_port, seen_at, sources")
    .eq("tenant_id", action.tenantId).eq("address", address);
  observationQuery = finding.vrf_id ? observationQuery.eq("vrf_id", finding.vrf_id) : observationQuery.is("vrf_id", null);
  const { data: observation } = await observationQuery.maybeSingle();
  const details = isRecord(finding.details) ? finding.details : {};
  const hostname = action.hostname ??
    normalizeHostname(observation?.hostname) ??
    normalizeHostname(details.hostname) ?? null;
  const { data: created, error: insertError } = await admin.from("ipam_addresses").insert({
    tenant_id: action.tenantId,
    vrf_id: finding.vrf_id ?? null,
    address,
    status: action.status,
    hostname: hostname ? hostname.toUpperCase() : null,
    description: action.description,
    mac_address: observation?.mac ?? details.mac ?? null,
    vendor: observation?.vendor ?? details.vendor ?? null,
    switch_name: observation?.switch_name ?? details.switchName ?? null,
    switch_port: observation?.switch_port ?? details.switchPort ?? null,
    last_seen_at: observation?.seen_at ?? null,
    last_seen_source: Array.isArray(observation?.sources) ? observation.sources.join(",").slice(0, 40) : null,
    created_by: actorId,
  }).select("id").single();
  if (insertError) {
    if (insertError.code === "23505") {
      throw new HttpError(409, "address_exists", "Diese Adresse ist bereits dokumentiert.");
    }
    throw dbFailure();
  }
  await admin.from("ipam_address_events").insert({
    tenant_id: action.tenantId,
    address_id: created.id,
    actor_id: actorId,
    kind: "created",
    details: { source: "discovery", findingId: finding.id },
  });
  await admin.from("ipam_findings").update({
    status: "resolved",
    resolved_at: new Date().toISOString(),
    resolved_by: actorId,
    address_id: created.id,
  }).eq("tenant_id", action.tenantId).eq("id", finding.id);
  return json(request, { data: { addressId: created.id } }, 201);
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") return json(request, { error: { code: "method_not_allowed" } }, 405);
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) return json(request, { error: { code: "unauthorized" } }, 401);
      const action = parseAction(await readBody(request));
      if (!action) {
        return json(
          request,
          { error: { code: "invalid_request", message: "Die Angaben sind unvollständig oder ungültig." } },
          422,
        );
      }
      const admin = context.supabaseAdmin;
      const features = await resolveUserFeatureStates(admin, action.tenantId, actorId, ["ipam.management"]);
      if (features?.["ipam.management"] !== true) {
        throw new HttpError(403, "feature_disabled", "Die IP-Adressverwaltung ist für Sie nicht eingeschaltet.");
      }
      const access = await permissions(context.supabase, action.tenantId);
      if (!access.canRead) {
        throw new HttpError(403, "access_denied", "Für die IP-Adressverwaltung fehlt Ihnen die Berechtigung.");
      }
      if (action.type === "overview") return await overview(request, admin, action.tenantId, access.canManage);
      if (action.type === "dhcpDns") return await dhcpDns(request, admin, action);
      if (!access.canManage) {
        throw new HttpError(403, "manage_denied", "Änderungen erfordern die Berechtigung zur IP-Verwaltung.");
      }
      switch (action.type) {
        case "createAgent":
          return await createAgent(request, admin, actorId, action);
        case "updateAgent":
          return await updateAgent(request, admin, action);
        case "rotateToken":
          return await rotateToken(request, admin, action);
        case "revokeAgent":
          return await revokeAgent(request, admin, actorId, action);
        case "scanNow":
          return await scanNow(request, admin, actorId, action);
        case "queueJob":
          return await queueJob(request, admin, actorId, action);
        case "approveJob":
          return await approveJob(request, admin, actorId, action);
        case "cancelJob":
          return await cancelJob(request, admin, action);
        case "adoptGhost":
          return await adoptGhost(request, admin, actorId, action);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return json(request, { error: { code: error.code, message: error.message } }, error.status);
      }
      console.error("ipam_discovery_failed", error instanceof Error ? error.message : typeof error);
      return json(request, { error: { code: "internal_error" } }, 500);
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};
