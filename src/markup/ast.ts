/**
 * Document records and validation helpers for the component Markdown dialect.
 *
 * Parsing and tree validation never instantiate text, images or LaTeX; those
 * resources are created once by `MarkupSlide.build` during preparation.
 */
import { FILL_STYLES } from '../sketch';
import * as engine from 'manim-web';

/** Invalid markup, with an optional one-based source line number. */
export class MarkupError extends Error {
  readonly line: number | null;

  constructor(message: string, line: number | null = null) {
    super(line !== null ? `Line ${line}: ${message}` : message);
    this.name = 'MarkupError';
    this.line = line;
  }
}

/** A text, code or native math run with accumulated inline styling. */
export interface InlineSpan {
  content: string;
  kind: 'text' | 'code' | 'math';
  bold: boolean;
  italic: boolean;
  color: string | null;
  /** Link target when the span sits inside a Markdown link. */
  href?: string | null;
}

export function span(
  content: string, kind: InlineSpan['kind'] = 'text', bold = false, italic = false, color: string | null = null, href: string | null = null,
): InlineSpan {
  return href ? { content, kind, bold, italic, color, href } : { content, kind, bold, italic, color };
}

export type Attributes = Record<string, string>;

/** One slide-local text, image, display-math, shape or connection element. */
export class ElementSpec {
  constructor(
    readonly id: string,
    readonly kind: string,
    readonly spans: InlineSpan[] = [],
    readonly attributes: Attributes = {},
    readonly source = '',
    readonly line = 1,
    readonly level = 0,
  ) {}

  /** Explicit local coordinates, interpreted using the element's anchor. */
  get position(): [number, number, number] | null {
    if (!('x' in this.attributes) && !('y' in this.attributes)) return null;
    return [Number(this.attributes.x ?? 0), Number(this.attributes.y ?? 0), 0];
  }
}

/** Elements laid out in their own coordinates and handled as one element by the slide. */
export class GroupSpec extends ElementSpec {
  constructor(id: string, readonly items: ElementSpec[], attributes: Attributes = {}, line = 1) {
    super(id, 'group', [], attributes, '', line);
  }
}

/** A reference to another slide, with parent-local placement attributes. */
export class IncludeSpec {
  constructor(readonly target: string, readonly attributes: Attributes = {}, readonly line = 1) {}
}

/** A slide class reference with parent-local placement attributes. */
export class ImportSpec {
  constructor(readonly className: string, readonly attributes: Attributes = {}, readonly line = 1) {}
}

/** An explicit show/hide directive targeting one slide-local element. */
export class EventSpec {
  constructor(
    readonly action: 'show' | 'hide', readonly target: string, readonly step: number, readonly line = 1, readonly attributes: Attributes = {},
  ) {}
}

/** Automatically advance after a numbered slide-local step completes. */
export class NextSpec {
  constructor(readonly step: number, readonly line = 1) {}
}

/** Omit the next navigation event after a numbered slide-local step. */
export class SkipNextSpec {
  constructor(readonly step: number, readonly line = 1) {}
}

export type ActionKind = 'animate' | 'effect' | 'transform' | 'move_along';

/** An animation directive at a numbered step: `[[animate: #id ...]]`, `[[effect: name #id ...]]`, … */
export class ActionSpec {
  constructor(readonly action: ActionKind, readonly target: string, readonly step: number, readonly attributes: Attributes, readonly line = 1) {}
}

export type SlideItem = ElementSpec | IncludeSpec | ImportSpec | EventSpec | ActionSpec | NextSpec | SkipNextSpec;

/** One change played at a step: a fade, a property animation, an effect, a morph or a path motion. */
export interface StepChange {
  action: 'show' | 'hide' | ActionKind;
  target: string;
  runTime?: number;
  lag?: number;
  /** Rate function name (`RATE_NAMES`). */
  rate?: string;
  /** Entrance or exit style for show/hide. */
  style?: string;
  /** `animate`: x, y, at, dx, dy, anchor, angle, scale, opacity, color. */
  props?: Attributes;
  /** `effect`: the effect name and its options (color, scale). */
  name?: string;
  options?: Attributes;
  /** `transform`: the element that replaces the target. */
  to?: string;
  /** `move_along`: the shape to follow and whether to rotate along it. */
  path?: string;
  rotate?: boolean;
}

/** @deprecated Use `StepChange`. */
export type VisibilityChange = StepChange;

/** A compiled click: parallel changes, then ordered child visits. */
export interface AnimationStep {
  number: number;
  changes: StepChange[];
  visits: string[];
  autoNext: boolean;
  skipNext: boolean;
}

/** A named slide definition; `placeholder` marks synthesized missing includes. */
export class SlideSpec {
  constructor(
    readonly id: string,
    readonly items: SlideItem[],
    readonly attributes: Attributes = {},
    readonly line = 1,
    readonly placeholder = false,
  ) {}
}

/** Named attribute sets applied through roles (`heading`, `body`, …) and `.class` tokens. */
export type StyleSheet = Record<string, Attributes>;

/** Validated slide definitions, a root ID, an asset-resolution base URL and the style sheet. */
export class MarkupDocument {
  constructor(readonly slides: SlideSpec[], readonly root: string, readonly basePath = '', readonly styles: StyleSheet = {}) {}
}

export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
export const CONTAINER = /^\s*:::\s*(.*?)\s*$/;
export const DIRECTIVE = /^\s*\[\[(include|subslide|import|arrow|line|rectangle|circle|polyline|dot|ellipse|polygon|arc|brace|box|iframe|show|hide|animate|effect|transform|move_along|next|skip_next):\s*(.*?)\]\]\s*$/;
/** Names accepted by `rate=`; implemented in `animations.ts`. */
export const RATE_NAMES = new Set(['smooth', 'linear', 'rush_into', 'rush_from', 'there_and_back', 'ease_in', 'ease_out', 'ease_in_out']);
export const EFFECT_NAMES = new Set(['indicate', 'wiggle', 'circumscribe', 'flash', 'focus', 'grow', 'shrink', 'write', 'create', 'uncreate', 'draw', 'wave']);
export const ENTER_STYLES = new Set(['fade', 'grow', 'write', 'create', 'draw']);
export const EXIT_STYLES = new Set(['fade', 'shrink', 'uncreate']);
/** Attributes of `[[animate: ...]]` that describe the target state. */
export const ANIMATE_PROPS = new Set(['x', 'y', 'at', 'dx', 'dy', 'anchor', 'angle', 'scale', 'opacity', 'color']);
export const GEOMETRY = new Set(['x', 'y', 'width', 'height', 'angle']);
export const NEIGHBORS: Record<string, [number, number, number]> = {
  below: [0, -1, 0],
  above: [0, 1, 0],
  'left-of': [-1, 0, 0],
  'right-of': [1, 0, 0],
};
export const ALIGNMENTS: Record<string, [number, number, number]> = {
  'left-aligned': [-1, 0, 0],
  'right-aligned': [1, 0, 0],
  'top-aligned': [0, 1, 0],
  'bottom-aligned': [0, -1, 0],
};
export const POSITION_REFERENCES = new Set([...Object.keys(NEIGHBORS), ...Object.keys(ALIGNMENTS), 'baseline-aligned']);
export const HORIZONTAL_POSITION = new Set(['left-of', 'right-of', 'left-aligned', 'right-aligned']);
export const VERTICAL_POSITION = new Set(['above', 'below', 'top-aligned', 'bottom-aligned', 'baseline-aligned']);
export const LAYOUT = new Set([...GEOMETRY, ...POSITION_REFERENCES, 'buff', 'dx', 'dy', 'anchor', 'at', 'class']);
/** Timing of an element's own fade-in and fade-out, in seconds. */
export const TIMING_ATTRS = new Set(['run_time', 'lag']);
export const ELEMENT_ATTRS = new Set([
  'id', 'x', 'y', 'width', 'height', 'step', 'hide', 'color', 'font_size', 'font', 'focus_only', 'opacity', 'anchor', 'dx', 'dy', 'at', 'class',
  'enter', 'exit', ...POSITION_REFERENCES, 'buff', ...TIMING_ATTRS,
]);
/** Attributes of a `::: {.group}` container. */
export const GROUP_ATTRS = new Set([
  'id', 'x', 'y', 'width', 'step', 'hide', 'opacity', 'anchor', 'dx', 'dy', 'at', 'class', 'focus_only', 'enter', 'exit',
  ...POSITION_REFERENCES, 'buff', ...TIMING_ATTRS,
]);
/** Anchor points: bounding-box center, edges and corners, plus the first baseline for text-like elements. */
export const ANCHORS = new Set([
  'center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'left-baseline', 'right-baseline',
]);
export const BASELINE_ANCHORS = new Set(['left-baseline', 'right-baseline']);
/** Anchors including `origin`, the local coordinate origin of a group. */
export const GROUP_ANCHORS = new Set([...ANCHORS, 'origin']);
/** Anchors accepted as `layout.textAnchor`. */
export const TEXT_ANCHORS = ANCHORS;
/** Element kinds positioned by left edge and baseline rather than by center. */
export const TEXT_LIKE = new Set(['text', 'math', 'code']);
export const SHAPES = new Set(['rectangle', 'circle', 'polyline', 'dot', 'ellipse', 'polygon', 'arc']);
export const CONNECTIONS = new Set(['arrow', 'line']);
/** Decorations attached to another element after layout; like connections they cannot anchor others. */
export const ATTACHMENTS = new Set(['brace', 'box']);
/** File extensions rendered as videos by the image syntax. */
export const VIDEO_EXTENSIONS = /\.(mp4|m4v|webm|ogv|ogg|mov)(?:[?#].*)?$/i;
export const BRACE_SIDES: Record<string, [number, number, number]> = { left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] };
export const STROKE_ATTRS = new Set(['stroke_width']);
export const FILL_ATTRS = new Set(['fill_color', 'fill_opacity']);
/** Hand-drawn rendering of shapes, connections and attachments: `sketch=true` and its tuning knobs. */
export const SKETCH_ATTRS = new Set(['sketch', 'roughness', 'bowing', 'fill_style', 'hachure_angle', 'hachure_gap', 'fill_weight', 'seed']);
/** Values of `fill_style`. */
export const FILL_STYLE_NAMES = new Set<string>(FILL_STYLES);

export function positionTargets(item: ElementSpec | IncludeSpec | ImportSpec): Set<string> {
  const result = new Set<string>();
  for (const [key, value] of Object.entries(item.attributes)) if (POSITION_REFERENCES.has(key)) result.add(value.slice(1));
  if ('at' in item.attributes) {
    const at = parseAt(item.attributes.at, item.line);
    if ('id' in at.target) result.add(at.target.id);
  }
  return result;
}

/** A parsed `at=` placement: `[anchor:]#id[.anchor]` or `[anchor:](x,y)`. */
export interface AtExpression {
  /** The element's own anchor to place, or null for its default anchor. */
  anchor: string | null;
  target: { id: string; anchor: string | null } | { point: [number, number, number] };
}

export function parseAt(value: string, line: number): AtExpression {
  let anchor: string | null = null;
  let rest = value.trim();
  const colon = rest.indexOf(':');
  if (colon > 0 && !rest.startsWith('(') && !rest.startsWith('#')) {
    anchor = rest.slice(0, colon);
    rest = rest.slice(colon + 1);
    if (!GROUP_ANCHORS.has(anchor)) throw new MarkupError(`Unknown anchor ${JSON.stringify(anchor)} in at=`, line);
  }
  if (rest.startsWith('(')) return { anchor, target: { point: endpoint(rest, line) as [number, number, number] } };
  if (!rest.startsWith('#')) throw new MarkupError('at= takes [anchor:]#id[.anchor] or [anchor:](x,y)', line);
  let id = rest.slice(1);
  let targetAnchor: string | null = null;
  const dot = id.lastIndexOf('.');
  if (dot > 0 && GROUP_ANCHORS.has(id.slice(dot + 1))) {
    targetAnchor = id.slice(dot + 1);
    id = id.slice(0, dot);
  }
  if (!IDENTIFIER.test(id)) throw new MarkupError(`Invalid at= reference #${id}`, line);
  return { anchor, target: { id, anchor: targetAnchor } };
}

/** Normalize deck-provided styles (attribute strings or plain objects) into attribute maps. */
export function normalizeStyles(styles: Record<string, string | Record<string, unknown>> | undefined): StyleSheet {
  const result: StyleSheet = {};
  for (const [name, value] of Object.entries(styles ?? {})) {
    if (!/^[A-Za-z_][\w-]*$/.test(name)) throw new MarkupError(`Invalid style name ${JSON.stringify(name)}`);
    if (typeof value === 'string') {
      try {
        result[name] = parseAttributes(value, 1);
      } catch (error) {
        throw new MarkupError(`Style ${name}: ${String((error as Error).message).replace(/^Line \d+: /, '')}`);
      }
    } else result[name] = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
  }
  return result;
}

/** The style roles an item receives automatically, most generic first. */
export function styleRoles(item: ElementSpec | IncludeSpec | ImportSpec): string[] {
  if (!(item instanceof ElementSpec)) return ['include'];
  if (item.kind === 'text') return item.level ? ['heading', `h${item.level}`] : ['body'];
  if (SHAPES.has(item.kind)) return ['shape', item.kind];
  if (CONNECTIONS.has(item.kind)) return ['connection', item.kind];
  if (ATTACHMENTS.has(item.kind)) return ['attachment', item.kind];
  return [item.kind];
}

/** Fill in role and class styles below an item's own attributes, consuming its `class` token list. */
export function applyStyles(item: ElementSpec | IncludeSpec | ImportSpec, styles: StyleSheet): void {
  const attrs = item.attributes;
  const classes = (attrs.class ?? '').split(/\s+/).filter(Boolean);
  delete attrs.class;
  const layers: Attributes[] = [];
  for (const role of styleRoles(item)) if (styles[role]) layers.push(styles[role]);
  for (const name of classes) {
    const style = styles[name];
    if (!style) throw new MarkupError(`Unknown style class .${name}`, item.line);
    layers.push(style);
  }
  const merged: Attributes = {};
  for (const layer of layers) Object.assign(merged, layer);
  for (const [key, value] of Object.entries(merged)) {
    if (key === 'id' || key === 'class') continue;
    if (!(key in attrs)) attrs[key] = value;
  }
}

/** Resolve layout dependencies iteratively, rejecting cycles before media creation. */
export function positionOrder(elements: Map<string, ElementSpec>): string[] {
  const dependents = new Map<string, string[]>();
  const remaining = new Map<string, number>();
  for (const [identifier, item] of elements) {
    const targets = positionTargets(item);
    remaining.set(identifier, targets.size);
    for (const target of targets) {
      if (!dependents.has(target)) dependents.set(target, []);
      (dependents.get(target) as string[]).push(identifier);
    }
  }
  const ready = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
  const order: string[] = [];
  while (ready.length) {
    const identifier = ready.shift() as string;
    order.push(identifier);
    for (const dependent of dependents.get(identifier) ?? []) {
      const count = (remaining.get(dependent) as number) - 1;
      remaining.set(dependent, count);
      if (count === 0) ready.push(dependent);
    }
  }
  if (order.length !== elements.size) {
    const identifier = [...remaining].find(([, count]) => count > 0)?.[0] as string;
    throw new MarkupError(`Relative positioning cycle involving #${identifier}`, elements.get(identifier)?.line ?? null);
  }
  return order;
}

export function childKey(index: number, item: IncludeSpec | ImportSpec): string {
  // Colons cannot occur in markup slide IDs, so imports never collide with includes.
  return item instanceof IncludeSpec ? item.target : `import:${index}`;
}

const RESERVED = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else',
  'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new',
  'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

export function checkClassName(className: string, line: number): void {
  const valid = className.split('.').every((part) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part) && !RESERVED.has(part));
  if (!valid) throw new MarkupError(`Invalid class name ${JSON.stringify(className)}`, line);
}

/** Split `source` like a POSIX shell lexer: quotes group, backslashes escape, parentheses keep `(x,y)` whole. */
export function tokenize(source: string, line: number, separators = ' \t\r\n'): string[] {
  const tokens: string[] = [];
  let current: string | null = null;
  let quote: string | null = null;
  let escaped = false;
  let depth = 0;
  for (const char of source) {
    if (escaped) {
      current = (current ?? '') + char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      if (current === null) current = '';
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      else current = (current ?? '') + char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      if (current === null) current = '';
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')' && depth > 0) depth -= 1;
    if (depth === 0 && separators.includes(char)) {
      if (current !== null) tokens.push(current);
      current = null;
      continue;
    }
    current = (current ?? '') + char;
  }
  if (quote !== null) throw new MarkupError('Invalid attribute quoting: No closing quotation', line);
  if (escaped) throw new MarkupError('Invalid attribute quoting: No escaped character', line);
  if (current !== null) tokens.push(current);
  return tokens;
}

export function parseAttributes(source: string, line: number, options: { commas?: boolean } = {}): Attributes {
  source = source.trim();
  if (source.startsWith('{') && source.endsWith('}')) source = source.slice(1, -1);
  const result: Attributes = {};
  const classes: string[] = [];
  for (const token of tokenize(source, line, options.commas ? ' \t\r\n,' : ' \t\r\n')) {
    if (token === '.element' || token === '.group') continue;
    if (token.startsWith('.')) {
      if (!/^\.[A-Za-z_][\w-]*$/.test(token)) throw new MarkupError(`Invalid class name ${JSON.stringify(token)}`, line);
      classes.push(token.slice(1));
      continue;
    }
    let key: string;
    let value: string;
    if (token.startsWith('#')) [key, value] = ['id', token.slice(1)];
    else if (token.includes('=')) {
      const index = token.indexOf('=');
      [key, value] = [token.slice(0, index), token.slice(index + 1)];
    } else if (token.includes(':') && POSITION_REFERENCES.has(token.split(':', 1)[0])) {
      const index = token.indexOf(':');
      [key, value] = [token.slice(0, index), token.slice(index + 1)];
    } else throw new MarkupError(`Expected an attribute such as x=2; found ${JSON.stringify(token)}`, line);
    if (key in result) throw new MarkupError(`Duplicate attribute ${JSON.stringify(key)}`, line);
    result[key] = value;
  }
  if ('style' in result) {
    if ('color' in result) throw new MarkupError('Use either color= or style= for color, not both', line);
    result.color = cssColor(result.style, line);
    delete result.style;
  }
  if (classes.length) {
    if ('class' in result) throw new MarkupError('Use .name tokens or class=, not both', line);
    result.class = classes.join(' ');
  }
  return result;
}

const CSS_NAMED: Record<string, string> = {
  aliceblue: '#F0F8FF', antiquewhite: '#FAEBD7', aqua: '#00FFFF', aquamarine: '#7FFFD4', azure: '#F0FFFF', beige: '#F5F5DC',
  bisque: '#FFE4C4', black: '#000000', blanchedalmond: '#FFEBCD', blue: '#0000FF', blueviolet: '#8A2BE2', brown: '#A52A2A',
  burlywood: '#DEB887', cadetblue: '#5F9EA0', chartreuse: '#7FFF00', chocolate: '#D2691E', coral: '#FF7F50',
  cornflowerblue: '#6495ED', cornsilk: '#FFF8DC', crimson: '#DC143C', cyan: '#00FFFF', darkblue: '#00008B', darkcyan: '#008B8B',
  darkgoldenrod: '#B8860B', darkgray: '#A9A9A9', darkgreen: '#006400', darkgrey: '#A9A9A9', darkkhaki: '#BDB76B',
  darkmagenta: '#8B008B', darkolivegreen: '#556B2F', darkorange: '#FF8C00', darkorchid: '#9932CC', darkred: '#8B0000',
  darksalmon: '#E9967A', darkseagreen: '#8FBC8F', darkslateblue: '#483D8B', darkslategray: '#2F4F4F', darkslategrey: '#2F4F4F',
  darkturquoise: '#00CED1', darkviolet: '#9400D3', deeppink: '#FF1493', deepskyblue: '#00BFFF', dimgray: '#696969',
  dimgrey: '#696969', dodgerblue: '#1E90FF', firebrick: '#B22222', floralwhite: '#FFFAF0', forestgreen: '#228B22',
  fuchsia: '#FF00FF', gainsboro: '#DCDCDC', ghostwhite: '#F8F8FF', gold: '#FFD700', goldenrod: '#DAA520', gray: '#808080',
  green: '#008000', greenyellow: '#ADFF2F', grey: '#808080', honeydew: '#F0FFF0', hotpink: '#FF69B4', indianred: '#CD5C5C',
  indigo: '#4B0082', ivory: '#FFFFF0', khaki: '#F0E68C', lavender: '#E6E6FA', lavenderblush: '#FFF0F5', lawngreen: '#7CFC00',
  lemonchiffon: '#FFFACD', lightblue: '#ADD8E6', lightcoral: '#F08080', lightcyan: '#E0FFFF', lightgoldenrodyellow: '#FAFAD2',
  lightgray: '#D3D3D3', lightgreen: '#90EE90', lightgrey: '#D3D3D3', lightpink: '#FFB6C1', lightsalmon: '#FFA07A',
  lightseagreen: '#20B2AA', lightskyblue: '#87CEFA', lightslategray: '#778899', lightslategrey: '#778899',
  lightsteelblue: '#B0C4DE', lightyellow: '#FFFFE0', lime: '#00FF00', limegreen: '#32CD32', linen: '#FAF0E6', magenta: '#FF00FF',
  maroon: '#800000', mediumaquamarine: '#66CDAA', mediumblue: '#0000CD', mediumorchid: '#BA55D3', mediumpurple: '#9370DB',
  mediumseagreen: '#3CB371', mediumslateblue: '#7B68EE', mediumspringgreen: '#00FA9A', mediumturquoise: '#48D1CC',
  mediumvioletred: '#C71585', midnightblue: '#191970', mintcream: '#F5FFFA', mistyrose: '#FFE4E1', moccasin: '#FFE4B5',
  navajowhite: '#FFDEAD', navy: '#000080', oldlace: '#FDF5E6', olive: '#808000', olivedrab: '#6B8E23', orange: '#FFA500',
  orangered: '#FF4500', orchid: '#DA70D6', palegoldenrod: '#EEE8AA', palegreen: '#98FB98', paleturquoise: '#AFEEEE',
  palevioletred: '#DB7093', papayawhip: '#FFEFD5', peachpuff: '#FFDAB9', peru: '#CD853F', pink: '#FFC0CB', plum: '#DDA0DD',
  powderblue: '#B0E0E6', purple: '#800080', rebeccapurple: '#663399', red: '#FF0000', rosybrown: '#BC8F8F', royalblue: '#4169E1',
  saddlebrown: '#8B4513', salmon: '#FA8072', sandybrown: '#F4A460', seagreen: '#2E8B57', seashell: '#FFF5EE', sienna: '#A0522D',
  silver: '#C0C0C0', skyblue: '#87CEEB', slateblue: '#6A5ACD', slategray: '#708090', slategrey: '#708090', snow: '#FFFAFA',
  springgreen: '#00FF7F', steelblue: '#4682B4', tan: '#D2B48C', teal: '#008080', thistle: '#D8BFD8', tomato: '#FF6347',
  turquoise: '#40E0D0', violet: '#EE82EE', wheat: '#F5DEB3', white: '#FFFFFF', whitesmoke: '#F5F5F5', yellow: '#FFFF00',
  yellowgreen: '#9ACD32',
};

let enginePalette: Map<string, string> | null = null;

function palette(): Map<string, string> {
  if (!enginePalette) {
    enginePalette = new Map();
    for (const [name, value] of Object.entries(engine as unknown as Record<string, unknown>)) {
      if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) && /^[A-Z_0-9]+$/.test(name)) {
        enginePalette.set(name, value.toUpperCase());
      }
    }
  }
  return enginePalette;
}

function parseCssRgb(value: string): string | null {
  const match = value.match(/^rgba?\(\s*([^)]*)\)$/i);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channels = parts.slice(0, 3).map((part) => {
    if (part.endsWith('%')) return Math.round((parseFloat(part) / 100) * 255);
    return Math.round(parseFloat(part));
  });
  if (channels.some((c) => !Number.isFinite(c) || c < 0 || c > 255)) return null;
  if (parts.length > 3) {
    const alpha = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if (alpha !== 1) throw new Error('Transparent text colors are not supported');
  }
  return '#' + channels.map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('');
}

/** Normalize a CSS color (named, hex or rgb) to an opaque six-digit hex string. */
export function parseCssColor(value: string): string {
  const trimmed = value.trim();
  const named = CSS_NAMED[trimmed.toLowerCase()];
  if (named) return named;
  const hex = trimmed.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3) digits = digits.split('').map((d) => d + d).join('');
    if (digits.length === 8) {
      if (digits.slice(6).toLowerCase() !== 'ff') throw new Error('Transparent text colors are not supported');
      digits = digits.slice(0, 6);
    }
    return '#' + digits.toUpperCase();
  }
  const rgb = parseCssRgb(trimmed);
  if (rgb) return rgb;
  throw new Error(`Invalid color ${JSON.stringify(value)}`);
}

/** Normalize an engine palette name, hex value or CSS color into a hex string. */
export function parseColor(value: string): string {
  const trimmed = value.trim();
  const fromPalette = palette().get(trimmed.toUpperCase());
  if (fromPalette) return fromPalette;
  return parseCssColor(trimmed);
}

/** Normalize an opaque CSS color declaration into the existing color AST. */
export function cssColor(style: string, line: number): string {
  let color: string | null = null;
  for (const declaration of style.split(';')) {
    if (!declaration.trim()) continue;
    const index = declaration.indexOf(':');
    if (index < 0 || !declaration.slice(index + 1).trim()) throw new MarkupError('Expected a CSS declaration such as color:red', line);
    if (declaration.slice(0, index).trim().toLowerCase() !== 'color') {
      throw new MarkupError('Only the CSS color property is supported; use Markdown for emphasis', line);
    }
    color = declaration.slice(index + 1).trim();
  }
  if (color === null) throw new MarkupError('style must contain a CSS color declaration', line);
  try {
    return parseCssColor(color);
  } catch (error) {
    throw new MarkupError(`Invalid or non-opaque CSS color ${JSON.stringify(color)}`, line);
  }
}

export function stepValue(attrs: Attributes, key: string, line: number, fallback = 0): number {
  const value = attrs[key] ?? String(fallback);
  if (!/^\d+$/.test(value)) throw new MarkupError(`${key} must be a nonnegative integer`, line);
  return Number(value);
}

export function numberValue(attrs: Attributes, key: string, line: number, fallback: number | null = null): number | null {
  const value = attrs[key] ?? fallback;
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || (typeof value === 'string' && !value.trim())) throw new MarkupError(`${key} must be a number`, line);
  if (['width', 'height', 'font_size'].includes(key) && number <= 0) throw new MarkupError(`Invalid ${key}: ${value}`, line);
  return number;
}

export type Endpoint = string | [number, number, number];

export function endpoint(value: string, line: number): Endpoint {
  if (value.startsWith('#')) return value.slice(1);
  const parts = value.replace(/^\(|\)$/g, '').split(',').map((part) => part.trim());
  const coordinates = parts.map(Number);
  if (coordinates.length !== 2 || parts.some((p) => !p) || coordinates.some((c) => !Number.isFinite(c))) {
    throw new MarkupError('Coordinates must be two finite numbers', line);
  }
  return [coordinates[0], coordinates[1], 0];
}

export function polylinePoints(value: string, line: number, minimum = 2): Array<[number, number, number]> {
  const tokens = value.match(/\([^()]+\)/g) ?? [];
  if (tokens.length < minimum || value.replace(/\([^()]+\)/g, '').trim()) {
    throw new MarkupError(`${minimum === 2 ? 'Polyline' : 'Polygon'} points require at least ${minimum === 2 ? 'two' : 'three'} (x,y) coordinates`, line);
  }
  const points = tokens.map((token) => endpoint(token, line) as [number, number, number]);
  for (let i = 1; i < points.length; i++) {
    if (points[i][0] === points[i - 1][0] && points[i][1] === points[i - 1][1]) {
      throw new MarkupError('Consecutive polyline points must be distinct', line);
    }
  }
  return points;
}
