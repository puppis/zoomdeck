/**
 * Create engine objects for markup elements, with a replaceable rendering
 * policy. Prose uses canvas typography, math uses MathJax through the engine's
 * `MathTex`, images resolve against the document's base URL.
 */
import {
  Arc, Arrow, Brace, Circle, Dot, Ellipse, Group, Line, MathTex, Polygon, Rectangle, RoundedRectangle, VMobject,
  type Mobject,
} from 'manim-web';
import { loadSvgMobject } from '../svg';
import { sketch, sketchSeed, type FillStyle, type OutlineMobject, type SketchOptions } from '../sketch';
import { makeIcon, type IconName } from '../icons';
import { blobMobject, type Rect } from '../blob';
import { buildChart, parseChartData, type ChartType } from '../charts';
import { buildTable, type TableRules } from './table';
import { DEFAULT_ANIMATION_TIME, Slide, resolveSize } from '../slides';
import { RasterImage, RasterSource } from '../raster';
import { VideoClip } from '../video';
import { IframeHost } from './iframe';
import {
  ALIGNMENTS, BRACE_SIDES, CONNECTIONS, GROUP_ANCHORS, NEIGHBORS, POSITION_REFERENCES, SHAPES, TEXT_ANCHORS, TEXT_LIKE, VIDEO_EXTENSIONS,
  ElementSpec, CodeSlideSpec, IncludeSpec, InlineSpan, MarkupError, TableSpec, attachmentTargets, endpoint, numberValue, parseAt, parseColor,
  polylinePoints, span,
} from './ast';
import { MarkupParser } from './parser';
import { MONOSPACE, baselineY, layoutParagraph, type MathPiece } from './text';
import { layoutCode } from './code';
import { DEFAULT_TEXT_FONT } from '../fonts';
import { applyLatexColors, preprocessLatex } from './latex';

/** Formula pixel size per prose point, so that `font_size` means the same for both. */
export const MATH_SIZE_RATIO = 4 / 3;

export interface LayoutConfigOptions {
  fontSize?: number;
  headingSize?: number;
  /** Font size of code listings; defaults to 80% of `fontSize`. */
  codeSize?: number;
  color?: string;
  font?: string;
  /** Monospace font family for inline code and listings. */
  codeFont?: string;
  margin?: number;
  gap?: number;
  lineGap?: number;
  animationTime?: number;
  defaultSlideSize?: readonly [number, number];
  textAnchor?: 'left-baseline' | 'top-left' | 'center';
}

/** Defaults for deterministic text flow within fixed slide coordinates. */
export class LayoutConfig {
  readonly fontSize: number;
  readonly headingSize: number;
  readonly codeSize: number;
  readonly color: string;
  readonly font: string;
  readonly codeFont: string;
  readonly margin: number;
  readonly gap: number;
  readonly lineGap: number;
  readonly animationTime: number;
  readonly defaultSlideSize: readonly [number, number];
  readonly textAnchor: 'left-baseline' | 'top-left' | 'center';

  constructor(options: LayoutConfigOptions = {}) {
    this.fontSize = options.fontSize ?? 28;
    this.headingSize = options.headingSize ?? 42;
    this.codeSize = options.codeSize ?? this.fontSize * 0.8;
    this.color = parseColor(options.color ?? '#000000');
    this.font = options.font ?? '';
    this.codeFont = options.codeFont ?? '';
    this.margin = options.margin ?? 0.65;
    this.gap = options.gap ?? 0.35;
    this.lineGap = options.lineGap ?? 0.12;
    this.animationTime = options.animationTime ?? DEFAULT_ANIMATION_TIME;
    this.defaultSlideSize = options.defaultSlideSize ?? Slide.defaultSize;
    this.textAnchor = options.textAnchor ?? 'left-baseline';
    resolveSize(null, null, this.defaultSlideSize);
    if (!TEXT_ANCHORS.has(this.textAnchor)) throw new Error('textAnchor must be left-baseline, top-left or center');
    for (const key of ['fontSize', 'headingSize', 'codeSize', 'animationTime'] as const) {
      if (!Number.isFinite(this[key]) || this[key] <= 0) throw new Error(`${key} must be finite and positive`);
    }
    for (const key of ['margin', 'gap', 'lineGap'] as const) {
      if (!Number.isFinite(this[key]) || this[key] < 0) throw new Error(`${key} must be finite and nonnegative`);
    }
  }

  /** CSS font family used for prose: the configured font, else the bundled Latin Modern Roman. */
  get fontFamily(): string {
    return this.font ? `"${this.font.replace(/"/g, '')}", "${DEFAULT_TEXT_FONT}", serif` : `"${DEFAULT_TEXT_FONT}", serif`;
  }

  /** CSS font family for an element: its `font=` face in front of the prose family. */
  fontFamilyFor(font: string | undefined): string {
    return font ? `"${font.replace(/"/g, '')}", ${this.fontFamily}` : this.fontFamily;
  }

  /** CSS font family used for code listings. */
  get codeFontFamily(): string {
    return this.codeFont ? `"${this.codeFont.replace(/"/g, '')}", ${MONOSPACE}` : MONOSPACE;
  }
}

export type AnyMobject = Mobject & { markupBaselineFraction?: number };

/** Hand-drawn options of an element with `sketch=true`, or null when it is drawn crisply. */
export function sketchOptions(
  element: ElementSpec,
  style: { color: string; strokeWidth: number; fillColor: string; fillOpacity: number },
  defaultFillStyle?: FillStyle,
): SketchOptions | null {
  const attrs = element.attributes;
  if (attrs.sketch !== 'true') return null;
  const optional = (key: string) => (key in attrs ? Number(attrs[key]) : undefined);
  return {
    ...style,
    fillStyle: (attrs.fill_style as FillStyle | undefined) ?? defaultFillStyle,
    roughness: optional('roughness'),
    bowing: optional('bowing'),
    hachureAngle: optional('hachure_angle'),
    hachureGap: optional('hachure_gap'),
    fillWeight: optional('fill_weight'),
    // Without a seed the look is still stable across reloads: it follows the element's identity.
    seed: optional('seed') ?? sketchSeed(`${element.id}@${element.line}`),
  };
}

/** The hand-drawn counterpart of a crisp shape, remembering the exact geometry for paths. */
function sketchShape(element: ElementSpec, crisp: VMobject, options: SketchOptions): Mobject {
  const attrs = element.attributes;
  let rough;
  switch (element.kind) {
    case 'rectangle':
      rough = sketch.rectangle(Number(attrs.width), Number(attrs.height), options, Number(attrs.corner_radius ?? 0));
      break;
    case 'circle':
      rough = sketch.circle(Number(attrs.radius), options);
      break;
    case 'dot':
      rough = sketch.circle(Number(attrs.radius ?? 0.08), options);
      break;
    case 'ellipse':
      rough = sketch.ellipse(Number(attrs.width), Number(attrs.height), options);
      break;
    case 'polygon':
      rough = sketch.polygon(polylinePoints(attrs.points, element.line, 3), options);
      break;
    case 'arc':
      rough = sketch.arc([Number(attrs.x ?? 0), Number(attrs.y ?? 0)], Number(attrs.radius), Number(attrs.start_angle ?? 0), Number(attrs.angle), options);
      break;
    default:
      rough = sketch.polyline(polylinePoints(attrs.points, element.line), options);
  }
  (rough as OutlineMobject).markupOutline = crisp;
  return rough;
}

/** The anchor name an item is positioned by: its `anchor` attribute, else the text default or the center. */
export function elementAnchor(item: ElementSpec | IncludeSpec | CodeSlideSpec, textAnchor = 'left-baseline'): string {
  const explicit = item.attributes.anchor;
  if (explicit) return explicit;
  return item instanceof ElementSpec && TEXT_LIKE.has(item.kind) ? textAnchor : 'center';
}

/** Objects built from a group remember where their local origin sits relative to their center. */
export type OriginMobject = Mobject & { markupOrigin?: [number, number] };

/** Composite objects name the parts a blob should flow around separately (group members, an icon and its label). */
export type PartsMobject = Mobject & { markupParts?: Mobject[] };

/** The rectangles a blob encloses for an object: its parts' rectangles, else its own bounding box. */
export function enclosedRects(obj: Mobject): Rect[] {
  const parts = (obj as PartsMobject).markupParts;
  if (parts && parts.length) return parts.flatMap(enclosedRects);
  const [x, y] = obj.getCenter();
  const width = obj.getWidth();
  const height = obj.getHeight();
  if (!(width > 0) && !(height > 0)) return [];
  return [{ x, y, width, height }];
}

/** The axis-aligned bounding box of several objects together. */
export function unionRect(objects: readonly Mobject[]): Rect {
  const rects = objects.map((obj) => {
    const [x, y] = obj.getCenter();
    return { x, y, width: obj.getWidth(), height: obj.getHeight() };
  });
  const left = Math.min(...rects.map((r) => r.x - r.width / 2));
  const right = Math.max(...rects.map((r) => r.x + r.width / 2));
  const bottom = Math.min(...rects.map((r) => r.y - r.height / 2));
  const top = Math.max(...rects.map((r) => r.y + r.height / 2));
  return { x: (left + right) / 2, y: (bottom + top) / 2, width: right - left, height: top - bottom };
}

/** A named point of an object's current geometry (see `ANCHORS`; `origin` for groups). */
export function anchorPoint(obj: Mobject, anchor: string): [number, number, number] {
  if (!GROUP_ANCHORS.has(anchor)) throw new Error(`Unknown anchor ${JSON.stringify(anchor)}`);
  const center = obj.getCenter();
  if (anchor === 'origin') {
    const origin = (obj as OriginMobject).markupOrigin;
    return origin ? [center[0] + origin[0], center[1] + origin[1], center[2]] : center;
  }
  const halfWidth = obj.getWidth() / 2;
  const halfHeight = obj.getHeight() / 2;
  const x = anchor.includes('left') ? center[0] - halfWidth : anchor.includes('right') ? center[0] + halfWidth : center[0];
  const y = anchor.includes('baseline') ? baselineY(obj)
    : anchor.includes('top') ? center[1] + halfHeight
    : anchor.includes('bottom') ? center[1] - halfHeight
    : center[1];
  return [x, y, center[2]];
}

/** Return an item's anchor point from current geometry, including uniform text scaling. */
export function positionAnchor(item: ElementSpec | IncludeSpec | CodeSlideSpec, obj: Mobject, textAnchor = 'left-baseline'): [number, number, number] {
  return anchorPoint(obj, elementAnchor(item, textAnchor));
}

/** Set a uniform opacity on a whole object: texture and stroke opacity plus scaled fills. */
export function applyOpacity(obj: Mobject, opacity: number): void {
  obj.opacity = opacity;
  for (const member of obj.getFamily()) {
    if (member instanceof VMobject) member.setFillOpacity(member.fillOpacity * opacity);
  }
}

/** Apply nextTo/alignTo placement in the owning slide's logical coordinates. */
export function placeRelative(
  item: ElementSpec | IncludeSpec | CodeSlideSpec,
  obj: Mobject,
  objects: Map<string, Mobject>,
  gap: number,
  textAnchor = 'left-baseline',
): void {
  const attrs = item.attributes;
  if ('at' in attrs) {
    // One anchor of this object lands on an anchor of another object or on a literal point.
    const at = parseAt(attrs.at, item.line);
    const target = 'point' in at.target
      ? at.target.point
      : anchorPoint(objects.get(at.target.id) as Mobject, at.target.anchor ?? 'center');
    const mine = anchorPoint(obj, at.anchor ?? elementAnchor(item, textAnchor));
    obj.shift([target[0] - mine[0], target[1] - mine[1], 0]);
    return;
  }
  if (!Object.keys(attrs).some((key) => POSITION_REFERENCES.has(key))) return;
  for (const [key, direction] of Object.entries(NEIGHBORS)) {
    if (key in attrs) obj.nextTo(objects.get(attrs[key].slice(1)) as Mobject, direction, Number(attrs.buff ?? gap));
  }
  for (const [key, direction] of Object.entries(ALIGNMENTS)) {
    if (key in attrs) obj.alignTo(objects.get(attrs[key].slice(1)) as Mobject, direction);
  }
  if ('baseline-aligned' in attrs) {
    const reference = objects.get(attrs['baseline-aligned'].slice(1)) as Mobject;
    obj.shift([0, baselineY(reference) - baselineY(obj), 0]);
  }
  // An explicit coordinate may override the otherwise centered orthogonal axis.
  for (const [key, axis] of [['x', 0], ['y', 1]] as const) {
    if (key in attrs) {
      const point = positionAnchor(item, obj, textAnchor);
      const delta: [number, number, number] = [0, 0, 0];
      delta[axis] = Number(attrs[key]) - point[axis];
      obj.shift(delta);
    }
  }
}

export interface MarkupRendererOptions {
  layout?: LayoutConfig;
  /** Base URL for images; relative paths resolve against it. */
  basePath?: string;
  /** Optional LaTeX macros passed to MathJax. */
  macros?: Record<string, string>;
  /** Preloaded assets keyed by document-relative path, e.g. data URIs in single-file bundles. */
  assets?: Record<string, string>;
}

/** Create engine objects for AST elements. Subclass `make` to customize. */
export class MarkupRenderer {
  readonly layout: LayoutConfig;
  readonly basePath: string;
  readonly macros: Record<string, string> | undefined;
  readonly assets: Record<string, string>;
  private readonly _parser = new MarkupParser();
  private readonly _sources = new Map<string, Promise<RasterSource>>();

  constructor(options: MarkupRendererOptions = {}) {
    this.layout = options.layout ?? new LayoutConfig();
    this.basePath = options.basePath ?? '';
    this.macros = options.macros;
    this.assets = options.assets ?? {};
  }

  /** Resolve an asset path relative to the document. */
  resolveUrl(path: string): string {
    const preloaded = this.assets[path] ?? this.assets[path.replace(/^\.\//, '')];
    if (preloaded) return preloaded;
    if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('/')) return path;
    const base = this.basePath || (typeof location !== 'undefined' ? location.href : '');
    try {
      return new URL(path, base).href;
    } catch {
      return path;
    }
  }

  private _rasterSource(path: string): Promise<RasterSource> {
    const url = this.resolveUrl(path);
    let pending = this._sources.get(url);
    if (!pending) {
      pending = RasterSource.load(url);
      this._sources.set(url, pending);
    }
    return pending;
  }

  /** Render a math object with its left edge at x = 0 and baseline at y = 0. */
  async mathPiece(latex: string, color: string, fontSize: number): Promise<MathPiece> {
    const [obj, probe] = await Promise.all([
      this._mathTex(latex, color, fontSize),
      this._mathTex(['\\mathrm{H}', latex], color, fontSize),
    ]);
    let baseline = probe.getPart(0).getBottom()[1];
    const probeHeight = probe.getHeight();
    probe.remove(probe.getPart(0));
    let center = probe.isEmpty() ? [0, 0, 0] : probe.getCenter();
    const height = probe.isEmpty() ? probeHeight : probe.getHeight();
    const fraction = height > 0 ? (baseline - center[1]) / height : 0;
    const left = obj.getLeft()[0];
    const objCenterY = obj.getCenter()[1];
    const objHeight = obj.getHeight();
    baseline = objCenterY + fraction * objHeight;
    obj.shift([-left, -baseline, 0]);
    (obj as AnyMobject).markupBaselineFraction = fraction;
    const top = obj.getTop()[1];
    const bottom = obj.getBottom()[1];
    return { mobject: obj, advance: obj.getWidth(), ascent: Math.max(0, top), descent: Math.max(0, -bottom) };
  }

  private async _mathTex(latex: string | string[], color: string, fontSize: number): Promise<MathTex> {
    const processed = Array.isArray(latex) ? latex.map(preprocessLatex) : preprocessLatex(latex);
    // Prose sizes are points (an em of fontSize * 4/3 canvas pixels); the engine sizes formulas in
    // pixels. Scaling by 4/3 gives formulas and prose of the same `fontSize` the same em.
    const tex = new MathTex({ latex: processed, color, fontSize: fontSize * MATH_SIZE_RATIO, macros: this.macros });
    await tex.waitForRender();
    applyLatexColors(tex);
    return tex;
  }

  /** Create one local mobject; connections follow anchor layout. */
  async make(element: ElementSpec, maxWidth: number): Promise<Mobject> {
    const attrs = element.attributes;
    const defaultSize = element.kind === 'code' ? this.layout.codeSize
      : element.level ? this.layout.headingSize / (1 + 0.12 * Math.max(0, element.level - 1)) : this.layout.fontSize;
    const size = numberValue(attrs, 'font_size', element.line, defaultSize) as number;
    const width = numberValue(attrs, 'width', element.line, maxWidth) as number;
    const color = attrs.color ? parseColor(attrs.color) : this.layout.color;
    let obj: Mobject;
    if (element.kind === 'iframe') {
      const boxWidth = Number(attrs.width);
      const boxHeight = Number(attrs.height);
      const box = new Rectangle({ width: boxWidth, height: boxHeight });
      box.setStyle({ strokeColor: color, strokeWidth: 2 });
      box.setFill(color, 0.06);
      const caption = attrs.title ?? element.source;
      let inside: Mobject | null = null;
      if (attrs.poster) {
        // A still of the page for previews; it is scaled to fit inside the slide.
        inside = await this.loadImage(attrs.poster, boxWidth - 0.1, element.line);
        if (inside.getHeight() > boxHeight - 0.1 && inside.getHeight() > 0) inside.scaleToFitHeight(boxHeight - 0.1);
      } else {
        const label = await this.text([{ content: caption, kind: 'code', bold: false, italic: false, color: null }], this.layout.fontSize * 0.7, boxWidth - 0.4, color);
        if (label.getWidth() > 0) inside = label;
      }
      inside?.moveTo([0, 0, 0]);
      obj = new IframeHost(this.resolveUrl(element.source), box, inside, caption);
    } else if (element.kind === 'image' && VIDEO_EXTENSIONS.test(element.source)) {
      const video = new VideoClip(this.resolveUrl(element.source), { width, muted: attrs.muted !== 'false' });
      try {
        await video.waitForLoad();
      } catch (error) {
        throw new MarkupError(`Video not found: ${element.source} (${(error as Error).message})`, element.line);
      }
      obj = video;
    } else if (element.kind === 'image') {
      if (/\.svg(?:[?#].*)?$/i.test(element.source)) {
        try {
          obj = await loadSvgMobject(this.resolveUrl(element.source), { width, defaultColor: this.layout.color });
        } catch (error) {
          throw new MarkupError(`Image not found: ${element.source} (${(error as Error).message})`, element.line);
        }
      } else {
        let source: RasterSource;
        try {
          source = await this._rasterSource(element.source);
        } catch (error) {
          throw new MarkupError(`Image not found: ${element.source} (${(error as Error).message})`, element.line);
        }
        const image = new RasterImage(source, { width });
        await image.waitForLoad();
        obj = image;
      }
    } else if (SHAPES.has(element.kind)) {
      if (element.kind === 'rectangle') {
        const radius = Number(attrs.corner_radius ?? 0);
        obj = radius
          ? new RoundedRectangle({ width: Number(attrs.width), height: Number(attrs.height), cornerRadius: radius })
          : new Rectangle({ width: Number(attrs.width), height: Number(attrs.height) });
      } else if (element.kind === 'circle') {
        obj = new Circle({ radius: Number(attrs.radius) });
      } else if (element.kind === 'dot') {
        obj = new Dot({ radius: Number(attrs.radius ?? 0.08) });
      } else if (element.kind === 'ellipse') {
        obj = new Ellipse({ width: Number(attrs.width), height: Number(attrs.height) });
      } else if (element.kind === 'polygon') {
        obj = new Polygon({ vertices: polylinePoints(attrs.points, element.line, 3), closed: true });
      } else if (element.kind === 'arc') {
        obj = new Arc({
          radius: Number(attrs.radius), startAngle: Number(attrs.start_angle ?? 0), angle: Number(attrs.angle),
          center: [Number(attrs.x ?? 0), Number(attrs.y ?? 0), 0],
        });
      } else {
        obj = new VMobject().setPointsAsCorners(polylinePoints(attrs.points, element.line));
      }
      const shape = obj as VMobject;
      const strokeWidth = Number(attrs.stroke_width ?? 2);
      const fillColor = attrs.fill_color ? parseColor(attrs.fill_color) : color;
      const fillOpacity = Number(attrs.fill_opacity ?? (element.kind === 'dot' ? 1 : 0));
      // Setting the stroke color through setStyle also resets the fill color, so apply the fill afterwards.
      shape.setStyle({ strokeColor: color, strokeWidth });
      shape.setFill(fillColor, fillOpacity);
      const sketchy = sketchOptions(element, { color, strokeWidth, fillColor, fillOpacity }, element.kind === 'dot' ? 'solid' : undefined);
      if (sketchy) obj = sketchShape(element, shape, sketchy);
    } else if (element.kind === 'icon') {
      const strokeWidth = Number(attrs.stroke_width ?? 2);
      const fillColor = attrs.fill_color ? parseColor(attrs.fill_color) : color;
      const fillOpacity = Number(attrs.fill_opacity ?? 0);
      const icon = makeIcon(element.source as IconName, {
        size: numberValue(attrs, 'size', element.line, 1) as number,
        color, strokeWidth, fillColor, fillOpacity,
        sketch: sketchOptions(element, { color, strokeWidth, fillColor, fillOpacity }),
      });
      obj = icon;
      if (attrs.label) {
        const label = await this.text(this._parser.parseInlineSpans(attrs.label, element.line), size * 0.8, 6, color, attrs.font);
        const side = attrs.label_side ?? 'below';
        const direction = { below: [0, -1, 0], above: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0] }[side] as [number, number, number];
        label.nextTo(icon, direction, 0.15);
        const group = new Group(icon, label) as PartsMobject;
        group.markupParts = [icon, label];
        obj = group;
      }
    } else if (element.kind === 'table') {
      const table = element as TableSpec;
      const optional = (key: string) => (key in attrs ? Number(attrs[key]) : undefined);
      const borderColor = attrs.border_color ? parseColor(attrs.border_color) : color;
      obj = await buildTable(table.rows, {
        fontSize: size,
        color,
        aligns: table.aligns,
        header: attrs.header !== 'false',
        padding: optional('padding'),
        rules: attrs.rules as TableRules | undefined,
        borderColor,
        strokeWidth: optional('stroke_width'),
        fillColor: attrs.fill_color ? parseColor(attrs.fill_color) : undefined,
        fillOpacity: optional('fill_opacity'),
        headerColor: attrs.header_color ? parseColor(attrs.header_color) : undefined,
        headerOpacity: optional('header_opacity'),
        stripeOpacity: optional('stripe_opacity'),
        maxWidth: width,
        sketch: sketchOptions(element, { color: borderColor, strokeWidth: optional('stroke_width') ?? 1.5, fillColor: borderColor, fillOpacity: 0 }, 'solid'),
      }, (spans, fontSize, maxWidth) => this.text(spans, fontSize, maxWidth, color, attrs.font));
    } else if (element.kind === 'chart') {
      let data;
      try {
        data = parseChartData(element.source, 'header' in attrs ? attrs.header === 'true' : undefined);
      } catch (error) {
        throw new MarkupError(`Chart data: ${(error as Error).message}`, element.line);
      }
      const optional = (key: string) => (key in attrs ? Number(attrs[key]) : undefined);
      const flag = (key: string) => (key in attrs ? attrs[key] === 'true' : undefined);
      const colors = attrs.colors ? attrs.colors.split(/[\s,]+/).filter(Boolean).map(parseColor) : undefined;
      const borderColor = attrs.border_color ? parseColor(attrs.border_color) : undefined;
      const sketchy = sketchOptions(element, { color, strokeWidth: optional('stroke_width') ?? 2, fillColor: color, fillOpacity: optional('fill_opacity') ?? 0.85 }, 'solid');
      try {
        obj = await buildChart(data, {
          type: (attrs.type as ChartType | undefined) ?? 'bar',
          width: numberValue(attrs, 'width', element.line, 6) as number,
          height: numberValue(attrs, 'height', element.line, 3.5) as number,
          colors,
          color,
          axisColor: attrs.axis_color ? parseColor(attrs.axis_color) : undefined,
          borderColor,
          fillOpacity: optional('fill_opacity'),
          strokeWidth: optional('stroke_width'),
          fontSize: size * 0.75,
          grid: flag('grid'),
          legend: flag('legend'),
          values: flag('values'),
          min: optional('min'),
          max: optional('max'),
          sketch: sketchy,
        }, (text, fontSize, labelColor) => this.text([span(text)], fontSize, 20, labelColor, attrs.font));
      } catch (error) {
        if (error instanceof MarkupError) throw error;
        throw new MarkupError(`Chart: ${(error as Error).message}`, element.line);
      }
    } else if (element.kind === 'math') {
      const piece = await this.mathPiece(element.source, color, size);
      obj = piece.mobject;
      if (obj.getWidth() > width) obj.scale(width / obj.getWidth());
    } else if (element.kind === 'text') {
      obj = await this.text(element.spans, size, width, color, attrs.font);
    } else if (element.kind === 'code') {
      obj = this.code(element.source, attrs.lang ?? '', size, width, color);
    } else {
      throw new MarkupError(`Unsupported rendered element kind ${JSON.stringify(element.kind)}`, element.line);
    }
    const height = numberValue(attrs, 'height', element.line);
    if (!SHAPES.has(element.kind) && !['icon', 'chart'].includes(element.kind) && height !== null && obj.getHeight() > 0) obj.scaleToFitHeight(height);
    if ('opacity' in attrs) applyOpacity(obj, Number(attrs.opacity));
    return obj;
  }

  /** Load an SVG or raster image at `width` logical units. */
  async loadImage(source: string, width: number, line: number): Promise<Mobject> {
    if (/\.svg(?:[?#].*)?$/i.test(source)) {
      try {
        return await loadSvgMobject(this.resolveUrl(source), { width, defaultColor: this.layout.color });
      } catch (error) {
        throw new MarkupError(`Image not found: ${source} (${(error as Error).message})`, line);
      }
    }
    let raster: RasterSource;
    try {
      raster = await this._rasterSource(source);
    } catch (error) {
      throw new MarkupError(`Image not found: ${source} (${(error as Error).message})`, line);
    }
    const image = new RasterImage(raster, { width });
    await image.waitForLoad();
    return image;
  }

  /** Create a brace, a surrounding box or a blob around already laid-out elements. */
  async attachment(element: ElementSpec, objects: Map<string, Mobject>): Promise<Mobject> {
    const attrs = element.attributes;
    const targets = attachmentTargets(element).map((id) => objects.get(id) as Mobject);
    const target = targets[0];
    const color = attrs.color ? parseColor(attrs.color) : this.layout.color;
    const strokeWidth = Number(attrs.stroke_width ?? 2);
    const buff = Number(attrs.buff ?? (element.kind === 'blob' ? 0.3 : 0.15));
    let obj: Mobject;
    if (element.kind === 'blob') {
      const fillColor = attrs.fill_color ? parseColor(attrs.fill_color) : color;
      const fillOpacity = Number(attrs.fill_opacity ?? 0);
      const rects = targets.flatMap(enclosedRects);
      if (!rects.length) throw new MarkupError('A blob needs targets with a visible size', element.line);
      const blob = blobMobject(rects, { buff, smoothness: numberValue(attrs, 'smoothness', element.line, 0.5) as number });
      blob.setStyle({ strokeColor: color, strokeWidth });
      blob.setFill(fillColor, fillOpacity);
      obj = blob;
      const sketchy = sketchOptions(element, { color, strokeWidth, fillColor, fillOpacity });
      if (sketchy) obj = sketch.of(blob, sketchy);
    } else if (element.kind === 'brace') {
      const side = attrs.side ?? 'bottom';
      const direction = BRACE_SIDES[side];
      const sketchy = sketchOptions(element, { color, strokeWidth, fillColor: color, fillOpacity: 0 });
      let brace: Mobject;
      if (sketchy) {
        // A hand-drawn brace is a single stroke along the brace's centerline, turned to face its side.
        const horizontal = side === 'bottom' || side === 'top';
        const span = horizontal ? target.getWidth() : target.getHeight();
        brace = sketch.brace(span, Math.min(0.3, span / 4), sketchy);
        brace.rotate({ bottom: 0, top: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 }[side] as number);
        brace.nextTo(target, direction, buff);
      } else brace = new Brace(target, { direction, buff, color, strokeWidth });
      obj = brace;
      if (attrs.label) {
        const size = numberValue(attrs, 'font_size', element.line, this.layout.fontSize * 0.8) as number;
        const text = await this.text(this._parser.parseInlineSpans(attrs.label, element.line), size, 6, color, attrs.font);
        text.nextTo(brace, direction, 0.1);
        obj = new Group(brace, text);
      }
    } else {
      const cornerRadius = Number(attrs.corner_radius ?? 0);
      const fillColor = attrs.fill_color ? parseColor(attrs.fill_color) : color;
      const fillOpacity = Number(attrs.fill_opacity ?? 0);
      // The box surrounds the joint bounding box of all its targets.
      const bounds = unionRect(targets);
      const width = bounds.width + 2 * buff;
      const height = bounds.height + 2 * buff;
      const box: VMobject = cornerRadius > 0
        ? new RoundedRectangle({ width, height, cornerRadius: Math.min(cornerRadius, width / 2, height / 2) })
        : new Rectangle({ width, height });
      box.moveTo([bounds.x, bounds.y, 0]);
      box.setStyle({ strokeColor: color, strokeWidth });
      box.setFill(fillColor, fillOpacity);
      obj = box;
      const sketchy = sketchOptions(element, { color, strokeWidth, fillColor, fillOpacity });
      if (sketchy) {
        const rough = sketch.rectangle(box.getWidth(), box.getHeight(), sketchy, cornerRadius);
        rough.moveTo(box.getCenter());
        (rough as OutlineMobject).markupOutline = box;
        obj = rough;
      }
    }
    if ('opacity' in attrs) applyOpacity(obj, Number(attrs.opacity));
    return obj;
  }

  /** Lay out styled prose with inline math within `maxWidth` logical units. */
  async text(spans: InlineSpan[], fontSize: number, maxWidth: number, defaultColor: string, font?: string): Promise<Mobject> {
    if (!spans.some((s) => s.content.trim())) return new Group();
    // Span colors may be palette names; the canvas and MathJax need hex values.
    const resolved = spans.map((s) => (s.color ? { ...s, color: parseColor(s.color) } : s));
    return layoutParagraph(
      resolved,
      { fontSize, maxWidth, defaultColor, fontFamily: this.layout.fontFamilyFor(font), lineGap: this.layout.lineGap },
      (latex, color) => this.mathPiece(latex, color, fontSize),
    );
  }

  /** Lay out a verbatim listing; it shrinks uniformly when wider than `maxWidth`. */
  code(source: string, language: string, fontSize: number, maxWidth: number, defaultColor: string): Mobject {
    return layoutCode(source, language, {
      fontSize, maxWidth, defaultColor, lineGap: this.layout.lineGap, fontFamily: this.layout.codeFontFamily,
    });
  }

  /** Create an arrow or line between laid-out objects or fixed coordinates. */
  async connection(element: ElementSpec, objects: Map<string, Mobject>): Promise<Mobject> {
    const [start, end] = ['from', 'to'].map((key) => endpoint(element.attributes[key], element.line));
    const source = typeof start === 'string' ? (objects.get(start) as Mobject) : null;
    const target = typeof end === 'string' ? (objects.get(end) as Mobject) : null;
    let a = source ? source.getCenter() : (start as [number, number, number]);
    let b = target ? target.getCenter() : (end as [number, number, number]);
    const direction: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const length = Math.hypot(...direction);
    if (length < 1e-9) throw new MarkupError('Arrow endpoints must have distinct positions', element.line);
    if (source) a = source.getEdge(direction);
    if (target) b = target.getEdge([-direction[0], -direction[1], -direction[2]]);
    const color = element.attributes.color ? parseColor(element.attributes.color) : this.layout.color;
    const isArrow = element.kind === 'arrow';
    const buff = isArrow ? 0.08 : 0;
    const unit = direction.map((v) => v / length) as [number, number, number];
    const segment = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const trim = Math.min(buff, segment / 3);
    const start3: [number, number, number] = [a[0] + unit[0] * trim, a[1] + unit[1] * trim, a[2] + unit[2] * trim];
    const end3: [number, number, number] = [b[0] - unit[0] * trim, b[1] - unit[1] * trim, b[2] - unit[2] * trim];
    const strokeWidth = element.kind === 'line' || 'stroke_width' in element.attributes ? Number(element.attributes.stroke_width ?? 2) : undefined;
    const sketchy = sketchOptions(element, { color, strokeWidth: strokeWidth ?? (isArrow ? 4 : 2), fillColor: color, fillOpacity: 0 });
    let connection: Mobject;
    if (sketchy) connection = isArrow ? sketch.arrow(start3, end3, sketchy) : sketch.line(start3, end3, sketchy);
    else if (isArrow) connection = new Arrow({ start: start3, end: end3, color, ...(strokeWidth !== undefined ? { strokeWidth } : {}) });
    else connection = new Line({ start: start3, end: end3, color, strokeWidth: strokeWidth ?? 2 });
    const label = element.attributes.label;
    let result: Mobject = connection;
    if (label) {
      const spans = this._parser.parseInlineSpans(label, element.line);
      const size = numberValue(element.attributes, 'font_size', element.line, this.layout.fontSize * 0.8) as number;
      const text = await this.text(spans, size, 4, this.layout.color, element.attributes.font);
      text.nextTo(connection, [0, 1, 0], 0.1);
      result = new Group(connection, text);
    }
    if ('opacity' in element.attributes) applyOpacity(result, Number(element.attributes.opacity));
    return result;
  }
}

export { CONNECTIONS };
