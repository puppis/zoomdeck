import { describe, expect, it } from 'vitest';
import { Circle, Rectangle } from 'manim-web';
import { MarkupParser } from '../src/markup/parser';
import { connectionEnd, parseAttributes } from '../src/markup/ast';
import { boundaryPoint, type RoundMobject } from '../src/markup/renderer';

const parse = (body: string, children = '') => new MarkupParser().parse(`::: slide {#r}\n${body}\n:::\n${children}`);
const CHILDREN = '::: slide {#a}\nA\n:::\n::: slide {#b}\nB\n:::\n::: slide {#c}\nC\n:::';

describe('includes as positioning references', () => {
  it('places an include, or an element, relative to another include', () => {
    expect(() => parse('[[include: #a x=-4 y=2 width=4]]\n\n[[include: #b below:#a width=4]]\n\n[[include: #c at=top-left:#b.bottom-right width=2]]', CHILDREN)).not.toThrow();
    expect(() => parse('[[include: #a width=4]]\n\n[caption]{#cap below:#a}', CHILDREN)).not.toThrow();
  });

  it('names a missing reference and a cycle, and takes an element first when an include shares its id', () => {
    expect(() => parse('[[include: #a below:#z]]', CHILDREN)).toThrow(/Unknown positioning reference #z/);
    expect(() => parse('[[include: #a below:#b]]\n\n[[include: #b below:#a]]', CHILDREN)).toThrow(/cycle/);
    // #a is the text, so the include of slide #a may be placed against it: no cycle.
    expect(() => parse('[A]{#a x=0 y=3}\n\n[[include: #a below:#a]]\n\n[[include: #b below:#a]]', CHILDREN)).not.toThrow();
    expect(() => parse('[[include: #a]]\n\n[t]{#t baseline-aligned:#a}', CHILDREN)).toThrow(/must reference text/);
  });

  it('keeps includes out of groups', () => {
    expect(() => parse('[[include: #a]]\n\n::: {.group #g}\n[t]{#t below:#a}\n:::', CHILDREN)).toThrow(/different group/);
  });
});

describe('braces', () => {
  it('span one target or several', () => {
    const shapes = '[[rectangle: #a x=-3 y=0 width=1 height=1]]\n\n[[rectangle: #b x=3 y=2 width=1 height=1]]\n\n';
    expect(() => parse(`${shapes}[[brace: #a #b, #br, side=bottom, label="both"]]`)).not.toThrow();
    expect(() => parse(`${shapes}[[brace: #a #z, #br]]`)).toThrow(/Unknown brace target #z/);
  });
});

describe('the ends of arrows and lines', () => {
  it('parse an element, an element at an anchor, or a point', () => {
    expect(connectionEnd('#a0', 1)).toEqual({ id: 'a0', anchor: null });
    expect(connectionEnd('#a0.top-right', 1)).toEqual({ id: 'a0', anchor: 'top-right' });
    expect(connectionEnd('#v1.2', 1)).toEqual({ id: 'v1.2', anchor: null });
    expect(connectionEnd('(1,-2)', 1)).toEqual([1, -2, 0]);
  });

  it('accept the anchors of the element they name', () => {
    const shapes = '[[rectangle: #a x=-3 y=0 width=1 height=1]]\n\n[[rectangle: #b x=3 y=2 width=1 height=1]]\n\n[t]{#t x=0 y=-3}\n\n';
    expect(() => parse(`${shapes}[[arrow: #a.top-right -> #b.top-left]]`)).not.toThrow();
    expect(() => parse(`${shapes}[[line: #t.left-baseline -> #b]]`)).not.toThrow();
    expect(() => parse(`${shapes}[[arrow: #a.left-baseline -> #b]]`)).toThrow(/Baseline anchors/);
    expect(() => parse(`${shapes}[[arrow: #a.origin -> #b]]`)).toThrow(/origin/);
    expect(() => parse(`${shapes}[[arrow: #z.top -> #b]]`)).toThrow(/Unknown arrow endpoint #z/);
  });

  it('meet a circle on its outline and anything else on its box', () => {
    const round = (circle: Circle) => Object.assign(circle, { markupRound: true }) as RoundMobject;
    const circle = round(new Circle({ radius: 1 }));
    const [x, y] = boundaryPoint(circle, [1, 1, 0]);
    expect(x).toBeCloseTo(Math.SQRT1_2, 2);
    expect(y).toBeCloseTo(Math.SQRT1_2, 2);
    const box = boundaryPoint(new Rectangle({ width: 2, height: 2 }), [1, 1, 0]);
    expect(box[0]).toBeCloseTo(1, 6);
    expect(box[1]).toBeCloseTo(1, 6);
  });
});

describe('quoted attribute values', () => {
  it('keep backslashes, so a label can break a line or hold a formula, and escape their own quote only', () => {
    expect(parseAttributes('label="a \\\\ b"', 1).label).toBe('a \\\\ b');
    expect(parseAttributes('label="**labeled** $\\to$"', 1).label).toBe('**labeled** $\\to$');
    expect(parseAttributes('label="a \\"quoted\\" word"', 1).label).toBe('a "quoted" word');
    expect(parseAttributes("label='it\\'s'", 1).label).toBe("it's");
    expect(parseAttributes("label='$\\frac{1}{2}$'", 1).label).toBe('$\\frac{1}{2}$');
    // Unquoted, a backslash still escapes the next character.
    expect(parseAttributes('label=a\\ b', 1).label).toBe('a b');
  });

  it('say how to make a styled span a block of its own', () => {
    expect(() => new MarkupParser().parse('::: slide {#s}\n[one]{#a x=1}\n[two]{#b x=2}\n:::')).toThrow(/put a blank line between it and the lines around it/);
  });
});
