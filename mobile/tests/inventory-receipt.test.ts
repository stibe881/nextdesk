import { describe, expect, it } from "vitest";

import { parseReceiptQuantity } from "../lib/inventory-quantity";

describe("parseReceiptQuantity", () => {
  it("accepts integers and decimals with comma or dot", () => {
    expect(parseReceiptQuantity("3")).toBe(3);
    expect(parseReceiptQuantity(" 2,5 ")).toBe(2.5);
    expect(parseReceiptQuantity("0.125")).toBe(0.125);
  });

  it("rejects zero, negative, empty and over-precise values", () => {
    for (const value of ["0", "-1", "", "abc", "1.2345", "1e3", "2000000"]) {
      expect(parseReceiptQuantity(value)).toBeNull();
    }
  });
});
