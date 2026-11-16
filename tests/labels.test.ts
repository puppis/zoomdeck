import { describe, expect, it } from 'vitest';
import { Line, Rectangle } from 'manim-web';
import { placeLabel } from '../src/markup/renderer';
import { MarkupParser } from '../src/markup/parser';

type Point = [number, number, number];

/** A 2 × 0.5 stand-in for a label, placed on the line from `start` to `end`; its center, rounded. */
function place(start: Point, end: Point, slanted = false, side: 'above' | 'below' = 'above'): number[] {
  const label = new Rectangle({ width: 2, height: 0.5 });
  placeLabel(label, new Line({ start, end }), start, end, slanted, side);
  return label.getCenter().slice(0, 2).map((v: number) => Math.round(v * 1000) / 1000);
}

describe('the label of an arrow or a line', () => {
  it('stays above or below a level edge, whichever way it points', () => {
    const [x, y] = place([-2, 0, 0], [2, 0, 0]);
    expect(x).toBeCloseTo(0, 3);
    expect(y).toBeGreaterThan(0.25);
    expect(place([2, 0, 0], [-2, 0, 0])[1]).toBeGreaterThan(0.25);
    expect(place([-2, 0, 0], [2, 0, 0], false, 'below')[1]).toBeLessThan(-0.25);
  });

  it('sits beside the middle of a slanted edge, upright and clear of the line, or turned along it', () => {
    // An edge rising at 45 degrees: the upright box reaches the line by (2 + 0.5) / 2 · √½, then the gap.
    const reach = (Math.SQRT1_2 * 2) / 2 + (Math.SQRT1_2 * 0.5) / 2 + 0.1;
    expect(place([0, 0, 0], [2, 2, 0])).toEqual([1 - Math.SQRT1_2 * reach, 1 + Math.SQRT1_2 * reach].map((v) => Math.round(v * 1000) / 1000));
    // Slanted, only its height separates it from the line.
    const along = 0.25 + 0.1;
    expect(place([0, 0, 0], [2, 2, 0], true)).toEqual([1 - Math.SQRT1_2 * along, 1 + Math.SQRT1_2 * along].map((v) => Math.round(v * 1000) / 1000));
    // Below is the other side of the edge.
    expect(place([0, 0, 0], [2, 2, 0], true, 'below')).toEqual([1 + Math.SQRT1_2 * along, 1 - Math.SQRT1_2 * along].map((v) => Math.round(v * 1000) / 1000));
  });

  it('takes the side in its own frame: above a vertical edge is its left, whichever way the edge points', () => {
    // Upright on a vertical edge, half its width away; slanted, half its height.
    expect(place([0, -2, 0], [0, 2, 0])).toEqual([-1.1, 0]);
    expect(place([0, 2, 0], [0, -2, 0])).toEqual([-1.1, 0]);
    expect(place([0, -2, 0], [0, 2, 0], true)).toEqual([-0.35, 0]);
    expect(place([0, -2, 0], [0, 2, 0], true, 'below')).toEqual([0.35, 0]);
  });

  it('accepts slanted and label_side only with a label, and only the sides an edge has', () => {
    const parse = (body: string) => new MarkupParser().parse(`::: slide {#s}\n[[rectangle: #a x=-3 y=0 width=1 height=1]]\n\n[[rectangle: #b x=3 y=2 width=1 height=1]]\n\n${body}\n:::`);
    expect(() => parse('[[arrow: #a -> #b, #e, label="x", slanted=true, label_side=below]]')).not.toThrow();
    expect(() => parse('[[arrow: #a -> #b, #e, slanted=true]]')).toThrow(/requires a label/);
    expect(() => parse('[[line: #a -> #b, #e, label="x", label_side=left]]')).toThrow(/above or below/);
    expect(() => parse('[[arrow: #a -> #b, #e, label="x", slanted=yes]]')).toThrow(/true or false/);
  });
});
