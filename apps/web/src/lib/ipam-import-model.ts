/**
 * IPAM import: the normalized batch every parser produces (sites, VLANs,
 * prefixes, addresses, infrastructure devices plus issues), address helpers
 * and the final consistency checks. Pure TypeScript, usable in the browser and
 * in Node (vitest) alike.
 */

/** One cell of a parsed spreadsheet or CSV. Dates arrive as ISO strings. */
export type Cell = string | number | boolean | null;
/** Parsed workbook: sheet name → rows (in sheet order). */
export type Workbook = Record<string, Cell[][]>;

export type ImportSource =
  "sonnenberg" | "switch_list" | "aruba_ap" | "generic" | "phpipam" | "netbox";

export type ImportOrigin = { sheet: string; row: number };

export type PrefixStatus = "container" | "active" | "reserved" | "deprecated";
export type AddressStatus = "active" | "reserved" | "dhcp" | "deprecated";
export const DEVICE_TYPES = [
  "server",
  "vm",
  "switch",
  "router",
  "firewall",
  "access_point",
  "printer",
  "voip",
  "client",
  "storage",
  "camera",
  "iot",
  "gateway",
  "other",
] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];
export const DEVICE_CATEGORIES = [
  "server",
  "switch",
  "access_point",
  "firewall",
  "router",
  "storage",
  "ups",
  "virtual_host",
  "other",
] as const;
export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];

export type ImportSite = {
  key: string;
  name: string;
  description: string | null;
  origin: ImportOrigin | null;
};

export type ImportVlan = {
  key: string;
  /** Site name (null = global VLAN). */
  site: string | null;
  number: number;
  name: string;
  description: string | null;
  origin: ImportOrigin | null;
};

export type ImportPrefix = {
  key: string;
  /** Normalized CIDR, e.g. «10.1.64.0/24». */
  prefix: string;
  /** VRF name; null = target VRF chosen in the wizard. */
  vrf: string | null;
  site: string | null;
  vlanNumber: number | null;
  status: PrefixStatus;
  securityZone: string | null;
  gateway: string | null;
  gatewayDevice: string | null;
  dhcpHelper: string | null;
  dhcpStart: string | null;
  dhcpEnd: string | null;
  description: string | null;
  tags: string[];
  customFields: Record<string, string>;
  origin: ImportOrigin | null;
};

export type ImportAddress = {
  key: string;
  address: string;
  vrf: string | null;
  status: AddressStatus;
  hostname: string | null;
  dnsName: string | null;
  /** Lower case, colon separated. */
  macAddress: string | null;
  deviceType: DeviceType | null;
  description: string | null;
  switchName: string | null;
  switchPort: string | null;
  tags: string[];
  customFields: Record<string, string>;
  origin: ImportOrigin | null;
};

export type ImportDevice = {
  key: string;
  name: string;
  category: DeviceCategory;
  serialNumber: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  hostname: string | null;
  manufacturer: string | null;
  model: string | null;
  /** Location name (asset location), matched by name on import. */
  location: string | null;
  /** Uplink device name or text containing it (e.g. «WG6 SW016»). */
  uplink: string | null;
  uplinkPort: string | null;
  notes: string | null;
  lifecycleState: "active" | "stock";
  origin: ImportOrigin | null;
};

export type IssueSeverity = "error" | "warning" | "info";
export type IssueEntity =
  "sheet" | "row" | "site" | "vlan" | "prefix" | "address" | "device";

export type ImportIssue = {
  severity: IssueSeverity;
  entity: IssueEntity;
  /** Key of the affected entry when it is part of the batch. */
  key: string | null;
  origin: ImportOrigin | null;
  message: string;
};

export type ImportBatch = {
  source: ImportSource;
  sites: ImportSite[];
  vlans: ImportVlan[];
  prefixes: ImportPrefix[];
  addresses: ImportAddress[];
  devices: ImportDevice[];
  /** Errors are rows that were left out; warnings belong to included rows. */
  issues: ImportIssue[];
  skippedSheets: { sheet: string; reason: string }[];
};

export type ImportKind =
  "sites" | "vlans" | "prefixes" | "addresses" | "devices";
export const IMPORT_KINDS: ImportKind[] = [
  "sites",
  "vlans",
  "prefixes",
  "addresses",
  "devices",
];

export function emptyBatch(source: ImportSource): ImportBatch {
  return {
    source,
    sites: [],
    vlans: [],
    prefixes: [],
    addresses: [],
    devices: [],
    issues: [],
    skippedSheets: [],
  };
}

// ---------------------------------------------------------------- cells

/** Cell → trimmed text (null for empty, «-», «–»). Numbers keep their form. */
export function text(cell: Cell | undefined): string | null {
  if (cell === null || cell === undefined || cell === false) return null;
  const value = String(cell).replace(/\r\n?/g, "\n").replace(/ /g, " ").trim();
  if (!value || value === "-" || value === "–" || value === "—") return null;
  return value;
}

/** First line of a cell (multi-line cells hold alternatives). */
export function firstLine(value: string | null): string | null {
  if (!value) return null;
  const line = value
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return line ?? null;
}

export function oneLine(value: string | null): string | null {
  if (!value) return null;
  return value
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" / ");
}

export function clip(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function normalizeHeader(value: Cell | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "");
}

const SECRET_PATTERN =
  /(passwor[dt]|kennwort|\bpw\b|\bpsk\b|pre-?shared[- ]?key|wpa2?[- ]?(key|schl(ü|ue)ssel)|wlan[- ]?(key|schl(ü|ue)ssel)|netzwerkschl(ü|ue)ssel|secret|api[- ]?key|token)\s*[:=]\s*\S/i;

/** True when a text looks like it contains a secret (never imported). */
export function looksSecret(value: string | null): boolean {
  return value !== null && SECRET_PATTERN.test(value);
}

// ---------------------------------------------------------------- IP helpers

export type ParsedIp = { family: 4 | 6; value: bigint };

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(value: string): bigint | null {
  const match = IPV4.exec(value);
  if (!match) return null;
  let result = 0n;
  for (let index = 1; index <= 4; index++) {
    const octet = Number(match[index]);
    if (octet > 255) return null;
    result = (result << 8n) + BigInt(octet);
  }
  return result;
}

function parseIpv6(value: string): bigint | null {
  if (!/^[0-9a-f:.]+$/i.test(value) || !value.includes(":")) return null;
  let head = value;
  let tailV4: bigint | null = null;
  const lastColon = value.lastIndexOf(":");
  if (value.slice(lastColon + 1).includes(".")) {
    tailV4 = parseIpv4(value.slice(lastColon + 1));
    if (tailV4 === null) return null;
    head = `${value.slice(0, lastColon + 1)}0:0`;
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) =>
    part === "" ? [] : part.split(":").map((group) => group.toLowerCase());
  const left = parse(halves[0] ?? "");
  const right = halves.length === 2 ? parse(halves[1] ?? "") : [];
  const groups =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
  if (
    groups.length !== 8 ||
    left.length + right.length > (halves.length === 2 ? 7 : 8)
  ) {
    return null;
  }
  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    result = (result << 16n) + BigInt(parseInt(group, 16));
  }
  if (tailV4 !== null) result = (result & ~0xffffffffn) | tailV4;
  return result;
}

/** «10.0.0.08» → 10.0.0.8; IPv6 too. Null when not an address. */
export function parseIp(input: string | null): ParsedIp | null {
  if (!input) return null;
  const value = input.trim();
  const v4 = parseIpv4(value);
  if (v4 !== null) return { family: 4, value: v4 };
  const v6 = parseIpv6(value);
  if (v6 !== null) return { family: 6, value: v6 };
  return null;
}

export function bits(family: 4 | 6): number {
  return family === 4 ? 32 : 128;
}

export function formatIp(ip: ParsedIp): string {
  if (ip.family === 4) {
    const parts: number[] = [];
    for (let shift = 24n; shift >= 0n; shift -= 8n) {
      parts.push(Number((ip.value >> shift) & 0xffn));
    }
    return parts.join(".");
  }
  const groups: string[] = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    groups.push(((ip.value >> shift) & 0xffffn).toString(16));
  }
  // Compress the longest run of zero groups.
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < 8;) {
    if (groups[index] !== "0") {
      index++;
      continue;
    }
    let end = index;
    while (end < 8 && groups[end] === "0") end++;
    if (end - index > bestLength && end - index > 1) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestStart < 0) return groups.join(":");
  const left = groups.slice(0, bestStart).join(":");
  const right = groups.slice(bestStart + bestLength).join(":");
  return `${left}::${right}`;
}

/** Normalized address text or null. */
export function normalizeIp(input: string | null): string | null {
  const ip = parseIp(input);
  return ip ? formatIp(ip) : null;
}

export type ParsedCidr = {
  family: 4 | 6;
  network: bigint;
  length: number;
  /** True when the input had host bits set (they were cleared). */
  hostBits: boolean;
};

function hostMask(family: 4 | 6, length: number): bigint {
  return (1n << BigInt(bits(family) - length)) - 1n;
}

/** Dotted mask «255.255.255.0» → 24; null when not contiguous. */
export function maskLength(mask: string): number | null {
  const parsed = parseIp(mask);
  if (!parsed || parsed.family !== 4) return null;
  const binary = parsed.value.toString(2).padStart(32, "0");
  if (!/^1*0*$/.test(binary)) return null;
  return binary.indexOf("0") === -1 ? 32 : binary.indexOf("0");
}

/** Prefix length from «24», «/24», 24 or «255.255.255.0». */
export function parseLength(value: Cell | undefined): number | null {
  const raw = text(value ?? null);
  if (!raw) return null;
  const cleaned = raw.replace(/^\//, "").trim();
  if (/^\d{1,3}$/.test(cleaned)) return Number(cleaned);
  return maskLength(cleaned);
}

export function parseCidr(
  input: string | null,
  lengthHint?: number | null,
): ParsedCidr | null {
  if (!input) return null;
  const [addressPart, lengthPart, extra] = input.trim().split("/");
  if (extra !== undefined) return null;
  const ip = parseIp(addressPart ?? "");
  if (!ip) return null;
  const length =
    lengthPart !== undefined ? parseLength(lengthPart) : (lengthHint ?? null);
  if (
    length === null ||
    !Number.isInteger(length) ||
    length < 0 ||
    length > bits(ip.family)
  ) {
    return null;
  }
  const mask = hostMask(ip.family, length);
  return {
    family: ip.family,
    network: ip.value & ~mask,
    length,
    hostBits: (ip.value & mask) !== 0n,
  };
}

export function formatCidr(cidr: ParsedCidr): string {
  return `${formatIp({ family: cidr.family, value: cidr.network })}/${cidr.length}`;
}

export function broadcastOf(cidr: ParsedCidr): bigint {
  return cidr.network | hostMask(cidr.family, cidr.length);
}

export function cidrContainsIp(cidr: ParsedCidr, ip: ParsedIp): boolean {
  return (
    cidr.family === ip.family &&
    (ip.value & ~hostMask(cidr.family, cidr.length)) === cidr.network
  );
}

/** True when inner lies within outer (equal counts as inside). */
export function cidrContains(outer: ParsedCidr, inner: ParsedCidr): boolean {
  return (
    outer.family === inner.family &&
    outer.length <= inner.length &&
    (inner.network & ~hostMask(outer.family, outer.length)) === outer.network
  );
}

/** Network or broadcast address of an IPv4 prefix up to /30. */
export function isNetworkOrBroadcast(cidr: ParsedCidr, ip: ParsedIp): boolean {
  if (cidr.family !== 4 || cidr.length > 30 || !cidrContainsIp(cidr, ip))
    return false;
  return ip.value === cidr.network || ip.value === broadcastOf(cidr);
}

/**
 * Gateway relative to a prefix: «.1» → last octet, «.0.250» → last two
 * octets, a full address stays. Returns null when it cannot be resolved.
 */
export function resolveRelativeIp(
  cidr: ParsedCidr,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (cidr.family === 4 && /^\.\d{1,3}(\.\d{1,3}){0,2}$/.test(trimmed)) {
    const suffix = trimmed.slice(1).split(".").map(Number);
    if (suffix.some((octet) => octet > 255)) return null;
    const base = formatIp({ family: 4, value: cidr.network })
      .split(".")
      .map(Number);
    const merged = [...base.slice(0, 4 - suffix.length), ...suffix];
    return merged.join(".");
  }
  return normalizeIp(trimmed);
}

// ---------------------------------------------------------------- MAC & types

/** «48:2F:6B:CF:52:A8», «482F6BCF52A8», «482f.6bcf.52a8» → «48:2f:6b:cf:52:a8». */
export function normalizeMac(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (
    !/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(trimmed) &&
    !/^[0-9a-f]{12}$/i.test(trimmed) &&
    !/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(trimmed)
  ) {
    return null;
  }
  const hex = trimmed.replace(/[^0-9a-f]/gi, "").toLowerCase();
  return hex.match(/.{2}/g)!.join(":");
}

const TYPE_RULES: [RegExp, DeviceType][] = [
  [
    /\b(access ?point|accesspoint|aruba ap|\bap\d*\b|ap \(dhcp\)|wifi[- ]bridge)/i,
    "access_point",
  ],
  [/firewall|sophos|fortigate|forti\b|\bfir\d|-fir\d/i, "firewall"],
  [/\b(core ?switch|switch|\bsw\d+|-[ac]sw\d+|procurve)/i, "switch"],
  [/router|gateway \(internet|internet gateway|mikrotik/i, "router"],
  [/drucker|printer|\bprt\d|\bp\d{3}\b|braille/i, "printer"],
  [/kamera|camera|\bcam\d|nvr/i, "camera"],
  [/\bnas\d*|storage|\bsan\b|iscsi/i, "storage"],
  [/voip|telefon|\bmitel|ascom/i, "voip"],
  [/\bilo\b|ilos\d+/i, "other"],
  [/\besx|hyper-?v|vm host|vmhost/i, "server"],
  [
    /server|\bsrv\b|domain controller|\bdc\d|exchange|\bsql\d|\b(app|web|fs|vbr|vprx|vbm|prt|rad|kms|mon|mgt|adc|exc|abp|adx|pls|exos)\d+/i,
    "server",
  ],
  [/kaba|schliess|zutritt|sensor|klima|steuerung|usv|ups/i, "iot"],
  [/default gateway|vlan-gateway/i, "gateway"],
  [/client|notebook|workstation|ipad|\bw\d{3}/i, "client"],
];

/** Guess the device type from hostname and function text. */
export function inferDeviceType(
  ...parts: (string | null)[]
): DeviceType | null {
  const haystack = parts.filter(Boolean).join(" ");
  if (!haystack) return null;
  for (const [pattern, type] of TYPE_RULES) {
    if (pattern.test(haystack)) return type;
  }
  return null;
}

/** Type for a column/area label, only when exactly one type matches. */
export function uniqueDeviceType(label: string | null): DeviceType | null {
  if (!label) return null;
  const types = new Set(
    TYPE_RULES.filter(([pattern]) => pattern.test(label)).map(
      ([, type]) => type,
    ),
  );
  return types.size === 1 ? [...types][0]! : null;
}

/** «ProCurve 2650-48» → HP, «Aruba 2930F» → Aruba … */
export function guessManufacturer(model: string | null): string | null {
  if (!model) return null;
  if (/^(hp|hpe)\b/i.test(model) || /procurve/i.test(model)) return "HPE";
  if (/^aruba/i.test(model)) return "HPE Aruba";
  if (/^cisco/i.test(model)) return "Cisco";
  if (/^(unifi|ubiquiti)/i.test(model)) return "Ubiquiti";
  return null;
}

// ---------------------------------------------------------------- keys

export const siteKey = (name: string) => `site:${name.toLowerCase()}`;
export const vlanKey = (site: string | null, number: number) =>
  `vlan:${(site ?? "").toLowerCase()}:${number}`;
export const prefixKey = (vrf: string | null, prefix: string) =>
  `prefix:${(vrf ?? "").toLowerCase()}:${prefix}`;
export const addressKey = (vrf: string | null, address: string) =>
  `address:${(vrf ?? "").toLowerCase()}:${address}`;
export function deviceKey(
  device: Pick<ImportDevice, "serialNumber" | "macAddress" | "name">,
) {
  if (device.serialNumber)
    return `device:serial:${device.serialNumber.toLowerCase()}`;
  if (device.macAddress) return `device:mac:${device.macAddress}`;
  return `device:name:${device.name.toLowerCase()}`;
}

// ---------------------------------------------------------------- builder

/** Collects entries while parsing; duplicates merge or become issues. */
export class BatchBuilder {
  readonly batch: ImportBatch;
  private readonly siteIndex = new Map<string, ImportSite>();
  private readonly vlanIndex = new Map<string, ImportVlan>();
  private readonly prefixIndex = new Map<string, ImportPrefix>();
  private readonly addressIndex = new Map<string, ImportAddress>();
  private readonly deviceIndex = new Map<string, ImportDevice>();

  constructor(source: ImportSource) {
    this.batch = emptyBatch(source);
  }

  issue(
    severity: IssueSeverity,
    entity: IssueEntity,
    origin: ImportOrigin | null,
    message: string,
    key: string | null = null,
  ) {
    this.batch.issues.push({ severity, entity, key, origin, message });
  }

  skipSheet(sheet: string, reason: string) {
    this.batch.skippedSheets.push({ sheet, reason });
  }

  site(
    name: string | null,
    origin: ImportOrigin | null,
    description: string | null = null,
  ) {
    const clean = clip(oneLine(name), 120);
    if (!clean) return null;
    const key = siteKey(clean);
    const existing = this.siteIndex.get(key);
    if (existing) {
      existing.description ??= description;
      return existing;
    }
    const site: ImportSite = {
      key,
      name: clean,
      description: clip(description, 500),
      origin,
    };
    this.siteIndex.set(key, site);
    this.batch.sites.push(site);
    return site;
  }

  findSite(name: string | null) {
    return name ? (this.siteIndex.get(siteKey(name)) ?? null) : null;
  }

  vlan(
    site: string | null,
    number: number,
    name: string | null,
    origin: ImportOrigin | null,
    description: string | null = null,
  ): ImportVlan | null {
    if (!Number.isInteger(number) || number < 1 || number > 4094) {
      this.issue(
        "warning",
        "vlan",
        origin,
        `VLAN ${number} ist ungültig (1–4094) und wurde ausgelassen.`,
      );
      return null;
    }
    const key = vlanKey(site, number);
    const label = clip(oneLine(name), 120) ?? `VLAN ${number}`;
    const existing = this.vlanIndex.get(key);
    if (existing) {
      if (name && existing.name.toLowerCase() !== label.toLowerCase()) {
        this.issue(
          "warning",
          "vlan",
          origin,
          `VLAN ${number}${site ? ` (${site})` : ""} kommt mehrfach vor: «${existing.name}» bleibt, «${label}» wird nicht übernommen.`,
          key,
        );
      }
      existing.description ??= clip(description, 1000);
      return existing;
    }
    const vlan: ImportVlan = {
      key,
      site,
      number,
      name: label,
      description: clip(description, 1000),
      origin,
    };
    this.vlanIndex.set(key, vlan);
    this.batch.vlans.push(vlan);
    return vlan;
  }

  findPrefix(vrf: string | null, prefix: string) {
    return this.prefixIndex.get(prefixKey(vrf, prefix)) ?? null;
  }

  prefix(entry: Omit<ImportPrefix, "key">): {
    prefix: ImportPrefix;
    created: boolean;
  } {
    const key = prefixKey(entry.vrf, entry.prefix);
    const existing = this.prefixIndex.get(key);
    if (existing) return { prefix: existing, created: false };
    const prefix: ImportPrefix = {
      ...entry,
      key,
      description: clip(entry.description, 1000),
      securityZone: clip(entry.securityZone, 60),
      gatewayDevice: clip(entry.gatewayDevice, 160),
      dhcpHelper: clip(entry.dhcpHelper, 200),
    };
    this.prefixIndex.set(key, prefix);
    this.batch.prefixes.push(prefix);
    return { prefix, created: true };
  }

  findAddress(vrf: string | null, address: string) {
    return this.addressIndex.get(addressKey(vrf, address)) ?? null;
  }

  /** Adds an address; a second row for the same address becomes an issue. */
  address(entry: Omit<ImportAddress, "key">): ImportAddress | null {
    const key = addressKey(entry.vrf, entry.address);
    const existing = this.addressIndex.get(key);
    if (existing) {
      const where = existing.origin
        ? ` (${existing.origin.sheet}, Zeile ${existing.origin.row})`
        : "";
      this.issue(
        "warning",
        "address",
        entry.origin,
        `${entry.address} ist bereits erfasst${where}; diese Zeile wird nicht übernommen.`,
        key,
      );
      return null;
    }
    const address: ImportAddress = {
      ...entry,
      key,
      hostname: clip(entry.hostname, 253),
      dnsName: clip(entry.dnsName, 253),
      description: clip(entry.description, 1000),
      switchName: clip(entry.switchName, 160),
      switchPort: clip(entry.switchPort, 80),
    };
    this.addressIndex.set(key, address);
    this.batch.addresses.push(address);
    return address;
  }

  device(entry: Omit<ImportDevice, "key">): ImportDevice | null {
    const key = deviceKey(entry);
    const existing = this.deviceIndex.get(key);
    if (existing) {
      this.issue(
        "error",
        "device",
        entry.origin,
        `Gerät «${entry.name}» ist doppelt (gleiche Seriennummer, MAC oder gleicher Name) und wurde ausgelassen.`,
        key,
      );
      return null;
    }
    const device: ImportDevice = {
      ...entry,
      key,
      name: clip(entry.name, 240) ?? entry.name,
      hostname: clip(entry.hostname, 253),
      serialNumber: clip(entry.serialNumber, 160),
      manufacturer: clip(entry.manufacturer, 160),
      model: clip(entry.model, 160),
      uplinkPort: clip(entry.uplinkPort, 40),
      notes: clip(entry.notes, 4000),
    };
    this.deviceIndex.set(key, device);
    this.batch.devices.push(device);
    return device;
  }
}

// ---------------------------------------------------------------- checks

/**
 * Final checks that work across all formats: gateway and DHCP range inside
 * the prefix, addresses outside every imported prefix, active subnets nested
 * in active subnets. Mutates the batch (drops invalid gateway/DHCP values).
 */
export function finalizeBatch(batch: ImportBatch): ImportBatch {
  const parsed = batch.prefixes.map((prefix) => ({
    prefix,
    cidr: parseCidr(prefix.prefix)!,
  }));
  for (const { prefix, cidr } of parsed) {
    if (prefix.gateway) {
      const ip = parseIp(prefix.gateway);
      if (!ip || !cidrContainsIp(cidr, ip)) {
        batch.issues.push({
          severity: "warning",
          entity: "prefix",
          key: prefix.key,
          origin: prefix.origin,
          message: `Gateway ${prefix.gateway} liegt nicht in ${prefix.prefix} und wird nicht übernommen.`,
        });
        prefix.customFields = {
          ...prefix.customFields,
          gateway_original: prefix.gateway,
        };
        prefix.gateway = null;
      }
    }
    if (prefix.dhcpStart || prefix.dhcpEnd) {
      const start = parseIp(prefix.dhcpStart);
      const end = parseIp(prefix.dhcpEnd);
      const valid =
        start &&
        end &&
        start.value <= end.value &&
        cidrContainsIp(cidr, start) &&
        cidrContainsIp(cidr, end) &&
        !isNetworkOrBroadcast(cidr, start) &&
        !isNetworkOrBroadcast(cidr, end);
      if (!valid) {
        batch.issues.push({
          severity: "warning",
          entity: "prefix",
          key: prefix.key,
          origin: prefix.origin,
          message: `DHCP-Bereich ${prefix.dhcpStart ?? "?"} – ${prefix.dhcpEnd ?? "?"} passt nicht zu ${prefix.prefix} und wird nicht übernommen.`,
        });
        prefix.dhcpStart = null;
        prefix.dhcpEnd = null;
      }
    }
  }
  // Active prefixes inside other active prefixes of the same VRF.
  for (const inner of parsed) {
    if (inner.prefix.status === "container") continue;
    const outer = parsed
      .filter(
        (candidate) =>
          candidate !== inner &&
          candidate.prefix.status !== "container" &&
          (candidate.prefix.vrf ?? "") === (inner.prefix.vrf ?? "") &&
          candidate.cidr.length < inner.cidr.length &&
          cidrContains(candidate.cidr, inner.cidr),
      )
      .sort((a, b) => b.cidr.length - a.cidr.length)[0];
    if (outer) {
      batch.issues.push({
        severity: "warning",
        entity: "prefix",
        key: inner.prefix.key,
        origin: inner.prefix.origin,
        message: `${inner.prefix.prefix} liegt im aktiven Subnetz ${outer.prefix.prefix} (Überschneidung prüfen).`,
      });
    }
  }
  for (const address of batch.addresses) {
    const ip = parseIp(address.address);
    if (!ip) continue;
    const inside = parsed.some(
      ({ prefix, cidr }) =>
        (prefix.vrf ?? "") === (address.vrf ?? "") && cidrContainsIp(cidr, ip),
    );
    if (!inside && batch.prefixes.length > 0) {
      batch.issues.push({
        severity: "info",
        entity: "address",
        key: address.key,
        origin: address.origin,
        message: `${address.address} liegt in keinem Subnetz dieser Datei (wird einem bestehenden Subnetz zugeordnet, falls vorhanden).`,
      });
    }
  }
  return batch;
}

export type BatchCounts = Record<ImportKind, number> & {
  errors: number;
  warnings: number;
};

export function batchCounts(batch: ImportBatch): BatchCounts {
  return {
    sites: batch.sites.length,
    vlans: batch.vlans.length,
    prefixes: batch.prefixes.length,
    addresses: batch.addresses.length,
    devices: batch.devices.length,
    errors: batch.issues.filter((issue) => issue.severity === "error").length,
    warnings: batch.issues.filter((issue) => issue.severity === "warning")
      .length,
  };
}

/** Rows of one kind, without excluded keys, in chunks for the edge function. */
export function chunkRows<T extends { key: string }>(
  rows: T[],
  excluded: ReadonlySet<string>,
  size = 400,
): T[][] {
  const included = rows.filter((row) => !excluded.has(row.key));
  const chunks: T[][] = [];
  for (let index = 0; index < included.length; index += size) {
    chunks.push(included.slice(index, index + size));
  }
  return chunks;
}

/** Strips parser-only fields (origin) before sending rows to the server. */
export function wireRow<T extends { origin: ImportOrigin | null }>(
  row: T,
): Omit<T, "origin"> {
  const { origin: _origin, ...rest } = row;
  return rest;
}
