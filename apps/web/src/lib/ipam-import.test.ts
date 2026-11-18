import { describe, expect, it } from "vitest";

import {
  batchCounts,
  chunkRows,
  classifySheet,
  detectSource,
  formatCidr,
  inferDeviceType,
  looksSecret,
  maskLength,
  normalizeIp,
  normalizeMac,
  parseCidr,
  parseLength,
  parseSonnenbergWorkbook,
  parseWorkbook,
  resolveRelativeIp,
  wireRow,
  workbookFromCsv,
  workbookFromSheets,
  type Cell,
  type Workbook,
} from "./ipam-import";

// All data below is invented (documentation ranges, fictional sites).

function ipSheet(
  cidr: string,
  vlan: string,
  name: string,
  rows: Cell[][],
  width = 4,
): Cell[][] {
  const pad = (row: Cell[]) => [
    ...row,
    ...Array(Math.max(0, width - row.length)).fill(null),
  ];
  return [
    pad(["Overview"]),
    pad([cidr, vlan, name]),
    pad(["IP", "Hostname", "Funktion"]),
    ...rows.map(pad),
  ];
}

const OVERVIEW: Cell[][] = [
  [
    "Lokation",
    "Security\r\nZone",
    "IP Prefix",
    "PL",
    "Default\r\nGW",
    "GW Device",
    "VLAN ID",
    "VLAN Name",
    "IP-Helper",
    "Beschreibung",
  ],
  [
    "NORD",
    "multiple",
    "10.20.0.0",
    16,
    "-",
    "-",
    "-",
    "-",
    "-",
    "Campus Nord Summary",
  ],
  [
    "NORD",
    "INSIDE",
    "10.20.1.0",
    24,
    ".1",
    "NORD-FW01",
    101,
    "NORD_MGMT",
    "-",
    "Switches und APs",
  ],
  [
    "NORD",
    "INSIDE",
    "10.20.2.0",
    "/24",
    ".1",
    "NORD-CSW01",
    102,
    "NORD_SERVER",
    "a.b.c.d\r\na.b.c.d",
    "Server",
  ],
  [
    "NORD",
    "TRANSIT",
    "10.20.9.0",
    28,
    ".1\r\n.14",
    "NORD-CSW01\r\nNORD-FW01",
    109,
    "TR_CORE-FW",
    null,
    "Transit Core <> Firewall",
  ],
  ["NORD", "tbd", "10.20.10.0", 24, null, null, null, null, "-", "Reserve"],
  [
    "NORD",
    "SERVER",
    "10.20.4.0",
    23,
    ".5.250",
    "OLD-CORE",
    104,
    "SERVER_OLD",
    "-",
    "Alte Server",
  ],
  [
    "NORD",
    "MGMT",
    "10.20.8.0",
    24,
    "10.99.0.1",
    "OLD-CORE",
    108,
    "AP_OLD",
    null,
    "AccessPoints",
  ],
  [
    "NORD",
    "SERVER",
    "10.20.6.0",
    "-",
    null,
    "OLD-CORE",
    106,
    "SERVER2",
    null,
    "ohne Länge",
  ],
  ["NORD", "CP", null, null, null, null, 2090, "CP_PreAuth", null, "nur VLAN"],
  [null, null, null, null, null, null, null, null, null, null],
  [
    "SUED",
    null,
    "10.30.0.0",
    24,
    ".1",
    "SUED-RTR",
    101,
    "SUED_MGMT",
    "10.20.2.10",
    "MGMT Netz",
  ],
  [
    "SUED",
    null,
    "10.30.0.0",
    24,
    ".1",
    "SUED-RTR",
    101,
    "SUED_MGMT",
    "10.20.2.10",
    "doppelt",
  ],
  [
    "NORD",
    "MGMT",
    "10.20.12.0",
    24,
    null,
    null,
    101,
    "OTHER_NAME",
    null,
    "VLAN doppelt",
  ],
];

const MGMT = ipSheet("10.20.1.0/24", "Vlan101", "NORD_MGMT", [
  ["10.20.1.0", "-", "Network"],
  ["10.20.1.1", "Firewall Nord", "Default Gateway"],
  ["10.20.1.2", null, "Netzwerkkomponente"],
  ["10.20.1.3", null, null],
  ["10.20.1.10", "NORD-CSW01", "Core Switch (Aruba)"],
  ["10.20.1.11", "NORD-AP1", "AP (DHCP)"],
  ["10.20.1.12", "door-ctl.example.test", "00:07:CC:00:00:01"],
  ["10.20.1.13", "intranet.example.test\nwiki.example.test", "Web"],
  ["10.20.1.100", "DHCP", "AP (DHCP)"],
  ["10.20.1.101", "DHCP", null],
  ["10.20.1.150", "DHCP", null],
  ["10.20.1.200", null, null, "Reserviert"],
  ["10.20.1.201", null, null, "Reserviert"],
  ["10.20.1.202", null, null, "Reserviert"],
  ["10.20.1.203", null, null, "Reserviert"],
  ["10.20.1.204", null, "Reserve Switch"],
  ["10.20.1.205", "PW-SAFE", "Passwort: geheim123", "Reserviert"],
  ["10.20.1.255", "-", "Broadcast"],
]);

const PUBLIC: Cell[][] = [
  ["Overview", null, null, null],
  ["192.0.2.8/29", "VLAN 4002", "Provider A", "Vertrag 1"],
  ["IP", "Subnet Mask", "Hostname / Domain Name", "Funktion / Server intern"],
  ["192.0.2.8", "255.255.255.248", "-", "Network"],
  [
    "192.0.2.9",
    "255.255.255.248",
    "Provider Router",
    "Internet Router / Default GW",
  ],
  ["192.0.2.14", "255.255.255.248", "NORD-FW01", "Firewall"],
  ["192.0.2.15", "255.255.255.248", "-", "Broadcast"],
  [null, null, null, null],
  ["198.51.100.0/29", "noVlan", "Provider B", null],
  ["IP", "Subnet Mask", "Hostname / Domain Name", "Funktion / Server intern"],
  ["198.51.100.1", "255.255.255.248", "Provider B Router", "Router"],
];

const OLD: Cell[][] = [
  [
    "Host",
    "IP bestehend",
    "IP",
    "Server\r\n10.20.4.x",
    "Aula\r\nSteuerung\r\n10.20.5.x",
    "BackupNetz",
  ],
  [null, null, 0, null, "siehe", null],
  ["X1", "172.31.0.1", 1, "VLAN-Gateway", "Aula", "172.31.1.1"],
  ["X2", "172.31.0.2", 2, "S002 - ESX Host", "Tab", null],
  [null, null, 3, "S003 - Datei Server - C$, D$", null, null],
  [null, null, 4, 1, null, null],
  [null, null, 5, "AS - Reserve", null, null],
  [null, null, 6, null, "Licht Saal", null],
];

const SONNENBERG: Workbook = {
  Overview: OVERVIEW,
  "PUBLIC-IP NORD": PUBLIC,
  "NORD_MGMT-10.20.1.0": MGMT,
  "OLD_VLAN1 - LAN": OLD,
  Template: ipSheet("10.0.0.0/24", "Vlan1", "TEMPLATE", [
    ["10.0.0.5", "x", "y"],
  ]),
  "Aula IP Liste": [
    ["WLAN", "Schlüssel"],
    ["Gast", "geheim"],
  ],
  Tabelle1: [],
};

describe("address helpers", () => {
  it("normalizes addresses, prefixes and masks", () => {
    expect(normalizeIp("10.0.0.08")).toBe("10.0.0.8");
    expect(normalizeIp("10.0.0.256")).toBeNull();
    expect(normalizeIp("2001:DB8:0:0:0:0:0:1")).toBe("2001:db8::1");
    expect(normalizeIp("::ffff:192.0.2.1")).toBe("::ffff:c000:201");
    expect(formatCidr(parseCidr("192.0.2.0/24")!)).toBe("192.0.2.0/24");
    expect(parseCidr("192.0.2.9/29")).toMatchObject({
      length: 29,
      hostBits: true,
    });
    expect(formatCidr(parseCidr("192.0.2.9/29")!)).toBe("192.0.2.8/29");
    expect(parseCidr("192.0.2.0")).toBeNull();
    expect(parseCidr("192.0.2.0", 24)).not.toBeNull();
    expect(maskLength("255.255.255.240")).toBe(28);
    expect(maskLength("255.0.255.0")).toBeNull();
    expect(parseLength("/24")).toBe(24);
    expect(parseLength(23)).toBe(23);
    expect(parseLength("-")).toBeNull();
  });

  it("resolves relative gateways", () => {
    const cidr = parseCidr("10.0.0.0/23")!;
    expect(resolveRelativeIp(cidr, ".1")).toBe("10.0.0.1");
    expect(resolveRelativeIp(cidr, ".0.250")).toBe("10.0.0.250");
    expect(resolveRelativeIp(cidr, "10.0.1.254")).toBe("10.0.1.254");
    expect(resolveRelativeIp(cidr, "Firewall")).toBeNull();
  });

  it("normalizes MAC addresses and guesses types", () => {
    expect(normalizeMac("482F6BCF52A8")).toBe("48:2f:6b:cf:52:a8");
    expect(normalizeMac("48-2F-6B-CF-52-A8")).toBe("48:2f:6b:cf:52:a8");
    expect(normalizeMac("482f.6bcf.52a8")).toBe("48:2f:6b:cf:52:a8");
    expect(normalizeMac("SW001")).toBeNull();
    expect(inferDeviceType("NORD-CSW01", "Core Switch")).toBe("switch");
    expect(inferDeviceType("NORD-AP1", "AP (DHCP)")).toBe("access_point");
    expect(inferDeviceType("Firewall Nord", "Default Gateway")).toBe(
      "firewall",
    );
    expect(inferDeviceType("SRV-APP01", null)).toBe("server");
    expect(inferDeviceType(null, null)).toBeNull();
  });

  it("recognizes secrets but not server names", () => {
    expect(looksSecret("Passwort: abc")).toBe(true);
    expect(looksSecret("WLAN-Key = 12345678")).toBe(true);
    expect(looksSecret("Pleasant Password Server")).toBe(false);
    expect(looksSecret(null)).toBe(false);
  });
});

describe("MASTER IP list", () => {
  const batch = parseSonnenbergWorkbook(SONNENBERG);
  const prefix = (cidr: string) =>
    batch.prefixes.find((entry) => entry.prefix === cidr);
  const address = (ip: string) =>
    batch.addresses.find((entry) => entry.address === ip);

  it("classifies sheets", () => {
    expect(classifySheet("Overview", OVERVIEW).kind).toBe("overview");
    expect(classifySheet("NORD_MGMT-10.20.1.0", MGMT).kind).toBe("blocks");
    expect(classifySheet("OLD_VLAN1 - LAN", OLD).kind).toBe("octets");
    expect(classifySheet("Aula IP Liste", [["x"]]).kind).toBe("ignored");
    expect(classifySheet("Notizen", [["irgendwas", "anderes"]]).kind).toBe(
      "unknown",
    );
    expect(detectSource(SONNENBERG)).toBe("sonnenberg");
  });

  it("reads sites, VLANs and prefixes from the overview", () => {
    expect(batch.sites.map((site) => site.name)).toEqual(["NORD", "SUED"]);
    expect(prefix("10.20.0.0/16")?.status).toBe("container");
    expect(prefix("10.20.1.0/24")).toMatchObject({
      status: "active",
      site: "NORD",
      vlanNumber: 101,
      gateway: "10.20.1.1",
      gatewayDevice: "NORD-FW01",
      securityZone: "INSIDE",
      dhcpStart: "10.20.1.100",
      dhcpEnd: "10.20.1.150",
    });
    expect(prefix("10.20.2.0/24")).toMatchObject({ dhcpHelper: null });
    expect(prefix("10.20.9.0/28")).toMatchObject({
      gateway: "10.20.9.1",
      gatewayDevice: "NORD-CSW01 / NORD-FW01",
      customFields: {
        gateways: "10.20.9.1 (NORD-CSW01), 10.20.9.14 (NORD-FW01)",
      },
    });
    expect(prefix("10.20.10.0/24")?.status).toBe("reserved");
    expect(prefix("10.20.10.0/24")?.securityZone).toBeNull();
    expect(prefix("10.20.4.0/23")).toMatchObject({
      gateway: "10.20.5.250",
      tags: ["alt"],
    });
    // Absolute gateway outside the prefix is dropped with a warning.
    expect(prefix("10.20.8.0/24")).toMatchObject({
      gateway: null,
      customFields: { gateway_original: "10.99.0.1" },
    });
    expect(prefix("10.30.0.0/24")?.dhcpHelper).toBe("10.20.2.10");
    expect(prefix("10.20.6.0/24")).toBeUndefined();
    expect(batch.vlans.find((vlan) => vlan.number === 2090)?.name).toBe(
      "CP_PreAuth",
    );
    // VLAN 101 exists at NORD and SUED; the second NORD name is reported.
    expect(
      batch.vlans
        .filter((vlan) => vlan.number === 101)
        .map((vlan) => vlan.site),
    ).toEqual(["NORD", "SUED"]);
    const messages = batch.issues.map((issue) => issue.message).join("\n");
    expect(messages).toContain("Präfixlänge fehlt");
    expect(messages).toContain("«NORD_MGMT» bleibt");
    expect(messages).toContain("10.30.0.0/24 ist doppelt");
    expect(messages).toContain("Gateway 10.99.0.1 liegt nicht in 10.20.8.0/24");
  });

  it("reads address blocks", () => {
    expect(address("10.20.1.0")).toBeUndefined();
    expect(address("10.20.1.255")).toBeUndefined();
    expect(address("10.20.1.1")).toMatchObject({
      status: "active",
      hostname: "Firewall Nord",
      deviceType: "firewall",
    });
    expect(address("10.20.1.2")).toMatchObject({
      status: "reserved",
      hostname: null,
      description: "Netzwerkkomponente",
    });
    expect(address("10.20.1.3")).toBeUndefined();
    expect(address("10.20.1.11")?.deviceType).toBe("access_point");
    expect(address("10.20.1.12")).toMatchObject({
      macAddress: "00:07:cc:00:00:01",
      dnsName: "door-ctl.example.test",
      description: null,
    });
    expect(address("10.20.1.13")).toMatchObject({
      hostname: "intranet.example.test",
      description: "Web · Weitere Namen: wiki.example.test",
    });
    // DHCP placeholders become the prefix range, not addresses.
    expect(address("10.20.1.100")).toBeUndefined();
    expect(address("10.20.1.200")?.status).toBe("reserved");
    expect(address("10.20.1.204")?.status).toBe("reserved");
    // A field that looks like a password is never imported.
    expect(address("10.20.1.205")?.description ?? "").not.toContain("geheim");
    expect(JSON.stringify(batch)).not.toContain("geheim123");
  });

  it("creates prefixes from public blocks", () => {
    expect(prefix("192.0.2.8/29")).toMatchObject({
      site: "NORD",
      vlanNumber: 4002,
      securityZone: "OUTSIDE",
    });
    expect(prefix("198.51.100.0/29")?.vlanNumber).toBeNull();
    expect(address("192.0.2.9")).toMatchObject({
      hostname: "Provider Router",
      deviceType: "router",
    });
    expect(address("192.0.2.15")).toBeUndefined();
  });

  it("reads old last-octet sheets and skips columns without subnet", () => {
    expect(address("10.20.4.1")).toMatchObject({
      deviceType: "gateway",
      hostname: null,
      tags: ["alt"],
    });
    expect(address("10.20.4.2")).toMatchObject({
      hostname: "S002",
      description: "ESX Host · Bereich: Server",
    });
    expect(address("10.20.4.4")).toBeUndefined();
    expect(address("10.20.4.5")?.status).toBe("reserved");
    // «siehe / Aula / Tab» is a note.
    expect(address("10.20.5.1")).toBeUndefined();
    expect(address("10.20.5.2")).toBeUndefined();
    expect(address("10.20.5.6")).toMatchObject({
      hostname: null,
      description: "Licht Saal · Bereich: Aula / Steuerung",
    });
    // 10.20.5.0/24 is inside the /16 container → no extra prefix.
    expect(prefix("10.20.5.0/24")).toBeUndefined();
    expect(
      batch.addresses.some((entry) => entry.address.startsWith("172.31.")),
    ).toBe(false);
    expect(
      batch.issues.some((issue) =>
        issue.message.includes("Spalte «BackupNetz» übersprungen"),
      ),
    ).toBe(true);
  });

  it("skips templates and the sheet with secrets", () => {
    expect(batch.skippedSheets.map((entry) => entry.sheet)).toEqual([
      "Template",
      "Aula IP Liste",
      "Tabelle1",
    ]);
    expect(address("10.0.0.5")).toBeUndefined();
  });

  it("counts entries", () => {
    const counts = batchCounts(batch);
    expect(counts.sites).toBe(2);
    expect(counts.prefixes).toBe(batch.prefixes.length);
    expect(counts.errors).toBeGreaterThan(0);
  });
});

describe("switch and access point lists", () => {
  const switches: Workbook = {
    Nord: [
      [
        "Standort",
        "IP Adresse",
        "Bezeichnung",
        "Switch",
        "GbE Ports",
        "Bemerkungen",
      ],
      ["Haus A EG", "10.20.1.08", "SW001", "Aruba 2930F-24G", 24, "EOL!"],
      ["Haus B", "10.20.1.9", "SW002", "HP 2530-24G", 24, null],
      [null, null, null, null, null, null],
    ],
    Leer: [["Standort", "IP Adresse", "Bezeichnung", "Switch"]],
  };
  const aps: Workbook = {
    Haus: [
      [
        "Gebäude",
        "Standort",
        "UKV Link",
        "Switch",
        "AP Nr.",
        "MAC Adresse",
        "Serien Nummer",
        "Installiert",
      ],
      [
        "Haus A",
        "Korridor",
        "1.1.2",
        "HA SW001",
        "AP001",
        "0011223344AA",
        "SN0001",
        "JA",
      ],
      [null, "Büro", null, null, "AP002", "0011223344BB", "SN0002", "nein"],
      ["Haus A", "Lager", null, null, "AP003", "kaputt", "SN0001", "JA"],
      [null, null, null, null, null, null, null, null],
    ],
    Material: [
      ["Bezeichnung", "Anzahl"],
      ["Halterung", 3],
    ],
  };

  it("detects both lists", () => {
    expect(detectSource(switches)).toBe("switch_list");
    expect(detectSource(aps)).toBe("aruba_ap");
  });

  it("creates switch addresses and devices", () => {
    const batch = parseWorkbook("switch_list", switches);
    expect(batch.addresses.map((entry) => entry.address)).toEqual([
      "10.20.1.8",
      "10.20.1.9",
    ]);
    expect(batch.addresses[0]).toMatchObject({
      hostname: "SW001",
      deviceType: "switch",
    });
    expect(batch.devices[0]).toMatchObject({
      name: "SW001",
      category: "switch",
      ipAddress: "10.20.1.8",
      manufacturer: "HPE Aruba",
      model: "Aruba 2930F-24G",
      location: "Haus A EG",
    });
    expect(batch.devices[0]!.notes).toContain("GbE Ports: 24");
    expect(batch.skippedSheets).toEqual([
      { sheet: "Leer", reason: "Keine Einträge" },
    ]);
  });

  it("creates access points without IP", () => {
    const batch = parseWorkbook("aruba_ap", aps);
    expect(batch.addresses).toHaveLength(0);
    expect(batch.devices.map((device) => device.name)).toEqual([
      "AP001",
      "AP002",
    ]);
    expect(batch.devices[0]).toMatchObject({
      category: "access_point",
      macAddress: "00:11:22:33:44:aa",
      serialNumber: "SN0001",
      uplink: "HA SW001",
      location: "Haus A",
    });
    expect(batch.devices[1]).toMatchObject({
      location: "Haus A",
      lifecycleState: "stock",
    });
    // Duplicate serial is left out.
    expect(
      batch.issues.some(
        (issue) =>
          issue.severity === "error" && issue.message.includes("AP003"),
      ),
    ).toBe(true);
    expect(batch.skippedSheets.map((entry) => entry.sheet)).toEqual([
      "Material",
    ]);
  });
});

describe("tables: generic, phpIPAM, NetBox", () => {
  it("imports a generic CSV with guessed mapping", () => {
    const workbook = workbookFromCsv(
      "IP;Hostname;MAC;Status;Bemerkung\n192.0.2.10;drucker-1;00-11-22-33-44-55;reserviert;Etage 2\n192.0.2.300;kaputt;;;\n",
      "Liste",
    );
    expect(detectSource(workbook)).toBe("generic");
    const batch = parseWorkbook("generic", workbook);
    expect(batch.addresses).toHaveLength(1);
    expect(batch.addresses[0]).toMatchObject({
      address: "192.0.2.10",
      hostname: "drucker-1",
      macAddress: "00:11:22:33:44:55",
      status: "reserved",
      description: "Etage 2",
      deviceType: "printer",
    });
    expect(
      batch.issues.find((issue) => issue.severity === "error")?.message,
    ).toContain("192.0.2.300");
  });

  it("uses an explicit mapping and target", () => {
    const workbook: Workbook = {
      Netze: [
        ["Netz", "Maske", "Ort", "VLAN"],
        ["10.40.0.0", "255.255.255.0", "West", "Mgmt (40)"],
        ["10.40.1.0", 24, "West", 41],
      ],
    };
    const batch = parseWorkbook("generic", workbook, {
      sheet: "Netze",
      target: "prefixes",
      mapping: { prefix: 0, length: 1, site: 2, vlan: 3 },
    });
    expect(batch.prefixes.map((entry) => entry.prefix)).toEqual([
      "10.40.0.0/24",
      "10.40.1.0/24",
    ]);
    expect(batch.vlans.map((vlan) => [vlan.number, vlan.name])).toEqual([
      [40, "Mgmt"],
      [41, "VLAN 41"],
    ]);
    expect(batch.sites.map((site) => site.name)).toEqual(["West"]);
  });

  it("reads phpIPAM exports (decimal addresses, states)", () => {
    const subnets = workbookFromCsv(
      "subnet,mask,description,vlan\n10.50.0.0,24,Clients,50\n10.50.1.0,23,falsch,\n",
    );
    expect(detectSource(subnets)).toBe("phpipam");
    const subnetBatch = parseWorkbook("phpipam", subnets);
    expect(subnetBatch.prefixes.map((entry) => entry.prefix)).toEqual([
      "10.50.0.0/24",
      "10.50.0.0/23",
    ]);
    const addresses = workbookFromCsv(
      "ip_addr,hostname,mac,state,note\n171048961,pc-1,aa:bb:cc:dd:ee:ff,Reserved,Test\n10.50.0.2,pc-2,,Used,\n",
    );
    const addressBatch = parseWorkbook("phpipam", addresses);
    expect(
      addressBatch.addresses.map((entry) => [entry.address, entry.status]),
    ).toEqual([
      ["10.50.0.1", "reserved"],
      ["10.50.0.2", "active"],
    ]);
  });

  it("reads NetBox exports", () => {
    const prefixes = workbookFromCsv(
      "prefix,status,vrf,site,vlan,description\n10.60.0.0/16,container,,Zentrale,,Summary\n10.60.1.0/24,active,PROD,Zentrale,Server (61),Server\n",
    );
    expect(detectSource(prefixes)).toBe("netbox");
    const prefixBatch = parseWorkbook("netbox", prefixes);
    expect(
      prefixBatch.prefixes.map((entry) => [
        entry.prefix,
        entry.status,
        entry.vrf,
      ]),
    ).toEqual([
      ["10.60.0.0/16", "container", null],
      ["10.60.1.0/24", "active", "PROD"],
    ]);
    expect(prefixBatch.vlans[0]).toMatchObject({
      number: 61,
      name: "Server",
      site: "Zentrale",
    });
    const addresses = workbookFromCsv(
      "address,vrf,status,dns_name,description\n10.60.1.5/24,PROD,dhcp,srv5.example.test,Web\n",
    );
    const addressBatch = parseWorkbook("netbox", addresses);
    expect(addressBatch.addresses[0]).toMatchObject({
      address: "10.60.1.5",
      vrf: "PROD",
      status: "dhcp",
      dnsName: "srv5.example.test",
    });
    const vlans = workbookFromCsv(
      "vid,name,site,description\n70,Voice,Zentrale,Telefone\n5000,Zu gross,,\n",
    );
    const vlanBatch = parseWorkbook("netbox", vlans);
    expect(vlanBatch.vlans).toHaveLength(1);
    expect(vlanBatch.vlans[0]).toMatchObject({
      number: 70,
      name: "Voice",
      site: "Zentrale",
      description: "Telefone",
    });
  });
});

describe("transport helpers", () => {
  it("chunks included rows and strips origins", () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      key: `k${index}`,
      origin: { sheet: "A", row: index },
    }));
    const chunks = chunkRows(rows, new Set(["k1"]), 2);
    expect(chunks.map((chunk) => chunk.map((row) => row.key))).toEqual([
      ["k0", "k2"],
      ["k3", "k4"],
    ]);
    expect(wireRow(rows[0]!)).toEqual({ key: "k0" });
  });

  it("converts read-excel-file sheets", () => {
    const workbook = workbookFromSheets([
      {
        name: "A",
        rows: [[new Date("2024-02-01T00:00:00Z"), 1, null, undefined]],
      },
    ]);
    expect(workbook.A).toEqual([["2024-02-01", 1, null, null]]);
  });
});
