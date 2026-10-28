/**
 * Erlaubt genau eine geöffnete Navigationskategorie. Ein zweiter Klick auf
 * die offene Überschrift schliesst auch diese Kategorie bewusst wieder.
 */
export function nextExpandedAccordionId(
  currentId: string | null,
  requestedId: string,
): string | null {
  return currentId === requestedId ? null : requestedId;
}
