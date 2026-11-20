import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  addWorkdays,
  computeSchedule,
  hasDependencyCycle,
  ScheduleCycleError,
  type ScheduleDependency,
  type ScheduleTask,
  workdaysInRange,
} from "./project-schedule.ts";

const task = (
  id: string,
  startsOn: string | null,
  dueOn: string | null,
  extra: Partial<ScheduleTask> = {},
): ScheduleTask => ({
  id,
  parentId: null,
  startsOn,
  dueOn,
  done: false,
  ...extra,
});

const dependency = (
  predecessorId: string,
  successorId: string,
  extra: Partial<ScheduleDependency> = {},
): ScheduleDependency => ({
  predecessorId,
  successorId,
  type: "finish_to_start",
  lagDays: 0,
  ...extra,
});

Deno.test("workdays skip weekends in both directions", () => {
  // 2026-12-04 is a Friday.
  assertEquals(addWorkdays("2026-12-04", 1), "2026-12-07");
  assertEquals(addWorkdays("2026-12-07", -1), "2026-12-04");
  assertEquals(addWorkdays("2026-12-05", 0), "2026-12-07");
  assertEquals(workdaysInRange("2026-12-04", "2026-12-08"), [
    "2026-12-04",
    "2026-12-07",
    "2026-12-08",
  ]);
});

Deno.test(
  "a delayed predecessor pushes the whole chain and keeps durations",
  () => {
    const changes = computeSchedule(
      [
        // A now ends on Tuesday 2026-12-08 instead of the Friday before.
        task("a", "2026-12-01", "2026-12-08"),
        task("b", "2026-12-07", "2026-12-09"),
        task("c", "2026-12-10", "2026-12-10"),
      ],
      [dependency("a", "b"), dependency("b", "c")],
    );
    assertEquals(changes, [
      { id: "b", startsOn: "2026-12-09", dueOn: "2026-12-11" },
      { id: "c", startsOn: "2026-12-14", dueOn: "2026-12-14" },
    ]);
  },
);

Deno.test("slack is kept and finished work stays where it is", () => {
  assertEquals(
    computeSchedule(
      [
        task("a", "2026-12-01", "2026-12-02"),
        task("late", "2026-12-14", "2026-12-15"),
        task("done", "2026-11-25", "2026-11-26", { done: true }),
      ],
      [dependency("a", "late"), dependency("a", "done")],
    ),
    [],
  );
});

Deno.test("lag and the other dependency types", () => {
  const base = [
    task("a", "2026-12-01", "2026-12-03"),
    task("b", "2026-12-01", "2026-12-02"),
  ];
  assertEquals(computeSchedule(base, [dependency("a", "b", { lagDays: 2 })]), [
    { id: "b", startsOn: "2026-12-08", dueOn: "2026-12-09" },
  ]);
  assertEquals(
    computeSchedule(base, [
      dependency("a", "b", { type: "start_to_start", lagDays: 1 }),
    ]),
    [{ id: "b", startsOn: "2026-12-02", dueOn: "2026-12-03" }],
  );
  assertEquals(
    computeSchedule(base, [dependency("a", "b", { type: "finish_to_finish" })]),
    [{ id: "b", startsOn: "2026-12-02", dueOn: "2026-12-03" }],
  );
});

Deno.test("phases span their children and move them when pushed", () => {
  const changes = computeSchedule(
    [
      task("p1", null, null),
      task("a", "2026-12-01", "2026-12-04", { parentId: "p1" }),
      task("p2", "2026-12-01", "2026-12-02"),
      task("b", "2026-12-01", "2026-12-02", { parentId: "p2" }),
      task("c", "2026-12-03", "2026-12-03", { parentId: "p2" }),
    ],
    [dependency("p1", "p2")],
  );
  assertEquals(changes, [
    { id: "p1", startsOn: "2026-12-01", dueOn: "2026-12-04" },
    { id: "p2", startsOn: "2026-12-07", dueOn: "2026-12-09" },
    { id: "b", startsOn: "2026-12-07", dueOn: "2026-12-08" },
    { id: "c", startsOn: "2026-12-09", dueOn: "2026-12-09" },
  ]);
});

Deno.test("circles are reported instead of looping", () => {
  assertEquals(
    hasDependencyCycle([dependency("a", "b"), dependency("b", "a")]),
    true,
  );
  assertThrows(
    () =>
      computeSchedule(
        [
          task("a", "2026-12-01", "2026-12-02"),
          task("b", "2026-12-03", "2026-12-04"),
        ],
        [dependency("a", "b"), dependency("b", "a")],
      ),
    ScheduleCycleError,
  );
  // A phase waiting for its own child can never be satisfied.
  assertThrows(
    () =>
      computeSchedule(
        [
          task("p", null, null),
          task("a", "2026-12-01", "2026-12-02", { parentId: "p" }),
        ],
        [dependency("a", "p")],
      ),
    ScheduleCycleError,
  );
});
