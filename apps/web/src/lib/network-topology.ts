/** Tree layout of network devices from their uplinks (device → uplink device). */
export type TopologyDevice = {
  id: string;
  name: string;
  uplinkAssetId: string | null;
};

export type TopologyNode<T> = {
  device: T;
  depth: number;
  /** Horizontal slot (leaf columns, parents centred over their children). */
  x: number;
  parentId: string | null;
};

export function buildTopology<T extends TopologyDevice>(
  devices: T[],
): { nodes: TopologyNode<T>[]; columns: number; depth: number } {
  const byId = new Map(devices.map((device) => [device.id, device]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const device of devices) {
    const parent = device.uplinkAssetId;
    if (parent && parent !== device.id && byId.has(parent)) {
      const list = children.get(parent) ?? [];
      list.push(device);
      children.set(parent, list);
    } else {
      roots.push(device);
    }
  }
  const sortByName = (list: T[]) =>
    list.sort((a, b) => a.name.localeCompare(b.name, "de-CH"));
  const nodes: TopologyNode<T>[] = [];
  const placed = new Set<string>();
  let column = 0;
  let maxDepth = 0;

  function place(device: T, depth: number, parentId: string | null): number {
    placed.add(device.id);
    maxDepth = Math.max(maxDepth, depth);
    const kids = sortByName([...(children.get(device.id) ?? [])]).filter(
      (child) => !placed.has(child.id),
    );
    let x: number;
    if (kids.length === 0) {
      x = column;
      column += 1;
    } else {
      const xs = kids.map((child) => place(child, depth + 1, device.id));
      x = (xs[0]! + xs[xs.length - 1]!) / 2;
    }
    nodes.push({ device, depth, x, parentId });
    return x;
  }

  for (const root of sortByName(roots)) place(root, 0, null);
  // Devices in an uplink loop have no root: start the loop at its first device.
  for (const device of sortByName([...devices])) {
    if (!placed.has(device.id)) place(device, 0, null);
  }
  return { nodes, columns: column, depth: maxDepth };
}
