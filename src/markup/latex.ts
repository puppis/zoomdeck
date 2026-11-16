/**
 * LaTeX color support on top of the engine's MathJax configuration, which
 * loads no `color` package. `\textcolor` and `\color` are rewritten into
 * MathJax `\class` groups and the rendered glyphs are recolored afterwards.
 */
import { VMobject, getGlyphClasses, type Mobject } from 'manim-web';
import { parseCssColor } from './ast';

/** dvipsnames and xcolor base colors as sRGB hex values. */
export const LATEX_COLORS: Record<string, string> = {
  Apricot: '#FBB982', Aquamarine: '#00B5BE', Bittersweet: '#C04F17', Black: '#221E1F', Blue: '#2D2F92', BlueGreen: '#00B3B8',
  BlueViolet: '#473992', BrickRed: '#B6321C', Brown: '#792500', BurntOrange: '#F7921D', CadetBlue: '#74729A',
  CarnationPink: '#F282B4', Cerulean: '#00A2E3', CornflowerBlue: '#41B0E4', Cyan: '#00AEEF', Dandelion: '#FDBC42',
  DarkOrchid: '#A4538A', Emerald: '#00A99D', ForestGreen: '#009B55', Fuchsia: '#8C368C', Goldenrod: '#FFDF42', Gray: '#949698',
  Green: '#00A64F', GreenYellow: '#DFE674', JungleGreen: '#00A99A', Lavender: '#F49EC4', LimeGreen: '#8DC73E', Magenta: '#EC008C',
  Mahogany: '#A9341F', Maroon: '#AF3235', Melon: '#F89E7B', MidnightBlue: '#006795', Mulberry: '#A93C93', NavyBlue: '#006EB8',
  OliveGreen: '#3C8031', Orange: '#F58137', OrangeRed: '#ED135A', Orchid: '#AF72B0', Peach: '#F7965A', Periwinkle: '#7977B8',
  PineGreen: '#008B72', Plum: '#92268F', ProcessBlue: '#00B0F0', Purple: '#99479B', RawSienna: '#974006', Red: '#ED1B23',
  RedOrange: '#F26035', RedViolet: '#A1246B', Rhodamine: '#EF559F', RoyalBlue: '#0071BC', RoyalPurple: '#613F99',
  RubineRed: '#ED017D', Salmon: '#F69289', SeaGreen: '#3FBC9D', Sepia: '#671800', SkyBlue: '#46C5DD', SpringGreen: '#C6DC67',
  Tan: '#DA9D76', TealBlue: '#00AEB3', Thistle: '#D883B7', Turquoise: '#00B4CE', Violet: '#58429B', VioletRed: '#EF58A0',
  White: '#FFFFFF', WildStrawberry: '#EE2967', Yellow: '#FFF200', YellowGreen: '#98CC70', YellowOrange: '#FAA21A',
  red: '#FF0000', green: '#00FF00', blue: '#0000FF', cyan: '#00FFFF', magenta: '#FF00FF', yellow: '#FFFF00', black: '#000000',
  white: '#FFFFFF', gray: '#808080', darkgray: '#A9A9A9', lightgray: '#D3D3D3', brown: '#BF8040', lime: '#BFFF00', olive: '#808000',
  orange: '#FF8000', pink: '#FFBFBF', purple: '#BF0040', teal: '#008080', violet: '#800080',
};

const CLASS_PREFIX = 'zdc-';

function resolveLatexColor(model: string | null, value: string): string | null {
  const trimmed = value.trim();
  if (model === 'HTML') return '#' + trimmed.toUpperCase();
  if (model === 'rgb') {
    const parts = trimmed.split(',').map((p) => Math.round(Math.min(1, Math.max(0, parseFloat(p))) * 255));
    if (parts.length === 3 && parts.every(Number.isFinite)) return '#' + parts.map((p) => p.toString(16).padStart(2, '0').toUpperCase()).join('');
    return null;
  }
  if (model === 'RGB') {
    const parts = trimmed.split(',').map((p) => Math.round(parseFloat(p)));
    if (parts.length === 3 && parts.every(Number.isFinite)) return '#' + parts.map((p) => p.toString(16).padStart(2, '0').toUpperCase()).join('');
    return null;
  }
  const named = LATEX_COLORS[trimmed] ?? LATEX_COLORS[trimmed.toLowerCase()];
  if (named) return named;
  try {
    return parseCssColor(trimmed);
  } catch {
    return null;
  }
}

/** Index just past the group that opens at `start` (`source[start] === '{'`). */
function groupEnd(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}

/**
 * A deck macro as `deck.json` writes it, in MathJax's own form: the expansion alone, or the
 * expansion and its number of arguments (`#1` to `#9`), or also the default of an optional first
 * argument, given in brackets.
 */
export type MacroDefinition = string | [string, number] | [string, number, string];

/** A deck macro ready to expand. */
export interface Macro {
  expansion: string;
  args: number;
  /** The default of the optional first argument, when it has one. */
  optional?: string;
}

/** An error in a formula; the slide that holds the formula adds its line. */
export class LatexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LatexError';
  }
}

/** Check the macros of `deck.json` and make them ready to expand. */
export function compileMacros(definitions: Record<string, unknown> | undefined): Map<string, Macro> {
  const macros = new Map<string, Macro>();
  if (definitions === undefined || definitions === null) return macros;
  if (typeof definitions !== 'object' || Array.isArray(definitions)) throw new Error('deck.json: "macros" must map names to expansions');
  for (const [name, value] of Object.entries(definitions)) {
    const where = `deck.json: macro ${JSON.stringify(name)}`;
    if (!/^[A-Za-z]+$/.test(name)) throw new Error(`${where}: a name is letters only, without the backslash`);
    let macro: Macro;
    if (typeof value === 'string') macro = { expansion: value, args: 0 };
    else if (Array.isArray(value) && typeof value[0] === 'string' && Number.isInteger(value[1]) && value[1] >= 0 && value[1] <= 9
      && (value.length === 2 || (value.length === 3 && typeof value[2] === 'string' && value[1] >= 1))) {
      macro = { expansion: value[0], args: value[1], ...(value.length === 3 ? { optional: value[2] as string } : {}) };
    } else {
      throw new Error(`${where}: write an expansion, or [expansion, number of arguments from 1 to 9], or [expansion, number of arguments, default of the optional first one]`);
    }
    for (const match of macro.expansion.matchAll(/#+([1-9]?)/g)) {
      // `##` is a literal `#`; an odd one out must name an argument the macro takes.
      if ((match[0].length - match[1].length) % 2 === 0) continue;
      const index = Number(match[1]);
      if (!index || index > macro.args) {
        throw new Error(`${where}: #${match[1]} in its expansion, but it takes ${macro.args === 0 ? 'no arguments' : macro.args === 1 ? 'one argument' : `${macro.args} arguments`}`);
      }
    }
    macros.set(name, macro);
  }
  return macros;
}

/** The macros MathJax is also given: those without arguments, for the places expansion leaves alone (`\let\foo\N`). */
export function plainMacros(macros: ReadonlyMap<string, Macro>): Record<string, string> | undefined {
  const plain = Object.fromEntries([...macros].filter(([, macro]) => macro.args === 0).map(([name, macro]) => [name, macro.expansion]));
  return Object.keys(plain).length ? plain : undefined;
}

/** Commands that define a macro: the name after them is the formula's own, never expanded. */
const DEFINERS = new Set(['newcommand', 'renewcommand', 'providecommand', 'def', 'gdef', 'edef', 'xdef', 'let', 'DeclareMathOperator']);
/** Expansions in one formula past which a macro is taken to use itself without end. */
const MAX_EXPANSIONS = 10_000;

/** The name of the control sequence at `start` (a backslash) and the index just past it. */
function controlSequence(source: string, start: number): [string, number] {
  let end = start + 1;
  if (end >= source.length) return ['', end];
  if (!/[A-Za-z]/.test(source[end])) return [source[end], end + 1];
  while (end < source.length && /[A-Za-z]/.test(source[end])) end += 1;
  return [source.slice(start + 1, end), end];
}

function skipSpaces(source: string, index: number): number {
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

/** The index of the `close` that ends what opens at `start`, outside braces; -1 when there is none. */
function closing(source: string, start: number, close: string): number {
  let depth = 0;
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') i += 1;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      if (depth === 0) return close === '}' ? i : -1;
      depth -= 1;
    } else if (char === close && depth === 0) return i;
  }
  return -1;
}

/**
 * Join two pieces of a formula as MathJax does when it substitutes arguments: a control word
 * followed by a letter would read as a longer word, so a space keeps them apart.
 */
function join(left: string, right: string): string {
  return /(?:^|[^\\])(?:\\\\)*\\[A-Za-z]+$/.test(left) && /^[A-Za-z]/.test(right) ? `${left} ${right}` : left + right;
}

/** The arguments of a use of `\name` that ends at `index`, and the index just past them. */
function readArguments(source: string, index: number, name: string, macro: Macro): [string[], number] {
  const args: string[] = [];
  const takes = macro.optional !== undefined ? `${macro.args} arguments, the first one optional`
    : macro.args === 1 ? 'one argument' : `${macro.args} arguments`;
  for (let k = 0; k < macro.args; k++) {
    const at = skipSpaces(source, index);
    if (k === 0 && macro.optional !== undefined) {
      if (source[at] === '[') {
        const end = closing(source, at, ']');
        if (end < 0) throw new LatexError(`\\${name}: the optional argument opened with [ is never closed`);
        // As in TeX, braces around the whole of it (to hold a bracket) are not part of it.
        const optional = source.slice(at + 1, end);
        args.push(optional.startsWith('{') && closing(optional, 0, '}') === optional.length - 1 ? optional.slice(1, -1) : optional);
        index = end + 1;
      } else args.push(macro.optional);
      continue;
    }
    if (at >= source.length || source[at] === '}' || source[at] === '&') {
      throw new LatexError(`\\${name} takes ${takes}: argument ${k + 1} is missing`);
    }
    if (source[at] === '{') {
      const end = closing(source, at, '}');
      if (end < 0) throw new LatexError(`\\${name}: an argument opened with { is never closed`);
      args.push(source.slice(at + 1, end));
      index = end + 1;
    } else if (source[at] === '\\') {
      const [, end] = controlSequence(source, at);
      args.push(source.slice(at, end));
      index = end;
    } else {
      args.push(source[at]);
      index = at + 1;
    }
  }
  return [args, index];
}

/** A macro's expansion with its arguments in place of `#1` to `#9`, and `#` for `##`. */
function substitute(expansion: string, args: readonly string[]): string {
  let result = '';
  let last = 0;
  for (const match of expansion.matchAll(/##|#([1-9])/g)) {
    result = join(result, expansion.slice(last, match.index));
    result = join(result, match[0] === '##' ? '#' : args[Number(match[1]) - 1]);
    last = (match.index ?? 0) + match[0].length;
  }
  return join(result, expansion.slice(last));
}

/**
 * Expand the deck's macros in a formula, as TeX would: a use reads its arguments (a `{group}`, a
 * command or a character, and the optional first one in brackets), and what it expands to is read
 * again, so macros may use one another and take arguments from the text that follows. A name the
 * formula defines for itself (`\newcommand`, `\def`, `\let`…) is left to MathJax from there on.
 */
export function expandMacros(source: string, macros: ReadonlyMap<string, Macro>): string {
  if (!macros.size || !source.includes('\\')) return source;
  let text = source;
  const own = new Set<string>();
  let expansions = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '\\') {
      i += 1;
      continue;
    }
    const [name, end] = controlSequence(text, i);
    if (DEFINERS.has(name)) {
      // The name defined comes next, bare or in braces; \let also leaves the command it copies alone.
      let at = skipSpaces(text, end);
      if (text[at] === '*') at = skipSpaces(text, at + 1);
      if (text[at] === '{') at = skipSpaces(text, at + 1);
      if (text[at] !== '\\') {
        i = end;
        continue;
      }
      const [defined, after] = controlSequence(text, at);
      own.add(defined);
      i = after;
      if (name === 'let') {
        at = skipSpaces(text, i);
        if (text[at] === '=') at = skipSpaces(text, at + 1);
        if (text[at] === '\\') i = controlSequence(text, at)[1];
      }
      continue;
    }
    const macro = own.has(name) ? undefined : macros.get(name);
    if (!macro) {
      i = end;
      continue;
    }
    expansions += 1;
    if (expansions > MAX_EXPANSIONS) throw new LatexError(`\\${name} expands without end: a macro uses itself`);
    const [args, after] = readArguments(text, end, name, macro);
    const before = text.slice(0, i);
    text = join(join(before, substitute(macro.expansion, args)), text.slice(after));
    // Read the expansion again from its start: it may use macros, and take arguments from what follows.
    i = before.length;
  }
  return text;
}

/** The message of a MathJax error in a rendered formula, if it is one. */
export function latexErrorOf(svg: string): string | null {
  const match = /data-mjx-error="([^"]*)"/.exec(svg);
  if (!match) return null;
  return match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&amp;/g, '&');
}

/**
 * Rewrite `\textcolor` and `\color` into `\class` groups MathJax understands,
 * and spell `<` / `>` as commands: a literal `<` breaks the engine's render path.
 */
export function preprocessLatex(source: string): string {
  return rewriteColors(source).replace(/<(?!=)/g, '\\lt ').replace(/(?<!-)>(?!=)/g, '\\gt ');
}

function rewriteColors(source: string): string {
  let result = '';
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const match = /^\\(textcolor|color)\s*(?:\[([A-Za-z]+)\])?\s*\{/.exec(rest);
    if (!match) {
      result += source[i];
      if (source[i] === '\\' && i + 1 < source.length) {
        result += source[i + 1];
        i += 2;
      } else i += 1;
      continue;
    }
    const open = i + match[0].length - 1;
    const close = groupEnd(source, open);
    const color = resolveLatexColor(match[2] ?? null, source.slice(open + 1, close - 1));
    const className = color ? `${CLASS_PREFIX}${color.slice(1)}` : null;
    if (match[1] === 'textcolor') {
      const argStart = source.indexOf('{', close);
      if (argStart < 0) {
        i = close;
        continue;
      }
      const argEnd = groupEnd(source, argStart);
      const inner = rewriteColors(source.slice(argStart + 1, argEnd - 1));
      result += className ? `\\class{${className}}{${inner}}` : `{${inner}}`;
      i = argEnd;
    } else {
      // \color applies to the remainder of the enclosing group.
      let end = close;
      let depth = 0;
      for (; end < source.length; end++) {
        const char = source[end];
        if (char === '\\') {
          end += 1;
          continue;
        }
        if (char === '{') depth += 1;
        else if (char === '}') {
          if (depth === 0) break;
          depth -= 1;
        }
      }
      const inner = rewriteColors(source.slice(close, end));
      result += className ? `\\class{${className}}{${inner}}` : inner;
      i = end;
    }
  }
  return result;
}

/** Apply colors recorded by `preprocessLatex` to the rendered glyphs. */
export function applyLatexColors(tex: Mobject): void {
  for (const member of tex.getFamily()) {
    if (!(member instanceof VMobject) || !member.hasOwnPoints()) continue;
    const classes = getGlyphClasses(member);
    const colorClass = [...classes].reverse().find((name) => name.startsWith(CLASS_PREFIX));
    if (colorClass) member.setColor('#' + colorClass.slice(CLASS_PREFIX.length));
  }
}
