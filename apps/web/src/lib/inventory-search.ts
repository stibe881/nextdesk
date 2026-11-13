type SearchableItem = {
  name: string;
  articleNumber: string | null;
  locationName: string | null;
};

/** Suche in der Artikelliste: alle Wörter müssen in Name, Artikelnummer oder Lagerort vorkommen. */
export function filterInventoryItems<T extends SearchableItem>(
  items: readonly T[],
  query: string,
): readonly T[] {
  const terms = query.toLocaleLowerCase("de-CH").split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((item) => {
    const haystack = [item.name, item.articleNumber, item.locationName]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLocaleLowerCase("de-CH");
    return terms.every((term) => haystack.includes(term));
  });
}
