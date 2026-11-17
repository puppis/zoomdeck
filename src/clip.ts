/**
 * Masks and clip paths of SVG artwork, applied to its geometry when it is loaded.
 *
 * A clip path or a mask becomes a region: the closed outlines that show what they cover (every
 * shape of a clip path; the light or opaque shapes of a mask) less those that hide it (the dark
 * shapes of a luminance mask). What the region covers is then cut out of the shapes it applies to:
 *
 * - a shape wholly inside, its stroke included, stays as it is, and one wholly outside goes;
 * - a fill across the border is intersected with the region, as a polygon finely sampled from
 *   its curves, and so is the outline of a stroke that comes nearer the border than half its
 *   width, filled in the stroke's color: the stroke ends on the border, as the browser cuts it;
 * - a stroke along the border of the region, the way Figma keeps a stroke inside or outside its
 *   shape (a mask of the shape itself), becomes the half of the stroke on the visible side: a
 *   stroke half as wide, a quarter of the width over.
 *
 * All of it happens once, in world coordinates, before the artwork is drawn: what reaches the
 * renderer is ordinary vector shapes, and nothing is masked while slides move.
 */
import { Difference, Intersection, VMobject } from 'manim-web';
import { cubicDerivative, cubicPoint, type Cubic, type Vec } from './curves';

/** A closed or open path: its start, then three points per cubic curve. */
export type Subpath = Vec[];

/** One shape of a region: its outlines, filled by `rule`. */
interface RegionShape {
  curves: Subpath[];
  polygons: Vec[][];
  rule: 'nonzero' | 'evenodd';
}

/** What a clip path or a mask lets through. */
export interface Region {
  shows: RegionShape[];
  hides: RegionShape[];
  box: Box;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Samples per curve of the outlines tested against a region. */
const SAMPLES = 16;

/** The cubic curves of a subpath. */
export function cubicsOf(subpath: Subpath): Cubic[] {
  const cubics: Cubic[] = [];
  for (let i = 0; i + 3 < subpath.length; i += 3) cubics.push([subpath[i], subpath[i + 1], subpath[i + 2], subpath[i + 3]]);
  return cubics;
}

/** A subpath from consecutive cubic curves. */
export function subpathOf(cubics: readonly Cubic[]): Subpath {
  const points: Vec[] = [cubics[0][0]];
  for (const c of cubics) points.push(c[1], c[2], c[3]);
  return points;
}

/** The points along a subpath, its curves sampled. */
export function flatten(subpath: Subpath, samples = SAMPLES): Vec[] {
  const points: Vec[] = [subpath[0]];
  for (const c of cubicsOf(subpath)) for (let k = 1; k <= samples; k++) points.push(cubicPoint(c, k / samples));
  return points;
}

function boxOf(points: Iterable<Vec>): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  return box;
}

const overlaps = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
const within = (box: Box, [x, y]: Vec) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;

/** The winding number of the closed polygons around `p`. */
function winding(polygons: readonly Vec[][], [x, y]: Vec): number {
  let count = 0;
  for (const polygon of polygons) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [ax, ay] = polygon[j];
      const [bx, by] = polygon[i];
      if (ay <= y) {
        if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) count++;
      } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) count--;
    }
  }
  return count;
}

function inShape(shape: RegionShape, p: Vec): boolean {
  const turns = winding(shape.polygons, p);
  return shape.rule === 'evenodd' ? turns % 2 !== 0 : turns !== 0;
}

/** Whether a region lets `p` through. */
export function regionContains(region: Region, p: Vec): boolean {
  return within(region.box, p) && region.shows.some((shape) => inShape(shape, p)) && !region.hides.some((shape) => inShape(shape, p));
}

/** A region from the shapes that show and hide, each its subpaths and fill rule; null when nothing shows. */
export function makeRegion(shows: Array<{ subpaths: Subpath[]; rule: 'nonzero' | 'evenodd' }>, hides: Array<{ subpaths: Subpath[]; rule: 'nonzero' | 'evenodd' }> = []): Region | null {
  const shape = ({ subpaths, rule }: { subpaths: Subpath[]; rule: 'nonzero' | 'evenodd' }): RegionShape => ({ curves: subpaths, polygons: subpaths.map((subpath) => flatten(subpath)), rule });
  const shown = shows.filter((s) => s.subpaths.length).map(shape);
  if (!shown.length) return null;
  return { shows: shown, hides: hides.filter((s) => s.subpaths.length).map(shape), box: boxOf(shown.flatMap((s) => s.polygons.flat())) };
}

const regionVertices = (region: Region) => [...region.shows, ...region.hides].flatMap((shape) => shape.polygons.flat());

/** The distance from `p` to the nearest edge of the closed polygons. */
function distanceToEdges(polygons: readonly Vec[][], [x, y]: Vec): number {
  let best = Infinity;
  for (const polygon of polygons) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [ax, ay] = polygon[j];
      const [bx, by] = polygon[i];
      const [dx, dy] = [bx - ax, by - ay];
      const length = dx * dx + dy * dy;
      const t = length > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  }
  return best;
}

const borderPolygons = (region: Region) => [...region.shows, ...region.hides].flatMap((shape) => shape.polygons);

/**
 * Where a stroke `halfWidth` to each side of a subpath lies against the regions: wholly inside
 * them, its edges included; wholly outside one; or across a border, which it comes nearer than
 * its half-width to.
 */
export function strokePlacement(subpath: Subpath, halfWidth: number, regions: readonly Region[]): 'inside' | 'outside' | 'across' {
  const points = flatten(subpath);
  const box = boxOf(points);
  const grown = { minX: box.minX - halfWidth, minY: box.minY - halfWidth, maxX: box.maxX + halfWidth, maxY: box.maxY + halfWidth };
  let across = false;
  for (const region of regions) {
    if (!overlaps(region.box, grown)) return 'outside';
    const ins = points.filter((p) => regionContains(region, p)).length;
    const edges = borderPolygons(region);
    const near = points.some((p) => distanceToEdges(edges, p) < halfWidth);
    if (ins === 0 && !near) {
      // Wholly outside, unless the region lies within the stroke's outline, clear of it.
      const polygons = [points];
      if (!regionVertices(region).some((p) => within(box, p) && winding(polygons, p) !== 0)) return 'outside';
      continue;
    }
    if (ins < points.length || near) across = true;
  }
  return across ? 'across' : 'inside';
}

/**
 * The outline of a stroke `halfWidth` to each side of a subpath, as simple polygons to fill: an
 * open one with its caps (`butt`, `round` or `square`), a closed one as two halves meeting end to
 * end, so that no polygon has a hole. Corners take a miter, cut back where it would reach beyond
 * four half-widths.
 */
export function strokeOutline(subpath: Subpath, halfWidth: number, cap: 'butt' | 'round' | 'square' = 'butt'): Vec[][] {
  const points: Vec[] = [];
  for (const p of flatten(subpath)) {
    const last = points[points.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) points.push(p);
  }
  if (points.length < 2) return [];
  const [first, last] = [points[0], points[points.length - 1]];
  if (points.length > 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9) {
    // A closed stroke: two halves, each from the middle of the other's ends, so that the joins at the start keep their miter.
    const ring = points.slice(0, -1);
    const half = Math.floor(ring.length / 2);
    const quarter = Math.floor(half / 2);
    const turn = [...ring.slice(quarter), ...ring.slice(0, quarter)];
    const a = [...turn.slice(0, half + 1)];
    const b = [...turn.slice(half), turn[0]];
    return [outlineOf(a, halfWidth, 'butt'), outlineOf(b, halfWidth, 'butt')];
  }
  return [outlineOf(points, halfWidth, cap)];
}

/** The outline of an open polyline's stroke: one side along it, the end cap, the other side back, the start cap. */
function outlineOf(points: readonly Vec[], h: number, cap: 'butt' | 'round' | 'square'): Vec[] {
  const unit = (a: Vec, b: Vec): Vec => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  };
  const side = (sign: number): Vec[] => points.map((p, i) => {
    const before = i > 0 ? unit(points[i - 1], p) : null;
    const after = i < points.length - 1 ? unit(p, points[i + 1]) : null;
    const n1: Vec = before ? [-before[1], before[0]] : [-(after as Vec)[1], (after as Vec)[0]];
    const n2: Vec = after ? [-after[1], after[0]] : n1;
    let m: Vec = [n1[0] + n2[0], n1[1] + n2[1]];
    const length = Math.hypot(m[0], m[1]);
    m = length > 1e-9 ? [m[0] / length, m[1] / length] : n1;
    const reach = h / Math.max(m[0] * n1[0] + m[1] * n1[1], 0.25);
    return [p[0] + sign * m[0] * reach, p[1] + sign * m[1] * reach];
  });
  const capAt = (end: Vec, along: Vec): Vec[] => {
    if (cap === 'butt') return [];
    const n: Vec = [-along[1], along[0]];
    if (cap === 'square') return [[end[0] + (n[0] + along[0]) * h, end[1] + (n[1] + along[1]) * h], [end[0] + (-n[0] + along[0]) * h, end[1] + (-n[1] + along[1]) * h]];
    const arc: Vec[] = [];
    for (let k = 1; k < 8; k++) {
      const angle = (Math.PI * k) / 8;
      const [c, s] = [Math.cos(angle), Math.sin(angle)];
      arc.push([end[0] + (n[0] * c + along[0] * s) * h, end[1] + (n[1] * c + along[1] * s) * h]);
    }
    return arc;
  };
  const left = side(1);
  const right = side(-1).reverse();
  const n = points.length;
  const forward = unit(points[n - 2], points[n - 1]);
  const backward = unit(points[1], points[0]);
  return [...left, ...capAt(points[n - 1], forward), ...right, ...capAt(points[0], backward).map((p) => p)];
}

/** Where a shape lies against a region: wholly inside, wholly outside, or across its border. */
export function fillPlacement(subpaths: Subpath[], inside: (p: Vec) => boolean, regions: readonly Region[]): 'inside' | 'outside' | 'across' {
  const outline = subpaths.flatMap((subpath) => flatten(subpath));
  const ins = outline.filter(inside).length;
  // A region whose border reaches into the shape cuts it, even when the outline stays on one side.
  const polygons = subpaths.map((subpath) => flatten(subpath));
  const box = boxOf(outline);
  const reaches = regions.some((region) => overlaps(region.box, box) && regionVertices(region).some((p) => within(box, p) && winding(polygons, p) !== 0));
  if (reaches) return 'across';
  if (ins === outline.length) return 'inside';
  return ins === 0 ? 'outside' : 'across';
}

function vmobjectOf(subpaths: readonly Subpath[]): VMobject {
  const vmob = new VMobject();
  vmob.setPoints(subpaths.flatMap((subpath) => subpath.map(([x, y]) => [x, y, 0])));
  if (subpaths.length > 1) vmob.setBaseSubpathLengths(subpaths.map((subpath) => subpath.length));
  return vmob;
}

/** A closed polygon as a subpath of straight curves. */
function polygonSubpath(vertices: readonly { x: number; y: number }[]): Subpath {
  const points: Vec[] = vertices.map(({ x, y }) => [x, y]);
  const subpath: Vec[] = [points[0]];
  for (let i = 0; i < points.length; i++) {
    const [a, b] = [points[i], points[(i + 1) % points.length]];
    subpath.push([a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3], b);
  }
  return subpath;
}

/** Closed polygons as subpaths of straight curves. */
export function polygonSubpaths(polygons: readonly Vec[][]): Subpath[] {
  return polygons.filter((polygon) => polygon.length >= 3).map((polygon) => polygonSubpath(polygon.map(([x, y]) => ({ x, y }))));
}

/** The part of a filled shape that the regions let through, as polygons sampled from its curves. */
export function intersectFill(subpaths: Subpath[], regions: readonly Region[]): Subpath[] {
  return intersectPolygons(subpaths.map((subpath) => flatten(subpath)), regions);
}

/**
 * The part of closed polygons that the regions let through, as subpaths of straight curves: the
 * engine intersects them as they are, every vertex one point of its polygons.
 */
export function intersectPolygons(polygons: readonly Vec[][], regions: readonly Region[], separately = false): Subpath[] {
  // The pieces of a stroke's outline are cut one by one, so that none merges with another into a ring.
  if (separately) return polygons.flatMap((polygon) => intersectPolygons([polygon], regions));
  let current = polygons.filter((polygon) => polygon.length >= 3);
  const options = { samplesPerSegment: 1 };
  for (const region of regions) {
    if (!current.length) break;
    const shape = (rings: readonly Vec[][]) => vmobjectOf(polygonSubpaths(rings));
    let result: VMobject = new Intersection(shape(current), shape(region.shows.flatMap((s) => s.polygons)), options);
    for (const hidden of region.hides) result = new Difference(result, shape(hidden.polygons), options);
    current = (result as Intersection).getResultVertices().filter((polygon) => polygon.length >= 3).map((polygon) => polygon.map(({ x, y }): Vec => [x, y]));
  }
  return polygonSubpaths(current);
}

/** Whether a stroke runs along the border of a region, within `tolerance`, all the way. */
export function alongBorder(subpaths: Subpath[], region: Region, tolerance: number): boolean {
  const points = subpaths.flatMap((subpath) => flatten(subpath, 8));
  const box = boxOf(points);
  if (box.minX < region.box.minX - tolerance || box.maxX > region.box.maxX + tolerance || box.minY < region.box.minY - tolerance || box.maxY > region.box.maxY + tolerance) return false;
  const edges = borderPolygons(region);
  return points.every((p) => distanceToEdges(edges, p) <= tolerance);
}

/** The unit normal to the left of a curve at its start (`end` false) or its end. */
function normalAt(c: Cubic, end: boolean): Vec {
  let d = cubicDerivative(c, end ? 1 : 0);
  if (Math.hypot(d[0], d[1]) < 1e-12) d = end ? [c[3][0] - c[1][0], c[3][1] - c[1][1]] : [c[2][0] - c[0][0], c[2][1] - c[0][1]];
  if (Math.hypot(d[0], d[1]) < 1e-12) d = [c[3][0] - c[0][0], c[3][1] - c[0][1]];
  const length = Math.hypot(d[0], d[1]) || 1;
  return [-d[1] / length, d[0] / length];
}

/**
 * A subpath moved `offset` to its left (to its right when negative): each curve's ends and the
 * control points beside them along the normals there, close to the true offset where it turns
 * gently, as the rounded corners of a shape do; at a sharp corner the two sides meet in a miter.
 */
export function offsetSubpath(subpath: Subpath, offset: number): Subpath {
  const source = cubicsOf(subpath);
  const normals = source.map((c) => [normalAt(c, false), normalAt(c, true)] as const);
  const cubics = source.map((c, i): Vec[] => {
    const [n0, n1] = normals[i];
    const move = (p: Vec, n: Vec): Vec => [p[0] + n[0] * offset, p[1] + n[1] * offset];
    return [move(c[0], n0), move(c[1], n0), move(c[2], n1), move(c[3], n1)];
  });
  const closed = Math.hypot(subpath[0][0] - subpath[subpath.length - 1][0], subpath[0][1] - subpath[subpath.length - 1][1]) < 1e-9;
  for (let i = 0; i < cubics.length; i++) {
    const j = i + 1 < cubics.length ? i + 1 : closed ? 0 : -1;
    if (j < 0 || (j === 0 && cubics.length < 2)) continue;
    const [a, b] = [normals[i][1], normals[j][0]];
    const cosine = a[0] * b[0] + a[1] * b[1];
    if (cosine > 1 - 1e-9) continue;
    // The miter: where the two moved sides meet, at most four times the offset from the corner.
    const scale = Math.min(1 / Math.max(1 + cosine, 1e-9), 8);
    const corner = source[i][3];
    const miter: Vec = [corner[0] + (a[0] + b[0]) * offset * scale, corner[1] + (a[1] + b[1]) * offset * scale];
    const shift = (points: Vec[], end: number, handle: number) => {
      const [dx, dy] = [miter[0] - points[end][0], miter[1] - points[end][1]];
      points[handle] = [points[handle][0] + dx, points[handle][1] + dy];
      points[end] = miter;
    };
    shift(cubics[i], 3, 2);
    shift(cubics[j], 0, 1);
  }
  return subpathOf(cubics as unknown as Cubic[]);
}

/** Which way a stroke along a region's border shows: +1 to the left of its first curve, -1 to the right. */
export function visibleSide(subpath: Subpath, region: Region, step: number): 1 | -1 {
  const c = cubicsOf(subpath)[0];
  const p = cubicPoint(c, 0.5);
  let d = cubicDerivative(c, 0.5);
  const length = Math.hypot(d[0], d[1]) || 1;
  d = [d[0] / length, d[1] / length];
  return regionContains(region, [p[0] - d[1] * step, p[1] + d[0] * step]) ? 1 : -1;
}
