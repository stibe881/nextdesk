// IP-Rechner, Adressraum-Balken und Planer-Vorschau (reine Logik).

import {
  addressBits,
  cidrCapacity,
  cidrContainsCidr,
  cidrLast,
  cidrSize,
  compareCidrs,
  formatAddress,
  formatCidr,
  formatCount,
  ipv4Netmask,
  parseAddress,
  parseCidrInput,
  prefixMask,
  type Cidr,
} from "./ipam-cidr";

export type CalcResult = {
  version: 4 | 6;
  /** Network in CIDR notation, e.g. 172.16.68.0/22. */
  network: string;
  /** True when the input had host bits (172.16.69.5/22). */
  hostBitsSet: boolean;
  mask: string | null;
  wildcard: string | null;
  first: string;
  last: string;
  broadcast: string | null;
  /** Usable hosts, formatted («1’022»). */
  hosts: string;
  /** Total addresses, formatted. */
  size: string;
  cidr: Cidr;
};

/** Converts a dotted mask (255.255.252.0) into a prefix length, or null. */
export function maskToLength(mask: string): number | null {
  const parsed = parseAddress(mask.trim());
  if (!parsed || parsed.version !== 4) return null;
  const bits = parsed.value.toString(2).padStart(32, "0");
  if (!/^1*0*$/.test(bits)) return null;
  return bits.indexOf("0") === -1 ? 32 : bits.indexOf("0");
}

/**
 * Parses «10.20.30.0/24», «10.20.30.7 255.255.255.0» or an IPv6 prefix and
 * computes network, mask, first/last usable address and host count.
 * IPv4 /31 and /32 have no network/broadcast reserve (RFC 3021).
 */
export function calculate(input: string): CalcResult | null {
  let text = input.trim();
  if (!text) return null;
  const parts = text.split(/\s+/);
  if (parts.length === 2 && !text.includes("/")) {
    const length = maskToLength(parts[1]!);
    if (length === null) return null;
    text = `${parts[0]}/${length}`;
  } else if (parts.length !== 1) {
    return null;
  }
  if (!text.includes("/")) return null;
  const parsed = parseCidrInput(text);
  if (!parsed) return null;
  const { cidr } = parsed;
  const lastValue = cidrLast(cidr);
  const size = cidrSize(cidr);
  if (cidr.version === 4) {
    const small = cidr.length >= 31;
    const mask = prefixMask(4, cidr.length);
    return {
      version: 4,
      network: formatCidr(cidr),
      hostBitsSet: parsed.hostBitsSet,
      mask: ipv4Netmask(cidr.length),
      wildcard: formatAddress({ version: 4, value: ~mask & 0xffffffffn }),
      first: formatAddress({
        version: 4,
        value: small ? cidr.network : cidr.network + 1n,
      }),
      last: formatAddress({
        version: 4,
        value: small ? lastValue : lastValue - 1n,
      }),
      broadcast: small ? null : formatAddress({ version: 4, value: lastValue }),
      hosts: formatCount(small ? size : size - 2n),
      size: formatCount(size),
      cidr,
    };
  }
  return {
    version: 6,
    network: formatCidr(cidr),
    hostBitsSet: parsed.hostBitsSet,
    mask: null,
    wildcard: null,
    first: formatAddress({ version: 6, value: cidr.network }),
    last: formatAddress({ version: 6, value: lastValue }),
    broadcast: null,
    hosts: formatCount(cidrCapacity(cidr)),
    size: formatCount(size),
    cidr,
  };
}

/**
 * The documented prefix that equals the CIDR, otherwise the most specific
 * one containing it. `exact` tells which of the two it is.
 */
export function findKnownPrefix<T extends { prefix: string }>(
  cidr: Cidr,
  prefixes: T[],
): { item: T; exact: boolean } | null {
  let best: { item: T; length: number } | null = null;
  for (const item of prefixes) {
    const other = parseCidrInput(item.prefix)?.cidr;
    if (!other || !cidrContainsCidr(other, cidr)) continue;
    if (!best || other.length > best.length)
      best = { item, length: other.length };
  }
  if (!best) return null;
  return { item: best.item, exact: best.length === cidr.length };
}

/** Usable hosts of a prefix length as text (IPv4: minus network/broadcast). */
export function hostsForLength(length: number, version: 4 | 6 = 4): string {
  const bits = addressBits(version);
  if (length < 0 || length > bits) return "–";
  const size = 1n << BigInt(bits - length);
  if (version === 4 && length <= 30) return formatCount(size - 2n);
  return formatCount(size);
}

/** Label for a size select: «/24 (254 Hosts)». */
export function lengthOptionLabel(length: number, version: 4 | 6 = 4): string {
  return `/${length} (${hostsForLength(length, version)} Hosts)`;
}

/**
 * Prefix lengths offered inside a parent: from one bit below the parent
 * down to /30 (IPv4) or /64 (IPv6), at most `maxSteps` steps.
 */
export function plannerLengths(parent: string, maxSteps = 14): number[] {
  const cidr = parseCidrInput(parent)?.cidr;
  if (!cidr) return [];
  const limit = cidr.version === 4 ? 30 : 64;
  const result: number[] = [];
  for (
    let length = cidr.length + 1;
    length <= Math.min(limit, cidr.length + maxSteps);
    length++
  ) {
    result.push(length);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Bars (address space map, planner preview)

export type BarSegment = {
  kind: "existing" | "planned" | "free";
  /** CIDR for existing/planned, or «start – end» for free gaps. */
  label: string;
  name: string | null;
  start: bigint;
  size: bigint;
  /** Share of the parent, 0..1. */
  share: number;
  prefixId?: string;
};

function share(size: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  // Ten-thousandths keep the precision without Number overflow for IPv6.
  return Number((size * 10000n) / total) / 10000;
}

/**
 * Builds a proportional bar of the parent: existing children and planned
 * blocks in address order, the gaps in between as free segments.
 * Overlapping or invalid entries are skipped.
 */
export function buildBar(
  parent: string,
  existing: { cidr: string; name?: string | null; prefixId?: string }[],
  planned: { cidr: string; name?: string | null }[] = [],
): BarSegment[] {
  const outer = parseCidrInput(parent)?.cidr;
  if (!outer) return [];
  const total = cidrSize(outer);
  const blocks: {
    kind: "existing" | "planned";
    cidr: Cidr;
    name: string | null;
    prefixId?: string;
  }[] = [];
  const add = (
    kind: "existing" | "planned",
    entry: { cidr: string; name?: string | null; prefixId?: string },
  ) => {
    const cidr = parseCidrInput(entry.cidr)?.cidr;
    if (!cidr || !cidrContainsCidr(outer, cidr)) return;
    blocks.push({
      kind,
      cidr,
      name: entry.name ?? null,
      ...(entry.prefixId ? { prefixId: entry.prefixId } : {}),
    });
  };
  existing.forEach((entry) => add("existing", entry));
  planned.forEach((entry) => add("planned", entry));
  blocks.sort((a, b) => compareCidrs(a.cidr, b.cidr));
  const result: BarSegment[] = [];
  let cursor = outer.network;
  const pushFree = (until: bigint) => {
    if (until <= cursor) return;
    const size = until - cursor;
    result.push({
      kind: "free",
      label: `${formatAddress({ version: outer.version, value: cursor })} – ${formatAddress({ version: outer.version, value: until - 1n })}`,
      name: null,
      start: cursor,
      size,
      share: share(size, total),
    });
  };
  for (const block of blocks) {
    if (block.cidr.network < cursor) continue; // nested or overlapping
    pushFree(block.cidr.network);
    const size = cidrSize(block.cidr);
    result.push({
      kind: block.kind,
      label: formatCidr(block.cidr),
      name: block.name,
      start: block.cidr.network,
      size,
      share: share(size, total),
      ...(block.prefixId ? { prefixId: block.prefixId } : {}),
    });
    cursor = block.cidr.network + size;
  }
  pushFree(cidrLast(outer) + 1n);
  return result;
}

/** Five tick labels below a bar: start, quarters and the last address. */
export function barTicks(parent: string): string[] {
  const cidr = parseCidrInput(parent)?.cidr;
  if (!cidr) return [];
  const size = cidrSize(cidr);
  const ticks = [0n, size / 4n, size / 2n, (size * 3n) / 4n].map((offset) =>
    formatAddress({ version: cidr.version, value: cidr.network + offset }),
  );
  ticks.push(formatAddress({ version: cidr.version, value: cidrLast(cidr) }));
  return [...new Set(ticks)];
}

/**
 * First block of `length` in each free CIDR segment that is large enough
 * (free segments from `addressSpace` are aligned). At most `max` results.
 */
export function freeBlocksOfLength(
  segments: { kind: string; cidr: string }[],
  length: number,
  max = 12,
): string[] {
  const result: string[] = [];
  for (const segment of segments) {
    if (segment.kind !== "free") continue;
    const cidr = parseCidrInput(segment.cidr)?.cidr;
    if (!cidr || cidr.length > length) continue;
    result.push(formatCidr({ ...cidr, length }));
    if (result.length >= max) break;
  }
  return result;
}

/** First /24 (or the block itself when smaller) as default inside a gap. */
export function defaultBlockInGap(
  gap: string,
  preferred = 24,
): { cidr: string; length: number } | null {
  const cidr = parseCidrInput(gap)?.cidr;
  if (!cidr) return null;
  const wanted = cidr.version === 4 ? preferred : 64;
  const length = Math.max(cidr.length, wanted);
  if (length > addressBits(cidr.version)) return null;
  return { cidr: formatCidr({ ...cidr, length }), length };
}

/** Lengths offered for a new subnet in a free gap (gap length … /30). */
export function gapLengths(gap: string): number[] {
  const cidr = parseCidrInput(gap)?.cidr;
  if (!cidr) return [];
  const limit = cidr.version === 4 ? 30 : 64;
  const result: number[] = [];
  for (let length = cidr.length; length <= limit; length++) {
    result.push(length);
  }
  return result;
}

/**
 * Share (0..1) of each address space segment within the parent, from the
 * segment CIDR (robust against capacity strings without network/broadcast).
 */
export function segmentShares(
  parent: string,
  segments: { cidr: string }[],
): number[] {
  const outer = parseCidrInput(parent)?.cidr;
  if (!outer) return segments.map(() => 0);
  const total = cidrSize(outer);
  return segments.map((segment) => {
    const cidr = parseCidrInput(segment.cidr)?.cidr;
    return cidr ? share(cidrSize(cidr), total) : 0;
  });
}

/** Prefix length of a CIDR text, or null. */
export function cidrLength(text: string): number | null {
  return parseCidrInput(text)?.cidr.length ?? null;
}

/** Decimal string (contract uses strings for IPv6) → «22’528». */
export function formatCountText(value: string | null | undefined): string {
  if (!value) return "0";
  try {
    return formatCount(BigInt(value.split(".")[0] || "0"));
  } catch {
    return value;
  }
}
