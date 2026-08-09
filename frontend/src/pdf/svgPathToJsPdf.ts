/**
 * Converts an SVG path's `d` attribute into the low-level path operations
 * jsPDF's `doc.path()` understands (`m`/`l`/`c`/`h` — moveto, lineto, cubic
 * curveto, closepath), so a real vector icon (e.g. the GitHub mark) can be
 * drawn crisply at any size instead of approximated with jsPDF's own
 * primitive shapes (circles/rects) or, worse, embedded as a bitmap.
 *
 * Supports the commands actually needed for icon-style paths — M/L/H/V/C/S/
 * Q/T/A/Z, both absolute and relative, including the SVG shorthand where a
 * repeated coordinate group after a command reuses that same command (very
 * common in hand-optimized icon paths). Arcs (`A`/`a`) are converted to one
 * or more cubic Béziers using the standard endpoint-to-center
 * parameterization, since jsPDF's path op set has no arc primitive.
 *
 * This is a small, purpose-built parser — not a full SVG path spec
 * implementation (no error recovery for malformed paths) — but every corner
 * of the grammar it does support (including the easy-to-get-wrong part:
 * elliptical-arc flags are single 0/1 characters that can be jammed against
 * the following coordinate with no separator, e.g. `A12.02 12.02 0 0024 12`
 * — a naive "split on whitespace/commas" tokenizer misreads that as one
 * number) is handled correctly.
 */

export interface JsPdfPathOp {
  op: "m" | "l" | "c" | "h";
  c: number[];
}

interface PathSegment {
  cmd: string;
  args: number[];
}

const ARG_COUNTS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 };

function parseSvgPath(d: string): PathSegment[] {
  const NUM = /-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/y;
  const FLAG = /[01]/y;
  const s = d.trim();
  let i = 0;

  function skipSep(): void {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
  }
  function readNumber(): number {
    skipSep();
    NUM.lastIndex = i;
    const m = NUM.exec(s);
    if (!m) throw new Error(`Invalid SVG path: expected number at index ${i} ("${s.slice(i, i + 12)}")`);
    i = NUM.lastIndex;
    return parseFloat(m[0]);
  }
  // Arc flags are always exactly one character (0 or 1) and may be written
  // with no separator at all before the next value — they can't be read
  // with the general number tokenizer above without risking swallowing part
  // of whatever number follows.
  function readFlag(): number {
    skipSep();
    FLAG.lastIndex = i;
    const m = FLAG.exec(s);
    if (!m) throw new Error(`Invalid SVG path: expected arc flag (0/1) at index ${i} ("${s.slice(i, i + 12)}")`);
    i = FLAG.lastIndex;
    return parseInt(m[0], 10);
  }

  const segs: PathSegment[] = [];
  let lastCmd = "";
  while (i < s.length) {
    skipSep();
    if (i >= s.length) break;
    const ch = s[i];
    let cmd: string;
    if (/[a-zA-Z]/.test(ch)) {
      cmd = ch;
      i++;
    } else {
      // Bare coordinates after a command implicitly repeat it — except a
      // repeated M/m, which the spec says becomes an L/l instead.
      if (!lastCmd) throw new Error(`Invalid SVG path: no command to repeat at index ${i}`);
      cmd = lastCmd;
    }
    const upper = cmd.toUpperCase();
    if (upper === "Z") {
      segs.push({ cmd, args: [] });
      lastCmd = cmd;
      continue;
    }
    const args: number[] = [];
    if (upper === "A") {
      args.push(readNumber(), readNumber(), readNumber(), readFlag(), readFlag(), readNumber(), readNumber());
    } else {
      const n = ARG_COUNTS[upper];
      if (n === undefined) throw new Error(`Unsupported SVG path command "${cmd}"`);
      for (let k = 0; k < n; k++) args.push(readNumber());
    }
    segs.push({ cmd, args });
    lastCmd = upper === "M" ? (cmd === "M" ? "L" : "l") : cmd;
  }
  return segs;
}

/** One cubic Bézier segment as absolute [x1,y1,x2,y2,x,y]. */
type CubicSeg = [number, number, number, number, number, number];

/** Standard SVG elliptical-arc-to-cubic-Bézier conversion (endpoint-to-center
 * parameterization per the SVG spec, then split into <= 90° cubic pieces). */
function arcToBeziers(
  x0: number,
  y0: number,
  rxIn: number,
  ryIn: number,
  xRotDeg: number,
  largeArc: number,
  sweep: number,
  x: number,
  y: number
): CubicSeg[] {
  if (rxIn === 0 || ryIn === 0 || (x0 === x && y0 === y)) return [[x0, y0, x, y, x, y]];
  const phi = (xRotDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x0 - x) / 2;
  const dy2 = (y0 - y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  let rxSq = rx * rx;
  let rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  const lambda = x1pSq / rxSq + y1pSq / rySq;
  let radicant: number;
  if (lambda > 1) {
    const scaleUp = Math.sqrt(lambda);
    rx *= scaleUp;
    ry *= scaleUp;
    rxSq = rx * rx;
    rySq = ry * ry;
    radicant = 0;
  } else {
    radicant = Math.max(0, (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq));
  }
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(radicant);
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (-coef * (ry * x1p)) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y) / 2;

  function vecAngle(ux: number, uy: number, vx: number, vy: number): number {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let ang = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) ang = -ang;
    return ang;
  }

  const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vecAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segments;
  const t = (8 / 3) * Math.sin(delta / 4) * Math.sin(delta / 4) * (1 / Math.sin(delta / 2));

  function pointAt(theta: number): [number, number] {
    const ex = rx * Math.cos(theta);
    const ey = ry * Math.sin(theta);
    return [cx + ex * cosPhi - ey * sinPhi, cy + ex * sinPhi + ey * cosPhi];
  }
  function derivAt(theta: number): [number, number] {
    const ex = -rx * Math.sin(theta);
    const ey = ry * Math.cos(theta);
    return [ex * cosPhi - ey * sinPhi, ex * sinPhi + ey * cosPhi];
  }

  const curves: CubicSeg[] = [];
  let theta = theta1;
  for (let i = 0; i < segments; i++) {
    const theta2 = theta + delta;
    const [p0x, p0y] = pointAt(theta);
    const [p3x, p3y] = pointAt(theta2);
    const [d0x, d0y] = derivAt(theta);
    const [d3x, d3y] = derivAt(theta2);
    curves.push([p0x + t * d0x, p0y + t * d0y, p3x - t * d3x, p3y - t * d3y, p3x, p3y]);
    theta = theta2;
  }
  return curves;
}

/**
 * Converts `d` into absolute jsPDF path ops, scaled by `scale` and offset by
 * (`offsetX`, `offsetY`) — e.g. for a 24x24-viewBox icon rendered `h` mm
 * tall at position (x, y): `svgPathToJsPdfOps(d, h / 24, x, y)`.
 */
export function svgPathToJsPdfOps(d: string, scale: number, offsetX: number, offsetY: number): JsPdfPathOp[] {
  const segs = parseSvgPath(d);
  const ops: JsPdfPathOp[] = [];
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let prevCubicCtrl: [number, number] | null = null;
  let prevQuadCtrl: [number, number] | null = null;

  const tx = (v: number) => offsetX + v * scale;
  const ty = (v: number) => offsetY + v * scale;

  for (const seg of segs) {
    const rel = seg.cmd === seg.cmd.toLowerCase();
    const upper = seg.cmd.toUpperCase();
    const a = seg.args;

    if (upper === "M") {
      let [x, y] = a;
      if (rel) {
        x += cx;
        y += cy;
      }
      ops.push({ op: "m", c: [tx(x), ty(y)] });
      cx = x;
      cy = y;
      startX = x;
      startY = y;
      prevCubicCtrl = null;
      prevQuadCtrl = null;
    } else if (upper === "L") {
      let [x, y] = a;
      if (rel) {
        x += cx;
        y += cy;
      }
      ops.push({ op: "l", c: [tx(x), ty(y)] });
      cx = x;
      cy = y;
      prevCubicCtrl = null;
      prevQuadCtrl = null;
    } else if (upper === "H") {
      let x = a[0];
      if (rel) x += cx;
      ops.push({ op: "l", c: [tx(x), ty(cy)] });
      cx = x;
      prevCubicCtrl = null;
      prevQuadCtrl = null;
    } else if (upper === "V") {
      let y = a[0];
      if (rel) y += cy;
      ops.push({ op: "l", c: [tx(cx), ty(y)] });
      cy = y;
      prevCubicCtrl = null;
      prevQuadCtrl = null;
    } else if (upper === "C") {
      let [x1, y1, x2, y2, x, y] = a;
      if (rel) {
        x1 += cx;
        y1 += cy;
        x2 += cx;
        y2 += cy;
        x += cx;
        y += cy;
      }
      ops.push({ op: "c", c: [tx(x1), ty(y1), tx(x2), ty(y2), tx(x), ty(y)] });
      prevCubicCtrl = [x2, y2];
      prevQuadCtrl = null;
      cx = x;
      cy = y;
    } else if (upper === "S") {
      let [x2, y2, x, y] = a;
      if (rel) {
        x2 += cx;
        y2 += cy;
        x += cx;
        y += cy;
      }
      const x1 = prevCubicCtrl ? 2 * cx - prevCubicCtrl[0] : cx;
      const y1 = prevCubicCtrl ? 2 * cy - prevCubicCtrl[1] : cy;
      ops.push({ op: "c", c: [tx(x1), ty(y1), tx(x2), ty(y2), tx(x), ty(y)] });
      prevCubicCtrl = [x2, y2];
      prevQuadCtrl = null;
      cx = x;
      cy = y;
    } else if (upper === "Q") {
      let [qx, qy, x, y] = a;
      if (rel) {
        qx += cx;
        qy += cy;
        x += cx;
        y += cy;
      }
      const x1 = cx + (2 / 3) * (qx - cx);
      const y1 = cy + (2 / 3) * (qy - cy);
      const x2 = x + (2 / 3) * (qx - x);
      const y2 = y + (2 / 3) * (qy - y);
      ops.push({ op: "c", c: [tx(x1), ty(y1), tx(x2), ty(y2), tx(x), ty(y)] });
      prevQuadCtrl = [qx, qy];
      prevCubicCtrl = null;
      cx = x;
      cy = y;
    } else if (upper === "T") {
      let [x, y] = a;
      if (rel) {
        x += cx;
        y += cy;
      }
      const reflectedQx: number = prevQuadCtrl ? 2 * cx - prevQuadCtrl[0] : cx;
      const reflectedQy: number = prevQuadCtrl ? 2 * cy - prevQuadCtrl[1] : cy;
      const x1 = cx + (2 / 3) * (reflectedQx - cx);
      const y1 = cy + (2 / 3) * (reflectedQy - cy);
      const x2 = x + (2 / 3) * (reflectedQx - x);
      const y2 = y + (2 / 3) * (reflectedQy - y);
      ops.push({ op: "c", c: [tx(x1), ty(y1), tx(x2), ty(y2), tx(x), ty(y)] });
      prevQuadCtrl = [reflectedQx, reflectedQy];
      prevCubicCtrl = null;
      cx = x;
      cy = y;
    } else if (upper === "A") {
      let [rx, ry, rot, largeArc, sweep, x, y] = a;
      if (rel) {
        x += cx;
        y += cy;
      }
      const curves = arcToBeziers(cx, cy, rx, ry, rot, largeArc, sweep, x, y);
      for (const [x1, y1, x2, y2, ex, ey] of curves) {
        ops.push({ op: "c", c: [tx(x1), ty(y1), tx(x2), ty(y2), tx(ex), ty(ey)] });
      }
      cx = x;
      cy = y;
      prevCubicCtrl = null;
      prevQuadCtrl = null;
    } else if (upper === "Z") {
      ops.push({ op: "h", c: [] });
      cx = startX;
      cy = startY;
    }
  }
  return ops;
}
