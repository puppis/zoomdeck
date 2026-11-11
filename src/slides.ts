/**
 * Lightweight slide declarations and stackless traversal.
 *
 * A slide is deliberately lighter than an engine Scene: it owns no renderer
 * or camera. Place children with `addChild` in the constructor, the deck
 * factory or the optional `declare` hook; override `build` to create content
 * and `construct` to play its program. Coordinates always refer to the
 * slide's fixed local canvas, independent of its scale, rotation or depth.
 */
import { Rectangle, Text, RED, type Mobject } from 'manim-web';
import { point, positive, type Vec3 } from './geometry';
import type { SlideContext } from './runtime';

export const DEFAULT_ANIMATION_TIME = 0.35;

/** Infer omitted canvas dimensions from the configured default proportions. */
export function resolveSize(
  width: number | null | undefined,
  height: number | null | undefined,
  defaultSize: readonly [number, number],
): [number, number] {
  const defaultWidth = positive(defaultSize[0], 'default logical size');
  const defaultHeight = positive(defaultSize[1], 'default logical size');
  if (width == null && height == null) return [defaultWidth, defaultHeight];
  let w = width == null ? null : positive(width, 'logical width');
  let h = height == null ? null : positive(height, 'logical height');
  if (w == null) w = positive((h as number) * defaultWidth / defaultHeight, 'logical width');
  if (h == null) h = positive(w * defaultHeight / defaultWidth, 'logical height');
  return [w, h];
}

/** The result a slide program may produce: nothing, an iterator of visits, or a promise of either. */
export type ProgramResult =
  | void
  | SlideContext
  | Iterator<Visit, unknown, unknown>
  | AsyncIterator<Visit, unknown, unknown>
  | Promise<void | SlideContext>;

export type BuildCallback = (ctx: SlideContext) => void | Promise<void>;
export type ProgramCallback = (ctx: SlideContext) => ProgramResult;

export interface SlideOptions {
  /** Logical `[width, height]`; use this tuple or the width/height keys. */
  size?: readonly [number, number];
  width?: number;
  height?: number;
  /** Callback used instead of subclassing `build`. */
  build?: BuildCallback;
  /** Callback used instead of subclassing `construct`. */
  program?: ProgramCallback;
  /** Entering the next slide does not animate the camera back to this slide first. */
  skipReturn?: boolean;
  /** Select this slide for a partial render. */
  onlyThis?: boolean;
  /** Open playback at this slide's first entry. At most one slide may enable it. */
  startHere?: boolean;
  /** How the camera moves into and out of this slide: `cut` replaces the view at once, `zoom`
   * animates; unset follows the presenter's `transition`. */
  transition?: TransitionMode | null;
  /** Lightweight topology callback receiving this slide. */
  declare?: (slide: Slide) => void;
}

/** Camera behaviour between slides: an animated zoom or an instant cut, as between PDF pages. */
export type TransitionMode = 'zoom' | 'cut';

export const TRANSITION_MODES: readonly TransitionMode[] = ['zoom', 'cut'];

function checkTransition(mode: TransitionMode | null | undefined): TransitionMode | null {
  if (mode == null) return null;
  if (!TRANSITION_MODES.includes(mode)) throw new Error('transition must be zoom or cut');
  return mode;
}

export interface PlacementStyle {
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  fillColor?: string;
  fillOpacity?: number;
}

export interface AddChildOptions extends PlacementStyle {
  /** Center in the parent's logical coordinates. */
  center?: ArrayLike<number>;
  width?: number;
  height?: number;
  /** Rotation in radians. */
  angle?: number;
  onlyThis?: boolean;
  startHere?: boolean;
  transition?: TransitionMode | null;
}

/** A logical canvas and resumable program in a presentation tree. */
export class Slide {
  /** Default logical `[width, height]`; override in a subclass, e.g. `[16, 12]`. */
  static defaultSize: readonly [number, number] = [16, 9];

  name: string;
  width: number;
  height: number;
  skipReturn: boolean;
  onlyThis: boolean;
  startHere: boolean;
  transition: TransitionMode | null;
  parent: Slide | null = null;
  nextSibling: Slide | null = null;
  /** Invisible engine rectangle placing this slide in its parent's canvas. */
  viewport: Rectangle | null = null;
  /** @internal */
  _children: Slide[] = [];
  /** @internal */
  _frozen = false;
  private readonly _declareCallback: ((slide: Slide) => void) | null;
  private readonly _buildCallback: BuildCallback | null;
  private readonly _programCallback: ProgramCallback | null;

  constructor(name?: string | null, options: SlideOptions = {}) {
    this.name = String(name ?? (this.constructor as typeof Slide).name);
    if (!this.name.trim()) throw new Error('Slide name must not be empty');
    let { width, height } = options;
    if (options.size != null) {
      if (width != null || height != null) throw new Error('Specify size or width/height, not both');
      [width, height] = options.size;
    }
    [this.width, this.height] = resolveSize(width, height, (this.constructor as typeof Slide).defaultSize);
    this.skipReturn = Boolean(options.skipReturn);
    this.onlyThis = Boolean(options.onlyThis);
    this.startHere = Boolean(options.startHere);
    this.transition = checkTransition(options.transition);
    this._declareCallback = options.declare ?? null;
    this._buildCallback = options.build ?? null;
    this._programCallback = options.program ?? null;
  }

  /** Duration of automatic content and grid fades, in seconds. */
  get fadeTime(): number {
    return DEFAULT_ANIMATION_TIME;
  }

  /** Direct children in presentation order. */
  get children(): readonly Slide[] {
    return [...this._children];
  }

  /**
   * Place `child` in this slide's logical coordinates. Pass an instance or a
   * Slide subclass constructible without arguments. One omitted dimension
   * preserves the child's canvas aspect ratio; both letterbox the canvas.
   */
  addChild(child: Slide | (new () => Slide), options: AddChildOptions = {}): Slide {
    if (this._frozen) throw new Error('Slide topology is frozen during presentation');
    if (typeof child === 'function') child = new child();
    if (!(child instanceof Slide)) throw new TypeError('child must be a Slide instance or subclass');
    if (child._frozen || child.parent !== null) throw new Error('A slide can belong to only one presentation and parent');
    for (let ancestor: Slide | null = this; ancestor !== null; ancestor = ancestor.parent) {
      if (ancestor === child) throw new Error('Slide trees cannot contain cycles');
    }
    if (options.onlyThis != null) child.onlyThis = Boolean(options.onlyThis);
    if (options.startHere != null) child.startHere = Boolean(options.startHere);
    if (options.transition !== undefined) child.transition = checkTransition(options.transition);
    let { width, height } = options;
    if (width == null && height == null) width = this.width / 2;
    if (width == null) width = positive(height as number, 'height') * child.width / child.height;
    if (height == null) height = positive(width, 'width') * child.height / child.width;
    const angle = Number(options.angle ?? 0);
    if (!Number.isFinite(angle)) throw new Error('angle must be finite');
    const viewport = new Rectangle({
      width: positive(width, 'width'),
      height: positive(height, 'height'),
      color: options.strokeColor ?? '#FFFFFF',
      fillOpacity: options.fillOpacity ?? 0,
      strokeWidth: options.strokeWidth ?? 4,
    });
    viewport.setStrokeOpacity(options.strokeOpacity ?? 0);
    if (options.fillColor !== undefined) viewport.fillColor = options.fillColor;
    if (angle !== 0) viewport.rotate(angle);
    viewport.moveTo(point(options.center ?? [0, 0, 0]));
    child.viewport = viewport;
    if (this._children.length) this._children[this._children.length - 1].nextSibling = child;
    this._children.push(child);
    child.parent = this;
    return child;
  }

  /** Declare children once before resource preparation and selection. */
  declare(): void {
    if (this._declareCallback) this._declareCallback(this);
  }

  /** Executed once before playback. Add previews, objects and child slides. */
  build(ctx: SlideContext): void | Promise<void> {
    if (this._buildCallback) return this._buildCallback(ctx);
  }

  /** Executed once on entry. May yield `ctx.visit(child)` to resume afterwards. */
  construct(ctx: SlideContext): ProgramResult {
    if (this._programCallback) return this._programCallback(ctx);
  }
}

/** The four world-space corners of a viewport rectangle in engine path order. */
export function viewportCorners(viewport: Rectangle): Vec3[] {
  const pts = viewport.getPoints();
  if (pts.length < 10) throw new Error('Slide viewport must remain a finite Rectangle');
  return [0, 3, 6, 9].map((i) => [pts[i][0], pts[i][1], pts[i][2]] as Vec3);
}

/** Create an unfilled red natural-canvas outline with a native-text label. */
export function buildPlaceholder(ctx: SlideContext, label: string): void {
  const outline = new Rectangle({ width: ctx.width, height: ctx.height, fillOpacity: 0, color: RED, strokeWidth: 3 });
  const text = new Text({ text: label, color: ctx.foreground, fontSize: 24 });
  const width = text.getWidth();
  const height = text.getHeight();
  if (width > 0 && height > 0) {
    text.scale(Math.min((ctx.width * 0.8) / width, (ctx.height * 0.4) / height, 1));
  }
  ctx.add(outline as Mobject, text as Mobject);
}

/** A reusable unfilled red outline for content that is not ready yet. */
export class PlaceholderSlide extends Slide {
  label: string;

  constructor(name = 'Unfinished slide', options: SlideOptions & { label?: string } = {}) {
    const { label, ...rest } = options;
    super(name, rest);
    this.label = label ?? this.name;
  }

  override build(ctx: SlideContext): void {
    buildPlaceholder(ctx, this.label);
  }
}

/** A request yielded by a slide program to visit one direct child. */
export class Visit {
  constructor(readonly child: Slide) {}
}

/** Resolve the optional starting slide, rejecting ambiguous declarations. */
export function startingSlide(root: Slide): Slide | null {
  const selected = [...walk(root)].filter((slide) => slide.startHere);
  if (selected.length > 1) {
    throw new Error('startHere may be true on at most one slide: ' + selected.map((f) => f.name).join(', '));
  }
  return selected[0] ?? null;
}

/** Yield a slide tree in preorder using parent and sibling links only. */
export function* walk(root: Slide): Generator<Slide> {
  let node: Slide | null = root;
  while (node !== null) {
    yield node;
    if (node._children.length) {
      node = node._children[0];
      continue;
    }
    while (node !== root && node.nextSibling === null) node = node.parent as Slide;
    node = node === root ? null : node.nextSibling;
  }
}
