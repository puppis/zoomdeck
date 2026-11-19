/**
 * Compiled markup slides, the slide builder that links them into a tree, and
 * imports of code-authored slides into markup decks.
 */
import { Group, MoveAlongPath, ReplacementTransform, type Animation, type Mobject } from 'manim-web';
import { sketchSeed, type OutlineMobject } from '../sketch';
import { PropertyAnimation, RATE_FUNCTIONS, Tremble, enterAnimation, exitAnimation, makeEffect, type PropertyTargets } from '../animations';
import { Slide, PlaceholderSlide, pageSequence, resolveSize, startingSlide, type SourceLocation, type TransitionMode } from '../slides';
import type { ArtworkModule } from '../icons';
import type { EffectModule } from '../animations';
import type { ChartModule } from '../charts';
import type { DirectiveModule } from '../directives';
import { LINKED_OBJECTS, SOURCE_OBJECTS } from '../links';
import { RasterImage, RasterMovie } from '../raster';
import { VideoClip, VideoPlay } from '../video';
import { IframeHost } from './iframe';
import { DelayedAnimation, type SlideContext } from '../runtime';
import { markEarly, setSourceRank } from '../display';
import { BRIDGE_PATHS, findBridges, withBridges, type BridgePath } from '../bridges';
import {
  ATTACHMENTS, CONNECTIONS, EFFECT_NAMES, ENTER_STYLES, EXIT_STYLES, NEIGHBORS, TEXT_LIKE, VERTICAL_POSITION,
  ActionSpec, AnimationStep, ElementSpec, EventSpec, GroupSpec, CodeSlideSpec, IncludeSpec, MarkupDocument, MarkupError, NextSpec,
  SkipNextSpec, SlideItem, SlideSpec, StepChange, childKey, connectionEnd, numberValue, parseAt, parseColor, parseTremble, positionOrder, positionTargets,
  elementStep,
  stepValue,
} from './ast';
import { LatexError, type MacroDefinition } from './latex';
import { textLines, type TextLines } from './text';
import { ASTTransformer } from './parser';
import {
  LayoutConfig, MarkupRenderer, anchorPoint, applyOpacity, elementAnchor, placeRelative, type OriginMobject, type PartsMobject,
} from './renderer';

/** Slide classes by name, as `[[subslide: Name]]` finds them. */
export type SlideNamespace = Record<string, unknown>;

/** Build what the item on `line` draws: an error in one of its formulas names that line. */
async function located<T>(line: number, build: () => Promise<T>): Promise<T> {
  try {
    return await build();
  } catch (error) {
    if (error instanceof LatexError) throw new MarkupError(error.message, line);
    throw error;
  }
}

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

/** The return choice `skip_return=` or `return_to_parent=` make; null when neither is written. */
function returnChoice(attrs: Record<string, string>): boolean | null {
  if ('return_to_parent' in attrs) return attrs.return_to_parent === 'true';
  if ('skip_return' in attrs) return attrs.skip_return !== 'true';
  return null;
}

/** A compiled markup component using normal local membership and child calls. */
export class MarkupSlide extends Slide {
  readonly spec: SlideSpec;
  readonly renderer: MarkupRenderer;
  readonly animationSteps: AnimationStep[];
  readonly elements = new Map<string, Mobject>();
  readonly movies = new Map<string, RasterMovie | VideoPlay>();
  readonly components = new Map<string, Slide>();
  /** Where a line of the parsed document was written (the document itself, or an imported file). */
  readonly locate: (line: number) => SourceLocation;

  constructor(spec: SlideSpec, options: { renderer: MarkupRenderer; locate?: (line: number) => SourceLocation }) {
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
      returnToParent: returnChoice(spec.attributes),
      transition: (spec.attributes.transition as TransitionMode | undefined) ?? null,
      preview: (spec.attributes.preview ?? 'false') === 'true',
    });
    this.spec = spec;
    this.renderer = options.renderer;
    this.locate = options.locate ?? ((line) => ({ file: '', line }));
    this.source = this.locate(spec.line);
    this.animationSteps = new ASTTransformer().plan(spec);
  }

  override get fadeTime(): number {
    return this.renderer.layout.animationTime;
  }

  /** The `::: notes` of the slide, and of the step, for the tablet. */
  override stopNotes(step: number | null): string {
    return this.spec.notesFor(step);
  }

  /** A stop of this slide's program, whose clip shows the notes of `step` on the tablet. */
  private _stop(ctx: SlideContext, step: number): void {
    ctx.stop();
    const clip = ctx.completedStop();
    if (!clip.notes) clip.notes = this.stopNotes(step);
  }

  /** Lay out content and component previews once in this logical canvas. */
  override async build(ctx: SlideContext): Promise<void> {
    const layout = this.renderer.layout;
    // Effects of the deck's own, played by name or as enter and exit styles, load now: they are
    // made later, when their step plays, without waiting.
    for (const step of this.animationSteps) {
      for (const change of step.changes) {
        const name = change.action === 'effect' ? change.name : change.action === 'show' || change.action === 'hide' ? change.style : undefined;
        const builtIn = change.action === 'effect' ? EFFECT_NAMES : change.action === 'show' ? ENTER_STYLES : EXIT_STYLES;
        if (!name || builtIn.has(name)) continue;
        if (!(await this.renderer.effect(name))) {
          const what = change.action === 'effect' ? 'effect' : change.action === 'show' ? 'enter style' : 'exit style';
          throw new MarkupError(`Unknown ${what} ${JSON.stringify(name)}: not ${[...builtIn].join(', ')} and no ${name}.js or ${name}.ts in the deck's effects folders`, this.spec.line);
        }
      }
    }
    const available = this.width - 2 * layout.margin;
    if (available <= 0) throw new MarkupError('Canvas width must exceed twice the layout margin', this.spec.line);
    await this._layout(
      this.spec.items,
      { left: -this.width / 2 + layout.margin, top: this.height / 2 - layout.margin, width: available, local: new Map() },
      (index, item) => (this.components.get(childKey(index, item)) as Slide).viewport as Mobject,
    );
    // Elements draw in source order, whichever click reveals each one.
    for (const [rank, item] of this.spec.items.entries()) {
      if (item instanceof ElementSpec && this.elements.has(item.id)) setSourceRank(this.elements.get(item.id) as Mobject, rank);
    }
    const focused: Mobject[] = [];
    for (const item of this.spec.items) {
      if (!(item instanceof ElementSpec)) continue;
      const appear = elementStep(item.attributes, item.line);
      if (appear > 0) continue;
      const obj = this.elements.get(item.id) as Mobject;
      if (item.attributes.focus_only === 'true') {
        focused.push(obj);
        continue;
      }
      // step=-1: shown in the parent's view before this slide is first visited, outside the entry fade.
      if (appear < 0) markEarly(obj);
      ctx.add(obj);
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
    // What the flow placed last: where it ends, and its lines when it is text. Paragraphs follow
    // one another with their baselines `layout.paragraphSpacing` interlines apart, as in LaTeX; a
    // text and any other block keep the space two paragraphs have between their lines; two other
    // blocks keep `layout.gap`.
    let previous: { bottom: number; lines: TextLines | null; tight: boolean } | null = null;
    const paragraphGap = (lines: TextLines) => Math.max(0, layout.paragraphSpacing * lines.interline - lines.ascent - lines.descent);
    const elements = new Map<string, ElementSpec>();
    const verticalKeys = new Set([...Object.keys(NEIGHBORS), ...VERTICAL_POSITION, 'at']);
    const pointShapes = ['polyline', 'polygon', 'arc'];
    for (const [index, item] of items.entries()) {
      if (item instanceof EventSpec || item instanceof ActionSpec || item instanceof NextSpec || item instanceof SkipNextSpec) continue;
      if (item instanceof ElementSpec && (CONNECTIONS.has(item.kind) || ATTACHMENTS.has(item.kind))) continue;
      let obj: Mobject;
      let explicit: boolean;
      let position: [number, number, number] | null;
      // Nested list items flow indented by their depth and wrap within the remaining width.
      const indent = item instanceof ElementSpec && item.list ? item.list.depth * layout.listIndent : 0;
      if (item instanceof IncludeSpec || item instanceof CodeSlideSpec) {
        if (!viewportOf) throw new MarkupError('Groups cannot contain includes or subslides', item.line);
        obj = viewportOf(index, item);
        explicit = 'x' in item.attributes || 'y' in item.attributes;
        position = [Number(item.attributes.x ?? 0), Number(item.attributes.y ?? 0), 0];
      } else {
        obj = item instanceof GroupSpec ? await this._buildGroup(item, scope.width) : await located(item.line, () => this.renderer.make(item, Math.max(scope.width - indent, 0.5)));
        if (item.attributes.href) LINKED_OBJECTS.set(obj, item.attributes.href);
        SOURCE_OBJECTS.set(obj, this.locate(item.line));
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
      const tightItem = item instanceof ElementSpec && Boolean(item.list?.tight);
      const flowPlacement = () => {
        obj.moveTo([scope.left + indent + obj.getWidth() / 2, cursor - obj.getHeight() / 2, 0]);
        if (previous === null) return;
        const lines = textLines(obj);
        let shift: number;
        if (lines && previous.lines) {
          // Between the two texts' lines, the gap of two lines of type and the extra part of the
          // paragraph spacing, by the larger interline: of one size, their baselines are
          // `paragraphSpacing` interlines apart; a heading keeps its descent clear without spreading
          // the paragraph after it. The items of a tight list, with no blank line between them,
          // follow one another as lines.
          const spacing = previous.tight && tightItem ? 1 : layout.paragraphSpacing;
          const lead = Math.max(0, previous.lines.interline - previous.lines.ascent - previous.lines.descent, lines.interline - lines.ascent - lines.descent);
          const gap = (spacing - 1) * Math.max(previous.lines.interline, lines.interline) + lead;
          shift = previous.lines.last - previous.lines.descent - gap - lines.ascent - lines.first;
        } else if (lines) shift = previous.bottom - paragraphGap(lines) - lines.ascent - lines.first;
        else if (previous.lines) shift = previous.lines.last - previous.lines.descent - paragraphGap(previous.lines) - obj.getTop()[1];
        else shift = previous.bottom - layout.gap - obj.getTop()[1];
        obj.shift([0, shift, 0]);
      };
      const advance = () => {
        previous = { bottom: obj.getBottom()[1], lines: textLines(obj), tight: tightItem };
        cursor = previous.bottom - layout.gap;
      };
      if (!explicit) {
        flowPlacement();
        if (flows) advance();
      } else if (item instanceof ElementSpec && pointShapes.includes(item.kind) && item.position === null) {
        // Already at its own coordinates.
      } else if (textLike && anchor !== 'center') {
        // Text keeps its flow position on an omitted axis; the named anchor lands on the given one
        // (a nested list item keeps its indentation to the right of the given x).
        flowPlacement();
        for (const [key, axis] of [['x', 0], ['y', 1]] as const) {
          if (key in attrs) {
            const delta: [number, number, number] = [0, 0, 0];
            delta[axis] = Number(attrs[key]) + (axis === 0 ? indent : 0) - anchorPoint(obj, anchor)[axis];
            obj.shift(delta);
          }
        }
        if (!('y' in attrs) && flows) advance();
      } else {
        // The anchor lands on the given point, an omitted axis defaulting to zero.
        const point = anchorPoint(obj, anchor);
        const target = position as [number, number, number];
        obj.shift([target[0] - point[0], target[1] - point[1], 0]);
      }
    }
    // Elements and, at the top level, includes are placed relative to one another in one order:
    // an include is a reference by the id of the slide it includes, and its frame is what it measures.
    const placed = new Map<string, ElementSpec | IncludeSpec>(elements);
    const frames = new Map<IncludeSpec | CodeSlideSpec, Mobject>();
    if (viewportOf) {
      for (const [index, item] of items.entries()) {
        if (!(item instanceof IncludeSpec || item instanceof CodeSlideSpec)) continue;
        frames.set(item, viewportOf(index, item));
        if (item instanceof IncludeSpec && !placed.has(item.target)) {
          placed.set(item.target, item);
          scope.local.set(item.target, frames.get(item) as Mobject);
        }
      }
    }
    // An offset applies once the item is placed by flow, coordinates or references, and before
    // anything placed against it, which so sees it where it is drawn.
    const offset = (item: ElementSpec | IncludeSpec | CodeSlideSpec, obj: Mobject) => {
      const dx = Number(item.attributes.dx ?? 0);
      const dy = Number(item.attributes.dy ?? 0);
      if (dx || dy) obj.shift([dx, dy, 0]);
    };
    for (const identifier of positionOrder(placed)) {
      const item = placed.get(identifier) as ElementSpec | IncludeSpec;
      const obj = item instanceof IncludeSpec ? (frames.get(item) as Mobject) : (scope.local.get(identifier) as Mobject);
      if (item instanceof IncludeSpec) placeRelative(item, obj, scope.local, layout.gap);
      else placeRelative(item, obj, scope.local, layout.gap, layout.textAnchor);
      offset(item, obj);
    }
    // Code-authored children are no references, nor is an include whose id an element has; they follow the rest.
    for (const [item, frame] of frames) {
      if (item instanceof CodeSlideSpec || placed.get(item.target) !== item) {
        placeRelative(item, frame, scope.local, layout.gap);
        offset(item, frame);
      }
    }
    // The pairs of elements that arrows and lines join, which blobs follow.
    const edges: [string, string][] = [];
    for (const item of items) {
      if (!(item instanceof ElementSpec && CONNECTIONS.has(item.kind))) continue;
      const [from, to] = ['from', 'to'].map((key) => connectionEnd(item.attributes[key], item.line));
      if (!Array.isArray(from) && !Array.isArray(to)) edges.push([from.id, to.id]);
    }
    for (const item of items) {
      if (item instanceof ElementSpec && ATTACHMENTS.has(item.kind)) {
        const obj = await located(item.line, () => this.renderer.attachment(item, scope.local, edges));
        if (item.attributes.href) LINKED_OBJECTS.set(obj, item.attributes.href);
        SOURCE_OBJECTS.set(obj, this.locate(item.line));
        this.elements.set(item.id, obj);
        scope.local.set(item.id, obj);
      }
    }
    const drawn: [ElementSpec, Mobject][] = [];
    for (const item of items) {
      if (item instanceof ElementSpec && CONNECTIONS.has(item.kind)) {
        const obj = await located(item.line, () => this.renderer.connection(item, scope.local));
        drawn.push([item, obj]);
        this.elements.set(item.id, obj);
        scope.local.set(item.id, obj);
      }
    }
    // Where an arrow or a line with halo_bridge crosses one written before it, which it is drawn
    // over, it bridges it: a patch in the background color hides the earlier one beside it.
    const paths = drawn.map(([, obj]) => BRIDGE_PATHS.get(obj) as BridgePath);
    const bridges = findBridges(paths, layout.haloBridgeTolerance);
    for (const [index, [item, plain]] of drawn.entries()) {
      const quads = bridges.get(index);
      const obj = quads ? withBridges(plain, quads, (paths[index].bridge as { color: string }).color) : plain;
      if (item.attributes.href) LINKED_OBJECTS.set(obj, item.attributes.href);
      SOURCE_OBJECTS.set(obj, this.locate(item.line));
      this.elements.set(item.id, obj);
      scope.local.set(item.id, obj);
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
      const style = change.style ?? 'fade';
      const own = (change.action === 'show' ? ENTER_STYLES : EXIT_STYLES).has(style) ? null : this.renderer.customEffect(style, obj, options);
      return own ?? (change.action === 'show' ? enterAnimation(style, obj, options) : exitAnimation(style, obj, options));
    }
    const obj = this._actionTarget(change.target);
    if (change.action === 'animate') return new PropertyAnimation(obj, this._propertyTargets(change, obj), options);
    if (change.action === 'effect') {
      const opts = change.options ?? {};
      const effectOptions = {
        ...options,
        ...(opts.color ? { color: parseColor(opts.color) } : {}),
        ...(opts.scale ? { scale: Number(opts.scale) } : {}),
      };
      return this.renderer.customEffect(change.name as string, obj, effectOptions) ?? makeEffect(change.name as string, obj, effectOptions);
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
        const range = parseTremble(item.attributes.tremble, Math.max(0, elementStep(item.attributes, item.line)), item.line);
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
      if (reveal || finite.length) this._stop(ctx, step);
      // The reveal (or the entry stop before the slide's program) runs straight into the loop.
      MarkupSlide._autoAdvance(ctx);
      await ctx.play(...looping);
    }
    this._stop(ctx, step);
    if (looping.length) ctx.completedStop().loop = true;
  }

  /** After a pause recorded by the runtime (a return from a child), keep trembling elements moving. */
  private async _loopIdle(ctx: SlideContext, step: number): Promise<void> {
    const tremblers = this._tremblers(ctx, step);
    if (!tremblers.length) return;
    MarkupSlide._autoAdvance(ctx);
    await ctx.play(...tremblers);
    this._stop(ctx, step);
    ctx.completedStop().loop = true;
  }

  /** Execute planned clicks and resume after visits through the slide runtime. */
  override async *construct(ctx: SlideContext): AsyncGenerator<ReturnType<SlideContext['visit']>> {
    const presenter = ctx.presenter;
    // Every stop remembers the line it shows: the slide's own until a numbered step names another.
    ctx.source(this.source);
    if (!presenter.config.pauseOnEntry) this._stop(ctx, 0);
    const entry = this.animationSteps.find((step) => step.number === 0) ?? null;
    if (entry) {
      if (entry.autoNext) MarkupSlide._autoAdvance(ctx);
      if (entry.skipNext) ctx.skipNext();
    }
    const initialMovies = this.spec.items
      .filter((item): item is ElementSpec => item instanceof ElementSpec && this.movies.has(item.id) && elementStep(item.attributes, item.line) <= 0)
      .map((item) => item.id);
    if ((initialMovies.length || this._tremblers(ctx, 0).length) && !presenter.consumeSkipNext()) {
      await this._playContinuous(ctx, initialMovies, 0, false);
      if (entry && entry.autoNext) MarkupSlide._autoAdvance(ctx);
    }
    for (const step of this.animationSteps) {
      if (step.number === 0) continue;
      ctx.source(this.locate(step.line));
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
          if (!presenter.config.pauseOnReturn) this._stop(ctx, step.number);
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

/** What a slide builder is made with: the layout, or a renderer to share. */
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

  /**
   * Link markup slides and instantiate fresh imports from `namespace`. `locate` maps a line of
   * the parsed document to the file and line it was written in, for editor jumps.
   */
  build(
    document: MarkupDocument,
    options: {
      namespace?: SlideNamespace | null; macros?: Record<string, MacroDefinition>; assets?: Record<string, string>; locate?: (line: number) => SourceLocation;
      paths?: string[]; artworks?: string[]; artworkModules?: Record<string, ArtworkModule>;
      fonts?: string[]; effects?: string[]; charts?: string[]; languages?: string[]; codeThemes?: string[]; directives?: string[];
      effectModules?: Record<string, EffectModule>; chartModules?: Record<string, ChartModule>; directiveModules?: Record<string, DirectiveModule>;
      /** The documents `[[pdf: file #id]]` placed, loaded ahead, by id. */
      documents?: Map<string, Slide>;
      /** The deck's background color, which halo bridges take unless they name another. */
      background?: string;
    } = {},
  ): Slide {
    document = new ASTTransformer().validate(document);
    const renderer = this.renderer ?? new MarkupRenderer({
      layout: this.layout, basePath: document.basePath, macros: options.macros, assets: options.assets, background: options.background,
      paths: options.paths, artworks: options.artworks, artworkModules: options.artworkModules,
      fonts: options.fonts, effects: options.effects, charts: options.charts, languages: options.languages, codeThemes: options.codeThemes,
      directives: options.directives, effectModules: options.effectModules, chartModules: options.chartModules, directiveModules: options.directiveModules,
    });
    const locate = options.locate ?? ((line: number) => ({ file: '', line }));
    this.slides = new Map(
      document.slides.map((slide) => [
        slide.id,
        slide.placeholder
          ? options.documents?.get(slide.id) ?? new PlaceholderSlide(slide.id, { label: slide.attributes.src ? `${slide.attributes.src}\nPDF not loaded` : `#${slide.id}\nNot defined`, size: renderer.layout.defaultSlideSize })
          : new MarkupSlide(slide, { renderer, locate }),
      ]),
    );
    const definitions = new Map(document.slides.map((slide) => [slide.id, slide]));
    const order = [...document.roots];
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
        // A code-authored child has no definition in the document; its directive stands for it.
        child.placement = locate(item.line);
        if (item instanceof CodeSlideSpec) child.source = child.placement;
        const attrs = item.attributes;
        if ('only_this' in attrs) child.onlyThis = attrs.only_this === 'true';
        if ('start_here' in attrs) child.startHere = attrs.start_here === 'true';
        if ('skip_return' in attrs || 'return_to_parent' in attrs) child.returnToParent = returnChoice(attrs);
        if ('transition' in attrs) child.transition = attrs.transition as TransitionMode;
        if ('preview' in attrs) child.preview = attrs.preview === 'true';
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
        if (child.viewport) SOURCE_OBJECTS.set(child.viewport as unknown as Mobject, child.placement);
      }
    }
    // Several top-level slides are the pages of a flat document, under a hidden root that is never a stop.
    const root = document.sequence ? pageSequence(document.roots.map((id) => this.slides.get(id) as Slide)) : this.slides.get(document.root) as Slide;
    try {
      startingSlide(root);
    } catch (error) {
      throw new MarkupError((error as Error).message);
    }
    return root;
  }
}
