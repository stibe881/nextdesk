/**
 * A collapsed navigation category shows the sum of the attention badges of
 * its menu items (e.g. Raumplanung, Eintritte, Shop). The single counts come
 * from server-authorised summaries; the browser grants no extra access.
 */
export function collapsedNavigationCategoryAttentionCount(input: {
  categoryExpanded: boolean;
  itemCounts: readonly (number | null | undefined)[];
}): number | null {
  if (input.categoryExpanded) return null;
  const total = input.itemCounts.reduce<number>(
    (sum, count) =>
      typeof count === "number" && Number.isSafeInteger(count) && count > 0
        ? sum + count
        : sum,
    0,
  );
  return total > 0 ? total : null;
}

/** A single menu item badge: only positive, safe integers are shown. */
export function navigationItemAttentionCount(
  count: number | null | undefined,
): number | null {
  return typeof count === "number" && Number.isSafeInteger(count) && count > 0
    ? count
    : null;
}
