/**
 * Slide contexts, resumable tree traversal, camera focus, clip recording and
 * state snapshots.
 *
 * The presenter executes the complete slide program once, instantly, while
 * recording one `Clip` per authored stop. Each clip holds the operations
 * (plays, waits, camera focus moves) that produced it, and the history keeps
 * a delta snapshot of every settled state. The player later restores a
 * snapshot and replays a clip's operations in real time, so navigation never
 * reruns author programs and needs no video files.
 */
import * as THREE from 'three';
import { Animation as BaseAnimation, linear as linearRate } from 'manim-web';
import {
  Animation,
  AnimationGroup,
  Mobject,
  Rectangle,
  smooth,
  type RateFunction,
} from 'manim-web';
import { LocalScene, Display } from './display';
import {
  Slide,
  PlaceholderSlide,
  TRANSITION_MODES,
  type SourceLocation,
  type TransitionMode,
  Visit,
  buildPlaceholder,
  startingSlide,
  viewportCorners,
  walk,
} from './slides';
import { Transform, point, positive, type Vec3 } from './geometry';
import { coordinateGrid } from './guides';
import { slideKeys } from './position';
import { captureMember, memberChanged, restoreMember, type MemberState } from './snapshot';
import { DISPLAY_SLIDE_KEY, installPatches } from './patches';

installPatches();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PresenterConfigOptions {
  /** Seconds used for each animated camera move. Zero positions the camera immediately. */
  transitionTime?: number;
  /** `zoom` (default) animates the camera between slides; `cut` replaces the view at once, like
   * turning a PDF page. A slide's own `transition` overrides it for the moves into and out of it. */
  transition?: TransitionMode;
  /** Camera width multiplier around a focused slide; at least one. */
  padding?: number;
  /** Accepted for compatibility with older deck configurations; the browser always shows the surroundings. */
  renderCanvas?: readonly [number, number];
  pauseOnEntry?: boolean;
  pauseOnReturn?: boolean;
  /** Retained for compatibility; live playback needs no still hold. */
  stillTime?: number;
  showSlideBorders?: boolean;
  slideBorderColor?: string;
  slideBorderWidth?: number;
  showSlideGrid?: boolean;
  /** Play a stop's animations backwards when navigating to the previous stop (default true). */
  reversePlayback?: boolean;
  /** Children start invisible and fade in when first entered (default true); false shows every slide's content from the start. */
  revealOnEntry?: boolean;
}

/** Timing and camera policy shared by every slide in one deck. */
export class PresenterConfig {
  readonly transitionTime: number;
  readonly transition: TransitionMode;
  readonly padding: number;
  readonly renderCanvas: readonly [number, number];
  readonly pauseOnEntry: boolean;
  readonly pauseOnReturn: boolean;
  readonly stillTime: number;
  readonly showSlideBorders: boolean;
  readonly slideBorderColor: string;
  readonly slideBorderWidth: number;
  readonly showSlideGrid: boolean;
  readonly reversePlayback: boolean;
  readonly revealOnEntry: boolean;

  constructor(options: PresenterConfigOptions = {}) {
    this.reversePlayback = options.reversePlayback ?? true;
    this.revealOnEntry = options.revealOnEntry ?? true;
    this.transitionTime = options.transitionTime ?? 0.7;
    if (!Number.isFinite(this.transitionTime) || this.transitionTime < 0) {
      throw new Error('transitionTime must be finite and nonnegative');
    }
    this.transition = options.transition ?? 'zoom';
    if (!TRANSITION_MODES.includes(this.transition)) throw new Error('transition must be zoom or cut');
    this.padding = positive(options.padding ?? 1, 'padding');
    if (this.padding < 1) throw new Error('padding must be at least one');
    const canvas = options.renderCanvas ?? [1.4, 1];
    if (canvas.length !== 2) throw new Error('renderCanvas must contain two scale factors');
    if (positive(canvas[0], 'renderCanvas width') < 1 || positive(canvas[1], 'renderCanvas height') < 1) {
      throw new Error('renderCanvas factors must be at least one');
    }
    this.renderCanvas = [Number(canvas[0]), Number(canvas[1])];
    this.pauseOnEntry = options.pauseOnEntry ?? true;
    this.pauseOnReturn = options.pauseOnReturn ?? true;
    this.stillTime = positive(options.stillTime ?? 0.1, 'stillTime');
    this.showSlideBorders = options.showSlideBorders ?? false;
    this.slideBorderColor = options.slideBorderColor ?? '#FC6255';
    this.slideBorderWidth = positive(options.slideBorderWidth ?? 3, 'slideBorderWidth');
    this.showSlideGrid = options.showSlideGrid ?? false;
  }
}

export interface CameraState {
  center: Vec3;
  width: number;
}

export interface StopOptions {
  /** Replay the following clip until the viewer advances. */
  loop?: boolean;
  /** Advance automatically when the following clip finishes. */
  autoNext?: boolean;
  notes?: string;
  playbackRate?: number;
}

export interface PlayOptions {
  /** Duration applied to every animation of the call, in seconds. */
  runTime?: number;
  rateFunc?: RateFunction;
}

export type ProgressEvent = { phase: string; index?: number; total?: number; id?: string | number; name?: string; placeholder?: boolean };

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** One replayable step of a clip. `alpha` is the linear time fraction. */
export interface Op {
  readonly kind: 'play' | 'focus' | 'wait';
  readonly duration: number;
  readonly slide: Slide;
  /** Whether `interpolate` may be driven backwards (false for updater-driven waits and media). */
  readonly reversible: boolean;
  /** Membership of the active slide when the operation started. */
  membership: Mobject[];
  begin(): void;
  interpolate(alpha: number): void;
  update(dt: number): void;
  finish(): void;
  cleanUp(): void;
  touched(): Mobject[];
  reset(): void;
}

function flattenAnimations(animations: Animation[]): Animation[] {
  const result: Animation[] = [];
  for (const animation of animations) {
    result.push(animation);
    if (animation instanceof AnimationGroup) result.push(...flattenAnimations(animation.animations));
  }
  return result;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Start an animation after `delay` seconds inside a parallel play call. */
export class DelayedAnimation extends BaseAnimation {
  constructor(readonly inner: BaseAnimation, readonly delay: number) {
    super(inner.mobject, { duration: Math.max(0, delay) + inner.duration, rateFunc: linearRate });
    this.remover = inner.remover;
  }

  override begin(): void {
    this.inner.begin();
  }

  interpolate(alpha: number): void {
    const elapsed = alpha * this.duration;
    const local = this.inner.duration > 0 ? clamp01((elapsed - this.delay) / this.inner.duration) : elapsed >= this.delay ? 1 : 0;
    this.inner.interpolateAt(local);
  }

  override finish(): void {
    this.inner.finish();
  }

  override cleanUpFromScene(scene: Parameters<BaseAnimation['cleanUpFromScene']>[0]): void {
    this.inner.cleanUpFromScene(scene);
  }

  override reset(): void {
    this.inner.reset();
  }
}

/** Play ordinary engine animations against one slide's local objects. */
export class PlayOp implements Op {
  readonly kind = 'play';
  readonly duration: number;
  readonly slide: Slide;
  readonly reversible: boolean;
  membership: Mobject[] = [];
  private readonly _all: Animation[];

  constructor(readonly ctx: SlideContext, readonly animations: Animation[]) {
    this.slide = ctx.slide;
    this._all = flattenAnimations(animations);
    this.duration = Math.max(0, ...animations.map((animation) => animation.duration));
    this.reversible = this._all.every((animation) => !(animation as Animation & { irreversible?: boolean }).irreversible);
  }

  touched(): Mobject[] {
    return this._all.filter((a) => !(a instanceof AnimationGroup)).map((a) => a.mobject);
  }

  begin(): void {
    // Sync geometry first so animations that inspect Three.js primitives see them.
    for (const animation of this._all) {
      if (!(animation instanceof AnimationGroup) && animation.mobject._dirty) animation.mobject._syncToThree();
    }
    for (const animation of this.animations) animation.begin();
    const family = new Set(this.ctx.getMobjectFamilyMembers());
    for (const animation of this._all) {
      if (animation instanceof AnimationGroup) continue;
      if (!family.has(animation.mobject)) {
        this.ctx.add(animation.mobject);
        for (const member of animation.mobject.getFamily()) family.add(member);
      }
    }
    this.ctx.sync();
  }

  interpolate(alpha: number): void {
    const elapsed = alpha * this.duration;
    for (const animation of this.animations) {
      const local = animation.duration > 0 ? clamp01(elapsed / animation.duration) : 1;
      animation.interpolateAt(local);
    }
    this.ctx.sync();
  }

  update(dt: number): void {
    this.ctx.updateMobjects(dt);
  }

  finish(): void {
    for (const animation of this.animations) animation.finish();
    this.ctx.updateMobjects(0);
    this.ctx.sync();
  }

  cleanUp(): void {
    for (const animation of this._all) animation.cleanUpFromScene(this.ctx);
    this.ctx.sync();
  }

  reset(): void {
    for (const animation of this.animations) animation.reset();
  }
}

/** Hold the current local state while updaters advance. */
export class WaitOp implements Op {
  readonly kind = 'wait';
  readonly slide: Slide;
  readonly reversible = false;
  membership: Mobject[] = [];

  constructor(readonly ctx: SlideContext, readonly duration: number) {
    this.slide = ctx.slide;
  }

  touched(): Mobject[] {
    return this.ctx.mobjects.filter((mob) => mob.getFamily().some((member) => member.hasUpdaters()));
  }
  begin(): void {}
  interpolate(): void {
    this.ctx.sync();
  }
  update(dt: number): void {
    this.ctx.updateMobjects(dt);
  }
  finish(): void {
    this.ctx.sync();
  }
  cleanUp(): void {}
  reset(): void {}
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Move the camera and fade first-entry content and decorations between slides. */
export class FocusOp implements Op {
  readonly kind = 'focus';
  readonly reversible = true;
  readonly duration: number;
  readonly slide: Slide;
  membership: Mobject[] = [];
  private readonly _gridOutTime: number;
  private readonly _gridInTime: number;
  private readonly _contentTime: number;
  private _startCamera: CameraState = { center: [0, 0, 0], width: 1 };
  private _sourceGrid = 0;
  private _destinationGrid = 0;
  private _destinationContent = 1;

  constructor(
    readonly presenter: Presenter,
    readonly source: SlideContext,
    readonly destination: SlideContext,
    readonly target: CameraState,
    readonly cameraTime: number,
  ) {
    this.slide = destination.slide;
    this._gridOutTime = source.display.gridOpacity > 0 ? source.slide.fadeTime : 0;
    this._gridInTime = destination.display.backgrounds.length > 0 ? destination.slide.fadeTime : 0;
    this._contentTime = destination.display.contentOpacity < 1 ? destination.slide.fadeTime : 0;
    this.duration = Math.max(cameraTime, this._gridOutTime + this._gridInTime, this._contentTime);
  }

  touched(): Mobject[] {
    return [];
  }

  begin(): void {
    const camera = this.presenter.camera;
    this._startCamera = { center: [...camera.center] as Vec3, width: camera.width };
    this._sourceGrid = this.source.display.gridOpacity;
    this._destinationGrid = this.destination.display.gridOpacity;
    this._destinationContent = this.destination.display.contentOpacity;
  }

  private static _opacity(start: number, end: number, elapsed: number, duration: number): number {
    if (duration === 0) return end;
    return start + (end - start) * smooth(clamp01(elapsed / duration));
  }

  interpolate(alpha: number): void {
    const elapsed = alpha * this.duration;
    const t = this.cameraTime > 0 ? smooth(clamp01(elapsed / this.cameraTime)) : 1;
    this.presenter.camera = {
      center: [
        lerp(this._startCamera.center[0], this.target.center[0], t),
        lerp(this._startCamera.center[1], this.target.center[1], t),
        lerp(this._startCamera.center[2], this.target.center[2], t),
      ],
      width: lerp(this._startCamera.width, this.target.width, t),
    };
    const source = this.source.display;
    const destination = this.destination.display;
    source.gridOpacity = FocusOp._opacity(this._sourceGrid, 0, elapsed, this._gridOutTime);
    destination.gridOpacity = FocusOp._opacity(
      this._destinationGrid,
      destination.backgrounds.length > 0 ? 1 : 0,
      elapsed - this._gridOutTime,
      this._gridInTime,
    );
    destination.contentOpacity = FocusOp._opacity(this._destinationContent, 1, elapsed, this._contentTime);
    this.source.display.sync(this.source.transform);
    this.destination.display.sync(this.destination.transform);
  }

  update(): void {}

  finish(): void {
    this.interpolate(1);
  }

  cleanUp(): void {}
  reset(): void {}
}

/** Execute an operation to completion without rendering. */
export function runInstantly(op: Op): void {
  op.begin();
  if (op.kind === 'wait' && op.duration > 0) op.update(op.duration);
  op.interpolate(1);
  op.finish();
  op.cleanUp();
}

// ---------------------------------------------------------------------------
// Clips and history
// ---------------------------------------------------------------------------

export type ClipKind = 'entry' | 'program' | 'return';

/** The recorded operations between two authored stops. */
export class Clip {
  index = -1;
  slide: Slide | null = null;
  kind: ClipKind = 'program';
  loop = false;
  autoNext = false;
  notes = '';
  playbackRate = 1;
  /** The source line this clip's stop shows, when the deck was written in Markdown; see `SlideContext.source`. */
  source: SourceLocation | null = null;
  readonly ops: Op[] = [];

  constructor(options: StopOptions = {}) {
    this.loop = Boolean(options.loop);
    this.autoNext = Boolean(options.autoNext);
    this.notes = options.notes ?? '';
    this.playbackRate = positive(options.playbackRate ?? 1, 'playbackRate');
  }

  get duration(): number {
    return this.ops.reduce((sum, op) => sum + op.duration, 0);
  }
}

interface SlideRecord {
  members: Mobject[];
  backgrounds: Mobject[];
  contentOpacity: number;
  gridOpacity: number;
}

interface Snapshot {
  index: number;
  camera: CameraState;
  focused: Slide | null;
  slides: Map<Slide, SlideRecord>;
}

/** Clip list, per-stop delta snapshots and restoration by identity. */
export class History {
  readonly clips: Clip[] = [];
  private _open = new Clip();
  private readonly _snapshots = new Map<number, Snapshot>();
  private readonly _states = new Map<Mobject, Array<[number, MemberState]>>();
  private readonly _latest = new Map<Mobject, MemberState>();
  private readonly _touched = new Set<Mobject>();

  constructor(private readonly presenter: Presenter) {}

  get openClip(): Clip {
    return this._open;
  }

  get openEmpty(): boolean {
    return this._open.ops.length === 0;
  }

  mark(slide: Slide, kind: ClipKind): void {
    this._open.slide = slide;
    this._open.kind = kind;
  }

  touch(...mobjects: Mobject[]): void {
    for (const mob of mobjects) this._touched.add(mob);
  }

  /** Record and execute one operation inside the open clip. */
  record(op: Op): void {
    const ctx = this.presenter.contexts.get(op.slide);
    op.membership = ctx ? [...ctx.mobjects] : [];
    runInstantly(op);
    this._open.ops.push(op);
    for (const mob of op.touched()) this._touched.add(mob);
  }

  /** Close the open clip at a stop and configure the following clip. */
  close(options: StopOptions = {}): Clip {
    const clip = this._open;
    clip.index = this.clips.length;
    this.clips.push(clip);
    this.snapshot(clip.index);
    this._open = new Clip(options);
    this._open.slide = clip.slide;
    return clip;
  }

  /** Discard an empty trailing clip at the end of traversal, keeping a nonempty one. */
  finish(): void {
    if (!this.openEmpty) this.close();
  }

  /** The most recently closed clip, available only while no new content was recorded. */
  completedClip(): Clip {
    if (!this.openEmpty || this.clips.length === 0) throw new Error('Clip options require a completed recorded stop');
    return this.clips[this.clips.length - 1];
  }

  /** Capture the settled state after clip `index` (`-1` is the initial state). */
  snapshot(index: number): void {
    const changed = new Set<Mobject>();
    for (const mob of this._touched) for (const member of mob.getFamily()) changed.add(member);
    this._touched.clear();
    const slides = new Map<Slide, SlideRecord>();
    for (const [slide, ctx] of this.presenter.contexts) {
      slides.set(slide, {
        members: [...ctx.mobjects],
        backgrounds: [...ctx.display.backgrounds],
        contentOpacity: ctx.display.contentOpacity,
        gridOpacity: ctx.display.gridOpacity,
      });
      for (const root of ctx.display.members()) {
        for (const member of root.getFamily()) {
          const previous = this._latest.get(member);
          if (previous && !changed.has(member) && !memberChanged(member, previous)) continue;
          const state = captureMember(member);
          this._latest.set(member, state);
          let list = this._states.get(member);
          if (!list) this._states.set(member, (list = []));
          list.push([index, state]);
        }
      }
    }
    const camera = this.presenter.camera;
    this._snapshots.set(index, {
      index,
      camera: { center: [...camera.center] as Vec3, width: camera.width },
      focused: this.presenter.focused?.slide ?? null,
      slides,
    });
  }

  hasSnapshot(index: number): boolean {
    return this._snapshots.has(index);
  }

  private _stateAt(member: Mobject, index: number): MemberState | null {
    const list = this._states.get(member);
    if (!list) return null;
    let low = 0;
    let high = list.length - 1;
    let found: MemberState | null = null;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (list[mid][0] <= index) {
        found = list[mid][1];
        low = mid + 1;
      } else high = mid - 1;
    }
    return found;
  }

  /** Restore the settled state after clip `index` onto the live objects. */
  restore(index: number): void {
    const snapshot = this._snapshots.get(index);
    if (!snapshot) throw new Error(`No snapshot for clip ${index}`);
    const presenter = this.presenter;
    presenter.camera = { center: [...snapshot.camera.center] as Vec3, width: snapshot.camera.width };
    const seen = new Set<Mobject>();
    for (const [slide, record] of snapshot.slides) {
      const ctx = presenter.contexts.get(slide);
      if (!ctx) continue;
      ctx.mobjects = [...record.members];
      ctx.display.backgrounds = [...record.backgrounds];
      ctx.display.contentOpacity = record.contentOpacity;
      ctx.display.gridOpacity = record.gridOpacity;
      for (const root of ctx.display.members()) {
        for (const member of root.getFamily()) {
          if (seen.has(member)) continue;
          seen.add(member);
          const state = this._stateAt(member, index);
          if (state) restoreMember(member, state);
        }
      }
    }
    presenter.focused = snapshot.focused ? presenter.contexts.get(snapshot.focused) ?? null : null;
    presenter.recomputeTransforms();
  }
}

// ---------------------------------------------------------------------------
// Slide context
// ---------------------------------------------------------------------------

type Phase = 'build' | 'ready' | 'program' | 'done' | 'skipped';

interface AsyncLike {
  waitForRender?: () => Promise<void>;
  waitForLoad?: () => Promise<void>;
}

/** The scene-like API passed to `build` and `construct`. */
export class SlideContext extends LocalScene {
  readonly presenter: Presenter;

  /** The deck's text color, for engine objects created in code (engine text defaults to white). */
  get foreground(): string {
    return this.presenter.foreground;
  }
  readonly slide: Slide;
  transform: Transform;
  readonly display: Display;
  /** Free-form dictionary for objects shared between build and construct. */
  objects: Record<string, unknown> = {};
  /** @internal */
  placement: Vec3[] | null = null;
  /** @internal */
  program: Iterator<Visit, unknown, unknown> | AsyncIterator<Visit, unknown, unknown> | null = null;
  /** @internal */
  visited = false;
  /** @internal */
  returnSkipped = false;
  /** @internal */
  autoChild: Slide | null = null;
  /** @internal */
  phase: Phase = 'build';
  private _canvasBorder: Rectangle | null = null;

  constructor(presenter: Presenter, slide: Slide, transform: Transform) {
    super();
    this.presenter = presenter;
    this.slide = slide;
    this.transform = transform;
    const config = presenter.config;
    if (config.showSlideBorders) {
      this._canvasBorder = new Rectangle({
        width: slide.width,
        height: slide.height,
        fillOpacity: 0,
        color: config.slideBorderColor,
        strokeWidth: config.slideBorderWidth,
      });
    }
    const backgrounds = config.showSlideGrid ? [coordinateGrid(slide.width, slide.height)] : [];
    this.display = new Display(this, {
      contentOpacity: slide.parent === null || slide instanceof PlaceholderSlide || slide.preview || !config.revealOnEntry ? 1 : 0,
      gridOpacity: slide.parent === null && backgrounds.length ? 1 : 0,
      backgrounds,
      overlays: this._canvasBorder ? [this._canvasBorder] : [],
    });
    this.display.group.userData[DISPLAY_SLIDE_KEY] = slide;
  }

  /** Width of the slide's logical canvas. */
  get width(): number {
    return this.slide.width;
  }

  /** Height of the slide's logical canvas. */
  get height(): number {
    return this.slide.height;
  }

  /** Map a point from this slide's logical coordinates into world space. */
  toWorld(p: ArrayLike<number>): Vec3 {
    return this.transform.apply(point(p));
  }

  /** Map a point from world space into this slide's logical coordinates. */
  toLocal(p: ArrayLike<number>): Vec3 {
    return this.transform.inverse(point(p));
  }

  /** Align a mobject to this logical canvas instead of the engine's global slide. */
  toEdge<M extends Mobject>(mobject: M, direction: ArrayLike<number>, options: { buff?: number } = {}): M {
    const dir = point(direction);
    if (dir[2] !== 0 || (dir[0] === 0 && dir[1] === 0)) {
      throw new Error('Edge direction must lie in the canvas plane and be nonzero');
    }
    const buff = Number(options.buff ?? 0.5);
    if (!Number.isFinite(buff) || buff < 0) throw new Error('buff must be finite and nonnegative');
    const edge = mobject.getEdge(dir);
    const target = [Math.sign(dir[0]) * (this.width / 2 - buff), Math.sign(dir[1]) * (this.height / 2 - buff), 0];
    mobject.shift([dir[0] !== 0 ? target[0] - edge[0] : 0, dir[1] !== 0 ? target[1] - edge[1] : 0, 0]);
    return mobject;
  }

  toCorner<M extends Mobject>(mobject: M, direction: ArrayLike<number>, options: { buff?: number } = {}): M {
    return this.toEdge(mobject, direction, options);
  }

  override add(...mobjects: Mobject[]): this {
    super.add(...mobjects);
    if (this.phase !== 'build') this.sync();
    return this;
  }

  override remove(...mobjects: Mobject[]): this {
    super.remove(...mobjects);
    if (this.phase !== 'build') this.sync();
    return this;
  }

  override replace(oldMobject: Mobject, newMobject: Mobject): this {
    super.replace(oldMobject, newMobject);
    if (this.phase !== 'build') this.sync();
    return this;
  }

  override clear(): this {
    super.clear();
    if (this.phase !== 'build') this.sync();
    return this;
  }

  /** Mark mobjects changed outside animations so snapshots record them. */
  touch(...mobjects: Mobject[]): this {
    this.presenter.history.touch(...mobjects);
    return this;
  }

  /** Update the display and propagate animated viewport placements to descendants. */
  sync(): void {
    this.display.sync(this.transform);
    for (const child of this.slide._children) {
      const childCtx = this.presenter.contexts.get(child);
      if (!childCtx || !child.viewport) continue;
      const corners = viewportCorners(child.viewport);
      const placement = childCtx.placement;
      const same =
        placement !== null && corners.every((corner, i) => corner.every((value, j) => value === placement[i][j]));
      if (!same) this.presenter.reposition(child, corners);
    }
  }

  /** Wait for text, math, SVG and image resources of local members. */
  async awaitAssets(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const root of this.display.members()) {
      for (const member of root.getFamily()) {
        const asyncMob = member as Mobject & AsyncLike;
        if (typeof asyncMob.waitForRender === 'function') pending.push(asyncMob.waitForRender().catch(() => undefined));
        if (typeof asyncMob.waitForLoad === 'function') pending.push(asyncMob.waitForLoad().catch(() => undefined));
      }
    }
    if (pending.length) await Promise.all(pending);
  }

  private _requireProgram(): void {
    if (this.phase !== 'program' || this.presenter.active !== this) {
      throw new Error('play, wait and stop belong in the active slide\'s construct program');
    }
  }

  /**
   * Play ordinary engine animations in parallel. A trailing options object
   * sets `runTime` and `rateFunc` for every animation of the call.
   */
  async play(...args: Array<Animation | PlayOptions>): Promise<this> {
    this._requireProgram();
    const animations: Animation[] = [];
    let options: PlayOptions = {};
    for (const arg of args) {
      if (arg instanceof Animation) animations.push(arg);
      else if (arg && typeof arg === 'object') options = { ...options, ...arg };
      else throw new TypeError('play accepts animations and one options object');
    }
    if (animations.length === 0) return this;
    for (const animation of animations) {
      if (options.runTime !== undefined) {
        Object.defineProperty(animation, 'duration', { value: positive(options.runTime, 'runTime'), writable: true, configurable: true });
      }
      if (options.rateFunc !== undefined) {
        Object.defineProperty(animation, 'rateFunc', { value: options.rateFunc, writable: true, configurable: true });
      }
      if (!Number.isFinite(animation.duration) || animation.duration < 0) throw new Error('animation duration must be finite');
    }
    this.presenter.history.record(new PlayOp(this, animations));
    await Promise.resolve();
    return this;
  }

  /** Hold the current local state for `duration` seconds. */
  async wait(duration = 1): Promise<this> {
    this._requireProgram();
    this.presenter.history.record(new WaitOp(this, positive(duration, 'wait duration')));
    await Promise.resolve();
    return this;
  }

  /** Record a presentation stop. Options configure the following clip. */
  stop(options: StopOptions = {}): this {
    this._requireProgram();
    this.presenter.boundary(this, 'program', { force: true, options });
    return this;
  }

  nextSlide(options: StopOptions = {}): this {
    return this.stop(options);
  }

  /**
   * Attribute the stop being recorded to a place in the deck's source, for the editor's
   * forward and inverse search. Markup slides call it at every step; a later call before the
   * stop wins.
   */
  source(location: SourceLocation | null): this {
    this.presenter.history.openClip.source = location;
    return this;
  }

  /** The most recently completed clip, for options applied after recording it. */
  completedStop(): Clip {
    this._requireProgram();
    return this.presenter.history.completedClip();
  }

  /** Advance playback automatically after the most recently recorded stop. */
  autoAdvance(): this {
    this.completedStop().autoNext = true;
    return this;
  }

  /** Omit one following markup step, child visit or parent return. */
  skipNext(): this {
    this._requireProgram();
    this.presenter.skipNextPending = true;
    return this;
  }

  /** Return a visit token for a direct child of the active slide. */
  visit(child: Slide): Visit {
    this._requireProgram();
    if (child.parent !== this.slide) throw new Error('visit expects a direct child of the active slide');
    return new Visit(child);
  }
}

// ---------------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------------

export interface PresenterOptions {
  config?: PresenterConfig;
  /** Width over height of the presentation viewport the camera fits. */
  viewportAspect?: number;
  /** The deck's text color, offered to code-authored slides as `ctx.foreground`. */
  foreground?: string;
  progress?: (event: ProgressEvent) => void;
}

function isIterator(value: unknown): value is Iterator<Visit> | AsyncIterator<Visit> {
  return typeof value === 'object' && value !== null && typeof (value as { next?: unknown }).next === 'function';
}

/** Prepare previews once and run a slide tree using parent links. */
export class Presenter {
  readonly config: PresenterConfig;
  readonly viewportAspect: number;
  readonly foreground: string;
  readonly progress: ((event: ProgressEvent) => void) | null;
  readonly contexts = new Map<Slide, SlideContext>();
  readonly history = new History(this);
  /** Three.js root holding every slide's display group in preorder. */
  readonly root3D = new THREE.Group();
  camera: CameraState = { center: [0, 0, 0], width: 16 };
  active: SlideContext | null = null;
  focused: SlideContext | null = null;
  skipNextPending = false;
  root: Slide | null = null;
  startSlide: Slide | null = null;
  selectedRender = false;
  private _renderSlides = new Set<Slide>();
  private readonly _ids = new Map<Slide, number>();
  private _visits = 0;
  private _keys = new Map<Slide, string>();

  constructor(options: PresenterOptions = {}) {
    this.foreground = options.foreground ?? '#000000';
    this.config = options.config ?? new PresenterConfig();
    this.viewportAspect = positive(options.viewportAspect ?? 16 / 9, 'viewportAspect');
    this.progress = options.progress ?? null;
  }

  private _report(phase: string, slide?: Slide, details: Partial<ProgressEvent> = {}): void {
    if (!this.progress) return;
    const event: ProgressEvent = { phase, ...details };
    if (slide) {
      const spec = (slide as Slide & { spec?: { id?: string } }).spec;
      event.id = spec?.id ?? this._ids.get(slide);
      event.name = slide.name;
    }
    this.progress(event);
  }

  frameId(slide: Slide): number {
    const id = this._ids.get(slide);
    if (id === undefined) throw new Error('Unknown slide');
    return id;
  }

  /** Declare topology, resolve selection and prepare render contexts. */
  async prepare(root: Slide): Promise<this> {
    if (this.root !== null) throw new Error('A Presenter can prepare and render only one tree');
    if (!(root instanceof Slide) || root.parent !== null || root._frozen) {
      throw new Error('Presentation root must be an unattached, unused Slide');
    }
    this.root = root;
    const declared = new Set<Slide>();
    for (const slide of walk(root)) {
      slide.declare();
      declared.add(slide);
    }
    startingSlide(root);
    let total = declared.size;
    const countSubtrees = (slides: readonly Slide[]) => slides.reduce((sum, child) => sum + [...walk(child)].length, 0);
    this.selectedRender = [...walk(root)].some((slide) => slide.onlyThis);
    const skipBuilds = this.selectedRender;
    for (const slide of walk(root)) {
      if (!declared.has(slide)) {
        const before = slide.children.length;
        slide.declare();
        declared.add(slide);
        total += countSubtrees(slide.children.slice(before));
      }
      if (this.contexts.has(slide)) throw new Error('A slide cannot be reused in the tree');
      let transform: Transform;
      let corners: Vec3[] | null = null;
      if (slide === root) transform = new Transform();
      else {
        corners = viewportCorners(slide.viewport as Rectangle);
        const parentCtx = this.contexts.get(slide.parent as Slide) as SlideContext;
        transform = parentCtx.transform.compose(Transform.fit(corners, slide.width, slide.height));
      }
      const ctx = new SlideContext(this, slide, transform);
      ctx.placement = corners;
      this.contexts.set(slide, ctx);
      this._ids.set(slide, this._ids.size);
      this._report('build', slide, {
        index: this._ids.size,
        total,
        placeholder: slide instanceof PlaceholderSlide || (skipBuilds && !slide.onlyThis),
      });
      const before = slide.children.length;
      if (skipBuilds && !slide.onlyThis) {
        buildPlaceholder(ctx, slide instanceof PlaceholderSlide ? slide.label : `${slide.name}\nNot selected`);
      } else {
        await slide.build(ctx);
      }
      total += countSubtrees(slide.children.slice(before));
      // Viewports belong to the parent canvas; they are ordinary animatable local objects.
      ctx.add(...slide._children.map((child) => child.viewport as Rectangle));
      await ctx.awaitAssets();
      slide._frozen = true;
      ctx.phase = 'ready';
      ctx.display.sync(transform);
      this.root3D.add(ctx.display.group);
    }
    this._renderSlides = new Set([...walk(root)].filter((slide) => slide.onlyThis));
    this.selectedRender = this._renderSlides.size > 0;
    if (this.selectedRender) {
      for (const [slide, ctx] of this.contexts) {
        if (this._renderSlides.has(slide)) continue;
        if (!skipBuilds) {
          ctx.clear();
          buildPlaceholder(ctx, slide instanceof PlaceholderSlide ? slide.label : `${slide.name}\nNot selected`);
          ctx.add(...slide._children.map((child) => child.viewport as Rectangle));
        }
        ctx.display.contentOpacity = 1;
        ctx.display.gridOpacity = 0;
        ctx.display.sync(ctx.transform);
      }
    }
    this.startSlide = startingSlide(root);
    if (this.startSlide && !this.enabled(this.startSlide)) throw new Error('startHere slide is excluded by onlyThis');
    this._keys = slideKeys(root);
    this._report('prepared', undefined, { total: this.contexts.size });
    return this;
  }

  enabled(slide: Slide): boolean {
    return !this.selectedRender || this._renderSlides.has(slide);
  }

  /** Recompute one subtree's transforms after its viewport moved. */
  reposition(root: Slide, corners: Vec3[]): void {
    const rootCtx = this.contexts.get(root) as SlideContext;
    rootCtx.placement = corners.map((c) => [...c] as Vec3);
    for (const slide of walk(root)) {
      const ctx = this.contexts.get(slide) as SlideContext;
      const own = viewportCorners(slide.viewport as Rectangle);
      const parentCtx = this.contexts.get(slide.parent as Slide) as SlideContext;
      ctx.transform = parentCtx.transform.compose(Transform.fit(own, slide.width, slide.height));
      ctx.placement = own;
      ctx.display.sync(ctx.transform);
    }
  }

  /** Recompute every transform from the current viewport rectangles. */
  recomputeTransforms(): void {
    if (!this.root) return;
    for (const slide of walk(this.root)) {
      const ctx = this.contexts.get(slide) as SlideContext;
      if (slide === this.root) ctx.transform = new Transform();
      else {
        const corners = viewportCorners(slide.viewport as Rectangle);
        const parentCtx = this.contexts.get(slide.parent as Slide) as SlideContext;
        ctx.transform = parentCtx.transform.compose(Transform.fit(corners, slide.width, slide.height));
        ctx.placement = corners;
      }
      ctx.display.sync(ctx.transform);
    }
  }

  /** Center and width of the presentation viewport that fits a slide. */
  cameraTarget(ctx: SlideContext): CameraState {
    const bounds = ctx.transform.boundsOfCanvas(ctx.width, ctx.height);
    const width = bounds.max[0] - bounds.min[0];
    const height = bounds.max[1] - bounds.min[1];
    return {
      center: [...ctx.transform.offset] as Vec3,
      width: Math.max(width, height * this.viewportAspect) * this.config.padding,
    };
  }

  /**
   * Seconds of the camera move from one slide to another: zero (a cut) when either slide asks
   * for a cut, or when neither says anything and the deck's `transition` is `cut`.
   */
  transitionTime(from: Slide, to: Slide): number {
    const modes = [from.transition, to.transition].filter((mode): mode is TransitionMode => mode !== null);
    const mode = modes.includes('cut') ? 'cut' : modes.length ? 'zoom' : this.config.transition;
    return mode === 'cut' ? 0 : this.config.transitionTime;
  }

  /** Record a clip boundary; options configure the following clip. */
  boundary(ctx: SlideContext, kind: ClipKind, { force = true, options = {} }: { force?: boolean; options?: StopOptions } = {}): void {
    if (!this.enabled(ctx.slide)) return;
    if (!force && this.history.openEmpty) return;
    this.history.close(options);
    this.history.mark(ctx.slide, kind);
  }

  private async _focus(ctx: SlideContext, { returning = false, initial = false, from = null as Slide | null } = {}): Promise<void> {
    this.history.mark(ctx.slide, returning ? 'return' : 'entry');
    // An entry shows the slide's definition; a return shows the line of the parent that placed the child.
    this.history.openClip.source = (returning ? from?.placement : null) ?? ctx.slide.source;
    const target = this.cameraTarget(ctx);
    if (initial) {
      this.camera = target;
    } else {
      if (!this.focused) throw new Error('Presentation focus must be initialized before moving');
      const needsFade =
        ctx.display.contentOpacity < 1 || ctx.display.backgrounds.length > 0 || this.focused.display.gridOpacity > 0;
      const time = this.transitionTime(this.focused.slide, ctx.slide);
      if (time > 0 || needsFade) {
        this.history.record(new FocusOp(this, this.focused, ctx, target, time));
      } else {
        this.camera = target;
      }
    }
    this.focused = ctx;
    const startEntry = ctx.slide === this.startSlide && !returning;
    if (startEntry || (returning ? this.config.pauseOnReturn : this.config.pauseOnEntry)) {
      this.boundary(ctx, 'program');
    }
  }

  private async _enter(ctx: SlideContext, initial = false): Promise<void> {
    if (ctx.visited) throw new Error('Each slide can be visited only once per render');
    this.active = ctx;
    ctx.visited = true;
    ctx.phase = 'program';
    if (!this.enabled(ctx.slide)) {
      ctx.program = null;
      ctx.autoChild = ctx.slide._children[0] ?? null;
      return;
    }
    initial = initial || this.focused === null;
    this._visits += 1;
    this._report('visit', ctx.slide, {
      index: this._visits,
      total: this.selectedRender ? this._renderSlides.size : this.contexts.size,
    });
    if (initial) {
      ctx.display.contentOpacity = 1;
      ctx.display.gridOpacity = ctx.display.backgrounds.length ? 1 : 0;
      ctx.display.sync(ctx.transform);
    }
    await this._focus(ctx, { initial });
    let result: unknown = ctx.slide.construct(ctx);
    if (result instanceof Promise) result = await result;
    if (result === ctx || result == null) result = null;
    if (result !== null && !isIterator(result)) {
      throw new TypeError('construct must return nothing or an iterator yielding Visit objects');
    }
    ctx.program = result as SlideContext['program'];
    ctx.autoChild = ctx.slide._children[0] ?? null;
  }

  private _consumeSkipNext(): boolean {
    const skip = this.skipNextPending;
    this.skipNextPending = false;
    return skip;
  }

  /** @internal Used by markup slides to honour skipped reveal steps. */
  consumeSkipNext(): boolean {
    return this._consumeSkipNext();
  }

  private _skipSubtree(slide: Slide): void {
    for (const descendant of walk(slide)) {
      const ctx = this.contexts.get(descendant) as SlideContext;
      ctx.visited = true;
      ctx.phase = 'skipped';
      ctx.returnSkipped = true;
    }
  }

  private _nextChild(ctx: SlideContext): Slide | null {
    while (ctx.autoChild !== null && (this.contexts.get(ctx.autoChild) as SlideContext).visited) {
      ctx.autoChild = ctx.autoChild.nextSibling;
    }
    const child = ctx.autoChild;
    if (child !== null) ctx.autoChild = child.nextSibling;
    return child;
  }

  /** Execute `root` and its descendants in resumable traversal order, recording clips. */
  async play(root: Slide): Promise<this> {
    if (this.root === null) await this.prepare(root);
    else if (this.root !== root) throw new Error('play must use the prepared root');
    const rootCtx = this.contexts.get(root) as SlideContext;
    rootCtx.display.contentOpacity = 1;
    rootCtx.display.gridOpacity = rootCtx.display.backgrounds.length ? 1 : 0;
    rootCtx.display.sync(rootCtx.transform);
    this.camera = this.cameraTarget(rootCtx);
    this.history.snapshot(-1);
    await this._enter(rootCtx, true);
    while (this.active !== null) {
      const ctx = this.active;
      let visit: Visit | null = null;
      if (ctx.program !== null) {
        const step = await ctx.program.next();
        if (step.done) ctx.program = null;
        else {
          if (!(step.value instanceof Visit)) throw new TypeError('Slide programs may yield only ctx.visit(child)');
          if (step.value.child.parent !== ctx.slide) throw new Error('A slide program can visit only its direct children');
          visit = step.value;
        }
      }
      if (visit === null && ctx.program === null) {
        const child = this._nextChild(ctx);
        if (child !== null) visit = new Visit(child);
      }
      if (visit !== null) {
        this.boundary(ctx, 'program', { force: false });
        if (this._consumeSkipNext()) {
          this._skipSubtree(visit.child);
          continue;
        }
        if (visit.child instanceof PlaceholderSlide) {
          // A placeholder for an undefined slide is drawn but never a stop.
          this._skipSubtree(visit.child);
          continue;
        }
        await this._enter(this.contexts.get(visit.child) as SlideContext);
        continue;
      }
      this.boundary(ctx, 'program', { force: false });
      ctx.phase = 'done';
      const parent = ctx.slide.parent;
      if (parent === null) {
        this.active = null;
        break;
      }
      this.active = this.contexts.get(parent) as SlideContext;
      ctx.returnSkipped = ctx.slide.skipReturn || this._consumeSkipNext();
      if (this.enabled(parent)) {
        if (!ctx.returnSkipped && (!this.selectedRender || this.focused !== this.active)) {
          await this._focus(this.active, { returning: true, from: ctx.slide });
        } else if (!this.selectedRender) {
          this.history.mark(this.active.slide, 'program');
        }
      }
    }
    this.history.finish();
    if (this.startSlide !== null && !this.history.clips.some((clip) => clip.slide === this.startSlide && clip.kind === 'entry')) {
      throw new Error('startHere slide was not visited (it may have been skipped)');
    }
    this._report('traversed', undefined, {
      index: this._visits,
      total: this.selectedRender ? this._renderSlides.size : this.contexts.size,
    });
    return this;
  }

  /** Serializable slide outline and clip metadata for the player. */
  navigation(): NavigationData {
    if (!this.root) throw new Error('No slide tree has been prepared');
    return {
      version: 1,
      slides: [...walk(this.root)].map((slide) => ({
        id: this._ids.get(slide) as number,
        name: slide.name,
        key: this._keys.get(slide) as string,
        parent: slide.parent ? (this._ids.get(slide.parent) as number) : null,
        placeholder: slide instanceof PlaceholderSlide || (this.selectedRender && !this._renderSlides.has(slide)),
        source: slide.source,
        placement: slide.placement,
      })),
      clips: this.history.clips.map((clip) => ({
        slide: this._ids.get(clip.slide as Slide) as number,
        kind: clip.kind,
        loop: clip.loop,
        autoNext: clip.autoNext,
        notes: clip.notes,
        rate: clip.playbackRate,
        duration: clip.duration,
        source: clip.source,
      })),
      startSlide: this.startSlide ? (this._ids.get(this.startSlide) as number) : null,
    };
  }

  /**
   * Prepare every display for one render: culling, dirty syncs, stroke
   * scaling, opacity multipliers and draw order.
   */
  prepareRender(rendererWidth: number, rendererHeight: number, view: { min: Vec3; max: Vec3 }, cameraWidth: number): void {
    let order = 0;
    const next = () => order++;
    for (const ctx of this.contexts.values()) {
      const bounds = ctx.transform.boundsOfCanvas(ctx.width * 2, ctx.height * 2);
      const outside =
        bounds.max[0] < view.min[0] || bounds.min[0] > view.max[0] || bounds.max[1] < view.min[1] || bounds.min[1] > view.max[1];
      ctx.display.setCulled(outside);
      ctx.display.prepareRender(rendererWidth, rendererHeight, cameraWidth, next);
    }
  }
}

export interface NavigationSlide {
  id: number;
  name: string;
  key: string;
  parent: number | null;
  placeholder: boolean;
  /** Where the slide is defined and where its parent places it, for Markdown decks; absent in older recordings. */
  source?: SourceLocation | null;
  placement?: SourceLocation | null;
}

export interface NavigationClip {
  slide: number;
  kind: ClipKind;
  loop: boolean;
  autoNext: boolean;
  notes: string;
  rate: number;
  duration: number;
  /** The source line the clip's stop shows, for Markdown decks; absent in older recordings. */
  source?: SourceLocation | null;
}

export interface NavigationData {
  version: 1;
  slides: NavigationSlide[];
  clips: NavigationClip[];
  startSlide: number | null;
}
