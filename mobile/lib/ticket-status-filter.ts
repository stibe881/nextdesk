/** Mehrfachauswahl der Status in der Ticketliste ("A|B", "all" = kein Filter, wie im Web). */
export function splitStatusFilter(value: string | undefined): string[] {
  if (!value || value === "all") return [];
  return value
    .split("|")
    .map((label) => label.trim())
    .filter(Boolean);
}

export function toggleStatus(
  selected: readonly string[],
  label: string,
): string[] {
  return selected.includes(label)
    ? selected.filter((entry) => entry !== label)
    : [...selected, label];
}

export function matchesStatusSelection(
  status: string,
  selected: readonly string[],
): boolean {
  return selected.length === 0 || selected.includes(status);
}

/** Status-Chips: gewählte zuerst nicht nötig, aber auch gewählte ohne Treffer bleiben sichtbar. */
export function statusFilterOptions(
  ticketStatuses: readonly string[],
  selected: readonly string[],
): string[] {
  const options = new Set<string>(ticketStatuses.filter(Boolean));
  for (const label of selected) options.add(label);
  return [...options].sort((a, b) => a.localeCompare(b, "de-CH"));
}
