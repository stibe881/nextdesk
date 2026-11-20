import { assertEquals } from "jsr:@std/assert@1";
import {
  buildSnapshot,
  instantiateSnapshot,
  normalizeSnapshot,
} from "./project-template.ts";

const source = () =>
  buildSnapshot(
    { startsOn: "2026-12-01", endsOn: "2026-12-31", budgetMinutes: 1200 },
    [
      {
        id: "phase",
        parentId: null,
        kind: "phase",
        title: "Vorbereitung",
        description: null,
        priority: "normal",
        estimatedMinutes: null,
        startsOn: "2026-12-01",
        dueOn: "2026-12-05",
        position: 0,
      },
      {
        id: "task",
        parentId: "phase",
        kind: "task",
        title: "Switch bestellen",
        description: "Zwei Stück",
        priority: "high",
        estimatedMinutes: 120,
        startsOn: "2026-12-02",
        dueOn: "2026-12-04",
        position: 0,
      },
      {
        id: "milestone",
        parentId: null,
        kind: "milestone",
        title: "Abnahme",
        description: null,
        priority: "normal",
        estimatedMinutes: null,
        startsOn: "2026-12-20",
        dueOn: "2026-12-20",
        position: 1,
      },
    ],
    new Map([["task", ["Offerte einholen", "Bestellung auslösen"]]]),
    [
      {
        predecessorId: "task",
        successorId: "milestone",
        type: "finish_to_start",
        lagDays: 2,
      },
    ],
    [{ title: "Konzept", body: "# Ziel", visibility: "external" }],
  );

Deno.test("a snapshot stores dates relative to the project start", () => {
  const snapshot = source();
  assertEquals(snapshot.durationDays, 30);
  assertEquals(
    snapshot.items.map((item) => [
      item.key,
      item.parentKey,
      item.startOffset,
      item.dueOffset,
    ]),
    [
      ["t1", null, 0, 4],
      ["t2", "t1", 1, 3],
      ["t3", null, 19, 19],
    ],
  );
  assertEquals(snapshot.dependencies, [
    { from: "t2", to: "t3", type: "finish_to_start", lagDays: 2 },
  ]);
});

Deno.test("a new project gets fresh ids and dates from its own start", () => {
  let counter = 0;
  const project = instantiateSnapshot(
    normalizeSnapshot(JSON.parse(JSON.stringify(source())))!,
    "2027-03-01",
    () => `id-${++counter}`,
  );
  assertEquals(project.endsOn, "2027-03-31");
  assertEquals(project.budgetMinutes, 1200);
  assertEquals(
    project.tasks.map((task) => [
      task.id,
      task.parentId,
      task.level,
      task.startsOn,
      task.dueOn,
    ]),
    [
      ["id-1", null, 0, "2027-03-01", "2027-03-05"],
      ["id-3", null, 0, "2027-03-20", "2027-03-20"],
      ["id-2", "id-1", 1, "2027-03-02", "2027-03-04"],
    ],
  );
  assertEquals(project.tasks[2].checklist, [
    "Offerte einholen",
    "Bestellung auslösen",
  ]);
  assertEquals(project.dependencies, [
    {
      predecessorId: "id-2",
      successorId: "id-3",
      type: "finish_to_start",
      lagDays: 2,
    },
  ]);
  assertEquals(project.documents[0].visibility, "external");
});

Deno.test(
  "without a start date the structure is kept and dates stay empty",
  () => {
    const project = instantiateSnapshot(source(), null, () =>
      crypto.randomUUID(),
    );
    assertEquals(project.endsOn, null);
    assertEquals(
      project.tasks.every(
        (task) => task.startsOn === null && task.dueOn === null,
      ),
      true,
    );
  },
);

Deno.test("broken snapshots are rejected or repaired", () => {
  assertEquals(normalizeSnapshot({ items: "x" }), null);
  assertEquals(
    normalizeSnapshot({ items: [{ key: "a", kind: "epic", title: "x" }] }),
    null,
  );
  const repaired = normalizeSnapshot({
    items: [{ key: "a", parentKey: "gone", kind: "task", title: " A " }],
    dependencies: [{ from: "a", to: "a", type: "finish_to_start" }],
  })!;
  assertEquals(repaired.items[0].parentKey, null);
  assertEquals(repaired.items[0].title, "A");
  assertEquals(repaired.dependencies, []);
});
