/**
 * IPAM-Discovery (web): parsing of the `ipam-discovery` responses and pure
 * helpers for labels, status, utilisation and the agent configuration form.
 */

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export type SnmpTargetConfig = {
  host: string;
  version: "v2c" | "v3";
  user: string | null;
  authProtocol: string | null;
  privProtocol: string | null;
  collect: ("arp" | "fdb" | "lldp")[];
};

export type AgentConfig = {
  scanAllActive: boolean;
  prefixIds: string[];
  scheduleMinutes: number;
  pingTimeoutMs: number;
  pingConcurrency: number;
  snmpTargets: SnmpTargetConfig[];
  dhcpServers: string[];
  dnsServers: string[];
  dnsZones: string[];
  dnsDefaultZone: string | null;
  allowWrites: boolean;
  vrfId: string | null;
};

export type DiscoveryAgent = {
  id: string;
  name: string;
  status: "active" | "disabled" | "revoked";
  connection: "online" | "offline" | "never" | "disabled" | "revoked";
  tokenHint: string | null;
  tokenRotatedAt: string | null;
  version: string | null;
  hostname: string | null;
  platform: string | null;
  lastSeenAt: string | null;
  lastReportAt: string | null;
  /** Ausfall gemeldet (Benachrichtigung «Netzwerkagent offline»). */
  offlineNotifiedAt: string | null;
  lastError: string | null;
  config: AgentConfig;
};

export type DiscoveryRun = {
  id: string;
  agentId: string;
  trigger: "schedule" | "manual" | "startup";
  startedAt: string;
  finishedAt: string | null;
  reportCount: number;
  stats: Record<string, number>;
  errors: string[];
};

export type JobKind =
  | "scan_now"
  | "dhcp_reserve"
  | "dhcp_release"
  | "dns_upsert_a"
  | "dns_upsert_ptr"
  | "dns_delete";
export type JobStatus =
  "pending_approval" | "queued" | "running" | "done" | "failed" | "cancelled";

export type DiscoveryJob = {
  id: string;
  agentId: string;
  kind: JobKind;
  status: JobStatus;
  payload: Record<string, unknown>;
  error: string | null;
  addressId: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type PrefixOption = {
  id: string;
  prefix: string;
  description: string | null;
  vrfId: string | null;
};

export type DiscoveryOverview = {
  canManage: boolean;
  agents: DiscoveryAgent[];
  runs: DiscoveryRun[];
  jobs: DiscoveryJob[];
  prefixes: PrefixOption[];
  vrfs: { id: string; name: string }[];
};

export type DhcpScope = {
  id: string;
  server: string;
  scopeId: string;
  subnetMask: string | null;
  name: string | null;
  state: string | null;
  startRange: string | null;
  endRange: string | null;
  inUse: number | null;
  free: number | null;
  reserved: number | null;
  prefixId: string | null;
};

export type DhcpLease = {
  id: string;
  address: string;
  mac: string | null;
  hostname: string | null;
  state: string | null;
  expiresAt: string | null;
  reservation: boolean;
};

export type DnsRecord = {
  id: string;
  server: string;
  zone: string;
  name: string;
  type: string;
  value: string;
  ttl: number | null;
};

export type DnsIssueKind =
  "missing_a" | "a_mismatch" | "a_other_name" | "missing_ptr" | "ptr_mismatch";
export type DnsAction = "create_a" | "fix_a" | "create_ptr" | "fix_ptr";

export type DnsDiffRow = {
  addressId: string;
  address: string;
  expectedName: string;
  issue: DnsIssueKind;
  current: string[];
  action: DnsAction;
};

export type DhcpDnsData = {
  scopes: DhcpScope[];
  selectedScopeId: string | null;
  leases: DhcpLease[];
  zones: { server: string; zone: string; records: number }[];
  records: DnsRecord[];
  diff: DnsDiffRow[];
};

export type QueueOperation =
  | "dhcp_reserve"
  | "dhcp_release"
  | "dns_create"
  | "dns_fix_a"
  | "dns_create_ptr"
  | "dns_fix_ptr";

// ---------------------------------------------------------------------------
// Parsing

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const str = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
function list<T>(
  value: unknown,
  map: (entry: Record<string, unknown>) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const mapped = map(entry);
    return mapped === null ? [] : [mapped];
  });
}

export const EMPTY_CONFIG: AgentConfig = {
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

export function parseConfig(value: unknown): AgentConfig {
  if (!isRecord(value)) return { ...EMPTY_CONFIG };
  return {
    scanAllActive: value.scanAllActive !== false,
    prefixIds: strings(value.prefixIds),
    scheduleMinutes: num(value.scheduleMinutes) ?? 60,
    pingTimeoutMs: num(value.pingTimeoutMs) ?? 1000,
    pingConcurrency: num(value.pingConcurrency) ?? 64,
    snmpTargets: list(value.snmpTargets, (entry) => {
      const host = str(entry.host);
      if (!host) return null;
      const collect = strings(entry.collect).filter(
        (item): item is "arp" | "fdb" | "lldp" =>
          item === "arp" || item === "fdb" || item === "lldp",
      );
      return {
        host,
        version: entry.version === "v2c" ? "v2c" : "v3",
        user: str(entry.user),
        authProtocol: str(entry.authProtocol),
        privProtocol: str(entry.privProtocol),
        collect: collect.length ? collect : ["arp", "fdb", "lldp"],
      };
    }),
    dhcpServers: strings(value.dhcpServers),
    dnsServers: strings(value.dnsServers),
    dnsZones: strings(value.dnsZones),
    dnsDefaultZone: str(value.dnsDefaultZone),
    allowWrites: value.allowWrites === true,
    vrfId: str(value.vrfId),
  };
}

const CONNECTIONS = [
  "online",
  "offline",
  "never",
  "disabled",
  "revoked",
] as const;
const STATUSES = ["active", "disabled", "revoked"] as const;

export function parseAgent(
  entry: Record<string, unknown>,
): DiscoveryAgent | null {
  const id = str(entry.id);
  const name = str(entry.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    status: (STATUSES as readonly unknown[]).includes(entry.status)
      ? (entry.status as DiscoveryAgent["status"])
      : "active",
    connection: (CONNECTIONS as readonly unknown[]).includes(entry.connection)
      ? (entry.connection as DiscoveryAgent["connection"])
      : "never",
    tokenHint: str(entry.tokenHint),
    tokenRotatedAt: str(entry.tokenRotatedAt),
    version: str(entry.version),
    hostname: str(entry.hostname),
    platform: str(entry.platform),
    lastSeenAt: str(entry.lastSeenAt),
    lastReportAt: str(entry.lastReportAt),
    offlineNotifiedAt: str(entry.offlineNotifiedAt),
    lastError: str(entry.lastError),
    config: parseConfig(entry.config),
  };
}

const JOB_KINDS: readonly JobKind[] = [
  "scan_now",
  "dhcp_reserve",
  "dhcp_release",
  "dns_upsert_a",
  "dns_upsert_ptr",
  "dns_delete",
];
const JOB_STATUSES: readonly JobStatus[] = [
  "pending_approval",
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
];

export function parseJob(entry: Record<string, unknown>): DiscoveryJob | null {
  const id = str(entry.id);
  const kind = JOB_KINDS.find((item) => item === entry.kind);
  const status = JOB_STATUSES.find((item) => item === entry.status);
  if (!id || !kind || !status) return null;
  return {
    id,
    agentId: str(entry.agentId) ?? "",
    kind,
    status,
    payload: isRecord(entry.payload) ? entry.payload : {},
    error: str(entry.error),
    addressId: str(entry.addressId),
    createdAt: str(entry.createdAt) ?? "",
    finishedAt: str(entry.finishedAt),
  };
}

export function parseOverview(value: unknown): DiscoveryOverview | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  return {
    canManage: data.canManage === true,
    agents: list(data.agents, parseAgent),
    runs: list(data.runs, (entry) => {
      const id = str(entry.id);
      if (!id) return null;
      const stats: Record<string, number> = {};
      if (isRecord(entry.stats)) {
        for (const [key, item] of Object.entries(entry.stats)) {
          if (typeof item === "number") stats[key] = item;
        }
      }
      return {
        id,
        agentId: str(entry.agentId) ?? "",
        trigger:
          entry.trigger === "manual" || entry.trigger === "startup"
            ? entry.trigger
            : "schedule",
        startedAt: str(entry.startedAt) ?? "",
        finishedAt: str(entry.finishedAt),
        reportCount: num(entry.reportCount) ?? 0,
        stats,
        errors: strings(entry.errors),
      };
    }),
    jobs: list(data.jobs, parseJob),
    prefixes: list(data.prefixes, (entry) => {
      const id = str(entry.id);
      const prefix = str(entry.prefix);
      return id && prefix
        ? {
            id,
            prefix,
            description: str(entry.description),
            vrfId: str(entry.vrfId),
          }
        : null;
    }),
    vrfs: list(data.vrfs, (entry) => {
      const id = str(entry.id);
      const name = str(entry.name);
      return id && name ? { id, name } : null;
    }),
  };
}

const ISSUES: readonly DnsIssueKind[] = [
  "missing_a",
  "a_mismatch",
  "a_other_name",
  "missing_ptr",
  "ptr_mismatch",
];
const ACTIONS: readonly DnsAction[] = [
  "create_a",
  "fix_a",
  "create_ptr",
  "fix_ptr",
];

export function parseDhcpDns(value: unknown): DhcpDnsData | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  return {
    scopes: list(data.scopes, (entry) => {
      const id = str(entry.id);
      const scopeId = str(entry.scopeId);
      const server = str(entry.server);
      if (!id || !scopeId || !server) return null;
      return {
        id,
        server,
        scopeId,
        subnetMask: str(entry.subnetMask),
        name: str(entry.name),
        state: str(entry.state),
        startRange: str(entry.startRange),
        endRange: str(entry.endRange),
        inUse: num(entry.inUse),
        free: num(entry.free),
        reserved: num(entry.reserved),
        prefixId: str(entry.prefixId),
      };
    }),
    selectedScopeId: str(data.selectedScopeId),
    leases: list(data.leases, (entry) => {
      const id = str(entry.id);
      const address = str(entry.address);
      if (!id || !address) return null;
      return {
        id,
        address,
        mac: str(entry.mac),
        hostname: str(entry.hostname),
        state: str(entry.state),
        expiresAt: str(entry.expiresAt),
        reservation: entry.reservation === true,
      };
    }),
    zones: list(data.zones, (entry) => {
      const server = str(entry.server);
      const zone = str(entry.zone);
      return server && zone
        ? { server, zone, records: num(entry.records) ?? 0 }
        : null;
    }),
    records: list(data.records, (entry) => {
      const id = str(entry.id);
      const name = str(entry.name);
      const type = str(entry.type);
      const value = str(entry.value);
      if (!id || !name || !type || !value) return null;
      return {
        id,
        server: str(entry.server) ?? "",
        zone: str(entry.zone) ?? "",
        name,
        type,
        value,
        ttl: num(entry.ttl),
      };
    }),
    diff: list(data.diff, (entry) => {
      const addressId = str(entry.addressId);
      const address = str(entry.address);
      const expectedName = str(entry.expectedName);
      const issue = ISSUES.find((item) => item === entry.issue);
      const action = ACTIONS.find((item) => item === entry.action);
      if (!addressId || !address || !expectedName || !issue || !action)
        return null;
      return {
        addressId,
        address,
        expectedName,
        issue,
        current: strings(entry.current),
        action,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Labels and status

export function connectionLabel(agent: Pick<DiscoveryAgent, "connection">): {
  label: string;
  tone: Tone;
} {
  switch (agent.connection) {
    case "online":
      return { label: "Online", tone: "success" };
    case "offline":
      return { label: "Offline", tone: "danger" };
    case "disabled":
      return { label: "Deaktiviert", tone: "neutral" };
    case "revoked":
      return { label: "Widerrufen", tone: "neutral" };
    default:
      return { label: "Noch nie verbunden", tone: "warning" };
  }
}

export const JOB_KIND_LABELS: Record<JobKind, string> = {
  scan_now: "Scan",
  dhcp_reserve: "DHCP-Reservierung anlegen",
  dhcp_release: "DHCP-Reservierung entfernen",
  dns_upsert_a: "A-Record setzen",
  dns_upsert_ptr: "PTR-Record setzen",
  dns_delete: "DNS-Record löschen",
};

export function jobStatusLabel(status: JobStatus): {
  label: string;
  tone: Tone;
} {
  switch (status) {
    case "pending_approval":
      return { label: "Wartet auf Freigabe", tone: "warning" };
    case "queued":
      return { label: "Wartet auf Agent", tone: "info" };
    case "running":
      return { label: "Läuft", tone: "info" };
    case "done":
      return { label: "Erledigt", tone: "success" };
    case "failed":
      return { label: "Fehlgeschlagen", tone: "danger" };
    default:
      return { label: "Abgebrochen", tone: "neutral" };
  }
}

export const DNS_ISSUE_LABELS: Record<DnsIssueKind, string> = {
  missing_a: "A-Record fehlt",
  a_mismatch: "A-Record stimmt nicht",
  a_other_name: "Anderer Name im DNS",
  missing_ptr: "PTR fehlt",
  ptr_mismatch: "PTR stimmt nicht",
};

export const DNS_ACTION_LABELS: Record<DnsAction, string> = {
  create_a: "A-Record anlegen",
  fix_a: "A-Record korrigieren",
  create_ptr: "PTR anlegen",
  fix_ptr: "PTR korrigieren",
};

export function dnsActionOperation(action: DnsAction): QueueOperation {
  switch (action) {
    case "create_a":
      return "dns_create";
    case "fix_a":
      return "dns_fix_a";
    case "create_ptr":
      return "dns_create_ptr";
    default:
      return "dns_fix_ptr";
  }
}

/** Short description of what a job does («10.20.30.21 → dru-01.schule.local»). */
export function jobSummary(job: DiscoveryJob): string {
  const p = job.payload;
  const text = (key: string) =>
    typeof p[key] === "string" ? (p[key] as string) : "";
  switch (job.kind) {
    case "scan_now": {
      const count = Array.isArray(p.prefixIds) ? p.prefixIds.length : 0;
      return count ? `${count} Subnetz(e)` : "alle Subnetze";
    }
    case "dhcp_reserve":
      return `${text("address")} ↔ ${text("mac")} (${text("server")})`;
    case "dhcp_release":
      return `${text("address")} (${text("server")})`;
    case "dns_upsert_a":
      return `${text("fqdn")} → ${text("address")}${p.createPtr === true ? " mit PTR" : ""}`;
    case "dns_upsert_ptr":
      return `${text("address")} → ${text("target")}`;
    default:
      return `${text("fqdn")} ${text("type")} ${text("value")}`.trim();
  }
}

export function isJobOpen(job: Pick<DiscoveryJob, "status">): boolean {
  return (
    job.status === "queued" ||
    job.status === "running" ||
    job.status === "pending_approval"
  );
}

/** «vor 4 Min.», «vor 2 Std.», «vor 3 Tagen», «noch nie». */
export function relativeTime(
  value: string | null,
  now: number = Date.now(),
): string {
  if (!value) return "noch nie";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "unbekannt";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return "gerade eben";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  return `vor ${days} Tagen`;
}

export function runDuration(
  run: Pick<DiscoveryRun, "startedAt" | "finishedAt">,
): string {
  if (!run.finishedAt) return "läuft";
  const seconds = Math.max(
    0,
    Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000),
  );
  if (!Number.isFinite(seconds)) return "–";
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function runSummary(run: Pick<DiscoveryRun, "stats">): string {
  const s = run.stats;
  const parts: string[] = [];
  if (s.pinged !== undefined)
    parts.push(`${s.alive ?? 0} von ${s.pinged} Adressen antworten`);
  if (s.snmpTargets) parts.push(`SNMP ${s.snmpOk ?? 0}/${s.snmpTargets}`);
  if (s.macEntries) parts.push(`${s.macEntries} MAC-Einträge`);
  if (s.dhcpLeases !== undefined) parts.push(`${s.dhcpLeases} Leases`);
  if (s.dnsRecords !== undefined) parts.push(`${s.dnsRecords} DNS-Records`);
  return parts.join(" · ") || "keine Angaben";
}

/** DHCP scope utilisation in percent (in use + reserved of all addresses). */
export function scopeUtilization(
  scope: Pick<DhcpScope, "inUse" | "free" | "reserved">,
): number | null {
  if (scope.inUse === null || scope.free === null) return null;
  const used = scope.inUse + (scope.reserved ?? 0);
  const total = scope.inUse + scope.free + (scope.reserved ?? 0);
  if (total <= 0) return null;
  return Math.min(100, Math.round((used / total) * 100));
}

export function utilizationTone(percent: number | null): Tone {
  if (percent === null) return "neutral";
  if (percent >= 95) return "danger";
  if (percent >= 85) return "warning";
  return "success";
}

// ---------------------------------------------------------------------------
// Configuration form

export type SnmpRow = {
  host: string;
  version: "v2c" | "v3";
  user: string;
  authProtocol: string;
  privProtocol: string;
  arp: boolean;
  fdb: boolean;
  lldp: boolean;
};

export type ConfigForm = {
  scanAllActive: boolean;
  prefixIds: string[];
  scheduleMinutes: string;
  snmp: SnmpRow[];
  dhcpServers: string;
  dnsServers: string;
  dnsZones: string;
  dnsDefaultZone: string;
  allowWrites: boolean;
  vrfId: string;
};

export function emptySnmpRow(): SnmpRow {
  return {
    host: "",
    version: "v3",
    user: "",
    authProtocol: "sha256",
    privProtocol: "aes",
    arp: true,
    fdb: true,
    lldp: true,
  };
}

export function configToForm(config: AgentConfig): ConfigForm {
  return {
    scanAllActive: config.scanAllActive,
    prefixIds: config.prefixIds,
    scheduleMinutes: String(config.scheduleMinutes),
    snmp: config.snmpTargets.map((target) => ({
      host: target.host,
      version: target.version,
      user: target.user ?? "",
      authProtocol: target.authProtocol ?? "",
      privProtocol: target.privProtocol ?? "",
      arp: target.collect.includes("arp"),
      fdb: target.collect.includes("fdb"),
      lldp: target.collect.includes("lldp"),
    })),
    dhcpServers: config.dhcpServers.join("\n"),
    dnsServers: config.dnsServers.join("\n"),
    dnsZones: config.dnsZones.join("\n"),
    dnsDefaultZone: config.dnsDefaultZone ?? "",
    allowWrites: config.allowWrites,
    vrfId: config.vrfId ?? "",
  };
}

/** One entry per line, comma or space. */
export function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

export type FormResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; message: string };

const HOST_PATTERN = /^[A-Za-z0-9_.:-]{1,253}$/;

/** Builds the config payload; returns a German message for obvious mistakes. */
export function formToConfig(form: ConfigForm): FormResult {
  const minutes = Number(form.scheduleMinutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
    return {
      ok: false,
      message: "Der Zeitplan muss zwischen 5 und 1440 Minuten liegen.",
    };
  }
  if (!form.scanAllActive && !form.prefixIds.length) {
    return {
      ok: false,
      message:
        "Wählen Sie mindestens ein Subnetz oder «alle aktiven Subnetze».",
    };
  }
  const snmpTargets: Record<string, unknown>[] = [];
  for (const row of form.snmp) {
    const host = row.host.trim();
    if (!host) continue;
    if (!HOST_PATTERN.test(host)) {
      return {
        ok: false,
        message: `«${host}» ist kein gültiger Hostname bzw. keine IP-Adresse.`,
      };
    }
    const collect = [
      ...(row.arp ? ["arp"] : []),
      ...(row.fdb ? ["fdb"] : []),
      ...(row.lldp ? ["lldp"] : []),
    ];
    if (row.version === "v3") {
      if (!row.user.trim()) {
        return {
          ok: false,
          message: `Für ${host} (SNMPv3) fehlt der Benutzername.`,
        };
      }
      if (row.privProtocol && !row.authProtocol) {
        return {
          ok: false,
          message: `Für ${host}: Verschlüsselung (Priv) geht nur zusammen mit Authentifizierung.`,
        };
      }
      snmpTargets.push({
        host,
        version: "v3",
        user: row.user.trim(),
        authProtocol: row.authProtocol || null,
        privProtocol: row.privProtocol || null,
        collect,
      });
    } else {
      snmpTargets.push({ host, version: "v2c", collect });
    }
  }
  const hosts = (value: string) => splitList(value);
  for (const host of [...hosts(form.dhcpServers), ...hosts(form.dnsServers)]) {
    if (!HOST_PATTERN.test(host)) {
      return { ok: false, message: `«${host}» ist kein gültiger Servername.` };
    }
  }
  return {
    ok: true,
    config: {
      scanAllActive: form.scanAllActive,
      prefixIds: form.scanAllActive ? [] : form.prefixIds,
      scheduleMinutes: minutes,
      snmpTargets,
      dhcpServers: hosts(form.dhcpServers),
      dnsServers: hosts(form.dnsServers),
      dnsZones: hosts(form.dnsZones).map((zone) =>
        zone.toLowerCase().replace(/\.$/, ""),
      ),
      dnsDefaultZone: form.dnsDefaultZone.trim() || null,
      allowWrites: form.allowWrites,
      vrfId: form.vrfId || null,
    },
  };
}
