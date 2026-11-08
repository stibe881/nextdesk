import { describe, expect, it } from "vitest";
import { parseMonitoringConfig, PRTG_POSTDATA } from "./monitoring-settings";

describe("monitoring settings", () => {
  it("parses a complete configuration", () => {
    expect(
      parseMonitoringConfig({
        configured: true,
        enabled: true,
        departmentId: null,
        teamId: "11111111-1111-4111-8111-111111111111",
        createOn: "down_and_warning",
        autoResolve: false,
        setServiceStatus: true,
        priorityKey: "high",
        hasToken: true,
        tokenRotatedAt: "2026-11-07T10:00:00.000Z",
        lastReceivedAt: null,
      }),
    ).toMatchObject({
      createOn: "down_and_warning",
      priorityKey: "high",
      teamId: "11111111-1111-4111-8111-111111111111",
    });
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
