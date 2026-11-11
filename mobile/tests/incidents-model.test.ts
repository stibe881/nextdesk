import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseIncidentDetail, parseIncidentList } from "../lib/incidents-model";

describe("incidents model in the app", () => {
  it("is the same file as in the web app", () => {
    const app = readFileSync(
      resolve(__dirname, "../lib/incidents-model.ts"),
      "utf8",
    );
    const web = readFileSync(
      resolve(__dirname, "../../apps/web/src/lib/incidents.ts"),
      "utf8",
    );
    expect(app).toBe(web);
  });

  it("reads tickets and the network context", () => {
    const detail = parseIncidentDetail({
      data: {
        id: "i1",
        number: "STO-2026-0001",
        title: "SW-CORE",
        state: "resolved",
        openedAt: "2026-11-10T08:00:00Z",
        tickets: [
          {
            id: "t1",
            number: "T-1",
            subject: "WLAN",
            closed: false,
            source: "asset",
          },
        ],
        network: {
          addresses: [
            { address: "10.0.0.2", prefix: "10.0.0.0/24", vlanNumber: 10 },
          ],
          subnetNeighbours: [{ name: "AP 1", state: "down", incidentId: "i2" }],
          switchNeighbours: [],
        },
      },
    });
    expect(detail?.state).toBe("resolved");
    expect(detail?.tickets[0]?.source).toBe("asset");
    expect(detail?.network?.subnetNeighbours[0]?.incidentId).toBe("i2");
  });

  it("a later page has no tiles", () => {
    const page = parseIncidentList({
      data: { incidents: [], nextCursor: null },
    });
    expect(page?.stats).toBeNull();
    expect(page?.nextCursor).toBeNull();
  });
});
