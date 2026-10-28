export type TicketCatalogSearchItem = {
  id: string;
  kind: "asset" | "problem" | "service";
  label: string;
  description: string;
};

/**
 * Der Überblick braucht den Katalog für Verknüpfungen; lesende Personen erst,
 * wenn sie den Bereich der betroffenen Elemente öffnen.
 */
export function shouldLoadTicketCatalog(
  canUpdateTicket: boolean,
  isClosureContextOpen: boolean,
): boolean {
  return canUpdateTicket || isClosureContextOpen;
}

function normalizedSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de-CH")
    .trim();
}

/**
 * Filtert ausschliesslich bereits vom Server gelieferte, zugängliche Einträge.
 * Die Funktion löst keine neue Suche und keine Mutation aus.
 */
export function searchTicketCatalogItems<T extends TicketCatalogSearchItem>(
  items: readonly T[],
  query: string,
  limit = 16,
): T[] {
  const terms = normalizedSearchText(query).split(/\s+/u).filter(Boolean);
  if (terms.length === 0 || limit < 1) return [];

  return items
    .filter((item) => {
      const searchable = normalizedSearchText(
        `${item.kind} ${item.label} ${item.description}`,
      );
      return terms.every((term) => searchable.includes(term));
    })
    .slice(0, limit);
}
