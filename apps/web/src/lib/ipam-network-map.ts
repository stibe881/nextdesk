// Netzwerkplan mit Subnetzen: ordnet Infrastruktur-Geräte über ihre IP dem
// spezifischsten IPAM-Subnetz zu (Aktion `networkMapOverlay` der Funktion
// `ipam`) und baut daraus Legende und VLAN-Filter.

import { containingPrefix } from "./ipam-cidr";

export type OverlayPrefix = {
  id: string;
  prefix: string;
  vrfId: string | null;
  description: string | null;
  securityZone: string | null;
  vlanId: string | null;
  vlanNumber: number | null;
  vlanName: string | null;
  siteName: string | null;
};

export type NetworkOverlay = { prefixes: OverlayPrefix[] };

export type DeviceSubnet = {
  prefixId: string;
  prefix: string;
  description: string | null;
  vlanId: string | null;
  vlanNumber: number | null;
  vlanName: string | null;
};

/** Filter key for devices without a matching subnet. */
export const NO_SUBNET = "none";

/** Parses the function response; anything unexpected yields null. */
export function parseOverlay(data: unknown): NetworkOverlay | null {
  if (!data || typeof data !== "object") return null;
  const prefixes = (data as { prefixes?: unknown }).prefixes;
  if (!Array.isArray(prefixes)) return null;
  return {
    prefixes: prefixes.filter(
      (entry): entry is OverlayPrefix =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as OverlayPrefix).id === "string" &&
        typeof (entry as OverlayPrefix).prefix === "string",
    ),
  };
}

/**
 * Device id → subnet. Devices have no VRF, so the global routing table wins;
 * other VRFs are only used when no global prefix matches.
 */
export function subnetsForDevices(
  devices: { id: string; ipAddress: string | null }[],
  prefixes: OverlayPrefix[],
): Map<string, DeviceSubnet> {
  const global = prefixes.filter((prefix) => prefix.vrfId === null);
  const result = new Map<string, DeviceSubnet>();
  for (const device of devices) {
    if (!device.ipAddress) continue;
    const match =
      containingPrefix(global, device.ipAddress) ??
      containingPrefix(prefixes, device.ipAddress);
    if (!match) continue;
    result.set(device.id, {
      prefixId: match.id,
      prefix: match.prefix,
      description: match.description,
      vlanId: match.vlanId,
      vlanNumber: match.vlanNumber,
      vlanName: match.vlanName,
    });
  }
  return result;
}

/** Filter/legend key of a device: VLAN id, else prefix id, else «none». */
export function subnetKey(subnet: DeviceSubnet | undefined): string {
  if (!subnet) return NO_SUBNET;
  return subnet.vlanId ? `vlan:${subnet.vlanId}` : `prefix:${subnet.prefixId}`;
}

export function subnetLabel(subnet: DeviceSubnet | undefined): string {
  if (!subnet) return "Ohne Subnetz";
  if (subnet.vlanNumber !== null) {
    return `VLAN ${subnet.vlanNumber}${subnet.vlanName ? ` · ${subnet.vlanName}` : ""}`;
  }
  return subnet.description
    ? `${subnet.prefix} · ${subnet.description}`
    : subnet.prefix;
}

/** Short text under the device name on the map. */
export function subnetBadge(subnet: DeviceSubnet | undefined): string | null {
  if (!subnet) return null;
  return subnet.vlanNumber !== null
    ? `VLAN ${subnet.vlanNumber} · ${subnet.prefix}`
    : subnet.prefix;
}

export type LegendEntry = {
  key: string;
  label: string;
  count: number;
  /** 1..8 → --chart-N; 0 = neutral (no subnet). */
  color: number;
};

/** Legend entries sorted by VLAN number, then prefix, «Ohne Subnetz» last. */
export function subnetLegend(
  deviceIds: string[],
  subnets: Map<string, DeviceSubnet>,
): LegendEntry[] {
  const entries = new Map<string, LegendEntry & { sort: [number, string] }>();
  for (const id of deviceIds) {
    const subnet = subnets.get(id);
    const key = subnetKey(subnet);
    const existing = entries.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    entries.set(key, {
      key,
      label: subnetLabel(subnet),
      count: 1,
      color: 0,
      sort: subnet ? [subnet.vlanNumber ?? 5000, subnet.prefix] : [9999, ""],
    });
  }
  const sorted = [...entries.values()].sort(
    (a, b) => a.sort[0] - b.sort[0] || a.sort[1].localeCompare(b.sort[1]),
  );
  let index = 0;
  return sorted.map(({ sort: _sort, ...entry }) => ({
    ...entry,
    color: entry.key === NO_SUBNET ? 0 : (index++ % 8) + 1,
  }));
}
