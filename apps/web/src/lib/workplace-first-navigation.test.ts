import { describe, expect, it } from "vitest";

import { workplaceFirstNavigation } from "./workplace-first-navigation";

describe("workplaceFirstNavigation", () => {
  it("platziert Arbeitsplatz direkt vor Übersicht und erhält die restliche Reihenfolge", () => {
    expect(
      workplaceFirstNavigation([
        { label: "Übersicht" },
        { label: "Tickets" },
        { label: "Fälle" },
        { label: "Arbeitsplatz" },
        { label: "Services" },
      ]).map((section) => section.label),
    ).toEqual(["Arbeitsplatz", "Übersicht", "Tickets", "Fälle", "Services"]);
  });

  it("behält die Navigation unverändert, wenn Arbeitsplatz nicht verfügbar ist", () => {
    const sections = [{ label: "Übersicht" }, { label: "Tickets" }];
    expect(workplaceFirstNavigation(sections)).toEqual(sections);
    expect(workplaceFirstNavigation(sections)).not.toBe(sections);
  });
});
