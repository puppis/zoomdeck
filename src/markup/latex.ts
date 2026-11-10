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
