// IPAM: IPv4/IPv6 addresses and prefixes (CIDR) without dependencies.
//
// Diese Datei existiert identisch zweimal:
//   supabase/functions/_shared/ipam-cidr.ts (Edge Functions, Deno)
//   apps/web/src/lib/ipam-cidr.ts (Web-App, Vite)
// Ein Vitest-Test prüft, dass beide Kopien übereinstimmen. Änderungen immer in
// beiden Dateien vornehmen.
//
// Values are bigints so IPv6 works without precision loss. Capacity rules
// match public.ipam_prefix_capacity / ipam_next_free_address (0300).

export type IpVersion = 4 | 6;
export type IpAddress = { version: IpVersion; value: bigint };
export type Cidr = { version: IpVersion; network: bigint; length: number };

export function addressBits(version: IpVersion): number {
  return version === 4 ? 32 : 128;
}

function maxValue(version: IpVersion): bigint {
  return (1n << BigInt(addressBits(version))) - 1n;
}

/** Network mask of the given length as a bigint. */
export function prefixMask(version: IpVersion, length: number): bigint {
  const bits = addressBits(version);
  if (length <= 0) return 0n;
  return (maxValue(version) >> BigInt(bits - length)) << BigInt(bits - length);
}

export function parseIpv4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    // Leading zeros are ambiguous (octal in some tools): reject them.
    if (part.length > 1 && part.startsWith("0")) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

export function parseIpv6(text: string): bigint | null {
  if (!text || text.includes("%") || text.length > 45) return null;
  let head = text;
  let tailV4: bigint | null = null;
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".")) {
    if (lastColon < 0) return null;
    tailV4 = parseIpv4(text.slice(lastColon + 1));
    if (tailV4 === null) return null;
    head = text.slice(0, lastColon + 1) + "0:0";
  }
  const doubleAt = head.indexOf("::");
  if (doubleAt !== head.lastIndexOf("::")) return null;
  const parseGroups = (part: string): string[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    return groups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))
      ? groups
      : null;
  };
  let groups: string[];
  if (doubleAt >= 0) {
    const left = parseGroups(head.slice(0, doubleAt));
    const right = parseGroups(head.slice(doubleAt + 2));
    if (!left || !right) return null;
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  } else {
    const all = parseGroups(head);
    if (!all || all.length !== 8) return null;
    groups = all;
  }
  let value = 0n;
  for (const group of groups)
    value = (value << 16n) | BigInt(parseInt(group, 16));
  if (tailV4 !== null) value = (value & ~0xffffffffn) | tailV4;
  return value;
}

/** Parses a single IPv4 or IPv6 address (no prefix length). */
export function parseAddress(text: string): IpAddress | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.includes(":")) {
    const value = parseIpv6(trimmed);
    return value === null ? null : { version: 6, value };
  }
  const value = parseIpv4(trimmed);
  return value === null ? null : { version: 4, value };
}

function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n]
    .map((shift) => String((value >> shift) & 255n))
    .join(".");
}

/** RFC 5952: lowercase, longest run (≥ 2) of zero groups as «::». */
function formatIpv6(value: bigint): string {
  const groups: number[] = [];
  for (let index = 7; index >= 0; index--) {
    groups.push(Number((value >> BigInt(index * 16)) & 0xffffn));
  }
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < 8; index++) {
    if (groups[index] !== 0) continue;
    let end = index;
    while (end < 8 && groups[end] === 0) end++;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestLength < 2) return hex.join(":");
  const left = hex.slice(0, bestStart).join(":");
  const right = hex.slice(bestStart + bestLength).join(":");
  return `${left}::${right}`;
}

export function formatAddress(address: IpAddress): string {
  return address.version === 4
    ? formatIpv4(address.value)
    : formatIpv6(address.value);
}

export function formatCidr(cidr: Cidr): string {
  return `${formatAddress({ version: cidr.version, value: cidr.network })}/${cidr.length}`;
}

export type ParsedCidr = {
  cidr: Cidr;
  /** True when the input had host bits set (e.g. 10.0.0.5/24). */
  hostBitsSet: boolean;
};

/**
 * Parses «10.20.30.0/24», «fd00::/48» or a bare address (→ /32 or /128).
 * Host bits are cleared; `hostBitsSet` tells the caller they were present.
 */
export function parseCidrInput(text: string): ParsedCidr | null {
  const trimmed = text.trim();
  const slash = trimmed.indexOf("/");
  const addressText = slash >= 0 ? trimmed.slice(0, slash) : trimmed;
  const address = parseAddress(addressText);
  if (!address) return null;
  const bits = addressBits(address.version);
  let length = bits;
  if (slash >= 0) {
    const lengthText = trimmed.slice(slash + 1);
    if (!/^\d{1,3}$/.test(lengthText)) return null;
    length = Number(lengthText);
    if (length > bits) return null;
  }
  const network = address.value & prefixMask(address.version, length);
  return {
    cidr: { version: address.version, network, length },
    hostBitsSet: network !== address.value,
  };
}

/** Strict CIDR: null when invalid or when host bits are set. */
export function parseCidr(text: string): Cidr | null {
  const parsed = parseCidrInput(text);
  return parsed && !parsed.hostBitsSet ? parsed.cidr : null;
}

/** «10.20.30.0/24» → «10.20.30.0/24» in canonical form, or null. */
export function normalizeCidr(text: string): string | null {
  const cidr = parseCidr(text);
  return cidr ? formatCidr(cidr) : null;
}

/** Address in canonical form (Postgres may append «/32»), or null. */
export function normalizeAddress(text: string): string | null {
  const trimmed = text.trim();
  const slash = trimmed.indexOf("/");
  const address = parseAddress(slash >= 0 ? trimmed.slice(0, slash) : trimmed);
  if (!address) return null;
  if (
    slash >= 0 &&
    trimmed.slice(slash + 1) !== String(addressBits(address.version))
  ) {
    return null;
  }
  return formatAddress(address);
}

export function cidrFirst(cidr: Cidr): bigint {
  return cidr.network;
}

export function cidrLast(cidr: Cidr): bigint {
  return (
    cidr.network |
    (maxValue(cidr.version) & ~prefixMask(cidr.version, cidr.length))
  );
}

/** Number of addresses in the prefix (including network/broadcast). */
export function cidrSize(cidr: Cidr): bigint {
  return 1n << BigInt(addressBits(cidr.version) - cidr.length);
}

/** Usable addresses: IPv4 up to /30 without network and broadcast. */
export function cidrCapacity(cidr: Cidr): bigint {
  const size = cidrSize(cidr);
  return cidr.version === 4 && cidr.length <= 30 ? size - 2n : size;
}

/** First and last assignable address (same rule as ipam_next_free_address). */
export function usableRange(cidr: Cidr): { first: bigint; last: bigint } {
  if (cidr.version === 4 && cidr.length <= 30) {
    return { first: cidrFirst(cidr) + 1n, last: cidrLast(cidr) - 1n };
  }
  if (cidr.version === 6 && cidr.length < 128) {
    return { first: cidrFirst(cidr) + 1n, last: cidrLast(cidr) };
  }
  return { first: cidrFirst(cidr), last: cidrLast(cidr) };
}

export function cidrContainsAddress(cidr: Cidr, address: IpAddress): boolean {
  return (
    cidr.version === address.version &&
    (address.value & prefixMask(cidr.version, cidr.length)) === cidr.network
  );
}

/** True when `inner` lies inside `outer` (equal prefixes count as inside). */
export function cidrContainsCidr(outer: Cidr, inner: Cidr): boolean {
  return (
    outer.version === inner.version &&
    outer.length <= inner.length &&
    (inner.network & prefixMask(outer.version, outer.length)) === outer.network
  );
}

export type CidrRelation = "disjoint" | "equal" | "contains" | "within";

/** CIDR blocks either nest or are disjoint; partial overlap cannot occur. */
export function cidrRelation(a: Cidr, b: Cidr): CidrRelation {
  if (a.version !== b.version) return "disjoint";
  if (a.length === b.length && a.network === b.network) return "equal";
  if (cidrContainsCidr(a, b)) return "contains";
  if (cidrContainsCidr(b, a)) return "within";
  return "disjoint";
}

export function cidrsOverlap(a: Cidr, b: Cidr): boolean {
  return cidrRelation(a, b) !== "disjoint";
}

export function compareAddresses(a: IpAddress, b: IpAddress): number {
  if (a.version !== b.version) return a.version - b.version;
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}

/** IPv4 before IPv6, then by network, then shorter (larger) prefix first. */
export function compareCidrs(a: Cidr, b: Cidr): number {
  if (a.version !== b.version) return a.version - b.version;
  if (a.network !== b.network) return a.network < b.network ? -1 : 1;
  return a.length - b.length;
}

/** Sort helper for address strings; invalid values go last. */
export function compareAddressText(a: string, b: string): number {
  const left = parseAddress(a.split("/")[0] ?? "");
  const right = parseAddress(b.split("/")[0] ?? "");
  if (!left || !right) return left ? -1 : right ? 1 : a.localeCompare(b);
  return compareAddresses(left, right);
}

/** Sort helper for prefix strings; invalid values go last. */
export function compareCidrText(a: string, b: string): number {
  const left = parseCidrInput(a)?.cidr;
  const right = parseCidrInput(b)?.cidr;
  if (!left || !right) return left ? -1 : right ? 1 : a.localeCompare(b);
  return compareCidrs(left, right);
}

export function addressInRange(
  address: IpAddress,
  start: IpAddress,
  end: IpAddress,
): boolean {
  return (
    address.version === start.version &&
    address.version === end.version &&
    address.value >= start.value &&
    address.value <= end.value
  );
}

/** Number of addresses from start to end (inclusive), 0 when reversed. */
export function rangeSize(start: IpAddress, end: IpAddress): bigint {
  if (start.version !== end.version || end.value < start.value) return 0n;
  return end.value - start.value + 1n;
}

/** Position of the address inside the prefix (0 = network address). */
export function addressOffset(cidr: Cidr, address: IpAddress): bigint | null {
  return cidrContainsAddress(cidr, address)
    ? address.value - cidr.network
    : null;
}

export function addressAt(cidr: Cidr, offset: bigint): IpAddress | null {
  if (offset < 0n || offset >= cidrSize(cidr)) return null;
  return { version: cidr.version, value: cidr.network + offset };
}

/** Largest prefix (smallest number) that is drawn as a full status grid. */
export const GRID_MIN_LENGTH_V4 = 22;

/** True when the prefix is small enough to list every address (≤ 1024). */
export function isGridPrefix(cidr: Cidr): boolean {
  return cidr.version === 4 && cidr.length >= GRID_MIN_LENGTH_V4;
}

/**
 * Every address of a small prefix (network address first). Null when the
 * prefix holds more than `max` addresses.
 */
export function listAddresses(cidr: Cidr, max = 1024): IpAddress[] | null {
  const size = cidrSize(cidr);
  if (size > BigInt(max)) return null;
  const result: IpAddress[] = [];
  for (let offset = 0n; offset < size; offset++) {
    result.push({ version: cidr.version, value: cidr.network + offset });
  }
  return result;
}

/** Splits a prefix into children of `length`. Null when invalid or > max. */
export function splitCidr(
  cidr: Cidr,
  length: number,
  max = 256,
): Cidr[] | null {
  if (length <= cidr.length || length > addressBits(cidr.version)) return null;
  const count = 1n << BigInt(length - cidr.length);
  if (count > BigInt(max)) return null;
  const step = 1n << BigInt(addressBits(cidr.version) - length);
  const result: Cidr[] = [];
  for (let index = 0n; index < count; index++) {
    result.push({
      version: cidr.version,
      network: cidr.network + index * step,
      length,
    });
  }
  return result;
}

/** Dotted subnet mask for IPv4 (e.g. 255.255.255.0). */
export function ipv4Netmask(length: number): string {
  return formatIpv4(prefixMask(4, length));
}

/** Canonical MAC «aa:bb:cc:dd:ee:ff» from common notations, or null. */
export function normalizeMac(text: string): string | null {
  const hex = text
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "");
  const separators = text.trim().replace(/[0-9a-fA-F]/g, "");
  if (hex.length !== 12 || !/^[:\-. ]*$/.test(separators)) return null;
  return hex.match(/../g)!.join(":");
}

/** Shortened bigint for display («1 048 574»; very large IPv6 as 2^n). */
export function formatCount(value: bigint): string {
  if (value > 10n ** 15n) {
    const bits = value.toString(2).length - 1;
    return 1n << BigInt(bits) === value ? `2^${bits}` : `≈ 2^${bits}`;
  }
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "’");
}

/** Utilization 0..100 as number with one decimal (0 for empty prefixes). */
export function utilizationPercent(used: bigint, capacity: bigint): number {
  if (capacity <= 0n) return 0;
  const permille = (used * 1000n) / capacity;
  return Number(permille > 1000n ? 1000n : permille) / 10;
}

export type NestedPrefix<T> = {
  item: T;
  parentId: string | null;
  depth: number;
};

/**
 * Orders prefixes as a tree per VRF: each prefix follows its most specific
 * containing prefix (same VRF). Invalid prefixes are appended at the end.
 */
export function nestPrefixes<
  T extends { id: string; prefix: string; vrfId: string | null },
>(items: T[]): NestedPrefix<T>[] {
  const parsed = items.map((item) => ({
    item,
    cidr: parseCidrInput(item.prefix)?.cidr ?? null,
  }));
  const valid = parsed.filter(
    (entry): entry is { item: T; cidr: Cidr } => entry.cidr !== null,
  );
  valid.sort((a, b) => {
    const vrfA = a.item.vrfId ?? "";
    const vrfB = b.item.vrfId ?? "";
    if (vrfA !== vrfB) return vrfA < vrfB ? -1 : 1;
    return compareCidrs(a.cidr, b.cidr);
  });
  const result: NestedPrefix<T>[] = [];
  const stack: {
    id: string;
    cidr: Cidr;
    vrfId: string | null;
    depth: number;
  }[] = [];
  for (const entry of valid) {
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      if (
        top.vrfId === entry.item.vrfId &&
        cidrContainsCidr(top.cidr, entry.cidr)
      )
        break;
      stack.pop();
    }
    const parent = stack[stack.length - 1] ?? null;
    const depth = parent ? parent.depth + 1 : 0;
    result.push({ item: entry.item, parentId: parent?.id ?? null, depth });
    stack.push({
      id: entry.item.id,
      cidr: entry.cidr,
      vrfId: entry.item.vrfId,
      depth,
    });
  }
  for (const entry of parsed) {
    if (entry.cidr === null)
      result.push({ item: entry.item, parentId: null, depth: 0 });
  }
  return result;
}

/**
 * Most specific prefix containing the address (same VRF when given).
 * Used e.g. to show the subnet of an infrastructure device.
 */
export function containingPrefix<T extends object>(
  prefixes: T[],
  addressText: string,
): T | null {
  const address = parseAddress((addressText.split("/")[0] ?? "").trim());
  if (!address) return null;
  let best: { item: T; length: number } | null = null;
  for (const item of prefixes) {
    const cidr = parseCidrInput(
      String((item as { prefix?: unknown }).prefix ?? ""),
    )?.cidr;
    if (!cidr || !cidrContainsAddress(cidr, address)) continue;
    if (!best || cidr.length > best.length)
      best = { item, length: cidr.length };
  }
  return best?.item ?? null;
}
