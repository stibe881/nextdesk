import { assertEquals } from "jsr:@std/assert@1";
import {
  computeWorkload,
  remainingMinutes,
  type WorkItem,
  workWindow,
} from "./project-workload.ts";

const settings = { ticketMinutes: 30, dailyCapacityMinutes: 480 };
const item = (extra: Partial<WorkItem>): WorkItem => ({
  kind: "project_task",
  id: "x",
  projectId: "p",
  title: "Aufgabe",
  assigneeId: "anna",
  startsOn: null,
  dueOn: null,
  estimatedMinutes: null,
  progressPercent: 0,
  ...extra,
});

// 2026-12-07 is a Monday.
const today = "2026-12-07";

Deno.test("remaining effort honours progress and the ticket flat rate", () => {
  assertEquals(
    remainingMinutes(
      item({ estimatedMinutes: 600, progressPercent: 25 }),
      settings,
    ),
    450,
  );
  assertEquals(remainingMinutes(item({ kind: "ticket" }), settings), 30);
  assertEquals(
    remainingMinutes(
      item({ kind: "service_task", estimatedMinutes: 45 }),
      settings,
    ),
    45,
  );
  assertEquals(remainingMinutes(item({}), settings), 0);
});

Deno.test(
  "work is spread from today to the due date, overdue falls on today",
  () => {
    assertEquals(
      workWindow(item({ startsOn: "2026-12-01", dueOn: "2026-12-09" }), today),
      ["2026-12-07", "2026-12-08", "2026-12-09"],
    );
    assertEquals(workWindow(item({ dueOn: "2026-12-01" }), today), [
      "2026-12-07",
    ]);
    assertEquals(
      workWindow(item({ startsOn: "2026-12-12", dueOn: "2026-12-13" }), today),
      ["2026-12-14"],
    );
  },
);

Deno.test(
  "project tasks, tickets and service tasks add up per person and day",
  () => {
    const [anna, ben] = computeWorkload(
      [
        item({ id: "t1", estimatedMinutes: 960, dueOn: "2026-12-08" }),
        item({
          id: "t2",
          kind: "ticket",
          projectId: null,
          dueOn: "2026-12-01",
        }),
        item({
          id: "t3",
          kind: "service_task",
          projectId: null,
          estimatedMinutes: 60,
          startsOn: "2026-12-09",
          dueOn: "2026-12-09",
        }),
        item({
          id: "t4",
          assigneeId: "ben",
          estimatedMinutes: 240,
          dueOn: "2026-12-11",
        }),
        item({ id: "t5", assigneeId: null, estimatedMinutes: 999 }),
        item({
          id: "t6",
          assigneeId: "ben",
          estimatedMinutes: 100,
          startsOn: "2027-01-04",
          dueOn: "2027-01-05",
        }),
      ],
      "2026-12-07",
      "2026-12-11",
      today,
      settings,
    );
    assertEquals(anna.userId, "anna");
    assertEquals(
      anna.days.map((day) => day.minutes),
      [510, 480, 60, 0, 0],
    );
    assertEquals(anna.days[0].ticketMinutes, 30);
    assertEquals(anna.overloadedDays, 1);
    assertEquals(anna.totalMinutes, 1050);
    assertEquals(anna.utilizationPercent, 44);
    assertEquals(anna.counts, { project_task: 1, ticket: 1, service_task: 1 });
    assertEquals(anna.items.find((entry) => entry.id === "t2")?.overdue, true);

    assertEquals(
      ben.days.map((day) => day.minutes),
      [48, 48, 48, 48, 48],
    );
    // Work outside the visible range is not listed.
    assertEquals(
      ben.items.map((entry) => entry.id),
      ["t4"],
    );
  },
);
