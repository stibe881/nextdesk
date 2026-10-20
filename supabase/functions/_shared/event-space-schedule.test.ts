import {
  eventSpaceConflictSnapshot,
  isEventSpaceConflictSnapshot,
  MAX_EVENT_SPACE_OCCURRENCES,
  parseEventSpaceEquipment,
  parseEventSpaceOccurrences,
  summarizeEventSpaceConflicts,
} from "./event-space-schedule.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test(
  "event space occurrences accept only a bounded chronological series",
  () => {
    const weekly = parseEventSpaceOccurrences(
      [
        {
          startsAt: "2026-11-03T08:00:00.000Z",
          endsAt: "2026-11-03T10:00:00.000Z",
        },
        {
          startsAt: "2026-11-10T08:00:00.000Z",
          endsAt: "2026-11-10T10:00:00.000Z",
        },
      ],
      "weekly",
    );
    assert(
      weekly?.length === 2,
      "A valid explicit weekly series must be retained.",
    );

    const invalidNone = parseEventSpaceOccurrences(
      [
        {
          startsAt: "2026-11-03T08:00:00.000Z",
          endsAt: "2026-11-03T10:00:00.000Z",
        },
        {
          startsAt: "2026-11-10T08:00:00.000Z",
          endsAt: "2026-11-10T10:00:00.000Z",
        },
      ],
      "none",
    );
    assert(
      invalidNone === null,
      "A non-recurring request must contain exactly one occurrence.",
    );

    const outOfOrder = parseEventSpaceOccurrences(
      [
        {
          startsAt: "2026-11-10T08:00:00.000Z",
          endsAt: "2026-11-10T10:00:00.000Z",
        },
        {
          startsAt: "2026-11-03T08:00:00.000Z",
          endsAt: "2026-11-03T10:00:00.000Z",
        },
      ],
      "weekly",
    );
    assert(outOfOrder === null, "Unordered occurrences must be rejected.");

    const notWeekly = parseEventSpaceOccurrences(
      [
        {
          startsAt: "2026-11-03T08:00:00.000Z",
          endsAt: "2026-11-03T10:00:00.000Z",
        },
        {
          startsAt: "2026-11-11T08:00:00.000Z",
          endsAt: "2026-11-11T10:00:00.000Z",
        },
      ],
      "weekly",
    );
    assert(
      notWeekly === null,
      "A weekly series must preserve its exact calendar-week cadence.",
    );

    const monthly = parseEventSpaceOccurrences(
      [
        {
          startsAt: "2026-01-31T08:00:00.000Z",
          endsAt: "2026-01-31T10:00:00.000Z",
        },
        {
          startsAt: "2026-02-28T08:00:00.000Z",
          endsAt: "2026-02-28T10:00:00.000Z",
        },
        {
          startsAt: "2026-03-31T07:00:00.000Z",
          endsAt: "2026-03-31T09:00:00.000Z",
        },
      ],
      "monthly",
    );
    assert(
      monthly?.length === 3,
      "A monthly series must keep its calendar day or the month end.",
    );

    const tooMany = Array.from(
      { length: MAX_EVENT_SPACE_OCCURRENCES + 1 },
      (_, index) => ({
        startsAt: new Date(Date.UTC(2026, 10, 3 + index * 7, 8)).toISOString(),
        endsAt: new Date(Date.UTC(2026, 10, 3 + index * 7, 10)).toISOString(),
      }),
    );
    assert(
      parseEventSpaceOccurrences(tooMany, "weekly") === null,
      "The API must not accept an unbounded event series.",
    );
    assert(
      parseEventSpaceOccurrences(tooMany.slice(0, 13), "monthly") === null,
      "A monthly series must stay within the visible, manageable planning year.",
    );
  },
);

Deno.test("event space equipment is allowlisted and deduplicated", () => {
  const equipment = parseEventSpaceEquipment([
    "projector",
    "videocall",
    "projector",
  ]);
  assert(
    equipment?.join(",") === "projector,videocall",
    "Repeated equipment must result in exactly one request per resource.",
  );
  assert(
    parseEventSpaceEquipment(["projector", "unbounded-provider-resource"]) ===
      null,
    "Unknown technical resources must not become persisted planning data.",
  );
});

Deno.test(
  "event space conflict summaries expose counts rather than foreign request details",
  () => {
    const conflicts = summarizeEventSpaceConflicts({
      roomConflictingRequestIds: ["request-a", "request-a", "request-b"],
      equipmentConflictingRequestIds: ["request-b", "request-c"],
    });
    assert(
      conflicts.hasConflicts,
      "Conflicting request IDs must result in a warning.",
    );
    assert(
      conflicts.roomConflictCount === 2,
      "Room conflicts must be counted once per request.",
    );
    assert(
      conflicts.equipmentConflictCount === 2,
      "Equipment conflicts must be counted once per request.",
    );
    assert(
      Object.keys(conflicts).every(
        (key) => key.includes("Count") || key === "hasConflicts",
      ),
      "The summary must not contain foreign titles, persons, rooms or time details.",
    );
  },
);

Deno.test(
  "event space conflict snapshots bind an approval to the exact conflict sets",
  async () => {
    const first = await eventSpaceConflictSnapshot({
      roomConflictingRequestIds: ["request-b", "request-a", "request-a"],
      equipmentConflictingRequestIds: ["request-c"],
    });
    const reordered = await eventSpaceConflictSnapshot({
      roomConflictingRequestIds: ["request-a", "request-b"],
      equipmentConflictingRequestIds: ["request-c"],
    });
    const changed = await eventSpaceConflictSnapshot({
      roomConflictingRequestIds: ["request-a", "request-d"],
      equipmentConflictingRequestIds: ["request-c"],
    });
    assert(
      first === reordered &&
        first !== changed &&
        isEventSpaceConflictSnapshot(first),
      "A confirmation must be stable for the same conflict set and invalid for a changed one.",
    );
  },
);
