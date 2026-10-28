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

Deno.test(
  "event space attention and email clarification actions stay server-authorized",
  () => {
    assert(
      source.includes('type: "navigationSummary"') &&
        source.includes("attentionCount") &&
        source.includes(
          "responsible_user_id.is.null,status.eq.clarification_required",
        ),
      "The navigation badge must be a server-side aggregate of unassigned or clarification requests.",
    );
    assert(
      source.includes('type: "assignResponsible"') &&
        source.includes('type: "resolveEmailIntake"') &&
        source.includes('"event.spaces.manage"'),
      "Assignment and clarification resolution must remain manager-protected actions.",
    );
    assert(
      source.includes('neq("status", "clarification_required")') &&
        source.includes('rpc(\n    "resolve_event_space_email_ticket_request"'),
      "A clarification case must not be promoted through a plain status update.",
    );
  },
);

Deno.test(
  "manual email-intake recovery stays explicit, bounded and private",
  () => {
    assert(
      source.includes('type: "retryEmailTicketIntake"') &&
        source.includes("retryEmailTicketIntake(") &&
        source.includes("claim_event_space_email_ticket_intake_retry"),
      "A recovery must use a dedicated one-item server-side claim rather than a scheduler or list replay.",
    );
    assert(
      source.includes("await requireMembership(client, tenantId)") &&
        source.includes(
          'await requirePermission(client, tenantId, "event.spaces.manage")',
        ),
      "Manual recovery must require an active membership and event-space management permission server-side.",
    );
    assert(
      source.includes("eventSpaceEmailIntakeBodyFromStoredTicket") &&
        source.includes('return { state: "unavailable" as const }'),
      "The Edge Function may replay a stored body privately but must return only a neutral outcome to the browser.",
    );
    assert(
      source.includes(
        'select(\n            "ticket_id, status, manual_retry_count, retry_lease_expires_at",',
      ) && !source.includes('"ticket_id, subject, description"'),
      "Recovery lists must expose outbox state only, without ticket or e-mail content.",
    );
    assert(
      !source.includes("setInterval") && !source.includes("cron"),
      "Manual recovery must not introduce automatic retries.",
    );
  },
);
