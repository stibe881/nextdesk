import { describe, expect, it } from "vitest";
import { shouldShowDepartmentQuestionRouting } from "./department-question-routing-visibility";

describe("Abteilungsrückfragen in den Einstellungen", () => {
  it("blendet die Konfiguration aus, wenn sie im Mandanten nicht erreichbar ist", () => {
    expect(shouldShowDepartmentQuestionRouting("unavailable")).toBe(false);
  });

  it("zeigt die Konfiguration während des Ladens und bei verfügbaren Routen", () => {
    expect(shouldShowDepartmentQuestionRouting("loading")).toBe(true);
    expect(shouldShowDepartmentQuestionRouting("ready")).toBe(true);
  });
});
