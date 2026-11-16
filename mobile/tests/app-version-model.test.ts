import { describe, expect, it } from "vitest";

import { formatAppVersion } from "../lib/app-version-model";

describe("formatAppVersion", () => {
  it("zeigt Version und Build", () => {
    expect(formatAppVersion("1.0.2", "10135")).toBe(
      "Version 1.0.2 (Build 10135)",
    );
  });

  it("lässt Fehlendes weg", () => {
    expect(formatAppVersion("1.0.2", null)).toBe("Version 1.0.2");
    expect(formatAppVersion(undefined, " 55 ")).toBe("Build 55");
    expect(formatAppVersion("", "")).toBe("");
  });
});
