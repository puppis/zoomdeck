import { describe, expect, it } from 'vitest';
import { parseSVGPathData } from 'manim-web';
import { installMathPathFix, parsePathData, spacePathNumbers, spaceSvgPathNumbers } from '../src/pathdata';

// The descender of MathJax's italic p, where two minus signs follow numbers in a row.
const DESCENDER = 'M154 321L44-118C35-151 34-155-5-155C-23-155-32-163-32-178';
const finite = (subpaths: number[][][]) => subpaths.every((subpath) => subpath.every((point) => point.every(Number.isFinite)));

describe('SVG path data', () => {
  it('reads two minus signs in a row that the engine alone reads as NaN', () => {
    expect(finite(parseSVGPathData(DESCENDER))).toBe(false);
    const subpaths = parsePathData(DESCENDER);
    expect(finite(subpaths)).toBe(true);
    expect(subpaths[0].at(-1)).toEqual([-32, -178]);
    expect(subpaths[0]).toContainEqual([-5, -155]);
  });

  it('spaces only minus signs that follow a number, leaving exponents and other separators', () => {
    expect(spacePathNumbers('M1-2-3.5-4L.5-.5')).toBe('M1 -2 -3.5 -4L.5 -.5');
    expect(spacePathNumbers('M1e-5 2 L-3,-4')).toBe('M1e-5 2 L-3,-4');
    expect(spaceSvgPathNumbers('<g data-c="1-2"><path data-c="1D45D" d="M1-2-3"></path></g>')).toBe('<g data-c="1-2"><path data-c="1D45D" d="M1 -2 -3"></path></g>');
  });

  it('spaces the path data of MathJax output read by DOMParser, and nothing else', () => {
    installMathPathFix();
    const read = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('path')?.getAttribute('d');
    expect(read(`<svg xmlns="http://www.w3.org/2000/svg"><g data-mml-node="mi"><path d="${DESCENDER}"/></g></svg>`)).toBe(spacePathNumbers(DESCENDER));
    expect(read(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${DESCENDER}"/></svg>`)).toBe(DESCENDER);
  });
});
