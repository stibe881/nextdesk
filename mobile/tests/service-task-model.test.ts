import { describe, expect, it } from "vitest";

import {
  formatServiceTaskDay,
  isServiceTaskOpen,
  parseServiceTaskAccess,
  parseServiceTaskDetail,
} from "../lib/service-task-model";

describe("parseServiceTaskDetail", () => {
  it("liest die Fälligkeit aus der Antwort von getOccurrence", () => {
    const task = parseServiceTaskDetail({
      data: {
        occurrence: {
          id: "o1",
          title: "Backup prüfen",
          status: "in_progress",
          overdue: true,
          dueOn: "2026-11-11",
          assignee: { id: "u1", name: "Alex Muster" },
          requireNote: true,
          checklist: [
            { id: "c1", label: "Log ansehen", done: true, doneByName: "Alex" },
            { id: 2, label: "kaputt" },
          ],
        },
      },
    });
    expect(task).toMatchObject({
      id: "o1",
      title: "Backup prüfen",
      status: "in_progress",
      overdue: true,
      assigneeName: "Alex Muster",
      requireNote: true,
    });
    expect(task?.checklist).toEqual([
      { id: "c1", label: "Log ansehen", done: true, doneByName: "Alex" },
    ]);
    expect(task && isServiceTaskOpen(task)).toBe(true);
  });

  it("lehnt unvollständige Antworten ab", () => {
    expect(parseServiceTaskDetail({ data: {} })).toBeNull();
    expect(parseServiceTaskDetail(null)).toBeNull();
  });

  it("liest Rechte und formatiert Tage", () => {
    expect(parseServiceTaskAccess({ data: { canExecute: true } })).toEqual({
      canExecute: true,
    });
    expect(parseServiceTaskAccess({})).toEqual({ canExecute: false });
    expect(formatServiceTaskDay("2026-11-11")).toBe("11.11.2026");
    expect(formatServiceTaskDay("x")).toBeNull();
  });
});
