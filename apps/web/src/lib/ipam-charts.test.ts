import { describe, expect, it } from "vitest";
import {
  nearestPoint,
  ringDash,
  sparklinePath,
  spaceGrid,
  trendChart,
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
    expect(chart.xTicks.map((tick) => tick.label)).toEqual([
      "vor 90 Tagen",
      "heute",
      "in ca. 40 Tagen",
    ]);
    expect(chart.area.endsWith("Z")).toBe(true);
    expect(chart.description).toContain("von 82 auf 90 Prozent");
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
