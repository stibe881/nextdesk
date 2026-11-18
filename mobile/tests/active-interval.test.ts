import { describe, expect, it } from "vitest";

import { shouldRunOnWake } from "../lib/active-interval";

describe("shouldRunOnWake", () => {
  it("lädt beim Zurückkommen nur nach der halben Wartezeit nach", () => {
    expect(shouldRunOnWake("active", 0, 30_000, 60_000)).toBe(true);
    expect(shouldRunOnWake("active", 0, 29_999, 60_000)).toBe(false);
    expect(shouldRunOnWake("background", 0, 90_000, 60_000)).toBe(false);
  });
});
