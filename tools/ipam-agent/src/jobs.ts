/**
 * Jobs from nextDesk. Write jobs (DHCP/DNS) run only when
 * - the agent runs on Windows (PowerShell modules DhcpServer/DnsServer),
 * - `allowWrites` is true in nextDesk AND in the local config.json,
 * - the target server is one of the configured DHCP/DNS servers,
 * - the payload passes the strict validation below (again, after nextDesk).
 */

import { canonicalIp, ipFamily, normalizeMac } from "./net.ts";
import type { ScriptName } from "./powershell.ts";

export type Job = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
};

export type WritePlan = {
  script: ScriptName;
  server: string;
  params: Record<string, unknown>;
  kind: "dhcp" | "dns";
};

const HOST =
  /^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,62}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,62}[a-z0-9_])?)*$/i;
const LABEL = /^(@|[a-z0-9_*](?:[a-z0-9_.-]{0,252}))$/i;

function host(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\.$/, "").toLowerCase();
  if (canonicalIp(trimmed)) return canonicalIp(trimmed);
  return HOST.test(trimmed) ? trimmed : null;
}

function ip(value: unknown, family?: 4 | 6): string | null {
  if (typeof value !== "string") return null;
  const canonical = canonicalIp(value);
  if (!canonical) return null;
  return family && ipFamily(canonical) !== family ? null : canonical;
}

export class JobRejected extends Error {}

/**
 * Turns a job into a PowerShell call or throws JobRejected. `servers` are
 * the DHCP/DNS servers this agent may talk to.
 */
export function planWriteJob(
  job: Job,
  servers: { dhcp: readonly string[]; dns: readonly string[] },
): WritePlan {
  const p = job.payload ?? {};
  const server = host(p.server);
  if (!server) throw new JobRejected("Server fehlt oder ist ungültig.");
  const allowed = (list: readonly string[]) =>
    list.map((entry) => entry.toLowerCase()).includes(server);
  switch (job.kind) {
    case "dhcp_reserve": {
      if (!allowed(servers.dhcp))
        throw new JobRejected(`DHCP-Server ${server} ist nicht konfiguriert.`);
      const scopeId = ip(p.scopeId, 4);
      const address = ip(p.address, 4);
      const mac = normalizeMac(p.mac);
      if (!scopeId || !address || !mac)
        throw new JobRejected("Bereich, Adresse oder MAC ungültig.");
      const name =
        p.name === null || p.name === undefined ? null : host(p.name);
      const description =
        typeof p.description === "string"
          ? p.description
              .replace(/[^\p{L}\p{N} .,;:()/_@#+-]/gu, "")
              .slice(0, 200)
          : null;
      return {
        script: "dhcpReserve",
        server,
        kind: "dhcp",
        params: { server, scopeId, address, mac, name, description },
      };
    }
    case "dhcp_release": {
      if (!allowed(servers.dhcp))
        throw new JobRejected(`DHCP-Server ${server} ist nicht konfiguriert.`);
      const address = ip(p.address, 4);
      if (!address) throw new JobRejected("Adresse ungültig.");
      return {
        script: "dhcpRelease",
        server,
        kind: "dhcp",
        params: { server, address },
      };
    }
    case "dns_upsert_a": {
      if (!allowed(servers.dns))
        throw new JobRejected(`DNS-Server ${server} ist nicht konfiguriert.`);
      const zone = host(p.zone);
      const name =
        typeof p.name === "string" && LABEL.test(p.name)
          ? p.name.toLowerCase()
          : null;
      const type = p.type === "AAAA" ? "AAAA" : "A";
      const address = ip(p.address, type === "A" ? 4 : 6);
      if (!zone || !name || !address)
        throw new JobRejected("Zone, Name oder Adresse ungültig.");
      const ttl =
        typeof p.ttl === "number" &&
        Number.isInteger(p.ttl) &&
        p.ttl > 0 &&
        p.ttl <= 604800
          ? p.ttl
          : null;
      return {
        script: "dnsUpsertA",
        server,
        kind: "dns",
        params: {
          server,
          zone,
          name,
          type,
          address,
          createPtr: p.createPtr === true,
          replace: p.replace !== false,
          ttl,
        },
      };
    }
    case "dns_upsert_ptr": {
      if (!allowed(servers.dns))
        throw new JobRejected(`DNS-Server ${server} ist nicht konfiguriert.`);
      const zone = host(p.zone);
      const name =
        typeof p.name === "string" && LABEL.test(p.name)
          ? p.name.toLowerCase()
          : null;
      const target = host(p.target);
      if (!zone || !zone.endsWith(".arpa") || !name || !target)
        throw new JobRejected("Reverse-Zone, Name oder Ziel ungültig.");
      const ttl =
        typeof p.ttl === "number" &&
        Number.isInteger(p.ttl) &&
        p.ttl > 0 &&
        p.ttl <= 604800
          ? p.ttl
          : null;
      return {
        script: "dnsUpsertPtr",
        server,
        kind: "dns",
        params: {
          server,
          zone,
          name,
          target,
          replace: p.replace !== false,
          ttl,
        },
      };
    }
    case "dns_delete": {
      if (!allowed(servers.dns))
        throw new JobRejected(`DNS-Server ${server} ist nicht konfiguriert.`);
      const zone = host(p.zone);
      const name =
        typeof p.name === "string" && LABEL.test(p.name)
          ? p.name.toLowerCase()
          : null;
      const type = ["A", "AAAA", "PTR", "CNAME"].includes(String(p.type))
        ? String(p.type)
        : null;
      const value =
        type === "A" || type === "AAAA" ? ip(p.value) : host(p.value);
      if (!zone || !name || !type || !value)
        throw new JobRejected("Angaben zum Löschen ungültig.");
      return {
        script: "dnsDelete",
        server,
        kind: "dns",
        params: { server, zone, name, type, value },
      };
    }
    default:
      throw new JobRejected(`Unbekannter Auftrag «${job.kind}».`);
  }
}
