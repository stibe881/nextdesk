import { describe, expect, it } from "vitest";
import { previewText } from "./ticket-hover-preview";

describe("previewText", () => {
  it("strips markup and shortens", () => {
    expect(previewText("<p>Hallo   <b>Welt</b></p>")).toBe("Hallo Welt");
    expect(previewText("a".repeat(50), 10)).toBe(`${"a".repeat(9)}…`);
  });
});
