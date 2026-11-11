/** SNMP v2c/v3 collection (read-only walks) with net-snmp. */

import snmp, { type Session, type User } from "net-snmp";

import {
  type LocalConfig,
  type ServerConfig,
  snmpCredentialFor,
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
      `Keine SNMP-Zugangsdaten (${target.version}) für ${target.host} in config.json`,
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
