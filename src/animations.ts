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
