import { describe, expect, it } from "vitest";
import { cadreVisibilityLabel, visibleForCadre } from "./shop";

describe("Kaderstufen im Shop", () => {
  it("zeigt die Sichtbarkeit als Text", () => {
    expect(cadreVisibilityLabel(undefined)).toBe("Alle");
    expect(cadreVisibilityLabel([])).toBe("Alle");
    expect(cadreVisibilityLabel([2])).toBe("Kaderstufe 2");
    expect(cadreVisibilityLabel([3, 1])).toBe("Kaderstufen 1, 3");
  });

  it("gibt Artikel nur für die gewählten Stufen frei", () => {
    expect(visibleForCadre([], 0)).toBe(true);
    expect(visibleForCadre(undefined, 0)).toBe(true);
    expect(visibleForCadre([1], 1)).toBe(true);
    expect(visibleForCadre([1], 0)).toBe(false);
    expect(visibleForCadre([3], 1)).toBe(false);
  });
});
