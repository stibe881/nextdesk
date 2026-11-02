import { describe, expect, it } from "vitest";

import {
  collapsedNavigationCategoryAttentionCount,
  navigationItemAttentionCount,
} from "./navigation-category-attention";

describe("collapsedNavigationCategoryAttentionCount", () => {
  it("summiert die Zähler der Menüpunkte einer geschlossenen Kategorie", () => {
    expect(
      collapsedNavigationCategoryAttentionCount({
        categoryExpanded: false,
        itemCounts: [3, null, 2],
      }),
    ).toBe(5);
  });

  it("blendet den zusammengefassten Zähler beim geöffneten Bereich aus", () => {
    expect(
      collapsedNavigationCategoryAttentionCount({
        categoryExpanded: true,
        itemCounts: [3],
      }),
    ).toBeNull();
  });

  it("zeigt keinen Zähler ohne positive Werte", () => {
    expect(
      collapsedNavigationCategoryAttentionCount({
        categoryExpanded: false,
        itemCounts: [0, null, undefined, -1, Number.NaN],
      }),
    ).toBeNull();
  });
});

describe("navigationItemAttentionCount", () => {
  it("zeigt nur positive ganze Zahlen", () => {
    expect(navigationItemAttentionCount(4)).toBe(4);
    expect(navigationItemAttentionCount(0)).toBeNull();
    expect(navigationItemAttentionCount(null)).toBeNull();
    expect(navigationItemAttentionCount(1.5)).toBeNull();
  });
});
