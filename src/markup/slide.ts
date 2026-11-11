/**
 * Compiled markup slides, the slide builder that links them into a tree, and
 * imports of code-authored slides into markup decks.
 */
import { Group, MoveAlongPath, ReplacementTransform, type Animation, type Mobject } from 'manim-web';
import { sketchSeed, type OutlineMobject } from '../sketch';
import { PropertyAnimation, RATE_FUNCTIONS, Tremble, enterAnimation, exitAnimation, makeEffect, type PropertyTargets } from '../animations';
import { Slide, PlaceholderSlide, resolveSize, startingSlide } from '../slides';
import { RasterImage, RasterMovie } from '../raster';
import { VideoClip, VideoPlay } from '../video';
import { IframeHost } from './iframe';
import { DelayedAnimation, type SlideContext } from '../runtime';
import {
  ATTACHMENTS, CONNECTIONS, NEIGHBORS, TEXT_LIKE, VERTICAL_POSITION,
  ActionSpec, AnimationStep, ElementSpec, EventSpec, GroupSpec, CodeSlideSpec, IncludeSpec, MarkupDocument, MarkupError, NextSpec,
  SkipNextSpec, SlideItem, SlideSpec, StepChange, childKey, numberValue, parseAt, parseColor, parseTremble, positionOrder, positionTargets,
  stepValue,
} from './ast';
import { ASTTransformer } from './parser';
import {
  LayoutConfig, MarkupRenderer, anchorPoint, applyOpacity, elementAnchor, placeRelative, type OriginMobject, type PartsMobject,
} from './renderer';

export type SlideNamespace = Record<string, unknown>;

function instantiateSlide(spec: CodeSlideSpec, namespace: SlideNamespace | null): Slide {
  if (!namespace) throw new MarkupError('Code-authored subslides need slide classes; pass `classes` to the markup deck', spec.line);
  const parts = spec.className.split('.');
  if (!(parts[0] in namespace)) throw new MarkupError(`Unknown class ${JSON.stringify(spec.className)}`, spec.line);
  let candidate: unknown = namespace[parts[0]];
  for (const part of parts.slice(1)) {
    if (typeof candidate !== 'object' || candidate === null || !(part in candidate)) {
      throw new MarkupError(`Unknown class ${JSON.stringify(spec.className)}`, spec.line);
    }
    candidate = (candidate as Record<string, unknown>)[part];
  }
  if (typeof candidate !== 'function' || !(candidate.prototype instanceof Slide)) {
    throw new MarkupError(`Class ${JSON.stringify(spec.className)} must be a Slide subclass`, spec.line);
  }
  let child: unknown;
  try {
    child = new (candidate as new () => Slide)();
  } catch (error) {
    throw new MarkupError(`Class ${JSON.stringify(spec.className)} must be constructible without arguments (${(error as Error).message})`, spec.line);
  }
  if (!(child instanceof Slide) || child.parent !== null || child._frozen) {
    throw new MarkupError(`Class ${JSON.stringify(spec.className)} must create a fresh unattached Slide`, spec.line);
  }
  return child;
}

/** A compiled markup component using normal local membership and child calls. */
export class MarkupSlide extends Slide {
  readonly spec: SlideSpec;
  readonly renderer: MarkupRenderer;
  readonly animationSteps: AnimationStep[];
  readonly elements = new Map<string, Mobject>();
  readonly movies = new Map<string, RasterMovie | VideoPlay>();
  readonly components = new Map<string, Slide>();

  constructor(spec: SlideSpec, options: { renderer: MarkupRenderer }) {
    const heading = spec.items.find((item): item is ElementSpec => item instanceof ElementSpec && item.level > 0);
    const title = heading ? heading.spans.map((s) => s.content).join('') : spec.id;
    super(spec.attributes.title ?? title, {
      size: resolveSize(
        numberValue(spec.attributes, 'width', spec.line),
        numberValue(spec.attributes, 'height', spec.line),
        options.renderer.layout.defaultSlideSize,
      ),
      onlyThis: (spec.attributes.only_this ?? 'false') === 'true',
      startHere: (spec.attributes.start_here ?? 'false') === 'true',
      skipReturn: (spec.attributes.skip_return ?? 'false') === 'true',
    });
    this.spec = spec;
    this.renderer = options.renderer;
    this.animationSteps = new ASTTransformer().plan(spec);
  }

  override get fadeTime(): number {
    return this.renderer.layout.animationTime;
  }

  /** Lay out content and component previews once in this logical canvas. */
  override async build(ctx: SlideContext): Promise<void> {
    const layout = this.renderer.layout;
    const available = this.width - 2 * layout.margin;
    if (available <= 0) throw new MarkupError('Canvas width must exceed twice the layout margin', this.spec.line);
    await this._layout(
      this.spec.items,
      { left: -this.width / 2 + layout.margin, top: this.height / 2 - layout.margin, width: available, local: new Map() },
      (index, item) => (this.components.get(childKey(index, item)) as Slide).viewport as Mobject,
    );
    const focused: Mobject[] = [];
    for (const item of this.spec.items) {
      if (item instanceof ElementSpec && stepValue(item.attributes, 'step', item.line) === 0) {
        if (item.attributes.focus_only === 'true') focused.push(this.elements.get(item.id) as Mobject);
        else ctx.add(this.elements.get(item.id) as Mobject);
      }
    }
    if (focused.length) {
      // Share the focus-faded background layer with coordinate grids.
      ctx.display.backgrounds = [...focused, ...ctx.display.backgrounds];
    }
    for (const [id, obj] of this.elements) ctx.objects[id] = obj;
  }

  /**
   * Flow, explicit, relative and offset placement of `items` inside one
   * coordinate scope (the slide canvas or a group), then attachments and
   * connections. Objects are recorded in `scope.local` and `this.elements`.
   */
  private async _layout(
    items: SlideItem[],
    scope: { left: number; top: number; width: number; local: Map<string, Mobject> },
    viewportOf: ((index: number, item: IncludeSpec | CodeSlideSpec) => Mobject) | null,
  ): Promise<void> {
    const layout = this.renderer.layout;
    let cursor = scope.top;
    const elements = new Map<string, ElementSpec>();
    const verticalKeys = new Set([...Object.keys(NEIGHBORS), ...VERTICAL_POSITION, 'at']);
    const pointShapes = ['polyline', 'polygon', 'arc'];
    for (const [index, item] of items.entries()) {
      if (item instanceof EventSpec || item instanceof ActionSpec || item instanceof NextSpec || item instanceof SkipNextSpec) continue;
      if (item instanceof ElementSpec && (CONNECTIONS.has(item.kind) || ATTACHMENTS.has(item.kind))) continue;
      let obj: Mobject;
      let explicit: boolean;
      let position: [number, number, number] | null;
      if (item instanceof IncludeSpec || item instanceof CodeSlideSpec) {
        if (!viewportOf) throw new MarkupError('Groups cannot contain includes or subslides', item.line);
        obj = viewportOf(index, item);
        explicit = 'x' in item.attributes || 'y' in item.attributes;
        position = [Number(item.attributes.x ?? 0), Number(item.attributes.y ?? 0), 0];
      } else {
        obj = item instanceof GroupSpec ? await this._buildGroup(item, scope.width) : await this.renderer.make(item, scope.width);
        this.elements.set(item.id, obj);
        scope.local.set(item.id, obj);
        elements.set(item.id, item);
        if (obj instanceof IframeHost) obj.slide = this;
        if (item.kind === 'image' && 'play' in item.attributes) {
          const plays = item.attributes.play === 'once' ? 1 : 0;
          if (obj instanceof VideoClip) this.movies.set(item.id, new VideoPlay(obj, { plays }));
          else if (obj instanceof RasterImage && obj.source.frameCount >= 2) this.movies.set(item.id, new RasterMovie(obj, { plays }));
          else throw new MarkupError('play= requires a video or a multi-slide raster file', item.line);
        }
        explicit = item.position !== null;
        position = item.position;
        if (pointShapes.includes(item.kind) && !explicit && positionTargets(item).size === 0) {
          // Point-defined shapes keep their own coordinates unless positioned.
          explicit = true;
          position = obj.getCenter();
        }
      }
      const attrs = item.attributes;
      const flows = !Object.keys(attrs).some((key) => verticalKeys.has(key));
      const anchor = elementAnchor(item, layout.textAnchor);
      const textLike = item instanceof ElementSpec && TEXT_LIKE.has(item.kind);
      const flowPlacement = () => obj.moveTo([scope.left + obj.getWidth() / 2, cursor - obj.getHeight() / 2, 0]);
      if (!explicit) {
        flowPlacement();
        if (flows) cursor -= obj.getHeight() + layout.gap;
      } else if (item instanceof ElementSpec && pointShapes.includes(item.kind) && item.position === null) {
        // Already at its own coordinates.
      } else if (textLike && anchor !== 'center') {
        // Text keeps its flow position on an omitted axis; the named anchor lands on the given one.
        flowPlacement();
        for (const [key, axis] of [['x', 0], ['y', 1]] as const) {
          if (key in attrs) {
            const delta: [number, number, number] = [0, 0, 0];
            delta[axis] = Number(attrs[key]) - anchorPoint(obj, anchor)[axis];
            obj.shift(delta);
          }
        }
        if (!('y' in attrs) && flows) cursor -= obj.getHeight() + layout.gap;
      } else {
        // Center-anchored objects default an omitted axis to zero; other anchors land on the given point.
        const point = anchorPoint(obj, anchor);
        const target = position as [number, number, number];
        obj.shift([target[0] - point[0], target[1] - point[1], 0]);
      }
    }
    for (const identifier of positionOrder(elements)) {
      placeRelative(elements.get(identifier) as ElementSpec, scope.local.get(identifier) as Mobject, scope.local, layout.gap, layout.textAnchor);
    }
    if (viewportOf) {
      for (const [index, item] of items.entries()) {
        if (item instanceof IncludeSpec || item instanceof CodeSlideSpec) placeRelative(item, viewportOf(index, item), scope.local, layout.gap);
      }
    }
    // Offsets apply last, after flow, explicit and relative placement.
    for (const [index, item] of items.entries()) {
      if (item instanceof EventSpec || item instanceof ActionSpec || item instanceof NextSpec || item instanceof SkipNextSpec) continue;
      if (item instanceof ElementSpec && (CONNECTIONS.has(item.kind) || ATTACHMENTS.has(item.kind))) continue;
      const dx = Number(item.attributes.dx ?? 0);
      const dy = Number(item.attributes.dy ?? 0);
      if (!dx && !dy) continue;
      const obj = item instanceof ElementSpec ? (scope.local.get(item.id) as Mobject) : (viewportOf as NonNullable<typeof viewportOf>)(index, item);
      obj.shift([dx, dy, 0]);
    }
    for (const item of items) {
      if (item instanceof ElementSpec && ATTACHMENTS.has(item.kind)) {
        const obj = await this.renderer.attachment(item, scope.local);
        this.elements.set(item.id, obj);
        scope.local.set(item.id, obj);
      }
    }
    for (const item of items) {
      if (item instanceof ElementSpec && CONNECTIONS.has(item.kind)) {
        const obj = await this.renderer.connection(item, scope.local);
        this.elements.set(item.id, obj);
        scope.local.set(item.id, obj);
      }
    }
  }

  /** Lay out a group's members in local coordinates (flow from the origin) and wrap them in one object. */
  private async _buildGroup(spec: GroupSpec, availableWidth: number): Promise<Mobject> {
    const local = new Map<string, Mobject>();
    const width = numberValue(spec.attributes, 'width', spec.line, availableWidth) as number;
    await this._layout(spec.items, { left: 0, top: 0, width, local }, null);
    const group = new Group(...local.values()) as OriginMobject & PartsMobject;
    if (local.size) {
      const center = group.getCenter();
      group.markupOrigin = [-center[0], -center[1]];
      // Blobs flow around the members rather than around the group's box.
      group.markupParts = [...local.values()];
    }
    if ('opacity' in spec.attributes) applyOpacity(group, Number(spec.attributes.opacity));
    return group;
  }

  /** The object an animation directive addresses: a slide element or an included child's viewport. */
  private _actionTarget(id: string): Mobject {
    return this.elements.get(id) ?? ((this.components.get(id) as Slide).viewport as Mobject);
  }

  /** Build the engine animation for one step change, or null when the state already matches. */
  private _changeAnimation(ctx: SlideContext, change: StepChange, movies: string[]): Animation | null {
    const duration = change.runTime ?? this.renderer.layout.animationTime;
    const rateFunc = change.rate ? RATE_FUNCTIONS[change.rate] : undefined;
    const options = rateFunc ? { duration, rateFunc } : { duration };
    if (change.action === 'show' || change.action === 'hide') {
      const obj = this.elements.get(change.target) as Mobject;
      // Skipped steps can leave the object in the desired state already.
      if (ctx.mobjects.includes(obj) === (change.action === 'show')) return null;
      if (change.action === 'show' && this.movies.has(change.target)) {
        if (obj instanceof RasterImage) obj.showFrame(0);
        else if (obj instanceof VideoClip) obj.rewind();
        movies.push(change.target);
      }
      return change.action === 'show' ? enterAnimation(change.style ?? 'fade', obj, options) : exitAnimation(change.style ?? 'fade', obj, options);
    }
    const obj = this._actionTarget(change.target);
    if (change.action === 'animate') return new PropertyAnimation(obj, this._propertyTargets(change, obj), options);
    if (change.action === 'effect') {
      const opts = change.options ?? {};
      return makeEffect(change.name as string, obj, {
        ...options,
        ...(opts.color ? { color: parseColor(opts.color) } : {}),
        ...(opts.scale ? { scale: Number(opts.scale) } : {}),
      });
    }
    if (change.action === 'transform') return new ReplacementTransform(obj, this.elements.get(change.to as string) as Mobject, options);
    const path = this.elements.get(change.path as string) as OutlineMobject;
    // Sketchy shapes move along the exact geometry they approximate.
    return new MoveAlongPath(obj, { ...options, path: path.markupOutline ?? path, rotateAlongPath: change.rotate });
  }

  /** Translate `animate` attributes into relative targets from the object's current geometry. */
  private _propertyTargets(change: StepChange, obj: Mobject): PropertyTargets {
    const props = change.props ?? {};
    const spec = this.spec.items.find((item): item is ElementSpec => item instanceof ElementSpec && item.id === change.target);
    const anchor = props.anchor ?? (spec ? elementAnchor(spec, this.renderer.layout.textAnchor) : 'center');
    const targets: PropertyTargets = {};
    let shift: [number, number] | null = null;
    if ('at' in props) {
      const at = parseAt(props.at, spec?.line ?? 1);
      const point = 'point' in at.target ? at.target.point : anchorPoint(this._actionTarget(at.target.id), at.target.anchor ?? 'center');
      const mine = anchorPoint(obj, at.anchor ?? anchor);
      shift = [point[0] - mine[0], point[1] - mine[1]];
    } else if ('x' in props || 'y' in props) {
      const mine = anchorPoint(obj, anchor);
      shift = ['x' in props ? Number(props.x) - mine[0] : 0, 'y' in props ? Number(props.y) - mine[1] : 0];
    }
    if ('dx' in props || 'dy' in props) shift = [(shift?.[0] ?? 0) + Number(props.dx ?? 0), (shift?.[1] ?? 0) + Number(props.dy ?? 0)];
    if (shift) targets.shift = shift;
    if ('angle' in props) targets.rotate = Number(props.angle);
    if ('scale' in props) targets.scale = Number(props.scale);
    if ('opacity' in props) targets.opacity = Number(props.opacity);
    if ('color' in props) targets.color = parseColor(props.color);
    return targets;
  }

  private static _autoAdvance(ctx: SlideContext): void {
    // Finish this cycle before advancing; a looping clip never ends on its own.
    const clip = ctx.completedStop();
    clip.loop = false;
    clip.autoNext = true;
  }

  /** Trembling animations of the shown elements whose `tremble=` range covers `step`. */
  private _tremblers(ctx: SlideContext, step: number): Animation[] {
    const shown = new Set(ctx.getMobjectFamilyMembers());
    const result: Animation[] = [];
    const visit = (items: SlideItem[]): void => {
      for (const item of items) {
        if (!(item instanceof ElementSpec)) continue;
        if (item instanceof GroupSpec) visit(item.items);
        if (!('tremble' in item.attributes)) continue;
        const range = parseTremble(item.attributes.tremble, stepValue(item.attributes, 'step', item.line), item.line);
        if (!range || step < range.start || (range.end !== null && step >= range.end)) continue;
        const obj = this.elements.get(item.id);
        if (!obj || !shown.has(obj)) continue;
        result.push(new Tremble(obj, {
          amplitude: numberValue(item.attributes, 'tremble_amplitude', item.line) ?? undefined,
          rate: numberValue(item.attributes, 'tremble_rate', item.line) ?? undefined,
          seed: sketchSeed(`${item.id}@${item.line}`),
        }));
      }
    };
    visit(this.spec.items);
    return result;
  }

  /**
   * Play finite movies once, then record the continuous motion of a stop
   * (looping movies and trembling elements) as a separate looping clip, so
   * that the fades of the stop are not repeated with every cycle.
   */
  private async _playContinuous(ctx: SlideContext, targets: string[], step: number, reveal: boolean): Promise<void> {
    const movies = targets.filter((target) => this.movies.has(target)).map((target) => this.movies.get(target) as RasterMovie | VideoPlay);
    const finite = movies.filter((movie) => movie.plays !== 0);
    const looping: Animation[] = [...movies.filter((movie) => movie.plays === 0), ...this._tremblers(ctx, step)];
    if (finite.length) await ctx.play(...finite);
    if (looping.length) {
      if (reveal || finite.length) ctx.stop();
      // The reveal (or the entry stop before the slide's program) runs straight into the loop.
      MarkupSlide._autoAdvance(ctx);
      await ctx.play(...looping);
    }
    ctx.stop();
    if (looping.length) ctx.completedStop().loop = true;
  }

  /** After a pause recorded by the runtime (a return from a child), keep trembling elements moving. */
  private async _loopIdle(ctx: SlideContext, step: number): Promise<void> {
    const tremblers = this._tremblers(ctx, step);
    if (!tremblers.length) return;
    MarkupSlide._autoAdvance(ctx);
    await ctx.play(...tremblers);
    ctx.stop();
    ctx.completedStop().loop = true;
  }

  /** Execute planned clicks and resume after visits through the slide runtime. */
  override async *construct(ctx: SlideContext): AsyncGenerator<ReturnType<SlideContext['visit']>> {
    const presenter = ctx.presenter;
    if (!presenter.config.pauseOnEntry) ctx.stop();
    const entry = this.animationSteps.find((step) => step.number === 0) ?? null;
    if (entry) {
      if (entry.autoNext) MarkupSlide._autoAdvance(ctx);
      if (entry.skipNext) ctx.skipNext();
    }
    const initialMovies = this.spec.items
      .filter((item): item is ElementSpec => item instanceof ElementSpec && this.movies.has(item.id) && stepValue(item.attributes, 'step', item.line) === 0)
      .map((item) => item.id);
    if ((initialMovies.length || this._tremblers(ctx, 0).length) && !presenter.consumeSkipNext()) {
      await this._playContinuous(ctx, initialMovies, 0, false);
      if (entry && entry.autoNext) MarkupSlide._autoAdvance(ctx);
    }
    for (const step of this.animationSteps) {
      if (step.number === 0) continue;
      let eventSkipped = false;
      if (step.changes.length) {
        eventSkipped = presenter.consumeSkipNext();
        if (!eventSkipped) {
          const animations: Animation[] = [];
          const movies: string[] = [];
          for (const change of step.changes) {
            const animation = this._changeAnimation(ctx, change, movies);
            if (animation) animations.push(change.lag ? new DelayedAnimation(animation, change.lag) : animation);
          }
          if (animations.length) await ctx.play(...animations);
          await this._playContinuous(ctx, movies, step.number, true);
        }
      }
      for (const target of step.visits) {
        const child = this.components.get(target) as Slide;
        yield ctx.visit(child);
        const childCtx = presenter.contexts.get(child) as SlideContext;
        eventSkipped = childCtx.phase === 'skipped';
        if (!childCtx.returnSkipped) {
          if (!presenter.config.pauseOnReturn) ctx.stop();
          await this._loopIdle(ctx, step.number);
        }
      }
      if (!step.changes.length && !step.visits.length) {
        eventSkipped = presenter.consumeSkipNext();
        if (!eventSkipped) await this._playContinuous(ctx, [], step.number, true);
      }
      if (!eventSkipped) {
        if (step.autoNext) MarkupSlide._autoAdvance(ctx);
        if (step.skipNext) ctx.skipNext();
      }
    }
  }
}

export interface SlideBuilderOptions {
  layout?: LayoutConfig;
  renderer?: MarkupRenderer;
}

/** Compile a document into markup slides and imported code-authored children. */
export class SlideBuilder {
  readonly layout: LayoutConfig;
  readonly renderer: MarkupRenderer | null;
  slides = new Map<string, Slide>();

  constructor(options: SlideBuilderOptions = {}) {
    this.layout = options.layout ?? new LayoutConfig();
    this.renderer = options.renderer ?? null;
  }

  /** Link markup slides and instantiate fresh imports from `namespace`. */
  build(
    document: MarkupDocument,
    options: { namespace?: SlideNamespace | null; macros?: Record<string, string>; assets?: Record<string, string> } = {},
  ): Slide {
    document = new ASTTransformer().validate(document);
    const renderer = this.renderer ?? new MarkupRenderer({ layout: this.layout, basePath: document.basePath, macros: options.macros, assets: options.assets });
    this.slides = new Map(
      document.slides.map((slide) => [
        slide.id,
        slide.placeholder
          ? new PlaceholderSlide(slide.id, { label: `#${slide.id}\nNot defined`, size: renderer.layout.defaultSlideSize })
          : new MarkupSlide(slide, { renderer }),
      ]),
    );
    const definitions = new Map(document.slides.map((slide) => [slide.id, slide]));
    const order = [document.root];
    for (let i = 0; i < order.length; i++) {
      const slide = definitions.get(order[i]) as SlideSpec;
      for (const item of slide.items) if (item instanceof IncludeSpec) order.push(item.target);
    }
    // Link descendants first so each parent is still unattached when its children arrive.
    for (const identifier of [...order].reverse()) {
      const slide = definitions.get(identifier) as SlideSpec;
      const parent = this.slides.get(slide.id) as Slide;
      for (const [index, item] of slide.items.entries()) {
        if (!(item instanceof IncludeSpec) && !(item instanceof CodeSlideSpec)) continue;
        const child = item instanceof IncludeSpec ? (this.slides.get(item.target) as Slide) : instantiateSlide(item, options.namespace ?? null);
        const attrs = item.attributes;
        if ('only_this' in attrs) child.onlyThis = attrs.only_this === 'true';
        if ('start_here' in attrs) child.startHere = attrs.start_here === 'true';
        if ('skip_return' in attrs) child.skipReturn = attrs.skip_return === 'true';
        let width = numberValue(attrs, 'width', item.line);
        const height = numberValue(attrs, 'height', item.line);
        if (width === null && height === null) width = Math.min(6, parent.width - 2 * renderer.layout.margin);
        parent.addChild(child, {
          width: width ?? undefined,
          height: height ?? undefined,
          center: [Number(attrs.x ?? 0), Number(attrs.y ?? 0), 0],
          angle: numberValue(attrs, 'angle', item.line, 0) ?? 0,
        });
        if (parent instanceof MarkupSlide) parent.components.set(childKey(index, item), child);
      }
    }
    const root = this.slides.get(document.root) as Slide;
    try {
      startingSlide(root);
    } catch (error) {
      throw new MarkupError((error as Error).message);
    }
    return root;
  }
}
