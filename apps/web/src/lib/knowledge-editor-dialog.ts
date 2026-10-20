export function shouldCloseKnowledgeEditor(
  key: string,
  isBusy: boolean,
): boolean {
  return key === "Escape" && !isBusy;
}

export function knowledgeEditorDialogTabIndex(isBusy: boolean): number {
  return isBusy ? 0 : -1;
}
