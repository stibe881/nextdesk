// IP-Adressverwaltung (Web): Typen der Edge Function `ipam`, Bezeichnungen,
// Belegungsraster und Prognose-Texte. Reine Logik ohne React.

import {
  addressInRange,
  cidrContainsAddress,
  cidrLast,
  formatAddress,
  listAddresses,
  parseAddress,
  parseCidrInput,
  type IpAddress,
} from "./ipam-cidr";

export type DepartmentOption = { id: string; name: string };
export type NamedOption = { id: string; name: string };

export type IpamVrf = {
  id: string;
  name: string;
  routeDistinguisher: string | null;
  description: string | null;
};

export type IpamSite = {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  description: string | null;
  departmentId: string | null;
  /** IPAM-Redesign (0304); optional until the backend delivers them. */
  assetLocationId?: string | null;
  vlanBase?: number | null;
  supernetPrefixId?: string | null;
  templateId?: string | null;
};

export type IpamVlan = {
  id: string;
  vlanNumber: number;
  name: string;
  siteId: string | null;
  departmentId: string | null;
  description: string | null;
  /** IPAM-Redesign (0304). */
  zone?: string | null;
  notes?: string | null;
  status?: "active" | "deprecated";
};

export type IpamUsage = {
  used: number;
  dhcpSize: number;
  /** Capacity as decimal string (IPv6 exceeds Number precision). */
  capacity: string;
  percent: number;
};

export type PrefixStatus = "container" | "active" | "reserved" | "deprecated";
export type AddressStatus = "active" | "reserved" | "dhcp" | "deprecated";

export type IpamPrefix = {
  id: string;
  prefix: string;
  vrfId: string | null;
  siteId: string | null;
  vlanId: string | null;
  status: PrefixStatus;
  securityZone: string | null;
  gateway: string | null;
  gatewayDevice: string | null;
  dhcpHelper: string | null;
  dhcpStart: string | null;
  dhcpEnd: string | null;
  description: string | null;
  /** IPAM-Redesign (0304): free text moved out of the description. */
  notes?: string | null;
  utilizationWarningPercent: number;
  tags: string[];
  customFields: Record<string, string | number | boolean>;
  departmentId: string | null;
  updatedAt: string | null;
  usage: IpamUsage | null;
  /** Only in the overview tree. */
  parentId?: string | null;
  depth?: number;
};

export type IpamAddress = {
  id: string;
  address: string;
  vrfId: string | null;
  prefixId: string | null;
  status: AddressStatus;
  hostname: string | null;
  dnsName: string | null;
  macAddress: string | null;
  vendor: string | null;
  deviceType: string | null;
  description: string | null;
  switchName: string | null;
  switchPort: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  teamId: string | null;
  teamName: string | null;
  assetId: string | null;
  serviceId: string | null;
  intuneDeviceId: string | null;
  prtgDeviceId: string | null;
  reservedUntil: string | null;
  lastSeenAt: string | null;
  lastSeenSource: string | null;
  tags: string[];
  customFields: Record<string, string | number | boolean>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type FindingKind =
  | "ghost"
  | "conflict"
  | "foreign_mac"
  | "dns_mismatch"
  | "stale"
  | "utilization"
  | "outside_prefix"
  | "coverage";

export type IpamFinding = {
  id: string;
  vrfId: string | null;
  address: string;
  addressId: string | null;
  prefixId: string | null;
  kind: FindingKind;
  severity: "info" | "warning" | "critical";
  details: Record<string, unknown>;
  status: "open" | "resolved" | "ignored";
  ticketId: string | null;
  ticketNumber?: string | null;
  prefix?: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  resolvedAt: string | null;
};

export type IpamForecast = {
  warningOn: string | null;
  fullOn: string | null;
  perDay: number | null;
  points: number;
};

export type IpamOverview = {
  canManage: boolean;
  departments: DepartmentOption[];
  vrfs: IpamVrf[];
  sites: IpamSite[];
  vlans: IpamVlan[];
  prefixes: IpamPrefix[];
  people: NamedOption[];
  teams: NamedOption[];
  services: NamedOption[];
  kpis: {
    prefixCount: number;
    vrfCount: number;
    addressCount: number;
    usedV4: number;
    capacityV4: string;
    overWarning: number;
    openFindings: number;
    conflicts: number;
  };
};

export type IpamPrefixDetail = {
  prefix: IpamPrefix;
  vrf: IpamVrf | null;
  vlan: IpamVlan | null;
  site: IpamSite | null;
  grid: boolean;
  size: string;
  addresses: IpamAddress[];
  total: number;
  page: number;
  pageSize: number | null;
  children: IpamPrefix[];
  findings: IpamFinding[];
  nextFree: string | null;
  forecast: IpamForecast | null;
};

export type IpamAddressDetail = {
  address: IpamAddress | null;
  ip: string;
  vrfId: string | null;
  canManage: boolean;
  prefix: IpamPrefix | null;
  vlan: IpamVlan | null;
  site: IpamSite | null;
  asset: { id: string; name: string; assetTag: string | null } | null;
  service: { id: string; name: string } | null;
  devices: {
    id: string;
    name: string;
    category: string | null;
    hostname: string | null;
    ipAddress: string | null;
    macAddress: string | null;
  }[];
  tickets: {
    id: string;
    ticketNumber: string;
    subject: string;
    updatedAt: string | null;
    reason: string;
  }[];
  findings: IpamFinding[];
  events: {
    id: string;
    kind: string;
    details: Record<string, unknown>;
    actorName: string | null;
    at: string;
  }[];
};

export type IpamFile = {
  filename: string;
  mimeType: string;
  content: string;
  count?: number;
};

// ---------------------------------------------------------------------------
// Labels

export const PREFIX_STATUS_LABEL: Record<PrefixStatus, string> = {
  container: "Supernetz",
  active: "Aktiv",
  reserved: "Reserviert",
  deprecated: "Veraltet",
};

export const ADDRESS_STATUS_LABEL: Record<AddressStatus, string> = {
  active: "Aktiv",
  reserved: "Reserviert",
  dhcp: "DHCP",
  deprecated: "Veraltet / freigegeben",
};

export const DEVICE_TYPE_LABEL: Record<string, string> = {
  server: "Server",
  vm: "Virtuelle Maschine",
  switch: "Switch",
  router: "Router",
  firewall: "Firewall",
  access_point: "Access Point",
  printer: "Drucker",
  voip: "VoIP-Telefon",
  client: "Client",
  storage: "Storage",
  camera: "Kamera",
  iot: "IoT-Gerät",
  gateway: "Gateway",
  other: "Sonstiges",
};

export const FINDING_KIND_LABEL: Record<FindingKind, string> = {
  ghost: "Ghost-IP: aktiv, aber nicht dokumentiert",
  conflict: "Adresskonflikt",
  foreign_mac: "Fremde MAC auf reservierter IP",
  dns_mismatch: "DNS stimmt nicht",
  stale: "Lange nicht gesehen",
  utilization: "Subnetz oder DHCP-Bereich fast voll",
  outside_prefix: "Adresse ausserhalb der Subnetze",
  coverage: "Wichtiges Gerät ohne PRTG-Überwachung",
};

/** Short group labels for the summary chips of the findings tab. */
export const FINDING_GROUPS: { label: string; kinds: FindingKind[] }[] = [
  { label: "Konflikte", kinds: ["conflict", "foreign_mac"] },
  { label: "Ghost-IPs", kinds: ["ghost"] },
  { label: "DNS-Abweichungen", kinds: ["dns_mismatch"] },
  { label: "Veraltet", kinds: ["stale"] },
  { label: "Auslastung", kinds: ["utilization"] },
  { label: "PRTG-Lücken", kinds: ["coverage"] },
  { label: "Weitere", kinds: ["outside_prefix"] },
];

export const EVENT_KIND_LABEL: Record<string, string> = {
  created: "Erfasst",
  updated: "Geändert",
  reserved: "Reserviert",
  released: "Freigegeben",
  status: "Status geändert",
  seen: "Gesehen",
  mac_changed: "MAC-Adresse geändert",
  dns: "DNS geändert",
  imported: "Importiert",
  linked: "Verknüpft",
};

/** Field names of the history details. */
export const FIELD_LABEL: Record<string, string> = {
  address: "Adresse",
  status: "Status",
  hostname: "Hostname",
  dns_name: "DNS-Name",
  mac_address: "MAC",
  vendor: "Hersteller",
  device_type: "Gerätetyp",
  description: "Beschreibung",
  switch_name: "Switch",
  switch_port: "Port",
  owner_user_id: "Verantwortlich",
  team_id: "Team",
  asset_id: "Asset",
  service_id: "Dienst",
  reserved_until: "Reserviert bis",
  tags: "Schlagwörter",
  custom_fields: "Eigene Felder",
  vrf_id: "VRF",
};

/** One line describing a history entry. */
export function eventSummary(event: {
  kind: string;
  details: Record<string, unknown>;
}): string {
  const label = EVENT_KIND_LABEL[event.kind] ?? event.kind;
  const details = event.details ?? {};
  const changes = details.changes;
  if (changes && typeof changes === "object") {
    const fields = Object.keys(changes as Record<string, unknown>)
      .map((key) => FIELD_LABEL[key] ?? key)
      .slice(0, 5);
    if (fields.length) return `${label}: ${fields.join(", ")}`;
  }
  const parts: string[] = [];
  if (typeof details.hostname === "string" && details.hostname) {
    parts.push(details.hostname);
  }
  if (typeof details.description === "string" && details.description) {
    parts.push(`«${details.description}»`);
  }
  if (typeof details.ticketNumber === "string") {
    parts.push(`Ticket ${details.ticketNumber}`);
  }
  if (typeof details.mac === "string") parts.push(details.mac);
  if (typeof details.note === "string" && details.note)
    parts.push(details.note);
  return parts.length ? `${label}: ${parts.join(" · ")}` : label;
}

// ---------------------------------------------------------------------------
// Utilization

export type UsageTone = "ok" | "warning" | "danger" | "none";

/** Ab der Warnschwelle gelb, ab 95 % (oder voll) rot. */
export function usageTone(
  percent: number | null | undefined,
  warningPercent: number,
): UsageTone {
  if (percent === null || percent === undefined) return "none";
  if (percent >= Math.max(95, warningPercent)) return "danger";
  if (percent >= warningPercent) return "warning";
  return "ok";
}

export function formatPercent(value: number): string {
  return `${value.toLocaleString("de-CH", { maximumFractionDigits: value < 10 ? 1 : 0 })} %`;
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return "–";
  const time = Date.parse(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(time)) return value;
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(time));
}

/** «vor 4 Min.», «vor 3 Tagen» … for last-seen values. */
export function formatRelative(
  value: string | null | undefined,
  now = Date.now(),
): string {
  if (!value) return "nie";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
}

/** Text for the forecast line in the prefix detail; null without trend. */
export function forecastText(
  forecast: IpamForecast | null | undefined,
  warningPercent: number,
  today = new Date().toISOString().slice(0, 10),
): string | null {
  if (!forecast) return null;
  const parts: string[] = [];
  if (forecast.fullOn) {
    parts.push(
      forecast.fullOn <= today
        ? "Das Subnetz ist voll."
        : `Voll voraussichtlich am ${formatDay(forecast.fullOn)}.`,
    );
  }
  if (forecast.warningOn && forecast.warningOn > today) {
    parts.push(
      `Warnschwelle (${warningPercent} %) voraussichtlich am ${formatDay(forecast.warningOn)}.`,
    );
  }
  if (!parts.length) {
    if (forecast.points < 5) return null;
    return "Keine steigende Auslastung erkennbar.";
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Status grid

export type CellState =
  | "network"
  | "gateway"
  | "active"
  | "reserved"
  | "dhcp"
  | "ghost"
  | "conflict"
  | "deprecated"
  | "free";

export const CELL_LABEL: Record<CellState, string> = {
  network: "Netz / Broadcast",
  gateway: "Gateway",
  active: "Aktiv / zugewiesen",
  reserved: "Reserviert",
  dhcp: "DHCP-Pool",
  ghost: "Ghost-IP",
  conflict: "Konflikt",
  deprecated: "Veraltet",
  free: "Frei",
};

export const CELL_ORDER: CellState[] = [
  "active",
  "reserved",
  "dhcp",
  "ghost",
  "conflict",
  "deprecated",
  "gateway",
  "network",
  "free",
];

export type GridCell = {
  address: string;
  /** Last octet / offset label shown in the tooltip. */
  offset: number;
  state: CellState;
  record: IpamAddress | null;
  finding: IpamFinding | null;
};

export type Grid = {
  cells: GridCell[];
  counts: Record<CellState, number>;
};

function inRange(address: IpAddress, start: string | null, end: string | null) {
  if (!start || !end) return false;
  const from = parseAddress(start);
  const to = parseAddress(end);
  return Boolean(from && to && addressInRange(address, from, to));
}

/**
 * One cell per address of a small prefix (≤ 1024). Open findings (conflict,
 * foreign MAC, ghost) win over the documented status; the DHCP range counts
 * as pool unless an address is documented there.
 */
export function buildGrid(
  prefix: Pick<IpamPrefix, "prefix" | "gateway" | "dhcpStart" | "dhcpEnd">,
  addresses: IpamAddress[],
  findings: IpamFinding[],
): Grid | null {
  const cidr = parseCidrInput(prefix.prefix)?.cidr;
  if (!cidr) return null;
  const all = listAddresses(cidr, 1024);
  if (!all) return null;
  const records = new Map(addresses.map((record) => [record.address, record]));
  const open = new Map<string, IpamFinding>();
  for (const finding of findings) {
    if (finding.status !== "open") continue;
    const current = open.get(finding.address);
    const rank = (kind: FindingKind) =>
      kind === "conflict" || kind === "foreign_mac"
        ? 2
        : kind === "ghost"
          ? 1
          : 0;
    if (!current || rank(finding.kind) > rank(current.kind)) {
      open.set(finding.address, finding);
    }
  }
  const gateway = prefix.gateway ? parseAddress(prefix.gateway) : null;
  const edges = cidr.version === 4 && cidr.length <= 30;
  const counts = Object.fromEntries(
    CELL_ORDER.map((state) => [state, 0]),
  ) as Record<CellState, number>;
  const cells = all.map((address, index): GridCell => {
    const text = formatAddress(address);
    const record = records.get(text) ?? null;
    const finding = open.get(text) ?? null;
    let state: CellState = "free";
    if (
      edges &&
      (address.value === cidr.network || address.value === cidrLast(cidr))
    ) {
      state = "network";
    } else if (
      finding &&
      (finding.kind === "conflict" || finding.kind === "foreign_mac")
    ) {
      state = "conflict";
    } else if (finding && finding.kind === "ghost") {
      state = "ghost";
    } else if (record && record.status !== "deprecated") {
      state = record.status;
    } else if (gateway && gateway.value === address.value) {
      state = "gateway";
    } else if (inRange(address, prefix.dhcpStart, prefix.dhcpEnd)) {
      state = "dhcp";
    } else if (record) {
      state = "deprecated";
    }
    counts[state] += 1;
    return { address: text, offset: index, state, record, finding };
  });
  return { cells, counts };
}

/** True when the address lies in the prefix (for reserve dialogs). */
export function addressInPrefix(prefix: string, address: string): boolean {
  const cidr = parseCidrInput(prefix)?.cidr;
  const parsed = parseAddress(address);
  return Boolean(cidr && parsed && cidrContainsAddress(cidr, parsed));
}

/**
 * Prefix lengths offered for «Nächstes freies Subnetz» (up to 16 bits
 * smaller) or «Aufteilen» (maxSteps 8 = at most 256 parts). IPv4 stops at
 * /30, IPv6 at /64 (/127 and /128 only by hand).
 */
export function childLengths(prefix: string, maxSteps = 16): number[] {
  const cidr = parseCidrInput(prefix)?.cidr;
  if (!cidr) return [];
  const limit = cidr.version === 4 ? 30 : 64;
  const result: number[] = [];
  for (
    let length = cidr.length + 1;
    length <= Math.min(limit, cidr.length + maxSteps);
    length++
  ) {
    result.push(length);
  }
  return result;
}

/** Default size for a new child: /24 for IPv4 supernets, /64 for IPv6. */
export function defaultChildLength(prefix: string): number | null {
  const cidr = parseCidrInput(prefix)?.cidr;
  if (!cidr) return null;
  const preferred = cidr.version === 4 ? 24 : 64;
  if (cidr.length < preferred) return preferred;
  const lengths = childLengths(prefix);
  return lengths[0] ?? null;
}

// ---------------------------------------------------------------------------
// Custom fields editor helpers

export type FieldRow = { key: string; value: string };

export function customFieldRows(
  fields: Record<string, string | number | boolean> | null | undefined,
): FieldRow[] {
  return Object.entries(fields ?? {}).map(([key, value]) => ({
    key,
    value: typeof value === "boolean" ? (value ? "ja" : "nein") : String(value),
  }));
}

/** Rows → object; empty keys dropped, later duplicates win. */
export function customFieldsFromRows(rows: FieldRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) result[key] = row.value.trim();
  }
  return result;
}

/** «Server, Haus A ,» → ["Server", "Haus A"]. */
export function parseTagInput(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

/** Display name of a VRF id (null = global routing table). */
export function vrfLabel(vrfId: string | null, vrfs: IpamVrf[]): string {
  if (!vrfId) return "Global";
  return vrfs.find((vrf) => vrf.id === vrfId)?.name ?? "Unbekanntes VRF";
}

export function vlanLabel(
  vlan: Pick<IpamVlan, "vlanNumber" | "name"> | null | undefined,
) {
  return vlan ? `VLAN ${vlan.vlanNumber} · ${vlan.name}` : null;
}
