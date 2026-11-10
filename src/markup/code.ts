/**
 * Verbatim code listings for markup slides.
 *
 * `tokenizeCode` classifies comments, strings, numbers, keywords, types,
 * directives and attributes for a handful of common languages (plus this
 * project's own slide dialect); `layoutCode` stacks the resulting monospace
 * lines into one group whose first baseline is exposed through
 * `markupBaselineFraction`, like prose paragraphs.
 */
import { Group, type Mobject } from 'manim-web';
import { MONOSPACE, StyledLine, type TextRun } from './text';
import { tokenizeCode, type TokenClass } from './tokens';

export { tokenizeCode, languageFor } from './tokens';
export type { TokenClass, CodeToken } from './tokens';

export type CodeTheme = Partial<Record<TokenClass, string>>;

/** Token colors for light text on a dark background. */
export const DARK_CODE_THEME: CodeTheme = {
  keyword: '#569CD6', type: '#4EC9B0', string: '#CE9178', comment: '#6A9955', number: '#B5CEA8', directive: '#DCDCAA', attribute: '#9CDCFE',
};

/** Token colors for dark text on a light background. */
export const LIGHT_CODE_THEME: CodeTheme = {
  keyword: '#0000FF', type: '#267F99', string: '#A31515', comment: '#008000', number: '#098658', directive: '#795E26', attribute: '#001080',
};

/** Pick the theme that contrasts with the slide's text color (and hence its background). */
export function codeThemeFor(textColor: string): CodeTheme {
  const hex = textColor.replace('#', '');
  if (hex.length < 6) return DARK_CODE_THEME;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? DARK_CODE_THEME : LIGHT_CODE_THEME;
}

export interface CodeLayoutOptions {
  fontSize: number;
  maxWidth: number;
  defaultColor: string;
  lineGap: number;
  /** CSS font family; defaults to the platform monospace stack. */
  fontFamily?: string;
  theme?: CodeTheme | null;
}

/** Stack highlighted monospace lines; the block scales down if wider than `maxWidth`. */
export function layoutCode(source: string, language: string, options: CodeLayoutOptions): Mobject {
  const { fontSize, maxWidth, defaultColor, lineGap } = options;
  const theme = options.theme === undefined ? codeThemeFor(defaultColor) : options.theme ?? {};
  const family = options.fontFamily || MONOSPACE;
  const lines = tokenizeCode(source, language).map((tokens) => {
    if (!tokens.some((token) => token.text.trim())) return null;
    const runs: TextRun[] = tokens.map((token) => ({
      text: token.text, bold: Boolean(token.bold), italic: token.cls === 'comment', color: theme[token.cls] ?? defaultColor, mono: false,
    }));
    return new StyledLine({ runs, fontSize, fontFamily: family, baseColor: defaultColor });
  });
  const present = lines.filter((line): line is StyledLine => line !== null);
  if (!present.length) return new Group();
  const pitch = Math.max(...present.map((line) => line.fontAscent + line.fontDescent)) + lineGap / 2;
  lines.forEach((line, index) => line?.placeOrigin(0, -index * pitch));
  const block = new Group(...present) as Group & { markupBaselineFraction: number };
  const width = Math.max(...present.map((line) => line.advance));
  if (width > maxWidth + 1e-6) block.scale(maxWidth / width, { aboutPoint: [0, 0, 0] });
  const height = block.getHeight();
  block.markupBaselineFraction = height > 0 ? -block.getCenter()[1] / height : 0;
  block.center();
  return block;
}
