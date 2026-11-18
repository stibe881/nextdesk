/**
 * IP and MAC helpers (no dependencies). Same normalisation as nextDesk:
 * MAC «aa:bb:cc:dd:ee:ff», IPv4 dotted, IPv6 compressed lowercase.
 */

import { isIP } from "node:net";

export function normalizeMac(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value.trim().toLowerCase();
  if (!text || text.length > 40) return null;
  if (text.startsWith("0x")) text = text.slice(2);
  let hex: string;
  if (/^[0-9a-f]{1,2}([:-][0-9a-f]{1,2}){5}$/.test(text)) {
    hex = text
      .split(/[:-]/)
      .map((part) => part.padStart(2, "0"))
      .join("");
  } else if (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/.test(text)) {
    hex = text.replaceAll(".", "");
  } else if (/^[0-9a-f]{12}$/.test(text)) {
    hex = text;
  } else {
    return null;
  }
  if (hex === "000000000000" || hex === "ffffffffffff") return null;
  if (parseInt(hex.slice(0, 2), 16) & 1) return null; // multicast
  return hex.match(/../g)!.join(":");
}

/** MAC from 6 raw bytes (SNMP OCTET STRING). */
export function macFromBytes(
  bytes: Uint8Array | readonly number[],
): string | null {
  if (bytes.length !== 6) return null;
  return normalizeMac(
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(":"),
  );
}

export type Family = 4 | 6;

export function ipFamily(value: string): Family | null {
  const family = isIP(value);
  return family === 4 || family === 6 ? family : null;
}

/** Canonical form (IPv6 compressed lowercase); null if invalid. */
export function canonicalIp(value: string): string | null {
  const trimmed = value.trim().replace(/%.*$/, "");
  const family = ipFamily(trimmed);
  if (family === 4) return trimmed.split(".").map(Number).join(".");
  if (family === 6) {
    try {
      return new URL(`http://[${trimmed}]/`).hostname.slice(1, -1);
    } catch {
      return null;
    }
  }
  return null;
}

export function ipv4ToNumber(address: string): number {
  return address.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
}

export function numberToIpv4(value: number): string {
  return [24, 16, 8, 0]
    .map((shift) => Math.floor(value / 2 ** shift) % 256)
    .join(".");
}

function ipv6ToBigInt(address: string): bigint {
  const canonical = canonicalIp(address) ?? "::";
  const [head = "", tail] = canonical.includes("::")
    ? canonical.split("::")
    : [canonical, undefined];
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const fill =
    tail === undefined
      ? []
      : new Array(8 - headParts.length - tailParts.length).fill("0");
  return [...headParts, ...fill, ...tailParts].reduce(
    (sum, group) => (sum << 16n) + BigInt(parseInt(group || "0", 16)),
    0n,
  );
}

export type Cidr = { family: Family; network: string; length: number };

export function parseCidr(value: string): Cidr | null {
  const [address, lengthText] = value.trim().split("/");
  if (!address || lengthText === undefined || !/^\d{1,3}$/.test(lengthText))
    return null;
  const canonical = canonicalIp(address);
  const family = canonical ? ipFamily(canonical) : null;
  const length = Number(lengthText);
  if (!canonical || !family || length > (family === 4 ? 32 : 128)) return null;
  return { family, network: canonical, length };
}

/** Is the address inside the CIDR? */
export function cidrContains(cidr: Cidr, address: string): boolean {
  const canonical = canonicalIp(address);
  if (!canonical || ipFamily(canonical) !== cidr.family) return false;
  if (cidr.family === 4) {
    const shift = 32 - cidr.length;
    const divisor = 2 ** shift;
    return (
      Math.floor(ipv4ToNumber(canonical) / divisor) ===
      Math.floor(ipv4ToNumber(cidr.network) / divisor)
    );
  }
  const shift = BigInt(128 - cidr.length);
  return (
    ipv6ToBigInt(canonical) >> shift === ipv6ToBigInt(cidr.network) >> shift
  );
}

/** Host addresses of an IPv4 subnet (without network/broadcast up to /30). */
export function ipv4Hosts(cidr: Cidr, limit = 65536): string[] {
  if (cidr.family !== 4) return [];
  const size = 2 ** (32 - cidr.length);
  const base = Math.floor(ipv4ToNumber(cidr.network) / size) * size;
  const first = cidr.length <= 30 ? base + 1 : base;
  const last = cidr.length <= 30 ? base + size - 2 : base + size - 1;
  const hosts: string[] = [];
  for (let value = first; value <= last && hosts.length < limit; value += 1)
    hosts.push(numberToIpv4(value));
  return hosts;
}

/** Addresses worth reporting (no loopback, link-local, multicast …). */
export function isUsefulAddress(address: string): boolean {
  const canonical = canonicalIp(address);
  if (!canonical) return false;
  if (ipFamily(canonical) === 4) {
    const [a = 0, b = 0] = canonical.split(".").map(Number);
    if (a === 0 || a === 127 || a >= 224) return false;
    return !(a === 169 && b === 254);
  }
  return !(
    canonical === "::" ||
    canonical === "::1" ||
    /^ff/.test(canonical) ||
    /^fe[89ab]/.test(canonical)
  );
}
