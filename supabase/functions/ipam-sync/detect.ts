// Erkennt Netzwerkangaben in Tickettexten: IPv4/IPv6 (auch CIDR),
// MAC-Adressen und Hostnamen nach dem Namensschema (z. B. SW-A2-01, AP101,
// PC-A2-009, SOBE-NB-0123, DRU-A2-KOPIE).
//
// Serverseitige Kopie von apps/web/src/lib/ipam-ticket-detect.ts –
// Änderungen bitte in beiden Dateien nachziehen (die Tests prüfen dieselben
// Beispiele).

export type NetworkCandidates = {
  /** Einzelne IPv4-Adressen. */
  ipv4: string[];
  /** Einzelne IPv6-Adressen (klein geschrieben). */
  ipv6: string[];
  /** Netze in CIDR-Schreibweise (IPv4 oder IPv6). */
  cidrs: string[];
  /** MAC-Adressen, normalisiert auf aa:bb:cc:dd:ee:ff. */
  macs: string[];
  /** Hostnamen in Grossbuchstaben, ohne Domäne. */
  hostnames: string[];
};

export type DetectOptions = {
  /** Eigene Hostnamen-Präfixe (nur Buchstaben), ersetzen die Standardliste. */
  hostnamePrefixes?: readonly string[] | undefined;
};

/** Übliche Präfixe für Gerätenamen. */
export const DEFAULT_HOSTNAME_PREFIXES = [
  "SOBE",
  "SW",
  "AP",
  "PC",
  "NB",
  "LT",
  "WS",
  "DRU",
  "PRN",
  "SRV",
  "FW",
  "RT",
  "GW",
  "NAS",
  "ESX",
  "HV",
  "VM",
  "DC",
  "CAM",
  "USV",
] as const;

const MAX_PER_KIND = 20;
const MAX_TEXT_LENGTH = 200_000;

const IPV4 =
  /(?<![\w.])(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,3}))?(?![\w]|\.\d)/g;
const IPV6 =
  /(?<![\w:.])([0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7})(?:\/(\d{1,3}))?(?![\w:])/gi;
const MAC_SEPARATED =
  /(?<![0-9a-f:-])([0-9a-f]{2}([:-])[0-9a-f]{2}(?:\2[0-9a-f]{2}){4})(?![0-9a-f:-])/gi;
const MAC_DOTTED =
  /(?<![0-9a-f.])([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})(?![0-9a-f.])/gi;

function validIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  const numbers = parts.map((part) => Number(part));
  if (
    parts.some((part) => part.length > 1 && part.startsWith("0")) ||
    numbers.some((part) => !Number.isInteger(part) || part > 255)
  ) {
    return false;
  }
  // 0.x.x.x und Netzmasken (255.255.255.0) sind keine Geräteadressen.
  return numbers[0] !== 0 && numbers[0] !== 255;
}

function validIpv6(value: string): boolean {
  if (!/[0-9a-f]/i.test(value)) return false;
  const doubleColons = value.split("::").length - 1;
  if (doubleColons > 1) return false;
  if (doubleColons === 0) {
    const groups = value.split(":");
    return (
      groups.length === 8 &&
      groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))
    );
  }
  const [head = "", tail = ""] = value.split("::");
  const groups = [
    ...(head ? head.split(":") : []),
    ...(tail ? tail.split(":") : []),
  ];
  return (
    groups.length <= 7 &&
    groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))
  );
}

function normalizeMac(value: string): string | null {
  const hex = value.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (hex.length !== 12) return null;
  if (hex === "000000000000" || hex === "ffffffffffff") return null;
  return hex.match(/.{2}/g)!.join(":");
}

function hostnamePattern(prefixes: readonly string[]): RegExp {
  const safe = prefixes
    .filter((prefix) => /^[A-Za-z]{1,10}$/.test(prefix))
    .sort((a, b) => b.length - a.length);
  const group = safe.length ? safe.join("|") : "(?!)";
  return new RegExp(
    `(?<![\\w-])((?:${group})(?:\\d[a-z0-9]*|-[a-z0-9]+)(?:-[a-z0-9]+)*)(?:\\.[a-z0-9-]+)*(?![\\w-])`,
    "gi",
  );
}

function push(list: string[], value: string): void {
  if (list.length < MAX_PER_KIND && !list.includes(value)) list.push(value);
}

export function detectNetworkCandidates(
  texts: readonly (string | null | undefined)[],
  options: DetectOptions = {},
): NetworkCandidates {
  const result: NetworkCandidates = {
    ipv4: [],
    ipv6: [],
    cidrs: [],
    macs: [],
    hostnames: [],
  };
  const text = texts
    .filter((entry): entry is string => typeof entry === "string")
    .join("\n")
    .slice(0, MAX_TEXT_LENGTH);
  if (!text.trim()) return result;

  for (const match of text.matchAll(IPV4)) {
    const address = match[1]!;
    if (!validIpv4(address)) continue;
    const length = match[2];
    if (length !== undefined) {
      const bits = Number(length);
      if (bits <= 32) push(result.cidrs, `${address}/${bits}`);
    } else {
      push(result.ipv4, address);
    }
  }

  for (const match of text.matchAll(MAC_SEPARATED)) {
    const mac = normalizeMac(match[1]!);
    if (mac) push(result.macs, mac);
  }
  for (const match of text.matchAll(MAC_DOTTED)) {
    const mac = normalizeMac(match[1]!);
    if (mac) push(result.macs, mac);
  }

  for (const match of text.matchAll(IPV6)) {
    const address = match[1]!.toLowerCase();
    if (!validIpv6(address)) continue;
    const length = match[2];
    if (length !== undefined) {
      const bits = Number(length);
      if (bits <= 128) push(result.cidrs, `${address}/${bits}`);
    } else {
      push(result.ipv6, address);
    }
  }

  const pattern = hostnamePattern(
    options.hostnamePrefixes ?? DEFAULT_HOSTNAME_PREFIXES,
  );
  for (const match of text.matchAll(pattern)) {
    const name = match[1]!.toUpperCase();
    // Ohne Ziffer ist es meist ein Wort («PC-Probleme»), kein Gerät.
    if (!/\d/.test(name) || name.length > 63) continue;
    push(result.hostnames, name);
  }

  return result;
}

export function hasNetworkCandidates(candidates: NetworkCandidates): boolean {
  return (
    candidates.ipv4.length > 0 ||
    candidates.ipv6.length > 0 ||
    candidates.cidrs.length > 0 ||
    candidates.macs.length > 0 ||
    candidates.hostnames.length > 0
  );
}

/** Suchbegriffe für das Nachschlagen im IPAM. */
export function networkLookupTerms(candidates: NetworkCandidates): {
  ips: string[];
  macs: string[];
  hostnames: string[];
} {
  return {
    ips: [...candidates.ipv4, ...candidates.ipv6, ...candidates.cidrs],
    macs: [...candidates.macs],
    hostnames: [...candidates.hostnames],
  };
}
