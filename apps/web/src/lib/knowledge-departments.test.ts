import { describe, expect, it } from "vitest";
import {
  initialKnowledgeDepartmentId,
  knowledgeDepartmentLabel,
  parseKnowledgeArticleDepartmentId,
  parseKnowledgeDepartments,
} from "./knowledge-departments";

const departments = [
  { id: "dep-ict", name: "ICT" },
  { id: "dep-hr", name: "HR" },
];

describe("Wissensartikel nach Abteilung", () => {
  it("liest die Abteilungsoptionen streng", () => {
    expect(parseKnowledgeDepartments(undefined)).toEqual([]);
    expect(
      parseKnowledgeDepartments([{ id: "dep-ict", name: " ICT " }]),
    ).toEqual([{ id: "dep-ict", name: "ICT" }]);
    expect(parseKnowledgeDepartments({})).toBeNull();
    expect(parseKnowledgeDepartments([{ id: "dep-ict" }])).toBeNull();
    expect(parseKnowledgeDepartments([{ id: "", name: "ICT" }])).toBeNull();
  });

  it("akzeptiert Artikel ohne Abteilung, aber keine falschen Typen", () => {
    expect(parseKnowledgeArticleDepartmentId(null)).toEqual({
      valid: true,
      departmentId: null,
    });
    expect(parseKnowledgeArticleDepartmentId(undefined)).toEqual({
      valid: true,
      departmentId: null,
    });
    expect(parseKnowledgeArticleDepartmentId("dep-hr")).toEqual({
      valid: true,
      departmentId: "dep-hr",
    });
    expect(parseKnowledgeArticleDepartmentId(7)).toEqual({ valid: false });
    expect(parseKnowledgeArticleDepartmentId("")).toEqual({ valid: false });
  });

  it("zeigt die Abteilung nur bei mehreren Abteilungen", () => {
    expect(knowledgeDepartmentLabel("dep-hr", departments)).toBe("HR");
    expect(knowledgeDepartmentLabel(null, departments)).toBeNull();
    expect(knowledgeDepartmentLabel("dep-ict", [departments[0]!])).toBeNull();
    expect(knowledgeDepartmentLabel("unbekannt", departments)).toBeNull();
  });

  it("wählt die einzige Abteilung vor, sonst die des Artikels", () => {
    expect(initialKnowledgeDepartmentId(null, [departments[0]!])).toBe(
      "dep-ict",
    );
    expect(initialKnowledgeDepartmentId(null, departments)).toBeNull();
    expect(initialKnowledgeDepartmentId("dep-hr", departments)).toBe("dep-hr");
    expect(initialKnowledgeDepartmentId(null, [])).toBeNull();
  });
});
