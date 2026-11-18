/**
 * Table imports with column mapping: any CSV/XLSX, phpIPAM exports (subnets
 * and addresses) and NetBox CSV exports (prefixes, IP addresses, VLANs).
 * phpIPAM and NetBox are presets of the same engine: they only add header
 * aliases and value spellings.
 */

import { guessMapping, type ImportField, type Mapping } from "./csv-import";
import {
  BatchBuilder,
  type AddressStatus,
  type Cell,
  type DeviceType,
  DEVICE_TYPES,
  type ImportBatch,
  type ImportOrigin,
  type ImportSource,
  type PrefixStatus,
  finalizeBatch,
  formatCidr,
  formatIp,
  inferDeviceType,
  looksSecret,
  normalizeMac,
  oneLine,
  parseCidr,
  parseIp,
  parseLength,
  resolveRelativeIp,
  text,
} from "./ipam-import-model";

export type TableTarget = "addresses" | "prefixes" | "vlans";
export type TableFlavor = "generic" | "phpipam" | "netbox";
export type Table = { headers: string[]; rows: Cell[][] };

const ADDRESS_FIELDS: ImportField[] = [
  {
    key: "address",
    label: "IP-Adresse",
    required: true,
    aliases: [
      "ip",
      "ip address",
      "ip adresse",
      "ip_addr",
      "ipaddr",
      "address",
      "adresse",
    ],
  },
  {
    key: "hostname",
    label: "Hostname",
    aliases: ["host", "name", "hostname", "bezeichnung", "device", "gerät"],
  },
  {
    key: "dnsName",
    label: "DNS-Name",
    aliases: ["dns_name", "dns", "fqdn", "dns name"],
  },
  {
    key: "mac",
    label: "MAC-Adresse",
    aliases: ["mac", "mac address", "mac adresse", "mac_address"],
  },
  { key: "status", label: "Status", aliases: ["state", "status", "tag"] },
  {
    key: "description",
    label: "Beschreibung",
    aliases: [
      "description",
      "beschreibung",
      "funktion",
      "function",
      "note",
      "notiz",
      "bemerkung",
      "comments",
    ],
  },
  {
    key: "deviceType",
    label: "Gerätetyp",
    aliases: ["device type", "type", "typ", "role"],
  },
  { key: "switchName", label: "Switch", aliases: ["switch"] },
  {
    key: "switchPort",
    label: "Port",
    aliases: ["port", "switch port", "interface"],
  },
  { key: "vrf", label: "VRF", aliases: ["vrf", "vrf name"] },
  { key: "tags", label: "Tags", aliases: ["tags", "tag list"] },
];

const PREFIX_FIELDS: ImportField[] = [
  {
    key: "prefix",
    label: "Subnetz",
    required: true,
    aliases: ["prefix", "subnet", "network", "netz", "ip prefix", "cidr"],
  },
  {
    key: "length",
    label: "Präfixlänge / Maske",
    aliases: [
      "mask",
      "bitmask",
      "pl",
      "prefix length",
      "netmask",
      "subnet mask",
      "maske",
    ],
  },
  {
    key: "description",
    label: "Beschreibung",
    aliases: ["description", "beschreibung", "name", "comments"],
  },
  {
    key: "site",
    label: "Standort",
    aliases: ["site", "standort", "lokation", "location", "section"],
  },
  {
    key: "vlan",
    label: "VLAN",
    aliases: ["vlan", "vlan id", "vlanid", "vid", "vlan number"],
  },
  { key: "vlanName", label: "VLAN-Name", aliases: ["vlan name", "vlan_name"] },
  { key: "status", label: "Status", aliases: ["status", "state"] },
  {
    key: "gateway",
    label: "Gateway",
    aliases: ["gateway", "default gw", "gw"],
  },
  {
    key: "securityZone",
    label: "Sicherheitszone",
    aliases: ["security zone", "zone", "role"],
  },
  { key: "vrf", label: "VRF", aliases: ["vrf", "vrf name"] },
  { key: "tags", label: "Tags", aliases: ["tags"] },
];

const VLAN_FIELDS: ImportField[] = [
  {
    key: "number",
    label: "VLAN-Nummer",
    required: true,
    aliases: ["vid", "vlan", "vlan id", "number", "nummer", "vlanid"],
  },
  { key: "name", label: "Name", aliases: ["name", "vlan name", "bezeichnung"] },
  {
    key: "site",
    label: "Standort",
    aliases: ["site", "standort", "lokation", "location"],
  },
  {
    key: "description",
    label: "Beschreibung",
    aliases: ["description", "beschreibung", "comments"],
  },
];

export const TABLE_FIELDS: Record<TableTarget, ImportField[]> = {
  addresses: ADDRESS_FIELDS,
  prefixes: PREFIX_FIELDS,
  vlans: VLAN_FIELDS,
};

export const TARGET_LABELS: Record<TableTarget, string> = {
  addresses: "IP-Adressen",
  prefixes: "Subnetze",
  vlans: "VLANs",
};

const norm = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "");

/** Which kind of export a header row belongs to (best guess). */
export function detectTable(headers: string[]): {
  flavor: TableFlavor;
  target: TableTarget;
} {
  const set = new Set(headers.map(norm));
  const has = (...names: string[]) =>
    names.every((name) => set.has(norm(name)));
  if (has("vid", "name")) return { flavor: "netbox", target: "vlans" };
  if (has("address", "dns_name") || (has("address", "status") && has("vrf"))) {
    return { flavor: "netbox", target: "addresses" };
  }
  if (has("prefix", "status")) return { flavor: "netbox", target: "prefixes" };
  if (
    has("ip_addr") ||
    (has("ip address") && (set.has("state") || set.has("hostname")))
  ) {
    return { flavor: "phpipam", target: "addresses" };
  }
  if (has("subnet", "mask")) return { flavor: "phpipam", target: "prefixes" };
  const addressish = [
    "ip",
    "ipadresse",
    "ipaddress",
    "address",
    "adresse",
  ].some((name) => set.has(name));
  const prefixish = [
    "prefix",
    "subnet",
    "subnetz",
    "network",
    "netz",
    "cidr",
  ].some((name) => set.has(name));
  if (prefixish && !addressish)
    return { flavor: "generic", target: "prefixes" };
  if (
    !addressish &&
    (set.has("vlan") || set.has("vlanid")) &&
    set.has("name")
  ) {
    return { flavor: "generic", target: "vlans" };
  }
  return { flavor: "generic", target: "addresses" };
}

export function guessTableMapping(
  headers: string[],
  target: TableTarget,
): Mapping {
  return guessMapping(headers, TABLE_FIELDS[target]);
}

/** First non-empty row with at least two text cells counts as header. */
export function tableFromRows(rows: Cell[][]): Table | null {
  const index = rows.findIndex(
    (row) => row.filter((cell) => text(cell) !== null).length >= 2,
  );
  if (index < 0) return null;
  const headers = rows[index]!.map((cell) => oneLine(text(cell)) ?? "");
  const body = rows
    .slice(index + 1)
    .filter((row) => row.some((cell) => text(cell) !== null));
  return { headers, rows: body };
}

const ADDRESS_STATUS: Record<string, AddressStatus> = {
  active: "active",
  aktiv: "active",
  used: "active",
  belegt: "active",
  online: "active",
  "2": "active",
  reserved: "reserved",
  reserviert: "reserved",
  "3": "reserved",
  dhcp: "dhcp",
  slaac: "dhcp",
  "4": "dhcp",
  deprecated: "deprecated",
  offline: "deprecated",
  veraltet: "deprecated",
  alt: "deprecated",
  "1": "deprecated",
};

const PREFIX_STATUS: Record<string, PrefixStatus> = {
  active: "active",
  aktiv: "active",
  container: "container",
  reserved: "reserved",
  reserviert: "reserved",
  deprecated: "deprecated",
  veraltet: "deprecated",
};

const DEVICE_TYPE_ALIASES: Record<string, DeviceType> = {
  ap: "access_point",
  accesspoint: "access_point",
  drucker: "printer",
  kamera: "camera",
  telefon: "voip",
  virtualmachine: "vm",
  virtuellemaschine: "vm",
};

function cellAt(row: Cell[], mapping: Mapping, key: string): string | null {
  const column = mapping[key];
  if (column === null || column === undefined) return null;
  return text(row[column] ?? null);
}

/** phpIPAM stores IPv4 as decimal integer in raw exports. */
function addressFromCell(value: string | null): string | null {
  if (!value) return null;
  const withoutMask = value.split("/")[0]!.trim();
  if (/^\d{8,10}$/.test(withoutMask)) {
    const number = BigInt(withoutMask);
    if (number <= 0xffffffffn) return formatIp({ family: 4, value: number });
  }
  const ip = parseIp(withoutMask);
  return ip ? formatIp(ip) : null;
}

/** «Mgmt (64)», «64», «VLAN 64» → 64. */
function vlanFromCell(value: string | null): {
  number: number | null;
  name: string | null;
} {
  if (!value) return { number: null, name: null };
  const paren = /^(.*)\((\d{1,4})\)\s*$/.exec(value);
  if (paren)
    return { number: Number(paren[2]), name: paren[1]!.trim() || null };
  const plain = /^(?:vlan\s*)?(\d{1,4})$/i.exec(value.trim());
  if (plain) return { number: Number(plain[1]), name: null };
  const leading = /^(\d{1,4})\s*[-–:]\s*(.+)$/.exec(value.trim());
  if (leading) return { number: Number(leading[1]), name: leading[2]!.trim() };
  return { number: null, name: value };
}

function tagList(value: string | null): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(/[,;|]/)
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

export function parseTable(
  table: Table,
  target: TableTarget,
  mapping: Mapping,
  options: { flavor?: TableFlavor; sheet?: string } = {},
): ImportBatch {
  const flavor = options.flavor ?? "generic";
  const source: ImportSource = flavor === "generic" ? "generic" : flavor;
  const builder = new BatchBuilder(source);
  const sheet = options.sheet ?? "Tabelle";
  table.rows.forEach((row, index) => {
    const origin: ImportOrigin = { sheet, row: index + 2 };
    const get = (key: string) => {
      const value = cellAt(row, mapping, key);
      if (looksSecret(value)) {
        builder.issue(
          "warning",
          "row",
          origin,
          "Ein Feld sieht nach Zugangsdaten aus und wurde ausgelassen.",
        );
        return null;
      }
      return value;
    };
    const vrf = oneLine(get("vrf"));
    if (target === "addresses") {
      const raw = get("address");
      const address = addressFromCell(raw);
      if (!address) {
        builder.issue(
          "error",
          "address",
          origin,
          raw ? `«${raw}» ist keine IP-Adresse.` : "IP-Adresse fehlt.",
        );
        return;
      }
      const statusText = get("status");
      const status = statusText
        ? ADDRESS_STATUS[statusText.toLowerCase()]
        : "active";
      if (!status) {
        builder.issue(
          "warning",
          "address",
          origin,
          `Status «${statusText}» unbekannt – als aktiv übernommen.`,
        );
      }
      const macText = get("mac");
      const mac = normalizeMac(macText);
      if (macText && !mac)
        builder.issue(
          "warning",
          "address",
          origin,
          `«${macText}» ist keine MAC-Adresse.`,
        );
      const hostname = oneLine(get("hostname"));
      const description = get("description");
      const typeText = get("deviceType");
      const typeKey = typeText ? norm(typeText) : "";
      const deviceType = (DEVICE_TYPES as readonly string[]).includes(
        typeText?.toLowerCase() ?? "",
      )
        ? (typeText!.toLowerCase() as DeviceType)
        : (DEVICE_TYPE_ALIASES[typeKey] ??
          inferDeviceType(hostname, description, typeText));
      const dns = oneLine(get("dnsName"));
      builder.address({
        address,
        vrf,
        status: status ?? "active",
        hostname,
        dnsName: dns,
        macAddress: mac,
        deviceType,
        description,
        switchName: oneLine(get("switchName")),
        switchPort: oneLine(get("switchPort")),
        tags: tagList(get("tags")),
        customFields: {},
        origin,
      });
      return;
    }
    if (target === "prefixes") {
      const raw = get("prefix");
      const length = parseLength(get("length"));
      const cidr = parseCidr(raw, length);
      if (!cidr) {
        builder.issue(
          "error",
          "prefix",
          origin,
          raw
            ? `«${raw}${length !== null ? `/${length}` : ""}» ist kein gültiges Subnetz (Präfixlänge fehlt?).`
            : "Subnetz fehlt.",
        );
        return;
      }
      const prefix = formatCidr(cidr);
      if (cidr.hostBits)
        builder.issue(
          "warning",
          "prefix",
          origin,
          `${raw} ist keine Netzadresse – übernommen als ${prefix}.`,
        );
      const site = oneLine(get("site"));
      const vlan = vlanFromCell(get("vlan"));
      const vlanName = oneLine(get("vlanName")) ?? vlan.name;
      if (site) builder.site(site, origin);
      if (vlan.number !== null)
        builder.vlan(site, vlan.number, vlanName, origin);
      const statusText = get("status");
      const status = statusText
        ? PREFIX_STATUS[statusText.toLowerCase()]
        : "active";
      if (!status)
        builder.issue(
          "warning",
          "prefix",
          origin,
          `Status «${statusText}» unbekannt – als aktiv übernommen.`,
        );
      const gatewayText = get("gateway");
      const { created } = builder.prefix({
        prefix,
        vrf,
        site,
        vlanNumber: vlan.number,
        status: status ?? "active",
        securityZone: oneLine(get("securityZone")),
        gateway: gatewayText ? resolveRelativeIp(cidr, gatewayText) : null,
        gatewayDevice: null,
        dhcpHelper: null,
        dhcpStart: null,
        dhcpEnd: null,
        description: get("description"),
        tags: tagList(get("tags")),
        customFields: {},
        origin,
      });
      if (!created)
        builder.issue(
          "warning",
          "prefix",
          origin,
          `${prefix} ist doppelt – die erste Zeile gilt.`,
        );
      return;
    }
    const numberText = get("number");
    const vlan = vlanFromCell(numberText);
    if (vlan.number === null) {
      builder.issue(
        "error",
        "vlan",
        origin,
        numberText
          ? `«${numberText}» ist keine VLAN-Nummer.`
          : "VLAN-Nummer fehlt.",
      );
      return;
    }
    const site = oneLine(get("site"));
    if (site) builder.site(site, origin);
    builder.vlan(
      site,
      vlan.number,
      oneLine(get("name")) ?? vlan.name,
      origin,
      get("description"),
    );
  });
  if (table.rows.length === 0)
    builder.issue(
      "warning",
      "sheet",
      null,
      "Die Tabelle enthält keine Datenzeilen.",
    );
  return finalizeBatch(builder.batch);
}
