import { describe, expect, it } from "vitest";

import { dayHeadings } from "./day-heading";

describe("dayHeadings", () => {
  it("zeigt die Überschrift nur beim ersten Eintrag und bei Tageswechsel", () => {
    const result = dayHeadings([
      "2026-11-14T08:15:00",
      "2026-11-14T16:56:00",
      "2026-11-14T16:56:30",
      "2026-11-15T21:15:00",
    ]);
    expect(result[0]).toContain("14.11.2026");
    expect(result[1]).toBeNull();
    expect(result[2]).toBeNull();
    expect(result[3]).toContain("15.11.2026");
  });

  it("liefert für eine leere Liste nichts", () => {
    expect(dayHeadings([])).toEqual([]);
  });
});
