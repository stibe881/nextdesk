// Übersicht «IP-Adressen» der App (Funktion ipam, Aktionen overview, search
// und prefixDetail): reine Auswertung und Formatierung, ohne Netzwerkzugriff.

import { mobileAddressStatusLabel } from "./ipam-network-model";

type RecordValue = Record<string, unknown>;

export type IpamUsage = {
  used: number;
  /** Decimal string: IPv6 capacities exceed Number precision. */
  capacity: string;
  percent: number;
  dhcpSize: number;
};

export type IpamPrefixStatus =
  | "container"
  | "active"
  | "reserved"
  | "deprecated";

export type IpamPrefixRow = {
  id: string;
  prefix: string;
  description: string | null;
  status: IpamPrefixStatus;
  siteId: string | null;
  vlanId: string | null;
  vrfId: string | null;
  gateway: string | null;
  dhcpStart: string | null;
  dhcpEnd: string | null;
  securityZone: string | null;
  warningPercent: number;
  usage: IpamUsage | null;
  /** Only in the overview tree. */
  parentId: string | null;
  depth: number;
};

export type IpamSiteRow = { id: string; name: string; code: string | null };
export type IpamVlanRow = { id: string; number: number; name: string };
export type IpamVrfRow = { id: string; name: string };

export type IpamOverviewKpis = {
  prefixCount: number;
  addressCount: number;
  usedV4: number;
  capacityV4: string;
  overWarning: number;
  openFindings: number;
  conflicts: number;
};

export type IpamOverviewData = {
  prefixes: IpamPrefixRow[];
  sites: IpamSiteRow[];
  vlans: IpamVlanRow[];
  vrfs: IpamVrfRow[];
  kpis: IpamOverviewKpis;
};

export type IpamAddressRow = {
  id: string;
  address: string;
  status: string;
  hostname: string | null;
  dnsName: string | null;
  macAddress: string | null;
  description: string | null;
  prefixId: string | null;
  lastSeenAt: string | null;
};

export type IpamSearchResult = {
  addresses: IpamAddressRow[];
  prefixes: IpamPrefixRow[];
};

export type IpamPrefixDetailData = {
  prefix: IpamPrefixRow;
  vlan: IpamVlanRow | null;
  site: IpamSiteRow | null;
  vrf: IpamVrfRow | null;
  addresses: IpamAddressRow[];
  total: number;
  page: number;
  /** null: all addresses in one answer (grid prefixes). */
  pageSize: number | null;
  nextFree: string | null;
};

// ---------------------------------------------------------------------------
// Parsing (fail closed: null when the answer does not look as expected)

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function records(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function dataOf(response: unknown): RecordValue | null {
  return isRecord(response) && isRecord(response.data) ? response.data : null;
}

const PREFIX_STATUSES = new Set<string>([
  "container",
  "active",
  "reserved",
  "deprecated",
]);

function parseUsage(value: unknown): IpamUsage | null {
  if (!isRecord(value)) return null;
  const capacity =
    typeof value.capacity === "string" && /^\d+$/.test(value.capacity)
      ? value.capacity
      : typeof value.capacity === "number" &&
          Number.isInteger(value.capacity) &&
          value.capacity >= 0
        ? String(value.capacity)
        : "0";
  return {
    used: Math.floor(count(value.used)),
    capacity,
    percent: Math.min(100, count(value.percent)),
    dhcpSize: Math.floor(count(value.dhcpSize)),
  };
}

function parsePrefix(row: RecordValue): IpamPrefixRow | null {
  const id = text(row.id);
  const prefix = text(row.prefix);
  if (!id || !prefix) return null;
  const status = text(row.status) ?? "active";
  return {
    id,
    prefix,
    description: text(row.description),
    status: (PREFIX_STATUSES.has(status)
      ? status
      : "active") as IpamPrefixStatus,
    siteId: text(row.siteId),
    vlanId: text(row.vlanId),
    vrfId: text(row.vrfId),
    gateway: text(row.gateway),
    dhcpStart: text(row.dhcpStart),
    dhcpEnd: text(row.dhcpEnd),
    securityZone: text(row.securityZone),
    warningPercent: count(row.utilizationWarningPercent) || 85,
    usage: parseUsage(row.usage),
    parentId: text(row.parentId),
    depth: Math.floor(count(row.depth)),
  };
}

function parseSite(row: RecordValue): IpamSiteRow | null {
  const id = text(row.id);
  const name = text(row.name);
  return id && name ? { id, name, code: text(row.code) } : null;
}

function parseVlan(row: RecordValue): IpamVlanRow | null {
  const id = text(row.id);
  const number = Number(row.vlanNumber);
  if (!id || !Number.isInteger(number)) return null;
  return { id, number, name: text(row.name) ?? "" };
}

function parseVrf(row: RecordValue): IpamVrfRow | null {
  const id = text(row.id);
  const name = text(row.name);
  return id && name ? { id, name } : null;
}

function parseAddress(row: RecordValue): IpamAddressRow | null {
  const id = text(row.id);
  const address = text(row.address);
  if (!id || !address) return null;
  return {
    id,
    address,
    status: text(row.status) ?? "active",
    hostname: text(row.hostname),
    dnsName: text(row.dnsName),
    macAddress: text(row.macAddress),
    description: text(row.description),
    prefixId: text(row.prefixId),
    lastSeenAt: text(row.lastSeenAt),
  };
}

function list<T>(value: unknown, parse: (row: RecordValue) => T | null): T[] {
  return records(value).flatMap((row) => {
    const parsed = parse(row);
    return parsed ? [parsed] : [];
  });
}

/** Antwort der Aktion overview. */
export function parseIpamOverview(response: unknown): IpamOverviewData | null {
  const data = dataOf(response);
  if (!data || !Array.isArray(data.prefixes)) return null;
  const kpis = isRecord(data.kpis) ? data.kpis : {};
  const prefixes = list(data.prefixes, parsePrefix);
  return {
    prefixes,
    sites: list(data.sites, parseSite),
    vlans: list(data.vlans, parseVlan),
    vrfs: list(data.vrfs, parseVrf),
    kpis: {
      prefixCount: Math.floor(
        count(kpis.prefixCount) ||
          prefixes.filter((prefix) => prefix.status !== "deprecated").length,
      ),
      addressCount: Math.floor(count(kpis.addressCount)),
      usedV4: Math.floor(count(kpis.usedV4)),
      capacityV4:
        typeof kpis.capacityV4 === "string" && /^\d+$/.test(kpis.capacityV4)
          ? kpis.capacityV4
          : "0",
      overWarning: Math.floor(count(kpis.overWarning)),
      openFindings: Math.floor(count(kpis.openFindings)),
      conflicts: Math.floor(count(kpis.conflicts)),
    },
  };
}

/** Antwort der Aktion search. */
export function parseIpamSearch(response: unknown): IpamSearchResult | null {
  const data = dataOf(response);
  if (
    !data ||
    !Array.isArray(data.addresses) ||
    !Array.isArray(data.prefixes)
  ) {
    return null;
  }
  return {
    addresses: list(data.addresses, parseAddress),
    prefixes: list(data.prefixes, parsePrefix),
  };
}

/** Antwort der Aktion prefixDetail. */
export function parseIpamPrefixDetail(
  response: unknown,
): IpamPrefixDetailData | null {
  const data = dataOf(response);
  const prefix =
    data && isRecord(data.prefix) ? parsePrefix(data.prefix) : null;
  if (!data || !prefix || !Array.isArray(data.addresses)) return null;
  const addresses = list(data.addresses, parseAddress);
  const pageSize = count(data.pageSize);
  return {
    prefix,
    vlan: isRecord(data.vlan) ? parseVlan(data.vlan) : null,
    site: isRecord(data.site) ? parseSite(data.site) : null,
    vrf: isRecord(data.vrf) ? parseVrf(data.vrf) : null,
    addresses,
    total: Math.max(Math.floor(count(data.total)), addresses.length),
    page: Math.floor(count(data.page)),
    pageSize: pageSize ? Math.floor(pageSize) : null,
    nextFree: text(data.nextFree),
  };
}

/** True when there are more addresses than the pages loaded so far. */
export function ipamHasMoreAddresses(
  detail: Pick<IpamPrefixDetailData, "pageSize" | "total">,
  loaded: number,
): boolean {
  return detail.pageSize !== null && loaded < detail.total;
}

// ---------------------------------------------------------------------------
// Access

/**
 * Server refusals that mean «no access» rather than an error: module off for
 * the person (feature_disabled) or missing ipam.read (access_denied).
 */
export function isIpamAccessDenied(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const record = error;
  const code = typeof record.code === "string" ? record.code : null;
  if (code === "feature_disabled" || code === "access_denied") return true;
  return record.status === 403 && code === null;
}

// ---------------------------------------------------------------------------
// Addresses, CIDR and routes

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4Value(value: string): number | null {
  const match = IPV4.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return null;
  return parts.reduce((sum, part) => sum * 256 + part, 0);
}

function ipv6Value(value: string): bigint | null {
  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part ? part.split(":") : []);
  let head = groups(halves[0] ?? "");
  let tail = halves.length === 2 ? groups(halves[1] ?? "") : [];
  // Embedded IPv4 at the end (::ffff:10.0.0.1).
  const last = (halves.length === 2 ? tail : head).at(-1);
  if (last && last.includes(".")) {
    const v4 = ipv4Value(last);
    if (v4 === null) return null;
    const words = [
      Math.floor(v4 / 65536).toString(16),
      (v4 % 65536).toString(16),
    ];
    if (halves.length === 2) tail = [...tail.slice(0, -1), ...words];
    else head = [...head.slice(0, -1), ...words];
  }
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [
    ...head,
    ...Array<string>(Math.max(0, missing)).fill("0"),
    ...tail,
  ];
  if (all.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  return all.reduce((sum, group) => sum * 65536n + BigInt(`0x${group}`), 0n);
}

/** Full IPv4 or IPv6 address (no prefix length), else null. */
export function ipamExactAddress(query: string): string | null {
  const value = query.trim();
  if (!value || value.length > 45) return null;
  if (ipv4Value(value) !== null) return value;
  return ipv6Value(value) !== null ? value.toLowerCase() : null;
}

/** Sort key of a CIDR or address text: IPv4 before IPv6, then numeric. */
function sortKey(value: string): [number, bigint, number] {
  const [address = "", length = ""] = value.split("/");
  const bits = Number(length);
  const v4 = ipv4Value(address);
  if (v4 !== null) return [4, BigInt(v4), Number.isFinite(bits) ? bits : 32];
  const v6 = ipv6Value(address);
  if (v6 !== null) return [6, v6, Number.isFinite(bits) ? bits : 128];
  return [9, 0n, 0];
}

export function compareIpamText(a: string, b: string): number {
  const [va, na, la] = sortKey(a);
  const [vb, nb, lb] = sortKey(b);
  if (va !== vb) return va - vb;
  if (va === 9) return a.localeCompare(b, "de-CH");
  if (na !== nb) return na < nb ? -1 : 1;
  return la - lb;
}

/**
 * Route of the address detail page (mobile/app/ipam/[address].tsx); only for
 * a real IPv4/IPv6 address, a host length («/32») is dropped.
 */
export function ipamAddressHref(address: string): string | null {
  const value = ipamExactAddress(address.trim().replace(/\/(32|128)$/, ""));
  return value ? `/ipam/${encodeURIComponent(value)}` : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isIpamId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Route of the subnet screen (mobile/app/ipam/prefix/[id].tsx). */
export function ipamPrefixHref(prefixId: string): string | null {
  return isIpamId(prefixId) ? `/ipam/prefix/${prefixId.toLowerCase()}` : null;
}

/** The search action needs at least two characters. */
export function ipamSearchReady(query: string): boolean {
  return query.trim().length >= 2;
}

// ---------------------------------------------------------------------------
// Grouping

export type IpamPrefixGroup = {
  key: string;
  label: string;
  prefixes: IpamPrefixRow[];
};

/**
 * Groups like the web view «Netze» by site: per site the leaf subnets (a
 * prefix with a visible child is left out, the child shows its addresses),
 * without deprecated ones, sorted by CIDR; «Ohne Standort» last.
 */
export function groupIpamPrefixes(
  overview: Pick<IpamOverviewData, "prefixes" | "sites">,
): IpamPrefixGroup[] {
  const shown = overview.prefixes.filter(
    (prefix) => prefix.status !== "deprecated",
  );
  const hasChild = new Set(
    shown.map((prefix) => prefix.parentId).filter((id): id is string => !!id),
  );
  const leaves = shown.filter((prefix) => !hasChild.has(prefix.id));
  const siteIds = new Set(overview.sites.map((site) => site.id));
  const sites = [...overview.sites].sort((a, b) =>
    a.name.localeCompare(b.name, "de-CH"),
  );
  const groups: IpamPrefixGroup[] = [];
  const sorted = (rows: IpamPrefixRow[]) =>
    rows.slice().sort((a, b) => compareIpamText(a.prefix, b.prefix));
  for (const site of sites) {
    const own = leaves.filter((prefix) => prefix.siteId === site.id);
    if (own.length) {
      groups.push({
        key: `site-${site.id}`,
        label: site.name,
        prefixes: sorted(own),
      });
    }
  }
  const rest = leaves.filter(
    (prefix) => !prefix.siteId || !siteIds.has(prefix.siteId),
  );
  if (rest.length) {
    groups.push({
      key: "site-none",
      label: groups.length ? "Ohne Standort" : "Subnetze",
      prefixes: sorted(rest),
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Formatting

/** 12’345 (Swiss thousands separator), works for IPv6 sized numbers. */
export function formatIpamCount(value: number | bigint | string): string {
  let digits: string;
  if (typeof value === "string") digits = /^\d+$/.test(value) ? value : "0";
  else if (typeof value === "bigint")
    digits = value < 0n ? "0" : value.toString();
  else
    digits =
      Number.isFinite(value) && value > 0 ? String(Math.floor(value)) : "0";
  digits = digits.replace(/^0+(?=\d)/, "");
  if (digits.length > 15) {
    // 2^64 and similar: an exponent reads better than 20 digit groups.
    return `2^${Math.round(Math.log2(Number(digits)))}`;
  }
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, "’");
}

/** «4.5 %» below 10, else whole percent. */
export function formatIpamPercent(percent: number): string {
  const value = Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent))
    : 0;
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} %`;
}

export function ipamUsageLabel(usage: IpamUsage | null): string {
  if (!usage) return "Keine Auslastung";
  return `${formatIpamCount(usage.used)} von ${formatIpamCount(usage.capacity)} belegt · ${formatIpamPercent(usage.percent)}`;
}

/** Share of all IPv4 leaf capacity in use (overview KPI), null without capacity. */
export function ipamV4Percent(
  kpis: Pick<IpamOverviewKpis, "usedV4" | "capacityV4">,
): number | null {
  const capacity = Number(kpis.capacityV4);
  if (!Number.isFinite(capacity) || capacity <= 0) return null;
  return Math.min(100, (kpis.usedV4 / capacity) * 100);
}

export type IpamUsageTone = "ok" | "warning" | "danger" | "none";

/** From the warning threshold yellow, from 95 % (or the threshold) red. */
export function ipamUsageTone(
  percent: number | null | undefined,
  warningPercent: number,
): IpamUsageTone {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) {
    return "none";
  }
  if (percent >= Math.max(95, warningPercent)) return "danger";
  if (percent >= warningPercent) return "warning";
  return "ok";
}

export function ipamVlanLabel(
  vlan: IpamVlanRow | null | undefined,
): string | null {
  if (!vlan) return null;
  return `VLAN ${vlan.number}${vlan.name ? ` · ${vlan.name}` : ""}`;
}

const PREFIX_STATUS: Record<IpamPrefixStatus, string> = {
  container: "Supernetz",
  active: "Aktiv",
  reserved: "Reserviert",
  deprecated: "Veraltet",
};

export function ipamPrefixStatusLabel(status: IpamPrefixStatus): string {
  return PREFIX_STATUS[status];
}

export function ipamAddressStatusLabel(status: string): string {
  return mobileAddressStatusLabel(status);
}

/** Second line of a subnet card: CIDR (when a name is the title), VLAN, VRF. */
export function ipamPrefixMeta(
  prefix: IpamPrefixRow,
  vlan: IpamVlanRow | null,
  vrf: IpamVrfRow | null,
): string {
  return [
    prefix.description ? prefix.prefix : null,
    ipamVlanLabel(vlan),
    vrf ? `VRF ${vrf.name}` : null,
    prefix.securityZone,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Second line of an address row: hostname or DNS name, MAC, description. */
export function ipamAddressMeta(address: IpamAddressRow): string {
  return (
    [
      address.hostname ?? address.dnsName,
      address.macAddress,
      address.description,
    ]
      .filter(Boolean)
      .join(" · ") || "Ohne Hostname"
  );
}

/** Local filter of the loaded addresses of a subnet. */
export function matchesIpamAddress(
  address: IpamAddressRow,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const macNeedle = needle.replace(/[^0-9a-f]/g, "");
  return (
    [
      address.address,
      address.hostname,
      address.dnsName,
      address.description,
      address.macAddress,
    ].some((value) => value?.toLowerCase().includes(needle)) ||
    (macNeedle.length >= 4 &&
      (address.macAddress ?? "")
        .toLowerCase()
        .replace(/[^0-9a-f]/g, "")
        .includes(macNeedle))
  );
}
