import { describe, expect, it } from "vitest";

import {
  splitWorkplaceNavigation,
  workplaceFirstNavigation,
} from "./workplace-first-navigation";

describe("workplaceFirstNavigation", () => {
  it("platziert Arbeitsplatz direkt vor Übersicht und erhält die logische Reihenfolge der übrigen Bereiche", () => {
    expect(
      workplaceFirstNavigation([
        { label: "Übersicht" },
        { label: "Tickets" },
        { label: "Fälle" },
        { label: "Wissen" },
        { label: "Services" },
        { label: "Assets" },
        { label: "Systemstatus" },
        { label: "Raumplanung" },
        { label: "Eintritte" },
        { label: "Verträge" },
        { label: "Berichte" },
        { label: "Arbeitsplatz" },
        { label: "Mein Portal" },
      ]).map((section) => section.label),
    ).toEqual([
      "Arbeitsplatz",
      "Übersicht",
      "Tickets",
      "Fälle",
      "Wissen",
      "Services",
      "Assets",
      "Systemstatus",
      "Raumplanung",
      "Eintritte",
      "Verträge",
      "Berichte",
      "Mein Portal",
    ]);
  });

  it("behält die Navigation unverändert, wenn Arbeitsplatz nicht verfügbar ist", () => {
    const sections = [{ label: "Übersicht" }, { label: "Tickets" }];
    expect(workplaceFirstNavigation(sections)).toEqual(sections);
    expect(workplaceFirstNavigation(sections)).not.toBe(sections);
  });
});

describe("splitWorkplaceNavigation", () => {
  it("trennt Arbeitsplatz vor der Überschrift von den übrigen Arbeitsbereichen", () => {
    const workplace = { label: "Arbeitsplatz" };
    const sections = [
      workplace,
      { label: "Übersicht" },
      { label: "Tickets" },
      { label: "Fälle" },
    ];

    expect(splitWorkplaceNavigation(sections)).toEqual({
      workplaceNavigationItem: workplace,
      remainingNavigationSections: [
        { label: "Übersicht" },
        { label: "Tickets" },
        { label: "Fälle" },
      ],
    });
  });

  it("liefert keinen primären Arbeitsplatz aus einer eingeschränkten Navigation", () => {
    const sections = [{ label: "Übersicht" }, { label: "Tickets" }];

    expect(splitWorkplaceNavigation(sections)).toEqual({
      workplaceNavigationItem: null,
      remainingNavigationSections: sections,
    });
  });
});
