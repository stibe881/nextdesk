/**
 * Connections of a device: per port the LLDP neighbour and the MAC addresses
 * learned there. Pure mapping of what `listInterfaces` and `collectSnmp`
 * return; tested with node:test.
 */

import type { LldpNeighbor, MacTableEntry } from "./reports.ts";
import type { InterfaceInfo } from "./snmp.ts";

/** MAC addresses kept per port. Ports with more are uplinks or trunks. */
export const MACS_PER_PORT = 8;
export const MAX_PORTS = 600;

export type TopologyPort = {
  port: string;
  index: number | null;
  alias: string | null;
  up: boolean | null;
  speedMbps: number | null;
  lldp: {
    name: string | null;
    port: string | null;
    address: string | null;
    mac: string | null;
  } | null;
  macs: string[];
  macCount: number;
};

export type Topology = { sysName: string | null; ports: TopologyPort[] };

/**
 * Joins interfaces, LLDP neighbours and the MAC table by port name. Ports
 * that only appear in LLDP or the MAC table (name differs from ifName) are
 * appended, so nothing the switch reports gets lost.
 */
export function buildTopology(input: {
  sysName: string | null;
  interfaces: readonly InterfaceInfo[];
  lldp: readonly LldpNeighbor[];
  macTable: readonly MacTableEntry[];
}): Topology {
  const ports = new Map<string, TopologyPort>();
  const key = (name: string) => name.trim().toLowerCase();
  const port = (name: string): TopologyPort => {
    const existing = ports.get(key(name));
    if (existing) return existing;
    const created: TopologyPort = {
      port: name.trim().slice(0, 80),
      index: null,
      alias: null,
      up: null,
      speedMbps: null,
      lldp: null,
      macs: [],
      macCount: 0,
    };
    ports.set(key(name), created);
    return created;
  };
  for (const entry of input.interfaces) {
    const row = port(entry.name);
    row.index = entry.index;
    row.alias = entry.alias;
    row.up = entry.up;
    row.speedMbps = entry.speedMbps;
  }
  for (const neighbor of input.lldp) {
    if (!neighbor.localPort) continue;
    const row = port(neighbor.localPort);
    // First neighbour wins; a port with several is a shared segment.
    row.lldp ??= {
      name: neighbor.sysName,
      port: neighbor.portId,
      address: neighbor.mgmtAddress,
      mac: neighbor.chassisMac,
    };
  }
  const seen = new Set<string>();
  for (const entry of input.macTable) {
    if (!entry.port || !entry.mac) continue;
    // The same MAC shows once per VLAN.
    const id = `${key(entry.port)}|${entry.mac}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const row = port(entry.port);
    row.macCount += 1;
    if (row.macs.length < MACS_PER_PORT) row.macs.push(entry.mac);
  }
  return {
    sysName: input.sysName,
    ports: [...ports.values()].slice(0, MAX_PORTS),
  };
}
