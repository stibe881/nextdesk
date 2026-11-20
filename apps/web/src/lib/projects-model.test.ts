import { describe, expect, it } from "vitest";
import type { ProjectTask } from "./projects-api";
import {
  buildTree,
  dependencyPath,
  EMPTY_FILTER,
  filterTasks,
  ganttBar,
  ganttRange,
  hoursLabel,
  linkStateLabel,
  loadLevel,
  monthSegments,
  parseHours,
  rollupTasks,
  sortTasks,
  startOfWeek,
  suggestHealth,
  weekNumber,
} from "./projects-model";

const task = (id: string, extra: Partial<ProjectTask> = {}): ProjectTask => ({
  id,
  parentId: null,
  kind: "task",
  title: id,
  description: null,
  status: "todo",
  priority: "normal",
  assigneeId: null,
  assigneeName: null,
  teamId: null,
  startsOn: null,
  dueOn: null,
  estimatedMinutes: null,
  progressPercent: 0,
  position: 0,
  completedAt: null,
  bookedMinutes: 0,
  checklist: [],
  ...extra,
});

const plan = [
  task("phase", { kind: "phase", position: 0 }),
  task("b", {
    parentId: "phase",
    position: 1,
    estimatedMinutes: 120,
    bookedMinutes: 30,
    startsOn: "2026-12-07",
    dueOn: "2026-12-09",
  }),
  task("a", {
    parentId: "phase",
    position: 0,
    estimatedMinutes: 360,
    status: "done",
    bookedMinutes: 400,
    startsOn: "2026-12-01",
    dueOn: "2026-12-04",
  }),
  task("sub", { parentId: "b", estimatedMinutes: 60, progressPercent: 50 }),
  task("ms", { kind: "milestone", position: 1, dueOn: "2026-12-10" }),
];

describe("project tree", () => {
  it("orders siblings by position and hides collapsed branches", () => {
    expect(buildTree(plan).map((row) => `${row.depth}:${row.task.id}`)).toEqual(
      ["0:phase", "1:a", "1:b", "2:sub", "0:ms"],
    );
    expect(
      buildTree(plan, new Set(["phase"])).map((row) => row.task.id),
    ).toEqual(["phase", "ms"]);
  });

  it("keeps elements whose parent is missing", () => {
    expect(buildTree([task("x", { parentId: "gone" })])[0]?.depth).toBe(0);
  });
});

describe("roll-up", () => {
  it("sums estimates of leaves, booked time of everything and linked tickets", () => {
    const rollup = rollupTasks(plan, [{ taskId: "b", bookedMinutes: 45 }]);
    expect(rollup.get("b")).toMatchObject({
      estimatedMinutes: 60,
      bookedMinutes: 75,
      progressPercent: 50,
    });
    expect(rollup.get("phase")).toMatchObject({
      estimatedMinutes: 420,
      bookedMinutes: 475,
      startsOn: "2026-12-01",
      dueOn: "2026-12-09",
      openCount: 1,
      doneCount: 1,
    });
    // (360 × 100 + 60 × 50) / 420
    expect(rollup.get("phase")?.progressPercent).toBe(93);
    expect(rollup.get("ms")?.progressPercent).toBe(0);
  });
});

describe("traffic light suggestion", () => {
  const stats = {
    taskCount: 4,
    doneCount: 1,
    progressPercent: 30,
    estimatedMinutes: 600,
    bookedMinutes: 100,
    overdueTasks: 0,
    overdueMilestones: 0,
    nextMilestone: null,
    latestDueOn: null,
    actualAmountCents: null,
  };
  it("is green without findings", () => {
    expect(
      suggestHealth({ budgetMinutes: 600, endsOn: null, stats }).health,
    ).toBe("green");
  });
  it("turns yellow for late tasks or a plan beyond the end", () => {
    expect(
      suggestHealth({
        budgetMinutes: null,
        endsOn: "2026-12-31",
        stats: { ...stats, overdueTasks: 2, latestDueOn: "2027-01-15" },
      }),
    ).toEqual({
      health: "yellow",
      reasons: [
        "2 Aufgaben sind überfällig",
        "Der Plan reicht über das Projektende hinaus",
      ],
    });
  });
  it("turns red for a late milestone or a blown budget", () => {
    expect(
      suggestHealth({
        budgetMinutes: 60,
        endsOn: null,
        stats: { ...stats, overdueMilestones: 1 },
      }).reasons,
    ).toEqual([
      "1 Meilenstein ist überfällig",
      "Das Stundenbudget ist überschritten",
    ]);
  });
});

describe("list", () => {
  const today = "2026-12-08";
  it("filters by text, state and person", () => {
    const tasks = [
      task("Switch", { assigneeId: "u1", dueOn: "2026-12-01" }),
      task("Firewall", { status: "done", dueOn: "2026-12-01" }),
      task("Kabel", { kind: "milestone" }),
    ];
    expect(
      filterTasks(tasks, { ...EMPTY_FILTER, query: "wi" }, today).map(
        (t) => t.id,
      ),
    ).toEqual(["Switch"]);
    expect(
      filterTasks(tasks, { ...EMPTY_FILTER, status: "overdue" }, today).map(
        (t) => t.id,
      ),
    ).toEqual(["Switch"]);
    expect(
      filterTasks(tasks, { ...EMPTY_FILTER, status: "open" }, today),
    ).toHaveLength(2);
    expect(
      filterTasks(tasks, { ...EMPTY_FILTER, assigneeId: "none" }, today),
    ).toHaveLength(2);
    expect(
      filterTasks(tasks, { ...EMPTY_FILTER, kind: "milestone" }, today),
    ).toHaveLength(1);
  });
  it("sorts with empty dates last and keeps the plan order as tie-break", () => {
    const tasks = [
      task("a"),
      task("b", { dueOn: "2026-12-02" }),
      task("c", { dueOn: "2026-12-01" }),
    ];
    const order = new Map(tasks.map((t, index) => [t.id, index]));
    expect(sortTasks(tasks, "dueOn", false, order).map((t) => t.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(sortTasks(tasks, "status", true, order).map((t) => t.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });
});

describe("timeline", () => {
  it("starts on a Monday with air around the plan", () => {
    const range = ganttRange(
      { startsOn: "2026-12-02", endsOn: null },
      [{ startsOn: null, dueOn: "2026-12-18" }],
      "2026-12-08",
    );
    expect(range.start).toBe("2026-11-23");
    expect(startOfWeek(range.start)).toBe(range.start);
    expect(range.end >= "2027-01-08").toBe(true);
  });
  it("places bars by day and gives milestones one day", () => {
    expect(ganttBar("2026-12-01", "2026-12-03", "2026-12-04", 10)).toEqual({
      left: 20,
      width: 20,
    });
    expect(ganttBar("2026-12-01", null, "2026-12-05", 10)).toEqual({
      left: 40,
      width: 10,
    });
    expect(ganttBar("2026-12-01", null, null, 10)).toBeNull();
  });
  it("labels months and ISO weeks", () => {
    expect(
      monthSegments("2026-12-30", 4).map((s) => [s.label, s.days]),
    ).toEqual([
      ["Dezember 2026", 2],
      ["Januar 2027", 2],
    ]);
    expect(weekNumber("2027-01-03")).toBe(53);
    expect(weekNumber("2027-01-04")).toBe(1);
  });
  it("draws a straight elbow when the successor starts later", () => {
    expect(
      dependencyPath(
        "finish_to_start",
        { left: 0, width: 20, y: 10 },
        { left: 60, width: 20, y: 50 },
      ),
    ).toBe("M20,10 H30 V50 H60");
    expect(
      dependencyPath(
        "finish_to_start",
        { left: 40, width: 20, y: 10 },
        { left: 0, width: 20, y: 50 },
      ),
    ).toBe("M60,10 H70 V24 H-10 V50 H0");
  });
});

describe("links", () => {
  it("translates stored states and keeps ticket labels", () => {
    expect(linkStateLabel("active")).toBe("aktiv");
    expect(linkStateLabel("In Bearbeitung")).toBe("In Bearbeitung");
    expect(linkStateLabel(null)).toBeNull();
  });
});

describe("numbers", () => {
  it("reads and writes hours", () => {
    expect(parseHours("1,5")).toBe(90);
    expect(parseHours("")).toBeNull();
    expect(parseHours("x")).toBeNull();
    expect(hoursLabel(90)).toBe("1.5 h");
    expect(hoursLabel(null)).toBe("–");
  });
  it("grades the load of a day", () => {
    expect([0, 120, 400, 480, 500].map((m) => loadLevel(m, 480))).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });
});
