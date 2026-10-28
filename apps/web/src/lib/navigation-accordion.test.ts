import { describe, expect, it } from "vitest";

import { nextExpandedAccordionId } from "./navigation-accordion";

describe("nextExpandedAccordionId", () => {
  it("schliesst eine bereits geöffnete Kategorie", () => {
    expect(
      nextExpandedAccordionId(
        "navigation-category-workspace",
        "navigation-category-workspace",
      ),
    ).toBeNull();
  });

  it("öffnet eine andere Kategorie und ersetzt damit die bisher geöffnete", () => {
    expect(
      nextExpandedAccordionId(
        "navigation-category-workspace",
        "navigation-category-resources",
      ),
    ).toBe("navigation-category-resources");
  });

  it("öffnet eine Kategorie, wenn noch keine offen ist", () => {
    expect(
      nextExpandedAccordionId(null, "navigation-category-operations"),
    ).toBe("navigation-category-operations");
  });
});
