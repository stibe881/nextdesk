import { describe, expect, it } from "vitest";
import {
  changeActor,
  changeDiff,
  durationText,
  findingsSummary,
  forecastLabel,
  forecastSentence,
  formatChangeTime,
  historyChart,
  percentText,
  percentTone,
} from "./ipam-format";

describe("forecast", () => {
  it("labels the forecast for tables", () => {
    expect(
      forecastLabel({ trend: "rising", daysToWarning: null, daysToFull: 18 }),
    ).toEqual({
      text: "voll in ca. 18 Tagen",
      tone: "danger",
    });
    expect(
      forecastLabel({ trend: "rising", daysToWarning: 10, daysToFull: 90 })
        .tone,
    ).toBe("warning");
    expect(
      forecastLabel({ trend: "rising", daysToWarning: 10, daysToFull: 90 })
        .text,
    ).toBe("voll in ca. 3 Monaten");
    expect(
      forecastLabel({ trend: "rising", daysToWarning: 420, daysToFull: null })
        .text,
    ).toBe("Warnschwelle in ca. 14 Monaten");
    expect(
      forecastLabel({ trend: "stable", daysToWarning: null, daysToFull: null })
        .text,
    ).toBe("stabil");
    expect(
      forecastLabel({ trend: "falling", daysToWarning: null, daysToFull: null })
        .text,
    ).toBe("sinkt");
    expect(
      forecastLabel({ trend: "unknown", daysToWarning: null, daysToFull: null })
        .text,
    ).toBe("zu wenig Verlauf");
    expect(
      forecastLabel({ trend: "rising", daysToWarning: null, daysToFull: 0 })
        .text,
    ).toBe("voll");
    expect(forecastLabel(null).text).toBe("–");
  });

  it("writes a sentence for the detail", () => {
    expect(
      forecastSentence(
        { trend: "rising", daysToWarning: 420, daysToFull: 800 },
        85,
      ),
    ).toBe("Warnschwelle 85 % in ca. 14 Monaten");
    expect(
      forecastSentence(
        { trend: "unknown", daysToWarning: null, daysToFull: null },
        85,
      ),
    ).toContain("zu wenig Verlauf");
  });

  it("formats durations", () => {
    expect(durationText(1)).toBe("1 Tag");
    expect(durationText(44)).toBe("44 Tagen");
    expect(durationText(60)).toBe("2 Monaten");
    expect(durationText(1200)).toBe("3 Jahren");
  });
});

describe("change log", () => {
  const now = new Date(2026, 10, 11, 15, 0);
  it("formats times relative to today", () => {
    expect(
      formatChangeTime(new Date(2026, 10, 11, 14, 2).toISOString(), now),
    ).toBe("heute 14:02");
    expect(
      formatChangeTime(new Date(2026, 10, 10, 16, 40).toISOString(), now),
    ).toBe("gestern 16:40");
    expect(
      formatChangeTime(new Date(2026, 10, 9, 8, 30).toISOString(), now),
    ).toBe("09.11. 08:30");
    expect(
      formatChangeTime(new Date(2025, 10, 9, 8, 30).toISOString(), now),
    ).toBe("09.11.2025");
  });

  it("names the actor and the changes", () => {
    expect(changeActor({ source: "user", actorName: "S. Muster" })).toBe(
      "S. Muster",
    );
    expect(changeActor({ source: "cleanup", actorName: null })).toBe(
      "Bereinigung",
    );
    expect(changeActor({ source: "planner", actorName: "S. Muster" })).toBe(
      "Planer (S. Muster)",
    );
    expect(
      changeDiff({
        summary: "Status geändert",
        changes: [
          {
            field: "status",
            label: "Status",
            before: "Aktiv",
            after: "Container",
          },
        ],
      }),
    ).toBe("Status: Aktiv → Container");
    expect(changeDiff({ summary: "angelegt", changes: [] })).toBe("angelegt");
  });
});

describe("misc", () => {
  it("summarizes findings by kind", () => {
    expect(
      findingsSummary({ ghost: 4, conflict: 2, dns_mismatch: 1, stale: 0 }),
    ).toBe("4 Ghost-IPs · 2 Konflikte · 1 DNS");
    expect(findingsSummary({})).toBe("");
  });

  it("tones and formats percent", () => {
    expect(percentTone(96)).toBe("danger");
    expect(percentTone(88)).toBe("warning");
    expect(percentTone(88, 90)).toBe("ok");
    expect(percentTone(null)).toBe("none");
    expect(percentText(41.4)).toBe("41 %");
    expect(percentText(null)).toBe("–");
  });

  it("builds a history chart with forecast", () => {
    const chart = historyChart(
      {
        points: [
          { day: "2026-08-13", used: 80, total: 254, percent: 34 },
          { day: "2026-11-11", used: 104, total: 254, percent: 41 },
        ],
        forecast: { trend: "rising", daysToWarning: 420, daysToFull: null },
        warningPercent: 85,
      },
      90,
    );
    expect(chart.measured.split(" ")).toHaveLength(2);
    expect(chart.forecast).not.toBeNull();
    expect(chart.forecast!.y2).toBeCloseTo(chart.warningY);
    expect(chart.endLabel).toBe("in ca. 14 Monaten");
    expect(chart.description).toContain("von 34 auf 41 Prozent");
  });

  it("draws no forecast without a target", () => {
    const chart = historyChart(
      {
        points: [],
        forecast: { trend: "stable", daysToWarning: null, daysToFull: null },
        warningPercent: 85,
      },
      90,
    );
    expect(chart.forecast).toBeNull();
    expect(chart.last).toBeNull();
  });
});
