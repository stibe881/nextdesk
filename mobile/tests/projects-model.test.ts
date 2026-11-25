import { describe, expect, it } from "vitest";

import {
  filterProjects,
  isProjectAccessDenied,
  isProjectOpen,
  isProjectTaskOverdue,
  myProjectTasks,
  parseProjectDetail,
  parseProjectOverview,
  projectDateLabel,
  projectHref,
  projectProgressLabel,
  projectRangeLabel,
  projectTaskHref,
  projectTaskMeta,
  projectTaskRows,
  sortProjects,
  type MobileProjectTask,
} from "../lib/projects-model";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const project = (n: number, extra: Record<string, unknown> = {}) => ({
  id: uuid(n),
  number: `P-${n}`,
  title: `Projekt ${n}`,
  status: "active",
  health: "green",
  archivedAt: null,
  role: "member",
  stats: { taskCount: 4, doneCount: 1, progressPercent: 25, overdueTasks: 0 },
  ...extra,
});

const task = (
  n: number,
  extra: Partial<MobileProjectTask> = {},
): MobileProjectTask => ({
  id: uuid(n),
  parentId: null,
  kind: "task",
  title: `Aufgabe ${n}`,
  description: null,
  status: "todo",
  priority: "normal",
  assigneeId: null,
  assigneeName: null,
  startsOn: null,
  dueOn: null,
  position: n,
  checklist: [],
  ...extra,
});

describe("parseProjectOverview", () => {
  it("liest Projekte und überspringt unbrauchbare Einträge", () => {
    const parsed = parseProjectOverview({
      data: {
        projects: [
          project(1, {
            stats: {
              taskCount: 2,
              doneCount: 2,
              progressPercent: 100,
              overdueTasks: 0,
              nextMilestone: { title: "Go-live", on: "2026-12-01" },
            },
          }),
          { id: "kaputt", title: "x" },
          project(2, { status: "seltsam", health: "blau", role: "chef" }),
        ],
      },
    });
    expect(parsed).toHaveLength(2);
    expect(parsed?.[0].nextMilestone).toEqual({
      title: "Go-live",
      on: "2026-12-01",
    });
    expect(parsed?.[1]).toMatchObject({
      status: "planning",
      health: "green",
      role: "viewer",
    });
  });

  it("gibt bei unerwarteter Antwort null zurück", () => {
    expect(parseProjectOverview(null)).toBeNull();
    expect(parseProjectOverview({ data: {} })).toBeNull();
  });
});

describe("parseProjectDetail", () => {
  it("liest Plan, Kommentare, Team und Rechte", () => {
    const parsed = parseProjectDetail({
      data: {
        project: project(1),
        access: { role: "manager", canEdit: true, canComment: true },
        tasks: [
          {
            id: uuid(10),
            kind: "task",
            title: "Switch tauschen",
            status: "in_progress",
            priority: "high",
            assigneeId: uuid(50),
            assigneeName: "Rahel",
            dueOn: "2026-11-30",
            position: 1,
            checklist: [
              { id: uuid(20), description: "Backup", done: true },
              { id: "x", description: "ungültig", done: false },
            ],
          },
        ],
        comments: [
          {
            id: uuid(30),
            taskId: uuid(10),
            authorName: "Rahel",
            body: "Erledigt",
            createdAt: "2026-11-24T10:00:00Z",
            mine: true,
            visibility: "external",
          },
        ],
        members: [{ userId: uuid(50), name: "Rahel", role: "member" }],
      },
    });
    expect(parsed?.project.role).toBe("manager");
    expect(parsed?.access).toEqual({
      canEdit: true,
      canComment: true,
      isGuest: false,
    });
    expect(parsed?.tasks[0].checklist).toHaveLength(1);
    expect(parsed?.comments[0]).toMatchObject({ mine: true, external: true });
    expect(parsed?.members).toHaveLength(1);
  });

  it("verlangt Projekt und Aufgabenliste", () => {
    expect(parseProjectDetail({ data: { project: project(1) } })).toBeNull();
  });
});

describe("Listen", () => {
  it("sortiert aktive zuerst und filtert nach Titel, Nummer, Leitung", () => {
    const projects = parseProjectOverview({
      data: {
        projects: [
          project(1, { status: "completed", title: "Alt" }),
          project(2, { status: "planning", title: "Zebra" }),
          project(3, { title: "Netzwerk", managerName: "Stefan" }),
        ],
      },
    })!;
    expect(sortProjects(projects).map((p) => p.title)).toEqual([
      "Netzwerk",
      "Zebra",
      "Alt",
    ]);
    expect(projects.filter(isProjectOpen)).toHaveLength(2);
    expect(filterProjects(projects, "stef").map((p) => p.title)).toEqual([
      "Netzwerk",
    ]);
    expect(filterProjects(projects, "p-2")).toHaveLength(1);
  });

  it("ordnet den Plan nach Position und rückt Kinder ein", () => {
    const rows = projectTaskRows([
      task(3, { parentId: uuid(1), position: 2 }),
      task(1, { kind: "phase", position: 1 }),
      task(2, { parentId: uuid(1), position: 1 }),
      task(4, { parentId: uuid(99), position: 0 }),
    ]);
    expect(rows.map((row) => [row.task.id, row.depth])).toEqual([
      [uuid(4), 0],
      [uuid(1), 0],
      [uuid(2), 1],
      [uuid(3), 1],
    ]);
  });

  it("zeigt nur eigene offene Aufgaben, früheste zuerst", () => {
    const me = uuid(50);
    const mine = myProjectTasks(
      [
        task(1, { assigneeId: me, dueOn: "2026-12-10" }),
        task(2, { assigneeId: me, status: "done" }),
        task(3, { assigneeId: me, dueOn: "2026-12-01" }),
        task(4, { assigneeId: uuid(51) }),
        task(5, { assigneeId: me, kind: "phase" }),
      ],
      me,
    );
    expect(mine.map((entry) => entry.id)).toEqual([uuid(3), uuid(1)]);
    expect(myProjectTasks([task(1)], null)).toEqual([]);
  });
});

describe("Beschriftungen", () => {
  it("formatiert Daten und Zeiträume", () => {
    expect(projectDateLabel("2026-11-24")).toBe("24.11.2026");
    expect(projectDateLabel(null)).toBe("–");
    expect(projectRangeLabel("2026-01-05", "2026-03-01")).toBe(
      "05.01.2026 – 01.03.2026",
    );
    expect(projectRangeLabel(null, "2026-03-01")).toBe("bis 01.03.2026");
    expect(projectRangeLabel(null, null)).toBeNull();
  });

  it("erkennt überfällige Aufgaben", () => {
    const today = "2026-11-24";
    expect(isProjectTaskOverdue(task(1, { dueOn: "2026-11-23" }), today)).toBe(
      true,
    );
    expect(
      isProjectTaskOverdue(
        task(1, { dueOn: "2026-11-23", status: "done" }),
        today,
      ),
    ).toBe(false);
    expect(
      projectTaskMeta(
        task(1, {
          assigneeName: "Rahel",
          dueOn: "2026-11-23",
          checklist: [
            { id: uuid(2), description: "a", done: true },
            { id: uuid(3), description: "b", done: false },
          ],
        }),
        today,
      ),
    ).toBe("Rahel · überfällig seit 23.11.2026 · 1/2 Punkte");
  });

  it("beschreibt den Fortschritt", () => {
    const [first] = parseProjectOverview({ data: { projects: [project(1)] } })!;
    expect(projectProgressLabel(first)).toBe("1 von 4 erledigt · 25 %");
  });
});

describe("Routen und Zugriff", () => {
  it("baut nur Routen mit gültigen IDs", () => {
    expect(projectHref(uuid(1))).toBe(`/projects/${uuid(1)}`);
    expect(projectHref("../x")).toBeNull();
    expect(projectTaskHref(uuid(1), uuid(2))).toBe(
      `/projects/${uuid(1)}/task/${uuid(2)}`,
    );
    expect(projectTaskHref(uuid(1), "x")).toBeNull();
  });

  it("erkennt fehlendes Modul oder Recht", () => {
    expect(isProjectAccessDenied({ code: "feature_disabled" })).toBe(true);
    expect(isProjectAccessDenied({ code: "forbidden", status: 403 })).toBe(
      true,
    );
    expect(isProjectAccessDenied({ code: "invalid", status: 400 })).toBe(false);
    expect(isProjectAccessDenied(new Error("x"))).toBe(false);
  });
});
