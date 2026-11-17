import { describe, expect, it, vi } from 'vitest';
import { Circle, type VMobject } from 'manim-web';
import { svgToMobject } from '../src/svg';
import { flatten, intersectPolygons, makeRegion, strokeOutline, strokePlacement, type Subpath } from '../src/clip';

const area = (points: readonly (readonly number[])[]) => {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const q = points[(i + 1) % points.length];
    sum += points[i][0] * q[1] - q[0] * points[i][1];
  }
  return sum / 2;
};
const square = (x0: number, y0: number, x1: number, y1: number): Subpath => [
  [x0, y0], [x0 + (x1 - x0) / 3, y0], [x0 + (2 * (x1 - x0)) / 3, y0], [x1, y0],
  [x1, y0 + (y1 - y0) / 3], [x1, y0 + (2 * (y1 - y0)) / 3], [x1, y1],
  [x1 - (x1 - x0) / 3, y1], [x1 - (2 * (x1 - x0)) / 3, y1], [x0, y1],
  [x0, y1 - (y1 - y0) / 3], [x0, y1 - (2 * (y1 - y0)) / 3], [x0, y0],
];
/** An SVG 100 × 100, drawn 10 units wide: one unit is ten of its pixels; what it draws is centered. */
const draw = (body: string) => svgToMobject(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`, { width: 10 });
const shapes = (body: string) => draw(body).children as VMobject[];
const xs = (vmob: VMobject) => vmob.getPoints().map(([x]) => x);

describe('regions', () => {
  it('know where a stroke lies against them, its width included', () => {
    const region = makeRegion([{ subpaths: [square(0, 0, 4, 4)], rule: 'nonzero' }])!;
    const line = (x0: number, x1: number): Subpath => [[x0, 2], [x0 + (x1 - x0) / 3, 2], [x0 + (2 * (x1 - x0)) / 3, 2], [x1, 2]];
    expect(strokePlacement(line(1, 3), 0.1, [region])).toBe('inside');
    expect(strokePlacement(line(1, 3.95), 0.1, [region])).toBe('across');
    expect(strokePlacement(line(1, 5), 0.1, [region])).toBe('across');
    expect(strokePlacement(line(5, 6), 0.1, [region])).toBe('outside');
  });

  it('cut the outline of a stroke, a closed one in two halves with no hole', () => {
    const ring: Subpath = new Circle({ radius: 1 }).getPoints().map(([x, y]) => [x, y] as const);
    const halves = strokeOutline(ring, 0.1);
    expect(halves).toHaveLength(2);
    // Each half is half the ring between radii 0.9 and 1.1.
    for (const half of halves) expect(Math.abs(area(half))).toBeCloseTo(0.2 * Math.PI, 2);
    const right = makeRegion([{ subpaths: [square(0, -2, 2, 2)], rule: 'nonzero' }])!;
    const cut = intersectPolygons(halves, [right], true);
    const total = cut.reduce((sum, piece) => sum + Math.abs(area(flatten(piece, 1))), 0);
    expect(total).toBeCloseTo(0.2 * Math.PI, 1);
  });
});

describe('masks and clip paths of SVG artwork', () => {
  // A mask of the left half, in Figma's alpha form, on a group of a line across it and two dots.
  const masked = (mask: string) => `<mask id="m" ${mask}><rect x="0" y="0" width="50" height="100" fill="#A7F0BA"/></mask>`
    + '<g mask="url(#m)"><line x1="10" y1="50" x2="90" y2="50" stroke="black" stroke-width="2"/>'
    + '<circle cx="20" cy="20" r="5" fill="gray" stroke="black"/><circle cx="80" cy="20" r="5" fill="gray"/></g>';

  it('cut a line where it leaves the region, and drop or keep what lies wholly outside or inside', () => {
    const parts = shapes(masked('style="mask-type:alpha"'));
    // The line, ended on the border; the dot inside as it was, with its stroke; nothing of the other.
    expect(parts).toHaveLength(2);
    const [line, dot] = parts;
    // From 10 to the border at 50.
    expect(Math.max(...xs(line)) - Math.min(...xs(line))).toBeCloseTo(4, 6);
    expect(dot.getCenter()[0] - Math.min(...xs(line))).toBeCloseTo(1, 6);
    expect(dot.fillOpacity).toBe(1);
    expect(dot.strokeWidth).toBeGreaterThan(0);
    // The same, without the mask, draws everything in full.
    expect(shapes(masked('style="mask-type:alpha"').replace(' mask="url(#m)"', ''))).toHaveLength(3);
  });

  it('read a luminance mask by its light and dark shapes', () => {
    const light = shapes(masked('').replace('fill="#A7F0BA"', 'fill="white"'));
    expect(light).toHaveLength(2);
    // Black shows nothing.
    expect(shapes(masked('').replace('fill="#A7F0BA"', 'fill="black"'))).toHaveLength(0);
    // A dark shape over a light one hides what it covers.
    const holed = shapes('<mask id="m"><rect width="100" height="100" fill="white"/><rect x="0" y="0" width="50" height="100" fill="black"/></mask>'
      + '<g mask="url(#m)"><line x1="10" y1="50" x2="90" y2="50" stroke="black" stroke-width="2"/></g>');
    expect(holed[0].getWidth()).toBeCloseTo(4, 6);
  });

  it('cut a fill across the border to the region, and apply a clip path in its own transform', () => {
    const parts = shapes('<clipPath id="c"><rect width="50" height="100" transform="translate(0 0)"/></clipPath>'
      + '<g clip-path="url(#c)"><circle cx="50" cy="50" r="20" fill="red"/></g>');
    expect(parts).toHaveLength(1);
    // The circle from 30 to 70, cut at 50: a half disc.
    expect(parts[0].getWidth()).toBeCloseTo(2, 2);
    expect(parts[0].getHeight()).toBeCloseTo(4, 2);
    const moved = shapes('<clipPath id="c"><rect width="50" height="100" transform="translate(40 0)"/></clipPath>'
      + '<g clip-path="url(#c)"><circle cx="50" cy="50" r="20" fill="red"/></g>');
    expect(moved[0].getWidth()).toBeCloseTo(3, 2);
    // A circle whose stroke reaches past the border loses that part of its stroke, filled in its color.
    const near = shapes('<clipPath id="c"><rect width="50" height="100"/></clipPath><g clip-path="url(#c)"><circle cx="40" cy="50" r="9.5" fill="none" stroke="blue" stroke-width="2"/></g>');
    expect(near).toHaveLength(1);
    expect(near[0].fillOpacity).toBe(1);
    expect(near[0].getWidth()).toBeCloseTo(2.05, 2);
  });

  it('keep the inner half of a stroke masked by its own shape, as Figma draws an inside stroke', () => {
    const box = 'M20 20 H80 V80 H20 Z';
    const parts = shapes(`<defs><path id="s" d="${box}"/></defs><mask id="k" fill="white"><use xlink:href="#s"/></mask>`
      + `<path d="${box}" fill="none" stroke="#A00000" stroke-width="8" mask="url(#k)"/>`);
    expect(parts).toHaveLength(1);
    const [stroke] = parts;
    // Half as wide, its middle a quarter of the width inside: 2 pixels, a fifth of a unit.
    expect(stroke.strokeWidth).toBeCloseTo((4 / 10) * 100, 6);
    expect(stroke.getWidth()).toBeCloseTo(6 - 0.4, 6);
  });

  it('draw in full what they cannot apply, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const parts = shapes('<clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="0.5" height="1"/></clipPath><g clip-path="url(#c)"><line x1="10" y1="50" x2="90" y2="50" stroke="black"/></g>');
    expect(parts[0].getWidth()).toBeCloseTo(8, 6);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('objectBoundingBox'));
    shapes('<g mask="url(#none)"><line x1="10" y1="50" x2="90" y2="50" stroke="black"/></g>');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('#none not found'));
    warn.mockRestore();
  });
});
