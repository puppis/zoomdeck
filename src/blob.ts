/**
 * Blobs: smooth closed curves that enclose a set of rectangles at a given
 * distance.
 *
 * The enclosed region is the set of points whose distance to the nearest
 * rectangle is below `buff`, with neighbouring rectangles blended by a smooth
 * minimum so that the curve flows around the group instead of pinching
 * between its members. The region's boundary is traced on a grid (marching
 * squares), resampled evenly and turned into Catmull-Rom curves.
 */
import type { VMobject } from 'manim-web';
import { loopsMobject } from './paths';

/** An axis-aligned rectangle given by its center and size. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlobOptions {
  /** Distance between the rectangles and the curve, in logical units; 0.3 by default. */
  buff?: number;
  /**
   * How far neighbouring rectangles blend into one shape, between 0 (the plain
   * union, with creases where offsets meet) and 1 (wide, soft bridges); 0.5 by default.
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

/** Polynomial smooth minimum: like `min`, but the transition spans a band of width `k`. */
function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k / 4;
}

/** A field that is negative inside the blob and zero on its boundary. */
export function blobField(rects: readonly Rect[], options: BlobOptions = {}): (x: number, y: number) => number {
  const { buff, smoothness } = resolve(options);
  const k = smoothness * buff * 3;
  return (x, y) => {
    let d = Infinity;
    for (const rect of rects) d = smoothMin(d, rectDistance(rect, x, y), k);
    return d - buff;
  };
}

type Segment = [number, number, number, number, number, number];

/**
 * Trace the zero level of `field` over the rectangle [x0, x1] × [y0, y1] with
 * marching squares, returning closed loops of points in traversal order.
 */
function traceContours(field: (x: number, y: number) => number, x0: number, y0: number, x1: number, y1: number, h: number): number[][][] {
  const columns = Math.ceil((x1 - x0) / h) + 1;
  const rows = Math.ceil((y1 - y0) / h) + 1;
  const values = new Float64Array(columns * rows);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) values[j * columns + i] = field(x0 + i * h, y0 + j * h);
  }
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
          // Saddle: decide by the field at the cell center.
          const center = field(px + h / 2, py + h / 2) < 0;
          if ((code === 5) === center) { link('left', 'top'); link('right', 'bottom'); }
          else { link('left', 'bottom'); link('right', 'top'); }
          break;
        }
        default: break;
      }
    }
  }
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

/** Closed polygons (anchor lists) outlining the blob around `rects`. */
export function blobOutline(rects: readonly Rect[], options: BlobOptions = {}): number[][][] {
  if (!rects.length) throw new Error('A blob needs at least one rectangle');
  const { buff, smoothness, resolution, spacing } = resolve(options);
  const margin = buff * (1 + smoothness) + 2 * resolution;
  const x0 = Math.min(...rects.map((r) => r.x - r.width / 2)) - margin;
  const x1 = Math.max(...rects.map((r) => r.x + r.width / 2)) + margin;
  const y0 = Math.min(...rects.map((r) => r.y - r.height / 2)) - margin;
  const y1 = Math.max(...rects.map((r) => r.y + r.height / 2)) + margin;
  const loops = traceContours(blobField(rects, options), x0, y0, x1, y1, resolution);
  // Largest loops first, so the outer contour comes before any hole.
  loops.sort((a, b) => b.length - a.length);
  return loops.map((loop) => resample(loop, spacing));
}

/** A vector mobject whose closed smooth curves enclose `rects` at distance `buff`. */
export function blobMobject(rects: readonly Rect[], options: BlobOptions = {}): VMobject {
  return loopsMobject(blobOutline(rects, options));
}
