import { describe, expect, it } from "vitest";
import { parseMonitoringConfig, PRTG_POSTDATA } from "./monitoring-settings";

describe("monitoring settings", () => {
  it("parses a complete configuration", () => {
    expect(
      parseMonitoringConfig({
        configured: true,
        enabled: true,
        teamId: "11111111-1111-4111-8111-111111111111",
        createOn: "down_and_warning",
        setServiceStatus: true,
        hasToken: true,
        tokenRotatedAt: "2026-11-07T10:00:00.000Z",
        lastReceivedAt: null,
      }),
    ).toMatchObject({
      createOn: "down_and_warning",
      teamId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("ignores the former ticket settings", () => {
    const config = parseMonitoringConfig({
      enabled: true,
      createOn: "down",
      setServiceStatus: false,
      hasToken: false,
      autoResolve: true,
      priorityKey: "high",
      departmentId: "11111111-1111-4111-8111-111111111111",
    });
    expect(config).not.toBeNull();
    expect(config).not.toHaveProperty("autoResolve");
    expect(config).not.toHaveProperty("priorityKey");
    expect(config).not.toHaveProperty("departmentId");
  });

  it("rejects unknown create-on values", () => {
    expect(
      parseMonitoringConfig({
        enabled: true,
        createOn: "always",
        autoResolve: false,
        setServiceStatus: false,
        hasToken: false,
      }),
    ).toBeNull();
  });

  it("postdata example uses PRTG placeholders", () => {
    for (const placeholder of [
      "%device",
      "%host",
      "%sensor",
      "%status",
      "%message",
    ]) {
      expect(PRTG_POSTDATA).toContain(placeholder);
    }
  });
});
