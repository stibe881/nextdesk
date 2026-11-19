import { describe, expect, it } from "vitest";

import { groupTasks, relativeDays } from "./onboarding";

const today = new Date("2026-11-19T10:00:00Z");
const task = (id: string, dueOn: string, status = "open") => ({
  id,
  title: id,
  dueOn,
  responsibleName: "Mara Keller",
  status: status as "open" | "completed",
  canUpdate: true,
  exception: null,
});

describe("Eintritte: Aufgaben nach Fälligkeit", () => {
  it("gruppiert offene Aufgaben und stellt erledigte ans Ende", () => {
    const groups = groupTasks(
      [
        task("später", "2026-12-01"),
        task("überfällig", "2026-11-18"),
        task("heute", "2026-11-19"),
        task("erledigt", "2026-11-10", "completed"),
        task("in einer Woche", "2026-11-26"),
      ],
      today,
    );
    expect(
      groups.map((group) => [group.key, group.tasks.map((t) => t.id)]),
    ).toEqual([
      ["overdue", ["überfällig"]],
      ["soon", ["heute", "in einer Woche"]],
      ["later", ["später"]],
      ["done", ["erledigt"]],
    ]);
  });

  it("lässt leere Gruppen weg", () => {
    expect(
      groupTasks([task("a", "2026-12-24")], today).map((g) => g.key),
    ).toEqual(["later"]);
  });

  it("beschreibt Abstände in Tagen", () => {
    expect(relativeDays(0)).toBe("heute");
    expect(relativeDays(1)).toBe("morgen");
    expect(relativeDays(12)).toBe("in 12 Tagen");
    expect(relativeDays(-3)).toBe("vor 3 Tagen");
  });
});
