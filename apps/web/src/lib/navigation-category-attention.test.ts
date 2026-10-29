import { describe, expect, it } from "vitest";

import { collapsedNavigationCategoryAttentionCount } from "./navigation-category-attention";

describe("collapsedNavigationCategoryAttentionCount", () => {
  const eligibleInput = {
    categoryExpanded: false,
    categoryId: "navigation-category-operations",
    eventSpaceAttentionCount: 3,
    eventSpaceNavigationAccess: true,
  };

  it("zeigt den Raumplanungszähler nur am geschlossenen Betriebsbereich", () => {
    expect(collapsedNavigationCategoryAttentionCount(eligibleInput)).toBe(3);
  });

  it("blendet den zusammengefassten Zähler beim geöffneten Bereich aus", () => {
    expect(
      collapsedNavigationCategoryAttentionCount({
        ...eligibleInput,
        categoryExpanded: true,
      }),
    ).toBeNull();
  });

  it("zeigt keinen Zähler ohne serverseitig bestätigten Raumplanungszugriff", () => {
    expect(
      collapsedNavigationCategoryAttentionCount({
        ...eligibleInput,
        eventSpaceNavigationAccess: false,
      }),
    ).toBeNull();
  });

  it("zeigt keinen Zähler für andere Kategorien oder nicht positive Werte", () => {
    expect(
      collapsedNavigationCategoryAttentionCount({
        ...eligibleInput,
        categoryId: "navigation-category-resources",
      }),
    ).toBeNull();
    expect(
      collapsedNavigationCategoryAttentionCount({
        ...eligibleInput,
        eventSpaceAttentionCount: 0,
      }),
    ).toBeNull();
  });
});
