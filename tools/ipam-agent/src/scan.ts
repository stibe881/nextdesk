/** One discovery run: ping sweep, neighbours, SNMP, DHCP/DNS → reports. */

import { readFileSync } from "node:fs";

import type { LocalConfig, ServerConfig, Subnet } from "./config.ts";
import { log } from "./log.ts";
import { cidrContains, type Cidr, ipv4Hosts, parseCidr } from "./net.ts";
import { parseOuiList, type Platform, vendorFromList } from "./parsers.ts";
import { runPowerShell } from "./powershell.ts";
import { localNeighbors, pingSweep, reverseLookup } from "./probe.ts";
import { type Observation, type ScanData } from "./reports.ts";
import { collectSnmp } from "./snmp.ts";

export type ScanTarget = {
  cidr: Cidr;
  prefixId: string | null;
  vrfId: string | null;
  sweep: boolean;
};

/** Subnets to scan: local override (config.json) or nextDesk's list, optionally filtered by prefix ids. */
export function scanTargets(
  local: LocalConfig,
  subnets: readonly Subnet[],
  prefixFilter: readonly string[] = [],
): ScanTarget[] {
  if (local.scan.subnets.length) {
    return local.scan.subnets.flatMap((text) => {
      const cidr = parseCidr(text);
      return cidr
        ? [
            {
              cidr,
              prefixId: null,
              vrfId: null,
              sweep: cidr.family === 4 && cidr.length >= 16,
            },
          ]
        : [];
    });
  }
  return subnets.flatMap((subnet) => {
    if (prefixFilter.length && !prefixFilter.includes(subnet.prefixId))
      return [];
    const cidr = parseCidr(subnet.prefix);
    return cidr
      ? [
          {
            cidr,
            prefixId: subnet.prefixId,
            vrfId: subnet.vrfId,
            sweep: subnet.sweep,
          },
        ]
      : [];
  });
}

/** VRF of the most specific scanned subnet containing the address. */
export function vrfFor(
  targets: readonly ScanTarget[],
  address: string,
): { known: boolean; vrfId: string | null } {
  let best: ScanTarget | null = null;
  for (const target of targets) {
    if (
      cidrContains(target.cidr, address) &&
      (!best || target.cidr.length > best.cidr.length)
    )
      best = target;
  }
  return best
    ? { known: true, vrfId: best.vrfId }
    : { known: false, vrfId: null };
}

let ouiCache: Map<string, string> | null | undefined;
function ouiList(local: LocalConfig): Map<string, string> | null {
  if (ouiCache !== undefined) return ouiCache;
  ouiCache = null;
  if (local.ouiFile) {
    try {
      ouiCache = parseOuiList(readFileSync(local.ouiFile, "utf8"));
      log.info(`OUI-Liste geladen (${ouiCache.size} Hersteller)`);
    } catch (error) {
      log.warn(`OUI-Liste ${local.ouiFile} nicht lesbar`, error);
    }
  }
  return ouiCache;
}

export type ScanOutcome = {
  data: ScanData;
  stats: Record<string, number>;
  errors: string[];
};

export async function runScan(args: {
  local: LocalConfig;
  server: ServerConfig;
  subnets: readonly Subnet[];
  platform: Platform;
  prefixFilter?: readonly string[];
}): Promise<ScanOutcome> {
  const { local, server, platform } = args;
  const targets = scanTargets(local, args.subnets, args.prefixFilter ?? []);
  const errors: string[] = [];
  const stats: Record<string, number> = {};
  const observations: Observation[] = [];
  const oui = ouiList(local);
  const withVendor = (entry: Observation): Observation => {
    const vendor = entry.mac ? vendorFromList(oui, entry.mac) : null;
    return vendor ? { ...entry, vendor } : entry;
  };

  // 1. Ping sweep (IPv4).
  const hosts: string[] = [];
  for (const target of targets.filter((entry) => entry.sweep)) {
    const remaining = local.scan.maxHostsPerRun - hosts.length;
    if (remaining <= 0) {
      errors.push(
        `Ping-Sweep auf ${local.scan.maxHostsPerRun} Adressen begrenzt`,
      );
      break;
    }
    hosts.push(...ipv4Hosts(target.cidr, remaining));
  }
  const started = Date.now();
  const alive = hosts.length
    ? await pingSweep(
        platform,
        hosts,
        server.pingTimeoutMs,
        server.pingConcurrency,
      )
    : [];
  stats.pinged = hosts.length;
  stats.alive = alive.length;
  stats.pingSeconds = Math.round((Date.now() - started) / 1000);
  log.info(
    `Ping-Sweep: ${alive.length} von ${hosts.length} Adressen antworten`,
  );
  const names =
    local.scan.reverseDns && alive.length
      ? await reverseLookup(alive.slice(0, 5000))
      : new Map<string, string>();
  for (const address of alive) {
    const hostname = names.get(address);
    observations.push({
      address,
      source: "ping",
      vrfId: vrfFor(targets, address).vrfId,
      ...(hostname ? { hostname } : {}),
    });
  }

  // 2. Local neighbour table (only addresses in scanned subnets).
  try {
    const neighbors = await localNeighbors(platform);
    let used = 0;
    for (const neighbor of neighbors) {
      const vrf = vrfFor(targets, neighbor.address);
      if (!vrf.known) continue;
      used += 1;
      observations.push(
        withVendor({
          address: neighbor.address,
          mac: neighbor.mac,
          source: neighbor.family === 6 ? "ndp" : "arp",
          vrfId: vrf.vrfId,
        }),
      );
    }
    stats.neighbors = used;
  } catch (error) {
    errors.push(
      `Nachbartabelle nicht lesbar: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 3. SNMP (ARP, MAC tables, LLDP) per switch/router.
  const macTable: ScanData["macTable"] = [];
  const lldp: ScanData["lldp"] = [];
  let snmpOk = 0;
  for (const target of server.snmpTargets) {
    try {
      const result = await collectSnmp(local, target);
      snmpOk += 1;
      for (const entry of result.arp) {
        const vrf = vrfFor(targets, entry.address);
        observations.push(
          withVendor({
            address: entry.address,
            mac: entry.mac,
            source: "snmp",
            vrfId: vrf.vrfId,
          }),
        );
      }
      macTable.push(...result.macTable);
      lldp.push(...result.lldp);
      log.info(
        `SNMP ${result.switchName}: ${result.arp.length} ARP, ${result.macTable.length} MAC, ${result.lldp.length} LLDP`,
      );
    } catch (error) {
      const message = `SNMP ${target.host}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(message);
      log.warn(message);
    }
  }
  stats.snmpTargets = server.snmpTargets.length;
  stats.snmpOk = snmpOk;
  stats.macEntries = macTable.length;
  stats.lldpNeighbors = lldp.length;

  // 4. Microsoft DHCP/DNS (Windows only).
  const dhcp: ScanData["dhcp"] = [];
  const dns: ScanData["dns"] = [];
  const dhcpServers = local.dhcpServers ?? server.dhcpServers;
  const dnsServers = local.dnsServers ?? server.dnsServers;
  if ((dhcpServers.length || dnsServers.length) && platform !== "win32") {
    errors.push(
      "DHCP/DNS: nur mit dem Agenten auf Windows (PowerShell) möglich",
    );
  } else {
    for (const name of dhcpServers) {
      try {
        const result = (await runPowerShell(local.powershell, "dhcpRead", {
          server: name,
        })) as Record<string, unknown>;
        const scopes = Array.isArray(result?.scopes)
          ? (result.scopes as Record<string, unknown>[])
          : [];
        const leases = Array.isArray(result?.leases)
          ? (result.leases as Record<string, unknown>[])
          : [];
        dhcp.push({ server: name, scopes, leases });
        stats.dhcpScopes = (stats.dhcpScopes ?? 0) + scopes.length;
        stats.dhcpLeases = (stats.dhcpLeases ?? 0) + leases.length;
      } catch (error) {
        errors.push(
          `DHCP ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    for (const name of dnsServers) {
      try {
        const result = await runPowerShell(local.powershell, "dnsRead", {
          server: name,
          zones: server.dnsZones,
        });
        const zones = Array.isArray(result)
          ? (result as Record<string, unknown>[])
          : [];
        for (const zone of zones) {
          if (typeof zone.zone !== "string") continue;
          const records = Array.isArray(zone.records)
            ? (zone.records as Record<string, unknown>[])
            : [];
          dns.push({ server: name, zone: zone.zone, records });
          stats.dnsRecords = (stats.dnsRecords ?? 0) + records.length;
        }
      } catch (error) {
        errors.push(
          `DNS ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  stats.observations = observations.length;
  return { data: { observations, macTable, lldp, dhcp, dns }, stats, errors };
}
