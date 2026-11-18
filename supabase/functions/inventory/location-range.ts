/**
 * Lagerbereiche: Beim Einlagern können mehrere aufeinanderfolgende Lagerplätze
 * als ein Lagerplatz gebucht werden, z. B. «G10.2.1» bis «G10.2.4». Nur die
 * letzte Zahl darf sich unterscheiden; alle Plätze dazwischen müssen als aktive
 * Lagerorte existieren. Die Funktion hier prüft das rein auf den Namen der
 * Lagerorte; Belegung und Atomarität erzwingt die Datenbank
 * (post_inventory_range_receipt, Migration 0368).
 */

export const MAX_RANGE_LOCATIONS = 50;

export type RangeLocation = {
  id: string;
  name: string;
  active: boolean;
};

export type RangeFailureCode =
  | "range_start_unknown"
  | "range_not_numbered"
  | "range_different_prefix"
  | "range_reversed"
  | "range_too_large"
  | "range_place_missing"
  | "range_place_ambiguous";

export type RangeResult =
  | {
      ok: true;
      /** Place ids in ascending order; the first one is the booking anchor. */
      locationIds: string[];
      label: string;
    }
  | { ok: false; code: RangeFailureCode; message: string; missing?: string[] };

type PlaceName = { prefix: string; digits: string; number: number };

/** «G10.2.4» → prefix «G10.2.», digits «4». Null when the name has no trailing number. */
export function splitPlaceName(name: string): PlaceName | null {
  const match = /^(.*?)(\d+)$/.exec(name.trim());
  if (!match) return null;
  const digits = match[2]!;
  const number = Number(digits);
  if (!Number.isSafeInteger(number)) return null;
  return { prefix: match[1]!, digits, number };
}

function failure(
  code: RangeFailureCode,
  message: string,
  missing?: string[],
): RangeResult {
  return { ok: false, code, message, ...(missing ? { missing } : {}) };
}

/**
 * Resolves «from place» to «to place» into the ordered places of the area.
 * The result is all-or-nothing: if any place is missing or inactive, nothing is
 * resolved and the missing places are named.
 */
export function resolveLocationRange(
  locations: readonly RangeLocation[],
  startId: string,
  endId: string,
): RangeResult {
  const start = locations.find((location) => location.id === startId);
  const end = locations.find((location) => location.id === endId);
  if (!start?.active || !end?.active) {
    return failure(
      "range_start_unknown",
      "Der Lagerplatz existiert nicht oder ist nicht aktiv.",
    );
  }
  const first = splitPlaceName(start.name);
  const last = splitPlaceName(end.name);
  if (!first || !last) {
    return failure(
      "range_not_numbered",
      "Nur nummerierte Lagerplätze (z. B. G10.2.1) lassen sich als Bereich buchen.",
    );
  }
  if (first.prefix.toLowerCase() !== last.prefix.toLowerCase()) {
    return failure(
      "range_different_prefix",
      `Nur die letzte Zahl darf sich unterscheiden: ${start.name} bis ${end.name} ist kein zulässiger Bereich.`,
    );
  }
  if (last.number < first.number) {
    return failure(
      "range_reversed",
      `Der Bereich muss aufsteigend sein: ${start.name} bis ${end.name}.`,
    );
  }
  const count = last.number - first.number + 1;
  if (count > MAX_RANGE_LOCATIONS) {
    return failure(
      "range_too_large",
      `Ein Bereich umfasst höchstens ${MAX_RANGE_LOCATIONS} Lagerplätze.`,
    );
  }

  const byName = new Map<string, RangeLocation[]>();
  for (const location of locations) {
    if (!location.active) continue;
    const key = location.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), location]);
  }
  const width = first.digits.length;
  const ids: string[] = [];
  const missing: string[] = [];
  const ambiguous: string[] = [];
  for (let number = first.number; number <= last.number; number += 1) {
    const digits =
      first.digits.startsWith("0") && width > 1
        ? String(number).padStart(width, "0")
        : String(number);
    const expected = `${first.prefix}${digits}`;
    const matches = byName.get(expected.toLowerCase()) ?? [];
    if (matches.length === 0) missing.push(expected);
    else if (matches.length > 1) ambiguous.push(expected);
    else ids.push(matches[0]!.id);
  }
  if (missing.length > 0) {
    return failure(
      "range_place_missing",
      `Diese Lagerplätze existieren nicht oder sind nicht aktiv: ${missing.join(
        ", ",
      )}. Es wurde nichts gebucht.`,
      missing,
    );
  }
  if (ambiguous.length > 0) {
    return failure(
      "range_place_ambiguous",
      `Diese Lagerplätze sind mehrfach vorhanden: ${ambiguous.join(
        ", ",
      )}. Es wurde nichts gebucht.`,
      ambiguous,
    );
  }
  return {
    ok: true,
    locationIds: ids,
    label: `${start.name.trim()}–${end.name.trim()}`,
  };
}
