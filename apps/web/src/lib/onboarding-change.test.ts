import { describe, expect, it } from "vitest";
import {
  changeDetailsFor,
  changeSummary,
  missingChangeTypes,
} from "./onboarding-change";

describe("Mutationen", () => {
  it("übernimmt nur die Angaben der gewählten Arten", () => {
    expect(
      changeDetailsFor(["name"], {
        newName: " Anna Meier ",
        newDepartment: "Internat",
        note: "",
      }),
    ).toEqual({ newName: "Anna Meier" });
  });

  it("verlangt pro Art die neue Angabe", () => {
    expect(
      missingChangeTypes(["name", "department", "location_workload"], {
        newName: "Anna Meier",
        previousDepartment: "Schule",
        workload: "80 %",
      }),
    ).toEqual(["department"]);
  });

  it("fasst bisherige und neue Werte zusammen", () => {
    expect(
      changeSummary(
        ["name", "department", "location_workload"],
        {
          newName: "Anna Meier",
          previousDepartment: "Schule",
          newDepartment: "Internat",
          newLocation: "Baar",
          workload: "80 %",
        },
        "Anna Muster",
      ).map((row) => `${row.label}: ${row.text}`),
    ).toEqual([
      "Namensänderung: Anna Muster → Anna Meier",
      "Abteilung/Angebot: Schule → Internat",
      "Standort/Pensum: Baar · 80 %",
    ]);
  });
});
