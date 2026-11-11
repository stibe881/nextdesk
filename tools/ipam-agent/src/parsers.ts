/**
 * Parsers for command output: ping, ARP/neighbour tables, IEEE OUI list.
 * Windows output may be German («Antwort von …», «dynamisch»); the parsers
 * only rely on numbers, addresses and «TTL».
 */

import { canonicalIp, isUsefulAddress, normalizeMac } from "./net.ts";

export type Platform = "linux" | "win32" | "darwin" | "freebsd" | "other";

export function currentPlatform(value: string = process.platform): Platform {
  return value === "linux" ||
    value === "win32" ||
    value === "darwin" ||
    value === "freebsd"
    ? value
    : "other";
}

/** Arguments for one echo request with timeout. */
export function pingArgs(
  platform: Platform,
  address: string,
  timeoutMs: number,
): string[] {
  const seconds = String(Math.max(1, Math.ceil(timeoutMs / 1000)));
  switch (platform) {
    case "win32":
      return ["-n", "1", "-w", String(timeoutMs), address];
    case "darwin":
      return ["-n", "-c", "1", "-W", String(timeoutMs), address];
    case "freebsd":
      return ["-n", "-c", "1", "-t", seconds, address];
    default:
      return ["-n", "-c", "1", "-W", seconds, address];
  }
}

export type PingResult = {
  alive: boolean;
  timeMs: number | null;
  ttl: number | null;
};

/**
 * A reply counts only with a TTL: Windows exits with 0 for «Destination host
 * unreachable» from a router, which must not count as alive.
 */
export function parsePingOutput(output: string): PingResult {
  const ttl = /\bttl[=:]\s*(\d{1,3})/i.exec(output);
  if (!ttl) return { alive: false, timeMs: null, ttl: null };
  const time = /(?:time|zeit)\s*([=<])\s*([\d.,]+)\s*ms/i.exec(output);
  const timeMs = time?.[2] ? Number(time[2].replace(",", ".")) : null;
  return {
    alive: true,
    timeMs: timeMs !== null && Number.isFinite(timeMs) ? timeMs : null,
    ttl: Number(ttl[1]),
  };
}

export type Neighbor = { address: string; mac: string; family: 4 | 6 };

const LINUX_NEIGH =
  /^(\S+)\s+dev\s+\S+\s+lladdr\s+([0-9a-f:]{11,17})(?:\s+router)?\s+(\w+)/i;
const WINDOWS_ARP =
  /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+\S+/i;
const WINDOWS_NETSH =
  /^\s*([0-9a-f:]+:[0-9a-f:]*)(?:%\d+)?\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+(\S+)/i;
const BSD_ARP =
  /^\S+\s+\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-f:]{11,17})\s/i;

/**
 * Parses `ip neigh show` (Linux), `arp -a` (Windows, any language),
 * `netsh interface ipv6 show neighbors` (Windows) and `arp -an` (macOS/BSD).
 * Failed/incomplete entries, multicast and link-local addresses are dropped.
 */
export function parseNeighborOutput(output: string): Neighbor[] {
  const result = new Map<string, Neighbor>();
  for (const line of output.split(/\r?\n/)) {
    let address: string | undefined;
    let mac: string | undefined;
    const linux = LINUX_NEIGH.exec(line);
    if (linux) {
      if (/^(FAILED|INCOMPLETE)$/i.test(linux[3] ?? "")) continue;
      address = linux[1];
      mac = linux[2];
    } else {
      const match =
        WINDOWS_ARP.exec(line) ??
        BSD_ARP.exec(line) ??
        WINDOWS_NETSH.exec(line);
      if (!match) continue;
      address = match[1];
      mac = match[2];
    }
    const canonical = address ? canonicalIp(address) : null;
    const normalized = normalizeMac(mac);
    if (!canonical || !normalized || !isUsefulAddress(canonical)) continue;
    result.set(canonical, {
      address: canonical,
      mac: normalized,
      family: canonical.includes(":") ? 6 : 4,
    });
  }
  return [...result.values()];
}

/**
 * IEEE «oui.txt» («00-1E-0B   (hex)\t\tHewlett Packard») or «oui.csv»
 * («MA-L,001E0B,Hewlett Packard,…») → map «001e0b» → vendor.
 */
export function parseOuiList(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const txt =
      /^\s*([0-9A-F]{2})-([0-9A-F]{2})-([0-9A-F]{2})\s+\(hex\)\s+(.+?)\s*$/i.exec(
        line,
      );
    if (txt) {
      map.set(
        `${txt[1]}${txt[2]}${txt[3]}`.toLowerCase(),
        (txt[4] ?? "").slice(0, 160),
      );
      continue;
    }
    const csv = /^MA-L,([0-9A-F]{6}),("([^"]*)"|[^,]*)/i.exec(line);
    if (csv)
      map.set(
        (csv[1] ?? "").toLowerCase(),
        (csv[3] ?? csv[2] ?? "").trim().slice(0, 160),
      );
  }
  return map;
}

export function vendorFromList(
  list: Map<string, string> | null,
  mac: string,
): string | null {
  if (!list) return null;
  return list.get(mac.replaceAll(":", "").slice(0, 6)) ?? null;
}
