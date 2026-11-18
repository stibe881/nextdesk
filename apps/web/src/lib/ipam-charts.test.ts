import { describe, expect, it } from "vitest";
import {
  changeText,
  gappedPath,
  nearestPoint,
  ringDash,
  sparklinePath,
  spaceGrid,
  totalPercentOf,
  trendChart,
  trendKpis,
} from "./ipam-charts";
import type { UtilizationHistory } from "./ipam-redesign-types";

function history(
  values: number[],
  forecast: UtilizationHistory["forecast"],
): UtilizationHistory {
  return {
    points: values.map((percent, index) => ({
      day: `2026-10-${String(index + 1).padStart(2, "0")}`,
      used: percent,
      total: 100,
      percent,
    })),
    forecast,
    warningPercent: 85,
  };
}

describe("trendChart", () => {
  it("zooms the y axis and adds a forecast band to «full»", () => {
    const chart = trendChart(
      history([82, 84, 86, 88, 90], {
        trend: "rising",
        daysToWarning: null,
        daysToFull: 40,
      }),
      90,
    );
    expect(chart.domain.min).toBe(60);
    expect(chart.yTicks[0]!.label).toBe("100 %");
    expect(chart.points).toHaveLength(5);
    expect(chart.points[4]!.x).toBe(chart.todayX);
    expect(chart.forecast).not.toBeNull();
    expect(chart.forecast!.endY).toBe(chart.plot.top);
    // Only 5 days of data: the axis starts at the first day, not 90 days back.
    expect(chart.points[0]!.x).toBe(chart.plot.left);
    expect(chart.xTicks.map((tick) => tick.label)).toEqual([
      "seit 01.10.",
      "heute",
      "in ca. 40 Tagen",
    ]);
    expect(chart.area.endsWith("Z")).toBe(true);
    expect(chart.description).toContain("seit 01.10. von 82 auf 90 Prozent");
  });

  it("uses the full width without forecast and handles low values", () => {
    const chart = trendChart(
      history([5, 6, 7], {
        trend: "stable",
        daysToWarning: null,
        daysToFull: null,
      }),
      30,
    );
    expect(chart.forecast).toBeNull();
    expect(chart.todayX).toBe(chart.plot.right);
    expect(chart.domain.min).toBe(0);
    expect(nearestPoint(chart.points, chart.plot.right)).toBe(2);
    expect(nearestPoint([], 10)).toBe(-1);
  });
});

describe("sparkline and ring", () => {
  it("builds a path with the last point", () => {
    const path = sparklinePath([10, 20, 30], 100, 20);
    expect(path.line.startsWith("M")).toBe(true);
    expect(path.last?.x).toBe(98);
    expect(path.area.endsWith("Z")).toBe(true);
    expect(sparklinePath([5]).last).toBeNull();
  });

  it("computes the dash of a ring", () => {
    expect(ringDash(50, 10).dash).toBe("31.4 62.8");
    expect(ringDash(null, 10).dash).toBe("0 62.8");
    expect(ringDash(150, 10).dash).toBe("62.8 62.8");
  });
});

describe("spaceGrid", () => {
  it("maps a /16 to 256 /24 cells with full, partial and free cells", () => {
    const grid = spaceGrid("10.10.0.0/16", [
      { kind: "child", cidr: "10.10.0.0/24", size: "256", prefixId: "a" },
      { kind: "free", cidr: "10.10.1.0/24", size: "256" },
      { kind: "free", cidr: "10.10.2.0/23", size: "512" },
      { kind: "child", cidr: "10.10.4.0/22", size: "1024", prefixId: "b" },
      { kind: "child", cidr: "10.10.8.0/25", size: "128", prefixId: "c" },
    ])!;
    expect(grid.unitLength).toBe(24);
    expect(grid.columns).toBe(16);
    expect(grid.cells).toHaveLength(256);
    expect(grid.cells[0]).toMatchObject({ kind: "child", child: 0, fill: 1 });
    expect(grid.cells[1]!.kind).toBe("free");
    expect(grid.cells.slice(4, 8).every((cell) => cell.child === 1)).toBe(true);
    expect(grid.cells[8]).toMatchObject({
      kind: "partial",
      child: 2,
      fill: 0.5,
    });
    expect(grid.children.map((child) => child.cells)).toEqual([1, 4, 1]);
    expect(grid.children[1]!.firstCell).toBe(4);
  });

  it("uses fewer cells for small parents and supports IPv6", () => {
    const small = spaceGrid("10.0.0.0/28", [])!;
    expect(small.cells).toHaveLength(16);
    expect(small.unitLength).toBe(32);
    expect(small.columns).toBe(4);
    const v6 = spaceGrid("2001:db8::/48", [
      { kind: "child", cidr: "2001:db8:0:100::/56", size: "0", prefixId: "x" },
    ])!;
    expect(v6.unitLength).toBe(56);
    expect(v6.cells[1]).toMatchObject({ kind: "child" });
    expect(spaceGrid("kein Netz", [])).toBeNull();
  });
});

describe("trendChart with DHCP pool breakdown", () => {
  const breakdown: UtilizationHistory = {
    points: [
      // Day before the breakdown: approximation without lease data.
      {
        day: "2026-11-13",
        used: 30,
        total: 100,
        percent: 30,
        totalPercent: 30,
        approx: true,
      },
      {
        day: "2026-11-14",
        used: 30,
        total: 100,
        percent: 30,
        staticPercent: 40,
        poolPercent: 20,
        totalPercent: 30,
        approx: false,
      },
      {
        day: "2026-11-15",
        used: 33,
        total: 100,
        percent: 33,
        staticPercent: 42,
        poolPercent: null,
        totalPercent: 33,
        approx: false,
      },
      {
        day: "2026-11-16",
        used: 38,
        total: 100,
        percent: 38,
        staticPercent: 45,
        poolPercent: 30,
        totalPercent: 38,
        approx: false,
      },
    ],
    forecast: { trend: "rising", daysToWarning: 60, daysToFull: null },
    warningPercent: 85,
    days: 90,
    firstDay: "2026-11-13",
  };

  it("draws total, static and pool series and zooms to the lowest value", () => {
    const chart = trendChart(breakdown, 90);
    expect(chart.series).toEqual({ static: true, pool: true });
    expect(chart.domain.min).toBe(10);
    expect(chart.points.map((point) => point.percent)).toEqual([
      30, 30, 33, 38,
    ]);
    expect(chart.points.map((point) => point.approx)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(chart.approx).toEqual({ from: "2026-11-13", to: "2026-11-13" });
    // Static line starts on day 2; pool line has a gap on day 3.
    expect(chart.staticLine.match(/M/g)).toHaveLength(1);
    expect(chart.poolLine.match(/M/g)).toHaveLength(2);
    // Pool values without a neighbour (gap on day 3) are drawn as dots.
    expect(chart.dots).toEqual([
      { series: "pool", x: chart.points[1]!.x, y: chart.points[1]!.poolY },
      { series: "pool", x: chart.points[3]!.x, y: chart.points[3]!.poolY },
    ]);
    expect(chart.points[1]!.poolY).toBeGreaterThan(chart.points[1]!.y);
    expect(chart.points[1]!.staticY).toBeLessThan(chart.points[1]!.y);
    expect(chart.description).toContain("ohne DHCP-Pool 45 Prozent");
    expect(chart.description).toContain("im DHCP-Pool 30 Prozent");
  });

  it("KPIs use the oldest available day in the window", () => {
    expect(trendKpis(breakdown)).toEqual({
      today: 38,
      first: 30,
      firstDay: "2026-11-13",
      days: 3,
      change: 8,
    });
    expect(totalPercentOf(breakdown.points[0]!)).toBe(30);
    expect(totalPercentOf(breakdown.points[3]!)).toBe(38);
    expect(trendKpis({ ...breakdown, points: [] })).toBeNull();
    expect(changeText(8)).toBe("+8 Punkte");
    expect(changeText(-55.2)).toBe("−55 Punkte");
    expect(changeText(0.3)).toBe("±0 Punkte");
  });

  it("customer case: pool 139, 59 addresses, 4 old rows and today", () => {
    const old = ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"].map(
      (day) => ({
        day,
        used: 59,
        total: 254,
        percent: 23.2,
        totalPercent: 23.2,
        approx: true,
        staticPercent: null,
        poolPercent: null,
      }),
    );
    const customer: UtilizationHistory = {
      points: [
        ...old,
        {
          day: "2026-11-16",
          used: 59,
          total: 254,
          percent: 23.2,
          totalPercent: 23.2,
          approx: false,
          staticPercent: 51.3,
          poolPercent: 0,
        },
      ],
      forecast: { trend: "stable", daysToWarning: null, daysToFull: null },
      warningPercent: 85,
      days: 90,
      firstDay: "2026-11-11",
    };
    const chart = trendChart(customer, 90);
    // Flat, no drop; axis starts at the first measurement, not «vor 90 Tagen».
    expect(new Set(chart.points.map((point) => point.y)).size).toBe(1);
    expect(chart.xTicks[0]!.label).toBe("seit 11.11.");
    expect(chart.points[0]!.x).toBeGreaterThan(chart.plot.left);
    expect(chart.points[4]!.x).toBe(chart.todayX);
    // Both breakdown series only exist today: visible dots with legend.
    expect(chart.dots.map((dot) => dot.series)).toEqual(["static", "pool"]);
    expect(chart.series).toEqual({ static: true, pool: true });
    expect(chart.approx).toEqual({ from: "2026-11-12", to: "2026-11-15" });
    expect(trendKpis(customer)).toMatchObject({
      today: 23.2,
      first: 23.2,
      days: 4,
      change: 0,
    });
  });

  it("keeps «vor N Tagen» when data is older than the window", () => {
    const chart = trendChart({ ...breakdown, firstDay: "2026-01-01" }, 90);
    expect(chart.xTicks[0]!.label).toBe("vor 90 Tagen");
    // 2026-11-13 lies 87 days after the window start (2026-08-18).
    expect(chart.points[0]!.x).toBeGreaterThan(chart.plot.left + 100);
  });

  it("a single day draws a dot for every series and no start label", () => {
    const chart = trendChart(
      {
        ...breakdown,
        points: breakdown.points.slice(3),
        firstDay: "2026-11-16",
      },
      90,
    );
    expect(chart.points[0]!.x).toBe(chart.todayX);
    expect(chart.dots.map((dot) => dot.series)).toEqual([
      "static",
      "pool",
      "total",
    ]);
    expect(chart.xTicks.map((tick) => tick.label)).toEqual([
      "heute",
      "in ca. 2 Monaten",
    ]);
    expect(chart.area).toBe("");
    expect(
      trendKpis({ ...breakdown, points: breakdown.points.slice(3) }),
    ).toMatchObject({ days: 0, change: 0 });
  });

  it("hides the pool series for a prefix without pool", () => {
    const chart = trendChart(
      {
        ...breakdown,
        points: breakdown.points.map((point) => ({
          ...point,
          poolPercent: null,
        })),
      },
      90,
    );
    expect(chart.series).toEqual({ static: true, pool: false });
    expect(chart.poolLine).toBe("");
  });

  it("gappedPath breaks at missing values", () => {
    expect(
      gappedPath([
        { x: 1, y: 2 },
        { x: 2, y: null },
        { x: 3, y: 4 },
        { x: 4, y: 5 },
      ]),
    ).toBe("M1 2 M3 4 L4 5");
    expect(gappedPath([{ x: 1, y: null }])).toBe("");
  });
});
