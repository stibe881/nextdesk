import { describe, expect, it } from "vitest";

import {
  chartGeometry,
  formatAgo,
  formatMs,
  formatSince,
  matchesSearch,
  sensorCountsText,
  sensorTarget,
  type MonitoringDeviceRow,
} from "./monitoring";

const NOW = Date.parse("2026-11-16T10:00:00Z");

describe("Überwachung: Formatierung", () => {
  it("zeigt Antwortzeiten und Zeitabstände kurz an", () => {
    expect(formatMs(null)).toBe("–");
    expect(formatMs(1.26)).toBe("1.3 ms");
    expect(formatMs(182.4)).toBe("182 ms");
    expect(formatAgo(null, NOW)).toBe("noch nie");
    expect(formatAgo("2026-11-16T09:59:48Z", NOW)).toBe("vor 12 Sek.");
    expect(formatAgo("2026-11-16T09:46:00Z", NOW)).toBe("vor 14 Min.");
    expect(formatAgo("2026-11-16T07:00:00Z", NOW)).toBe("vor 3 Std.");
    expect(formatAgo("2026-11-13T10:00:00Z", NOW)).toBe("vor 3 Tagen");
    expect(formatSince("2026-11-16T09:46:00Z", NOW)).toBe("seit 14 Min.");
    expect(formatSince(null, NOW)).toBe("");
  });

  it("beschreibt Ziel und Sensorzahlen", () => {
    const device = { ipAddress: "10.0.0.2", hostname: "sw-core.local" };
    expect(
      sensorTarget(
        { kind: "ping", target: null, port: null, url: null },
        device,
      ),
    ).toBe("10.0.0.2");
    expect(
      sensorTarget(
        { kind: "tcp", target: "srv01", port: 3389, url: null },
        device,
      ),
    ).toBe("srv01:3389");
    expect(
      sensorTarget(
        { kind: "http", target: null, port: null, url: "https://x.ch/" },
        device,
      ),
    ).toBe("https://x.ch/");
    expect(
      sensorCountsText({ down: 1, warning: 0, up: 8, unknown: 0, paused: 2 }),
    ).toBe("1 Ausfall · 8 OK · 2 Pausiert");
    expect(
      sensorCountsText({ down: 0, warning: 0, up: 0, unknown: 0, paused: 0 }),
    ).toBe("keine Sensoren");
  });

  it("sucht in Name, Adresse und gestörtem Sensor", () => {
    const device = {
      name: "SW-Core",
      hostname: "sw-core.local",
      ipAddress: "10.0.0.2",
      problem: { sensorName: "Ping" },
    } as MonitoringDeviceRow;
    expect(matchesSearch(device, " core ")).toBe(true);
    expect(matchesSearch(device, "10.0.0")).toBe(true);
    expect(matchesSearch(device, "ping")).toBe(true);
    expect(matchesSearch(device, "firewall")).toBe(false);
    expect(matchesSearch(device, "")).toBe(true);
  });
});

describe("Überwachung: Verlaufsgrafik", () => {
  const series = {
    from: "2026-11-16T09:00:00Z",
    range: "24h" as const,
    bucketSeconds: 300,
    points: [
      { t: "2026-11-16T09:00:00Z", avg: 10, min: 5, max: 20, ok: 1 },
      { t: "2026-11-16T09:05:00Z", avg: 30, min: 30, max: 30, ok: 1 },
      { t: "2026-11-16T09:10:00Z", avg: null, min: null, max: null, ok: 0 },
      { t: "2026-11-16T09:15:00Z", avg: 40, min: 40, max: 40, ok: 0.5 },
    ],
  };

  it("unterbricht die Linie bei Ausfall und markiert ihn", () => {
    const chart = chartGeometry(series, NOW, 25);
    expect(chart.lines).toHaveLength(2);
    expect(chart.lines[0]).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
    // Nur der erste Abschnitt hat eine Spanne zwischen Minimum und Maximum.
    expect(chart.bands).toHaveLength(1);
    expect(chart.failures.map((failure) => failure.share)).toEqual([1, 0.5]);
    expect(chart.yTicks.at(-1)?.label).toBe("50");
    expect(chart.threshold).not.toBeNull();
    expect(chart.xTicks).toHaveLength(5);
  });

  it("zeichnet ohne Messwerte nichts und blendet eine zu hohe Schwelle aus", () => {
    const empty = chartGeometry({ ...series, points: [] }, NOW, null);
    expect(empty.lines).toEqual([]);
    expect(empty.failures).toEqual([]);
    expect(empty.threshold).toBeNull();
  });
});
