import { describe, expect, it } from "vitest";

import {
  dominantSentiment,
  monthLabel,
  parseFeedbackReport,
  ratingTotals,
  teamsForDepartment,
} from "./feedback-insights";

const report = {
  data: {
    aiEnabled: true,
    aiReason: null,
    months: ["2026-10-01", "2026-11-01", "kaputt"],
    ratings: [
      {
        month: "2026-10-01",
        count: 2,
        average: 3,
        distribution: [0, 1, 0, 1],
        commentCount: 1,
      },
      {
        month: "2026-11-01",
        count: 1,
        average: 5,
        distribution: [0, 0, 0, 0, 1],
        commentCount: 1,
      },
    ],
    themes: {
      totalMentions: 3,
      pendingCount: 4,
      top: [
        {
          key: "long_wait",
          label: "Lange Wartezeit",
          count: 2,
          share: 66.7,
          sentiments: { negative: 2 },
        },
      ],
      trend: [{ month: "2026-11-01", counts: { long_wait: 2, x: "a" } }],
      quotes: [
        { themeKey: "long_wait", sentiment: "negative", quote: "Zu lange." },
        { themeKey: "long_wait", quote: 5 },
      ],
    },
    filters: {
      departments: [{ id: "d1", name: "IT" }],
      teams: [
        { id: "t1", name: "Service Desk", departmentId: "d1" },
        { id: "t2", name: "Facility", departmentId: "d2" },
      ],
    },
  },
};

describe("Feedback-Auswertung", () => {
  it("liest den Bericht defensiv", () => {
    const parsed = parseFeedbackReport(report)!;
    expect(parsed.months).toEqual(["2026-10-01", "2026-11-01"]);
    expect(parsed.ratings[0]!.distribution).toEqual([0, 1, 0, 1, 0]);
    expect(parsed.themes!.top[0]!.sentiments).toEqual({
      positive: 0,
      neutral: 0,
      negative: 2,
      mixed: 0,
    });
    expect(parsed.themes!.trend[0]!.counts).toEqual({ long_wait: 2, x: 0 });
    expect(parsed.themes!.quotes).toHaveLength(1);
    expect(parseFeedbackReport({ data: { months: [] } })).toBeNull();
  });

  it("zeigt ohne KI keine Themen", () => {
    const parsed = parseFeedbackReport({
      data: {
        ...report.data,
        aiEnabled: false,
        aiReason: "ai_feature_disabled",
      },
    })!;
    expect(parsed.themes).toBeNull();
    expect(parsed.ratings).toHaveLength(2);
  });

  it("berechnet Summen, Stimmung, Teamfilter und Monatsnamen", () => {
    const parsed = parseFeedbackReport(report)!;
    expect(ratingTotals(parsed.ratings)).toEqual({
      count: 3,
      average: 3.67,
      commentCount: 2,
    });
    expect(
      dominantSentiment({ positive: 2, negative: 2, neutral: 0, mixed: 0 }),
    ).toBe("negative");
    expect(teamsForDepartment(parsed.filters.teams, "d1")).toHaveLength(1);
    expect(teamsForDepartment(parsed.filters.teams, null)).toHaveLength(2);
    expect(monthLabel("2026-11-01")).toMatch(/Nov/);
  });
});
