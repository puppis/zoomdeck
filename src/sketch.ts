/**
 * Hand-drawn shapes.
 *
 * Rough.js's headless generator turns geometry into move / line / Bézier
 * operations with controlled randomness. Its randomness is tuned for pixel
 * coordinates, so logical units are scaled up before generation and back
 * afterwards; the operations become ordinary vector mobjects (one for the
 * outline, one for the hatching or the solid fill), which animate, transform
 * and export like any other shape.
 */
import rough from 'roughjs';
import type { Drawable, OpSet, Options } from 'roughjs/bin/core';
import type { RoughGenerator } from 'roughjs/bin/generator';
import { VGroup, VMobject, parseSVGPathData } from 'manim-web';

/** Fill patterns of Rough.js. */
export const FILL_STYLES = ['hachure', 'solid', 'zigzag', 'cross-hatch', 'dots', 'dashed', 'zigzag-line'] as const;
export type FillStyle = (typeof FILL_STYLES)[number];

/** Pixels per logical unit handed to Rough.js: a 16-unit slide is sketched as if it were 960 px wide. */
export const SKETCH_SCALE = 60;

/** Engine stroke width units per logical unit. */
const STROKE_UNITS = 100;

export interface SketchOptions {
  /** Outline color; black by default. */
  color?: string;
  /** Outline width in engine units (100 per logical unit); 2 by default. */
  strokeWidth?: number;
  /** Color of the hatching or solid fill; the outline color by default. */
  fillColor?: string;
  /** Opacity of the fill; 0 (no fill) by default. */
  fillOpacity?: number;
  /** Fill pattern; `hachure` by default. */
  fillStyle?: FillStyle;
  /** Amount of wobble: 0 is nearly exact, 1 the default, 2 and above visibly careless. */
  roughness?: number;
  /** How much straight lines bend; 1 by default. */
  bowing?: number;
  /** Hatching angle in degrees; -41 by default. */
  hachureAngle?: number;
  /** Distance between hatching lines in logical units; four times the outline width by default. */
  hachureGap?: number;
  /** Width of the hatching lines in engine units; half the outline width by default. */
  fillWeight?: number;
  /** Seed of the random offsets: the same seed always draws the same shape. */
  seed?: number;
}

interface ResolvedSketch {
  color: string;
  strokeWidth: number;
  fillColor: string;
  fillOpacity: number;
  fillStyle: FillStyle;
  roughness: number;
  bowing: number;
  hachureAngle: number;
  hachureGap: number | undefined;
  fillWeight: number;
  seed: number;
}

/** Vector objects built from a sketch keep the exact geometry they approximate, for paths and anchors. */
export type OutlineMobject = VMobject & { markupOutline?: VMobject };

let generatorInstance: RoughGenerator | null = null;

function generator(): RoughGenerator {
  if (!generatorInstance) generatorInstance = rough.generator();
  return generatorInstance;
}

/** A positive integer seed from any text, so that a shape keeps its look across reloads. */
export function sketchSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483646 + 1;
}

function resolve(options: SketchOptions): ResolvedSketch {
  const color = options.color ?? '#000000';
  const strokeWidth = options.strokeWidth ?? 2;
  const resolved: ResolvedSketch = {
    color,
    strokeWidth,
    fillColor: options.fillColor ?? color,
    fillOpacity: options.fillOpacity ?? 0,
    fillStyle: options.fillStyle ?? 'hachure',
    roughness: options.roughness ?? 1,
    bowing: options.bowing ?? 1,
    hachureAngle: options.hachureAngle ?? -41,
    hachureGap: options.hachureGap,
    fillWeight: options.fillWeight ?? strokeWidth / 2,
    seed: options.seed ?? 1,
  };
  for (const key of ['strokeWidth', 'fillOpacity', 'roughness', 'bowing', 'fillWeight'] as const) {
    if (!Number.isFinite(resolved[key]) || resolved[key] < 0) throw new Error(`${key} must be a nonnegative number`);
  }
  if (resolved.hachureGap !== undefined && !(resolved.hachureGap > 0)) throw new Error('hachureGap must be positive');
  if (!FILL_STYLES.includes(resolved.fillStyle)) throw new Error(`Unknown fill style ${JSON.stringify(resolved.fillStyle)}`);
  if (!Number.isInteger(resolved.seed) || resolved.seed < 0) throw new Error('seed must be a nonnegative integer');
  return resolved;
}

function roughOptions(o: ResolvedSketch, overrides: Options = {}): Options {
  return {
    seed: o.seed,
    roughness: o.roughness,
    bowing: o.bowing,
    stroke: o.color,
    strokeWidth: (o.strokeWidth / STROKE_UNITS) * SKETCH_SCALE,
    ...(o.fillOpacity > 0 ? { fill: o.fillColor } : {}),
    fillStyle: o.fillStyle,
    hachureAngle: o.hachureAngle,
    ...(o.hachureGap !== undefined ? { hachureGap: o.hachureGap * SKETCH_SCALE } : {}),
    fillWeight: (o.fillWeight / STROKE_UNITS) * SKETCH_SCALE,
    ...overrides,
  };
}

type Point = readonly number[];

/** Logical coordinates to the y-down pixel space of Rough.js. */
function toRough(point: Point): [number, number] {
  return [point[0] * SKETCH_SCALE, -point[1] * SKETCH_SCALE];
}

function fromRough(x: number, y: number): [number, number, number] {
  return [x / SKETCH_SCALE, -y / SKETCH_SCALE, 0];
}

function signedArea(points: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return area / 2;
}

function pathMobject(set: OpSet, close: boolean): VMobject | null {
  const subpaths = parseSVGPathData(generator().opsToPath(set)).filter((subpath) => subpath.length >= 2);
  if (!subpaths.length) return null;
  const points: number[][] = [];
  const lengths: number[] = [];
  for (const subpath of subpaths) {
    const converted = subpath.map(([x, y]) => fromRough(x, y));
    const first = converted[0];
    const last = converted[converted.length - 1];
    if (close && Math.hypot(last[0] - first[0], last[1] - first[1]) > 1e-9) {
      // Fills need closed contours: add a straight curve back to the start.
      for (const t of [1 / 3, 2 / 3]) converted.push([last[0] + (first[0] - last[0]) * t, last[1] + (first[1] - last[1]) * t, 0]);
      converted.push([first[0], first[1], 0]);
    }
    // Fill meshes are one-sided: contours must run counterclockwise to be visible.
    if (close && signedArea(converted) < 0) converted.reverse();
    points.push(...converted);
    lengths.push(converted.length);
  }
  const vmob = new VMobject();
  vmob.setPoints(points);
  if (lengths.length > 1) vmob.setBaseSubpathLengths(lengths);
  return vmob;
}

/**
 * Make a hatching's visible opacity a fixed fraction of its nominal opacity.
 * Fades, snapshots and group-wide opacity changes assign the nominal value
 * (the engine's "opacity" is the stroke opacity of the whole family), so the
 * fraction is applied inside the instance's own accessors and survives them.
 */
function attenuate(vmob: VMobject, factor: number): void {
  if (factor >= 1) return;
  const base = Object.getPrototypeOf(vmob).setStrokeOpacity as (value: number) => VMobject;
  Object.defineProperty(vmob, 'setStrokeOpacity', {
    configurable: true,
    value(this: VMobject, value: number) {
      return base.call(this, value * factor);
    },
  });
  Object.defineProperty(vmob, 'opacity', {
    configurable: true,
    get(this: VMobject & { _opacity: number }) {
      return this._opacity / factor;
    },
    set(this: VMobject, value: number) {
      this.setStrokeOpacity(value);
    },
  });
  vmob.setStrokeOpacity(1);
}

function addDrawable(group: VGroup, drawable: Drawable, o: ResolvedSketch): VGroup {
  for (const set of drawable.sets) {
    const vmob = pathMobject(set, set.type === 'fillPath');
    if (!vmob) continue;
    if (set.type === 'path') {
      vmob.setStyle({ strokeColor: o.color, strokeWidth: o.strokeWidth, strokeOpacity: 1 });
      vmob.setFill(o.color, 0);
    } else if (set.type === 'fillPath') {
      // The stroke opacity is the mobject's opacity, which also scales the fill: hide the stroke by width alone.
      vmob.setStyle({ strokeColor: o.fillColor, strokeWidth: 0, strokeOpacity: 1 });
      vmob.setFill(o.fillColor, o.fillOpacity);
    } else {
      vmob.setStyle({ strokeColor: o.fillColor, strokeWidth: o.fillWeight, strokeOpacity: 1 });
      vmob.setFill(o.fillColor, 0);
      attenuate(vmob, o.fillOpacity);
    }
    group.add(vmob);
  }
  return group;
}

/** Convert a Rough.js drawable into a group: fills first, the outline on top. */
export function sketchDrawable(drawable: Drawable, options: SketchOptions = {}): VGroup {
  return addDrawable(new VGroup(), drawable, resolve(options));
}

function roundedRectPath(width: number, height: number, radius: number): string {
  const w = width * SKETCH_SCALE;
  const h = height * SKETCH_SCALE;
  const r = Math.min(radius * SKETCH_SCALE, w / 2, h / 2);
  const x = -w / 2;
  const y = -h / 2;
  return `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} `
    + `H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
}

/** SVG path data from engine-layout Bézier subpaths (an anchor, then three points per curve) in Rough.js space. */
function curvesToPath(subpaths: readonly (readonly Point[])[]): string {
  let d = '';
  for (const points of subpaths) {
    if (points.length < 4) continue;
    d += `M${points[0][0]},${points[0][1]} `;
    for (let i = 1; i + 2 < points.length; i += 3) {
      d += `C${points[i][0]},${points[i][1]} ${points[i + 1][0]},${points[i + 1][1]} ${points[i + 2][0]},${points[i + 2][1]} `;
    }
  }
  return d.trim();
}

/** SVG path data, in Rough.js space, following a vector mobject's own curves. */
function pathDataOf(vmob: VMobject): string {
  const points = vmob.getPoints().map(toRough);
  const lengths = vmob.getSubpathLengths() ?? [points.length];
  const subpaths: Point[][] = [];
  let offset = 0;
  for (const length of lengths) {
    subpaths.push(points.slice(offset, offset + length));
    offset += length;
  }
  return curvesToPath(subpaths);
}

/** A curly brace centerline: horizontal, spanning `length`, tip pointing down, open side on y = 0. */
function bracePath(length: number, depth: number): string {
  const half = (length / 2) * SKETCH_SCALE;
  const d = depth * SKETCH_SCALE;
  const r = Math.min(d / 2, half / 2);
  // y grows downward in Rough.js space.
  return `M${-half},0 A${r},${r} 0 0 0 ${-half + r},${r} H${-r} A${r},${r} 0 0 1 0,${d} `
    + `A${r},${r} 0 0 1 ${r},${r} H${half - r} A${r},${r} 0 0 0 ${half},0`;
}

function vector(a: Point, b: Point): [number, number, number] {
  return [b[0] - a[0], b[1] - a[1], 0];
}

/**
 * Hand-drawn counterparts of the engine's shapes, in logical units. Centered
 * shapes are built around the origin; point-defined ones keep their coordinates.
 */
export const sketch = {
  /** A rectangle of `width` × `height` centered at the origin, optionally with rounded corners. */
  rectangle(width: number, height: number, options: SketchOptions = {}, cornerRadius = 0): VGroup {
    const o = resolve(options);
    const drawable = cornerRadius > 0
      ? generator().path(roundedRectPath(width, height, cornerRadius), roughOptions(o))
      : generator().rectangle(-width / 2 * SKETCH_SCALE, -height / 2 * SKETCH_SCALE, width * SKETCH_SCALE, height * SKETCH_SCALE, roughOptions(o));
    return sketchDrawable(drawable, o);
  },

  /** An ellipse of `width` × `height` centered at the origin. */
  ellipse(width: number, height: number, options: SketchOptions = {}): VGroup {
    const o = resolve(options);
    return sketchDrawable(generator().ellipse(0, 0, width * SKETCH_SCALE, height * SKETCH_SCALE, roughOptions(o)), o);
  },

  /** A circle of `radius` centered at the origin. */
  circle(radius: number, options: SketchOptions = {}): VGroup {
    const o = resolve(options);
    return sketchDrawable(generator().circle(0, 0, 2 * radius * SKETCH_SCALE, roughOptions(o)), o);
  },

  /** A closed polygon through `points`. */
  polygon(points: readonly Point[], options: SketchOptions = {}): VGroup {
    const o = resolve(options);
    return sketchDrawable(generator().polygon(points.map(toRough), roughOptions(o)), o);
  },

  /** An open polyline through `points`. */
  polyline(points: readonly Point[], options: SketchOptions = {}): VGroup {
    const o = resolve(options);
    return sketchDrawable(generator().linearPath(points.map(toRough), roughOptions(o)), o);
  },

  /**
   * An arc of `radius` around `center`, from `startAngle` over `angle` radians
   * (counterclockwise when positive). A filled arc is drawn as a pie slice.
   */
  arc(center: Point, radius: number, startAngle: number, angle: number, options: SketchOptions = {}): VGroup {
    const o = resolve(options);
    const [cx, cy] = toRough(center);
    // Angles are measured clockwise in the y-down space of Rough.js.
    const a = -startAngle;
    const b = -(startAngle + angle);
    const diameter = 2 * radius * SKETCH_SCALE;
    const drawable = generator().arc(cx, cy, diameter, diameter, Math.min(a, b), Math.max(a, b), o.fillOpacity > 0, roughOptions(o));
    return sketchDrawable(drawable, o);
  },

  /** A straight line from `start` to `end`. */
  line(start: Point, end: Point, options: SketchOptions = {}): VGroup {
    const o = resolve(options);
    const [x1, y1] = toRough(start);
    const [x2, y2] = toRough(end);
    return sketchDrawable(generator().line(x1, y1, x2, y2, roughOptions(o)), o);
  },

  /** An arrow from `start` to `end` with a filled triangular tip (`tipWidth` is the half-width). */
  arrow(start: Point, end: Point, options: SketchOptions = {}, tipLength = 0.3, tipWidth = 0.1): VGroup {
    const o = resolve(options);
    const delta = vector(start, end);
    const length = Math.hypot(delta[0], delta[1]);
    if (length < 1e-9) throw new Error('Arrow endpoints must be distinct');
    const unit = [delta[0] / length, delta[1] / length];
    const tip = Math.min(tipLength, length / 2);
    const base = [end[0] - unit[0] * tip, end[1] - unit[1] * tip];
    const perpendicular = [-unit[1] * tipWidth, unit[0] * tipWidth];
    const shaftEnd = [end[0] - unit[0] * tip * 0.8, end[1] - unit[1] * tip * 0.8];
    const [x1, y1] = toRough(start);
    const [x2, y2] = toRough(shaftEnd);
    const group = sketchDrawable(generator().line(x1, y1, x2, y2, roughOptions(o)), o);
    const corners = [end, [base[0] + perpendicular[0], base[1] + perpendicular[1]], [base[0] - perpendicular[0], base[1] - perpendicular[1]]];
    const head: ResolvedSketch = { ...o, fillColor: o.color, fillOpacity: 1, fillStyle: 'solid', roughness: o.roughness * 0.6 };
    return addDrawable(group, generator().polygon(corners.map(toRough), roughOptions(head)), head);
  },

  /**
   * A curly brace spanning `length` horizontally with its tip pointing down
   * and its open side on y = 0; rotate it to brace other sides.
   */
  brace(length: number, depth = 0.3, options: SketchOptions = {}): VGroup {
    const o = resolve({ ...options, fillOpacity: 0 });
    return sketchDrawable(generator().path(bracePath(length, Math.min(depth, length / 2)), roughOptions(o)), o);
  },

  /** Any SVG path data, with coordinates in logical units (y up). */
  path(d: string, options: SketchOptions = {}): VGroup {
    const o = resolve(options);
    const subpaths = parseSVGPathData(d).map((subpath) => subpath.map(([x, y]) => toRough([x, y])));
    return sketchDrawable(generator().path(curvesToPath(subpaths), roughOptions(o)), o);
  },

  /** A hand-drawn rendition of an existing vector mobject's own curves. */
  of(vmob: VMobject, options: SketchOptions = {}): VGroup {
    const o = resolve(options);
    const group = sketchDrawable(generator().path(pathDataOf(vmob), roughOptions(o)), o);
    (group as OutlineMobject).markupOutline = vmob;
    return group;
  },
};
