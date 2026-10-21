import { describe, expect, it } from "vitest";
import { buildServiceStatusHistoryDays } from "./service-status-history";

describe("buildServiceStatusHistoryDays", () => {
  it("uses the server-provided status before the window until a later change", () => {
    const now = new Date("2026-10-21T12:00:00.000Z");
    const days = buildServiceStatusHistoryDays(
      {
        status: "major_outage",
        history: [
          {
            changedAt: new Date(
              now.getTime() - 120 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            status: "operational",
          },
          {
            changedAt: new Date(
              now.getTime() - 24 * 60 * 60 * 1000,
            ).toISOString(),
            status: "major_outage",
          },
        ],
      },
      now,
    );

    expect(days).toHaveLength(90);
    expect(days[0]).toBe("operational");
    expect(days[87]).toBe("operational");
    expect(days[89]).toBe("major_outage");
  });

  it("falls back to the server-authorized current state when no history exists", () => {
    expect(
      buildServiceStatusHistoryDays(
        { history: [], status: "maintenance" },
        new Date("2026-10-21T12:00:00.000Z"),
      ),
    ).toEqual(Array<ServiceStatus>(90).fill("maintenance"));
  });
});

type ServiceStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance";
