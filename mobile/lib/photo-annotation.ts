/**
 * Photo markup («Markieren»): shapes, geometry and undo history. All
 * coordinates are in image pixels, so the same shapes render on screen and
 * into the exported image.
 */

export type Point = { x: number; y: number };

export type MarkupTool =
  | "arrow"
  | "ellipse"
  | "rect"
  | "pen"
  | "text"
  | "redact";

export type MarkupShape =
  | {
      id: string;
      kind: "arrow";
      from: Point;
      to: Point;
      color: string;
      width: number;
    }
  | {
      id: string;
      kind: "ellipse";
      from: Point;
      to: Point;
      color: string;
      width: number;
    }
  | {
      id: string;
      kind: "rect";
      from: Point;
      to: Point;
      color: string;
      width: number;
    }
  | { id: string; kind: "pen"; points: Point[]; color: string; width: number }
  | {
      id: string;
      kind: "text";
      at: Point;
      text: string;
      color: string;
      size: number;
    }
  | { id: string; kind: "redact"; from: Point; to: Point };

/** Burned-in drawing colours (part of the image, independent of the theme). */
export const MARKUP_COLORS = [
  { key: "red", label: "Rot", value: "#E5262A" },
  { key: "yellow", label: "Gelb", value: "#FACC15" },
  { key: "blue", label: "Blau", value: "#2563EB" },
  { key: "white", label: "Weiss", value: "#FFFFFF" },
  { key: "black", label: "Schwarz", value: "#000000" },
] as const;

/** Redactions are always fully opaque black. */
export const REDACTION_FILL = "#000000";

export const MAX_MARKUP_EDGE = 2048;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function clampPoint(point: Point, width: number, height: number): Point {
  return {
    x: Math.min(Math.max(point.x, 0), width),
    y: Math.min(Math.max(point.y, 0), height),
  };
}

/** Stroke width relative to the image, so markings look the same on any photo. */
export function strokeWidthFor(width: number, height: number): number {
  return Math.max(3, round(Math.max(width, height) * 0.006));
}

export function textSizeFor(width: number, height: number): number {
  return Math.max(16, Math.round(Math.max(width, height) * 0.035));
}

// ---------------------------------------------------------------------------
// Layout: image shown with «contain» inside a box.

export type FitLayout = {
  scale: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

export function fitContain(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
): FitLayout {
  if (imageWidth <= 0 || imageHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { scale: 0, width: 0, height: 0, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    scale,
    width,
    height,
    offsetX: (boxWidth - width) / 2,
    offsetY: (boxHeight - height) / 2,
  };
}

/** Touch point inside the displayed image → image pixels. */
export function viewToImage(point: Point, layout: FitLayout): Point {
  if (layout.scale <= 0) return { x: 0, y: 0 };
  return {
    x: (point.x - layout.offsetX) / layout.scale,
    y: (point.y - layout.offsetY) / layout.scale,
  };
}

/** Output size: original size, longest edge at most `maxEdge`. */
export function exportSize(
  width: number,
  height: number,
  maxEdge = MAX_MARKUP_EDGE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const factor = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

// ---------------------------------------------------------------------------
// Geometry

export function normalizedRect(
  from: Point,
  to: Point,
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

export function ellipseFromDrag(
  from: Point,
  to: Point,
): { cx: number; cy: number; rx: number; ry: number } {
  const rect = normalizedRect(from, to);
  return {
    cx: rect.x + rect.width / 2,
    cy: rect.y + rect.height / 2,
    rx: rect.width / 2,
    ry: rect.height / 2,
  };
}

export type ArrowGeometry = {
  /** End of the shaft (base of the head), so the line does not poke through. */
  shaftEnd: Point;
  tip: Point;
  left: Point;
  right: Point;
};

/**
 * Arrow from `from` to `to`: a filled head of length ~4.5× the stroke width
 * (at most 45 % of the arrow), opening angle ±28°.
 */
export function arrowGeometry(
  from: Point,
  to: Point,
  strokeWidth: number,
): ArrowGeometry {
  const length = distance(from, to);
  if (length === 0) {
    return { shaftEnd: to, tip: to, left: to, right: to };
  }
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const headLength = Math.min(Math.max(strokeWidth * 4.5, 10), length * 0.45);
  const halfAngle = (28 * Math.PI) / 180;
  const headHalfWidth = Math.tan(halfAngle) * headLength;
  const base = { x: to.x - ux * headLength, y: to.y - uy * headLength };
  // Perpendicular to the arrow direction.
  const px = -uy;
  const py = ux;
  return {
    shaftEnd: {
      x: round(to.x - ux * headLength * 0.8),
      y: round(to.y - uy * headLength * 0.8),
    },
    tip: { x: round(to.x), y: round(to.y) },
    left: {
      x: round(base.x + px * headHalfWidth),
      y: round(base.y + py * headHalfWidth),
    },
    right: {
      x: round(base.x - px * headHalfWidth),
      y: round(base.y - py * headHalfWidth),
    },
  };
}

export function arrowHeadPath(geometry: ArrowGeometry): string {
  const { tip, left, right } = geometry;
  return `M${tip.x} ${tip.y}L${left.x} ${left.y}L${right.x} ${right.y}Z`;
}

/** Adds a freehand point unless it is closer than `minDistance` to the last. */
export function appendPoint(
  points: Point[],
  point: Point,
  minDistance: number,
): Point[] {
  const last = points[points.length - 1];
  if (last && distance(last, point) < minDistance) return points;
  return [...points, point];
}

/** Smooth freehand path through the midpoints (quadratic curves). */
export function freehandPath(points: Point[]): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  if (points.length === 1) {
    return `M${round(first.x)} ${round(first.y)}L${round(first.x + 0.01)} ${round(first.y)}`;
  }
  let path = `M${round(first.x)} ${round(first.y)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index]!;
    const next = points[index + 1]!;
    const mid = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
    path += `Q${round(current.x)} ${round(current.y)} ${round(mid.x)} ${round(mid.y)}`;
  }
  const last = points[points.length - 1]!;
  return `${path}L${round(last.x)} ${round(last.y)}`;
}

/** Drags shorter than this (image pixels) are treated as accidental taps. */
export function minimumDragFor(width: number, height: number): number {
  return Math.max(6, Math.max(width, height) * 0.01);
}

/** Whether a finished shape is big enough to keep. */
export function isMeaningfulShape(
  shape: MarkupShape,
  minimum: number,
): boolean {
  switch (shape.kind) {
    case "arrow":
      return distance(shape.from, shape.to) >= minimum;
    case "ellipse":
    case "rect":
    case "redact": {
      const rect = normalizedRect(shape.from, shape.to);
      return rect.width >= minimum && rect.height >= minimum;
    }
    case "pen":
      return shape.points.length >= 2;
    case "text":
      return shape.text.trim().length > 0;
  }
}

/**
 * Shapes in draw order. Redactions are drawn last so nothing drawn later
 * can sit on top of (and reveal edges around) a blacked-out area.
 */
export function renderOrder(shapes: readonly MarkupShape[]): MarkupShape[] {
  return [
    ...shapes.filter((shape) => shape.kind !== "redact"),
    ...shapes.filter((shape) => shape.kind === "redact"),
  ];
}

// ---------------------------------------------------------------------------
// History (undo / redo)

export type MarkupHistory = {
  shapes: MarkupShape[];
  undone: MarkupShape[][];
  past: MarkupShape[][];
};

export const EMPTY_HISTORY: MarkupHistory = {
  shapes: [],
  undone: [],
  past: [],
};

export type MarkupAction =
  | { type: "add"; shape: MarkupShape }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clear" }
  /** New photo: forget everything, including undo steps. */
  | { type: "reset" };

export function markupReducer(
  state: MarkupHistory,
  action: MarkupAction,
): MarkupHistory {
  switch (action.type) {
    case "reset":
      return EMPTY_HISTORY;
    case "add":
      return {
        shapes: [...state.shapes, action.shape],
        past: [...state.past, state.shapes],
        undone: [],
      };
    case "clear":
      return state.shapes.length === 0
        ? state
        : { shapes: [], past: [...state.past, state.shapes], undone: [] };
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        shapes: previous,
        past: state.past.slice(0, -1),
        undone: [...state.undone, state.shapes],
      };
    }
    case "redo": {
      const next = state.undone[state.undone.length - 1];
      if (!next) return state;
      return {
        shapes: next,
        past: [...state.past, state.shapes],
        undone: state.undone.slice(0, -1),
      };
    }
  }
}
