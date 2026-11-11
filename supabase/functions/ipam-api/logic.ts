// Reine Logik der IPAM-REST-API: Routen, Schlüssel, Paginierung,
// Validierung und Ausgabeformate (ohne Datenbankzugriff, testbar).

import { API_KEY_PATTERN, normalizeMac } from "../_shared/ipam-integrations.ts";

type Row = Record<string, unknown>;

export const API_VERSION = "1.0.0";
export const RATE_LIMIT_PER_MINUTE = 120;
export const MAX_BODY_BYTES = 16 * 1024;

export type RouteName =
  | "info"
  | "listPrefixes"
  | "prefixAddresses"
  | "nextAddress"
  | "nextPrefix"
  | "getAddress"
  | "updateAddress"
  | "releaseAddress"
  | "listVlans"
  | "search";

export type Route = { name: RouteName; prefixId?: string; address?: string };
export type RouteMatch =
  { route: Route } | { status: 404 | 405; allow?: string };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isIpAddress(value: string): boolean {
  if (IPV4.test(value)) return true;
  if (!/^[0-9a-f:]{2,39}$/i.test(value) || !value.includes(":")) return false;
  const doubles = value.split("::").length - 1;
  if (doubles > 1) return false;
  const groups = value.split(":").filter((group) => group !== "");
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return false;
  return doubles === 1 ? groups.length <= 7 : groups.length === 8;
}

export function isCidr(value: string): boolean {
  const [address, length, ...rest] = value.split("/");
  if (rest.length || !address || !length || !/^\d{1,3}$/.test(length))
    return false;
  return (
    isIpAddress(address) && Number(length) <= (address.includes(":") ? 128 : 32)
  );
}

/** Pfad ohne Funktionspräfix: «/functions/v1/ipam-api/prefixes» → «/prefixes». */
export function apiPath(pathname: string): string {
  const index = pathname.indexOf("/ipam-api");
  const rest =
    index >= 0 ? pathname.slice(index + "/ipam-api".length) : pathname;
  const trimmed = rest.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function matchRoute(method: string, pathname: string): RouteMatch {
  const path = apiPath(pathname);
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return "\u0000";
      }
    });
  const allow = (
    methods: string,
    name: RouteName,
    extra: Partial<Route> = {},
  ): RouteMatch =>
    methods.split(",").includes(method)
      ? { route: { name, ...extra } }
      : { status: 405, allow: methods };

  if (segments.length === 0) return allow("GET", "info");
  const [first, second, third] = segments;
  if (first === "prefixes") {
    if (segments.length === 1) return allow("GET", "listPrefixes");
    if (!second || !UUID.test(second) || segments.length !== 3)
      return { status: 404 };
    const prefixId = second.toLowerCase();
    if (third === "addresses")
      return allow("GET", "prefixAddresses", { prefixId });
    if (third === "next-address")
      return allow("POST", "nextAddress", { prefixId });
    if (third === "next-prefix")
      return allow("POST", "nextPrefix", { prefixId });
    return { status: 404 };
  }
  if (
    first === "addresses" &&
    segments.length === 2 &&
    second &&
    isIpAddress(second)
  ) {
    const address = second.toLowerCase();
    if (method === "GET") return { route: { name: "getAddress", address } };
    if (method === "PATCH")
      return { route: { name: "updateAddress", address } };
    if (method === "DELETE")
      return { route: { name: "releaseAddress", address } };
    return { status: 405, allow: "GET,PATCH,DELETE" };
  }
  if (first === "vlans" && segments.length === 1)
    return allow("GET", "listVlans");
  if (first === "search" && segments.length === 1)
    return allow("GET", "search");
  return { status: 404 };
}

export function requiredScope(route: RouteName): "read" | "write" {
  return route === "nextAddress" ||
    route === "nextPrefix" ||
    route === "updateAddress" ||
    route === "releaseAddress"
    ? "write"
    : "read";
}

/** «Authorization: Bearer ndk_ipam_…» oder «X-API-Key: ndk_ipam_…». */
export function extractApiKey(headers: Headers): string | null {
  const authorization = headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
  const key = bearer ?? headers.get("x-api-key")?.trim() ?? "";
  return API_KEY_PATTERN.test(key) ? key : null;
}

export type Pagination = { limit: number; offset: number };

export function parsePagination(params: URLSearchParams): Pagination | null {
  const limitRaw = params.get("limit");
  const offsetRaw = params.get("offset");
  const limit = limitRaw === null ? 100 : Number(limitRaw);
  const offset = offsetRaw === null ? 0 : Number(offsetRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return null;
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000)
    return null;
  return { limit, offset };
}

export function paginationOut(
  page: Pagination,
  total: number | null,
  returned: number,
) {
  const next = page.offset + returned;
  return {
    limit: page.limit,
    offset: page.offset,
    total,
    next_offset:
      total !== null
        ? next < total
          ? next
          : null
        : returned === page.limit
          ? next
          : null,
  };
}

/** VRF-Filter: «global» (Standard) oder eine VRF-ID. */
export function parseVrf(
  params: URLSearchParams,
): { vrfId: string | null } | null {
  const value = params.get("vrf");
  if (value === null || value === "" || value === "global")
    return { vrfId: null };
  return UUID.test(value) ? { vrfId: value.toLowerCase() } : null;
}

const ADDRESS_STATUSES = ["active", "reserved", "dhcp", "deprecated"] as const;
const PREFIX_STATUSES = [
  "container",
  "active",
  "reserved",
  "deprecated",
] as const;
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
const HOSTNAME =
  /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62})(?:\.[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}))*\.?$/;

export function isAddressStatus(
  value: unknown,
): value is (typeof ADDRESS_STATUSES)[number] {
  return (ADDRESS_STATUSES as readonly unknown[]).includes(value);
}
export function isPrefixStatus(
  value: unknown,
): value is (typeof PREFIX_STATUSES)[number] {
  return (PREFIX_STATUSES as readonly unknown[]).includes(value);
}

type FieldResult<T> = { ok: true; value: T } | { ok: false; field: string };

function hostnameField(
  value: unknown,
  field: string,
): FieldResult<string | null> {
  if (value === null || value === "") return { ok: true, value: null };
  if (
    typeof value !== "string" ||
    value.length > 253 ||
    !HOSTNAME.test(value.trim())
  )
    return { ok: false, field };
  return { ok: true, value: value.trim() };
}

function textField(
  value: unknown,
  field: string,
  max: number,
): FieldResult<string | null> {
  if (value === null || value === "") return { ok: true, value: null };
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    Array.from(value.trim()).length > max
  ) {
    return { ok: false, field };
  }
  return { ok: true, value: value.trim() || null };
}

function macField(value: unknown, field: string): FieldResult<string | null> {
  if (value === null || value === "") return { ok: true, value: null };
  const mac = normalizeMac(value);
  return mac ? { ok: true, value: mac } : { ok: false, field };
}

export type Validation<T> =
  { ok: true; value: T } | { ok: false; message: string };

function unknownKeys(body: Row, allowed: readonly string[]): string[] {
  return Object.keys(body).filter((key) => !allowed.includes(key));
}

export type ReserveInput = {
  hostname: string | null;
  description: string | null;
  mac: string | null;
  dnsName: string | null;
};

export function parseReserveBody(body: unknown): Validation<ReserveInput> {
  const value = body ?? {};
  if (typeof value !== "object" || Array.isArray(value))
    return { ok: false, message: "Body muss ein JSON-Objekt sein." };
  const row = value as Row;
  const extra = unknownKeys(row, [
    "hostname",
    "description",
    "mac",
    "mac_address",
    "dns_name",
  ]);
  if (extra.length)
    return { ok: false, message: `Unbekannte Felder: ${extra.join(", ")}` };
  const hostname = hostnameField(row.hostname ?? null, "hostname");
  const description = textField(row.description ?? null, "description", 1000);
  const mac = macField(row.mac ?? row.mac_address ?? null, "mac");
  const dns = hostnameField(row.dns_name ?? null, "dns_name");
  for (const result of [hostname, description, mac, dns]) {
    if (!result.ok)
      return { ok: false, message: `Ungültiges Feld: ${result.field}` };
  }
  return {
    ok: true,
    value: {
      hostname: (hostname as { value: string | null }).value,
      description: (description as { value: string | null }).value,
      mac: (mac as { value: string | null }).value,
      dnsName: (dns as { value: string | null }).value,
    },
  };
}

export type NextPrefixInput = {
  length: number;
  description: string | null;
  status: string;
};

export function parseNextPrefixBody(
  body: unknown,
): Validation<NextPrefixInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Body muss ein JSON-Objekt sein." };
  }
  const row = body as Row;
  const extra = unknownKeys(row, ["length", "description", "status"]);
  if (extra.length)
    return { ok: false, message: `Unbekannte Felder: ${extra.join(", ")}` };
  if (
    !Number.isInteger(row.length) ||
    (row.length as number) < 1 ||
    (row.length as number) > 128
  ) {
    return {
      ok: false,
      message: "length muss eine Präfixlänge zwischen 1 und 128 sein.",
    };
  }
  const description = textField(row.description ?? null, "description", 1000);
  if (!description.ok)
    return { ok: false, message: "Ungültiges Feld: description" };
  const status = row.status ?? "active";
  if (!isPrefixStatus(status))
    return { ok: false, message: "Ungültiges Feld: status" };
  return {
    ok: true,
    value: {
      length: row.length as number,
      description: description.value,
      status,
    },
  };
}

const PATCH_FIELDS = [
  "hostname",
  "dns_name",
  "description",
  "mac_address",
  "status",
  "device_type",
  "reserved_until",
] as const;

export function parseAddressPatch(body: unknown): Validation<Row> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Body muss ein JSON-Objekt sein." };
  }
  const row = body as Row;
  const extra = unknownKeys(row, PATCH_FIELDS);
  if (extra.length)
    return { ok: false, message: `Unbekannte Felder: ${extra.join(", ")}` };
  const updates: Row = {};
  for (const key of PATCH_FIELDS) {
    if (!(key in row)) continue;
    const value = row[key];
    let result: FieldResult<unknown>;
    switch (key) {
      case "hostname":
      case "dns_name":
        result = hostnameField(value, key);
        break;
      case "description":
        result = textField(value, key, 1000);
        break;
      case "mac_address":
        result = macField(value, key);
        break;
      case "status":
        result = isAddressStatus(value)
          ? { ok: true, value }
          : { ok: false, field: key };
        break;
      case "device_type":
        result =
          value === null || (DEVICE_TYPES as readonly unknown[]).includes(value)
            ? { ok: true, value }
            : { ok: false, field: key };
        break;
      case "reserved_until":
        result =
          value === null ||
          (typeof value === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(value) &&
            Number.isFinite(Date.parse(value)))
            ? { ok: true, value }
            : { ok: false, field: key };
        break;
    }
    if (!result.ok)
      return { ok: false, message: `Ungültiges Feld: ${result.field}` };
    updates[key] = result.value;
  }
  if (Object.keys(updates).length === 0)
    return { ok: false, message: "Keine Felder zum Ändern." };
  return { ok: true, value: updates };
}

/** inet/cidr aus PostgREST: Hostadressen ohne /32 bzw. /128. */
export function plainAddress(value: unknown): string {
  return String(value ?? "").replace(/\/(32|128)$/, "");
}

export function addressOut(row: Row): Row {
  return {
    id: row.id,
    address: plainAddress(row.address),
    vrf_id: row.vrf_id ?? null,
    prefix_id: row.prefix_id ?? null,
    status: row.status,
    hostname: row.hostname ?? null,
    dns_name: row.dns_name ?? null,
    mac_address: row.mac_address ?? null,
    vendor: row.vendor ?? null,
    device_type: row.device_type ?? null,
    description: row.description ?? null,
    switch_name: row.switch_name ?? null,
    switch_port: row.switch_port ?? null,
    asset_id: row.asset_id ?? null,
    reserved_until: row.reserved_until ?? null,
    last_seen_at: row.last_seen_at ?? null,
    last_seen_source: row.last_seen_source ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    custom_fields:
      typeof row.custom_fields === "object" && row.custom_fields !== null
        ? row.custom_fields
        : {},
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export function prefixOut(row: Row, usage: Row | undefined): Row {
  const capacity = Number(usage?.capacity ?? 0);
  const used = Number(usage?.used ?? 0) + Number(usage?.dhcp_size ?? 0);
  return {
    id: row.id,
    prefix: row.prefix,
    vrf_id: row.vrf_id ?? null,
    status: row.status,
    description: row.description ?? null,
    site_id: row.site_id ?? null,
    vlan_id: row.vlan_id ?? null,
    gateway: row.gateway ? plainAddress(row.gateway) : null,
    dhcp_start: row.dhcp_start ? plainAddress(row.dhcp_start) : null,
    dhcp_end: row.dhcp_end ? plainAddress(row.dhcp_end) : null,
    security_zone: row.security_zone ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    utilization: usage
      ? {
          used: Number(usage.used ?? 0),
          dhcp_size: Number(usage.dhcp_size ?? 0),
          capacity,
          percent:
            capacity > 0
              ? Math.min(100, Math.round((used / capacity) * 1000) / 10)
              : 0,
        }
      : null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export function vlanOut(row: Row): Row {
  return {
    id: row.id,
    vlan_number: row.vlan_number,
    name: row.name,
    description: row.description ?? null,
    site_id: row.site_id ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/** Postgres-Fehler der Reservierungsfunktionen → HTTP. */
export function reserveError(code: unknown): {
  status: number;
  code: string;
  message: string;
} {
  switch (code) {
    case "P0002":
      return {
        status: 404,
        code: "prefix_not_found",
        message: "Das Subnetz existiert nicht.",
      };
    case "53400":
      return {
        status: 409,
        code: "prefix_full",
        message: "Im Subnetz ist keine Adresse mehr frei.",
      };
    case "23505":
      return {
        status: 409,
        code: "address_taken",
        message: "Die Adresse ist bereits vergeben.",
      };
    case "22023":
    case "22P02":
      return {
        status: 422,
        code: "invalid_request",
        message: "Das Subnetz kann so nicht verwendet werden.",
      };
    default:
      return {
        status: 500,
        code: "database_error",
        message: "Die Daten konnten nicht verarbeitet werden.",
      };
  }
}
