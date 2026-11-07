/** Rack layout: devices placed by height unit (HE), grouped per rack. */
export type RackDevice = {
  id: string;
  name: string;
  category: string;
  rack: string | null;
  rackUnit: string | null;
  locationName: string | null;
  uplinkAssetId: string | null;
};

export type PlacedDevice<T extends RackDevice> = {
  device: T;
  /** Lowest unit (1 = bottom). */
  start: number;
  /** Number of units. */
  height: number;
};

export type Rack<T extends RackDevice> = {
  key: string;
  name: string;
  locationName: string | null;
  units: number;
  placed: PlacedDevice<T>[];
  unplaced: T[];
};

/** «12», «12-13», «HE 12», «U12–U14» → start and height; null if unknown. */
export function parseRackUnits(
  value: string | null | undefined,
): { start: number; height: number } | null {
  if (!value) return null;
  const numbers = value.match(/\d{1,3}/g)?.map(Number) ?? [];
  if (numbers.length === 0) return null;
  const [first, second] = numbers;
  if (!first || first > 60) return null;
  if (second && second >= first && second <= 60) {
    return { start: first, height: second - first + 1 };
  }
  return { start: first, height: 1 };
}

export function buildRacks<T extends RackDevice>(devices: T[]): Rack<T>[] {
  const groups = new Map<string, T[]>();
  for (const device of devices) {
    if (!device.rack?.trim()) continue;
    const key = `${device.locationName ?? ""}\u0000${device.rack.trim()}`;
    groups.set(key, [...(groups.get(key) ?? []), device]);
  }
  return [...groups.entries()]
    .map(([key, members]) => {
      const placed: PlacedDevice<T>[] = [];
      const unplaced: T[] = [];
      for (const device of members) {
        const units = parseRackUnits(device.rackUnit);
        if (units) placed.push({ device, ...units });
        else unplaced.push(device);
      }
      const top = Math.max(
        0,
        ...placed.map((entry) => entry.start + entry.height - 1),
      );
      return {
        key,
        name: members[0]!.rack!.trim(),
        locationName: members[0]!.locationName,
        // Standard heights, at least as tall as the highest device.
        units: [12, 24, 42, 48].find((size) => size >= top) ?? top,
        placed: placed.sort((a, b) => b.start - a.start),
        unplaced,
      };
    })
    .sort(
      (a, b) =>
        (a.locationName ?? "").localeCompare(b.locationName ?? "", "de-CH") ||
        a.name.localeCompare(b.name, "de-CH", { numeric: true }),
    );
}
