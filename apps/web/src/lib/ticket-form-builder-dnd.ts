export function resolveTicketFieldDropPosition(
  sourceSectionId: string,
  sourceIndex: number,
  targetSectionId: string,
  targetInsertionIndex: number,
): number {
  if (
    sourceSectionId === targetSectionId &&
    sourceIndex >= 0 &&
    sourceIndex < targetInsertionIndex
  ) {
    return targetInsertionIndex - 1;
  }
  return targetInsertionIndex;
}

export function ticketFieldDropInsertionIndex(
  pointerY: number,
  targetTop: number,
  targetHeight: number,
  targetIndex: number,
): number {
  return pointerY > targetTop + targetHeight / 2
    ? targetIndex + 1
    : targetIndex;
}
