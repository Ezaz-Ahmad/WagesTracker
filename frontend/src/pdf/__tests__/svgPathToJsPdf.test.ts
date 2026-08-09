import { describe, expect, it } from "vitest";
import { svgPathToJsPdfOps } from "../svgPathToJsPdf";

describe("svgPathToJsPdfOps", () => {
  it("converts a simple M/L/Z triangle into scaled, offset m/l/h ops", () => {
    const ops = svgPathToJsPdfOps("M0 0L10 0L10 10Z", 2, 5, 5);
    expect(ops).toEqual([
      { op: "m", c: [5, 5] },
      { op: "l", c: [25, 5] },
      { op: "l", c: [25, 25] },
      { op: "h", c: [] },
    ]);
  });

  it("treats a bare coordinate pair after L as an implicit repeated L", () => {
    // "L10 0 20 0" is one L command followed by an implicit second L.
    const ops = svgPathToJsPdfOps("M0 0L10 0 20 0", 1, 0, 0);
    expect(ops).toEqual([
      { op: "m", c: [0, 0] },
      { op: "l", c: [10, 0] },
      { op: "l", c: [20, 0] },
    ]);
  });

  it("treats a bare coordinate pair after M as an implicit L (per the SVG spec)", () => {
    const ops = svgPathToJsPdfOps("M0 0 10 0", 1, 0, 0);
    expect(ops[0]).toEqual({ op: "m", c: [0, 0] });
    expect(ops[1]).toEqual({ op: "l", c: [10, 0] });
  });

  it("accumulates relative (lowercase) commands from the current point", () => {
    const ops = svgPathToJsPdfOps("M5 5l10 0l0 10", 1, 0, 0);
    expect(ops).toEqual([
      { op: "m", c: [5, 5] },
      { op: "l", c: [15, 5] },
      { op: "l", c: [15, 15] },
    ]);
  });

  it("converts H and V shorthand into lineto ops using the current point", () => {
    const ops = svgPathToJsPdfOps("M0 0H10V10h5v5", 1, 0, 0);
    expect(ops).toEqual([
      { op: "m", c: [0, 0] },
      { op: "l", c: [10, 0] }, // H10
      { op: "l", c: [10, 10] }, // V10
      { op: "l", c: [15, 10] }, // h5 (relative)
      { op: "l", c: [15, 15] }, // v5 (relative)
    ]);
  });

  it("passes absolute cubic curves straight through", () => {
    const ops = svgPathToJsPdfOps("M0 0C1 2 3 4 5 6", 1, 0, 0);
    expect(ops).toEqual([
      { op: "m", c: [0, 0] },
      { op: "c", c: [1, 2, 3, 4, 5, 6] },
    ]);
  });

  it("converts a quadratic Q curve to the equivalent cubic", () => {
    // Q from (0,0) via control (6,0) to (6,6): the standard Q->C conversion
    // gives control points at 2/3 of the way from each endpoint to Q's
    // control point.
    const ops = svgPathToJsPdfOps("M0 0Q6 0 6 6", 1, 0, 0);
    expect(ops[0]).toEqual({ op: "m", c: [0, 0] });
    expect(ops[1].op).toBe("c");
    const [x1, y1, x2, y2, x, y] = ops[1].c;
    expect(x1).toBeCloseTo(4);
    expect(y1).toBeCloseTo(0);
    expect(x2).toBeCloseTo(6);
    expect(y2).toBeCloseTo(2);
    expect(x).toBeCloseTo(6);
    expect(y).toBeCloseTo(6);
  });

  it("scales and offsets every coordinate consistently", () => {
    const ops = svgPathToJsPdfOps("M2 2L4 4", 3, 100, 200);
    expect(ops).toEqual([
      { op: "m", c: [106, 206] }, // 100 + 2*3, 200 + 2*3
      { op: "l", c: [112, 212] }, // 100 + 4*3, 200 + 4*3
    ]);
  });

  it("parses elliptical-arc flags correctly even when jammed against the next coordinate with no separator", () => {
    // This is the exact shape that breaks a naive whitespace/comma
    // tokenizer: rx ry rot are ordinary numbers, but the two flags right
    // after them are always exactly one character (0 or 1) and here run
    // straight into "24 12" with no space — a generic number regex would
    // misread "0024" as a single number instead of two flags (0, 0) plus
    // the start of "24".
    expect(() => svgPathToJsPdfOps("M0 12A12 12 0 0024 12", 1, 0, 0)).not.toThrow();
    const ops = svgPathToJsPdfOps("M0 12A12 12 0 0024 12", 1, 0, 0);
    // The arc must end exactly at (24, 12) — if the flags had swallowed part
    // of the endpoint, this would land somewhere else entirely.
    const last = ops[ops.length - 1];
    expect(last.c[4]).toBeCloseTo(24);
    expect(last.c[5]).toBeCloseTo(12);
  });

  it("never emits an arc op — every arc is converted to one or more cubic curves", () => {
    const ops = svgPathToJsPdfOps("M0 12A12 12 0 0024 12", 1, 0, 0);
    for (const op of ops) {
      expect(["m", "l", "c", "h"]).toContain(op.op);
    }
  });

  it("round-trips the real 24x24 GitHub mark path used in the PDF footer without throwing, closes the path, and only emits ops jsPDF's path() understands", () => {
    const GITHUB_MARK_PATH_24 =
      "M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405 1.02 0 2.04.135 3 .405 2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z";
    const ops = svgPathToJsPdfOps(GITHUB_MARK_PATH_24, 3.6 / 24, 10, 20);
    expect(ops[0].op).toBe("m");
    expect(ops[ops.length - 1]).toEqual({ op: "h", c: [] });
    for (const op of ops) {
      expect(["m", "l", "c", "h"]).toContain(op.op);
      for (const n of op.c) expect(Number.isFinite(n)).toBe(true);
    }
    // Scaled to a 3.6mm-tall icon at (10, 20): the starting point (12, 0 in
    // the 24x24 viewBox) should land at (10 + 12*scale, 20).
    const scale = 3.6 / 24;
    expect(ops[0].c[0]).toBeCloseTo(10 + 12 * scale);
    expect(ops[0].c[1]).toBeCloseTo(20);
  });

  it("throws a descriptive error on a malformed path rather than silently producing garbage", () => {
    expect(() => svgPathToJsPdfOps("M0 0 Xnonsense", 1, 0, 0)).toThrow();
  });
});
