/**
 * Connections of a monitored device: what the probe reports (ports with LLDP
 * neighbour and learned MAC addresses) and how it is matched to devices of
 * the infrastructure and entries of the IP address management.
 */

type Row = Record<string, unknown>;

/** MAC addresses the probe sends per port; ports with more are trunks. */
export const MACS_PER_PORT = 8;
const MAX_PORTS = 600;

function isObject(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // deno-lint-ignore no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/** «aa:bb:cc:dd:ee:ff» from any common notation, else null. */
export function normalizeMac(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12 || /^0{12}$/.test(hex)) return null;
  return hex.match(/.{2}/g)!.join(":");
}

function address(value: unknown): string | null {
  const text = clean(value, 64);
  return text && /^[0-9a-f.:]+$/i.test(text) ? text.toLowerCase() : null;
}

export type StoredPort = {
  port: string;
  index: number | null;
  alias: string | null;
  up: boolean | null;
  speedMbps: number | null;
  lldpName: string | null;
  lldpPort: string | null;
  lldpAddress: string | null;
  lldpMac: string | null;
  macs: string[];
  macCount: number;
};

/** Result of a «snmp_topology» job (untrusted input from the probe). */
export function parseTopology(result: unknown): { sysName: string | null; ports: StoredPort[] } {
  // The probe wraps what a job returns in «output».
  const outer = isObject(result) ? result : {};
  const body = isObject(outer.output) ? outer.output : outer;
  const ports: StoredPort[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(body.ports) ? body.ports.slice(0, MAX_PORTS) : []) {
    if (!isObject(entry)) continue;
    const port = clean(entry.port, 80);
    if (!port || seen.has(port.toLowerCase())) continue;
    seen.add(port.toLowerCase());
    const lldp = isObject(entry.lldp) ? entry.lldp : {};
    const macs = [
      ...new Set(
        (Array.isArray(entry.macs) ? entry.macs : []).map(normalizeMac).filter((mac): mac is string => mac !== null),
      ),
    ].slice(0, MACS_PER_PORT);
    const int = (value: unknown, max: number) =>
      typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max ? value : null;
    ports.push({
      port,
      index: int(entry.index, 2_147_483_647),
      alias: clean(entry.alias, 80),
      up: typeof entry.up === "boolean" ? entry.up : null,
      speedMbps: int(entry.speedMbps, 10_000_000),
      lldpName: clean(lldp.name, 160),
      lldpPort: clean(lldp.port, 160),
      lldpAddress: address(lldp.address),
      lldpMac: normalizeMac(lldp.mac),
      macs,
      macCount: Math.max(int(entry.macCount, 1_000_000) ?? 0, macs.length),
    });
  }
  return { sysName: clean(body.sysName, 160), ports };
}

/** Row of monitoring_device_ports → StoredPort. */
export function portFromRow(row: Row): StoredPort {
  return {
    port: String(row.port),
    index: typeof row.if_index === "number" ? row.if_index : null,
    alias: clean(row.alias, 80),
    up: typeof row.up === "boolean" ? row.up : null,
    speedMbps: row.speed_mbps === null || row.speed_mbps === undefined ? null : Number(row.speed_mbps),
    lldpName: clean(row.neighbor_name, 160),
    lldpPort: clean(row.neighbor_port, 160),
    lldpAddress: address(row.neighbor_address),
    lldpMac: normalizeMac(row.neighbor_mac),
    macs: (Array.isArray(row.macs) ? row.macs : []).map(normalizeMac).filter((mac): mac is string => mac !== null),
    macCount: typeof row.mac_count === "number" ? row.mac_count : 0,
  };
}

export type KnownDevice = {
  assetId: string;
  name: string;
  hostname: string | null;
  ipAddress: string | null;
  mac: string | null;
  monitored: boolean;
};

/** Entry of the IP address management with a MAC address. */
export type KnownAddress = {
  mac: string;
  address: string;
  hostname: string | null;
  assetId: string | null;
};

export type Link = {
  source: "lldp" | "mac";
  name: string;
  port: string | null;
  address: string | null;
  mac: string | null;
  assetId: string | null;
  monitored: boolean;
};

export type PortView = {
  port: string;
  alias: string | null;
  up: boolean | null;
  speedMbps: number | null;
  link: Link | null;
  /** Devices seen behind the port (MAC addresses), 0 when unknown. */
  deviceCount: number;
};

/** Host name without domain, lower case: «SW01.muster.local» → «sw01». */
export function shortName(value: string | null): string | null {
  const text = value?.trim().toLowerCase().split(".")[0] ?? "";
  // An IP address is no host name.
  return text && !/^\d+$/.test(text) ? text : null;
}

export function directory(devices: readonly KnownDevice[], addresses: readonly KnownAddress[]) {
  const byId = new Map(devices.map((device) => [device.assetId, device]));
  const byAddress = new Map<string, KnownDevice>();
  const byMac = new Map<string, KnownDevice>();
  const byName = new Map<string, KnownDevice>();
  for (const device of devices) {
    if (device.ipAddress) byAddress.set(device.ipAddress.trim().toLowerCase(), device);
    if (device.mac) byMac.set(device.mac, device);
    for (const name of [shortName(device.name), shortName(device.hostname)]) {
      if (name && !byName.has(name)) byName.set(name, device);
    }
  }
  const addressByMac = new Map<string, KnownAddress>();
  for (const entry of addresses) {
    // An entry linked to a device wins over an unlinked one with the same MAC.
    if (!addressByMac.has(entry.mac) || entry.assetId) addressByMac.set(entry.mac, entry);
  }
  return { byId, byAddress, byMac, byName, addressByMac };
}

type Directory = ReturnType<typeof directory>;

function deviceForMac(mac: string, known: Directory): { device: KnownDevice | null; entry: KnownAddress | null } {
  const entry = known.addressByMac.get(mac) ?? null;
  let device: KnownDevice | null = known.byMac.get(mac) ?? null;
  if (!device && entry?.assetId) device = known.byId.get(entry.assetId) ?? null;
  if (!device && entry) device = known.byAddress.get(entry.address.toLowerCase()) ?? null;
  return { device, entry };
}

/**
 * Who is connected to a port. LLDP names the neighbour itself and wins. The
 * MAC table only counts for ports with few addresses: a port with many is an
 * uplink or trunk, the devices behind it hang on another switch.
 */
export function resolvePort(port: StoredPort, known: Directory, selfId: string): PortView {
  const view: PortView = {
    port: port.port,
    alias: port.alias,
    up: port.up,
    speedMbps: port.speedMbps,
    link: null,
    deviceCount: port.macCount,
  };
  if (port.lldpName || port.lldpAddress || port.lldpMac) {
    const name = shortName(port.lldpName);
    let device: KnownDevice | null = port.lldpAddress ? known.byAddress.get(port.lldpAddress) ?? null : null;
    if (!device && port.lldpMac) device = deviceForMac(port.lldpMac, known).device;
    if (!device && name) device = known.byName.get(name) ?? null;
    view.link = {
      source: "lldp",
      name: device?.name ?? port.lldpName ?? port.lldpAddress ?? port.lldpMac ?? "Unbekannt",
      port: port.lldpPort,
      address: port.lldpAddress ?? device?.ipAddress ?? null,
      mac: port.lldpMac,
      assetId: device && device.assetId !== selfId ? device.assetId : null,
      monitored: device?.monitored ?? false,
    };
    return view;
  }
  if (!port.macs.length || port.macCount > MACS_PER_PORT) return view;
  const candidates = port.macs.map((mac) => ({ mac, ...deviceForMac(mac, known) }));
  // Prefer a device of the infrastructure, then a known address, then the bare MAC.
  const best = candidates.find((entry) => entry.device && entry.device.assetId !== selfId) ??
    candidates.find((entry) => entry.entry) ?? candidates[0]!;
  view.link = {
    source: "mac",
    name: best.device?.name ?? best.entry?.hostname ?? best.entry?.address ?? best.mac,
    port: null,
    address: best.device?.ipAddress ?? best.entry?.address ?? null,
    mac: best.mac,
    assetId: best.device && best.device.assetId !== selfId ? best.device.assetId : null,
    monitored: best.device?.monitored ?? false,
  };
  return view;
}

/** Natural order of port names: 1/1/2 before 1/1/10. */
export function comparePorts(a: string, b: string): number {
  return a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
}

export type Attachment = { assetId: string; name: string; port: string; source: "lldp" | "mac"; monitored: boolean };

/**
 * Where a device hangs: ports of other devices that name it as LLDP
 * neighbour or have learned its MAC address. Access ports (few addresses)
 * come first, trunk ports are left out.
 */
export function attachments(
  rows: readonly (StoredPort & { assetId: string })[],
  self: { assetId: string; name: string; hostname: string | null; ipAddress: string | null; macs: readonly string[] },
  known: Directory,
): Attachment[] {
  const macs = new Set(self.macs);
  const names = new Set([shortName(self.name), shortName(self.hostname)].filter((name): name is string => !!name));
  const found: (Attachment & { rank: number })[] = [];
  for (const row of rows) {
    if (row.assetId === self.assetId) continue;
    const owner = known.byId.get(row.assetId);
    if (!owner) continue;
    const lldp = (row.lldpAddress !== null && row.lldpAddress === self.ipAddress?.trim().toLowerCase()) ||
      (row.lldpMac !== null && macs.has(row.lldpMac)) ||
      (shortName(row.lldpName) !== null && names.has(shortName(row.lldpName)!));
    const mac = !lldp && row.macCount <= MACS_PER_PORT && row.macs.some((entry) => macs.has(entry));
    if (!lldp && !mac) continue;
    found.push({
      assetId: owner.assetId,
      name: owner.name,
      port: row.port,
      source: lldp ? "lldp" : "mac",
      monitored: owner.monitored,
      rank: lldp ? 0 : row.macCount,
    });
  }
  return found.sort((a, b) => a.rank - b.rank || comparePorts(a.port, b.port)).slice(0, 5)
    .map(({ rank: _rank, ...entry }) => entry);
}
