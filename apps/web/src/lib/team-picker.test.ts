import { describe, expect, it } from "vitest";
import { teamsInDepartment } from "../team-picker";

describe("teamsInDepartment", () => {
  const teams = [
    { id: "a", name: "Service Desk", departmentId: "ict", active: true },
    { id: "b", name: "System Engineer", departmentId: "ict", active: true },
    { id: "c", name: "Hauswartung", departmentId: "fm", active: true },
    { id: "d", name: "Alt", departmentId: "ict", active: false },
  ];
  it("keeps only active teams of the chosen department", () => {
    expect(teamsInDepartment(teams, "ict", ["a", "c", "d", "b"])).toEqual([
      "a",
      "b",
    ]);
    expect(teamsInDepartment(teams, "", ["a"])).toEqual([]);
  });
});
