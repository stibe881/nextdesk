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

/** A rack recorded by the user (infrastructure_racks). */
export type RackDefinition = {
  id: string;
  name: string;
  locationId: string | null;
  locationName: string | null;
  heightUnits: number;
  notes: string | null;
};

export type Rack<T extends RackDevice> = {
  key: string;
  /** Recorded rack; null for a rack only derived from device data. */
  definition: RackDefinition | null;
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

export function rackKey(locationName: string | null, name: string): string {
  return `${locationName ?? ""}\u0000${name.trim().toLocaleLowerCase("de-CH")}`;
}

export function buildRacks<T extends RackDevice>(
  devices: T[],
  definitions: readonly RackDefinition[] = [],
): Rack<T>[] {
  const groups = new Map<string, T[]>();
  for (const device of devices) {
    if (!device.rack?.trim()) continue;
    const key = rackKey(device.locationName, device.rack);
    groups.set(key, [...(groups.get(key) ?? []), device]);
  }
  const definedByKey = new Map(
    definitions.map((definition) => [
      rackKey(definition.locationName, definition.name),
      definition,
    ]),
  );
  for (const key of definedByKey.keys()) {
    if (!groups.has(key)) groups.set(key, []);
  }
  return (
    [...groups.entries()]
      .map(([key, members]) => {
        const definition = definedByKey.get(key) ?? null;
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
          definition,
          name: definition?.name ?? members[0]!.rack!.trim(),
          locationName: definition
            ? definition.locationName
            : members[0]!.locationName,
          // Recorded height, else a standard height at least as tall as the
          // highest device.
          units: definition
            ? Math.max(definition.heightUnits, top)
            : ([12, 24, 42, 48].find((size) => size >= top) ?? top),
          placed: placed.sort((a, b) => b.start - a.start),
          unplaced,
        };
      })
      // Alphabetical by name («Rack 2» before «Rack 10»), then location.
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, "de-CH", {
            numeric: true,
            sensitivity: "base",
          }) ||
          (a.locationName ?? "").localeCompare(b.locationName ?? "", "de-CH"),
      )
  );
}
