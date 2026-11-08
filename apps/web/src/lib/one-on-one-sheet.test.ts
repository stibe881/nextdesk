import { describe, expect, it } from "vitest";
import { buildOneOnOneSheet, trendArrow } from "./one-on-one-sheet";

describe("one-on-one sheet", () => {
  it("shows trend arrows with the right direction", () => {
    expect(trendArrow(10, 8, true)).toBe("↑");
    expect(trendArrow(30, 45, false)).toBe("↑");
    expect(trendArrow(50, 45, false)).toBe("↓");
    expect(trendArrow(null, 3, true)).toBe("→");
  });
  it("escapes content and separates goals", () => {
    const html = buildOneOnOneSheet({
      agentName: "Anna <Test>",
      supervisorName: "Chef",
      monthLabel: "November 2026",
      current: null,
      previous: null,
      notes: [
        {
          kind: "goal",
          body: "Mehr Wissensartikel",
          createdAt: "2026-11-01T10:00:00Z",
        },
        {
          kind: "praise",
          body: "Super Feedback",
          createdAt: "2026-11-02T10:00:00Z",
        },
      ],
      reviews: [],
    });
    expect(html).toContain("Anna &lt;Test&gt;");
    expect(html.indexOf("Mehr Wissensartikel")).toBeLessThan(
      html.indexOf("Super Feedback"),
    );
    expect(html).toContain("Keine Kennzahlen");
    expect(html).toContain("Kein Lob in den letzten sechs Monaten.");
  });
  it("lists customer praise without e-mail addresses", () => {
    const html = buildOneOnOneSheet({
      agentName: "Anna",
      supervisorName: "Chef",
      monthLabel: "November 2026",
      current: null,
      previous: null,
      notes: [],
      reviews: [],
      kudos: [
        {
          score: 5,
          comment: "Schnell & freundlich <3",
          requesterName: "Beat Muster",
          ticketNumber: "ICT-1",
          createdAt: "2026-11-03T10:00:00Z",
        },
        {
          score: 4,
          comment: null,
          requesterName: "beat@example.ch",
          ticketNumber: "ICT-2",
          createdAt: "2026-11-04T10:00:00Z",
        },
      ],
    });
    expect(html).toContain("Lob von Kund:innen");
    expect(html).toContain("«Schnell &amp; freundlich &lt;3»");
    expect(html).toContain("Beat Muster");
    expect(html).not.toContain("beat@example.ch");
    expect(html).toContain("Meldende Person");
    expect(html.indexOf("Lob von Kund:innen")).toBeLessThan(
      html.indexOf("Letzte Qualitätsprüfungen"),
    );
  });
});
