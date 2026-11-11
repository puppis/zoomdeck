/**
 * Vector mobjects from path data and point loops.
 *
 * The engine stores a vector shape as cubic Bézier subpaths in a shared-anchor
 * layout (an anchor, then two handles and the next anchor per curve). These
 * helpers build such shapes from SVG path data in logical units (y up) and
 * from closed polygons, which icons and blobs need.
 */
import { VMobject, parseSVGPathData } from 'manim-web';

export type Point2 = readonly [number, number];
export type Point3 = [number, number, number];

/** Twice the signed area of a polygon given by anchors; positive when counterclockwise. */
export function signedArea(points: readonly (readonly number[])[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return area / 2;
}

/** Close a Bézier subpath with a straight curve back to its first anchor when it does not end there. */
function closeSubpath(points: Point3[]): void {
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.hypot(last[0] - first[0], last[1] - first[1]) <= 1e-9) return;
  for (const t of [1 / 3, 2 / 3]) points.push([last[0] + (first[0] - last[0]) * t, last[1] + (first[1] - last[1]) * t, 0]);
  points.push([first[0], first[1], 0]);
}

/** Assign Bézier subpaths to a vector mobject, recording their lengths when there are several. */
export function setSubpaths(vmob: VMobject, subpaths: Point3[][]): VMobject {
  const points: number[][] = [];
  const lengths: number[] = [];
  for (const subpath of subpaths) {
    if (subpath.length < 2) continue;
    points.push(...subpath);
    lengths.push(subpath.length);
  }
  vmob.setPoints(points);
  vmob.setBaseSubpathLengths(lengths.length > 1 ? lengths : undefined);
  return vmob;
}

/**
 * A vector mobject tracing SVG path data whose coordinates are logical units
 * with y pointing up, scaled by `scale`. Closed subpaths run counterclockwise
 * so that their fills render.
 */
export function pathMobject(d: string, scale = 1, close = false): VMobject {
  const subpaths: Point3[][] = [];
  for (const subpath of parseSVGPathData(d)) {
    if (subpath.length < 2) continue;
    const converted: Point3[] = subpath.map(([x, y]) => [x * scale, y * scale, 0]);
    if (close) {
      closeSubpath(converted);
      if (signedArea(converted) < 0) converted.reverse();
    }
    subpaths.push(converted);
  }
  return setSubpaths(new VMobject(), subpaths);
}

/**
 * A closed, smooth cubic Bézier loop through `anchors` (Catmull-Rom handles),
 * in the engine's shared-anchor layout and running counterclockwise.
 */
export function smoothLoop(anchors: readonly (readonly number[])[], tension = 1): Point3[] {
  const n = anchors.length;
  if (n < 3) throw new Error('A smooth loop needs at least three points');
  const loop = signedArea(anchors) < 0 ? [...anchors].reverse() : [...anchors];
  const points: Point3[] = [[loop[0][0], loop[0][1], 0]];
  for (let i = 0; i < n; i += 1) {
    const previous = loop[(i - 1 + n) % n];
    const current = loop[i];
    const next = loop[(i + 1) % n];
    const after = loop[(i + 2) % n];
    const k = tension / 6;
    points.push(
      [current[0] + (next[0] - previous[0]) * k, current[1] + (next[1] - previous[1]) * k, 0],
      [next[0] - (after[0] - current[0]) * k, next[1] - (after[1] - current[1]) * k, 0],
      [next[0], next[1], 0],
    );
  }
  return points;
}

/** A vector mobject made of smooth closed loops through the given anchor polygons. */
export function loopsMobject(loops: readonly (readonly (readonly number[])[])[], tension = 1): VMobject {
  return setSubpaths(new VMobject(), loops.map((loop) => smoothLoop(loop, tension)));
}

const KAPPA = 0.5522847498;

/** SVG path data of a circle made of four cubic curves. */
export function circlePath(cx: number, cy: number, r: number): string {
  return ellipsePath(cx, cy, r, r);
}

/** SVG path data of an axis-aligned ellipse with radii `rx`, `ry`. */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return `M${cx + rx},${cy} C${cx + rx},${cy + ky} ${cx + kx},${cy + ry} ${cx},${cy + ry} C${cx - kx},${cy + ry} ${cx - rx},${cy + ky} ${cx - rx},${cy} `
    + `C${cx - rx},${cy - ky} ${cx - kx},${cy - ry} ${cx},${cy - ry} C${cx + kx},${cy - ry} ${cx + rx},${cy - ky} ${cx + rx},${cy} Z`;
}

/** SVG path data of a rectangle with its lower-left corner at (x, y), optionally with rounded corners. */
export function rectPath(x: number, y: number, width: number, height: number, radius = 0): string {
  const r = Math.min(radius, width / 2, height / 2);
  if (r <= 0) return `M${x},${y} H${x + width} V${y + height} H${x} Z`;
  const k = r * KAPPA;
  const x1 = x + width;
  const y1 = y + height;
  return `M${x + r},${y} H${x1 - r} C${x1 - r + k},${y} ${x1},${y + r - k} ${x1},${y + r} V${y1 - r} C${x1},${y1 - r + k} ${x1 - r + k},${y1} ${x1 - r},${y1} `
    + `H${x + r} C${x + r - k},${y1} ${x},${y1 - r + k} ${x},${y1 - r} V${y + r} C${x},${y + r - k} ${x + r - k},${y} ${x + r},${y} Z`;
}

/** A circular arc from angle `a0` to `a1` (radians, counterclockwise) as cubic curves. */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const segments = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  const step = (a1 - a0) / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (a: number): [number, number] => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  const fmt = (v: number) => v.toFixed(4);
  let d = `M${fmt(point(a0)[0])},${fmt(point(a0)[1])}`;
  for (let i = 0; i < segments; i += 1) {
    const a = a0 + step * i;
    const b = a + step;
    const [x1, y1] = point(a);
    const [x2, y2] = point(b);
    d += ` C${fmt(x1 - Math.sin(a) * r * k)},${fmt(y1 + Math.cos(a) * r * k)} ${fmt(x2 + Math.sin(b) * r * k)},${fmt(y2 - Math.cos(b) * r * k)} ${fmt(x2)},${fmt(y2)}`;
  }
  return d;
}
