/**
 * Lagerbereiche: Beim Einbuchen können mehrere aufeinanderfolgende Lagerplätze
 * («G10.2.1» bis «G10.2.4») als ein Lagerplatz gebucht werden. Nur die letzte
 * Zahl darf sich unterscheiden. Die App bietet nur passende Endplätze an; ob
 * alle Plätze dazwischen existieren und frei sind, prüft der Server.
 */
export type AreaLocation = { id: string; name: string };

/** «G10.2.4» → Präfix «G10.2.», Zahl 4; null ohne Zahl am Ende. */
export function splitPlaceName(
  name: string,
): { prefix: string; number: number } | null {
  const match = /^(.*?)(\d+)$/.exec(name.trim());
  if (!match) return null;
  const number = Number(match[2]);
  return Number.isSafeInteger(number) ? { prefix: match[1]!, number } : null;
}

/** Lagerplätze, die mit dem Startplatz einen Bereich bilden können, aufsteigend. */
export function areaEndOptions<T extends AreaLocation>(
  locations: readonly T[],
  startId: string | null,
): T[] {
  const start = locations.find((location) => location.id === startId);
  const first = start ? splitPlaceName(start.name) : null;
  if (!start || !first) return [];
  return locations
    .filter((location) => {
      if (location.id === start.id) return false;
      const parts = splitPlaceName(location.name);
      return (
        parts !== null &&
        parts.prefix.toLowerCase() === first.prefix.toLowerCase() &&
        parts.number > first.number
      );
    })
    .sort(
      (left, right) =>
        splitPlaceName(left.name)!.number - splitPlaceName(right.name)!.number,
    );
}
