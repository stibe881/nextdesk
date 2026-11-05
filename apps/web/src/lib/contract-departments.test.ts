import { describe, expect, it } from "vitest";
import {
  departmentLabel,
  initialDepartmentId,
  parseDepartmentOptions,
} from "./contract-departments";

const ict = { id: "d-ict", name: "ICT" };
const hr = { id: "d-hr", name: "Personal" };

describe("contract departments", () => {
  it("parses department options strictly", () => {
    expect(parseDepartmentOptions(null)).toEqual([]);
    expect(parseDepartmentOptions({})).toEqual([]);
    expect(
      parseDepartmentOptions({
        departments: [ict, { id: 1, name: "x" }, null, { id: "a" }, hr],
      }),
    ).toEqual([ict, hr]);
  });

  it("pre-selects the record's or the only department", () => {
    expect(initialDepartmentId("d-hr", [ict])).toBe("d-hr");
    expect(initialDepartmentId(null, [ict])).toBe("d-ict");
    expect(initialDepartmentId(undefined, [ict, hr])).toBe("");
    expect(initialDepartmentId(null, [])).toBe("");
  });

  it("shows the department only with several options", () => {
    expect(departmentLabel("d-ict", [ict])).toBeNull();
    expect(departmentLabel("d-hr", [ict, hr])).toBe("Personal");
    expect(departmentLabel(null, [ict, hr])).toBeNull();
    expect(departmentLabel("d-x", [ict, hr])).toBe("Andere Abteilung");
  });
});
