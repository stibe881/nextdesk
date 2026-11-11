// IPAM edge function: request parsing, validation, forecast and exports.
// Pure code without database access so it can be tested with `deno test`.

import {
  addressInRange,
  type Cidr,
  cidrContainsAddress,
  formatAddress,
  formatCidr,
  ipv4Netmask,
  normalizeMac,
  parseAddress,
  parseCidrInput,
} from "../_shared/ipam-cidr.ts";

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const PREFIX_STATUSES = ["container", "active", "reserved", "deprecated"] as const;
export const ADDRESS_STATUSES = ["active", "reserved", "dhcp", "deprecated"] as const;
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
export const ENTITIES = ["vrf", "site", "vlan", "prefix", "address"] as const;
export const EXPORT_SCOPES = ["all", "prefixes", "addresses", "vlans"] as const;

export type PrefixStatus = (typeof PREFIX_STATUSES)[number];
export type AddressStatus = (typeof ADDRESS_STATUSES)[number];
export type DeviceType = (typeof DEVICE_TYPES)[number];
export type Entity = (typeof ENTITIES)[number];

export class InputError extends Error {}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Optional uuid: null/""/undefined → null, invalid → InputError. */
function optionalUuid(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (!isUuid(value)) throw new InputError(`${label} ist ungültig.`);
  return value.toLowerCase();
}

/** Trimmed text or null; too long → InputError. */
export function optionalText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new InputError(`${label} ist ungültig.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new InputError(`${label} darf höchstens ${max} Zeichen lang sein.`);
  }
  return trimmed;
}

function requiredText(value: unknown, max: number, label: string): string {
  const text = optionalText(value, max, label);
  if (!text) throw new InputError(`Bitte erfassen Sie ${label}.`);
  return text;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T | null,
  label: string,
): T {
  if ((value === undefined || value === null || value === "") && fallback !== null) return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new InputError(`${label} ist ungültig.`);
}

function optionalOneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T | null {
  if (value === undefined || value === null || value === "") return null;
  return oneOf(value, allowed, null, label);
}

export function optionalDay(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !ISO_DAY.test(value) || Number.isNaN(Date.parse(value))) {
    throw new InputError(`${label} ist ungültig.`);
  }
  return value;
}

export function parseTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new InputError("Es sind höchstens 20 Schlagwörter möglich.");
  }
  const tags = value.map((tag) => {
    if (typeof tag !== "string" || !tag.trim() || tag.trim().length > 40) {
      throw new InputError("Ein Schlagwort ist ungültig (höchstens 40 Zeichen).");
    }
    return tag.trim();
  });
  return [...new Set(tags)];
}

/** Own fields: up to 30 keys, values text/number/boolean (≤ 500 chars). */
export function parseCustomFields(value: unknown): Record<string, string | number | boolean> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new InputError("Die eigenen Felder sind ungültig.");
  const entries = Object.entries(value);
  if (entries.length > 30) throw new InputError("Es sind höchstens 30 eigene Felder möglich.");
  const result: Record<string, string | number | boolean> = {};
  for (const [rawKey, raw] of entries) {
    const key = rawKey.trim();
    if (!key || key.length > 60) throw new InputError("Ein Feldname ist ungültig (höchstens 60 Zeichen).");
    if (raw === null || raw === "") continue;
    if (typeof raw === "boolean" || (typeof raw === "number" && Number.isFinite(raw))) {
      result[key] = raw;
    } else if (typeof raw === "string" && raw.length <= 500) {
      result[key] = raw.trim();
    } else {
      throw new InputError(`Der Wert von «${key}» ist ungültig (höchstens 500 Zeichen).`);
    }
  }
  return result;
}

/** Single address (IPv4/IPv6), canonical text. */
export function parseAddressText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new InputError(`${label} ist ungültig.`);
  const trimmed = value.trim().replace(/\/(32|128)$/, "");
  const address = parseAddress(trimmed);
  if (!address) throw new InputError(`${label} «${value.trim().slice(0, 60)}» ist keine gültige IP-Adresse.`);
  return formatAddress(address);
}

function optionalAddressText(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return parseAddressText(value, label);
}

/** Prefix in CIDR notation; host bits produce a helpful message. */
export function parsePrefixText(value: unknown): Cidr {
  if (typeof value !== "string" || !value.trim()) {
    throw new InputError("Bitte erfassen Sie das Subnetz in CIDR-Schreibweise (z. B. 10.20.30.0/24).");
  }
  if (!value.includes("/")) {
    throw new InputError("Bitte geben Sie die Präfixlänge an (z. B. 10.20.30.0/24).");
  }
  const parsed = parseCidrInput(value);
  if (!parsed) {
    throw new InputError(`«${value.trim().slice(0, 60)}» ist kein gültiges Subnetz.`);
  }
  if (parsed.hostBitsSet) {
    throw new InputError(
      `«${value.trim()}» ist keine Netzadresse. Meinten Sie ${formatCidr(parsed.cidr)}?`,
    );
  }
  return parsed.cidr;
}

export type VrfInput = {
  id: string | null;
  name: string;
  routeDistinguisher: string | null;
  description: string | null;
};
export type SiteInput = {
  id: string | null;
  name: string;
  code: string | null;
  address: string | null;
  description: string | null;
  departmentId: string | null;
};
export type VlanInput = {
  id: string | null;
  vlanNumber: number;
  name: string;
  siteId: string | null;
  departmentId: string | null;
  description: string | null;
};
export type PrefixInput = {
  id: string | null;
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
  utilizationWarningPercent: number;
  tags: string[];
  customFields: Record<string, string | number | boolean>;
  departmentId: string | null;
};
export type AddressInput = {
  id: string | null;
  address: string;
  vrfId: string | null;
  status: AddressStatus;
  hostname: string | null;
  dnsName: string | null;
  macAddress: string | null;
  vendor: string | null;
  deviceType: DeviceType | null;
  description: string | null;
  switchName: string | null;
  switchPort: string | null;
  ownerUserId: string | null;
  teamId: string | null;
  assetId: string | null;
  serviceId: string | null;
  reservedUntil: string | null;
  tags: string[];
  customFields: Record<string, string | number | boolean>;
};

export function parseVrf(value: unknown): VrfInput {
  if (!isRecord(value)) throw new InputError("Die Angaben zum VRF fehlen.");
  return {
    id: optionalUuid(value.id, "Das VRF"),
    name: requiredText(value.name, 80, "einen Namen"),
    routeDistinguisher: optionalText(value.routeDistinguisher, 40, "Der Route Distinguisher"),
    description: optionalText(value.description, 500, "Die Beschreibung"),
  };
}

export function parseSite(value: unknown): SiteInput {
  if (!isRecord(value)) throw new InputError("Die Angaben zum Standort fehlen.");
  return {
    id: optionalUuid(value.id, "Der Standort"),
    name: requiredText(value.name, 120, "einen Namen"),
    code: optionalText(value.code, 40, "Das Kürzel"),
    address: optionalText(value.address, 300, "Die Adresse"),
    description: optionalText(value.description, 500, "Die Beschreibung"),
    departmentId: optionalUuid(value.departmentId, "Die Abteilung"),
  };
}

export function parseVlan(value: unknown): VlanInput {
  if (!isRecord(value)) throw new InputError("Die Angaben zum VLAN fehlen.");
  const number = typeof value.vlanNumber === "string" ? Number(value.vlanNumber) : value.vlanNumber;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1 || number > 4094) {
    throw new InputError("Die VLAN-ID muss zwischen 1 und 4094 liegen.");
  }
  return {
    id: optionalUuid(value.id, "Das VLAN"),
    vlanNumber: number,
    name: requiredText(value.name, 120, "einen Namen"),
    siteId: optionalUuid(value.siteId, "Der Standort"),
    departmentId: optionalUuid(value.departmentId, "Die Abteilung"),
    description: optionalText(value.description, 1000, "Die Beschreibung"),
  };
}

export function parsePrefix(value: unknown): PrefixInput {
  if (!isRecord(value)) throw new InputError("Die Angaben zum Subnetz fehlen.");
  const cidr = parsePrefixText(value.prefix);
  const gateway = optionalAddressText(value.gateway, "Das Gateway");
  const dhcpStart = optionalAddressText(value.dhcpStart, "Der Beginn des DHCP-Bereichs");
  const dhcpEnd = optionalAddressText(value.dhcpEnd, "Das Ende des DHCP-Bereichs");
  validatePrefixRanges(cidr, gateway, dhcpStart, dhcpEnd);
  const warning = value.utilizationWarningPercent === undefined || value.utilizationWarningPercent === null
    ? 85
    : Number(value.utilizationWarningPercent);
  if (!Number.isInteger(warning) || warning < 50 || warning > 100) {
    throw new InputError("Die Warnschwelle muss zwischen 50 und 100 % liegen.");
  }
  return {
    id: optionalUuid(value.id, "Das Subnetz"),
    prefix: formatCidr(cidr),
    vrfId: optionalUuid(value.vrfId, "Das VRF"),
    siteId: optionalUuid(value.siteId, "Der Standort"),
    vlanId: optionalUuid(value.vlanId, "Das VLAN"),
    status: oneOf(value.status, PREFIX_STATUSES, "active", "Der Status"),
    securityZone: optionalText(value.securityZone, 60, "Die Sicherheitszone"),
    gateway,
    gatewayDevice: optionalText(value.gatewayDevice, 160, "Das Gateway-Gerät"),
    dhcpHelper: optionalText(value.dhcpHelper, 200, "Der DHCP-Helper"),
    dhcpStart,
    dhcpEnd,
    description: optionalText(value.description, 1000, "Die Beschreibung"),
    utilizationWarningPercent: warning,
    tags: parseTags(value.tags),
    customFields: parseCustomFields(value.customFields),
    departmentId: optionalUuid(value.departmentId, "Die Abteilung"),
  };
}

/** Gateway and DHCP range must lie inside the prefix (mirrors the DB checks). */
export function validatePrefixRanges(
  cidr: Cidr,
  gateway: string | null,
  dhcpStart: string | null,
  dhcpEnd: string | null,
): void {
  const inside = (text: string) => {
    const address = parseAddress(text);
    return address !== null && cidrContainsAddress(cidr, address);
  };
  if (gateway && !inside(gateway)) {
    throw new InputError(`Das Gateway ${gateway} liegt nicht im Subnetz ${formatCidr(cidr)}.`);
  }
  if ((dhcpStart === null) !== (dhcpEnd === null)) {
    throw new InputError("Bitte erfassen Sie Beginn und Ende des DHCP-Bereichs.");
  }
  if (dhcpStart && dhcpEnd) {
    if (!inside(dhcpStart) || !inside(dhcpEnd)) {
      throw new InputError(`Der DHCP-Bereich liegt nicht vollständig im Subnetz ${formatCidr(cidr)}.`);
    }
    const start = parseAddress(dhcpStart)!;
    const end = parseAddress(dhcpEnd)!;
    if (start.value > end.value) {
      throw new InputError("Der Beginn des DHCP-Bereichs liegt nach dessen Ende.");
    }
    if (start.value === cidr.network) {
      throw new InputError("Der DHCP-Bereich darf die Netzadresse nicht enthalten.");
    }
    if (gateway) {
      const gatewayAddress = parseAddress(gateway)!;
      if (addressInRange(gatewayAddress, start, end)) {
        throw new InputError("Das Gateway liegt im DHCP-Bereich.");
      }
    }
  }
}

export function parseAddressInput(value: unknown): AddressInput {
  if (!isRecord(value)) throw new InputError("Die Angaben zur Adresse fehlen.");
  let mac: string | null = null;
  if (typeof value.macAddress === "string" && value.macAddress.trim()) {
    mac = normalizeMac(value.macAddress);
    if (!mac) throw new InputError("Die MAC-Adresse ist ungültig (z. B. 00:1E:0B:7A:41:C9).");
  }
  return {
    id: optionalUuid(value.id, "Die Adresse"),
    address: parseAddressText(value.address, "Die Adresse"),
    vrfId: optionalUuid(value.vrfId, "Das VRF"),
    status: oneOf(value.status, ADDRESS_STATUSES, "active", "Der Status"),
    hostname: optionalText(value.hostname, 253, "Der Hostname"),
    dnsName: optionalText(value.dnsName, 253, "Der DNS-Name"),
    macAddress: mac,
    vendor: optionalText(value.vendor, 160, "Der Hersteller"),
    deviceType: optionalOneOf(value.deviceType, DEVICE_TYPES, "Der Gerätetyp"),
    description: optionalText(value.description, 1000, "Die Beschreibung"),
    switchName: optionalText(value.switchName, 160, "Der Switch"),
    switchPort: optionalText(value.switchPort, 80, "Der Switch-Port"),
    ownerUserId: optionalUuid(value.ownerUserId, "Die verantwortliche Person"),
    teamId: optionalUuid(value.teamId, "Das Team"),
    assetId: optionalUuid(value.assetId, "Das Asset"),
    serviceId: optionalUuid(value.serviceId, "Der Dienst"),
    reservedUntil: optionalDay(value.reservedUntil, "Das Ablaufdatum der Reservierung"),
    tags: parseTags(value.tags),
    customFields: parseCustomFields(value.customFields),
  };
}

export type ReserveInput = {
  prefixId: string | null;
  vrfId: string | null;
  address: string;
  hostname: string | null;
  description: string | null;
  ownerUserId: string | null;
  teamId: string | null;
  reservedUntil: string | null;
  deviceType: DeviceType | null;
};

export type Action =
  | { type: "overview"; tenantId: string }
  | { type: "prefixDetail"; tenantId: string; prefixId: string; page: number; query: string | null }
  | {
    type: "addressDetail";
    tenantId: string;
    addressId: string | null;
    address: string | null;
    vrfId: string | null;
  }
  | { type: "search"; tenantId: string; query: string }
  | { type: "saveVrf"; tenantId: string; vrf: VrfInput }
  | { type: "saveSite"; tenantId: string; site: SiteInput }
  | { type: "saveVlan"; tenantId: string; vlan: VlanInput }
  | { type: "savePrefix"; tenantId: string; prefix: PrefixInput }
  | { type: "saveAddress"; tenantId: string; address: AddressInput }
  | { type: "delete"; tenantId: string; entity: Entity; id: string }
  | { type: "nextFreeAddress"; tenantId: string; prefixId: string; after: string | null }
  | { type: "reserveAddress"; tenantId: string; reservation: ReserveInput }
  | { type: "releaseAddress"; tenantId: string; addressId: string; note: string | null }
  | { type: "nextFreePrefix"; tenantId: string; parentId: string; length: number }
  | {
    type: "createPrefix";
    tenantId: string;
    parentId: string;
    length: number;
    description: string | null;
    vlanId: string | null;
    status: PrefixStatus;
  }
  | { type: "splitPrefix"; tenantId: string; prefixId: string; length: number }
  | { type: "findings"; tenantId: string; status: "open" | "resolved" | "ignored" | "all" }
  | {
    type: "resolveFinding";
    tenantId: string;
    findingId: string;
    status: "resolved" | "ignored" | "open";
  }
  | { type: "adoptFinding"; tenantId: string; findingId: string }
  | { type: "findingTicket"; tenantId: string; findingId: string }
  | {
    type: "addressTicket";
    tenantId: string;
    addressId: string;
    subject: string | null;
    description: string | null;
  }
  | {
    type: "export";
    tenantId: string;
    format: "csv" | "json";
    scope: (typeof EXPORT_SCOPES)[number];
  }
  | {
    type: "exportSophos";
    tenantId: string;
    format: "xml" | "csv";
    prefixIds: string[] | null;
    includeHosts: boolean;
    includeGroups: boolean;
  }
  | { type: "forecast"; tenantId: string; prefixId: string | null }
  | { type: "networkMapOverlay"; tenantId: string }
  | { type: "lookups"; tenantId: string };

/** Actions that only read; everything else needs ipam.manage. */
export const READ_ACTIONS: ReadonlySet<Action["type"]> = new Set([
  "overview",
  "prefixDetail",
  "addressDetail",
  "search",
  "nextFreeAddress",
  "nextFreePrefix",
  "findings",
  "export",
  "exportSophos",
  "forecast",
  "networkMapOverlay",
  "lookups",
]);

function prefixLength(value: unknown): number {
  const length = typeof value === "string" ? Number(value) : value;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 1 || length > 128) {
    throw new InputError("Die Präfixlänge ist ungültig.");
  }
  return length;
}

/** Request body → action. Throws InputError with a German message. */
export function parseAction(body: unknown): Action {
  if (!isRecord(body) || typeof body.type !== "string") {
    throw new InputError("Die Anfrage ist unvollständig.");
  }
  if (!isUuid(body.tenantId)) throw new InputError("Der Mandant ist ungültig.");
  const tenantId = body.tenantId.toLowerCase();
  const uuid = (value: unknown, label: string) => {
    if (!isUuid(value)) throw new InputError(`${label} ist ungültig.`);
    return value.toLowerCase();
  };
  switch (body.type) {
    case "overview":
    case "networkMapOverlay":
    case "lookups":
      return { type: body.type, tenantId };
    case "prefixDetail": {
      const page = body.page === undefined ? 0 : Number(body.page);
      if (!Number.isInteger(page) || page < 0 || page > 10000) {
        throw new InputError("Die Seite ist ungültig.");
      }
      return {
        type: "prefixDetail",
        tenantId,
        prefixId: uuid(body.prefixId, "Das Subnetz"),
        page,
        query: optionalText(body.query, 100, "Die Suche"),
      };
    }
    case "addressDetail": {
      const addressId = optionalUuid(body.addressId, "Die Adresse");
      const address = addressId ? null : parseAddressText(body.address, "Die Adresse");
      return {
        type: "addressDetail",
        tenantId,
        addressId,
        address,
        vrfId: optionalUuid(body.vrfId, "Das VRF"),
      };
    }
    case "search": {
      const query = optionalText(body.query, 100, "Die Suche");
      if (!query || query.length < 2) throw new InputError("Bitte geben Sie mindestens zwei Zeichen ein.");
      return { type: "search", tenantId, query };
    }
    case "saveVrf":
      return { type: "saveVrf", tenantId, vrf: parseVrf(body.vrf) };
    case "saveSite":
      return { type: "saveSite", tenantId, site: parseSite(body.site) };
    case "saveVlan":
      return { type: "saveVlan", tenantId, vlan: parseVlan(body.vlan) };
    case "savePrefix":
      return { type: "savePrefix", tenantId, prefix: parsePrefix(body.prefix) };
    case "saveAddress":
      return { type: "saveAddress", tenantId, address: parseAddressInput(body.address) };
    case "delete":
      return {
        type: "delete",
        tenantId,
        entity: oneOf(body.entity, ENTITIES, null, "Der Eintrag"),
        id: uuid(body.id, "Der Eintrag"),
      };
    case "nextFreeAddress":
      return {
        type: "nextFreeAddress",
        tenantId,
        prefixId: uuid(body.prefixId, "Das Subnetz"),
        after: optionalAddressText(body.after, "Die Startadresse"),
      };
    case "reserveAddress": {
      const value = isRecord(body.reservation) ? body.reservation : body;
      return {
        type: "reserveAddress",
        tenantId,
        reservation: {
          prefixId: optionalUuid(value.prefixId, "Das Subnetz"),
          vrfId: optionalUuid(value.vrfId, "Das VRF"),
          address: parseAddressText(value.address, "Die Adresse"),
          hostname: optionalText(value.hostname, 253, "Der Hostname"),
          description: optionalText(value.description, 1000, "Der Zweck"),
          ownerUserId: optionalUuid(value.ownerUserId, "Die verantwortliche Person"),
          teamId: optionalUuid(value.teamId, "Das Team"),
          reservedUntil: optionalDay(value.reservedUntil, "Das Ablaufdatum"),
          deviceType: optionalOneOf(value.deviceType, DEVICE_TYPES, "Der Gerätetyp"),
        },
      };
    }
    case "releaseAddress":
      return {
        type: "releaseAddress",
        tenantId,
        addressId: uuid(body.addressId, "Die Adresse"),
        note: optionalText(body.note, 500, "Die Notiz"),
      };
    case "nextFreePrefix":
      return {
        type: "nextFreePrefix",
        tenantId,
        parentId: uuid(body.parentId, "Das übergeordnete Subnetz"),
        length: prefixLength(body.length),
      };
    case "createPrefix":
      return {
        type: "createPrefix",
        tenantId,
        parentId: uuid(body.parentId, "Das übergeordnete Subnetz"),
        length: prefixLength(body.length),
        description: optionalText(body.description, 1000, "Die Beschreibung"),
        vlanId: optionalUuid(body.vlanId, "Das VLAN"),
        status: oneOf(body.status, PREFIX_STATUSES, "active", "Der Status"),
      };
    case "splitPrefix":
      return {
        type: "splitPrefix",
        tenantId,
        prefixId: uuid(body.prefixId, "Das Subnetz"),
        length: prefixLength(body.length),
      };
    case "findings":
      return {
        type: "findings",
        tenantId,
        status: oneOf(body.status, ["open", "resolved", "ignored", "all"] as const, "open", "Der Status"),
      };
    case "resolveFinding":
      return {
        type: "resolveFinding",
        tenantId,
        findingId: uuid(body.findingId, "Der Fund"),
        status: oneOf(body.status, ["resolved", "ignored", "open"] as const, "resolved", "Der Status"),
      };
    case "adoptFinding":
    case "findingTicket":
      return { type: body.type, tenantId, findingId: uuid(body.findingId, "Der Fund") };
    case "addressTicket":
      return {
        type: "addressTicket",
        tenantId,
        addressId: uuid(body.addressId, "Die Adresse"),
        subject: optionalText(body.subject, 240, "Der Betreff"),
        description: optionalText(body.description, 5000, "Die Beschreibung"),
      };
    case "export":
      return {
        type: "export",
        tenantId,
        format: oneOf(body.format, ["csv", "json"] as const, "csv", "Das Format"),
        scope: oneOf(body.scope, EXPORT_SCOPES, "all", "Der Umfang"),
      };
    case "exportSophos": {
      let prefixIds: string[] | null = null;
      if (Array.isArray(body.prefixIds)) {
        if (body.prefixIds.length > 2000 || !body.prefixIds.every(isUuid)) {
          throw new InputError("Die Auswahl der Subnetze ist ungültig.");
        }
        prefixIds = [...new Set((body.prefixIds as string[]).map((id) => id.toLowerCase()))];
      }
      return {
        type: "exportSophos",
        tenantId,
        format: oneOf(body.format, ["xml", "csv"] as const, "xml", "Das Format"),
        prefixIds,
        includeHosts: body.includeHosts !== false,
        includeGroups: body.includeGroups !== false,
      };
    }
    case "forecast":
      return { type: "forecast", tenantId, prefixId: optionalUuid(body.prefixId, "Das Subnetz") };
    default:
      throw new InputError("Diese Aktion ist unbekannt.");
  }
}

// ---------------------------------------------------------------------------
// Forecast

export type UtilizationPoint = { day: string; used: number; total: number };
export type Forecast = {
  /** Day when the warning threshold is reached (today when already above). */
  warningOn: string | null;
  /** Day when the prefix is full (today when already full). */
  fullOn: string | null;
  /** Additional addresses per day (trend), rounded to two decimals. */
  perDay: number | null;
  points: number;
};

const DAY_MS = 86_400_000;

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

function dayText(value: number): string {
  return new Date(value * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Linear regression of used addresses over days. Needs at least 5 points
 * spanning 7 days and a rising trend; dates further than 5 years ahead are
 * dropped (null). Days are ISO dates (YYYY-MM-DD).
 */
export function forecastUtilization(
  points: UtilizationPoint[],
  warningPercent: number,
  maxYears = 5,
): Forecast {
  const valid = points
    .filter((point) => ISO_DAY.test(point.day) && Number.isFinite(point.used) && point.total > 0)
    .sort((a, b) => a.day.localeCompare(b.day));
  const empty: Forecast = { warningOn: null, fullOn: null, perDay: null, points: valid.length };
  if (valid.length < 5) return empty;
  const xs = valid.map((point) => dayNumber(point.day));
  const ys = valid.map((point) => point.used);
  const first = xs[0]!;
  const lastX = xs[xs.length - 1]!;
  if (lastX - first < 7) return empty;
  const n = xs.length;
  const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index++) {
    numerator += (xs[index]! - meanX) * (ys[index]! - meanY);
    denominator += (xs[index]! - meanX) ** 2;
  }
  if (denominator === 0) return empty;
  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  const last = valid[valid.length - 1]!;
  const total = last.total;
  const perDay = Math.round(slope * 100) / 100;
  const reach = (target: number): string | null => {
    if (last.used >= target) return last.day;
    if (slope <= 0) return null;
    const x = Math.ceil((target - intercept) / slope);
    const day = Math.max(x, lastX);
    if (day - lastX > maxYears * 366) return null;
    return dayText(day);
  };
  return {
    warningOn: reach((total * warningPercent) / 100),
    fullOn: reach(total),
    perDay,
    points: n,
  };
}

// ---------------------------------------------------------------------------
// Exports

/** CSV cell with quoting and protection against spreadsheet formulas. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[";\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Semicolon-separated CSV with BOM so Excel (de-CH) opens it directly. */
export function csvDocument(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(";"), ...rows.map((row) => row.map(csvCell).join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Object name for Sophos Firewall: letters, digits, space, «_ - . #», at
 * most 50 characters; umlauts transliterated.
 */
export function sophosName(value: string): string {
  const transliterated = value
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const cleaned = transliterated
    .replace(/[/:]/g, "_")
    .replace(/[^A-Za-z0-9 _.\-#]/g, "_")
    .replace(/_+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[_ .\-]+|[_ .\-]+$/g, "");
  return (cleaned || "Objekt").slice(0, 50).trim();
}

/** Makes names unique («Name», «Name_2» …) within one export. */
export function uniqueNamer(): (name: string) => string {
  const used = new Set<string>();
  return (name: string) => {
    let candidate = name;
    let counter = 2;
    while (used.has(candidate.toLowerCase())) {
      const suffix = `_${counter++}`;
      candidate = `${name.slice(0, 50 - suffix.length)}${suffix}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  };
}

export type SophosNetwork = { id: string; prefix: string; description: string | null; vlanNumber: number | null };
export type SophosHost = { prefixId: string | null; address: string; hostname: string | null; description: string | null };

export type SophosObject =
  | { kind: "network"; name: string; family: "IPv4" | "IPv6"; address: string; subnet: string; description: string }
  | { kind: "host"; name: string; family: "IPv4" | "IPv6"; address: string; description: string }
  | { kind: "group"; name: string; family: "IPv4" | "IPv6"; hosts: string[]; description: string };

/** Builds the Sophos objects: networks, single hosts and one group per network. */
export function sophosObjects(
  networks: SophosNetwork[],
  hosts: SophosHost[],
  options: { includeHosts: boolean; includeGroups: boolean },
): SophosObject[] {
  const name = uniqueNamer();
  const objects: SophosObject[] = [];
  const networkNames = new Map<string, string>();
  for (const network of networks) {
    const parsed = parseCidrInput(network.prefix);
    if (!parsed) continue;
    const cidr = parsed.cidr;
    const family = cidr.version === 4 ? "IPv4" : "IPv6";
    const base = network.description
      ? `NET_${network.description}`
      : `NET_${formatCidr(cidr)}`;
    const objectName = name(sophosName(base));
    networkNames.set(network.id, objectName);
    objects.push({
      kind: "network",
      name: objectName,
      family,
      address: formatAddress({ version: cidr.version, value: cidr.network }),
      subnet: cidr.version === 4 ? ipv4Netmask(cidr.length) : String(cidr.length),
      description: [
        formatCidr(cidr),
        network.vlanNumber ? `VLAN ${network.vlanNumber}` : null,
        network.description,
      ].filter(Boolean).join(" · ").slice(0, 255),
    });
  }
  if (!options.includeHosts) return objects;
  const groups = new Map<string, { family: "IPv4" | "IPv6"; hosts: string[] }>();
  for (const host of hosts) {
    const address = parseAddress(host.address);
    if (!address) continue;
    const family = address.version === 4 ? "IPv4" : "IPv6";
    const text = formatAddress(address);
    const objectName = name(sophosName(host.hostname ? `H_${host.hostname}` : `H_${text}`));
    objects.push({
      kind: "host",
      name: objectName,
      family,
      address: text,
      description: [text, host.description].filter(Boolean).join(" · ").slice(0, 255),
    });
    if (options.includeGroups && host.prefixId && networkNames.has(host.prefixId)) {
      const group = groups.get(host.prefixId) ?? { family, hosts: [] };
      group.hosts.push(objectName);
      groups.set(host.prefixId, group);
    }
  }
  for (const [prefixId, group] of groups) {
    const networkName = networkNames.get(prefixId)!;
    objects.push({
      kind: "group",
      name: name(sophosName(`GRP_${networkName.replace(/^NET_/, "")}`)),
      family: group.family,
      hosts: group.hosts,
      description: `Hosts in ${networkName}`.slice(0, 255),
    });
  }
  return objects;
}

/** Sophos Firewall (SFOS) import XML: IPHost and IPHostGroup entries. */
export function sophosXml(objects: SophosObject[]): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<Configuration APIVersion="1905.1" IPS_CAT_VER="1">'];
  const tag = (name: string, value: string) => `    <${name}>${xmlEscape(value)}</${name}>`;
  for (const object of objects) {
    if (object.kind === "group") continue;
    lines.push('  <IPHost transactionid="">');
    lines.push(tag("Name", object.name));
    lines.push(tag("IPFamily", object.family));
    lines.push(tag("HostType", object.kind === "network" ? "Network" : "IP"));
    lines.push(tag("IPAddress", object.address));
    if (object.kind === "network") lines.push(tag("Subnet", object.subnet));
    lines.push(tag("Description", object.description));
    lines.push("  </IPHost>");
  }
  for (const object of objects) {
    if (object.kind !== "group") continue;
    lines.push('  <IPHostGroup transactionid="">');
    lines.push(tag("Name", object.name));
    lines.push(tag("Description", object.description));
    lines.push("    <HostList>");
    for (const host of object.hosts) lines.push(`      <Host>${xmlEscape(host)}</Host>`);
    lines.push("    </HostList>");
    lines.push(tag("IPFamily", object.family));
    lines.push("  </IPHostGroup>");
  }
  lines.push("</Configuration>");
  return `${lines.join("\n")}\n`;
}

export function sophosCsv(objects: SophosObject[]): string {
  return csvDocument(
    ["Name", "Typ", "IP-Familie", "Adresse", "Subnetz", "Mitglieder", "Beschreibung"],
    objects.map((object) => [
      object.name,
      object.kind === "network" ? "Network" : object.kind === "host" ? "IP" : "HostGroup",
      object.family,
      object.kind === "group" ? "" : object.address,
      object.kind === "network" ? object.subnet : "",
      object.kind === "group" ? object.hosts.join(", ") : "",
      object.description,
    ]),
  );
}

/** Whole-word match of an IP address in free text (10.0.0.1 ≠ 10.0.0.12). */
export function textMentionsAddress(text: string, address: string): boolean {
  if (!text || !address) return false;
  const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z.:])${escaped}($|[^0-9A-Za-z:]|\\.(?![0-9]))`, "i").test(text);
}

/** Changed fields between two flat records (for the address history). */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const result: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) result[key] = { from, to };
  }
  return result;
}
