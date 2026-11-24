import { describe, expect, it } from "vitest";
import type { ProjectSummary, ProjectTask } from "./projects-api";
import {
  applyMove,
  buildTree,
  canBeChildOf,
  dependencyPath,
  dropPlacement,
  EMPTY_FILTER,
  type ProjectSortKey,
  filterTasks,
  ganttBar,
  ganttRange,
  groupEvents,
  hoursLabel,
  linkStateLabel,
  loadLevel,
  monthSegments,
  parseHours,
  projectSpan,
  rollupTasks,
  sortProjects,
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

describe("moving rows", () => {
  const order = (tasks: ProjectTask[]) =>
    buildTree(tasks).map((row) => `${row.depth}:${row.task.id}`);

  it("drops before and after a row among its siblings", () => {
    const before = dropPlacement(plan, "b", "a", "before", false)!;
    expect(before).toEqual({ parentId: "phase", beforeId: "a" });
    expect(order(applyMove(plan, "b", before))).toEqual([
      "0:phase",
      "1:b",
      "2:sub",
      "1:a",
      "0:ms",
    ]);
    // After the last top-level row: at the end.
    expect(dropPlacement(plan, "a", "ms", "after", false)).toEqual({
      parentId: null,
      beforeId: null,
    });
  });

  it("moves into a phase, as first child below an open one", () => {
    expect(dropPlacement(plan, "ms", "phase", "into", true)).toEqual({
      parentId: "phase",
      beforeId: null,
    });
    const first = dropPlacement(plan, "ms", "phase", "after", true)!;
    expect(first).toEqual({ parentId: "phase", beforeId: "a" });
    expect(order(applyMove(plan, "ms", first))[1]).toBe("1:ms");
    // A closed phase is followed by the next top-level row.
    expect(dropPlacement(plan, "a", "phase", "after", false)).toEqual({
      parentId: null,
      beforeId: "ms",
    });
  });

  it("refuses places the plan does not allow", () => {
    // A phase stays on top, nothing goes below a milestone or itself.
    expect(dropPlacement(plan, "phase", "a", "before", false)).toBeNull();
    expect(dropPlacement(plan, "a", "ms", "into", false)).toBeNull();
    expect(dropPlacement(plan, "b", "sub", "before", false)).toBeNull();
    // No subtask of a subtask, and a task with subtasks is no subtask.
    expect(dropPlacement(plan, "a", "sub", "into", false)).toBeNull();
    expect(dropPlacement(plan, "b", "a", "into", false)).toBeNull();
    expect(canBeChildOf(plan, "a", "b")).toBe(true);
    expect(canBeChildOf(plan, "ms", "b")).toBe(false);
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
    expect(suggestHealth({ endsOn: null, stats }).health).toBe("green");
  });
  it("turns yellow for late tasks or a plan beyond the end", () => {
    expect(
      suggestHealth({
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
  it("turns red for a late milestone or more time booked than planned", () => {
    expect(
      suggestHealth({
        endsOn: null,
        stats: { ...stats, estimatedMinutes: 60, overdueMilestones: 1 },
      }).reasons,
    ).toEqual([
      "1 Meilenstein ist überfällig",
      "Die geplanten Stunden sind überschritten",
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

describe("timeline across projects", () => {
  const stats = {
    taskCount: 0,
    doneCount: 0,
    progressPercent: 0,
    estimatedMinutes: 0,
    bookedMinutes: 0,
    overdueTasks: 0,
    overdueMilestones: 0,
    nextMilestone: null,
    latestDueOn: null,
    actualAmountCents: null,
  };
  it("uses the project dates and fills gaps from the plan", () => {
    expect(
      projectSpan({ startsOn: "2026-12-01", endsOn: "2027-01-31", stats }),
    ).toEqual({ start: "2026-12-01", end: "2027-01-31" });
    expect(
      projectSpan({
        startsOn: "2026-12-01",
        endsOn: null,
        stats: { ...stats, latestDueOn: "2026-12-20" },
        milestones: [
          { id: "m", title: "Abnahme", dueOn: "2027-01-10", done: false },
        ],
      }),
    ).toEqual({ start: "2026-12-01", end: "2027-01-10" });
    expect(projectSpan({ startsOn: null, endsOn: null, stats })).toBeNull();
    expect(
      projectSpan({ startsOn: "2026-12-01", endsOn: null, stats }),
    ).toEqual({ start: "2026-12-01", end: "2026-12-01" });
  });
});

describe("sorting the overview", () => {
  const stats = {
    taskCount: 0,
    doneCount: 0,
    progressPercent: 0,
    estimatedMinutes: 0,
    bookedMinutes: 0,
    overdueTasks: 0,
    overdueMilestones: 0,
    nextMilestone: null,
    latestDueOn: null,
    actualAmountCents: null,
  };
  const project = (
    title: string,
    extra: Partial<ProjectSummary> = {},
  ): ProjectSummary =>
    ({
      id: title,
      title,
      status: "planning",
      health: "green",
      managerName: null,
      endsOn: null,
      stats,
      ...extra,
    }) as ProjectSummary;
  const projects = [
    project("Bern", { endsOn: "2027-01-31", managerName: "Mara" }),
    project("Aarau", { health: "red", status: "active" }),
    project("Chur", {
      endsOn: "2026-12-31",
      managerName: "Daniel",
      stats: { ...stats, progressPercent: 60 },
    }),
  ];
  const titles = (key: ProjectSortKey, descending = false) =>
    sortProjects(projects, key, descending).map((entry) => entry.title);

  it("starts with critical projects, then by end date", () => {
    expect(titles("health")).toEqual(["Aarau", "Chur", "Bern"]);
  });
  it("sorts by a column in both directions", () => {
    expect(titles("title")).toEqual(["Aarau", "Bern", "Chur"]);
    expect(titles("title", true)).toEqual(["Chur", "Bern", "Aarau"]);
    expect(titles("progress", true)[0]).toBe("Chur");
    expect(titles("status")[0]).toBe("Aarau");
  });
  it("keeps projects without a value at the bottom", () => {
    expect(titles("endsOn")).toEqual(["Chur", "Bern", "Aarau"]);
    expect(titles("endsOn", true)).toEqual(["Bern", "Chur", "Aarau"]);
    expect(titles("manager", true)).toEqual(["Bern", "Chur", "Aarau"]);
  });
});

describe("history", () => {
  it("merges repeated entries on the same element", () => {
    const entry = (id: string, type: string, taskId: string | null) => ({
      id,
      type,
      taskId,
      actorName: "Mara",
    });
    expect(
      groupEvents([
        entry("5", "task.updated", "a"),
        entry("4", "task.updated", "a"),
        entry("3", "task.updated", "b"),
        entry("2", "task.created", "b"),
        entry("1", "task.updated", "a"),
      ]).map((group) => [group.event.id, group.count]),
    ).toEqual([
      ["5", 2],
      ["3", 1],
      ["2", 1],
      ["1", 1],
    ]);
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
