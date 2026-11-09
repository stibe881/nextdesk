import { describe, expect, it } from "vitest";

import { formatRequesterName } from "../lib/person-name";

describe("formatRequesterName", () => {
  it("capitalises lower-case names and keeps the rest", () => {
    expect(formatRequesterName("stefan gross")).toBe("Stefan Gross");
    expect(formatRequesterName("anna müller-kunz")).toBe("Anna Müller-Kunz");
    expect(formatRequesterName("Stewie Griffin")).toBe("Stewie Griffin");
    expect(formatRequesterName("max@muster.ch")).toBe("max@muster.ch");
  });
});
