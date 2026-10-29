/**
 * Der Bereich «Planung & Betrieb» erhält nur dann einen zusammengefassten
 * Raumplanungsbadge, wenn er geschlossen ist. Der Wert stammt bereits aus dem
 * serverautorisierten Raumplanungs-Workspace und begründet im Browser keine
 * zusätzliche Berechtigung.
 */
export function collapsedNavigationCategoryAttentionCount(input: {
  categoryExpanded: boolean;
  categoryId: string;
  eventSpaceAttentionCount: number | null;
  eventSpaceNavigationAccess: boolean;
}): number | null {
  const attentionCount = input.eventSpaceAttentionCount;
  if (
    input.categoryId !== "navigation-category-operations" ||
    input.categoryExpanded ||
    !input.eventSpaceNavigationAccess ||
    attentionCount === null ||
    !Number.isSafeInteger(attentionCount) ||
    attentionCount <= 0
  ) {
    return null;
  }

  return attentionCount;
}
