import { describe, expect, it } from "vitest";

import {
  EMPTY_HISTORY,
  appendPoint,
  arrowGeometry,
  arrowHeadPath,
  ellipseFromDrag,
  exportSize,
  fitContain,
  freehandPath,
  isMeaningfulShape,
  markupReducer,
  normalizedRect,
  renderOrder,
  strokeWidthFor,
  viewToImage,
  type MarkupShape,
} from "../lib/photo-annotation";

const rect = (id: string): MarkupShape => ({
  id,
  kind: "rect",
  from: { x: 0, y: 0 },
  to: { x: 10, y: 10 },
  color: "#E5262A",
  width: 4,
});

describe("arrow geometry", () => {
  it("places the head at the tip, symmetric to the direction", () => {
    const geometry = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(geometry.tip).toEqual({ x: 100, y: 0 });
    // head length 18 (4.5 × 4), shaft ends inside the head
    expect(geometry.shaftEnd.x).toBeCloseTo(85.6, 1);
    expect(geometry.left.x).toBeCloseTo(82, 1);
    expect(geometry.right.x).toBeCloseTo(82, 1);
    expect(geometry.left.y).toBeCloseTo(-geometry.right.y, 5);
    expect(Math.abs(geometry.left.y)).toBeCloseTo(9.57, 1);
  });

  it("limits the head on short arrows and handles zero length", () => {
    const short = arrowGeometry({ x: 0, y: 0 }, { x: 0, y: 20 }, 10);
    expect(short.left.y).toBeCloseTo(11, 1);
    const none = arrowGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }, 4);
    expect(none.left).toEqual({ x: 5, y: 5 });
    expect(arrowHeadPath(none)).toBe("M5 5L5 5L5 5Z");
  });
});

describe("shapes", () => {
  it("normalises drag rectangles and ellipses", () => {
    expect(normalizedRect({ x: 10, y: 20 }, { x: 2, y: 4 })).toEqual({
      x: 2,
      y: 4,
      width: 8,
      height: 16,
    });
    expect(ellipseFromDrag({ x: 10, y: 0 }, { x: 0, y: 6 })).toEqual({
      cx: 5,
      cy: 3,
      rx: 5,
      ry: 3,
    });
  });

  it("throttles and smooths freehand strokes", () => {
    let points = appendPoint([], { x: 0, y: 0 }, 3);
    points = appendPoint(points, { x: 1, y: 1 }, 3);
    points = appendPoint(points, { x: 4, y: 0 }, 3);
    points = appendPoint(points, { x: 8, y: 0 }, 3);
    expect(points).toHaveLength(3);
    expect(freehandPath(points)).toBe("M0 0Q4 0 6 0L8 0");
    expect(freehandPath([])).toBe("");
  });

  it("drops accidental taps", () => {
    expect(isMeaningfulShape(rect("a"), 6)).toBe(true);
    expect(isMeaningfulShape(rect("a"), 12)).toBe(false);
    expect(
      isMeaningfulShape(
        {
          id: "t",
          kind: "text",
          at: { x: 0, y: 0 },
          text: " ",
          color: "",
          size: 1,
        },
        6,
      ),
    ).toBe(false);
  });

  it("draws redactions last", () => {
    const redact: MarkupShape = {
      id: "r",
      kind: "redact",
      from: { x: 0, y: 0 },
      to: { x: 5, y: 5 },
    };
    expect(renderOrder([redact, rect("a")]).map((s) => s.id)).toEqual([
      "a",
      "r",
    ]);
  });
});

describe("layout", () => {
  it("fits the image and maps touches to image pixels", () => {
    const layout = fitContain(4000, 3000, 400, 600);
    expect(layout.scale).toBe(0.1);
    expect(layout.offsetY).toBe(150);
    expect(viewToImage({ x: 200, y: 300 }, layout)).toEqual({
      x: 2000,
      y: 1500,
    });
    expect(fitContain(0, 10, 10, 10).scale).toBe(0);
  });

  it("caps the export size and scales strokes", () => {
    expect(exportSize(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(exportSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(strokeWidthFor(4000, 3000)).toBe(24);
    expect(strokeWidthFor(200, 100)).toBe(3);
  });
});

describe("history", () => {
  it("undoes, redoes and clears", () => {
    let state = markupReducer(EMPTY_HISTORY, { type: "add", shape: rect("a") });
    state = markupReducer(state, { type: "add", shape: rect("b") });
    state = markupReducer(state, { type: "undo" });
    expect(state.shapes.map((s) => s.id)).toEqual(["a"]);
    state = markupReducer(state, { type: "redo" });
    expect(state.shapes.map((s) => s.id)).toEqual(["a", "b"]);
    state = markupReducer(state, { type: "clear" });
    expect(state.shapes).toEqual([]);
    state = markupReducer(state, { type: "undo" });
    expect(state.shapes).toHaveLength(2);
    state = markupReducer(state, { type: "add", shape: rect("c") });
    expect(state.undone).toEqual([]);
    expect(markupReducer(EMPTY_HISTORY, { type: "undo" })).toBe(EMPTY_HISTORY);
    expect(markupReducer(state, { type: "reset" })).toBe(EMPTY_HISTORY);
  });
});
