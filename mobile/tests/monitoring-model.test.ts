import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  chartGeometry,
  formatValue,
  sensorValueText,
} from "../lib/monitoring-model";

const CALL_START = "/** Calls `monitoring-sensors`";
const CALL_END = "export const STATE_LABELS";

describe("monitoring model in the app", () => {
  it("has the same types and helpers as the web app", () => {
    const app = readFileSync(
      resolve(__dirname, "../lib/monitoring-model.ts"),
      "utf8",
    );
    const web = readFileSync(
      resolve(__dirname, "../../apps/web/src/lib/monitoring.ts"),
      "utf8",
    );
    // The web file additionally holds the call of the edge function.
    const types = (text: string) =>
      text.slice(text.indexOf("export type MonitoringState"));
    const webTypes = types(web);
    const expected =
      webTypes.slice(0, webTypes.indexOf(CALL_START)) +
      webTypes.slice(webTypes.indexOf(CALL_END));
    expect(types(app)).toBe(expected);
  });

  it("formats values and draws both traffic lines", () => {
    expect(formatValue(38_400_000, "bit/s")).toBe("38 Mbit/s");
    expect(
      sensorValueText({
        lastValue: 38_400_000,
        lastValue2: 4_100_000,
        unit: "bit/s",
        snmpMetric: "traffic",
      }),
    ).toBe("ein 38 Mbit/s · aus 4.1 Mbit/s");
    const chart = chartGeometry(
      {
        from: "2026-11-16T09:00:00Z",
        range: "24h",
        bucketSeconds: 300,
        unit: "bit/s",
        points: [
          { t: "2026-11-16T09:00:00Z", avg: 4e6, min: 4e6, max: 4e6, ok: 1, avg2: 1e6, max2: 1e6 },
          { t: "2026-11-16T09:05:00Z", avg: 8e6, min: 8e6, max: 8e6, ok: 1, avg2: 2e6, max2: 2e6 },
        ],
      },
      Date.parse("2026-11-16T10:00:00Z"),
      null,
      340,
      190,
    );
    expect([chart.lines.length, chart.lines2.length, chart.width]).toEqual([
      1, 1, 340,
    ]);
  });
});
