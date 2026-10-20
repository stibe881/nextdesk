import {
  EVENT_SPACE_WORKSPACE_PAGE_SIZE,
  eventSpaceWorkspacePage,
} from "./event-space-pagination.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test(
  "event-space workspace pagination exposes a second page after 250 requests",
  () => {
    const rows = Array.from({ length: 251 }, (_, index) => index);
    const first = eventSpaceWorkspacePage(rows, 0);
    const second = eventSpaceWorkspacePage(rows.slice(250), 250);

    assert(
      first.items.length === EVENT_SPACE_WORKSPACE_PAGE_SIZE &&
        first.hasMore &&
        first.nextOffset === 250,
      "The first page must show 250 entries and explicitly expose the next page.",
    );
    assert(
      second.items.length === 1 &&
        !second.hasMore &&
        second.nextOffset === null,
      "The remaining room request must be reachable through the second page.",
    );
  },
);
