// Standorte: Netzwerkkarte aus Uplinks, Geräte- und DHCP-Texte (reine Logik).

import type { SiteDetail } from "./ipam-redesign-types";

export type SiteDevice = SiteDetail["devices"][number];

export type UplinkNode = {
  device: SiteDevice;
  children: UplinkNode[];
  /** Access points below this node (any depth). */
  apCount: number;
};

/** «switch», «access_point» … from the free category text. */
export function deviceKind(
  device: Pick<SiteDevice, "category" | "name">,
): "switch" | "ap" | "firewall" | "router" | "other" {
  const text = `${device.category ?? ""}`.toLowerCase();
  if (/access.?point|\bap\b|wlan/.test(text)) return "ap";
  if (/switch/.test(text)) return "switch";
  if (/firewall/.test(text)) return "firewall";
  if (/router|gateway/.test(text)) return "router";
  return "other";
}

/**
 * Tree of devices by uplink: roots are devices without (known) uplink,
 * sorted firewalls/routers first, then switches, then by name. Cycles are
 * broken (a device appears only once).
 */
export function uplinkTree(devices: SiteDevice[]): UplinkNode[] {
  const byId = new Map(devices.map((device) => [device.assetId, device]));
  const children = new Map<string, SiteDevice[]>();
  const roots: SiteDevice[] = [];
  for (const device of devices) {
    const parent =
      device.uplinkAssetId && device.uplinkAssetId !== device.assetId
        ? byId.get(device.uplinkAssetId)
        : undefined;
    if (parent) {
      const list = children.get(parent.assetId) ?? [];
      list.push(device);
      children.set(parent.assetId, list);
    } else {
      roots.push(device);
    }
  }
  const rank = (device: SiteDevice) => {
    const kind = deviceKind(device);
    return kind === "firewall"
      ? 0
      : kind === "router"
        ? 1
        : kind === "switch"
          ? 2
          : kind === "other"
            ? 3
            : 4;
  };
  const order = (a: SiteDevice, b: SiteDevice) =>
    rank(a) - rank(b) ||
    a.name.localeCompare(b.name, "de-CH", { numeric: true });
  const seen = new Set<string>();
  const build = (device: SiteDevice): UplinkNode => {
    seen.add(device.assetId);
    const nodes = (children.get(device.assetId) ?? [])
      .filter((child) => !seen.has(child.assetId))
      .sort(order)
      .map(build);
    return {
      device,
      children: nodes,
      apCount: nodes.reduce(
        (sum, node) =>
          sum + node.apCount + (deviceKind(node.device) === "ap" ? 1 : 0),
        0,
      ),
    };
  };
  const result = roots.sort(order).map(build);
  // Devices only reachable through a cycle become roots as well.
  for (const device of devices) {
    if (!seen.has(device.assetId)) result.push(build(device));
  }
  return result;
}

/** «.100 – .199» for IPv4 pools in the same /24, otherwise full range. */
export function dhcpText(start: string | null, end: string | null): string {
  if (!start || !end) return "nein";
  const a = start.split(".");
  const b = end.split(".");
  if (
    a.length === 4 &&
    b.length === 4 &&
    a.slice(0, 3).join(".") === b.slice(0, 3).join(".")
  ) {
    return `.${a[3]} – .${b[3]}`;
  }
  return `${start} – ${end}`;
}

/** Device subtitle: «Switch · ProCurve 5406R». */
export function deviceSubtitle(device: SiteDevice): string {
  return [device.category, device.model ?? device.manufacturer]
    .filter(Boolean)
    .join(" · ");
}

/** Where the device is: location note and uplink. */
export function deviceWhere(device: SiteDevice): string {
  return [
    device.locationNote,
    device.uplinkName ? `an ${device.uplinkName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
