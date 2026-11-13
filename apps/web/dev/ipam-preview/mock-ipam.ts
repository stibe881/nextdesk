// In-memory stand-in for the Edge Function `ipam` (dev preview only).
// Invented demo data: four sites, nested IPv4 supernets, /24–/22 subnets
// with many addresses, a guest VRF, an IPv6 block, findings and a change log.
// Implements the read actions of the contract and the most common writes.

import { tn } from "../../src/lib/formality";
import {
  cidrContainsAddress,
  cidrLast,
  cidrSize,
  compareAddressText,
  compareCidrText,
  formatAddress,
  formatCidr,
  isGridPrefix,
  parseAddress,
  parseCidrInput,
  type Cidr,
} from "../../src/lib/ipam-cidr";
import type {
  AddressStatus,
  IpamAddress,
  IpamFinding,
  IpamPrefix,
  IpamSite,
  IpamVlan,
  IpamVrf,
  PrefixStatus,
} from "../../src/lib/ipam-model";
import type {
  AddressSegment,
  ChangeLogEntry,
  Forecast,
  MatrixCell,
  SiteTemplate,
} from "../../src/lib/ipam-redesign-types";

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const day = (offset: number) =>
  new Date(NOW + offset * 86_400_000).toISOString().slice(0, 10);

let seed = 7;
function rnd(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

const vrfs: IpamVrf[] = [
  {
    id: "vrf-gast",
    name: "Gast",
    routeDistinguisher: "65000:900",
    description: "Getrenntes Gästenetz",
  },
];

const sites: IpamSite[] = [
  site("s-baar", "Baar", "BAAR", "Neuhofstrasse 4, 6340 Baar", 100),
  site("s-zug", "Zug", "ZUG", "Baarerstrasse 21, 6300 Zug", 200),
  site("s-cham", "Cham", "CHAM", "Zugerstrasse 9, 6330 Cham", 300),
  site("s-rz", "Rechenzentrum Steinhausen", "RZ", "Sennweidstrasse 1", null),
  site("s-vpn", "VPN", "VPN", null, null),
];

function site(
  id: string,
  name: string,
  code: string,
  address: string | null,
  vlanBase: number | null,
): IpamSite {
  return {
    id,
    name,
    code,
    address,
    description: null,
    departmentId: null,
    assetLocationId: null,
    vlanBase,
    supernetPrefixId: null,
    templateId: vlanBase ? "tpl-std" : null,
  };
}

const vlans: IpamVlan[] = [];
function vlan(siteId: string, number: number, name: string, zone: string) {
  const entry: IpamVlan = {
    id: `v-${siteId}-${number}`,
    vlanNumber: number,
    name,
    siteId,
    departmentId: null,
    description: null,
    zone,
    notes: null,
    status: "active",
  };
  vlans.push(entry);
  return entry.id;
}

type PrefixSeed = {
  id: string;
  prefix: string;
  status?: PrefixStatus;
  siteId?: string | null;
  vlanId?: string | null;
  vrfId?: string | null;
  description?: string | null;
  zone?: string | null;
  dhcp?: [string, string] | null;
  gateway?: boolean;
  notes?: string | null;
};

const prefixes: IpamPrefix[] = [];
function addPrefix(seedEntry: PrefixSeed) {
  const cidr = parseCidrInput(seedEntry.prefix)!.cidr;
  const status = seedEntry.status ?? "active";
  prefixes.push({
    id: seedEntry.id,
    prefix: seedEntry.prefix,
    vrfId: seedEntry.vrfId ?? null,
    siteId: seedEntry.siteId ?? null,
    vlanId: seedEntry.vlanId ?? null,
    status,
    securityZone: seedEntry.zone ?? null,
    gateway:
      status === "active" && seedEntry.gateway !== false
        ? formatAddress({ version: cidr.version, value: cidr.network + 1n })
        : null,
    gatewayDevice: status === "active" ? "fw-core-01" : null,
    dhcpHelper: seedEntry.dhcp ? "10.100.20.10" : null,
    dhcpStart: seedEntry.dhcp?.[0] ?? null,
    dhcpEnd: seedEntry.dhcp?.[1] ?? null,
    description: seedEntry.description ?? null,
    notes: seedEntry.notes ?? null,
    utilizationWarningPercent: 85,
    tags: [],
    customFields: {},
    departmentId: null,
    updatedAt: ago(60 * 24 * 3),
    usage: null,
  });
}

// --- Sites, VLANs, prefixes --------------------------------------------------

addPrefix({
  id: "p-10",
  prefix: "10.0.0.0/8",
  status: "container",
  description: "Interne Netze",
});

const baar = {
  mgmt: vlan("s-baar", 100, "MGMT", "MGMT"),
  server: vlan("s-baar", 110, "SERVER", "LAN"),
  clients: vlan("s-baar", 120, "CLIENTS", "LAN"),
  printer: vlan("s-baar", 130, "PRINTER", "LAN"),
  voip: vlan("s-baar", 140, "VOIP", "VOICE"),
  wlan: vlan("s-baar", 150, "WLAN", "WLAN"),
  cam: vlan("s-baar", 160, "KAMERA", "IOT"),
};
addPrefix({
  id: "p-baar",
  prefix: "10.10.0.0/16",
  status: "container",
  siteId: "s-baar",
  description: "Standort Baar",
});
addPrefix({
  id: "p-baar-mgmt",
  prefix: "10.10.0.0/24",
  siteId: "s-baar",
  vlanId: baar.mgmt,
  description: "Management Switches und APs",
  zone: "MGMT",
});
addPrefix({
  id: "p-baar-server",
  prefix: "10.10.1.0/24",
  siteId: "s-baar",
  vlanId: baar.server,
  description: "Server Baar",
  zone: "LAN",
});
addPrefix({
  id: "p-baar-clients",
  prefix: "10.10.4.0/22",
  siteId: "s-baar",
  vlanId: baar.clients,
  description: "Arbeitsplätze Baar",
  zone: "LAN",
  dhcp: ["10.10.4.50", "10.10.7.200"],
});
addPrefix({
  id: "p-baar-printer",
  prefix: "10.10.8.0/24",
  siteId: "s-baar",
  vlanId: baar.printer,
  description: "Drucker und Multifunktionsgeräte",
  zone: "LAN",
});
addPrefix({
  id: "p-baar-voip",
  prefix: "10.10.9.0/24",
  siteId: "s-baar",
  vlanId: baar.voip,
  description: "VoIP-Telefone",
  zone: "VOICE",
  dhcp: ["10.10.9.20", "10.10.9.240"],
});
addPrefix({
  id: "p-baar-wlan",
  prefix: "10.10.10.0/23",
  siteId: "s-baar",
  vlanId: baar.wlan,
  description: "WLAN Mitarbeitende",
  zone: "WLAN",
  dhcp: ["10.10.10.20", "10.10.11.240"],
});
addPrefix({
  id: "p-baar-cam",
  prefix: "10.10.20.0/24",
  siteId: "s-baar",
  vlanId: baar.cam,
  description: "Kameras",
  zone: "IOT",
});
addPrefix({
  id: "p-baar-old",
  prefix: "10.10.99.0/24",
  status: "deprecated",
  siteId: "s-baar",
  description: "OLD_GAST",
});

const zug = {
  mgmt: vlan("s-zug", 200, "MGMT", "MGMT"),
  clients: vlan("s-zug", 220, "CLIENTS", "LAN"),
  printer: vlan("s-zug", 230, "DRUCKER", "LAN"),
  voip: vlan("s-zug", 240, "VOIP", "VOICE"),
  wlan: vlan("s-zug", 250, "WLAN", "WLAN"),
};
addPrefix({
  id: "p-zug",
  prefix: "10.20.0.0/16",
  status: "container",
  siteId: "s-zug",
  description: "Standort Zug",
});
addPrefix({
  id: "p-zug-mgmt",
  prefix: "10.20.0.0/24",
  siteId: "s-zug",
  vlanId: zug.mgmt,
  description: "Management Zug",
  zone: "MGMT",
});
addPrefix({
  id: "p-zug-clients",
  prefix: "10.20.4.0/22",
  siteId: "s-zug",
  vlanId: zug.clients,
  description: "Arbeitsplätze Zug",
  zone: "LAN",
  dhcp: ["10.20.4.100", "10.20.6.250"],
});
addPrefix({
  id: "p-zug-printer",
  prefix: "10.20.8.0/23",
  siteId: "s-zug",
  vlanId: zug.printer,
  description: "Drucker Zug",
  zone: "LAN",
});
addPrefix({
  id: "p-zug-voip",
  prefix: "10.20.10.0/24",
  siteId: "s-zug",
  vlanId: zug.voip,
  description: "VoIP Zug",
  zone: "VOICE",
  dhcp: ["10.20.10.20", "10.20.10.200"],
});
addPrefix({
  id: "p-zug-wlan",
  prefix: "10.20.12.0/23",
  siteId: "s-zug",
  vlanId: zug.wlan,
  description: "WLAN Zug",
  zone: "WLAN",
  dhcp: ["10.20.12.20", "10.20.13.240"],
});

const cham = {
  mgmt: vlan("s-cham", 300, "MGMT", "MGMT"),
  clients: vlan("s-cham", 320, "CLIENTS", "LAN"),
  wlan: vlan("s-cham", 350, "WLAN", "WLAN"),
};
addPrefix({
  id: "p-cham",
  prefix: "10.30.0.0/16",
  status: "container",
  siteId: "s-cham",
  description: "Standort Cham",
});
addPrefix({
  id: "p-cham-mgmt",
  prefix: "10.30.0.0/24",
  siteId: "s-cham",
  vlanId: cham.mgmt,
  description: "Management Cham",
  zone: "MGMT",
});
addPrefix({
  id: "p-cham-clients",
  prefix: "10.30.4.0/24",
  siteId: "s-cham",
  vlanId: cham.clients,
  description: "Arbeitsplätze Cham",
  zone: "LAN",
  dhcp: ["10.30.4.50", "10.30.4.230"],
});
addPrefix({
  id: "p-cham-wlan",
  prefix: "10.30.10.0/24",
  siteId: "s-cham",
  vlanId: cham.wlan,
  description: "WLAN Cham",
  zone: "WLAN",
  dhcp: ["10.30.10.20", "10.30.10.240"],
});

const rz = {
  dmz: vlan("s-rz", 10, "DMZ", "DMZ"),
  server: vlan("s-rz", 20, "SERVER", "LAN"),
  storage: vlan("s-rz", 30, "STORAGE", "STORAGE"),
  backup: vlan("s-rz", 40, "BACKUP", "STORAGE"),
};
addPrefix({
  id: "p-rz",
  prefix: "10.100.0.0/16",
  status: "container",
  siteId: "s-rz",
  description: "Rechenzentrum",
});
addPrefix({
  id: "p-rz-dmz",
  prefix: "10.100.10.0/24",
  siteId: "s-rz",
  vlanId: rz.dmz,
  description: "DMZ",
  zone: "DMZ",
});
addPrefix({
  id: "p-rz-server",
  prefix: "10.100.20.0/24",
  siteId: "s-rz",
  vlanId: rz.server,
  description: "Server RZ",
  zone: "LAN",
  notes: "Erweiterung auf /23 mit Netzwerkteam abgesprochen (Q1).",
});
addPrefix({
  id: "p-rz-storage",
  prefix: "10.100.30.0/25",
  siteId: "s-rz",
  vlanId: rz.storage,
  description: "iSCSI",
  zone: "STORAGE",
  gateway: false,
});
addPrefix({
  id: "p-rz-backup",
  prefix: "10.100.40.0/24",
  siteId: "s-rz",
  vlanId: rz.backup,
  description: "Backup",
  zone: "STORAGE",
});
addPrefix({
  id: "p-vpn",
  prefix: "10.200.0.0/21",
  siteId: "s-vpn",
  description: "VPN-Clients",
  zone: "VPN",
  dhcp: ["10.200.0.10", "10.200.7.250"],
});
addPrefix({
  id: "p-old",
  prefix: "10.99.0.0/16",
  status: "deprecated",
  description: "ALT Filiale Hünenberg",
});
addPrefix({
  id: "p-gast",
  prefix: "192.168.100.0/22",
  vrfId: "vrf-gast",
  siteId: "s-baar",
  description: "Gäste-WLAN",
  zone: "GUEST",
  dhcp: ["192.168.100.10", "192.168.103.250"],
});
addPrefix({
  id: "p-v6",
  prefix: "2001:db8:10::/48",
  status: "container",
  siteId: "s-baar",
  description: "IPv6 Baar",
});
addPrefix({
  id: "p-v6-clients",
  prefix: "2001:db8:10:120::/64",
  siteId: "s-baar",
  vlanId: baar.clients,
  description: "Clients IPv6",
  zone: "LAN",
});

// --- Addresses -----------------------------------------------------------------

const addresses: IpamAddress[] = [];
const VENDORS = [
  ["Cisco", "00:1b:54"],
  ["HP", "3c:d9:2b"],
  ["Dell", "f8:bc:12"],
  ["Lenovo", "54:ee:75"],
  ["Ubiquiti", "74:83:c2"],
  ["Yealink", "80:5e:c0"],
  ["Axis", "ac:cc:8e"],
  ["Ricoh", "00:26:73"],
] as const;

function mac(prefix: string): string {
  const part = () =>
    Math.floor(rnd() * 256)
      .toString(16)
      .padStart(2, "0");
  return `${prefix}:${part()}:${part()}:${part()}`;
}

function addAddress(
  ip: string,
  hostname: string | null,
  extra: Partial<IpamAddress> = {},
) {
  const vendor = VENDORS[Math.floor(rnd() * VENDORS.length)]!;
  addresses.push({
    id: `a-${ip}`,
    address: ip,
    vrfId: null,
    prefixId: null,
    status: "active",
    hostname,
    dnsName: hostname ? `${hostname.toLowerCase()}.corp.example.ch` : null,
    macAddress: mac(vendor[1]),
    vendor: vendor[0],
    deviceType: null,
    description: null,
    switchName: `SW-${Math.floor(rnd() * 12 + 1)
      .toString()
      .padStart(3, "0")}`,
    switchPort: `Gi1/0/${Math.floor(rnd() * 48 + 1)}`,
    ownerUserId: null,
    ownerName: null,
    teamId: null,
    teamName: null,
    assetId: null,
    serviceId: null,
    intuneDeviceId: null,
    prtgDeviceId: null,
    reservedUntil: null,
    lastSeenAt: ago(Math.floor(rnd() * 600)),
    lastSeenSource: rnd() > 0.5 ? "Agent" : "PRTG",
    tags: [],
    customFields: {},
    createdAt: ago(60 * 24 * 200),
    updatedAt: ago(60 * 24 * 10),
    ...extra,
  });
}

function range(
  base: string,
  from: number,
  to: number,
  fn: (ip: string, n: number) => void,
) {
  const parsed = parseAddress(base)!;
  for (let n = from; n <= to; n++) {
    fn(formatAddress({ version: 4, value: parsed.value + BigInt(n) }), n);
  }
}

// Baar MGMT: switches, APs, UPS
range("10.10.0.0", 10, 21, (ip, n) =>
  addAddress(ip, `SW-BAAR-${String(n - 9).padStart(2, "0")}`, {
    deviceType: "switch",
    vendor: "Cisco",
  }),
);
range("10.10.0.0", 50, 77, (ip, n) =>
  addAddress(ip, `AP-BAAR-${String(n - 49).padStart(2, "0")}`, {
    deviceType: "access_point",
    vendor: "Ubiquiti",
  }),
);
addAddress("10.10.0.200", "USV-BAAR-01", { deviceType: "other" });
addAddress("10.10.0.201", null, {
  status: "reserved",
  description: "Zweite USV (bestellt)",
  reservedUntil: day(20),
  lastSeenAt: null,
});

// Baar SERVER
range("10.10.1.0", 10, 70, (ip, n) =>
  addAddress(ip, `SRV-BAAR-${String(n).padStart(3, "0")}`, {
    deviceType: n % 3 === 0 ? "server" : "vm",
    ownerName: n % 4 === 0 ? "Martina Keller" : null,
    teamName: "Infrastruktur",
  }),
);
range("10.10.1.0", 80, 86, (ip, n) =>
  addAddress(ip, n === 80 ? "SRV-BAAR-NEU" : null, {
    status: "reserved",
    description: "Reserve für Migration Fileserver",
    reservedUntil: day(n === 81 ? 12 : 60),
    lastSeenAt: null,
  }),
);
range("10.10.1.0", 90, 94, (ip) =>
  addAddress(ip, "SRV-ALT", {
    status: "deprecated",
    lastSeenAt: ago(60 * 24 * 120),
  }),
);
range("10.10.1.0", 100, 140, (ip, n) =>
  addAddress(ip, `VM-APP-${String(n - 99).padStart(2, "0")}`, {
    deviceType: "vm",
  }),
);

// Baar CLIENTS /22: statics, some DHCP leases documented
range("10.10.4.0", 10, 40, (ip, n) =>
  addAddress(ip, `PC-BAAR-${String(n).padStart(3, "0")}`, {
    deviceType: "client",
  }),
);
range("10.10.4.0", 41, 45, (ip) =>
  addAddress(ip, null, {
    status: "reserved",
    description: "Schulungsraum",
    lastSeenAt: null,
  }),
);
for (let n = 0; n < 820; n++) {
  // Leases spread through the pool
  const offset = 50 + Math.floor(n * 1.15);
  if (offset > 3 * 256 + 200) break;
  const parsed = parseAddress("10.10.4.0")!;
  const ip = formatAddress({
    version: 4,
    value: parsed.value + BigInt(offset),
  });
  if (addresses.some((entry) => entry.address === ip)) continue;
  if (rnd() < 0.75)
    addAddress(ip, `NB-${String(1000 + n)}`, {
      status: "dhcp",
      deviceType: "client",
    });
}
range("10.10.7.0", 210, 230, (ip, n) =>
  addAddress(ip, `THIN-${n}`, { deviceType: "client" }),
);

// Baar PRINTER
range("10.10.8.0", 10, 38, (ip, n) =>
  addAddress(ip, `DRU-BAAR-${String(n - 9).padStart(2, "0")}`, {
    deviceType: "printer",
    vendor: "Ricoh",
  }),
);

// Baar VOIP: statics around the pool, pool almost full
range("10.10.9.0", 2, 19, (ip, n) =>
  addAddress(ip, `VOIP-GW-${n}`, { deviceType: "voip", vendor: "Yealink" }),
);
range("10.10.9.0", 241, 252, (ip, n) =>
  addAddress(ip, `VOIP-KONF-${n}`, { deviceType: "voip", vendor: "Yealink" }),
);

// Baar WLAN: a few infrastructure statics
range("10.10.10.0", 2, 12, (ip, n) =>
  addAddress(ip, `WLC-${n}`, { deviceType: "access_point" }),
);

// Baar cameras
range("10.10.20.0", 10, 33, (ip, n) =>
  addAddress(ip, `CAM-BAAR-${String(n - 9).padStart(2, "0")}`, {
    deviceType: "camera",
    vendor: "Axis",
  }),
);

// Zug
range("10.20.0.0", 10, 18, (ip, n) =>
  addAddress(ip, `SW-ZUG-${String(n - 9).padStart(2, "0")}`, {
    deviceType: "switch",
  }),
);
range("10.20.4.0", 10, 60, (ip, n) =>
  addAddress(ip, `PC-ZUG-${String(n).padStart(3, "0")}`, {
    deviceType: "client",
  }),
);
range("10.20.8.0", 10, 30, (ip, n) =>
  addAddress(ip, `DRU-ZUG-${String(n - 9).padStart(2, "0")}`, {
    deviceType: "printer",
  }),
);
range("10.20.10.0", 2, 12, (ip, n) =>
  addAddress(ip, `VOIP-ZUG-${n}`, { deviceType: "voip" }),
);

// Cham
range("10.30.0.0", 10, 14, (ip, n) =>
  addAddress(ip, `SW-CHAM-${String(n - 9).padStart(2, "0")}`, {
    deviceType: "switch",
  }),
);
range("10.30.4.0", 10, 30, (ip, n) =>
  addAddress(ip, `PC-CHAM-${String(n).padStart(3, "0")}`, {
    deviceType: "client",
  }),
);

// RZ
range("10.100.10.0", 10, 24, (ip, n) =>
  addAddress(ip, `DMZ-WEB-${String(n - 9).padStart(2, "0")}`, {
    deviceType: "server",
  }),
);
range("10.100.20.0", 2, 236, (ip, n) => {
  if (n % 37 === 0) return;
  addAddress(ip, `SRV-RZ-${String(n).padStart(3, "0")}`, {
    deviceType: n % 5 === 0 ? "server" : "vm",
    teamName: "Infrastruktur",
  });
});
range("10.100.30.0", 1, 20, (ip, n) =>
  addAddress(ip, `SAN-${String(n).padStart(2, "0")}`, {
    deviceType: "storage",
  }),
);
range("10.100.40.0", 10, 40, (ip, n) =>
  addAddress(ip, `BKP-${String(n).padStart(2, "0")}`, {
    deviceType: "storage",
  }),
);

// VPN: a few fixed addresses for admins
range("10.200.0.0", 2, 9, (ip, n) =>
  addAddress(ip, `VPN-ADMIN-${n}`, { deviceType: "client" }),
);
addAddress("2001:db8:10:120::10", "SRV-BAAR-010", { deviceType: "server" });
addAddress("2001:db8:10:120::11", "SRV-BAAR-011", { deviceType: "server" });
range("192.168.100.0", 2, 6, (ip, n) =>
  addAddress(ip, `GAST-AP-${n}`, {
    vrfId: "vrf-gast",
    deviceType: "access_point",
  }),
);

// Prefix assignment (most specific)
function cidrOf(prefix: IpamPrefix): Cidr {
  return parseCidrInput(prefix.prefix)!.cidr;
}
function owningPrefix(ip: string, vrfId: string | null): IpamPrefix | null {
  const parsed = parseAddress(ip);
  if (!parsed) return null;
  let best: IpamPrefix | null = null;
  for (const prefix of prefixes) {
    if (prefix.vrfId !== vrfId) continue;
    const cidr = cidrOf(prefix);
    if (!cidrContainsAddress(cidr, parsed)) continue;
    if (!best || cidr.length > cidrOf(best).length) best = prefix;
  }
  return best;
}
for (const address of addresses) {
  address.prefixId = owningPrefix(address.address, address.vrfId)?.id ?? null;
}

// --- Findings ---------------------------------------------------------------------

const findings: IpamFinding[] = [];
function finding(
  address: string,
  kind: IpamFinding["kind"],
  severity: IpamFinding["severity"],
  details: Record<string, unknown>,
  daysAgo: number,
) {
  const prefix = owningPrefix(address, null);
  const record = addresses.find((entry) => entry.address === address) ?? null;
  findings.push({
    id: `f-${findings.length + 1}`,
    vrfId: null,
    address,
    addressId: record?.id ?? null,
    prefixId: prefix?.id ?? null,
    kind,
    severity,
    details,
    status: "open",
    ticketId: null,
    ticketNumber: null,
    prefix: prefix?.prefix ?? null,
    firstSeenAt: ago(daysAgo * 60 * 24),
    lastSeenAt: ago(25),
    resolvedAt: null,
  });
}
finding(
  "10.10.1.23",
  "foreign_mac",
  "critical",
  {
    mac: "a4:5e:60:12:9b:01",
    vendor: "Apple",
    switchName: "SW-004",
    switchPort: "Gi1/0/17",
  },
  2,
);
finding(
  "10.10.1.150",
  "ghost",
  "warning",
  { mac: "00:50:56:aa:10:02", vendor: "VMware", source: "Agent" },
  5,
);
finding(
  "10.10.1.151",
  "ghost",
  "warning",
  { mac: "00:50:56:aa:10:03", vendor: "VMware", source: "Agent" },
  5,
);
finding(
  "10.10.4.47",
  "ghost",
  "warning",
  { mac: "54:ee:75:01:02:03", vendor: "Lenovo", source: "Agent" },
  1,
);
finding(
  "10.10.9.7",
  "conflict",
  "critical",
  { mac: "80:5e:c0:22:11:aa", message: "Zwei MAC-Adressen melden dieselbe IP" },
  0,
);
finding(
  "10.10.1.31",
  "dns_mismatch",
  "info",
  { dnsName: "fileserver-alt.corp.example.ch" },
  9,
);
finding(
  "10.10.8.17",
  "stale",
  "info",
  { message: "Seit 94 Tagen nicht gesehen" },
  30,
);
finding(
  "10.100.20.240",
  "ghost",
  "warning",
  { mac: "f8:bc:12:44:00:9a", vendor: "Dell", source: "PRTG" },
  3,
);
finding(
  "10.100.20.241",
  "ghost",
  "warning",
  { mac: "f8:bc:12:44:00:9b", vendor: "Dell", source: "PRTG" },
  3,
);
finding(
  "10.20.4.70",
  "dns_mismatch",
  "info",
  { dnsName: "pc-zug-070-alt.corp.example.ch" },
  12,
);

// --- Change log --------------------------------------------------------------------

let changeLog: ChangeLogEntry[] = [
  change(
    1,
    12,
    "Martina Keller",
    "user",
    "address",
    "a-10.10.1.80",
    "10.10.1.80",
    "create",
    "Reserviert für SRV-BAAR-NEU",
    [],
  ),
  change(
    2,
    40,
    null,
    "cleanup",
    "prefix",
    "p-baar",
    "10.10.0.0/16",
    "update",
    "Status: Aktiv → Container",
    [["status", "Status", "Aktiv", "Container"]],
  ),
  change(
    3,
    95,
    "Lukas Brunner",
    "user",
    "prefix",
    "p-rz-server",
    "10.100.20.0/24",
    "update",
    "Notiz ergänzt",
    [["notes", "Notiz", null, "Erweiterung auf /23 …"]],
  ),
  change(
    4,
    60 * 5,
    null,
    "discovery",
    "address",
    "a-10.10.4.47",
    "10.10.4.47",
    "update",
    "Zuletzt gesehen aktualisiert",
    [],
  ),
  change(
    5,
    60 * 22,
    "Martina Keller",
    "planner",
    "prefix",
    "p-baar-cam",
    "10.10.20.0/24",
    "create",
    "Subnetz angelegt (KAMERA)",
    [],
  ),
  change(
    6,
    60 * 26,
    "Lukas Brunner",
    "user",
    "vlan",
    "v-s-zug-230",
    "VLAN 230 DRUCKER",
    "update",
    "Name: PRINTER → DRUCKER",
    [["name", "Name", "PRINTER", "DRUCKER"]],
  ),
  change(
    7,
    60 * 30,
    null,
    "intune",
    "address",
    "a-10.10.4.12",
    "10.10.4.12",
    "update",
    "Hostname: PC-BAAR-OLD → PC-BAAR-012",
    [["hostname", "Hostname", "PC-BAAR-OLD", "PC-BAAR-012"]],
  ),
  change(
    8,
    60 * 50,
    "Sandra Meier",
    "template",
    "site",
    "s-cham",
    "Cham",
    "create",
    "Standort aus Vorlage angelegt",
    [],
  ),
  change(
    9,
    60 * 72,
    null,
    "import",
    "prefix",
    "p-rz-backup",
    "10.100.40.0/24",
    "create",
    "Importiert (Excel)",
    [],
  ),
  change(
    10,
    60 * 96,
    "Lukas Brunner",
    "user",
    "address",
    "a-10.10.1.90",
    "10.10.1.90",
    "update",
    "Status: Aktiv → Veraltet",
    [["status", "Status", "Aktiv", "Veraltet"]],
  ),
].reverse();

function change(
  id: number,
  minutesAgo: number,
  actorName: string | null,
  source: ChangeLogEntry["source"],
  objectType: ChangeLogEntry["objectType"],
  objectId: string,
  objectLabel: string,
  action: ChangeLogEntry["action"],
  summary: string,
  changes: [string, string, string | null, string | null][],
): ChangeLogEntry {
  return {
    id,
    at: ago(minutesAgo),
    actorName,
    source,
    objectType,
    objectId,
    objectLabel,
    action,
    summary,
    changes: changes.map(([field, label, before, after]) => ({
      field,
      label,
      before,
      after,
    })),
    undoable: action === "update" && source !== "discovery",
  };
}
let nextChangeId = 100;
function log(
  objectType: ChangeLogEntry["objectType"],
  objectId: string,
  objectLabel: string,
  action: ChangeLogEntry["action"],
  summary: string,
) {
  changeLog = [
    {
      id: nextChangeId++,
      at: new Date().toISOString(),
      actorName: "Demo Agent",
      source: "user",
      objectType,
      objectId,
      objectLabel,
      action,
      summary,
      changes: [],
      undoable: false,
    },
    ...changeLog,
  ];
}

// --- Derived values -----------------------------------------------------------------

function inDhcp(prefix: IpamPrefix, value: bigint): boolean {
  if (!prefix.dhcpStart || !prefix.dhcpEnd) return false;
  const from = parseAddress(prefix.dhcpStart)!.value;
  const to = parseAddress(prefix.dhcpEnd)!.value;
  return value >= from && value <= to;
}

function children(prefix: IpamPrefix): IpamPrefix[] {
  return prefixes.filter((entry) => parentOf(entry)?.id === prefix.id);
}

function parentOf(prefix: IpamPrefix): IpamPrefix | null {
  const cidr = cidrOf(prefix);
  let best: IpamPrefix | null = null;
  for (const other of prefixes) {
    if (other.id === prefix.id || other.vrfId !== prefix.vrfId) continue;
    const outer = cidrOf(other);
    if (outer.version !== cidr.version || outer.length >= cidr.length) continue;
    if (
      !cidrContainsAddress(outer, {
        version: cidr.version,
        value: cidr.network,
      })
    )
      continue;
    if (!best || outer.length > cidrOf(best).length) best = other;
  }
  return best;
}

function usage(prefix: IpamPrefix): IpamPrefix["usage"] {
  const cidr = cidrOf(prefix);
  const size = cidrSize(cidr);
  const capacity = cidr.version === 4 && cidr.length <= 30 ? size - 2n : size;
  if (prefix.status === "container") {
    const kids = children(prefix).filter(
      (entry) => entry.status !== "deprecated",
    );
    const allocated = kids.reduce(
      (sum, kid) => sum + cidrSize(cidrOf(kid)),
      0n,
    );
    return {
      used: Number(allocated > 1_000_000n ? 1_000_000n : allocated),
      dhcpSize: 0,
      capacity: capacity.toString(),
      percent: Number((allocated * 1000n) / size) / 10,
    };
  }
  let dhcpSize = 0;
  if (prefix.dhcpStart && prefix.dhcpEnd) {
    dhcpSize = Number(
      parseAddress(prefix.dhcpEnd)!.value -
        parseAddress(prefix.dhcpStart)!.value +
        1n,
    );
  }
  const used = addresses.filter(
    (entry) =>
      entry.prefixId === prefix.id &&
      entry.status !== "deprecated" &&
      !inDhcp(prefix, parseAddress(entry.address)!.value),
  ).length;
  const percent =
    capacity > 0n
      ? Math.min(
          100,
          Math.round(((used + dhcpSize) * 1000) / Number(capacity)) / 10,
        )
      : 0;
  // The VoIP pool is nearly exhausted in the demo, the DHCP leases count.
  return { used, dhcpSize, capacity: capacity.toString(), percent };
}

function withUsage(prefix: IpamPrefix): IpamPrefix {
  return { ...prefix, usage: usage(prefix) };
}

/** Overview order: parent before children, sorted by address. */
function orderedPrefixes(): IpamPrefix[] {
  const result: IpamPrefix[] = [];
  const visit = (parentId: string | null, depth: number) => {
    prefixes
      .filter((entry) => (parentOf(entry)?.id ?? null) === parentId)
      .sort((a, b) =>
        a.vrfId === b.vrfId
          ? compareCidrText(a.prefix, b.prefix)
          : (a.vrfId ?? "").localeCompare(b.vrfId ?? ""),
      )
      .forEach((entry) => {
        result.push({ ...withUsage(entry), parentId, depth });
        visit(entry.id, depth + 1);
      });
  };
  visit(null, 0);
  return result;
}

function forecastOf(prefix: IpamPrefix): Forecast {
  const percent = usage(prefix)?.percent ?? 0;
  if (percent >= 95)
    return { trend: "rising", daysToWarning: null, daysToFull: 18 };
  if (percent >= 85)
    return { trend: "rising", daysToWarning: null, daysToFull: 75 };
  if (percent >= 40)
    return { trend: "rising", daysToWarning: 260, daysToFull: null };
  if (percent >= 15)
    return { trend: "stable", daysToWarning: null, daysToFull: null };
  return { trend: "unknown", daysToWarning: null, daysToFull: null };
}

function history(prefix: IpamPrefix, days: number) {
  const current = usage(prefix)?.percent ?? 0;
  const forecast = forecastOf(prefix);
  const slope = forecast.trend === "rising" ? 0.09 : 0.005;
  const total = Number(usage(prefix)?.capacity ?? "0");
  const points = [];
  let localSeed = prefix.id.length * 31;
  for (let index = days - 1; index >= 0; index--) {
    localSeed = (localSeed * 16807) % 2147483647;
    const noise = ((localSeed % 1000) / 1000 - 0.5) * 1.6;
    const percent = Math.max(
      0,
      Math.min(100, current - index * slope + (index ? noise : 0)),
    );
    points.push({
      day: day(-index),
      used: Math.round((percent / 100) * total),
      total,
      percent: Math.round(percent * 10) / 10,
    });
  }
  return { points, forecast, warningPercent: prefix.utilizationWarningPercent };
}

/** Aligned free blocks between start and end (inclusive). */
function freeBlocks(version: 4 | 6, start: bigint, end: bigint): Cidr[] {
  const bits = version === 4 ? 32 : 128;
  const result: Cidr[] = [];
  let cursor = start;
  while (cursor <= end) {
    let length = bits;
    while (length > 0) {
      const size = 1n << BigInt(bits - length + 1);
      if (cursor % size !== 0n || cursor + size - 1n > end) break;
      length--;
    }
    result.push({ version, network: cursor, length });
    cursor += 1n << BigInt(bits - length);
  }
  return result;
}

function addressSpace(prefixId: string) {
  const prefix = prefixes.find((entry) => entry.id === prefixId)!;
  const cidr = cidrOf(prefix);
  const kids = children(prefix)
    .filter((entry) => entry.status !== "deprecated")
    .sort((a, b) => compareCidrText(a.prefix, b.prefix));
  const segments: AddressSegment[] = [];
  let cursor = cidr.network;
  let free = 0n;
  let largest: Cidr | null = null;
  const pushFree = (until: bigint) => {
    if (until <= cursor) return;
    for (const block of freeBlocks(cidr.version, cursor, until - 1n)) {
      const size = cidrSize(block);
      free += size;
      if (!largest || block.length < largest.length) largest = block;
      segments.push({
        kind: "free",
        cidr: formatCidr(block),
        size: size.toString(),
      });
    }
  };
  for (const kid of kids) {
    const inner = cidrOf(kid);
    pushFree(inner.network);
    segments.push({
      kind: "child",
      cidr: kid.prefix,
      size: cidrSize(inner).toString(),
      prefixId: kid.id,
      name: kid.description,
      siteName: sites.find((entry) => entry.id === kid.siteId)?.name ?? null,
      percent: usage(kid)?.percent ?? 0,
      status: kid.status,
    });
    cursor = inner.network + cidrSize(inner);
  }
  pushFree(cidrLast(cidr) + 1n);
  const total = cidrSize(cidr);
  const lg = largest as Cidr | null;
  return {
    prefixId,
    prefix: prefix.prefix,
    capacity: total.toString(),
    allocatedPercent: Number(((total - free) * 1000n) / total) / 10,
    freeTotal: free.toString(),
    largestFree: lg ? `/${lg.length}` : null,
    childCount: kids.length,
    segments: segments.slice(0, 512),
    ...(segments.length > 512 ? { truncated: true } : {}),
  };
}

function nextFree(
  prefix: IpamPrefix,
  after: string | null = null,
): string | null {
  const cidr = cidrOf(prefix);
  if (cidr.version !== 4) return null;
  const used = new Set(
    addresses
      .filter(
        (entry) =>
          entry.prefixId === prefix.id && entry.status !== "deprecated",
      )
      .map((entry) => entry.address),
  );
  let value = cidr.network + 1n;
  if (after) value = parseAddress(after)!.value + 1n;
  for (; value < cidrLast(cidr); value++) {
    const ip = formatAddress({ version: 4, value });
    if (ip === prefix.gateway || used.has(ip) || inDhcp(prefix, value))
      continue;
    return ip;
  }
  return null;
}

function descendants(prefix: IpamPrefix): string[] {
  const ids = [prefix.id];
  for (const kid of children(prefix)) ids.push(...descendants(kid));
  return ids;
}

function prefixDetail(body: Record<string, unknown>) {
  const prefix = prefixes.find((entry) => entry.id === body.prefixId)!;
  const cidr = cidrOf(prefix);
  const grid = isGridPrefix(cidr);
  const ids = descendants(prefix);
  let list = addresses
    .filter((entry) =>
      grid ? ids.includes(entry.prefixId ?? "") : entry.prefixId === prefix.id,
    )
    .sort((a, b) => compareAddressText(a.address, b.address));
  const query = typeof body.query === "string" ? body.query.toLowerCase() : "";
  if (query) {
    list = list.filter((entry) =>
      [entry.hostname, entry.dnsName, entry.description, entry.vendor]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }
  const page = Number(body.page ?? 0);
  const pageSize = 200;
  const total = list.length;
  if (!grid) list = list.slice(page * pageSize, page * pageSize + pageSize);
  const forecast = forecastOf(prefix);
  return {
    prefix: withUsage(prefix),
    vrf: vrfs.find((entry) => entry.id === prefix.vrfId) ?? null,
    vlan: vlans.find((entry) => entry.id === prefix.vlanId) ?? null,
    site: sites.find((entry) => entry.id === prefix.siteId) ?? null,
    grid,
    size: cidrSize(cidr).toString(),
    addresses: list,
    total,
    page: grid ? 0 : page,
    pageSize: grid ? null : pageSize,
    children: children(prefix).map(withUsage),
    findings: findings.filter(
      (entry) => entry.status === "open" && ids.includes(entry.prefixId ?? ""),
    ),
    nextFree: prefix.status === "container" ? null : nextFree(prefix),
    forecast: {
      warningOn: forecast.daysToWarning ? day(forecast.daysToWarning) : null,
      fullOn: forecast.daysToFull ? day(forecast.daysToFull) : null,
      perDay: 0.1,
      points: 90,
    },
  };
}

function addressDetail(body: Record<string, unknown>) {
  const record =
    (body.addressId
      ? addresses.find((entry) => entry.id === body.addressId)
      : null) ??
    (body.address
      ? addresses.find((entry) => entry.address === body.address)
      : null) ??
    null;
  const ip = record?.address ?? String(body.address ?? "");
  const prefix = owningPrefix(
    ip,
    record?.vrfId ?? (body.vrfId as string | null) ?? null,
  );
  return {
    address: record,
    ip,
    vrfId: record?.vrfId ?? null,
    canManage: true,
    prefix: prefix ? withUsage(prefix) : null,
    vlan: vlans.find((entry) => entry.id === prefix?.vlanId) ?? null,
    site: sites.find((entry) => entry.id === prefix?.siteId) ?? null,
    asset:
      record?.deviceType === "server"
        ? {
            id: "as-1",
            name: record.hostname ?? "Server",
            assetTag: "IT-04711",
          }
        : null,
    service: null,
    devices: [],
    tickets:
      ip === "10.10.1.23"
        ? [
            {
              id: "t-1",
              ticketNumber: "T-2026-1184",
              subject: "Fileserver zeitweise nicht erreichbar",
              updatedAt: ago(90),
              reason: "IP im Ticket erwähnt",
            },
          ]
        : [],
    findings: findings.filter((entry) => entry.address === ip),
    events: record
      ? [
          {
            id: "e1",
            kind: "created",
            details: { hostname: record.hostname },
            actorName: "Import",
            at: record.createdAt ?? ago(9999),
          },
          {
            id: "e2",
            kind: "seen",
            details: { note: record.lastSeenSource ?? "Agent" },
            actorName: null,
            at: record.lastSeenAt ?? ago(60),
          },
        ]
      : [],
  };
}

function overview() {
  const ordered = orderedPrefixes();
  const leaves = ordered.filter((entry) => entry.status === "active");
  const v4 = leaves.filter((entry) => !entry.prefix.includes(":"));
  const used = v4.reduce(
    (sum, entry) =>
      sum + (entry.usage?.used ?? 0) + (entry.usage?.dhcpSize ?? 0),
    0,
  );
  const capacity = v4.reduce(
    (sum, entry) => sum + Number(entry.usage?.capacity ?? 0),
    0,
  );
  return {
    canManage: true,
    departments: [],
    vrfs,
    sites,
    vlans,
    prefixes: ordered,
    people: [
      { id: "u1", name: "Martina Keller" },
      { id: "u2", name: "Lukas Brunner" },
    ],
    teams: [{ id: "t1", name: "Infrastruktur" }],
    services: [],
    kpis: {
      prefixCount: ordered.length,
      vrfCount: vrfs.length,
      addressCount: addresses.length,
      usedV4: used,
      capacityV4: String(capacity),
      overWarning: v4.filter((entry) => (entry.usage?.percent ?? 0) >= 85)
        .length,
      openFindings: findings.filter((entry) => entry.status === "open").length,
      conflicts: findings.filter(
        (entry) =>
          entry.status === "open" &&
          (entry.kind === "conflict" || entry.kind === "foreign_mac"),
      ).length,
    },
  };
}

function dashboard() {
  const ordered = orderedPrefixes();
  const leaves = ordered.filter(
    (entry) =>
      entry.status === "active" &&
      !entry.prefix.includes(":") &&
      !children(entry).some((kid) => kid.status === "active"),
  );
  const free = leaves.reduce(
    (sum, entry) =>
      sum +
      Number(entry.usage?.capacity ?? 0) -
      (entry.usage?.used ?? 0) -
      (entry.usage?.dhcpSize ?? 0),
    0,
  );
  const top = [...leaves]
    .sort((a, b) => (b.usage?.percent ?? 0) - (a.usage?.percent ?? 0))
    .slice(0, 8)
    .map((entry) => {
      const vlanEntry = vlans.find((item) => item.id === entry.vlanId);
      return {
        prefixId: entry.id,
        prefix: entry.prefix,
        name: entry.description,
        vlanNumber: vlanEntry?.vlanNumber ?? null,
        vlanName: vlanEntry?.name ?? null,
        siteName: sites.find((item) => item.id === entry.siteId)?.name ?? null,
        percent: entry.usage?.percent ?? 0,
        forecast: forecastOf(entry),
      };
    });
  const byKind: Record<string, number> = {};
  for (const entry of findings.filter((item) => item.status === "open")) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  }
  return {
    kpis: {
      freeIpv4: free,
      activePrefixes: leaves.length,
      overThreshold: leaves.filter((entry) => (entry.usage?.percent ?? 0) >= 85)
        .length,
      fullWithin30Days: top.filter(
        (entry) => (entry.forecast.daysToFull ?? 999) <= 30,
      ).length,
      openFindings: findings.filter((entry) => entry.status === "open").length,
      findingsByKind: byKind,
      expiringReservations30Days: addresses.filter(
        (entry) =>
          entry.status === "reserved" &&
          entry.reservedUntil &&
          entry.reservedUntil <= day(30),
      ).length,
    },
    topUtilization: top,
    agents: [
      {
        id: "ag1",
        name: "Agent Baar",
        platform: "Windows Server 2022",
        status: "online",
        lastSeenAt: ago(3),
      },
      {
        id: "ag2",
        name: "Agent Zug",
        platform: "Linux (Docker)",
        status: "late",
        lastSeenAt: ago(60 * 5),
      },
      {
        id: "ag3",
        name: "Agent RZ",
        platform: "Linux (Docker)",
        status: "offline",
        lastSeenAt: ago(60 * 24 * 3),
      },
    ],
    recentChanges: changeLog.slice(0, 8),
  };
}

const template: SiteTemplate = {
  id: "tpl-std",
  name: "Standard-Standort",
  description: "VLAN-Basis + Offset, /16 je Standort",
  prefixLength: 16,
  entries: [
    {
      function: "MGMT",
      vlanOffset: 0,
      offset24: 0,
      length: 24,
      zone: "MGMT",
      dhcp: false,
    },
    {
      function: "SERVER",
      vlanOffset: 10,
      offset24: 1,
      length: 24,
      zone: "LAN",
      dhcp: false,
    },
    {
      function: "CLIENTS",
      vlanOffset: 20,
      offset24: 4,
      length: 22,
      zone: "LAN",
      dhcp: true,
    },
    {
      function: "PRINTER",
      vlanOffset: 30,
      offset24: 8,
      length: 24,
      zone: "LAN",
      dhcp: false,
    },
    {
      function: "VOIP",
      vlanOffset: 40,
      offset24: 9,
      length: 24,
      zone: "VOICE",
      dhcp: true,
    },
    {
      function: "WLAN",
      vlanOffset: 50,
      offset24: 10,
      length: 23,
      zone: "WLAN",
      dhcp: true,
    },
    {
      function: "KAMERA",
      vlanOffset: 60,
      offset24: 20,
      length: 24,
      zone: "IOT",
      dhcp: false,
    },
  ],
};

function vlanMatrix() {
  const matrixSites = sites.filter((entry) => entry.id !== "s-rz");
  const rows = template.entries.map((entry) => ({
    function: entry.function,
    zone: entry.zone ?? null,
    cells: matrixSites.map((siteEntry): MatrixCell => {
      if (!siteEntry.vlanBase) return { siteId: siteEntry.id, state: "na" };
      const number = siteEntry.vlanBase + entry.vlanOffset;
      const found = vlans.find(
        (item) => item.siteId === siteEntry.id && item.vlanNumber === number,
      );
      const second = siteEntry.vlanBase / 10;
      const expected = `10.${second}.${entry.offset24}.0/${entry.length}`;
      if (!found) {
        return {
          siteId: siteEntry.id,
          state: "missing",
          suggestion: { vlanNumber: number, prefix: expected },
        };
      }
      const prefix = prefixes.find((item) => item.vlanId === found.id);
      const sameName = found.name.toUpperCase() === entry.function;
      const samePrefix = prefix?.prefix === expected;
      return {
        siteId: siteEntry.id,
        state: sameName && samePrefix ? "ok" : "diff",
        vlanId: found.id,
        vlanNumber: found.vlanNumber,
        vlanName: found.name,
        ...(prefix
          ? {
              prefixId: prefix.id,
              prefix: prefix.prefix,
              percent: usage(prefix)?.percent ?? 0,
            }
          : {}),
        ...(sameName && samePrefix
          ? {}
          : {
              note: !sameName
                ? `Name ${found.name}`
                : `${prefix?.prefix.split("/")[1] ? `/${prefix?.prefix.split("/")[1]}` : ""} statt /${entry.length}`,
            }),
      };
    }),
  }));
  return {
    template,
    sites: matrixSites.map((entry) => ({ id: entry.id, name: entry.name })),
    rows,
    otherVlans: vlans
      .filter((entry) => entry.siteId === "s-rz")
      .map((entry) => ({
        siteId: entry.siteId!,
        vlanId: entry.id,
        vlanNumber: entry.vlanNumber,
        name: entry.name,
        prefix:
          prefixes.find((item) => item.vlanId === entry.id)?.prefix ?? null,
      })),
  };
}

function siteCard(siteEntry: IpamSite) {
  const own = prefixes.filter(
    (entry) => entry.siteId === siteEntry.id && entry.status === "active",
  );
  const capacity = own.reduce(
    (sum, entry) => sum + Number(usage(entry)?.capacity ?? 0),
    0,
  );
  const used = own.reduce(
    (sum, entry) =>
      sum + (usage(entry)?.used ?? 0) + (usage(entry)?.dhcpSize ?? 0),
    0,
  );
  const supernet = prefixes.find(
    (entry) =>
      entry.siteId === siteEntry.id &&
      entry.status === "container" &&
      !entry.prefix.includes(":"),
  );
  const agents: Record<
    string,
    { status: "online" | "late" | "offline"; name: string }
  > = {
    "s-baar": { status: "online", name: "Agent Baar" },
    "s-zug": { status: "late", name: "Agent Zug" },
    "s-rz": { status: "offline", name: "Agent RZ" },
  };
  return {
    id: siteEntry.id,
    name: siteEntry.name,
    code: siteEntry.code,
    address: siteEntry.address,
    assetLocation:
      siteEntry.id === "s-baar"
        ? { id: "loc-1", name: "Baar, Neuhofstrasse" }
        : null,
    supernet: supernet?.prefix ?? null,
    vlanCount: vlans.filter((entry) => entry.siteId === siteEntry.id).length,
    prefixCount: own.length,
    switchCount: addresses.filter(
      (entry) =>
        entry.deviceType === "switch" &&
        owningPrefix(entry.address, null)?.siteId === siteEntry.id,
    ).length,
    apCount: addresses.filter(
      (entry) =>
        entry.deviceType === "access_point" &&
        owningPrefix(entry.address, entry.vrfId)?.siteId === siteEntry.id,
    ).length,
    deviceCount: 4,
    percent: capacity ? Math.round((used * 1000) / capacity) / 10 : null,
    agent: agents[siteEntry.id] ?? null,
  };
}

function siteDetail(siteId: string) {
  const siteEntry = sites.find((entry) => entry.id === siteId)!;
  return {
    site: {
      ...siteCard(siteEntry),
      description: null,
      departmentId: null,
      vlanBase: siteEntry.vlanBase ?? null,
      supernetPrefixId: null,
      templateId: siteEntry.templateId ?? null,
    },
    vlans: vlans
      .filter((entry) => entry.siteId === siteId)
      .map((entry) => ({
        id: entry.id,
        vlanNumber: entry.vlanNumber,
        name: entry.name,
        description: entry.description,
        zone: entry.zone ?? null,
        prefixes: prefixes
          .filter((item) => item.vlanId === entry.id)
          .map((item) => ({
            id: item.id,
            prefix: item.prefix,
            gateway: item.gateway,
            dhcpStart: item.dhcpStart,
            dhcpEnd: item.dhcpEnd,
            percent: usage(item)?.percent ?? null,
          })),
      })),
    prefixesWithoutVlan: prefixes
      .filter(
        (entry) =>
          entry.siteId === siteId && !entry.vlanId && entry.status === "active",
      )
      .map((entry) => ({
        id: entry.id,
        prefix: entry.prefix,
        name: entry.description,
        percent: usage(entry)?.percent ?? null,
      })),
    devices: [
      {
        assetId: "d1",
        name: `FW-${siteEntry.code}-01`,
        category: "Firewall",
        ipAddress: "10.10.0.1",
        model: "XGS 2300",
        manufacturer: "Sophos",
        serialNumber: "X23001",
        locationNote: "Serverraum",
        uplinkAssetId: null,
        uplinkName: null,
      },
      {
        assetId: "d2",
        name: `SW-${siteEntry.code}-CORE`,
        category: "Switch",
        ipAddress: "10.10.0.10",
        model: "C9300-48P",
        manufacturer: "Cisco",
        serialNumber: "FOC1234",
        locationNote: "Serverraum",
        uplinkAssetId: "d1",
        uplinkName: `FW-${siteEntry.code}-01`,
      },
      {
        assetId: "d3",
        name: `SW-${siteEntry.code}-OG1`,
        category: "Switch",
        ipAddress: "10.10.0.11",
        model: "C9200-24P",
        manufacturer: "Cisco",
        serialNumber: "FOC5678",
        locationNote: "1. OG",
        uplinkAssetId: "d2",
        uplinkName: `SW-${siteEntry.code}-CORE`,
      },
      {
        assetId: "d4",
        name: `AP-${siteEntry.code}-01`,
        category: "Access Point",
        ipAddress: "10.10.0.50",
        model: "U6 Pro",
        manufacturer: "Ubiquiti",
        serialNumber: "UB001",
        locationNote: "Empfang",
        uplinkAssetId: "d3",
        uplinkName: `SW-${siteEntry.code}-OG1`,
      },
    ],
  };
}

function planPrefixes(body: Record<string, unknown>) {
  const parent = prefixes.find((entry) => entry.id === body.parentPrefixId)!;
  const space = addressSpace(parent.id);
  const taken: Cidr[] = [];
  const items = (body.items as { name: string; length: number }[]).map(
    (item) => {
      for (const segment of space.segments) {
        if (segment.kind !== "free") continue;
        const block = parseCidrInput(segment.cidr)!.cidr;
        if (block.length > item.length) continue;
        const step = 1n << BigInt(32 - item.length);
        for (
          let start = block.network;
          start + step - 1n <= cidrLast(block);
          start += step
        ) {
          const end = start + step - 1n;
          if (
            taken.some(
              (other) => !(end < other.network || start > cidrLast(other)),
            )
          )
            continue;
          const cidr: Cidr = {
            version: 4,
            network: start,
            length: item.length,
          };
          taken.push(cidr);
          return {
            name: item.name,
            cidr: formatCidr(cidr),
            hosts: String(Number(step) - 2),
            error: null,
          };
        }
      }
      return {
        name: item.name,
        cidr: null,
        hosts: null,
        error: "Kein passender freier Block.",
      };
    },
  );
  return {
    items,
    freeAfter: String(
      BigInt(space.freeTotal) -
        taken.reduce((sum, entry) => sum + cidrSize(entry), 0n),
    ),
  };
}

// --- Dispatcher ---------------------------------------------------------------------

function search(term: string) {
  const lower = term.toLowerCase();
  const found = addresses
    .filter((entry) =>
      [
        entry.address,
        entry.hostname,
        entry.dnsName,
        entry.macAddress,
        entry.description,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(lower)),
    )
    .slice(0, 100);
  const nets = orderedPrefixes().filter((entry) =>
    `${entry.prefix} ${entry.description ?? ""} ${entry.securityZone ?? ""}`
      .toLowerCase()
      .includes(lower),
  );
  return { addresses: found, prefixes: nets.slice(0, 50) };
}

export function handle(body: Record<string, unknown>): unknown {
  switch (body.type) {
    case "overview":
      return overview();
    case "dashboard":
      return dashboard();
    case "prefixDetail":
      return prefixDetail(body);
    case "addressDetail":
      return addressDetail(body);
    case "utilizationHistory":
      return history(
        prefixes.find((entry) => entry.id === body.prefixId)!,
        Number(body.days ?? 90),
      );
    case "addressSpace":
      return addressSpace(String(body.prefixId));
    case "search":
      return search(String(body.query ?? ""));
    case "findings": {
      const status = (body.status as string) ?? "open";
      return {
        canManage: true,
        findings: findings.filter(
          (entry) => status === "all" || entry.status === status,
        ),
      };
    }
    case "cleanupSuggestions":
      return {
        suggestions: [
          {
            key: "note_in_name:p-baar-old",
            kind: "note_in_name",
            title: "10.10.99.0/24: Hinweis im Namen",
            detail: "«OLD_GAST» enthält einen Hinweis",
            fix: "Text in Notiz verschieben",
            objectType: "prefix",
            objectId: "p-baar-old",
            defaultOn: true,
          },
          {
            key: "empty_container:p-cham",
            kind: "empty_container",
            title: "10.30.0.0/16 fast leer",
            detail: "Container mit wenigen Teilnetzen",
            fix: "Nur Hinweis",
            objectType: "prefix",
            objectId: "p-cham",
            defaultOn: false,
          },
        ],
      };
    case "applyCleanup":
      return { applied: (body.keys as string[]).length, failed: [] };
    case "changeLog": {
      let entries = changeLog;
      if (body.objectType)
        entries = entries.filter(
          (entry) => entry.objectType === body.objectType,
        );
      if (body.objectId)
        entries = entries.filter((entry) => entry.objectId === body.objectId);
      if (body.source)
        entries = entries.filter((entry) => entry.source === body.source);
      return {
        entries: entries.slice(0, Number(body.limit ?? 50)),
        nextBefore: null,
      };
    }
    case "undoChange":
      changeLog = changeLog.map((entry) =>
        entry.id === body.entryId ? { ...entry, undoable: false } : entry,
      );
      return { ok: true };
    case "compareObserved":
      return {
        lastScanAt: ago(25),
        rows: [
          "p-baar-server",
          "p-baar-clients",
          "p-baar-voip",
          "p-rz-server",
          "p-zug-clients",
        ].map((id) => {
          const prefix = prefixes.find((entry) => entry.id === id)!;
          const documented = addresses.filter(
            (entry) => entry.prefixId === id && entry.status !== "deprecated",
          ).length;
          const onlySeen = findings.filter(
            (entry) => entry.prefixId === id && entry.kind === "ghost",
          ).length;
          const onlyDocumented = Math.round(documented * 0.04);
          const matched = documented - onlyDocumented;
          return {
            prefixId: id,
            prefix: prefix.prefix,
            name: prefix.description,
            documented,
            seen: matched + onlySeen,
            matched,
            onlySeen,
            onlyDocumented,
            matchPercent:
              Math.round(
                (matched * 1000) / (matched + onlySeen + onlyDocumented),
              ) / 10,
          };
        }),
      };
    case "vlanMatrix":
      return vlanMatrix();
    case "listTemplates":
      return { templates: [template] };
    case "siteOverview":
      return {
        sites: sites.map(siteCard),
        assetLocations: [
          { id: "loc-1", name: "Baar, Neuhofstrasse", linkedSiteId: "s-baar" },
          { id: "loc-2", name: "Zug, Baarerstrasse", linkedSiteId: null },
        ],
      };
    case "siteDetail":
      return siteDetail(String(body.siteId));
    case "planPrefixes":
      return planPrefixes(body);
    case "nextFreeAddress": {
      const prefix = prefixes.find((entry) => entry.id === body.prefixId)!;
      return {
        address: nextFree(prefix, (body.after as string | null) ?? null),
      };
    }
    case "lookups":
      return {
        assets: [{ id: "as-1", name: "Fileserver Baar", assetTag: "IT-04711" }],
      };
    case "reserveAddress": {
      const input = body.reservation as Record<string, string | null>;
      const ip = String(input.address);
      const existing = addresses.find((entry) => entry.address === ip);
      if (existing && existing.status !== "deprecated") {
        throw new Error(
          tn(
`${ip} ist bereits vergeben. Bitte hol dir einen neuen Vorschlag.`,
`${ip} ist bereits vergeben. Bitte holen Sie einen neuen Vorschlag.`,
),
        );
      }
      if (existing) {
        existing.status = "reserved";
        existing.hostname = input.hostname || null;
        existing.description = input.description || null;
      } else {
        addAddress(ip, input.hostname || null, {
          status: "reserved",
          description: input.description || null,
          reservedUntil: input.reservedUntil || null,
          lastSeenAt: null,
          macAddress: null,
          vendor: null,
          switchName: null,
          switchPort: null,
        });
        addresses[addresses.length - 1]!.prefixId =
          owningPrefix(ip, null)?.id ?? null;
      }
      log("address", `a-${ip}`, ip, "create", "Reserviert");
      return {
        id: `a-${ip}`,
        address: ip,
        prefixId: owningPrefix(ip, null)?.id ?? null,
      };
    }
    case "releaseAddress": {
      const record = addresses.find((entry) => entry.id === body.addressId);
      if (record) record.status = "deprecated";
      if (record)
        log("address", record.id, record.address, "update", "Freigegeben");
      return { ok: true };
    }
    case "saveAddress": {
      const input = body.address as IpamAddress;
      const record = addresses.find(
        (entry) => entry.id === input.id || entry.address === input.address,
      );
      if (record) Object.assign(record, input, { prefixId: record.prefixId });
      else {
        addAddress(input.address, input.hostname, {
          ...input,
          id: `a-${input.address}`,
        });
        addresses[addresses.length - 1]!.prefixId =
          owningPrefix(input.address, input.vrfId)?.id ?? null;
      }
      return { id: record?.id ?? `a-${input.address}` };
    }
    case "delete": {
      if (body.entity === "prefix") {
        const prefix = prefixes.find((entry) => entry.id === body.id);
        if (prefix) prefix.status = "deprecated";
        if (prefix)
          log(
            "prefix",
            prefix.id,
            prefix.prefix,
            "update",
            "Status → Veraltet",
          );
      }
      return { ok: true };
    }
    case "savePrefix": {
      const input = body.prefix as IpamPrefix;
      const prefix = prefixes.find((entry) => entry.id === input.id);
      if (prefix) Object.assign(prefix, { ...input, usage: null });
      return { id: input.id ?? "p-new" };
    }
    case "bulkUpdatePrefixes": {
      const ids = body.prefixIds as string[];
      const patch = body.patch as Partial<IpamPrefix>;
      for (const prefix of prefixes) {
        if (!ids.includes(prefix.id)) continue;
        if (patch.status) prefix.status = patch.status;
        if ("siteId" in patch) prefix.siteId = patch.siteId ?? null;
        if ("securityZone" in patch)
          prefix.securityZone = patch.securityZone ?? null;
        if ("departmentId" in patch)
          prefix.departmentId = patch.departmentId ?? null;
      }
      return { updated: ids.length };
    }
    case "resolveFinding": {
      const entry = findings.find((item) => item.id === body.findingId);
      if (entry)
        entry.status = (body.status as IpamFinding["status"]) ?? "resolved";
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

/** Simulated network round trip; errors carry the German message. */
export async function ipamCall<T>(body: Record<string, unknown>): Promise<T> {
  const delay =
    (window as unknown as { __ipamDelay?: number }).__ipamDelay ?? 120;
  await new Promise((resolve) => window.setTimeout(resolve, delay));
  const result = handle(body);
  return structuredClone(result) as T;
}

export function downloadFile(): void {}

export type { AddressStatus };
