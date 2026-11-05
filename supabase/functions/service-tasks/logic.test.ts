import { assertEquals } from "jsr:@std/assert@1";
import { normalizeRule } from "../_shared/service-task-recurrence.ts";
import {
  fulfillment,
  planOccurrences,
  swissDateTimeToUtc,
  weekBounds,
} from "./logic.ts";

Deno.test("Swiss local time to UTC in winter and summer time", () => {
  assertEquals(
    swissDateTimeToUtc("2026-11-05", "16:00")?.toISOString(),
    "2026-11-05T15:00:00.000Z",
  );
  assertEquals(
    swissDateTimeToUtc("2026-07-01", "16:00")?.toISOString(),
    "2026-07-01T14:00:00.000Z",
  );
});

Deno.test(
  "first generation starts today, without a backlog, with lead time",
  () => {
    const recurrence = normalizeRule({
      frequency: "weekly",
      interval: 1,
      weekdays: [1, 4],
      skipNonWorkdays: true,
    })!;
    const { planned, generatedUntil } = planOccurrences(
      {
        recurrence,
        starts_on: "2026-10-01",
        ends_on: null,
        due_time: "12:00:00",
        lead_days: 2,
        generated_until: null,
      },
      "2026-11-05",
      10,
    );
    assertEquals(
      planned.map((entry) => entry.due_on),
      ["2026-11-05", "2026-11-09", "2026-11-12"],
    );
    assertEquals(planned[0].due_at, "2026-11-05T11:00:00.000Z");
    assertEquals(planned[1].visible_from, "2026-11-07");
    assertEquals(generatedUntil, "2026-11-15");
  },
);

Deno.test(
  "generation continues after the stored horizon and honours the end",
  () => {
    const recurrence = normalizeRule({
      frequency: "daily",
      interval: 1,
      skipNonWorkdays: false,
    })!;
    const { planned } = planOccurrences(
      {
        recurrence,
        starts_on: "2026-11-01",
        ends_on: "2026-11-12",
        due_time: "08:00",
        lead_days: 0,
        generated_until: "2026-11-10",
      },
      "2026-11-05",
      30,
    );
    assertEquals(
      planned.map((entry) => entry.due_on),
      ["2026-11-11", "2026-11-12"],
    );
  },
);

Deno.test("week bounds and fulfilment over the last 30 days", () => {
  assertEquals(weekBounds("2026-11-05"), {
    start: "2026-11-02",
    end: "2026-11-08",
  });
  const now = new Date("2026-11-05T10:00:00Z");
  assertEquals(
    fulfillment(
      [
        // on time
        {
          status: "done",
          due_on: "2026-11-02",
          due_at: "2026-11-02T15:00:00Z",
          completed_at: "2026-11-02T09:00:00Z",
        },
        // late
        {
          status: "done",
          due_on: "2026-11-03",
          due_at: "2026-11-03T15:00:00Z",
          completed_at: "2026-11-04T09:00:00Z",
        },
        // skipped counts as handled
        {
          status: "skipped",
          due_on: "2026-10-20",
          due_at: "2026-10-20T14:00:00Z",
          completed_at: "2026-10-20T08:00:00Z",
        },
        // open and overdue counts as missed
        {
          status: "open",
          due_on: "2026-11-04",
          due_at: "2026-11-04T15:00:00Z",
          completed_at: null,
        },
        // open, due later today: not yet counted
        {
          status: "open",
          due_on: "2026-11-05",
          due_at: "2026-11-05T15:00:00Z",
          completed_at: null,
        },
      ],
      "2026-11-05",
      now,
    ),
    { onTime: 2, total: 4, percent: 50 },
  );
});
