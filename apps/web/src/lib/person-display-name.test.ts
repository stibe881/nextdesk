import { describe, expect, it } from "vitest";

import { formatPersonDisplayName } from "./person-display-name";

describe("formatPersonDisplayName", () => {
  it("setzt vollständig klein geschriebene Vor- und Nachnamen für die Anzeige korrekt", () => {
    expect(formatPersonDisplayName("stefan gross")).toBe("Stefan Gross");
    expect(formatPersonDisplayName("  anna-maria o’connor  ")).toBe(
      "Anna-Maria O’Connor",
    );
  });

  it("bewahrt gepflegte Eigenschreibweisen und E-Mail-Adressen", () => {
    expect(formatPersonDisplayName("McDonald Service")).toBe(
      "McDonald Service",
    );
    expect(formatPersonDisplayName("stefan.gross@example.ch")).toBe(
      "stefan.gross@example.ch",
    );
  });
});
