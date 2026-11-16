/**
 * Create engine objects for markup elements, with a replaceable rendering
 * policy. Prose uses canvas typography, math uses MathJax through the engine's
 * `MathTex`, images resolve against the document's base URL.
 */
import {
  Arc, Arrow, Brace, Circle, Dot, Ellipse, Group, Line, MathTex, Polygon, Rectangle, RoundedRectangle, VGroup, VMobject,
  type Mobject,
} from 'manim-web';
import { loadSvgMobject } from '../svg';
import { dashPattern, dashSegments, sketch, sketchSeed, type FillStyle, type OutlineMobject, type SketchOptions } from '../sketch';
import { artworkFromModule, makeIcon, type ArtworkModule, type ArtworkOptions, type IconName } from '../icons';
import { ICON_KINDS } from './ast';
import { effectFromModule, type EffectModule, type EffectOptions } from '../animations';
import { chartFromModule, chartDataFromJson, CHART_TYPES, type ChartModule } from '../charts';
import { directiveFromModule, type DirectiveModule, type DirectiveOptions } from '../directives';
import { knownLanguage, registerLanguage, type Language } from './tokens';
import { DEFAULT_CODE_FONT, DEFAULT_HANDWRITING_FONT } from '../fonts';
import type { CodeTheme } from './code';
import type { Animation } from 'manim-web';
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

/** The typography and spacing of a deck, as `layout` in `deck.json` gives them. */
export interface LayoutConfigOptions {
  fontSize?: number;
  headingSize?: number;
  /** Font size of code listings; defaults to 80% of `fontSize`. */
  codeSize?: number;
  color?: string;
  font?: string;
  /** Monospace font family for inline code and listings. */
  codeFont?: string;
  /** Name of a code theme, `name.json` in the deck's code-themes folders; the default follows the text color. */
  codeTheme?: string;
  margin?: number;
  gap?: number;
  lineGap?: number;
  /** Indentation of nested list items per level, and the minimum width of the marker column. */
  listIndent?: number;
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
  readonly codeTheme: string;
  readonly margin: number;
  readonly gap: number;
  readonly lineGap: number;
  readonly listIndent: number;
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
    this.codeTheme = options.codeTheme ?? '';
    this.margin = options.margin ?? 0.65;
    this.gap = options.gap ?? 0.35;
    this.lineGap = options.lineGap ?? 0.12;
    this.listIndent = options.listIndent ?? 0.6;
    this.animationTime = options.animationTime ?? DEFAULT_ANIMATION_TIME;
    this.defaultSlideSize = options.defaultSlideSize ?? Slide.defaultSize;
    this.textAnchor = options.textAnchor ?? 'left-baseline';
    resolveSize(null, null, this.defaultSlideSize);
    if (!TEXT_ANCHORS.has(this.textAnchor)) throw new Error('textAnchor must be left-baseline, top-left or center');
    for (const key of ['fontSize', 'headingSize', 'codeSize', 'animationTime'] as const) {
      if (!Number.isFinite(this[key]) || this[key] <= 0) throw new Error(`${key} must be finite and positive`);
    }
    for (const key of ['margin', 'gap', 'lineGap', 'listIndent'] as const) {
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
/** A composite whose connections and endpoints address one part (an icon under its label). */
export type BodyMobject = Mobject & { markupBody?: Mobject };

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
    if (!(key in attrs)) continue;
    const reference = objects.get(attrs[key].slice(1)) as Mobject;
    obj.nextTo(reference, direction, Number(attrs.buff ?? gap));
    // Icons line up by their symbols, not by the boxes their labels make: a label above one and below
    // the other would otherwise stagger them, and an arrow between them would slant.
    const mine = (obj as BodyMobject).markupBody;
    const theirs = (reference as BodyMobject).markupBody;
    if (mine && theirs) {
      const axis = direction[0] !== 0 ? 1 : 0;
      const delta: [number, number, number] = [0, 0, 0];
      delta[axis] = theirs.getCenter()[axis] - mine.getCenter()[axis];
      obj.shift(delta);
    }
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

/** What a renderer is made with: the layout, the document's base path, macros, preloaded assets, and the deck's library folders and modules. */
/** The point where a ray from the center of `obj` along `direction` leaves its bounding box. */
export function boundaryPoint(obj: Mobject, direction: [number, number, number]): [number, number, number] {
  const center = obj.getCenter();
  const half = [obj.getWidth() / 2, obj.getHeight() / 2];
  let t = Infinity;
  for (const axis of [0, 1] as const) {
    if (Math.abs(direction[axis]) > 1e-9 && half[axis] > 0) t = Math.min(t, half[axis] / Math.abs(direction[axis]));
  }
  if (!Number.isFinite(t)) return [center[0], center[1], center[2]];
  return [center[0] + direction[0] * t, center[1] + direction[1] * t, center[2]];
}

export interface MarkupRendererOptions {
  layout?: LayoutConfig;
  /** Base URL for images; relative paths resolve against it. */
  basePath?: string;
  /** Optional LaTeX macros passed to MathJax. */
  macros?: Record<string, string>;
  /** Preloaded assets keyed by document-relative path, e.g. data URIs in single-file bundles. */
  assets?: Record<string, string>;
  /**
   * Folders searched for a file (an image, a video, a page) after the document's own, as
   * absolute URLs ending in a slash, or as keys of `assets` ending in a slash in a bundle.
   */
  paths?: string[];
  /** Folders searched for artworks (`name.svg`, or `name.js`, `.mjs`, `.ts`), the same way. */
  artworks?: string[];
  /** Artwork modules bundled ahead of time, by name; an export carries them this way. */
  artworkModules?: Record<string, ArtworkModule>;
  /** Folders with font files, `Family.woff2` (`.woff`, `.ttf`, `.otf`) and `Family-Bold`, `-Italic`, `-BoldItalic` variants. */
  fonts?: string[];
  /** Folders with effect modules, `name.js`/`.ts`, for `[[effect: name …]]`. */
  effects?: string[];
  /** Folders with chart modules, `type.js`/`.ts`, for `type=` of a chart. */
  charts?: string[];
  /** Folders with language profiles, `lang.json`, for the fences of listings. */
  languages?: string[];
  /** Folders with code themes, `name.json`, for `layout.codeTheme`. */
  codeThemes?: string[];
  /** Folders with directive modules, `name.js`/`.ts`, for `[[name: …]]` the dialect does not know. */
  directives?: string[];
  directiveModules?: Record<string, DirectiveModule>;
  effectModules?: Record<string, EffectModule>;
  chartModules?: Record<string, ChartModule>;
}

/** Faces the player bundles or the browser has: never looked for in a deck's font folders. */
const BUNDLED_FONTS = new Set([DEFAULT_TEXT_FONT, DEFAULT_CODE_FONT, DEFAULT_HANDWRITING_FONT]);
const FONT_VARIANTS: Array<[suffix: string, weight: string, style: string]> = [['', '400', 'normal'], ['-Bold', '700', 'normal'], ['-Italic', '400', 'italic'], ['-BoldItalic', '700', 'italic']];
const FONT_EXTENSIONS = ['woff2', 'woff', 'ttf', 'otf'];
const MODULE_EXTENSIONS = ['js', 'mjs', 'ts'];

/** Create engine objects for AST elements. Subclass `make` to customize. */
export class MarkupRenderer {
  readonly layout: LayoutConfig;
  readonly basePath: string;
  readonly macros: Record<string, string> | undefined;
  readonly assets: Record<string, string>;
  readonly paths: string[];
  readonly artworks: string[];
  readonly artworkModules: Record<string, ArtworkModule>;
  readonly fonts: string[];
  readonly effects: string[];
  readonly charts: string[];
  readonly languages: string[];
  readonly codeThemes: string[];
  readonly directives: string[];
  readonly directiveModules: Record<string, DirectiveModule>;
  readonly effectModules: Record<string, EffectModule>;
  readonly chartModules: Record<string, ChartModule>;
  private readonly _parser = new MarkupParser();
  private readonly _sources = new Map<string, Promise<RasterSource>>();
  private readonly _located = new Map<string, Promise<string>>();
  private readonly _probed = new Map<string, Promise<boolean>>();
  private readonly _modules = new Map<string, Promise<unknown>>();
  private readonly _fonts = new Map<string, Promise<void>>();
  private readonly _loadedEffects = new Map<string, EffectModule>();
  private readonly _languages = new Map<string, Promise<void>>();
  private _layoutFonts: Promise<void> | null = null;
  private _codeTheme: Promise<CodeTheme | undefined> | null = null;

  constructor(options: MarkupRendererOptions = {}) {
    this.layout = options.layout ?? new LayoutConfig();
    this.basePath = options.basePath ?? '';
    this.macros = options.macros;
    this.assets = options.assets ?? {};
    this.paths = options.paths ?? [];
    this.artworks = options.artworks ?? [];
    this.artworkModules = options.artworkModules ?? {};
    this.fonts = options.fonts ?? [];
    this.effects = options.effects ?? [];
    this.charts = options.charts ?? [];
    this.languages = options.languages ?? [];
    this.codeThemes = options.codeThemes ?? [];
    this.directives = options.directives ?? [];
    this.directiveModules = options.directiveModules ?? {};
    this.effectModules = options.effectModules ?? {};
    this.chartModules = options.chartModules ?? {};
  }

  /** The URL of `file` in the first of `folders` that has it, or null. */
  private async _fileIn(file: string, folders: string[], kind: 'file' | 'module' | 'page' = 'file'): Promise<string | null> {
    for (const folder of folders) {
      const [url] = this._candidates(file, [folder]).slice(1);
      if (!url) continue;
      if (url.startsWith('data:')) return url;
      // A bundled folder travels whole: what it lacks is on no server either.
      if (this._bundled(folder)) continue;
      if (await this._exists(url, kind)) return url;
    }
    return null;
  }

  /** Whether `folder` came along in the bundle (an export embedded at least one of its files). */
  private _bundled(folder: string): boolean {
    const prefix = folder.replace(/^\.\//, '');
    return Object.keys(this.assets).some((key) => key.startsWith(prefix));
  }

  /** The module `name.js`, `.mjs` or `.ts` in the first of `folders` that has it, imported once; null when none has. */
  private _moduleIn<T>(name: string, folders: string[]): Promise<T | null> {
    const key = `${folders.join('|')}::${name}`;
    let pending = this._modules.get(key);
    if (!pending) {
      pending = (async () => {
        for (const extension of MODULE_EXTENSIONS) {
          const url = await this._fileIn(`${name}.${extension}`, folders, 'module');
          if (url && !url.startsWith('data:')) return (await import(/* @vite-ignore */ url)) as T;
        }
        return null;
      })();
      this._modules.set(key, pending);
    }
    return pending as Promise<T | null>;
  }

  /**
   * Load a font family from the deck's font folders unless it is bundled or was loaded
   * already: `Family.woff2` (or `.woff`, `.ttf`, `.otf`), and the `-Bold`, `-Italic` and
   * `-BoldItalic` variants when the folder has them. A family no folder has is left to the
   * browser, as a system font.
   */
  ensureFont(family: string | undefined): Promise<void> {
    const clean = (family ?? '').replace(/^"|"$/g, '').trim();
    if (!clean || BUNDLED_FONTS.has(clean) || typeof document === 'undefined' || typeof FontFace === 'undefined') return Promise.resolve();
    const folders = [...this.fonts, ...this.paths];
    if (!folders.length) return Promise.resolve();
    let pending = this._fonts.get(clean);
    if (!pending) {
      pending = (async () => {
        for (const [suffix, weight, style] of FONT_VARIANTS) {
          for (const extension of FONT_EXTENSIONS) {
            const url = await this._fileIn(`${clean}${suffix}.${extension}`, folders);
            if (!url) continue;
            try {
              const face = new FontFace(clean, `url(${JSON.stringify(url)})`, { weight, style });
              await face.load();
              document.fonts.add(face);
            } catch (error) {
              console.warn(`[zoomdeck] could not load the font ${clean}${suffix} from ${url}:`, error);
            }
            break;
          }
        }
      })();
      this._fonts.set(clean, pending);
    }
    return pending;
  }

  /** The prose and code faces of the layout, loaded once before any text is laid out. */
  layoutFonts(): Promise<void> {
    this._layoutFonts ??= Promise.all([this.ensureFont(this.layout.font), this.ensureFont(this.layout.codeFont)]).then(() => undefined);
    return this._layoutFonts;
  }

  /**
   * An effect of the deck's own, by name, from the bundled modules or the effects folders;
   * loaded ahead of playback, since effects are made when their step plays.
   */
  async effect(name: string): Promise<EffectModule | null> {
    const bundled = this.effectModules[name];
    const module = bundled ?? (await this._moduleIn<EffectModule>(name, [...this.effects, ...this.paths]));
    if (module) this._loadedEffects.set(name, module);
    return module;
  }

  /** The animation of a loaded effect of the deck's own, or null for a built-in name. */
  customEffect(name: string, target: Mobject, options: EffectOptions): Animation | null {
    const module = this._loadedEffects.get(name) ?? this.effectModules[name];
    return module ? effectFromModule(module, target, options) : null;
  }

  /** A chart module of the deck's own, by type name, or null. */
  chart(type: string): Promise<ChartModule | null> {
    const bundled = this.chartModules[type];
    return bundled ? Promise.resolve(bundled) : this._moduleIn<ChartModule>(type, [...this.charts, ...this.paths]);
  }

  /** Register the language profile `lang.json` of the deck's languages folders for a fence language the player does not know. */
  language(lang: string): Promise<void> {
    const key = lang.trim().toLowerCase();
    if (knownLanguage(key)) return Promise.resolve();
    let pending = this._languages.get(key);
    if (!pending) {
      pending = (async () => {
        const url = await this._fileIn(`${key}.json`, [...this.languages, ...this.paths]);
        if (!url) return;
        try {
          const profile = (await (await fetch(url)).json()) as Language & { aliases?: string[] };
          registerLanguage(key, profile);
        } catch (error) {
          console.warn(`[zoomdeck] the language profile ${url} could not be read:`, error);
        }
      })();
      this._languages.set(key, pending);
    }
    return pending;
  }

  /** The code theme `layout.codeTheme` names, `name.json` in the code-themes folders, loaded once; undefined for the default. */
  codeTheme(): Promise<CodeTheme | undefined> {
    this._codeTheme ??= (async () => {
      const name = this.layout.codeTheme;
      if (!name) return undefined;
      const url = await this._fileIn(`${name}.json`, [...this.codeThemes, ...this.paths]);
      if (!url) {
        console.warn(`[zoomdeck] no code theme ${name}.json in the deck's code-themes folders`);
        return undefined;
      }
      return (await (await fetch(url)).json()) as CodeTheme;
    })();
    return this._codeTheme;
  }

  /**
   * Whether `url` answers with what is asked for, asked once: a module must come back as
   * JavaScript and a file as anything but a page, since a development server answers every
   * path with its page. A page (`.html`) is asked for as such. Without `fetch` (tests)
   * everything is taken to exist.
   */
  private _exists(url: string, kind: 'file' | 'module' | 'page' = 'file'): Promise<boolean> {
    const key = `${kind} ${url}`;
    let pending = this._probed.get(key);
    if (!pending) {
      pending = typeof fetch === 'undefined'
        ? Promise.resolve(true)
        : fetch(url, { method: 'HEAD' }).then((response) => {
          if (!response.ok) return false;
          const type = (response.headers.get('content-type') ?? '').toLowerCase();
          if (kind === 'module') return /javascript|ecmascript|typescript/.test(type);
          if (kind === 'page') return true;
          return !type.includes('text/html');
        }, () => false);
      this._probed.set(key, pending);
    }
    return pending;
  }

  /** The candidates for a relative path: a preloaded asset or a URL in the document's folder, then in each search folder. */
  private _candidates(path: string, folders: string[]): string[] {
    const clean = path.replace(/^\.\//, '');
    const first = this.resolveUrl(path);
    const candidates = [first];
    for (const folder of folders) {
      const key = folder + clean;
      const preloaded = this.assets[key];
      if (preloaded) candidates.push(preloaded);
      else if (/^(?:[a-z]+:)?\/\//i.test(folder) || folder.startsWith('/')) candidates.push(folder + clean);
      else candidates.push(this.resolveUrl(folder + clean));
    }
    return candidates;
  }

  /**
   * Find a file named in the document: in its own folder, then in each of the deck's search
   * folders, the first that answers; a path that is absolute, a data URI or preloaded is taken
   * as it is. When nothing answers, the document's own URL is returned, so the error names it.
   */
  locate(path: string, folders: string[] = this.paths): Promise<string> {
    const first = this.resolveUrl(path);
    const preloaded = this.assets[path] ?? this.assets[path.replace(/^\.\//, '')];
    if (!folders.length || this._absolute(path) || preloaded) return Promise.resolve(first);
    const key = `${folders.join('|')}::${path}`;
    let pending = this._located.get(key);
    if (!pending) {
      pending = (async () => {
        const candidates = this._candidates(path, folders);
        const kind = /\.x?html?(\?|#|$)/i.test(path) ? 'page' : 'file';
        for (const candidate of candidates) {
          if (candidate.startsWith('data:') || (await this._exists(candidate, kind))) return candidate;
        }
        return candidates[0];
      })();
      this._located.set(key, pending);
    }
    return pending;
  }

  private _absolute(path: string): boolean {
    return /^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('/');
  }

  /**
   * An artwork of the deck's own, by name: a module bundled with the deck, else `name.js`,
   * `name.mjs`, `name.ts` or `name.svg` in the artworks folders (then in the search folders),
   * drawn with the icon options. Throws, with the line, when no folder has it.
   */
  async artwork(name: string, options: ArtworkOptions, line: number): Promise<Mobject> {
    const bundled = this.artworkModules[name];
    if (bundled) return artworkFromModule(bundled, options);
    const folders = [...this.artworks, ...this.paths];
    const module = await this._moduleIn<ArtworkModule>(name, folders);
    if (module) return artworkFromModule(module, options);
    const svg = await this._fileIn(`${name}.svg`, folders);
    // The drawing keeps its own colors; `currentColor` in it follows `color=`, else the deck's text color.
    if (svg) return loadSvgMobject(svg, { height: options.size, defaultColor: 'color' in options.attributes ? options.color : options.foreground });
    const where = folders.length ? ` or in ${folders.join(', ')}` : '';
    throw new MarkupError(`Unknown icon or artwork ${JSON.stringify(name)}: not a built-in icon (${[...ICON_KINDS].join(', ')}) and no ${name}.svg, ${name}.js or ${name}.ts in the deck's artworks folders${where}`, line);
  }


  /**
   * A directive of the deck's own, drawn by the module `name.js`/`.ts` of the directives folders
   * (bundled ahead in an export), with the directive's attributes and the deck's style.
   */
  async directive(element: ElementSpec, fontSize: number, width: number, color: string): Promise<Mobject> {
    const name = element.source;
    const module = this.directiveModules[name] ?? (await this._moduleIn<DirectiveModule>(name, [...this.directives, ...this.paths]));
    if (!module) {
      throw new MarkupError(`Unknown directive ${JSON.stringify(name)}: not one of the dialect's and no ${name}.js or ${name}.ts in the deck's directives folders`, element.line);
    }
    const attrs = element.attributes;
    const strokeWidth = Number(attrs.stroke_width ?? 2);
    const fillColor = attrs.fill_color ? parseColor(attrs.fill_color) : color;
    const fillOpacity = Number(attrs.fill_opacity ?? 0);
    const options: DirectiveOptions = {
      name, attributes: attrs, color, fontSize, width, foreground: this.layout.color, layout: this.layout,
      sketch: sketchOptions(element, { color, strokeWidth, fillColor, fillOpacity }),
      text: (markup, size = fontSize, maxWidth = width) => this.text(this._parser.parseInlineSpans(markup, element.line), size, maxWidth, color, attrs.font),
      icon: (iconName, iconOptions = {}) => {
        if (!ICON_KINDS.has(iconName)) throw new MarkupError(`[[${name}: …]] asks for an icon ${JSON.stringify(iconName)} that is not built in`, element.line);
        return makeIcon(iconName as IconName, { size: 1, color, strokeWidth, fillColor, fillOpacity, ...iconOptions });
      },
      artwork: (artworkName, attributes = {}) => this.artwork(artworkName, {
        size: 1, color, strokeWidth, fillColor, fillOpacity, attributes, foreground: this.layout.color,
      }, element.line),
    };
    try {
      return await directiveFromModule(module, options);
    } catch (error) {
      if (error instanceof MarkupError) throw error;
      throw new MarkupError(`[[${name}: …]]: ${(error as Error).message}`, element.line);
    }
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
    let pending = this._sources.get(path);
    if (!pending) {
      pending = this.locate(path).then((url) => RasterSource.load(url));
      this._sources.set(path, pending);
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
      obj = new IframeHost(await this.locate(element.source), box, inside, caption);
    } else if (element.kind === 'image' && VIDEO_EXTENSIONS.test(element.source)) {
      // A clip that cannot load (a missing file, a codec the browser lacks) leaves its place blank
      // and a warning in the console, rather than stopping the deck.
      const video = new VideoClip(await this.locate(element.source), { width, muted: attrs.muted !== 'false' });
      await video.waitForLoad();
      obj = video;
    } else if (element.kind === 'image') {
      if (/\.svg(?:[?#].*)?$/i.test(element.source)) {
        try {
          obj = await loadSvgMobject(await this.locate(element.source), { width, defaultColor: this.layout.color });
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
      const iconOptions = {
        size: numberValue(attrs, 'size', element.line, 1) as number,
        color, strokeWidth, fillColor, fillOpacity,
        sketch: sketchOptions(element, { color, strokeWidth, fillColor, fillOpacity }),
      };
      const icon = ICON_KINDS.has(element.source)
        ? makeIcon(element.source as IconName, iconOptions)
        : await this.artwork(element.source, { ...iconOptions, attributes: attrs, foreground: this.layout.color }, element.line);
      obj = icon;
      if (attrs.label) {
        const label = await this.text(this._parser.parseInlineSpans(attrs.label, element.line), size * 0.8, 6, color, attrs.font);
        const side = attrs.label_side ?? 'below';
        const direction = { below: [0, -1, 0], above: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0] }[side] as [number, number, number];
        label.nextTo(icon, direction, 0.15);
        const group = new Group(icon, label) as PartsMobject & BodyMobject;
        group.markupParts = [icon, label];
        group.markupBody = icon;
        obj = group;
      }
    } else if (element.kind === 'custom') {
      obj = await this.directive(element, size, width, color);
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
      let rows = element.source;
      if (attrs.src) {
        // The rows come from a CSV (or TSV, or JSON) file next to the document or in its search folders.
        const url = await this.locate(attrs.src);
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          rows = await response.text();
        } catch (error) {
          throw new MarkupError(`Chart data ${attrs.src}: ${(error as Error).message}`, element.line);
        }
      }
      try {
        const header = 'header' in attrs ? attrs.header === 'true' : undefined;
        data = /^\s*[[{]/.test(rows) ? chartDataFromJson(JSON.parse(rows), header) : parseChartData(rows, header);
      } catch (error) {
        throw new MarkupError(`Chart data${attrs.src ? ` ${attrs.src}` : ''}: ${(error as Error).message}`, element.line);
      }
      const optional = (key: string) => (key in attrs ? Number(attrs[key]) : undefined);
      const flag = (key: string) => (key in attrs ? attrs[key] === 'true' : undefined);
      const colors = attrs.colors ? attrs.colors.split(/[\s,]+/).filter(Boolean).map(parseColor) : undefined;
      const borderColor = attrs.border_color ? parseColor(attrs.border_color) : undefined;
      const sketchy = sketchOptions(element, { color, strokeWidth: optional('stroke_width') ?? 2, fillColor: color, fillOpacity: optional('fill_opacity') ?? 0.85 }, 'solid');
      try {
        const type = attrs.type ?? 'bar';
        const custom = (CHART_TYPES as readonly string[]).includes(type) ? null : await this.chart(type);
        if (!custom && !(CHART_TYPES as readonly string[]).includes(type)) {
          throw new MarkupError(`Unknown chart type ${JSON.stringify(type)}: not ${CHART_TYPES.join(', ')} and no ${type}.js or ${type}.ts in the deck's charts folders`, element.line);
        }
        const draw = custom ? (chartData: typeof data, chartOptions: Parameters<typeof buildChart>[1], label: Parameters<typeof buildChart>[2]) => chartFromModule(custom, chartData, chartOptions, label) : buildChart;
        obj = await draw(data, {
          type: (CHART_TYPES as readonly string[]).includes(type) ? (type as ChartType) : 'bar',
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
      obj = element.list?.marker
        ? await this.listItem(element.spans, element.list.marker, size, width, color, attrs.font)
        : await this.text(element.spans, size, width, color, attrs.font);
    } else if (element.kind === 'code') {
      obj = this.code(element.source, attrs.lang ?? '', size, width, color, await this.prepareCode(attrs.lang ?? ''));
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
        return await loadSvgMobject(await this.locate(source), { width, defaultColor: this.layout.color });
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
    await this.layoutFonts();
    if (font) await this.ensureFont(font);
    // Span colors may be palette names; the canvas and MathJax need hex values.
    const resolved = spans.map((s) => (s.color ? { ...s, color: parseColor(s.color) } : s));
    return layoutParagraph(
      resolved,
      { fontSize, maxWidth, defaultColor, fontFamily: this.layout.fontFamilyFor(font), lineGap: this.layout.lineGap },
      (latex, color) => this.mathPiece(latex, color, fontSize),
    );
  }

  /**
   * A list item: the marker in a hanging-indent column of at least `layout.listIndent`, the prose
   * wrapped to the rest of `maxWidth` next to it, first baselines aligned.
   */
  async listItem(spans: InlineSpan[], marker: string, fontSize: number, maxWidth: number, defaultColor: string, font?: string): Promise<Mobject> {
    const label = await this.text([span(marker)], fontSize, maxWidth, defaultColor, font);
    if (!spans.some((s) => s.content.trim())) return label;
    const column = Math.max(this.layout.listIndent, label.getWidth() + 0.15);
    const body = await this.text(spans, fontSize, Math.max(maxWidth - column, 0.5), defaultColor, font);
    body.shift([label.getLeft()[0] + column - body.getLeft()[0], baselineY(label) - baselineY(body), 0]);
    const item = new Group(label, body) as Group & { markupBaselineFraction: number };
    item.markupBaselineFraction = (baselineY(body) - item.getCenter()[1]) / item.getHeight();
    return item;
  }

  /** Lay out a verbatim listing; it shrinks uniformly when wider than `maxWidth`. */
  code(source: string, language: string, fontSize: number, maxWidth: number, defaultColor: string, theme?: CodeTheme): Mobject {
    return layoutCode(source, language, {
      fontSize, maxWidth, defaultColor, lineGap: this.layout.lineGap, fontFamily: this.layout.codeFontFamily, ...(theme ? { theme } : {}),
    });
  }

  /** What a listing needs before it is laid out: the code face, the language's profile, the deck's code theme. */
  async prepareCode(language: string): Promise<CodeTheme | undefined> {
    await this.layoutFonts();
    await this.language(language);
    return this.codeTheme();
  }

  /** Create an arrow or line between laid-out objects or fixed coordinates. */
  async connection(element: ElementSpec, objects: Map<string, Mobject>): Promise<Mobject> {
    const [start, end] = ['from', 'to'].map((key) => endpoint(element.attributes[key], element.line));
    // An arrow to a labeled icon aims at the icon itself, not at the box of icon and label together.
    const body = (obj: Mobject | undefined): Mobject | null => (obj ? (obj as BodyMobject).markupBody ?? obj : null);
    const source = typeof start === 'string' ? body(objects.get(start)) : null;
    const target = typeof end === 'string' ? body(objects.get(end)) : null;
    let a = source ? source.getCenter() : (start as [number, number, number]);
    let b = target ? target.getCenter() : (end as [number, number, number]);
    const direction: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const length = Math.hypot(...direction);
    if (length < 1e-9) throw new MarkupError('Arrow endpoints must have distinct positions', element.line);
    // Each end sits where the line between the centers leaves the element's box: a direction that
    // is horizontal up to floating-point noise still meets the side, not a corner.
    if (source) a = boundaryPoint(source, direction);
    if (target) b = boundaryPoint(target, [-direction[0], -direction[1], -direction[2]]);
    const color = element.attributes.color ? parseColor(element.attributes.color) : this.layout.color;
    const isArrow = element.kind === 'arrow';
    const buff = isArrow ? 0.08 : 0;
    const unit = direction.map((v) => v / length) as [number, number, number];
    const segment = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const trim = Math.min(buff, segment / 3);
    const start3: [number, number, number] = [a[0] + unit[0] * trim, a[1] + unit[1] * trim, a[2] + unit[2] * trim];
    const end3: [number, number, number] = [b[0] - unit[0] * trim, b[1] - unit[1] * trim, b[2] - unit[2] * trim];
    const strokeWidth = element.kind === 'line' || 'stroke_width' in element.attributes ? Number(element.attributes.stroke_width ?? 2) : undefined;
    const width = strokeWidth ?? (isArrow ? 4 : 2);
    const dash = element.attributes.dashed === 'true' ? dashPattern(width) : undefined;
    const sketchy = sketchOptions(element, { color, strokeWidth: width, fillColor: color, fillOpacity: 0, ...(dash ? { dash } : {}) });
    let connection: Mobject;
    if (sketchy) connection = isArrow ? sketch.arrow(start3, end3, sketchy) : sketch.line(start3, end3, sketchy);
    else if (dash) connection = dashedConnection(start3, end3, color, width, dash, isArrow);
    else if (isArrow) connection = new Arrow({ start: start3, end: end3, color, ...(strokeWidth !== undefined ? { strokeWidth } : {}) });
    else connection = new Line({ start: start3, end: end3, color, strokeWidth: width });
    const label = element.attributes.label;
    let result: Mobject = connection;
    if (label) {
      const spans = this._parser.parseInlineSpans(label, element.line);
      const size = numberValue(element.attributes, 'font_size', element.line, this.layout.fontSize * 0.8) as number;
      const text = await this.text(spans, size, 4, this.layout.color, element.attributes.font);
      placeLabel(text, connection, start3, end3, element.attributes.slanted === 'true', element.attributes.label_side === 'below' ? 'below' : 'above');
      result = new Group(connection, text);
    }
    if ('opacity' in element.attributes) applyOpacity(result, Number(element.attributes.opacity));
    return result;
  }
}

/**
 * A dashed line, or a dashed arrow: the dashes of its shaft and the solid tip of a plain arrow
 * (0.3 long and 0.2 wide, shorter on a short arrow), whose base the shaft reaches.
 */
function dashedConnection(start: [number, number, number], end: [number, number, number], color: string, strokeWidth: number, dash: readonly [number, number], arrow: boolean): Mobject {
  let shaftEnd = end;
  const parts: Mobject[] = [];
  if (arrow) {
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const unit = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
    const tip = Math.min(0.3, length);
    const base = [end[0] - unit[0] * tip, end[1] - unit[1] * tip];
    const across = [-unit[1] * 0.1, unit[0] * 0.1];
    shaftEnd = [base[0], base[1], 0];
    parts.push(new Polygon({ vertices: [end, [base[0] + across[0], base[1] + across[1], 0], [base[0] - across[0], base[1] - across[1], 0]], color, fillOpacity: 1, strokeWidth: 0 }));
  }
  const dashes = dashSegments(start, shaftEnd, dash[0], dash[1]).map(([a, b]) => new Line({ start: a, end: b, color, strokeWidth }));
  return new VGroup(...dashes, ...parts);
}

/**
 * Place a connection's label at the middle of the edge, on one side of it. The side is taken in
 * the label's own frame along the edge, the frame it reads in, from left to right (bottom to top on
 * a vertical edge), so that it is never upside down: `above` is the side its letters stand on
 * (the left of a vertical edge), `below` the other. A level edge keeps the label above or below
 * the connection, as it always was. On any other edge the label sits beside the middle, clear of
 * the line: upright by default, or turned along the edge with `slanted`.
 */
export function placeLabel(text: Mobject, connection: Mobject, start: [number, number, number], end: [number, number, number], slanted: boolean, side: 'above' | 'below' = 'above'): void {
  let angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
  // Read from left to right: an edge pointing leftwards is turned around.
  if (angle > Math.PI / 2 + 1e-9) angle -= Math.PI;
  else if (angle <= -Math.PI / 2 + 1e-9) angle += Math.PI;
  const sign = side === 'below' ? -1 : 1;
  if (Math.abs(Math.sin(angle)) < 1e-6) {
    text.nextTo(connection, [0, sign, 0], 0.1);
    return;
  }
  const middle = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  // The normal toward the label's side, in its frame: up from its letters (to the left of a vertical edge), or the other way.
  const normal = [-Math.sin(angle) * sign, Math.cos(angle) * sign];
  const gap = 0.1;
  let reach: number;
  if (slanted) {
    // Turned along the edge, the label's height is what separates it from the line.
    reach = text.getHeight() / 2;
    text.rotate(angle);
  } else {
    // Upright, its box reaches toward the line by its half-extent across the edge.
    reach = (Math.abs(normal[0]) * text.getWidth()) / 2 + (Math.abs(normal[1]) * text.getHeight()) / 2;
  }
  text.moveTo([middle[0] + normal[0] * (reach + gap), middle[1] + normal[1] * (reach + gap), 0]);
}

export { CONNECTIONS };
