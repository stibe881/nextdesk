// Validation for the IPAM import: request shape, normalized rows (the batch
// the web wizard produces), IP/CIDR helpers and change detection. Pure, so
// it can be tested without a database.

import { isRecord, isUuid } from "../_shared/http.ts";

export const MAX_ROWS = 500;
export const KINDS = [
  "sites",
  "vlans",
  "prefixes",
  "addresses",
  "devices",
] as const;
export type Kind = (typeof KINDS)[number];

const PREFIX_STATUS = [
  "container",
  "active",
  "reserved",
  "deprecated",
] as const;
const ADDRESS_STATUS = ["active", "reserved", "dhcp", "deprecated"] as const;
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

// ------------------------------------------------------------------ IP

export type Ip = { family: 4 | 6; value: bigint };
export type Cidr = {
  family: 4 | 6;
  network: bigint;
  length: number;
  hostBits: boolean;
};

function parseV4(value: string): bigint | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return null;
  let result = 0n;
  for (let index = 1; index <= 4; index++) {
    const octet = Number(match[index]);
    if (octet > 255) return null;
    result = (result << 8n) + BigInt(octet);
  }
  return result;
}

function parseV6(value: string): bigint | null {
  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return null;
  let head = value;
  let tail: bigint | null = null;
  const last = value.lastIndexOf(":");
  if (value.slice(last + 1).includes(".")) {
    tail = parseV4(value.slice(last + 1));
    if (tail === null) return null;
    head = `${value.slice(0, last + 1)}0:0`;
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const split = (part: string) => (part === "" ? [] : part.split(":"));
  const left = split(halves[0] ?? "");
  const right = halves.length === 2 ? split(halves[1] ?? "") : [];
  if (halves.length === 2 && left.length + right.length > 7) return null;
  const groups =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    result = (result << 16n) + BigInt(parseInt(group, 16));
  }
  if (tail !== null) result = (result & ~0xffffffffn) | tail;
  return result;
}

export function parseIp(value: unknown): Ip | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const v4 = parseV4(trimmed);
  if (v4 !== null) return { family: 4, value: v4 };
  const v6 = parseV6(trimmed);
  return v6 === null ? null : { family: 6, value: v6 };
}

const width = (family: 4 | 6) => (family === 4 ? 32 : 128);
const hostMask = (family: 4 | 6, length: number) =>
  (1n << BigInt(width(family) - length)) - 1n;

export function formatIp(ip: Ip): string {
  if (ip.family === 4) {
    return [24n, 16n, 8n, 0n]
      .map((shift) => Number((ip.value >> shift) & 0xffn))
      .join(".");
  }
  const groups: string[] = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    groups.push(((ip.value >> shift) & 0xffffn).toString(16));
  }
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
  return `${groups.slice(0, bestStart).join(":")}::${groups.slice(bestStart + bestLength).join(":")}`;
}

/** Address text (inet output may carry «/32») → normalized address. */
export function normalizeAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const [address, length] = value.split("/");
  const ip = parseIp(address);
  if (!ip) return null;
  if (length !== undefined && Number(length) !== width(ip.family)) return null;
  return formatIp(ip);
}

export function parseCidr(value: unknown): Cidr | null {
  if (typeof value !== "string") return null;
  const [address, lengthText, extra] = value.trim().split("/");
  if (
    extra !== undefined ||
    lengthText === undefined ||
    !/^\d{1,3}$/.test(lengthText)
  )
    return null;
  const ip = parseIp(address);
  const length = Number(lengthText);
  if (!ip || length > width(ip.family)) return null;
  const mask = hostMask(ip.family, length);
  return {
    family: ip.family,
    network: ip.value & ~mask,
    length,
    hostBits: (ip.value & mask) !== 0n,
  };
}

export function formatCidr(cidr: Cidr): string {
  return `${formatIp({ family: cidr.family, value: cidr.network })}/${cidr.length}`;
}

export function cidrContainsIp(cidr: Cidr, ip: Ip): boolean {
  return (
    cidr.family === ip.family &&
    (ip.value & ~hostMask(cidr.family, cidr.length)) === cidr.network
  );
}

/** Most specific prefix (by text) containing the address. */
export function containingPrefix<T extends { prefix: string }>(
  prefixes: T[],
  address: string,
): T | null {
  const ip = parseIp(address);
  if (!ip) return null;
  let best: { row: T; length: number } | null = null;
  for (const row of prefixes) {
    const cidr = parseCidr(row.prefix);
    if (!cidr || !cidrContainsIp(cidr, ip)) continue;
    if (!best || cidr.length > best.length) best = { row, length: cidr.length };
  }
  return best?.row ?? null;
}

export function normalizeMac(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    !/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(trimmed) &&
    !/^[0-9a-f]{12}$/i.test(trimmed) &&
    !/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(trimmed)
  )
    return null;
  return trimmed
    .replace(/[^0-9a-f]/gi, "")
    .toLowerCase()
    .match(/.{2}/g)!
    .join(":");
}

// ------------------------------------------------------------------ rows

export type SiteRow = { key: string; name: string; description: string | null };
export type VlanRow = {
  key: string;
  site: string | null;
  number: number;
  name: string;
  description: string | null;
};
export type PrefixRow = {
  key: string;
  prefix: string;
  vrf: string | null;
  site: string | null;
  vlanNumber: number | null;
  status: (typeof PREFIX_STATUS)[number];
  securityZone: string | null;
  gateway: string | null;
  gatewayDevice: string | null;
  dhcpHelper: string | null;
  dhcpStart: string | null;
  dhcpEnd: string | null;
  description: string | null;
  tags: string[];
  customFields: Record<string, string>;
};
export type AddressRow = {
  key: string;
  address: string;
  vrf: string | null;
  status: (typeof ADDRESS_STATUS)[number];
  hostname: string | null;
  dnsName: string | null;
  macAddress: string | null;
  deviceType: (typeof DEVICE_TYPES)[number] | null;
  description: string | null;
  switchName: string | null;
  switchPort: string | null;
  tags: string[];
  customFields: Record<string, string>;
};
export type DeviceRow = {
  key: string;
  name: string;
  category: (typeof DEVICE_CATEGORIES)[number];
  serialNumber: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  hostname: string | null;
  manufacturer: string | null;
  model: string | null;
  location: string | null;
  uplink: string | null;
  uplinkPort: string | null;
  notes: string | null;
  lifecycleState: "active" | "stock";
};
export type RowByKind = {
  sites: SiteRow;
  vlans: VlanRow;
  prefixes: PrefixRow;
  addresses: AddressRow;
  devices: DeviceRow;
};

class RowError extends Error {}

function str(
  value: unknown,
  field: string,
  max: number,
  required = false,
): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) throw new RowError(`${field} fehlt.`);
    return null;
  }
  if (typeof value !== "string") throw new RowError(`${field} ist ungültig.`);
  // Control characters except line breaks and tabs are not stored.
  const trimmed = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (!trimmed) {
    if (required) throw new RowError(`${field} fehlt.`);
    return null;
  }
  if (trimmed.length > max)
    throw new RowError(`${field} ist zu lang (höchstens ${max} Zeichen).`);
  return trimmed;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    throw new RowError(`${field} ist ungültig.`);
  }
  return value as T;
}

function int(
  value: unknown,
  field: string,
  min: number,
  max: number,
  required = false,
): number | null {
  if (value === null || value === undefined) {
    if (required) throw new RowError(`${field} fehlt.`);
    return null;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new RowError(`${field} muss zwischen ${min} und ${max} liegen.`);
  }
  return value;
}

function tags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20)
    throw new RowError("Tags sind ungültig.");
  const result = new Set<string>();
  for (const tag of value) {
    const clean = str(tag, "Tag", 40);
    if (clean) result.add(clean.toLowerCase());
  }
  return [...result];
}

function customFields(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new RowError("Zusatzfelder sind ungültig.");
  const entries = Object.entries(value);
  if (entries.length > 30) throw new RowError("Zu viele Zusatzfelder.");
  const result: Record<string, string> = {};
  for (const [key, entry] of entries) {
    if (!/^[a-z0-9_]{1,40}$/i.test(key))
      throw new RowError("Zusatzfeld-Name ist ungültig.");
    const clean = str(entry, `Zusatzfeld ${key}`, 500);
    if (clean) result[key] = clean;
  }
  return result;
}

function address(
  value: unknown,
  field: string,
  required = false,
): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) throw new RowError(`${field} fehlt.`);
    return null;
  }
  const normalized = normalizeAddress(value);
  if (!normalized)
    throw new RowError(
      `${field} «${String(value).slice(0, 60)}» ist keine IP-Adresse.`,
    );
  return normalized;
}

function mac(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = normalizeMac(value);
  if (!normalized) throw new RowError("MAC-Adresse ist ungültig.");
  return normalized;
}

function key(value: unknown): string {
  const clean = str(value, "Schlüssel", 300, true)!;
  return clean;
}

function parseSite(raw: Record<string, unknown>): SiteRow {
  return {
    key: key(raw.key),
    name: str(raw.name, "Name", 120, true)!,
    description: str(raw.description, "Beschreibung", 500),
  };
}

function parseVlan(raw: Record<string, unknown>): VlanRow {
  return {
    key: key(raw.key),
    site: str(raw.site, "Standort", 120),
    number: int(raw.number, "VLAN-Nummer", 1, 4094, true)!,
    name: str(raw.name, "Name", 120, true)!,
    description: str(raw.description, "Beschreibung", 1000),
  };
}

function parsePrefix(raw: Record<string, unknown>): PrefixRow {
  const cidr = parseCidr(raw.prefix);
  if (!cidr)
    throw new RowError(
      `«${String(raw.prefix ?? "").slice(0, 60)}» ist kein gültiges Subnetz.`,
    );
  if (cidr.hostBits)
    throw new RowError(`${String(raw.prefix)} ist keine Netzadresse.`);
  const gateway = address(raw.gateway, "Gateway");
  if (gateway && !cidrContainsIp(cidr, parseIp(gateway)!)) {
    throw new RowError(`Gateway ${gateway} liegt nicht im Subnetz.`);
  }
  const dhcpStart = address(raw.dhcpStart, "DHCP-Beginn");
  const dhcpEnd = address(raw.dhcpEnd, "DHCP-Ende");
  if ((dhcpStart === null) !== (dhcpEnd === null))
    throw new RowError("DHCP-Bereich ist unvollständig.");
  if (dhcpStart && dhcpEnd) {
    const start = parseIp(dhcpStart)!;
    const end = parseIp(dhcpEnd)!;
    if (
      !cidrContainsIp(cidr, start) ||
      !cidrContainsIp(cidr, end) ||
      start.value > end.value
    ) {
      throw new RowError("DHCP-Bereich liegt nicht im Subnetz.");
    }
  }
  return {
    key: key(raw.key),
    prefix: formatCidr(cidr),
    vrf: str(raw.vrf, "VRF", 80),
    site: str(raw.site, "Standort", 120),
    vlanNumber: int(raw.vlanNumber, "VLAN-Nummer", 1, 4094),
    status: oneOf(raw.status ?? "active", PREFIX_STATUS, "Status"),
    securityZone: str(raw.securityZone, "Sicherheitszone", 60),
    gateway,
    gatewayDevice: str(raw.gatewayDevice, "Gateway-Gerät", 160),
    dhcpHelper: str(raw.dhcpHelper, "DHCP-Helper", 200),
    dhcpStart,
    dhcpEnd,
    description: str(raw.description, "Beschreibung", 1000),
    tags: tags(raw.tags),
    customFields: customFields(raw.customFields),
  };
}

function parseAddress(raw: Record<string, unknown>): AddressRow {
  return {
    key: key(raw.key),
    address: address(raw.address, "IP-Adresse", true)!,
    vrf: str(raw.vrf, "VRF", 80),
    status: oneOf(raw.status ?? "active", ADDRESS_STATUS, "Status"),
    hostname: str(raw.hostname, "Hostname", 253),
    dnsName: str(raw.dnsName, "DNS-Name", 253),
    macAddress: mac(raw.macAddress),
    deviceType:
      raw.deviceType === null || raw.deviceType === undefined
        ? null
        : oneOf(raw.deviceType, DEVICE_TYPES, "Gerätetyp"),
    description: str(raw.description, "Beschreibung", 1000),
    switchName: str(raw.switchName, "Switch", 160),
    switchPort: str(raw.switchPort, "Port", 80),
    tags: tags(raw.tags),
    customFields: customFields(raw.customFields),
  };
}

function parseDevice(raw: Record<string, unknown>): DeviceRow {
  const serial = str(raw.serialNumber, "Seriennummer", 160);
  if (serial && /[\u0000-\u001f]/.test(serial))
    throw new RowError("Seriennummer ist ungültig.");
  return {
    key: key(raw.key),
    name: str(raw.name, "Name", 240, true)!,
    category: oneOf(raw.category, DEVICE_CATEGORIES, "Kategorie"),
    serialNumber: serial,
    macAddress: mac(raw.macAddress),
    ipAddress: address(raw.ipAddress, "IP-Adresse"),
    hostname: str(raw.hostname, "Hostname", 253),
    manufacturer: str(raw.manufacturer, "Hersteller", 160),
    model: str(raw.model, "Modell", 160),
    location: str(raw.location, "Standort", 160),
    uplink: str(raw.uplink, "Uplink", 160),
    uplinkPort: str(raw.uplinkPort, "Uplink-Port", 40),
    notes: str(raw.notes, "Notizen", 4000),
    lifecycleState: oneOf(
      raw.lifecycleState ?? "active",
      ["active", "stock"] as const,
      "Lebenszyklus",
    ),
  };
}

const PARSERS: { [K in Kind]: (raw: Record<string, unknown>) => RowByKind[K] } =
  {
    sites: parseSite,
    vlans: parseVlan,
    prefixes: parsePrefix,
    addresses: parseAddress,
    devices: parseDevice,
  };

export type RowFailure = { key: string; message: string };

/** Validates rows of one kind; invalid rows become failures (not thrown). */
export function validateRows<K extends Kind>(
  kind: K,
  rows: unknown[],
): { valid: RowByKind[K][]; failures: RowFailure[] } {
  const valid: RowByKind[K][] = [];
  const failures: RowFailure[] = [];
  const seen = new Set<string>();
  rows.forEach((raw, index) => {
    const fallbackKey =
      isRecord(raw) && typeof raw.key === "string"
        ? raw.key.slice(0, 300)
        : `#${index + 1}`;
    if (!isRecord(raw)) {
      failures.push({ key: fallbackKey, message: "Zeile ist ungültig." });
      return;
    }
    try {
      const row = PARSERS[kind](raw);
      if (seen.has(row.key)) {
        failures.push({ key: row.key, message: "Zeile ist doppelt." });
        return;
      }
      seen.add(row.key);
      valid.push(row);
    } catch (error) {
      if (error instanceof RowError)
        failures.push({ key: fallbackKey, message: error.message });
      else throw error;
    }
  });
  return { valid, failures };
}

// ------------------------------------------------------------------ request

export type ImportOptions = {
  vrfId: string | null;
  departmentId: string | null;
  mode: "update" | "skip";
  createLocations: boolean;
};

export type ImportRequest =
  | { type: "context"; tenantId: string }
  | {
      type: "preview" | "apply";
      tenantId: string;
      kind: Kind;
      rows: unknown[];
      options: ImportOptions;
      source: string;
    };

export function parseOptions(value: unknown): ImportOptions | null {
  const raw = isRecord(value) ? value : {};
  const vrfId = raw.vrfId ?? null;
  const departmentId = raw.departmentId ?? null;
  if (vrfId !== null && !isUuid(vrfId)) return null;
  if (departmentId !== null && !isUuid(departmentId)) return null;
  const mode = raw.mode ?? "update";
  if (mode !== "update" && mode !== "skip") return null;
  return {
    vrfId: vrfId ? String(vrfId).toLowerCase() : null,
    departmentId: departmentId ? String(departmentId).toLowerCase() : null,
    mode,
    createLocations: raw.createLocations === true,
  };
}

export function parseRequest(body: unknown): ImportRequest | null {
  if (!isRecord(body) || !isUuid(body.tenantId)) return null;
  const tenantId = body.tenantId.toLowerCase();
  if (body.action === "context") return { type: "context", tenantId };
  if (body.action !== "preview" && body.action !== "apply") return null;
  if (
    typeof body.kind !== "string" ||
    !(KINDS as readonly string[]).includes(body.kind)
  )
    return null;
  if (
    !Array.isArray(body.rows) ||
    body.rows.length === 0 ||
    body.rows.length > MAX_ROWS
  )
    return null;
  const options = parseOptions(body.options);
  if (!options) return null;
  const source =
    typeof body.source === "string" && /^[a-z_]{1,30}$/.test(body.source)
      ? body.source
      : "import";
  return {
    type: body.action,
    tenantId,
    kind: body.kind as Kind,
    rows: body.rows,
    options,
    source,
  };
}

// ------------------------------------------------------------------ changes

/**
 * Fields to write for an existing row: values the import brings that differ
 * from what is stored. Empty import values never clear stored ones.
 */
export function changedFields(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  compare: Record<string, (value: unknown) => unknown> = {},
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(incoming)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const current = Array.isArray(existing[field])
        ? (existing[field] as unknown[]).map(String)
        : [];
      const merged = [...new Set([...current, ...value.map(String)])];
      if (merged.length !== current.length) changes[field] = merged;
      continue;
    }
    if (typeof value === "object") {
      const current = isRecord(existing[field])
        ? (existing[field] as Record<string, unknown>)
        : {};
      const merged = { ...current, ...(value as Record<string, unknown>) };
      if (JSON.stringify(merged) !== JSON.stringify(current))
        changes[field] = merged;
      continue;
    }
    const normalize = compare[field] ?? ((entry: unknown) => entry);
    if (normalize(existing[field] ?? null) !== normalize(value))
      changes[field] = value;
  }
  return changes;
}

/** «WG6 SW016» → the device named «SW016» (exact name first, then a word). */
export function matchUplink(
  text: string | null,
  names: Map<string, string>,
): string | null {
  if (!text) return null;
  const exact = names.get(text.trim().toLowerCase());
  if (exact) return exact;
  for (const token of text.split(/[\s,;/]+/)) {
    const id = names.get(token.trim().toLowerCase());
    if (id) return id;
  }
  return null;
}
