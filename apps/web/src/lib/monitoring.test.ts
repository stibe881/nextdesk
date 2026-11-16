import { describe, expect, it } from "vitest";

import {
  chartGeometry,
  formatAgo,
  formatMs,
  formatSince,
  connectedPorts,
  formatValue,
  portLinkText,
  type MonitoringPort,
  guessCategory,
  sensorValueText,
  thresholdText,
  trafficDraft,
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

describe("Überwachung: SNMP-Werte", () => {
  it("formatiert nach Einheit", () => {
    expect(formatValue(null, "%")).toBe("–");
    expect(formatValue(412.4, null)).toBe("412 ms");
    expect(formatValue(91.26, "%")).toBe("91 %");
    expect(formatValue(1_240_000_000, "bit/s")).toBe("1.2 Gbit/s");
    expect(formatValue(38_400_000, "bit/s")).toBe("38 Mbit/s");
    expect(formatValue(12 * 86400 + 3 * 3600, "s")).toBe("12 Tg. 3 Std.");
  });

  it("zeigt Traffic in beide Richtungen und die Schwellen", () => {
    expect(
      sensorValueText({
        lastValue: 38_400_000,
        lastValue2: 4_100_000,
        unit: "bit/s",
        snmpMetric: "traffic",
      }),
    ).toBe("ein 38 Mbit/s · aus 4.1 Mbit/s");
    expect(
      sensorValueText({
        lastValue: null,
        lastValue2: null,
        unit: "bit/s",
        snmpMetric: "traffic",
      }),
    ).toBe("wird ermittelt");
    expect(
      thresholdText({
        warningAbove: null,
        warningBelow: 50,
        downAbove: null,
        downBelow: 20,
        unit: "%",
      }),
    ).toBe("Warnung unter 50 % · Ausfall unter 20 %");
    expect(
      thresholdText({
        warningAbove: 250,
        warningBelow: null,
        downAbove: null,
        downBelow: null,
        unit: null,
      }),
    ).toBe("Warnung über 250 ms");
  });

  it("baut den Traffic-Sensor aus einem ausgelesenen Port", () => {
    const draft = trafficDraft(
      "asset",
      "agent",
      {
        index: 49,
        name: "1/1/49",
        alias: "to_SW-CORE",
        up: true,
        speedMbps: 10000,
      },
      300,
    );
    expect([
      draft.kind,
      draft.snmpMetric,
      draft.snmpIndex,
      draft.name,
      draft.unit,
      draft.intervalSeconds,
    ]).toEqual([
      "snmp",
      "traffic",
      49,
      "1/1/49 to_SW-CORE Traffic",
      "bit/s",
      300,
    ]);
  });

  it("zeichnet die zweite Linie für ausgehenden Traffic", () => {
    const chart = chartGeometry(
      {
        from: "2026-11-16T09:00:00Z",
        range: "24h",
        bucketSeconds: 300,
        unit: "bit/s",
        points: [
          {
            t: "2026-11-16T09:00:00Z",
            avg: 4e6,
            min: 4e6,
            max: 4e6,
            ok: 1,
            avg2: 1e6,
            max2: 1e6,
          },
          {
            t: "2026-11-16T09:05:00Z",
            avg: 8e6,
            min: 8e6,
            max: 8e6,
            ok: 1,
            avg2: 2e6,
            max2: 2e6,
          },
        ],
      },
      NOW,
      null,
    );
    expect(chart.lines).toHaveLength(1);
    expect(chart.lines2).toHaveLength(1);
    expect(chart.yTicks.at(-1)?.label).toBe("10 Mbit/s");
  });
});

describe("Überwachung: Art aus dem Namen", () => {
  it("erkennt gängige Namensmuster und fällt sonst auf «other» zurück", () => {
    expect(guessCategory("SOBE-BAAR-ASW01", null)).toBe("switch");
    expect(guessCategory("sw-01")).toBe("switch");
    expect(guessCategory("ap-12", "Access Point 2. OG")).toBe("access_point");
    expect(guessCategory("fw01")).toBe("firewall");
    expect(guessCategory("srv-print-01")).toBe("server");
    expect(guessCategory(null, "Drucker Empfang")).toBe("other");
    expect(guessCategory(null, undefined)).toBe("other");
  });
});

describe("Überwachung: Verbindungen", () => {
  const port = (overrides: Partial<MonitoringPort>): MonitoringPort => ({
    port: "1/1/1",
    alias: null,
    up: true,
    speedMbps: 1000,
    link: null,
    deviceCount: 0,
    ...overrides,
  });
  const link = {
    source: "lldp" as const,
    name: "DSW01",
    port: "1/1/24",
    address: null,
    mac: null,
    assetId: null,
    monitored: false,
  };

  it("zeigt standardmässig nur Ports mit Gegenstelle", () => {
    const ports = [
      port({ port: "a", link }),
      port({ port: "b", deviceCount: 40 }),
      port({ port: "c" }),
      port({ port: "d", up: false, deviceCount: 2 }),
    ];
    expect(connectedPorts(ports).map((entry) => entry.port)).toEqual([
      "a",
      "b",
    ]);
  });

  it("beschreibt die Gegenstelle", () => {
    expect(portLinkText(port({ link }))).toBe("DSW01 · Port 1/1/24");
    expect(portLinkText(port({ deviceCount: 40 }))).toBe(
      "40 Geräte (Uplink oder Trunk)",
    );
    expect(portLinkText(port({ deviceCount: 2 }))).toBe("2 unbekannte Geräte");
    expect(portLinkText(port({}))).toBe("–");
  });
});
