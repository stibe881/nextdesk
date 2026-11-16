// Geometrie der IPAM-Grafiken (Verlauf mit Prognoseband, Sparkline,
// Adressraum-Raster). Reine Logik ohne React; Farben kommen aus dem CSS.

import { addressBits, cidrSize, formatCidr, parseCidrInput } from "./ipam-cidr";
import { durationText, forecastSentence } from "./ipam-format";
import type {
  AddressSegment,
  UtilizationHistory,
  UtilizationHistoryPoint,
} from "./ipam-redesign-types";

const round = (value: number) => Math.round(value * 10) / 10;

// ---------------------------------------------------------------------------
// Trend chart

export type TrendPoint = {
  x: number;
  y: number;
  day: string;
  /** «Belegt gesamt» (y of the main line). */
  percent: number;
  /** True when the day has no breakdown yet: `percent` is the old
   * measurement that counted the whole DHCP pool as used. */
  legacy: boolean;
  staticPercent: number | null;
  staticY: number | null;
  poolPercent: number | null;
  poolY: number | null;
};

/**
 * «Belegt gesamt» of a history point: the new value without double
 * counting, or the old measurement for days before the breakdown.
 */
export function totalPercentOf(point: UtilizationHistoryPoint): number {
  return point.totalPercent ?? point.percent;
}

/** KPI values above the chart, based on «Belegt gesamt». */
export function trendKpis(history: UtilizationHistory): {
  today: number;
  first: number;
  days: number;
  change: number;
} | null {
  const first = history.points[0];
  const last = history.points[history.points.length - 1];
  if (!first || !last) return null;
  const today = totalPercentOf(last);
  const start = totalPercentOf(first);
  return {
    today,
    first: start,
    days: history.points.length,
    change: round(today - start),
  };
}

/** Path through the defined values; gaps (null) start a new segment. */
export function gappedPath(coords: { x: number; y: number | null }[]): string {
  let pen = false;
  const parts: string[] = [];
  for (const point of coords) {
    if (point.y === null) {
      pen = false;
      continue;
    }
    parts.push(`${pen ? "L" : "M"}${point.x} ${point.y}`);
    pen = true;
  }
  return parts.join(" ");
}

export type TrendChart = {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  points: TrendPoint[];
  /** Polyline path of «Belegt gesamt». */
  line: string;
  /** «Belegt ohne DHCP-Pool» (empty without data). */
  staticLine: string;
  /** «Belegt im DHCP-Pool» (empty without pool or data). */
  poolLine: string;
  /** Which breakdown series have at least one value. */
  series: { static: boolean; pool: boolean };
  /** Closed area below the measured line. */
  area: string;
  /** Dashed forecast line and its uncertainty band, or null. */
  forecast: { line: string; band: string; endX: number; endY: number } | null;
  warningY: number;
  warningPercent: number;
  /** Horizontal grid lines with labels («80 %»). */
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string; anchor: "start" | "middle" | "end" }[];
  /** x of «heute». */
  todayX: number;
  domain: { min: number; max: number };
  description: string;
};

function niceFloor(value: number): number {
  return Math.max(0, Math.floor(value / 10) * 10);
}

/**
 * Area chart model of the utilization history. The y axis zooms to the
 * relevant range (at least 40 points, always up to 100 %) so small changes
 * stay visible. With a forecast target, the right 30 % show the projected
 * line to the threshold/full date with a widening band.
 */
export function trendChart(
  history: UtilizationHistory,
  days: number,
  width = 720,
  height = 240,
): TrendChart {
  const plot = { left: 44, right: width - 12, top: 16, bottom: height - 28 };
  const { forecast, points: raw, warningPercent } = history;
  const values = raw.flatMap((point) =>
    [totalPercentOf(point), point.staticPercent, point.poolPercent].filter(
      (value): value is number => typeof value === "number",
    ),
  );
  const lowest = Math.min(warningPercent, ...(values.length ? values : [0]));
  const min = Math.min(niceFloor(lowest - 8), 60);
  const domain = { min, max: 100 };
  const y = (percent: number) =>
    round(
      plot.bottom -
        ((Math.min(100, Math.max(min, percent)) - min) / (100 - min)) *
          (plot.bottom - plot.top),
    );
  const target =
    forecast.daysToWarning !== null && forecast.daysToWarning > 0
      ? { days: forecast.daysToWarning, percent: warningPercent }
      : forecast.daysToFull !== null && forecast.daysToFull > 0
        ? { days: forecast.daysToFull, percent: 100 }
        : null;
  const todayX = target
    ? round(plot.left + (plot.right - plot.left) * 0.7)
    : plot.right;
  const step = raw.length > 1 ? (todayX - plot.left) / (raw.length - 1) : 0;
  const points: TrendPoint[] = raw.map((point, index) => {
    const percent = totalPercentOf(point);
    const staticPercent = point.staticPercent ?? null;
    const poolPercent = point.poolPercent ?? null;
    return {
      x: round(plot.left + index * step),
      y: y(percent),
      day: point.day,
      percent,
      legacy: point.totalPercent === null || point.totalPercent === undefined,
      staticPercent,
      staticY: staticPercent === null ? null : y(staticPercent),
      poolPercent,
      poolY: poolPercent === null ? null : y(poolPercent),
    };
  });
  const line = points
    .map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`)
    .join(" ");
  const staticLine = gappedPath(
    points.map((point) => ({ x: point.x, y: point.staticY })),
  );
  const poolLine = gappedPath(
    points.map((point) => ({ x: point.x, y: point.poolY })),
  );
  const first = points[0];
  const last = points[points.length - 1];
  const area =
    first && last
      ? `${line} L${last.x} ${plot.bottom} L${first.x} ${plot.bottom} Z`
      : "";
  let forecastShape: TrendChart["forecast"] = null;
  if (target && last) {
    const endY = y(target.percent);
    const spread = Math.max(6, Math.abs(last.y - endY) * 0.35);
    forecastShape = {
      line: `M${last.x} ${last.y} L${plot.right} ${endY}`,
      band: `M${last.x} ${last.y} L${plot.right} ${round(Math.max(plot.top, endY - spread))} L${plot.right} ${round(Math.min(plot.bottom, endY + spread))} Z`,
      endX: plot.right,
      endY,
    };
  }
  const span = 100 - min;
  const tickStep = span > 60 ? 25 : span > 30 ? 10 : 5;
  const yTicks: TrendChart["yTicks"] = [];
  for (let value = 100; value >= min; value -= tickStep) {
    yTicks.push({ y: y(value), label: `${value} %` });
  }
  const xTicks: TrendChart["xTicks"] = [
    { x: plot.left, label: `vor ${days} Tagen`, anchor: "start" },
    {
      x: todayX,
      label: "heute",
      anchor: target ? "middle" : "end",
    },
  ];
  if (target) {
    xTicks.push({
      x: plot.right,
      label: `in ca. ${durationText(target.days)}`,
      anchor: "end",
    });
  }
  const breakdown = last
    ? [
        last.staticPercent !== null
          ? `ohne DHCP-Pool ${Math.round(last.staticPercent)} Prozent`
          : null,
        last.poolPercent !== null
          ? `im DHCP-Pool ${Math.round(last.poolPercent)} Prozent`
          : null,
      ].filter(Boolean)
    : [];
  const description = last
    ? `Belegung gesamt der letzten ${days} Tage${first ? ` von ${Math.round(first.percent)} auf ${Math.round(last.percent)} Prozent` : ""}.${breakdown.length ? ` Heute belegt ${breakdown.join(", ")}.` : ""} ${forecastSentence(forecast, warningPercent)}`
    : "Noch kein Verlauf vorhanden.";
  return {
    width,
    height,
    plot,
    points,
    line,
    staticLine,
    poolLine,
    series: {
      static: points.some((point) => point.staticPercent !== null),
      pool: points.some((point) => point.poolPercent !== null),
    },
    area,
    forecast: forecastShape,
    warningY: y(warningPercent),
    warningPercent,
    yTicks,
    xTicks,
    todayX,
    domain,
    description,
  };
}

/** Index of the point closest to x (hover on the trend chart). */
export function nearestPoint(points: { x: number }[], x: number): number {
  let best = -1;
  let distance = Infinity;
  points.forEach((point, index) => {
    const current = Math.abs(point.x - x);
    if (current < distance) {
      distance = current;
      best = index;
    }
  });
  return best;
}

// ---------------------------------------------------------------------------
// Sparkline

/** Path of a small line (0..100 % scaled to the own min/max, padded). */
export function sparklinePath(
  values: number[],
  width = 96,
  height = 24,
): { line: string; area: string; last: { x: number; y: number } | null } {
  if (values.length < 2) return { line: "", area: "", last: null };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 4);
  const mid = (max + min) / 2;
  const low = mid - range / 2;
  const pad = 2;
  const step = (width - pad * 2) / (values.length - 1);
  const coords = values.map((value, index) => ({
    x: round(pad + index * step),
    y: round(height - pad - ((value - low) / range) * (height - pad * 2)),
  }));
  const line = coords
    .map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`)
    .join(" ");
  const last = coords[coords.length - 1]!;
  return {
    line,
    area: `${line} L${last.x} ${height} L${coords[0]!.x} ${height} Z`,
    last,
  };
}

// ---------------------------------------------------------------------------
// Ring gauge

/** stroke-dasharray for a ring of radius r showing `percent`. */
export function ringDash(percent: number | null | undefined, radius: number) {
  const circumference = 2 * Math.PI * radius;
  const value = Math.min(100, Math.max(0, percent ?? 0));
  const filled = value > 0 ? Math.max((value / 100) * circumference, 2) : 0;
  return {
    circumference: round(circumference),
    dash: `${round(filled)} ${round(circumference)}`,
  };
}

// ---------------------------------------------------------------------------
// Address space grid

export type SpaceCell = {
  index: number;
  /** CIDR of the cell (unit block). */
  cidr: string;
  kind: "free" | "child" | "partial";
  /** Index into `children` of the dominant child (child/partial). */
  child: number | null;
  /** Allocated share of the cell, 0..1. */
  fill: number;
};

export type SpaceChild = {
  segment: AddressSegment;
  /** Colour slot 0..7 (CSS --chart-1..8). */
  color: number;
  /** First cell index (label position). */
  firstCell: number;
  cells: number;
};

export type SpaceGrid = {
  /** Prefix length of one cell, e.g. 24 for a /16 parent. */
  unitLength: number;
  columns: number;
  cells: SpaceCell[];
  children: SpaceChild[];
};

/**
 * Raster of up to 256 equal blocks of the parent (a /16 shows one cell per
 * /24). Each cell is free, fully used by one child, or partially used by
 * smaller children. Works for IPv4 and IPv6 (bigint arithmetic).
 */
export function spaceGrid(
  parent: string,
  segments: AddressSegment[],
  maxCells = 256,
): SpaceGrid | null {
  const outer = parseCidrInput(parent)?.cidr;
  if (!outer) return null;
  const bits = addressBits(outer.version);
  const extra = Math.min(Math.floor(Math.log2(maxCells)), bits - outer.length);
  const unitLength = outer.length + extra;
  const count = 1 << extra;
  const unit = 1n << BigInt(bits - unitLength);
  const children: SpaceChild[] = [];
  const spans: { start: bigint; end: bigint; child: number }[] = [];
  for (const segment of segments) {
    if (segment.kind !== "child") continue;
    const cidr = parseCidrInput(segment.cidr)?.cidr;
    if (!cidr || cidr.version !== outer.version) continue;
    const start = cidr.network;
    const end = start + cidrSize(cidr) - 1n;
    const firstCell = Number((start - outer.network) / unit);
    children.push({
      segment,
      color: children.length % 8,
      firstCell,
      cells: 0,
    });
    spans.push({ start, end, child: children.length - 1 });
  }
  const cells: SpaceCell[] = [];
  let pointer = 0;
  for (let index = 0; index < count; index++) {
    const start = outer.network + BigInt(index) * unit;
    const end = start + unit - 1n;
    while (pointer < spans.length && spans[pointer]!.end < start) pointer++;
    let covered = 0n;
    let dominant: { child: number; size: bigint } | null = null;
    for (let scan = pointer; scan < spans.length; scan++) {
      const span = spans[scan]!;
      if (span.start > end) break;
      const from = span.start > start ? span.start : start;
      const to = span.end < end ? span.end : end;
      const size = to - from + 1n;
      covered += size;
      if (!dominant || size > dominant.size)
        dominant = { child: span.child, size };
    }
    const fill = Number((covered * 1000n) / unit) / 1000;
    const kind =
      covered === 0n ? "free" : covered === unit ? "child" : "partial";
    if (dominant) children[dominant.child]!.cells += 1;
    cells.push({
      index,
      cidr: formatCidr({
        version: outer.version,
        network: start,
        length: unitLength,
      }),
      kind,
      child: dominant?.child ?? null,
      fill,
    });
  }
  return {
    unitLength,
    columns: Math.min(16, 2 ** Math.ceil(extra / 2)),
    cells,
    children,
  };
}
