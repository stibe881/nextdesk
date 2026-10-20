const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test(
  "event spaces are authenticated, tenant-scoped and not a ticket automation",
  () => {
    assert(
      source.includes(
        '{ auth: "user", cors: "disabled", errors: { detailed: false } }',
      ),
      "The event-spaces function must require an authenticated JWT.",
    );
    assert(
      source.includes('"event.spaces.request"') &&
        source.includes('"event.spaces.manage"'),
      "Request and management permissions must remain separate.",
    );
    assert(
      source.includes("await requireMembership(client, tenantId)"),
      "Workspace reads must require active tenant membership.",
    );
    assert(
      source.includes("event_space_permission_denied") &&
        source.includes("if (!canRequest && !canManage)"),
      "Workspace reads must fail closed without a room request or management permission.",
    );
    assert(
      /await requirePermission\(\s*context\.supabase,\s*action\.tenantId,\s*"event\.spaces\.request"/m.test(
        source,
      ),
      "Room request creation must be checked server-side.",
    );
    assert(
      /await requirePermission\(\s*context\.supabase,\s*action\.tenantId,\s*"event\.spaces\.manage"/m.test(
        source,
      ),
      "Room and task management must be checked server-side.",
    );
    assert(
      source.includes("event_space_conflicts_confirmation_required"),
      "A resource collision must require an explicit confirmation.",
    );
    assert(
      source.includes("MAX_EVENT_SPACE_OCCURRENCES") === false,
      "The endpoint must import the bounded occurrence parser rather than duplicate an unsafe limit.",
    );
    assert(
      !source.includes('from("tickets")') && !source.includes("createTicket"),
      "A room request must never create or mutate a ticket automatically.",
    );
    assert(
      !source.includes("setInterval") && !source.includes("cron"),
      "The planning endpoint must not introduce a scheduler.",
    );
    assert(
      source.includes("request.body.getReader()") &&
        !source.includes("request.arrayBuffer()"),
      "The endpoint must bound streamed request bodies before buffering them.",
    );
    assert(
      source.includes('rpc("create_event_space_request_series"') &&
        source.includes("MAX_CONFLICT_CANDIDATES + 1"),
      "Final creation must use the locked database operation and previews must fail closed when their candidate limit is reached.",
    );
    assert(
      source.includes("eventSpaceConflictSnapshot") &&
        source.includes("p_conflict_snapshot") &&
        source.includes("conflictSnapshot"),
      "An approval must be bound to the opaque conflict snapshot checked by the final operation.",
    );
    assert(
      source.includes("offset + EVENT_SPACE_WORKSPACE_PAGE_SIZE") &&
        source.includes("eventSpaceWorkspacePage") &&
        source.includes("nextOffset"),
      "Workspace reads must expose a visible next page rather than silently omitting later room requests.",
    );
    assert(
      !source.includes(
        '.from("event_spaces")\n      .select("id, name, kind, location, capacity")\n      .eq("tenant_id", tenantId)\n      .eq("active", true)\n      .order("name")\n      .limit(200)',
      ),
      "Active rooms must not be silently cut off after 200 entries.",
    );
  },
);

Deno.test("event space responses keep conflict details aggregated", () => {
  assert(
    source.includes("summarizeEventSpaceConflicts"),
    "The API must return a summary instead of conflict source records.",
  );
  assert(
    !source.includes("conflictingTitle") &&
      !source.includes("conflictingOrganizer"),
    "The API must not return personal or event content from conflicting requests.",
  );
});
