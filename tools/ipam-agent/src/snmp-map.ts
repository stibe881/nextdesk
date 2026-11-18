/**
 * Mapping of SNMP varbinds (already walked) to ARP entries, MAC table (FDB)
 * entries and LLDP neighbours. Pure functions, tested with node:test.
 *
 * MIBs: IP-MIB ipNetToMediaPhysAddress / ipNetToPhysicalPhysAddress,
 * BRIDGE-MIB dot1dBasePortIfIndex / dot1dTpFdbPort, Q-BRIDGE-MIB
 * dot1qTpFdbPort / dot1qTpFdbStatus, IF-MIB ifName, LLDP-MIB lldpRemTable,
 * lldpLocPortTable, lldpRemManAddrTable. Works with Aruba AOS-CX
 * (6300/6000), AOS-S (2930F) and older HP ProCurve.
 */

import {
  canonicalIp,
  isUsefulAddress,
  macFromBytes,
  normalizeMac,
} from "./net.ts";

export const OID = {
  sysName: "1.3.6.1.2.1.1.5.0",
  ifName: "1.3.6.1.2.1.31.1.1.1.1",
  ipNetToMediaPhysAddress: "1.3.6.1.2.1.4.22.1.2",
  ipNetToPhysicalPhysAddress: "1.3.6.1.2.1.4.35.1.4",
  dot1dBasePortIfIndex: "1.3.6.1.2.1.17.1.4.1.2",
  dot1dTpFdbPort: "1.3.6.1.2.1.17.4.3.1.2",
  dot1qTpFdbPort: "1.3.6.1.2.1.17.7.1.2.2.1.2",
  dot1qTpFdbStatus: "1.3.6.1.2.1.17.7.1.2.2.1.3",
  lldpLocPortTable: "1.0.8802.1.1.2.1.3.7.1",
  lldpRemTable: "1.0.8802.1.1.2.1.4.1.1",
  lldpRemManAddrTable: "1.0.8802.1.1.2.1.4.2.1",
} as const;

export type Varbind = { oid: string; value: unknown };

/** OID suffix after a column prefix, as numbers; null if not below it. */
export function oidIndex(oid: string, prefix: string): number[] | null {
  const normalized = oid.replace(/^\./, "");
  if (!normalized.startsWith(`${prefix}.`)) return null;
  const parts = normalized
    .slice(prefix.length + 1)
    .split(".")
    .map(Number);
  return parts.every((part) => Number.isInteger(part) && part >= 0)
    ? parts
    : null;
}

function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number"))
    return Uint8Array.from(value);
  return null;
}

/** Display string from an OCTET STRING (printable) or null. */
export function octetText(value: unknown): string | null {
  const bytes = bytesOf(value);
  const text = bytes
    ? Buffer.from(bytes).toString("utf8")
    : typeof value === "string"
      ? value
      : null;
  if (text === null) return null;
  const cleaned = text.replace(/\0+$/, "").trim();
  return cleaned && /^[\x20-\x7e -￿]+$/.test(cleaned)
    ? cleaned.slice(0, 160)
    : null;
}

function macOf(value: unknown): string | null {
  const bytes = bytesOf(value);
  if (bytes) return macFromBytes(bytes);
  return typeof value === "string" ? normalizeMac(value) : null;
}

function intOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return null;
}

export type ArpEntry = { ifIndex: number; address: string; mac: string };

/** ipNetToMediaPhysAddress.<ifIndex>.<a>.<b>.<c>.<d> = MAC */
export function mapIpNetToMedia(varbinds: readonly Varbind[]): ArpEntry[] {
  const entries: ArpEntry[] = [];
  for (const varbind of varbinds) {
    const index = oidIndex(varbind.oid, OID.ipNetToMediaPhysAddress);
    if (!index || index.length !== 5) continue;
    const [ifIndex, ...octets] = index as [number, ...number[]];
    const address = canonicalIp(octets.join("."));
    const mac = macOf(varbind.value);
    if (!address || !mac || !isUsefulAddress(address)) continue;
    entries.push({ ifIndex, address, mac });
  }
  return entries;
}

/** ipNetToPhysicalPhysAddress.<ifIndex>.<type>.<len>.<bytes…> = MAC (IPv4 and IPv6). */
export function mapIpNetToPhysical(varbinds: readonly Varbind[]): ArpEntry[] {
  const entries: ArpEntry[] = [];
  for (const varbind of varbinds) {
    const index = oidIndex(varbind.oid, OID.ipNetToPhysicalPhysAddress);
    if (!index || index.length < 3) continue;
    const [ifIndex = 0, type, length, ...bytes] = index;
    if (bytes.length !== length) continue;
    let address: string | null = null;
    if (type === 1 && length === 4) address = canonicalIp(bytes.join("."));
    if (type === 2 && length === 16) {
      const groups: string[] = [];
      for (let offset = 0; offset < 16; offset += 2) {
        groups.push(
          (((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)).toString(16),
        );
      }
      address = canonicalIp(groups.join(":"));
    }
    const mac = macOf(varbind.value);
    if (!address || !mac || !isUsefulAddress(address)) continue;
    entries.push({ ifIndex, address, mac });
  }
  return entries;
}

/** Map column index → value for a single-index column (ifName, basePort → ifIndex). */
export function mapColumn<T>(
  varbinds: readonly Varbind[],
  prefix: string,
  read: (value: unknown) => T | null,
) {
  const map = new Map<number, T>();
  for (const varbind of varbinds) {
    const index = oidIndex(varbind.oid, prefix);
    if (!index || index.length !== 1) continue;
    const value = read(varbind.value);
    if (value !== null) map.set(index[0]!, value);
  }
  return map;
}

export const mapIfNames = (varbinds: readonly Varbind[]) =>
  mapColumn(varbinds, OID.ifName, octetText);
export const mapBasePorts = (varbinds: readonly Varbind[]) =>
  mapColumn(varbinds, OID.dot1dBasePortIfIndex, intOf);

export type FdbEntry = { mac: string; basePort: number; vlan: number | null };

/**
 * Q-BRIDGE dot1qTpFdbPort.<fdbId>.<mac 6 bytes> = basePort (fdbId = VLAN on
 * Aruba/ProCurve). Entries with status «self» (4) or port 0 are skipped.
 */
export function mapQBridgeFdb(
  ports: readonly Varbind[],
  statuses: readonly Varbind[] = [],
): FdbEntry[] {
  const status = new Map<string, number>();
  for (const varbind of statuses) {
    const index = oidIndex(varbind.oid, OID.dot1qTpFdbStatus);
    const value = intOf(varbind.value);
    if (index && value !== null) status.set(index.join("."), value);
  }
  const entries: FdbEntry[] = [];
  for (const varbind of ports) {
    const index = oidIndex(varbind.oid, OID.dot1qTpFdbPort);
    if (!index || index.length !== 7) continue;
    const [fdbId, ...macBytes] = index as [number, ...number[]];
    const basePort = intOf(varbind.value);
    const mac = macFromBytes(macBytes);
    if (!mac || !basePort || status.get(index.join(".")) === 4) continue;
    entries.push({
      mac,
      basePort,
      vlan: fdbId >= 1 && fdbId <= 4094 ? fdbId : null,
    });
  }
  return entries;
}

/** BRIDGE-MIB dot1dTpFdbPort.<mac 6 bytes> = basePort (switches without Q-BRIDGE). */
export function mapBridgeFdb(ports: readonly Varbind[]): FdbEntry[] {
  const entries: FdbEntry[] = [];
  for (const varbind of ports) {
    const index = oidIndex(varbind.oid, OID.dot1dTpFdbPort);
    if (!index || index.length !== 6) continue;
    const basePort = intOf(varbind.value);
    const mac = macFromBytes(index);
    if (!mac || !basePort) continue;
    entries.push({ mac, basePort, vlan: null });
  }
  return entries;
}

/** Bridge port → interface name via dot1dBasePortIfIndex and ifName. */
export function fdbPortName(
  basePort: number,
  basePorts: Map<number, number>,
  ifNames: Map<number, string>,
): string {
  const ifIndex = basePorts.get(basePort) ?? basePort;
  return ifNames.get(ifIndex) ?? String(basePort);
}

const CAPABILITY_NAMES = [
  "other",
  "repeater",
  "bridge",
  "wlanAccessPoint",
  "router",
  "telephone",
  "docsisCableDevice",
  "station",
] as const;

/** LLDP system capabilities (BITS, first octet MSB = bit 0). */
export function decodeCapabilities(value: unknown): string[] {
  const bytes = bytesOf(value);
  if (!bytes || !bytes.length) return [];
  return CAPABILITY_NAMES.filter(
    (_, bit) => ((bytes[Math.floor(bit / 8)] ?? 0) & (0x80 >> (bit % 8))) !== 0,
  );
}

export type LldpNeighborRaw = {
  localPortNum: number;
  chassisMac: string | null;
  sysName: string | null;
  portId: string | null;
  mgmtAddress: string | null;
  capabilities: string[];
};

/**
 * lldpRemTable columns (index timeMark.localPortNum.remIndex):
 * 4 chassisIdSubtype, 5 chassisId, 6 portIdSubtype, 7 portId, 9 sysName,
 * 12 sysCapEnabled. Management IPv4 from lldpRemManAddrTable index.
 */
export function mapLldpRemote(
  remote: readonly Varbind[],
  manAddr: readonly Varbind[] = [],
): LldpNeighborRaw[] {
  const rows = new Map<string, Map<number, unknown>>();
  for (const varbind of remote) {
    const index = oidIndex(varbind.oid, OID.lldpRemTable);
    if (!index || index.length !== 4) continue;
    const [column, ...rowIndex] = index as [number, ...number[]];
    const key = rowIndex.join(".");
    const row = rows.get(key) ?? new Map<number, unknown>();
    row.set(column, varbind.value);
    rows.set(key, row);
  }
  const mgmt = new Map<string, string>();
  for (const varbind of manAddr) {
    const index = oidIndex(varbind.oid, OID.lldpRemManAddrTable);
    // column.timeMark.localPort.remIndex.addrSubtype.addrLen.addr…
    if (!index || index.length < 6) continue;
    const [, timeMark, localPort, remIndex, subtype, length, ...bytes] = index;
    if (subtype !== 1 || length !== 4 || bytes.length !== 4) continue;
    const address = canonicalIp(bytes.join("."));
    if (address && isUsefulAddress(address))
      mgmt.set(`${timeMark}.${localPort}.${remIndex}`, address);
  }
  const neighbors: LldpNeighborRaw[] = [];
  for (const [key, row] of rows) {
    const [, localPortNum] = key.split(".").map(Number);
    if (localPortNum === undefined) continue;
    const chassisSubtype = intOf(row.get(4));
    const portSubtype = intOf(row.get(6));
    neighbors.push({
      localPortNum,
      chassisMac: chassisSubtype === 4 ? macOf(row.get(5)) : null,
      sysName: octetText(row.get(9)),
      portId: portSubtype === 3 ? macOf(row.get(7)) : octetText(row.get(7)),
      mgmtAddress: mgmt.get(key) ?? null,
      capabilities: decodeCapabilities(row.get(12)),
    });
  }
  return neighbors.sort((a, b) => a.localPortNum - b.localPortNum);
}

/** lldpLocPortTable column 3 (lldpLocPortId) per local port number. */
export function mapLldpLocalPorts(
  varbinds: readonly Varbind[],
): Map<number, string> {
  const map = new Map<number, string>();
  for (const varbind of varbinds) {
    const index = oidIndex(varbind.oid, OID.lldpLocPortTable);
    if (!index || index.length !== 2 || index[0] !== 3) continue;
    const text = octetText(varbind.value);
    if (text) map.set(index[1]!, text);
  }
  return map;
}

/**
 * Name of an LLDP local port, consistent with the FDB port names (ifName):
 * lldpLocPortId if it is an ifName, else ifName of the same number, else
 * the port id or the number.
 */
export function lldpPortName(
  localPortNum: number,
  localPorts: Map<number, string>,
  ifNames: Map<number, string>,
): string {
  const portId = localPorts.get(localPortNum);
  const names = new Set(ifNames.values());
  if (portId && names.has(portId)) return portId;
  return ifNames.get(localPortNum) ?? portId ?? String(localPortNum);
}
