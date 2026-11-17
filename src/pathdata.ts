/**
 * SVG path data, read safely.
 *
 * The engine's path parser splits numbers at spaces, commas and a minus sign between two digits,
 * but its pattern misses the second of two such signs in a row: in `34-155-5-155` it keeps
 * `-5-155` whole, which reads as NaN, and the shape gets a point nowhere. Its bounds become NaN
 * too, and so does anything laid out against them. MathJax writes its glyphs that way (the
 * subscript p of `$x_p$`), and so do many SVG editors. A space before every minus sign that
 * follows a number means the same path and avoids it.
 */
import { parseSVGPathData } from 'manim-web';

/** `d` with a space before every minus sign that follows a digit or a decimal point. */
export function spacePathNumbers(d: string): string {
  return d.replace(/([0-9.])-/g, '$1 -');
}

/** The engine's reading of SVG path data, without its NaN points: subpaths of `[x, y]` points. */
export function parsePathData(d: string): number[][][] {
  return parseSVGPathData(spacePathNumbers(d));
}

/** The path data of every `<path>` in an SVG document, spaced as `spacePathNumbers` does. */
export function spaceSvgPathNumbers(svg: string): string {
  return svg.replace(/(<path\b[^>]*?\sd=")([^"]*)"/g, (_, head: string, d: string) => `${head}${spacePathNumbers(d)}"`);
}

let installed = false;

/**
 * Formulas reach the engine as MathJax SVG markup read with `DOMParser`, where Zoomdeck cannot
 * reach the path data otherwise: space it there, for MathJax output only (it carries
 * `data-mml-node`). Installed once; every other document is parsed as it is.
 */
export function installMathPathFix(): void {
  if (installed || typeof DOMParser === 'undefined') return;
  installed = true;
  const parse = DOMParser.prototype.parseFromString;
  DOMParser.prototype.parseFromString = function parseFromString(this: DOMParser, source: string, type: DOMParserSupportedType): Document {
    const fixed = type === 'image/svg+xml' && typeof source === 'string' && source.includes('data-mml-node') ? spaceSvgPathNumbers(source) : source;
    return parse.call(this, fixed, type);
  } as typeof parse;
}
