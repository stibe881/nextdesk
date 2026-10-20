export const EVENT_SPACE_WORKSPACE_PAGE_SIZE = 250;

export function eventSpaceWorkspacePage<T>(rows: readonly T[], offset: number) {
  const items = rows.slice(0, EVENT_SPACE_WORKSPACE_PAGE_SIZE);
  const hasMore = rows.length > EVENT_SPACE_WORKSPACE_PAGE_SIZE;
  return {
    items,
    hasMore,
    nextOffset: hasMore ? offset + EVENT_SPACE_WORKSPACE_PAGE_SIZE : null,
  };
}
