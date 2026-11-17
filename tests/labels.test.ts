import { describe, expect, it } from 'vitest';
import { Line, Rectangle } from 'manim-web';
import { placeLabel } from '../src/markup/renderer';
import { MarkupParser } from '../src/markup/parser';

type Point = [number, number, number];

/** A 2 × 0.5 stand-in for a label, placed on the line from `start` to `end`; its center, rounded. */
function place(start: Point, end: Point, slanted = false, side: 'above' | 'below' = 'above', along = 0.5): number[] {
  const label = new Rectangle({ width: 2, height: 0.5 });
  placeLabel(label, new Line({ start, end }), start, end, slanted, side, along);
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

  it('sits at label_pos of the way from the start (0) to the end (1)', () => {
    // A level edge: the same height as in the middle, moved along.
    const [x, y] = place([-2, 0, 0], [2, 0, 0], false, 'above', 0.25);
    expect(x).toBeCloseTo(-1, 3);
    expect(y).toEqual(place([-2, 0, 0], [2, 0, 0])[1]);
    expect(place([-2, 0, 0], [2, 0, 0], false, 'below', 1)[0]).toBeCloseTo(2, 3);
    // A vertical edge pointing down: a quarter of the way is near its start, at the top.
    expect(place([0, 2, 0], [0, -2, 0], true, 'above', 0.25)).toEqual([-0.35, 1]);
    const parse = (body: string) => new MarkupParser().parse(`::: slide {#s}\n[[rectangle: #a x=-3 y=0 width=1 height=1]]\n\n[[rectangle: #b x=3 y=2 width=1 height=1]]\n\n${body}\n:::`);
    expect(() => parse('[[arrow: #a -> #b, #e, label="x", label_pos=0.3]]')).not.toThrow();
    expect(() => parse('[[arrow: #a -> #b, #e, label="x", label_pos=1.5]]')).toThrow(/from 0 \(the start\) to 1/);
    expect(() => parse('[[arrow: #a -> #b, #e, label="x", label_pos=near]]')).toThrow(/label_pos must be a number/);
    expect(() => parse('[[arrow: #a -> #b, #e, label_pos=0.3]]')).toThrow(/label_pos requires a label/);
  });

  it('may come from a style that unlabeled elements share, but not be written on one', () => {
    const shapes = '[[rectangle: #a x=-3 y=0 width=1 height=1]]\n\n[[rectangle: #b x=3 y=2 width=1 height=1]]\n\n';
    const styled = (body: string) => new MarkupParser().parse(`::: styles\nedge: label_pos=0.3 label_side=below slanted=true label_color=BLUE\n:::\n\n::: slide {#s}\n${shapes}${body}\n:::`);
    expect(() => styled('[[arrow: #a -> #b, #e, .edge]]')).not.toThrow();
    expect(() => styled('[[arrow: #a -> #b, #e, .edge, label="x"]]')).not.toThrow();
    expect(() => styled('[[arrow: #a -> #b, #e, .edge, label_pos=0.5]]')).toThrow(/label_pos requires a label/);
  });

  it('takes a color of its own with label_color, on arrows, lines, braces and icons', () => {
    const parse = (body: string) => new MarkupParser().parse(`::: slide {#s}\n[[rectangle: #a x=-3 y=0 width=1 height=1]]\n\n[[rectangle: #b x=3 y=2 width=1 height=1]]\n\n${body}\n:::`);
    expect(() => parse('[[arrow: #a -> #b, #e, label="x", color=GRAY, label_color=BLUE]]')).not.toThrow();
    expect(() => parse('[[brace: #a, #br, label="x", label_color=#FF0000]]')).not.toThrow();
    expect(() => parse('[[icon: user #u x=0 y=0 label="x" label_color=ORANGE]]')).not.toThrow();
    expect(() => parse('[[line: #a -> #b, #e, label_color=BLUE]]')).toThrow(/label_color requires a label/);
    expect(() => parse('[[arrow: #a -> #b, #e, label="x", label_color=notacolor]]')).toThrow(/Invalid color/);
  });
});
