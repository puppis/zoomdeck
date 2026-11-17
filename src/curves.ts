/**
 * Curved arrows and lines.
 *
 * A connection's path is a chain of cubic Bézier curves, measured by its length: an arc that
 * leaves at an angle (`bend`, as TikZ draws it), a loop back to the element it leaves (`loop`), a
 * regular wave along the straight line (`wavy`), or a smooth curve through given points (`via`).
 * Points along it, its direction, the part between two distances and its dashes all come from a
 * table of samples made once, when the slide is laid out; what is drawn keeps the exact curves.
 *
 * A tip follows the curve's last stretch: it points along the chord from where its base meets the
 * curve to the end, so that it sits on the curve however tightly it turns. A filled triangle
 * covers the end of the stroke; an open tip is two strokes meeting at the end, which the stroke
 * reaches.
 */
import { Polygon, VGroup, VMobject, type Mobject } from 'manim-web';
import { sketch, type ShaftMobject, type SketchOptions } from './sketch';

/** A point of the plane. */
export type Vec = readonly [number, number];
/** A cubic Bézier curve: its start, two control points and its end. */
export type Cubic = readonly [Vec, Vec, Vec, Vec];
/** The tips an arrow may have. */
export const TIP_KINDS = ['triangle', 'open', 'none'] as const;
export type TipKind = (typeof TIP_KINDS)[number];

/** Samples per curve of the table that measures a path. */
const SAMPLES = 24;
/** Halvings of an interval that place a crossing of a border: far below a pixel. */
const BISECTIONS = 30;
/** The control distance of a bend, as a fraction of its chord: TikZ's, which draws a circle's quarter nearly exactly. */
const BEND_CONTROL = 0.3915;

const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const direction = (angle: number): Vec => [Math.cos(angle), Math.sin(angle)];

/** The point of `c` at `t`. */
export function cubicPoint(c: Cubic, t: number): Vec {
  const m = 1 - t;
  const a = m * m * m;
  const b = 3 * m * m * t;
  const d = 3 * m * t * t;
  const e = t * t * t;
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
}

/** The derivative of `c` at `t`. */
export function cubicDerivative(c: Cubic, t: number): Vec {
  const m = 1 - t;
  const a = 3 * m * m;
  const b = 6 * m * t;
  const d = 3 * t * t;
  return [
    a * (c[1][0] - c[0][0]) + b * (c[2][0] - c[1][0]) + d * (c[3][0] - c[2][0]),
    a * (c[1][1] - c[0][1]) + b * (c[2][1] - c[1][1]) + d * (c[3][1] - c[2][1]),
  ];
}

/** `c` cut in two at `t` (de Casteljau). */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const ab = lerp(c[0], c[1], t);
  const bc = lerp(c[1], c[2], t);
  const cd = lerp(c[2], c[3], t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const middle = lerp(abc, bcd, t);
  return [[c[0], ab, abc, middle], [middle, bcd, cd, c[3]]];
}

/** The part of `c` from `t0` to `t1`. */
export function subCubic(c: Cubic, t0: number, t1: number): Cubic {
  if (t1 <= 1e-12) return [c[0], c[0], c[0], c[0]];
  const [head] = t1 >= 1 ? [c] : splitCubic(c, t1);
  return t0 <= 1e-12 ? head : splitCubic(head, Math.min(t0 / t1, 1))[1];
}

/** The straight curve from `a` to `b`. */
export function lineCubic(a: Vec, b: Vec): Cubic {
  return [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b];
}

/** The engine's points of a chain of curves: its start, then three points per curve. */
export function enginePoints(cubics: readonly Cubic[]): number[][] {
  const points: number[][] = [[cubics[0][0][0], cubics[0][0][1], 0]];
  for (const c of cubics) for (let k = 1; k < 4; k++) points.push([c[k][0], c[k][1], 0]);
  return points;
}

/** One vector shape drawing chains of curves, each a subpath of its own. */
export function curveMobject(pieces: readonly (readonly Cubic[])[]): VMobject {
  const vmob = new VMobject();
  const chains = pieces.filter((piece) => piece.length);
  vmob.setPoints(chains.flatMap(enginePoints));
  if (chains.length > 1) vmob.setBaseSubpathLengths(chains.map((piece) => 3 * piece.length + 1));
  return vmob;
}

interface Mark {
  index: number;
  t: number;
  s: number;
  point: Vec;
}

/** A chain of cubic curves, measured by its length. */
export class Spline {
  readonly cubics: readonly Cubic[];
  readonly length: number;
  private readonly marks: Mark[];

  constructor(cubics: readonly Cubic[]) {
    if (!cubics.length) throw new Error('A path needs at least one curve');
    this.cubics = cubics;
    this.marks = [{ index: 0, t: 0, s: 0, point: cubics[0][0] }];
    let s = 0;
    cubics.forEach((c, index) => {
      for (let k = 1; k <= SAMPLES; k++) {
        const t = k / SAMPLES;
        const point = cubicPoint(c, t);
        s += distance(this.marks[this.marks.length - 1].point, point);
        this.marks.push({ index, t, s, point });
      }
    });
    this.length = s;
  }

  get start(): Vec {
    return this.cubics[0][0];
  }

  get end(): Vec {
    return this.cubics[this.cubics.length - 1][3];
  }

  /** The curve and its parameter `s` along the path. */
  locate(s: number): [number, number] {
    const at = Math.min(Math.max(s, 0), this.length);
    let lo = 0;
    let hi = this.marks.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.marks[mid].s < at) lo = mid;
      else hi = mid;
    }
    const b = this.marks[hi];
    // A mark that ends a curve is the start of the next one.
    const a = this.marks[lo].index === b.index ? this.marks[lo] : { ...this.marks[lo], index: b.index, t: 0 };
    const u = b.s > a.s ? (at - a.s) / (b.s - a.s) : 0;
    return [b.index, a.t + (b.t - a.t) * u];
  }

  /** The point `s` along the path. */
  pointAt(s: number): Vec {
    const [index, t] = this.locate(s);
    return cubicPoint(this.cubics[index], t);
  }

  /** The unit direction of the path `s` along it. */
  directionAt(s: number): Vec {
    const [index, t] = this.locate(s);
    let d = cubicDerivative(this.cubics[index], t);
    let length = Math.hypot(d[0], d[1]);
    if (length < 1e-12) {
      // A curve that stops at an end, its control point on it: the chord nearby gives the way.
      const a = this.pointAt(Math.max(s - 1e-4, 0));
      const b = this.pointAt(Math.min(s + 1e-4, this.length));
      d = [b[0] - a[0], b[1] - a[1]];
      length = Math.hypot(d[0], d[1]) || 1;
    }
    return [d[0] / length, d[1] / length];
  }

  /** The part of the path from `s0` to `s1`, as curves. */
  slice(s0: number, s1: number): Cubic[] {
    const [i0, t0] = this.locate(s0);
    const [i1, t1] = this.locate(Math.max(s1, s0));
    if (i0 === i1) return [subCubic(this.cubics[i0], t0, t1)];
    const pieces: Cubic[] = [];
    if (t0 < 1 - 1e-12) pieces.push(subCubic(this.cubics[i0], t0, 1));
    pieces.push(...this.cubics.slice(i0 + 1, i1));
    if (t1 > 1e-12) pieces.push(subCubic(this.cubics[i1], 0, t1));
    return pieces.length ? pieces : [subCubic(this.cubics[i0], t0, t0)];
  }

  /** The part of the path from `s0` to `s1`, measured again. */
  part(s0: number, s1: number): Spline {
    return new Spline(this.slice(s0, s1));
  }

  /** The sampled points along the path, a polyline. */
  polyline(): Vec[] {
    return this.marks.map((mark) => mark.point);
  }

  /** How far along the path it first leaves the region `inside`, which it starts in; null if it never does. */
  exit(inside: (p: Vec) => boolean): number | null {
    for (let k = 1; k < this.marks.length; k++) {
      if (!inside(this.marks[k].point)) return this.bisect(this.marks[k - 1].s, this.marks[k].s, inside, true);
    }
    return null;
  }

  /** How far along the path it last enters the region `inside`, which it ends in; null if it is never outside. */
  entry(inside: (p: Vec) => boolean): number | null {
    for (let k = this.marks.length - 2; k >= 0; k--) {
      if (!inside(this.marks[k].point)) return this.bisect(this.marks[k].s, this.marks[k + 1].s, inside, false);
    }
    return null;
  }

  /** Where between `a` and `b` the path crosses the border of `inside`: inside at `a` when `leaving`, outside otherwise. */
  private bisect(a: number, b: number, inside: (p: Vec) => boolean, leaving: boolean): number {
    let [lo, hi] = [a, b];
    for (let i = 0; i < BISECTIONS; i++) {
      const mid = (lo + hi) / 2;
      if (inside(this.pointAt(mid)) === leaving) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** How far along the path lies the last point `chord` from its end in a straight line; 0 if none is that far. */
  backFromEnd(chord: number): number {
    const end = this.end;
    for (let k = this.marks.length - 2; k >= 0; k--) {
      if (distance(this.marks[k].point, end) >= chord) {
        let [lo, hi] = [this.marks[k].s, this.marks[k + 1].s];
        for (let i = 0; i < BISECTIONS; i++) {
          const mid = (lo + hi) / 2;
          if (distance(this.pointAt(mid), end) >= chord) lo = mid;
          else hi = mid;
        }
        return lo;
      }
    }
    return 0;
  }
}

/**
 * The arc from `start` to `end` that leaves at `outAngle` and arrives from `inAngle` (the
 * direction from the end back along the curve), as TikZ bends one: its control points on those
 * directions, `looseness` times 0.3915 of the chord away.
 */
export function bendCubic(start: Vec, end: Vec, outAngle: number, inAngle: number, looseness = 1): Cubic {
  const reach = BEND_CONTROL * distance(start, end) * looseness;
  const [u, v] = [direction(outAngle), direction(inAngle)];
  return [start, [start[0] + u[0] * reach, start[1] + u[1] * reach], [end[0] + v[0] * reach, end[1] + v[1] * reach], end];
}

/** A loop from `start` out at `outAngle` and back to `end` in at `inAngle`, its control points `reach` away. */
export function loopCubic(start: Vec, end: Vec, outAngle: number, inAngle: number, reach: number): Cubic {
  const [u, v] = [direction(outAngle), direction(inAngle)];
  return [start, [start[0] + u[0] * reach, start[1] + u[1] * reach], [end[0] + v[0] * reach, end[1] + v[1] * reach], end];
}

/**
 * A smooth curve through `points` (a centripetal Catmull-Rom spline, which never loops or
 * overshoots between close points), as cubic curves; its ends continue the first and last legs.
 */
export function throughPoints(points: readonly Vec[]): Cubic[] {
  if (points.length < 2) throw new Error('A curve needs at least two points');
  if (points.length === 2) return [lineCubic(points[0], points[1])];
  const mirror = (p: Vec, about: Vec): Vec => [2 * about[0] - p[0], 2 * about[1] - p[1]];
  const all = [mirror(points[1], points[0]), ...points, mirror(points[points.length - 2], points[points.length - 1])];
  const knot = (a: Vec, b: Vec) => Math.max(Math.sqrt(distance(a, b)), 1e-6);
  const cubics: Cubic[] = [];
  for (let i = 1; i + 2 < all.length; i++) {
    const [p0, p1, p2, p3] = [all[i - 1], all[i], all[i + 1], all[i + 2]];
    const [d1, d2, d3] = [knot(p0, p1), knot(p1, p2), knot(p2, p3)];
    const b1: Vec = [
      (d1 * d1 * p2[0] - d2 * d2 * p0[0] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[0]) / (3 * d1 * (d1 + d2)),
      (d1 * d1 * p2[1] - d2 * d2 * p0[1] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[1]) / (3 * d1 * (d1 + d2)),
    ];
    const b2: Vec = [
      (d3 * d3 * p1[0] - d2 * d2 * p3[0] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[0]) / (3 * d3 * (d3 + d2)),
      (d3 * d3 * p1[1] - d2 * d2 * p3[1] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[1]) / (3 * d3 * (d3 + d2)),
    ];
    cubics.push([p1, b1, b2, p2]);
  }
  return cubics;
}

/**
 * A regular wave from `start` to `end`: `waves` periods of a sine `amplitude` away from the
 * straight line at most, its first crest to the left of the way (to the right with a negative
 * amplitude). Over its first and last quarter period the wave grows from the line and settles
 * back on it, so that it leaves and arrives along the line and a tip points the way it goes.
 */
export function waveCubics(start: Vec, end: Vec, waves: number, amplitude: number): Cubic[] {
  const length = distance(start, end);
  const along: Vec = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
  const across: Vec = [-along[1], along[0]];
  const k = (2 * Math.PI * waves) / length;
  const ramp = Math.min(length / (4 * waves), length / 2);
  // The envelope: 0 at the ends, 1 from a quarter period in, with a smooth step between.
  const envelope = (u: number): [number, number] => {
    const near = Math.min(u, length - u);
    const sign = u <= length / 2 ? 1 : -1;
    if (near >= ramp) return [1, 0];
    const x = near / ramp;
    return [x * x * (3 - 2 * x), (sign * 6 * x * (1 - x)) / ramp];
  };
  const at = (u: number): [Vec, Vec] => {
    const [g, dg] = envelope(u);
    const y = amplitude * Math.sin(k * u) * g;
    const dy = amplitude * (k * Math.cos(k * u) * g + Math.sin(k * u) * dg);
    return [
      [start[0] + along[0] * u + across[0] * y, start[1] + along[1] * u + across[1] * y],
      [along[0] + across[0] * dy, along[1] + across[1] * dy],
    ];
  };
  // Eight curves a period, each matching the wave's points and directions at its ends.
  const count = Math.max(4, Math.ceil(8 * waves));
  const h = length / count;
  const cubics: Cubic[] = [];
  let [p, d] = at(0);
  for (let i = 1; i <= count; i++) {
    const [q, e] = at(i === count ? length : i * h);
    cubics.push([p, [p[0] + (d[0] * h) / 3, p[1] + (d[1] * h) / 3], [q[0] - (e[0] * h) / 3, q[1] - (e[1] * h) / 3], q]);
    [p, d] = [q, e];
  }
  return cubics;
}

/**
 * The points of `via`, the places a curve passes through: `(x,y)` a point of the slide, `+(x,y)`
 * an offset from `start` (the curve moves with the element it leaves), `++(x,y)` an offset from the
 * point before.
 */
export function viaPoints(value: string, start: Vec): Vec[] {
  const points: Vec[] = [];
  for (const match of value.matchAll(/(\+{0,2})\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)/g)) {
    const [x, y] = [Number(match[2]), Number(match[3])];
    const from = match[1] === '++' ? points[points.length - 1] ?? start : match[1] === '+' ? start : [0, 0];
    points.push([from[0] + x, from[1] + y]);
  }
  return points;
}

/** Whether `value` is a list of `via` points: at least one, `(x,y)`, `+(x,y)` or `++(x,y)` with numbers, and nothing else. */
export function isViaList(value: string): boolean {
  const pattern = /(\+{0,2})\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)/g;
  const matches = [...value.matchAll(pattern)];
  return matches.length > 0 && !value.replace(pattern, '').trim() && matches.every((m) => Number.isFinite(Number(m[2])) && Number.isFinite(Number(m[3])));
}

/**
 * The dashes of a path's first `length`: about `dash` long with gaps of about `gap`, stretched so
 * that it begins and ends with a dash, and at least two of them, each a piece of the curve.
 */
export function dashPieces(path: Spline, length: number, dash: number, gap: number): Cubic[][] {
  const count = Math.max(2, Math.round((length + gap) / (dash + gap)));
  const scale = length / (count * dash + (count - 1) * gap);
  const pieces: Cubic[][] = [];
  for (let n = 0; n < count; n++) {
    const from = n * (dash + gap) * scale;
    pieces.push(path.slice(from, from + dash * scale));
  }
  return pieces;
}

/** How a connection is drawn along its path. */
export interface PathStyle {
  color: string;
  /** Stroke width, in engine units. */
  width: number;
  /** Dash and gap lengths of a dashed stroke, in logical units; a tip stays solid. */
  dash?: readonly [number, number];
  /** Hand-drawn strokes, with these options. */
  sketch?: SketchOptions | null;
  tip: TipKind;
  /** The tip's length along the path and how far it spreads on each side of it. */
  tipLength: number;
  tipWidth: number;
}

/** A drawn path: its mobject, and how far along the path its stroke runs before a tip takes over. */
export interface DrawnPath {
  mobject: Mobject;
  /** Where the tip's base meets the path; the path's length without a tip. */
  tipBase: number;
}

/**
 * Draw a connection along `path`: its stroke, solid, dashed or hand-drawn, and its tip. A
 * triangle covers the end of the stroke, which stops at its base; the two strokes of an open tip
 * meet at the end, which the stroke reaches.
 */
export function drawPath(path: Spline, style: PathStyle): DrawnPath {
  const end = path.end;
  const tipBase = style.tip === 'none' ? path.length : path.backFromEnd(style.tipLength);
  let corners: Vec[] = [];
  if (style.tip !== 'none') {
    // The tip points along the chord from the curve at its base to the end.
    const base = path.pointAt(tipBase);
    const chord = distance(base, end);
    const u: Vec = chord > 1e-9 ? [(end[0] - base[0]) / chord, (end[1] - base[1]) / chord] : path.directionAt(path.length);
    const back: Vec = [end[0] - u[0] * style.tipLength, end[1] - u[1] * style.tipLength];
    const n: Vec = [-u[1] * style.tipWidth, u[0] * style.tipWidth];
    const left: Vec = [back[0] + n[0], back[1] + n[1]];
    const right: Vec = [back[0] - n[0], back[1] - n[1]];
    corners = style.tip === 'open' ? [left, end, right] : [end, left, right];
  }
  const strokeLength = style.tip === 'triangle' ? tipBase : path.length;
  const pieces = style.dash ? dashPieces(path, strokeLength, style.dash[0], style.dash[1]) : [path.slice(0, strokeLength)];
  if (style.sketch) {
    const tip = style.tip === 'none' ? undefined : { open: style.tip === 'open', corners: corners.map(([x, y]) => [x, y, 0]) };
    const drawn = sketch.curve(pieces.map(enginePoints), { ...style.sketch, dash: undefined }, tip);
    return { mobject: drawn, tipBase };
  }
  const stroke = curveMobject(pieces);
  stroke.setStyle({ strokeColor: style.color, strokeWidth: style.width, strokeOpacity: 1 });
  stroke.setFill(style.color, 0);
  const parts: Mobject[] = [stroke];
  if (style.tip === 'triangle') {
    parts.push(new Polygon({ vertices: corners.map(([x, y]) => [x, y, 0]), color: style.color, fillOpacity: 1, strokeWidth: 0 }));
  } else if (style.tip === 'open') {
    const tip = new VMobject();
    tip.setPointsAsCorners(corners.map(([x, y]) => [x, y, 0]));
    tip.setStyle({ strokeColor: style.color, strokeWidth: style.width, strokeOpacity: 1 });
    tip.setFill(style.color, 0);
    parts.push(tip);
  }
  const group = new VGroup(...parts) as ShaftMobject;
  group.markupShaft = [stroke];
  return { mobject: group, tipBase };
}
