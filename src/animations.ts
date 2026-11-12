/**
 * Animations the markup can request by name: property animations (move,
 * rotate, scale, opacity, color), named effects, and entrance/exit styles.
 * They are ordinary engine animations, so clips, snapshots and replay treat
 * them like fades.
 */
import {
  Animation, ApplyWave, Circumscribe, Create, DrawBorderThenFill, FadeIn, FadeOut, Flash, FocusOn, GrowFromCenter, Indicate,
  ShrinkToCenter, Uncreate, VMobject, Wiggle, Write, type Mobject,
  easeInOutSine, easeInSine, easeOutSine, linear, rushFrom, rushInto, smooth, thereAndBack,
} from 'manim-web';
import type { Vec3 } from './geometry';

export type RateFunction = (t: number) => number;

/** Rate functions addressable from markup (`rate=`). */
export const RATE_FUNCTIONS: Record<string, RateFunction> = {
  smooth, linear, rush_into: rushInto, rush_from: rushFrom, there_and_back: thereAndBack,
  ease_in: easeInSine, ease_out: easeOutSine, ease_in_out: easeInOutSine,
};

export interface AnimationTiming {
  duration?: number;
  rateFunc?: RateFunction;
}

function timing(options: AnimationTiming): AnimationTiming {
  const result: AnimationTiming = {};
  if (options.duration !== undefined) result.duration = options.duration;
  if (options.rateFunc !== undefined) result.rateFunc = options.rateFunc;
  return result;
}

export interface PropertyTargets {
  /** Translation applied over the animation. */
  shift?: [number, number];
  /** Rotation about the center, in radians, applied over the animation. */
  rotate?: number;
  /** Scale factor about the center, applied over the animation. */
  scale?: number;
  /** Final uniform opacity. */
  opacity?: number;
  /** Final color of every leaf. */
  color?: string;
}

function hexToRgb(color: string): [number, number, number] {
  const hex = color.replace('#', '');
  const digits = hex.length === 3 ? hex.split('').map((d) => d + d).join('') : hex;
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) || 0) as [number, number, number];
}

function lerpColor(from: string, to: string, alpha: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return '#' + a.map((c, i) => Math.round(c + (b[i] - c) * alpha).toString(16).padStart(2, '0')).join('').toUpperCase();
}

interface OpacityState { opacity: number; fill: number }

/** Interpolate position, rotation, scale, opacity and color from the state at `begin()`. */
export class PropertyAnimation extends Animation {
  private _startCenter: Vec3 = [0, 0, 0];
  private _rotated = 0;
  private _scaled = 1;
  private _opacities = new Map<Mobject, OpacityState>();
  private _colors = new Map<Mobject, string>();
  private _rootOpacity = 1;

  constructor(mobject: Mobject, readonly targets: PropertyTargets, options: AnimationTiming = {}) {
    super(mobject, { rateFunc: smooth, ...timing(options) });
  }

  override begin(): void {
    super.begin();
    this._startCenter = this.mobject.getCenter();
    this._rotated = 0;
    this._scaled = 1;
    this._opacities.clear();
    this._colors.clear();
    this._rootOpacity = this.mobject.opacity > 0 ? this.mobject.opacity : 1;
    for (const member of this.mobject.getFamily()) {
      this._opacities.set(member, { opacity: member.opacity, fill: member.fillOpacity });
      if (member.children.length === 0) this._colors.set(member, member.color);
    }
  }

  interpolate(alpha: number): void {
    const t = this.targets;
    const mobject = this.mobject;
    if (t.shift) {
      mobject.moveTo([this._startCenter[0] + t.shift[0] * alpha, this._startCenter[1] + t.shift[1] * alpha, this._startCenter[2]]);
    }
    if (t.rotate) {
      const want = t.rotate * alpha;
      mobject.rotate(want - this._rotated);
      this._rotated = want;
    }
    if (t.scale !== undefined && t.scale !== 1) {
      const want = 1 + (t.scale - 1) * alpha;
      mobject.scale(want / this._scaled);
      this._scaled = want;
    }
    if (t.opacity !== undefined) {
      const factor = 1 + (t.opacity / this._rootOpacity - 1) * alpha;
      for (const [member, start] of this._opacities) {
        member.opacity = start.opacity * factor;
        if (member instanceof VMobject) member.setFillOpacity(start.fill * factor);
      }
    }
    if (t.color) {
      for (const [member, start] of this._colors) member.setColor(lerpColor(start, t.color, alpha));
    }
  }

  override finish(): void {
    this.interpolate(1);
    super.finish();
  }
}

export interface TrembleOptions extends AnimationTiming {
  /** Largest displacement of a point, in logical units; 0.04 by default. */
  amplitude?: number;
  /** How many times per second the points jump to new positions; 12 by default. */
  rate?: number;
  /** Seed of the random displacements; the same seed replays the same jitter. */
  seed?: number;
}

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(...values: number[]): number {
  let h = 2166136261;
  for (const value of values) {
    h ^= value & 0xffff;
    h = Math.imul(h, 16777619);
    h ^= value >>> 16;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Size of the random displacement lattice in logical units: nearby points move together. */
const TREMBLE_CELL = 0.3;

interface TrembleState {
  points: number[][];
  lengths: number[] | undefined;
}

/**
 * Make the control points of every vector member of a mobject vibrate: a few
 * times per second each point jumps to a new nearby position, with nearby
 * points moving together so that outlines wobble as if drawn by an unsteady
 * hand. The geometry is restored exactly when the animation ends.
 */
export class Tremble extends Animation {
  /** Random motion has no meaningful reverse; backward navigation jumps over it. */
  readonly irreversible = true;
  readonly amplitude: number;
  readonly rate: number;
  readonly seed: number;
  private readonly _states = new Map<VMobject, TrembleState>();
  private _frame = -1;

  constructor(mobject: Mobject, options: TrembleOptions = {}) {
    super(mobject, { duration: options.duration ?? 1, rateFunc: linear });
    this.amplitude = options.amplitude ?? 0.04;
    this.rate = options.rate ?? 12;
    this.seed = options.seed ?? 1;
    if (!Number.isFinite(this.amplitude) || this.amplitude < 0) throw new Error('Tremble amplitude must be a nonnegative number');
    if (!Number.isFinite(this.rate) || this.rate <= 0) throw new Error('Tremble rate must be positive');
  }

  override begin(): void {
    super.begin();
    this._states.clear();
    this._frame = -1;
    for (const member of this.mobject.getFamily()) {
      if (member instanceof VMobject && member.hasOwnPoints()) {
        this._states.set(member, { points: member.getLocalPoints(), lengths: member.getSubpathLengths() });
      }
    }
  }

  private _restore(): void {
    for (const [member, state] of this._states) {
      member.setPoints(state.points.map((p) => [...p]));
      member.setBaseSubpathLengths(state.lengths);
    }
  }

  interpolate(alpha: number): void {
    const frame = Math.floor(alpha * this.duration * this.rate);
    if (frame === this._frame) return;
    this._frame = frame;
    if (alpha >= 1) {
      this._restore();
      return;
    }
    const lattice = new Map<number, [number, number]>();
    const displacement = (ix: number, iy: number): [number, number] => {
      const key = ix * 73856093 + iy;
      let value = lattice.get(key);
      if (!value) {
        const random = mulberry(hash(this.seed, frame, ix, iy));
        value = [random() * 2 - 1, random() * 2 - 1];
        lattice.set(key, value);
      }
      return value;
    };
    const smooth01 = (t: number) => t * t * (3 - 2 * t);
    const offset = (x: number, y: number): [number, number] => {
      const gx = x / TREMBLE_CELL;
      const gy = y / TREMBLE_CELL;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const tx = smooth01(gx - ix);
      const ty = smooth01(gy - iy);
      const result: [number, number] = [0, 0];
      for (const [cx, cy, weight] of [[ix, iy, (1 - tx) * (1 - ty)], [ix + 1, iy, tx * (1 - ty)], [ix, iy + 1, (1 - tx) * ty], [ix + 1, iy + 1, tx * ty]]) {
        const d = displacement(cx, cy);
        result[0] += d[0] * weight;
        result[1] += d[1] * weight;
      }
      return [result[0] * this.amplitude, result[1] * this.amplitude];
    };
    for (const [member, state] of this._states) {
      // The lattice is sampled near world positions, so separate shapes never wobble in unison.
      const center = member.getCenter();
      const points = state.points.map((p) => {
        const [dx, dy] = offset(p[0] + center[0], p[1] + center[1]);
        return [p[0] + dx, p[1] + dy, p[2]];
      });
      member.setPoints(points);
      member.setBaseSubpathLengths(state.lengths);
    }
  }

  override finish(): void {
    this._restore();
    super.finish();
  }

  override reset(): void {
    if (this._states.size) this._restore();
    super.reset();
  }
}

/** Effects addressable from markup (`[[effect: name #id ...]]`). */
export const EFFECT_NAMES = ['indicate', 'wiggle', 'circumscribe', 'flash', 'focus', 'grow', 'shrink', 'write', 'create', 'uncreate', 'draw', 'wave'] as const;
export type EffectName = (typeof EFFECT_NAMES)[number];

export interface EffectOptions extends AnimationTiming {
  color?: string;
  scale?: number;
}

export function makeEffect(name: string, mobject: Mobject, options: EffectOptions = {}): Animation {
  const base = timing(options);
  const colored = options.color ? { color: options.color } : {};
  switch (name as EffectName) {
    case 'indicate': return new Indicate(mobject, { ...base, ...colored, ...(options.scale ? { scaleFactor: options.scale } : {}) });
    case 'wiggle': return new Wiggle(mobject, { ...base, ...(options.scale ? { scaleFactor: options.scale } : {}) });
    case 'circumscribe': return new Circumscribe(mobject, { ...base, ...colored });
    case 'flash': return new Flash(mobject, { ...base, ...colored, ...(options.scale ? { flashRadius: options.scale } : {}) });
    case 'focus': return new FocusOn(mobject, { ...base, ...colored });
    case 'grow': return new GrowFromCenter(mobject, base);
    case 'shrink': return new ShrinkToCenter(mobject, base);
    case 'write': return new Write(mobject, base);
    case 'create': return new Create(mobject, base);
    case 'uncreate': return new Uncreate(mobject, base);
    case 'draw': return new DrawBorderThenFill(mobject, base);
    case 'wave': return new ApplyWave(mobject, { ...base, ...(options.scale ? { amplitude: options.scale } : {}) });
    default: throw new Error(`Unknown effect ${JSON.stringify(name)}`);
  }
}

/** Entrance styles for `enter=` and exit styles for `exit=`. */
export const ENTER_STYLES = ['fade', 'grow', 'write', 'create', 'draw'] as const;
export const EXIT_STYLES = ['fade', 'shrink', 'uncreate'] as const;

export function enterAnimation(style: string, mobject: Mobject, options: AnimationTiming = {}): Animation {
  if (style === 'fade' || !style) return new FadeIn(mobject, timing(options));
  return makeEffect(style, mobject, options);
}

export function exitAnimation(style: string, mobject: Mobject, options: AnimationTiming = {}): Animation {
  if (style === 'fade' || !style) return new FadeOut(mobject, timing(options));
  return makeEffect(style, mobject, options);
}
