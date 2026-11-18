import { describe, expect, it } from "vitest";
import { filterInventoryItems } from "./inventory-search";

const items = [
  {
    name: "Lenovo Maus Essential USB",
    articleNumber: "810618",
    locationName: "Wandschrank ICT",
  },
  {
    name: "Logitech Tastatur Ergo K860",
    articleNumber: "1118622",
    locationName: null,
  },
  {
    name: "Xgimi Halo+ 2.0",
    articleNumber: "xgimi-halo-plus-2.0",
    locationName: null,
  },
];

describe("filterInventoryItems", () => {
  it("zeigt ohne Suchbegriff alle Artikel", () => {
    expect(filterInventoryItems(items, "  ")).toHaveLength(3);
  });
  it("findet nach Name, Artikelnummer und Lagerort, ohne Gross-/Kleinschreibung", () => {
    expect(
      filterInventoryItems(items, "maus").map((i) => i.articleNumber),
    ).toEqual(["810618"]);
    expect(filterInventoryItems(items, "1118")).toHaveLength(1);
    expect(filterInventoryItems(items, "wandschrank")).toHaveLength(1);
  });
  it("verlangt alle Wörter", () => {
    expect(filterInventoryItems(items, "logitech ergo")).toHaveLength(1);
    expect(filterInventoryItems(items, "logitech maus")).toHaveLength(0);
  });
});
