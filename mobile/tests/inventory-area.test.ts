import { describe, expect, it } from "vitest";

import { areaEndOptions, splitPlaceName } from "../lib/inventory-area";

const places = ["G10.2.1", "G10.2.2", "G10.2.4", "G11.2.1", "G10.3.1", "Lager"].map(
  (name, index) => ({ id: `id-${index}`, name }),
);

describe("splitPlaceName", () => {
  it("splits off the last number", () => {
    expect(splitPlaceName("G10.2.12")).toEqual({ prefix: "G10.2.", number: 12 });
    expect(splitPlaceName("Lager")).toBeNull();
  });
});

describe("areaEndOptions", () => {
  it("offers only higher places that differ in the last number", () => {
    expect(areaEndOptions(places, "id-0").map((place) => place.name)).toEqual([
      "G10.2.2",
      "G10.2.4",
    ]);
  });

  it("offers nothing for an unnumbered or unknown start", () => {
    expect(areaEndOptions(places, "id-5")).toEqual([]);
    expect(areaEndOptions(places, null)).toEqual([]);
    expect(areaEndOptions(places, "unknown")).toEqual([]);
  });

  it("offers nothing after the last place of a series", () => {
    expect(areaEndOptions(places, "id-2")).toEqual([]);
  });
});
