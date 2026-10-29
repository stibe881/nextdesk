import { describe, expect, it } from "vitest";
import { pageViewOptionsForSection } from "./page-view-options";

const SECTIONS_WITHOUT_PAGE_VIEW_OPTIONS = [
  "Übersicht",
  "Arbeitsplatz",
  "Erwähnungen",
  "Mein Portal",
  "Services",
  "Assets",
  "Fälle",
  "Raumplanung",
  "Eintritte",
  "Wissen",
  "Berichte",
  "Einstellungen",
];

describe("seitenbezogene Ansichtsoptionen", () => {
  it("bietet im Ticketbereich die wirksamen Ticketlistenoptionen an", () => {
    expect(pageViewOptionsForSection("Tickets", true)).toEqual([
      "ticketDensity",
      "ticketSplitView",
    ]);
  });

  it("lässt die wirkungslose Listen-Detail-Option ohne Berechtigung oder im Preview weg", () => {
    expect(pageViewOptionsForSection("Tickets", false)).toEqual([
      "ticketDensity",
    ]);
  });

  it("bietet auf allen anderen Bereichen keinen Ansichtsbutton an", () => {
    for (const section of SECTIONS_WITHOUT_PAGE_VIEW_OPTIONS) {
      expect(pageViewOptionsForSection(section, true)).toEqual([]);
    }
  });
});
