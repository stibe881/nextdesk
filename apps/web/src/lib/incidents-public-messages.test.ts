import { describe, expect, it } from "vitest";

import {
  filterStatusPageServices,
  parseStatusPageServices,
  suggestedServiceState,
} from "./incidents-public-messages";

describe("status page services of an incident message", () => {
  it("parses the overview services sorted by name", () => {
    expect(
      parseStatusPageServices({
        data: {
          services: [
            {
              id: "b",
              name: "Teams",
              status: "degraded",
              categoryPath: ["Microsoft 365"],
            },
            { id: "a", name: "E-Mail", status: "operational" },
            { id: "c", name: "Kaputt", status: "unknown" },
          ],
        },
      }),
    ).toEqual([
      { id: "a", name: "E-Mail", category: "", status: "operational" },
      {
        id: "b",
        name: "Teams",
        category: "Microsoft 365",
        status: "degraded",
      },
    ]);
    expect(parseStatusPageServices(null)).toEqual([]);
  });

  it("suggests an operating state for an added service", () => {
    expect(suggestedServiceState("operational", "investigating")).toBe(
      "partial_outage",
    );
    expect(suggestedServiceState("major_outage", "identified")).toBe(
      "major_outage",
    );
    expect(suggestedServiceState("major_outage", "resolved")).toBe(
      "operational",
    );
  });

  it("finds services by name or category", () => {
    const services = [
      { id: "a", name: "E-Mail", category: "", status: "operational" as const },
      {
        id: "b",
        name: "Teams",
        category: "Microsoft 365",
        status: "operational" as const,
      },
    ];
    expect(filterStatusPageServices(services, "team").map((s) => s.id)).toEqual(
      ["b"],
    );
    expect(
      filterStatusPageServices(services, "microsoft tea").map((s) => s.id),
    ).toEqual(["b"]);
    expect(filterStatusPageServices(services, "  ")).toHaveLength(2);
  });
});
