/** SNMP v2c/v3 collection (read-only walks) with net-snmp. */

import snmp, { type Session, type User } from "net-snmp";

import {
  type LocalConfig,
  type ServerConfig,
  snmpCredentialFor,
  snmpCredentialOf,
} from "./config.ts";
import { log } from "./log.ts";
import type { LldpNeighbor, MacTableEntry } from "./reports.ts";
import {
  type ArpEntry,
  fdbPortName,
  lldpPortName,
  mapBasePorts,
  mapBridgeFdb,
  mapIfNames,
  mapIpNetToMedia,
  mapIpNetToPhysical,
  mapLldpLocalPorts,
  mapLldpRemote,
  mapQBridgeFdb,
  octetText,
  OID,
  type Varbind,
} from "./snmp-map.ts";

type Target = ServerConfig["snmpTargets"][number];

export type SnmpResult = {
  host: string;
  switchName: string;
  arp: ArpEntry[];
  macTable: MacTableEntry[];
  lldp: LldpNeighbor[];
};

function session(config: LocalConfig, target: Target): Session {
  const credential = snmpCredentialFor(config, target.host, target.version);
  if (!credential) {
    throw new Error(
      `Keine SNMP-Zugangsdaten (${target.version}) für ${target.host} (weder in nextDesk noch in config.json)`,
    );
  }
  const options = {
    timeout: config.snmp.timeoutMs,
    retries: config.snmp.retries,
    transport: target.host.includes(":")
      ? ("udp6" as const)
      : ("udp4" as const),
  };
  if (credential.version === "v2c") {
    return snmp.createSession(target.host, credential.community, {
      ...options,
      version: snmp.Version2c,
    });
  }
  const level = credential.privProtocol
    ? snmp.SecurityLevel.authPriv
    : credential.authProtocol
      ? snmp.SecurityLevel.authNoPriv
      : snmp.SecurityLevel.noAuthNoPriv;
  const user: User = { name: credential.user, level };
  if (credential.authProtocol && credential.authKey) {
    user.authProtocol = snmp.AuthProtocols[credential.authProtocol];
    user.authKey = credential.authKey;
  }
  if (credential.privProtocol && credential.privKey) {
    user.privProtocol = snmp.PrivProtocols[credential.privProtocol];
    user.privKey = credential.privKey;
  }
  return snmp.createV3Session(target.host, user, {
    ...options,
    version: snmp.Version3,
  });
}

/**
 * Session for a host with whatever credential config.json holds for it
 * (own entry, else the default). Used by the monitoring sensors, where
 * nextDesk does not prescribe the SNMP version.
 */
export function openSession(config: LocalConfig, host: string): Session {
  const credential = snmpCredentialOf(config, host);
  if (!credential) {
    throw new Error(
      `Keine SNMP-Zugangsdaten für ${host} (weder in nextDesk noch in config.json)`,
    );
  }
  return session(config, {
    host,
    version: credential.version,
    user: null,
    authProtocol: null,
    privProtocol: null,
    collect: [],
  });
}

/**
 * LLDP neighbours and MAC table of a host with the credential config.json
 * holds for it (connections of a monitored device).
 */
export function collectLinks(
  config: LocalConfig,
  host: string,
): Promise<SnmpResult> {
  const credential = snmpCredentialOf(config, host);
  if (!credential) {
    throw new Error(
      `Keine SNMP-Zugangsdaten für ${host} (weder in nextDesk noch in config.json)`,
    );
  }
  return collectSnmp(config, {
    host,
    version: credential.version,
    user: null,
    authProtocol: null,
    privProtocol: null,
    collect: ["fdb", "lldp"],
  });
}

export type SnmpValue = { oid: string; value: unknown; type: number } | null;

/** GET of a few OIDs; an entry is null when the device has no such object. */
export function snmpGet(
  current: Session,
  oids: readonly string[],
): Promise<SnmpValue[]> {
  return new Promise((resolve, reject) => {
    current.get([...oids], (error, varbinds) => {
      if (error) return reject(error);
      resolve(
        oids.map((_oid, index) => {
          const varbind = varbinds[index];
          if (!varbind || snmp.isVarbindError(varbind)) return null;
          return {
            oid: varbind.oid,
            value: varbind.value,
            type: varbind.type as number,
          };
        }),
      );
    });
  });
}

export type InterfaceInfo = {
  index: number;
  name: string;
  alias: string | null;
  up: boolean;
  speedMbps: number | null;
};

const IF_OID = {
  descr: "1.3.6.1.2.1.2.2.1.2",
  operStatus: "1.3.6.1.2.1.2.2.1.8",
  name: "1.3.6.1.2.1.31.1.1.1.1",
  highSpeed: "1.3.6.1.2.1.31.1.1.1.15",
  alias: "1.3.6.1.2.1.31.1.1.1.18",
};

function lastIndex(oid: string): number {
  return Number(oid.slice(oid.lastIndexOf(".") + 1));
}

/** Rows of the interface table from the walked columns (pure). */
export function mapInterfaces(columns: {
  descr: Varbind[];
  name: Varbind[];
  alias: Varbind[];
  operStatus: Varbind[];
  highSpeed: Varbind[];
}): InterfaceInfo[] {
  const text = (rows: Varbind[]) =>
    new Map(
      rows.map((row) => [
        lastIndex(row.oid),
        octetText(row.value)?.trim() ?? "",
      ]),
    );
  const number = (rows: Varbind[]) =>
    new Map(rows.map((row) => [lastIndex(row.oid), Number(row.value)]));
  const names = text(columns.name);
  const descriptions = text(columns.descr);
  const aliases = text(columns.alias);
  const status = number(columns.operStatus);
  const speed = number(columns.highSpeed);
  const indexes = new Set([...names.keys(), ...descriptions.keys()]);
  return [...indexes]
    .filter((index) => Number.isInteger(index) && index > 0)
    .sort((a, b) => a - b)
    .map((index) => ({
      index,
      name: (
        names.get(index) ||
        descriptions.get(index) ||
        `Port ${index}`
      ).slice(0, 80),
      alias: aliases.get(index)?.slice(0, 80) || null,
      up: status.get(index) === 1,
      speedMbps:
        Number.isFinite(speed.get(index)) && (speed.get(index) ?? 0) > 0
          ? (speed.get(index) as number)
          : null,
    }));
}

/** Interfaces of a device (for choosing ports of traffic sensors). */
export async function listInterfaces(
  config: LocalConfig,
  host: string,
): Promise<InterfaceInfo[]> {
  const current = openSession(config, host);
  try {
    const descr = await walk(current, IF_OID.descr, 5000);
    const [name, alias, operStatus, highSpeed] = await Promise.all([
      optionalWalk(current, IF_OID.name),
      optionalWalk(current, IF_OID.alias),
      optionalWalk(current, IF_OID.operStatus),
      optionalWalk(current, IF_OID.highSpeed),
    ]);
    return mapInterfaces({ descr, name, alias, operStatus, highSpeed });
  } finally {
    current.close();
  }
}

function walk(
  current: Session,
  oid: string,
  limit = 200000,
): Promise<Varbind[]> {
  return new Promise((resolve, reject) => {
    const varbinds: Varbind[] = [];
    current.subtree(
      oid,
      20,
      (batch) => {
        for (const varbind of batch) {
          if (snmp.isVarbindError(varbind)) continue;
          varbinds.push({ oid: varbind.oid, value: varbind.value });
        }
        return varbinds.length >= limit;
      },
      (error) => (error ? reject(error) : resolve(varbinds)),
    );
  });
}

/** Walk that returns [] on errors (e.g. MIB not supported). */
async function optionalWalk(current: Session, oid: string): Promise<Varbind[]> {
  try {
    return await walk(current, oid);
  } catch (error) {
    log.debug(`SNMP-Abfrage ${oid} nicht verfügbar`, error);
    return [];
  }
}

function getSysName(current: Session): Promise<string | null> {
  return new Promise((resolve) => {
    current.get([OID.sysName], (error, varbinds) => {
      if (error || !varbinds[0] || snmp.isVarbindError(varbinds[0]))
        return resolve(null);
      resolve(octetText(varbinds[0].value));
    });
  });
}

export async function collectSnmp(
  config: LocalConfig,
  target: Target,
): Promise<SnmpResult> {
  const current = session(config, target);
  current.on("error", (error) =>
    log.warn(`SNMP-Fehler bei ${target.host}`, error),
  );
  try {
    const sysName = await getSysName(current);
    if (sysName === null) {
      // First request decides: no answer = wrong credentials, ACL or unreachable.
      throw new Error(
        `${target.host} antwortet nicht auf SNMP (Zugangsdaten, ACL, Firewall prüfen)`,
      );
    }
    const switchName = sysName || target.host;
    const ifNames = mapIfNames(await optionalWalk(current, OID.ifName));
    const result: SnmpResult = {
      host: target.host,
      switchName,
      arp: [],
      macTable: [],
      lldp: [],
    };

    if (target.collect.includes("arp")) {
      const physical = mapIpNetToPhysical(
        await optionalWalk(current, OID.ipNetToPhysicalPhysAddress),
      );
      const media = physical.length
        ? []
        : mapIpNetToMedia(
            await optionalWalk(current, OID.ipNetToMediaPhysAddress),
          );
      result.arp = [...physical, ...media];
    }
    if (target.collect.includes("fdb")) {
      const basePorts = mapBasePorts(
        await optionalWalk(current, OID.dot1dBasePortIfIndex),
      );
      let fdb = mapQBridgeFdb(
        await optionalWalk(current, OID.dot1qTpFdbPort),
        await optionalWalk(current, OID.dot1qTpFdbStatus),
      );
      if (!fdb.length)
        fdb = mapBridgeFdb(await optionalWalk(current, OID.dot1dTpFdbPort));
      result.macTable = fdb.map((entry) => ({
        switchName,
        port: fdbPortName(entry.basePort, basePorts, ifNames),
        mac: entry.mac,
        vlan: entry.vlan,
      }));
    }
    if (target.collect.includes("lldp")) {
      const localPorts = mapLldpLocalPorts(
        await optionalWalk(current, OID.lldpLocPortTable),
      );
      const neighbors = mapLldpRemote(
        await optionalWalk(current, OID.lldpRemTable),
        await optionalWalk(current, OID.lldpRemManAddrTable),
      );
      result.lldp = neighbors.map((neighbor) => ({
        switchName,
        localPort: lldpPortName(neighbor.localPortNum, localPorts, ifNames),
        chassisMac: neighbor.chassisMac,
        sysName: neighbor.sysName,
        portId: neighbor.portId,
        mgmtAddress: neighbor.mgmtAddress,
        capabilities: neighbor.capabilities,
      }));
    }
    return result;
  } finally {
    current.close();
  }
}
