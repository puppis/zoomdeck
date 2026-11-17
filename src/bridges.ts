/**
 * Halo bridges: where a path drawn later crosses a path drawn before, a small patch in the
 * background color hides the earlier path on each side of the later one, which so passes over it.
 *
 * Only proper crossings get a bridge: two paths that leave or reach the same element, or whose
 * ends lie close together, never do; nor do paths that cross at a narrow angle, that merely touch,
 * that overlap along a stretch, or that cross so near an end of either that the gap would reach it.
 * The patch is the parallelogram where the halo around the upper path, a strip `halo_width` wide,
 * meets the stroke of the lower path, so that it hides that stroke and nothing else around it.
 *
 * Crossings are found once, when a slide is laid out: every stroke is cut into segments, and only
 * the segments that share a cell of a uniform grid are tested against each other.
 */
import { Group, Polygon, VMobject, type Mobject } from 'manim-web';
import { STROKE_UNITS } from './sketch';

/** A point of the plane. */
export type Point2 = readonly [number, number];

/** A path as bridges see it, in the coordinates of its slide or group. */
export interface BridgePath {
  /** The strokes it draws, each a polyline: one segment for a straight line, more for a curve or the two strokes of a hand-drawn line. */
  strokes: Point2[][];
  /** Its stroke width, in engine units. */
  width: number;
  /** Its ends, an arrow's at the point of its tip. */
  ends: [Point2, Point2];
  /** The ends of its stroke: an arrow's shaft ends where its tip begins. */
  shaftEnds: [Point2, Point2];
  /** The elements it leaves and reaches, by id; null for an end at a fixed point. */
  joins: [string | null, string | null];
  /** When it passes over the paths it crosses: the color of its bridges and the width of its halo, in engine units, its own width included. */
  bridge: { color: string; width: number } | null;
}

/** The narrowest crossing that gets a bridge, as the sine of its angle (about 12 degrees): any narrower would leave a long gap. */
export const MIN_CROSSING_SINE = Math.sin(Math.PI / 15);
/** How far a bridge reaches beyond the lower stroke and the halo, in logical units, so that no antialiased edge of the lower stroke shows. */
export const BRIDGE_MARGIN = 0.01;
/** Points of a cubic Bézier curve sampled per curve when a stroke is curved. */
const CURVE_SAMPLES = 8;

/** The paths of an arrow or line, by the mobject that draws it. */
export const BRIDGE_PATHS = new WeakMap<Mobject, BridgePath>();

const cross = (a: Point2, b: Point2) => a[0] * b[1] - a[1] * b[0];
const dot = (a: Point2, b: Point2) => a[0] * b[0] + a[1] * b[1];
const distance = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

interface Segment {
  path: number;
  start: Point2;
  end: Point2;
}

/**
 * Visit the cells of a grid of `size` that the segment from `a` to `b` passes through, in order
 * (a grid traversal after Amanatides and Woo). Where it passes through a corner, both cells beside
 * the corner are visited too, so that two segments that cross there always share a cell.
 */
export function gridCells(a: Point2, b: Point2, size: number, visit: (x: number, y: number) => void): void {
  let x = Math.floor(a[0] / size);
  let y = Math.floor(a[1] / size);
  const endX = Math.floor(b[0] / size);
  const endY = Math.floor(b[1] / size);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const deltaX = stepX ? size / Math.abs(dx) : Infinity;
  const deltaY = stepY ? size / Math.abs(dy) : Infinity;
  let maxX = stepX > 0 ? ((x + 1) * size - a[0]) / dx : stepX < 0 ? (x * size - a[0]) / dx : Infinity;
  let maxY = stepY > 0 ? ((y + 1) * size - a[1]) / dy : stepY < 0 ? (y * size - a[1]) / dy : Infinity;
  visit(x, y);
  for (let guard = Math.abs(endX - x) + Math.abs(endY - y); guard > 0 && (x !== endX || y !== endY); guard--) {
    if (Math.abs(maxX - maxY) < 1e-12) {
      visit(x + stepX, y);
      visit(x, y + stepY);
      x += stepX;
      y += stepY;
      maxX += deltaX;
      maxY += deltaY;
      guard--;
    } else if (maxX < maxY) {
      x += stepX;
      maxX += deltaX;
    } else {
      y += stepY;
      maxY += deltaY;
    }
    visit(x, y);
  }
}

/**
 * Whether two paths may bridge one another: not when they leave or reach the same element, at the
 * same anchor or at two, nor when an end of one lies within `tolerance` of an end of the other.
 */
export function mayBridge(a: BridgePath, b: BridgePath, tolerance: number): boolean {
  for (const id of a.joins) if (id !== null && b.joins.includes(id)) return false;
  for (const p of a.ends) for (const q of b.ends) if (distance(p, q) < tolerance) return false;
  return true;
}

/**
 * The bridge where a path of halo half-width `across` (its own half-width and the gap beside it)
 * crosses a stroke of half-width `beside` at `at`, along the unit directions `upper` and `lower`:
 * the parallelogram where the strip around the upper path meets the lower stroke, its corners
 * counterclockwise.
 */
export function bridgeQuad(at: Point2, upper: Point2, lower: Point2, across: number, beside: number): Point2[] {
  const nu: Point2 = [-upper[1], upper[0]];
  const nv: Point2 = [-lower[1], lower[0]];
  const sine = cross(upper, lower);
  const corner = (s: number, t: number): Point2 => {
    // Where the side s of the strip meets the side t of the stroke.
    const a: Point2 = [at[0] + s * across * nu[0], at[1] + s * across * nu[1]];
    const b: Point2 = [at[0] + t * beside * nv[0], at[1] + t * beside * nv[1]];
    const lambda = cross([b[0] - a[0], b[1] - a[1]], lower) / sine;
    return [a[0] + lambda * upper[0], a[1] + lambda * upper[1]];
  };
  const quad = [corner(1, 1), corner(1, -1), corner(-1, -1), corner(-1, 1)];
  let area = 0;
  for (let i = 0; i < 4; i++) area += cross(quad[i], quad[(i + 1) % 4]);
  return area < 0 ? quad.reverse() : quad;
}

/**
 * The bridges of every path that asks for them, by the path's index: the paths are listed in the
 * order they are drawn, and a path passes over the paths before it. Ends closer than `tolerance`
 * keep two paths from bridging one another.
 */
export function findBridges(paths: readonly BridgePath[], tolerance: number): Map<number, Point2[][]> {
  const result = new Map<number, Point2[][]>();
  let last = -1;
  paths.forEach((path, index) => {
    if (path.bridge && path.bridge.width > path.width) last = index;
  });
  if (last < 1) return result;
  // Every stroke cut into its segments, of the paths up to the last that bridges.
  const segments: Segment[] = [];
  let total = 0;
  for (let index = 0; index <= last; index++) {
    for (const stroke of paths[index].strokes) {
      for (let k = 1; k < stroke.length; k++) {
        const length = distance(stroke[k - 1], stroke[k]);
        if (length < 1e-9) continue;
        segments.push({ path: index, start: stroke[k - 1], end: stroke[k] });
        total += length;
      }
    }
  }
  if (segments.length < 2) return result;
  // The cells are as large as the average segment, so that each segment lies in a few of them.
  const size = Math.max(total / segments.length, 0.05);
  const cells = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    gridCells(segment.start, segment.end, size, (x, y) => {
      const key = `${x},${y}`;
      const list = cells.get(key);
      if (!list) cells.set(key, [index]);
      else if (list[list.length - 1] !== index) list.push(index);
    });
  });
  const tested = new Set<number>();
  const allowed = new Map<number, boolean>();
  for (const list of cells.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        let [lower, upper] = [segments[list[i]], segments[list[j]]];
        if (lower.path === upper.path) continue;
        if (lower.path > upper.path) [lower, upper] = [upper, lower];
        const bridge = paths[upper.path].bridge;
        if (!bridge || bridge.width <= paths[upper.path].width) continue;
        const key = Math.min(list[i], list[j]) * segments.length + Math.max(list[i], list[j]);
        if (tested.has(key)) continue;
        tested.add(key);
        const pair = lower.path * paths.length + upper.path;
        if (!allowed.has(pair)) allowed.set(pair, mayBridge(paths[lower.path], paths[upper.path], tolerance));
        if (!allowed.get(pair)) continue;
        const quad = crossingQuad(upper, lower, paths[upper.path], paths[lower.path]);
        if (!quad) continue;
        const own = result.get(upper.path);
        if (own) own.push(quad);
        else result.set(upper.path, [quad]);
      }
    }
  }
  return result;
}

/**
 * The bridge of the upper segment over the lower one, when they cross properly: not nearly
 * parallel, inside both segments (the start of each included, its end excluded, so that a crossing
 * where two segments of a polyline meet counts once), far enough from the ends of the lower path's
 * stroke that the gap stays inside it (an arrow's tip never loses a notch), and far enough from
 * the ends of the upper path, an arrow's point included, that it reaches across the gap.
 */
function crossingQuad(upper: Segment, lower: Segment, over: BridgePath, under: BridgePath): Point2[] | null {
  const r: Point2 = [upper.end[0] - upper.start[0], upper.end[1] - upper.start[1]];
  const w: Point2 = [lower.end[0] - lower.start[0], lower.end[1] - lower.start[1]];
  const lengthR = Math.hypot(r[0], r[1]);
  const lengthW = Math.hypot(w[0], w[1]);
  const denominator = cross(r, w);
  if (Math.abs(denominator) < MIN_CROSSING_SINE * lengthR * lengthW) return null;
  const q: Point2 = [lower.start[0] - upper.start[0], lower.start[1] - upper.start[1]];
  const t = cross(q, w) / denominator;
  const s = cross(q, r) / denominator;
  if (t < 0 || t >= 1 || s < 0 || s >= 1) return null;
  const at: Point2 = [upper.start[0] + t * r[0], upper.start[1] + t * r[1]];
  const u: Point2 = [r[0] / lengthR, r[1] / lengthR];
  const v: Point2 = [w[0] / lengthW, w[1] / lengthW];
  const sine = Math.abs(cross(u, v));
  const cosine = Math.abs(dot(u, v));
  const across = (over.bridge as { width: number }).width / STROKE_UNITS / 2 + BRIDGE_MARGIN;
  const beside = under.width / STROKE_UNITS / 2 + BRIDGE_MARGIN;
  // How far the parallelogram reaches from the crossing along each path.
  const alongLower = (across + beside * cosine) / sine;
  const alongUpper = (beside + across * cosine) / sine;
  if (under.shaftEnds.some((end) => distance(at, end) < alongLower)) return null;
  if (over.ends.some((end) => distance(at, end) < alongUpper)) return null;
  return bridgeQuad(at, u, v, across, beside);
}

/**
 * The polylines of the strokes of `vmob`, its cubic Bézier curves sampled: one per subpath.
 */
export function strokePolylines(vmob: VMobject): Point2[][] {
  const points = vmob.getPoints();
  const lengths = vmob.getEffectiveSubpathLengths() ?? [points.length];
  const polylines: Point2[][] = [];
  let first = 0;
  for (const length of lengths) {
    const subpath = points.slice(first, first + length);
    first += length;
    if (subpath.length < 4) continue;
    const line: Point2[] = [[subpath[0][0], subpath[0][1]]];
    for (let i = 0; i + 3 < subpath.length; i += 3) {
      const [p0, p1, p2, p3] = subpath.slice(i, i + 4);
      for (let k = 1; k <= CURVE_SAMPLES; k++) {
        const t = k / CURVE_SAMPLES;
        const m = 1 - t;
        const a = m * m * m;
        const b = 3 * m * m * t;
        const c = 3 * m * t * t;
        const d = t * t * t;
        line.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
      }
    }
    polylines.push(line);
  }
  return polylines;
}

/** Shapes whose color never follows their parent's: an animated color leaves bridges alone. */
export const FIXED_COLORS = new WeakSet<Mobject>();

/**
 * `obj` with its bridges under it, filled in `color`: a group that draws them first, which takes
 * the place of `obj` and shows, hides and fades with it.
 */
export function withBridges(obj: Mobject, quads: readonly Point2[][], color: string): Mobject {
  const patches = quads.map((quad) => {
    const patch = new Polygon({ vertices: quad.map(([x, y]) => [x, y, 0]), color, fillOpacity: 1, strokeWidth: 0 });
    FIXED_COLORS.add(patch);
    return patch;
  });
  const group = new Group(...patches, obj) as Group & { markupOutline?: VMobject };
  // Moving along a bridged path still follows the path.
  const outline = (obj as { markupOutline?: VMobject }).markupOutline ?? (obj instanceof VMobject ? obj : undefined);
  if (outline) group.markupOutline = outline;
  return group;
}
