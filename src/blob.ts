/**
 * Blobs: smooth closed curves that enclose a set of shapes at a given
 * distance.
 *
 * The shapes are rectangles, round ones (the outline of a circle, a dot or an
 * ellipse) and bridges, tapered bands between two discs that follow an edge
 * joining two members. A blob is their offset closed by a rolling disc: the
 * points within `buff` of a shape, together with every point that a disc of
 * radius ρ rolling around them from outside cannot reach. Where the curve
 * bulges outward it is exactly `buff` from the shapes, however many of them
 * overlap there; every hollow is rounded by an arc of radius ρ, tangent to the
 * rest of the curve; two members join exactly when the disc cannot pass between
 * them; and holes (members around an empty middle, a cycle of edges) are filled.
 * ρ grows with the smoothness, up to twice `buff`. The boundary is traced on a
 * grid (marching squares), resampled evenly and turned into Catmull-Rom curves.
 */
import type { VMobject } from 'manim-web';
import { loopsMobject } from './paths';

/** An axis-aligned rectangle given by its center and size; `round`, the ellipse inscribed in it. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  round?: boolean;
}

/** A band between two discs, `[x, y, radius]`, tapering from one to the other: an edge a blob follows. */
export interface Bridge {
  from: [number, number, number];
  to: [number, number, number];
}

/** How a blob is drawn around its parts: margin, smoothness, stroke and fill. */
export interface BlobOptions {
  /** Distance between the rectangles and the curve, in logical units; 0.3 by default. */
  buff?: number;
  /**
   * How softly the hollows are rounded and neighbours merge, between 0 (the plain
   * union of the offsets, with creases where they meet) and 1 (arcs of radius
   * 2 × `buff`, which also bridge gaps up to 4 × `buff` between the offsets);
   * 0.5 by default, hollows rounded like the corners.
   */
  smoothness?: number;
  /** Grid spacing used to trace the boundary; derived from `buff` by default. */
  resolution?: number;
  /** Distance between consecutive anchors of the traced curve; derived from `buff` by default. */
  spacing?: number;
}

interface Resolved {
  buff: number;
  smoothness: number;
  resolution: number;
  spacing: number;
}

function resolve(options: BlobOptions): Resolved {
  const buff = options.buff ?? 0.3;
  const smoothness = options.smoothness ?? 0.5;
  if (!Number.isFinite(buff) || buff <= 0) throw new Error('Blob buff must be finite and positive');
  if (!Number.isFinite(smoothness) || smoothness < 0 || smoothness > 1) throw new Error('Blob smoothness must be between zero and one');
  const resolution = options.resolution ?? Math.min(0.08, Math.max(0.015, buff / 5));
  const spacing = options.spacing ?? Math.max(resolution * 3, buff * 0.6);
  if (!Number.isFinite(resolution) || resolution <= 0) throw new Error('Blob resolution must be finite and positive');
  if (!Number.isFinite(spacing) || spacing <= 0) throw new Error('Blob spacing must be finite and positive');
  return { buff, smoothness, resolution, spacing };
}

/** Signed distance from `p` to the boundary of an axis-aligned rectangle. */
function rectDistance(rect: Rect, x: number, y: number): number {
  const dx = Math.abs(x - rect.x) - rect.width / 2;
  const dy = Math.abs(y - rect.y) - rect.height / 2;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0);
}

/** Signed distance to an ellipse inscribed in `rect` (exact for a circle, close enough otherwise). */
function roundDistance(rect: Rect, x: number, y: number): number {
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  if (!(rx > 0) || !(ry > 0)) return rectDistance(rect, x, y);
  if (Math.abs(rx - ry) < 1e-9) return Math.hypot(x - rect.x, y - rect.y) - rx;
  return (Math.hypot((x - rect.x) / rx, (y - rect.y) / ry) - 1) * Math.min(rx, ry);
}

/** Signed distance to the hull of two discs (Inigo Quilez's uneven capsule), or to the larger disc when it holds the other. */
function bridgeDistance(bridge: Bridge, x: number, y: number): number {
  const [ax, ay, ra] = bridge.from;
  const [bx, by, rb] = bridge.to;
  const disc = (cx: number, cy: number, r: number) => Math.hypot(x - cx, y - cy) - r;
  const vx = bx - ax;
  const vy = by - ay;
  const h = vx * vx + vy * vy;
  const b = ra - rb;
  if (h <= b * b + 1e-12) return Math.min(disc(ax, ay, ra), disc(bx, by, rb));
  const px = x - ax;
  const py = y - ay;
  const qx = Math.abs(px * vy - py * vx) / h;
  const qy = (px * vx + py * vy) / h;
  const cx = Math.sqrt(h - b * b);
  const cy = b;
  const k = cx * qy - cy * qx;
  if (k < 0) return Math.sqrt(h * (qx * qx + qy * qy)) - ra;
  if (k > cx) return Math.sqrt(h * (qx * qx + qy * qy + 1 - 2 * qy)) - rb;
  return cx * qx + cy * qy - ra;
}

/** The distance to the nearest shape: exact outside the shapes, negative inside them. */
function unionDistance(rects: readonly Rect[], bridges: readonly Bridge[], x: number, y: number): number {
  let d = Infinity;
  for (const rect of rects) d = Math.min(d, rect.round ? roundDistance(rect, x, y) : rectDistance(rect, x, y));
  for (const bridge of bridges) d = Math.min(d, bridgeDistance(bridge, x, y));
  return d;
}

/** The radius of the rolling disc that closes a blob: twice `buff` at full smoothness. */
function closingRadius(buff: number, smoothness: number): number {
  return 2 * buff * smoothness;
}

/** A field sampled on a grid: `values[j * columns + i]` at (x0 + i·h, y0 + j·h). */
interface Grid {
  x0: number;
  y0: number;
  h: number;
  columns: number;
  rows: number;
  values: Float64Array;
}

/** A piece of a level line inside one cell: the grid edges it crosses, and where. */
type Segment = [number, number, number, number, number, number];

/** The pieces of the zero level of a sampled field, cell by cell (marching squares). */
function levelSegments(grid: Grid): Segment[] {
  const { x0, y0, h, columns, rows, values } = grid;
  const at = (i: number, j: number) => values[j * columns + i];
  // Edge identifiers: horizontal edges (between (i,j) and (i+1,j)) and vertical edges (between (i,j) and (i,j+1)).
  const horizontal = (i: number, j: number) => j * columns + i;
  const vertical = (i: number, j: number) => columns * rows + j * columns + i;
  const crossing = (xa: number, ya: number, va: number, xb: number, yb: number, vb: number): [number, number] => {
    const t = va === vb ? 0.5 : va / (va - vb);
    return [xa + (xb - xa) * t, ya + (yb - ya) * t];
  };
  const segments: Segment[] = [];
  for (let j = 0; j + 1 < rows; j += 1) {
    for (let i = 0; i + 1 < columns; i += 1) {
      const v00 = at(i, j);
      const v10 = at(i + 1, j);
      const v01 = at(i, j + 1);
      const v11 = at(i + 1, j + 1);
      const code = (v00 < 0 ? 1 : 0) | (v10 < 0 ? 2 : 0) | (v11 < 0 ? 4 : 0) | (v01 < 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const px = x0 + i * h;
      const py = y0 + j * h;
      const edges: Record<'bottom' | 'right' | 'top' | 'left', [number, [number, number]]> = {
        bottom: [horizontal(i, j), crossing(px, py, v00, px + h, py, v10)],
        right: [vertical(i + 1, j), crossing(px + h, py, v10, px + h, py + h, v11)],
        top: [horizontal(i, j + 1), crossing(px, py + h, v01, px + h, py + h, v11)],
        left: [vertical(i, j), crossing(px, py, v00, px, py + h, v01)],
      };
      const link = (a: keyof typeof edges, b: keyof typeof edges) => {
        const [ida, [xa, ya]] = edges[a];
        const [idb, [xb, yb]] = edges[b];
        segments.push([ida, xa, ya, idb, xb, yb]);
      };
      switch (code) {
        case 1: case 14: link('left', 'bottom'); break;
        case 2: case 13: link('bottom', 'right'); break;
        case 3: case 12: link('left', 'right'); break;
        case 4: case 11: link('right', 'top'); break;
        case 6: case 9: link('bottom', 'top'); break;
        case 7: case 8: link('left', 'top'); break;
        case 5: case 10: {
          // Saddle: decide by the mean of the corners, the field's value at the cell center.
          const center = v00 + v10 + v01 + v11 < 0;
          if ((code === 5) === center) { link('left', 'top'); link('right', 'bottom'); }
          else { link('left', 'bottom'); link('right', 'top'); }
          break;
        }
        default: break;
      }
    }
  }
  return segments;
}

/** The zero level of a sampled field as closed loops of points, in traversal order. */
function traceLoops(grid: Grid): number[][][] {
  const segments = levelSegments(grid);
  // Link segments into loops through their shared edge identifiers.
  const byEdge = new Map<number, number[]>();
  segments.forEach((segment, index) => {
    for (const edge of [segment[0], segment[3]]) {
      if (!byEdge.has(edge)) byEdge.set(edge, []);
      (byEdge.get(edge) as number[]).push(index);
    }
  });
  const used = new Set<number>();
  const loops: number[][][] = [];
  for (let start = 0; start < segments.length; start += 1) {
    if (used.has(start)) continue;
    const loop: number[][] = [];
    let index = start;
    let edge = segments[start][0];
    while (!used.has(index)) {
      used.add(index);
      const segment = segments[index];
      const [from, to] = segment[0] === edge ? [segment[0], segment[3]] : [segment[3], segment[0]];
      loop.push(from === segment[0] ? [segment[1], segment[2]] : [segment[4], segment[5]]);
      const next = (byEdge.get(to) ?? []).find((candidate) => candidate !== index && !used.has(candidate));
      if (next === undefined) break;
      index = next;
      edge = to;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/**
 * The blob's field on a grid around the shapes: negative inside, zero on the boundary.
 *
 * The blob is the region R of the points within `buff` of a shape, closed by a disc of radius ρ:
 * R and every point that no disc of radius ρ outside R covers. The centers of the discs outside R
 * are the points at least buff + ρ from every shape, the region Q; a point belongs to the blob
 * when it is farther than ρ from Q, so the field is ρ minus the distance to Q's boundary,
 * measured to the pieces of that level line. Without smoothness it is the distance to the shapes
 * minus `buff`. The grid is centered on the shapes, so that a symmetric group is traced
 * symmetrically, and its border always counts as outside, so every loop closes.
 */
function blobGrid(rects: readonly Rect[], bridges: readonly Bridge[], resolved: Resolved): Grid {
  const { buff, smoothness, resolution: h } = resolved;
  const radius = closingRadius(buff, smoothness);
  const margin = buff + radius + 3 * h;
  const left = Math.min(...rects.map((r) => r.x - r.width / 2));
  const right = Math.max(...rects.map((r) => r.x + r.width / 2));
  const bottom = Math.min(...rects.map((r) => r.y - r.height / 2));
  const top = Math.max(...rects.map((r) => r.y + r.height / 2));
  // A grid centered on the shapes, so that a symmetric group is traced symmetrically.
  const half = (extent: number) => Math.ceil((extent / 2 + margin) / h);
  const columns = 2 * half(right - left) + 1;
  const rows = 2 * half(top - bottom) + 1;
  const x0 = (left + right) / 2 - half(right - left) * h;
  const y0 = (bottom + top) / 2 - half(top - bottom) * h;
  const values = new Float64Array(columns * rows);
  if (radius > 0) {
    const level = buff + radius;
    // The distance to the shapes minus buff + ρ: Q where it is not negative.
    const grown = new Float64Array(columns * rows);
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < columns; i += 1) grown[j * columns + i] = unionDistance(rects, bridges, x0 + i * h, y0 + j * h) - level;
    }
    const edges = levelSegments({ x0, y0, h, columns, rows, values: grown });
    // The pieces of Q's boundary, in buckets as wide as the farthest distance that matters: beyond
    // ρ + 2h from Q, a point is inside the closed offset by more than 2h, far from the curve.
    const reach = radius + 2 * h;
    const across = Math.ceil(((columns - 1) * h) / reach) + 1;
    const down = Math.ceil(((rows - 1) * h) / reach) + 1;
    const cell = (value: number, origin: number, count: number) => Math.min(count - 1, Math.max(0, Math.floor((value - origin) / reach)));
    // Each bucket lists its pieces as runs of five numbers: start, direction, and 1 / squared length.
    const lists: number[][] = Array.from({ length: across * down }, () => []);
    for (const [, ax, ay, , bx, by] of edges) {
      const dx = bx - ax;
      const dy = by - ay;
      const inverse = dx * dx + dy * dy > 0 ? 1 / (dx * dx + dy * dy) : 0;
      for (let cx = cell(Math.min(ax, bx), x0, across); cx <= cell(Math.max(ax, bx), x0, across); cx += 1) {
        for (let cy = cell(Math.min(ay, by), y0, down); cy <= cell(Math.max(ay, by), y0, down); cy += 1) lists[cy * across + cx].push(ax, ay, dx, dy, inverse);
      }
    }
    const buckets = lists.map((list) => Float64Array.from(list));
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < columns; i += 1) {
        const k = j * columns + i;
        const e = grown[k];
        let closed: number;
        if (e >= 0 || e < -reach) {
          // In Q, or far inside (the distance to the shapes is a lower bound of the distance to Q): ρ + e
          // is the value in Q, and inside a bound below -2h, which keeps the curve where it is.
          closed = radius + e;
        } else {
          const x = x0 + i * h;
          const y = y0 + j * h;
          const bx = cell(x, x0, across);
          const by = cell(y, y0, down);
          let nearest = reach * reach;
          for (let cy = Math.max(0, by - 1); cy <= Math.min(down - 1, by + 1); cy += 1) {
            for (let cx = Math.max(0, bx - 1); cx <= Math.min(across - 1, bx + 1); cx += 1) {
              const list = buckets[cy * across + cx];
              for (let n = 0; n < list.length; n += 5) {
                const px = x - list[n];
                const py = y - list[n + 1];
                const dx = list[n + 2];
                const dy = list[n + 3];
                const t = Math.min(1, Math.max(0, (px * dx + py * dy) * list[n + 4]));
                const qx = px - dx * t;
                const qy = py - dy * t;
                const squared = qx * qx + qy * qy;
                if (squared < nearest) nearest = squared;
              }
            }
          }
          closed = radius - Math.sqrt(nearest);
        }
        values[k] = closed;
      }
    }
  } else {
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < columns; i += 1) values[j * columns + i] = unionDistance(rects, bridges, x0 + i * h, y0 + j * h) - buff;
    }
  }
  const outside = h * 1e-3;
  for (let i = 0; i < columns; i += 1) {
    values[i] = Math.max(values[i], outside);
    values[(rows - 1) * columns + i] = Math.max(values[(rows - 1) * columns + i], outside);
  }
  for (let j = 0; j < rows; j += 1) {
    values[j * columns] = Math.max(values[j * columns], outside);
    values[j * columns + columns - 1] = Math.max(values[j * columns + columns - 1], outside);
  }
  return { x0, y0, h, columns, rows, values };
}

/**
 * A field that is negative inside the blob and zero on its boundary, interpolated from the grid
 * the blob is traced on; away from the grid, the distance to the shapes minus `buff`.
 */
export function blobField(rects: readonly Rect[], options: BlobOptions = {}, bridges: readonly Bridge[] = []): (x: number, y: number) => number {
  if (!rects.length) throw new Error('A blob needs at least one rectangle');
  const resolved = resolve(options);
  const { x0, y0, h, columns, rows, values } = blobGrid(rects, bridges, resolved);
  return (x, y) => {
    const u = (x - x0) / h;
    const v = (y - y0) / h;
    if (!(u >= 0 && v >= 0 && u <= columns - 1 && v <= rows - 1)) return unionDistance(rects, bridges, x, y) - resolved.buff;
    const i = Math.min(columns - 2, Math.floor(u));
    const j = Math.min(rows - 2, Math.floor(v));
    const s = u - i;
    const t = v - j;
    const at = (a: number, b: number) => values[b * columns + a];
    return (at(i, j) * (1 - s) + at(i + 1, j) * s) * (1 - t) + (at(i, j + 1) * (1 - s) + at(i + 1, j + 1) * s) * t;
  };
}

/** Whether `point` lies inside the closed polygon `loop` (even-odd rule). */
function inside(point: number[], loop: number[][]): boolean {
  let result = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i, i += 1) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) result = !result;
  }
  return result;
}

/** Resample a closed polygon to anchors `spacing` apart along its perimeter. */
function resample(loop: number[][], spacing: number): number[][] {
  let perimeter = 0;
  const lengths: number[] = [];
  for (let i = 0; i < loop.length; i += 1) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    lengths.push(length);
    perimeter += length;
  }
  const count = Math.max(8, Math.round(perimeter / spacing));
  const step = perimeter / count;
  const result: number[][] = [];
  let segment = 0;
  let offset = 0;
  for (let n = 0; n < count; n += 1) {
    const target = n * step;
    while (segment < loop.length - 1 && offset + lengths[segment] < target) {
      offset += lengths[segment];
      segment += 1;
    }
    const p = loop[segment];
    const q = loop[(segment + 1) % loop.length];
    const t = lengths[segment] > 0 ? (target - offset) / lengths[segment] : 0;
    result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
  }
  return result;
}

/**
 * Closed polygons (anchor lists) outlining the blob around `rects` and along `bridges`: one per
 * separate part, largest first. A hole (members around an empty middle, a cycle of edges) is
 * filled, since a blob encloses its members.
 */
export function blobOutline(rects: readonly Rect[], options: BlobOptions = {}, bridges: readonly Bridge[] = []): number[][][] {
  if (!rects.length) throw new Error('A blob needs at least one rectangle');
  const resolved = resolve(options);
  const loops = traceLoops(blobGrid(rects, bridges, resolved));
  const outer = loops.filter((loop) => !loops.some((other) => other !== loop && inside(loop[0], other)));
  outer.sort((a, b) => b.length - a.length);
  return outer.map((loop) => resample(loop, resolved.spacing));
}

/** A vector mobject whose closed smooth curves enclose `rects`, and follow `bridges`, at distance `buff`. */
export function blobMobject(rects: readonly Rect[], options: BlobOptions = {}, bridges: readonly Bridge[] = []): VMobject {
  return loopsMobject(blobOutline(rects, options, bridges));
}
