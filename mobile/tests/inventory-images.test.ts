import { describe, expect, it } from "vitest";

import {
  parseInventoryImageUrl,
  pickInventoryImages,
} from "../lib/inventory-images-model";

describe("Artikelbilder im Lager (mobil)", () => {
  it("liest nur passende, sichere Bildlinks", () => {
    expect(
      parseInventoryImageUrl(
        { data: { itemId: "a", signedUrl: "https://x.test/a.jpg" } },
        "a",
      ),
    ).toBe("https://x.test/a.jpg");
    expect(
      parseInventoryImageUrl(
        { data: { itemId: "b", signedUrl: "https://x.test/a.jpg" } },
        "a",
      ),
    ).toBeNull();
    expect(
      parseInventoryImageUrl(
        { data: { itemId: "a", signedUrl: "http://x.test/a.jpg" } },
        "a",
      ),
    ).toBeNull();
    expect(parseInventoryImageUrl(null, "a")).toBeNull();
  });

  it("nimmt das eigene Bild vor dem Shop-Bild", () => {
    const result = pickInventoryImages({
      ownImages: new Map([["a", "own-a"]]),
      shopImages: new Map([
        ["a", "shop-a"],
        ["b", "shop-b"],
      ]),
      itemIds: ["a", "b", "c"],
    });
    expect([...result]).toEqual([
      ["a", "own-a"],
      ["b", "shop-b"],
    ]);
  });
});
