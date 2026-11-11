/**
 * Local configuration (config.json). Contains the nextDesk URL, the agent
 * token and all credentials (SNMP). Nothing of it is sent to nextDesk except
 * non-secret facts (version, hostname, platform, capabilities).
 *
 * Environment overrides: IPAM_AGENT_CONFIG (path), NEXTDESK_URL,
 * NEXTDESK_AGENT_TOKEN.
 */

import { readFileSync } from "node:fs";

export type SnmpCredential =
  | { version: "v2c"; community: string }
  | {
      version: "v3";
      user: string;
      authProtocol?: "md5" | "sha" | "sha224" | "sha256" | "sha384" | "sha512";
      authKey?: string;
      privProtocol?: "des" | "aes" | "aes256b" | "aes256r";
      privKey?: string;
    };

export type LocalConfig = {
  nextdeskUrl: string;
  agentToken: string;
  snmp: {
    default: SnmpCredential | null;
    hosts: Record<string, SnmpCredential>;
    timeoutMs: number;
    retries: number;
  };
  /** Optional overrides; normally nextDesk delivers subnets and servers. */
  scan: { subnets: string[]; reverseDns: boolean; maxHostsPerRun: number };
  dhcpServers: string[] | null;
  dnsServers: string[] | null;
  /** Second opt-in for DHCP/DNS changes (besides the setting in nextDesk). */
  allowWrites: boolean;
  powershell: string;
  ouiFile: string | null;
  logLevel: "debug" | "info" | "warn" | "error";
};

export class ConfigError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string" && entry.trim())
  ) {
    throw new ConfigError(`«${field}» muss eine Liste von Texten sein.`);
  }
  return value.map((entry: string) => entry.trim());
}

function credential(value: unknown, field: string): SnmpCredential {
  if (!isObject(value)) throw new ConfigError(`«${field}» ist ungültig.`);
  if (value.version === "v2c") {
    if (typeof value.community !== "string" || !value.community) {
      throw new ConfigError(`«${field}.community» fehlt.`);
    }
    return { version: "v2c", community: value.community };
  }
  if (value.version === "v3") {
    if (typeof value.user !== "string" || !value.user)
      throw new ConfigError(`«${field}.user» fehlt.`);
    const result: SnmpCredential = { version: "v3", user: value.user };
    const auth = ["md5", "sha", "sha224", "sha256", "sha384", "sha512"];
    const priv = ["des", "aes", "aes256b", "aes256r"];
    if (value.authProtocol !== undefined) {
      if (
        !auth.includes(String(value.authProtocol)) ||
        typeof value.authKey !== "string" ||
        value.authKey.length < 8
      ) {
        throw new ConfigError(
          `«${field}»: authProtocol/authKey (mind. 8 Zeichen) prüfen.`,
        );
      }
      result.authProtocol = value.authProtocol as NonNullable<
        typeof result.authProtocol
      >;
      result.authKey = value.authKey;
    }
    if (value.privProtocol !== undefined) {
      if (
        !result.authProtocol ||
        !priv.includes(String(value.privProtocol)) ||
        typeof value.privKey !== "string" ||
        value.privKey.length < 8
      ) {
        throw new ConfigError(
          `«${field}»: privProtocol/privKey prüfen (nur zusammen mit authProtocol).`,
        );
      }
      result.privProtocol = value.privProtocol as NonNullable<
        typeof result.privProtocol
      >;
      result.privKey = value.privKey;
    }
    return result;
  }
  throw new ConfigError(`«${field}.version» muss «v2c» oder «v3» sein.`);
}

export function parseLocalConfig(
  raw: unknown,
  env: Record<string, string | undefined> = process.env,
): LocalConfig {
  if (!isObject(raw))
    throw new ConfigError(
      "Die Konfigurationsdatei muss ein JSON-Objekt enthalten.",
    );
  const nextdeskUrl = (
    env.NEXTDESK_URL ??
    (typeof raw.nextdeskUrl === "string" ? raw.nextdeskUrl : "")
  ).trim();
  const agentToken = (
    env.NEXTDESK_AGENT_TOKEN ??
    (typeof raw.agentToken === "string" ? raw.agentToken : "")
  ).trim();
  let url: URL;
  try {
    url = new URL(nextdeskUrl);
  } catch {
    throw new ConfigError("«nextdeskUrl» fehlt oder ist ungültig.");
  }
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  ) {
    throw new ConfigError("«nextdeskUrl» muss HTTPS verwenden.");
  }
  if (!/^ndip_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/.test(agentToken)) {
    throw new ConfigError(
      "«agentToken» fehlt oder hat das falsche Format (ndip_…).",
    );
  }
  const snmpRaw = isObject(raw.snmp) ? raw.snmp : {};
  const hosts: Record<string, SnmpCredential> = {};
  if (isObject(snmpRaw.hosts)) {
    for (const [host, value] of Object.entries(snmpRaw.hosts)) {
      hosts[host.toLowerCase()] = credential(value, `snmp.hosts.${host}`);
    }
  }
  const scanRaw = isObject(raw.scan) ? raw.scan : {};
  const level = ["debug", "info", "warn", "error"].includes(
    String(raw.logLevel),
  )
    ? (raw.logLevel as LocalConfig["logLevel"])
    : "info";
  return {
    nextdeskUrl: url.toString(),
    agentToken,
    snmp: {
      default:
        snmpRaw.default === undefined || snmpRaw.default === null
          ? null
          : credential(snmpRaw.default, "snmp.default"),
      hosts,
      timeoutMs:
        typeof snmpRaw.timeoutMs === "number"
          ? Math.min(Math.max(snmpRaw.timeoutMs, 500), 30000)
          : 5000,
      retries:
        typeof snmpRaw.retries === "number"
          ? Math.min(Math.max(Math.round(snmpRaw.retries), 0), 5)
          : 1,
    },
    scan: {
      subnets: stringList(scanRaw.subnets, "scan.subnets"),
      reverseDns: scanRaw.reverseDns !== false,
      maxHostsPerRun:
        typeof scanRaw.maxHostsPerRun === "number"
          ? Math.min(Math.max(Math.round(scanRaw.maxHostsPerRun), 256), 262144)
          : 65536,
    },
    dhcpServers:
      raw.dhcpServers === undefined
        ? null
        : stringList(raw.dhcpServers, "dhcpServers"),
    dnsServers:
      raw.dnsServers === undefined
        ? null
        : stringList(raw.dnsServers, "dnsServers"),
    allowWrites: raw.allowWrites === true,
    powershell:
      typeof raw.powershell === "string" && raw.powershell
        ? raw.powershell
        : "powershell.exe",
    ouiFile:
      typeof raw.ouiFile === "string" && raw.ouiFile ? raw.ouiFile : null,
    logLevel: level,
  };
}

export function loadLocalConfig(path: string): LocalConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ConfigError(`Konfigurationsdatei «${path}» nicht lesbar.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new ConfigError(
      `Konfigurationsdatei «${path}» ist kein gültiges JSON.`,
    );
  }
  return parseLocalConfig(raw);
}

/** Credential for an SNMP target: host entry, else default; version must match. */
export function snmpCredentialFor(
  config: LocalConfig,
  host: string,
  version: "v2c" | "v3",
): SnmpCredential | null {
  const credentialEntry =
    config.snmp.hosts[host.toLowerCase()] ?? config.snmp.default;
  return credentialEntry && credentialEntry.version === version
    ? credentialEntry
    : null;
}

/** Configuration delivered by nextDesk on hello (no secrets). */
export type ServerConfig = {
  scheduleMinutes: number;
  pingTimeoutMs: number;
  pingConcurrency: number;
  snmpTargets: {
    host: string;
    version: "v2c" | "v3";
    user: string | null;
    authProtocol: string | null;
    privProtocol: string | null;
    collect: ("arp" | "fdb" | "lldp")[];
  }[];
  dhcpServers: string[];
  dnsServers: string[];
  dnsZones: string[];
  allowWrites: boolean;
};

export type Subnet = {
  prefixId: string;
  prefix: string;
  vrfId: string | null;
  family: 4 | 6;
  sweep: boolean;
};
