import { describe, expect, it } from "vitest";
import {
  canRequesterOpenSection,
  requesterNavigationSections,
} from "./requester-navigation";

describe("Navigation für reine Anfragende", () => {
  const sections = [
    { label: "Übersicht" },
    { label: "Tickets" },
    { label: "Shop" },
    { label: "Fälle" },
    { label: "Arbeitsplatz" },
    { label: "Raumplanung" },
    { label: "Eintritte" },
    { label: "Wissen" },
    { label: "Mein Portal" },
    { label: "Einstellungen" },
  ] as const;

  it("zeigt nur Übersicht, Tickets, Shop und Mein Portal", () => {
    expect(
      requesterNavigationSections(sections).map((section) => section.label),
    ).toEqual(["Übersicht", "Tickets", "Shop", "Mein Portal"]);
  });

  it("verweigert weitere Bereiche bei direkter clientseitiger Navigation", () => {
    expect(canRequesterOpenSection("Übersicht", true)).toBe(true);
    expect(canRequesterOpenSection("Tickets", true)).toBe(true);
    expect(canRequesterOpenSection("Shop", true)).toBe(true);
    expect(canRequesterOpenSection("Mein Portal", true)).toBe(true);
    expect(canRequesterOpenSection("Mein Portal", false)).toBe(false);
    expect(canRequesterOpenSection("Arbeitsplatz", true)).toBe(false);
    expect(canRequesterOpenSection("Raumplanung", true)).toBe(false);
    expect(canRequesterOpenSection("Eintritte", true)).toBe(false);
  });
});
