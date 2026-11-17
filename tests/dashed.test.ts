import { describe, expect, it } from 'vitest';
import { Line, Polygon, VMobject, type Mobject } from 'manim-web';
import { dashPattern, dashSegments, sketch } from '../src/sketch';
import { MarkupParser } from '../src/markup/parser';
import { MarkupRenderer } from '../src/markup/renderer';
import type { ElementSpec } from '../src/markup/ast';

const round = (point: readonly number[]) => point.slice(0, 2).map((v) => Math.round(v * 1000) / 1000);

/** A connection between fixed points, as the renderer draws it. */
function connection(kind: 'arrow' | 'line', attributes: Record<string, string>): Promise<Mobject> {
  const element = { kind, attributes: { from: '(0,0)', to: '(4,0)', ...attributes }, line: 1 } as unknown as ElementSpec;
  return new MarkupRenderer({ basePath: 'x' }).connection(element, new Map());
}

describe('dashed arrows and lines', () => {
  it('splits a segment into dashes that begin and end it, at least two', () => {
    const dashes = dashSegments([0, 0], [3, 4], 0.4, 0.2);
    expect(dashes.length).toBe(Math.round((5 + 0.2) / 0.6));
    expect(round(dashes[0][0])).toEqual([0, 0]);
    expect(round(dashes[dashes.length - 1][1])).toEqual([3, 4]);
    // Every dash is as long, and so is every gap.
    const length = (a: readonly number[], b: readonly number[]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dash = length(dashes[0][0], dashes[0][1]);
    const gap = length(dashes[0][1], dashes[1][0]);
    for (let i = 0; i < dashes.length; i += 1) {
      expect(length(dashes[i][0], dashes[i][1])).toBeCloseTo(dash, 9);
      if (i > 0) expect(length(dashes[i - 1][1], dashes[i][0])).toBeCloseTo(gap, 9);
    }
    expect(dash / gap).toBeCloseTo(2, 9);
    expect(dashSegments([0, 0], [0.1, 0], 0.4, 0.2)).toHaveLength(2);
    expect(dashSegments([1, 1], [1, 1], 0.4, 0.2)).toHaveLength(0);
  });

  it('makes the dashes of a thicker line longer', () => {
    const [thin, thinGap] = dashPattern(2);
    const [thick, thickGap] = dashPattern(8);
    expect(thick).toBeGreaterThan(thin);
    expect(thickGap).toBeGreaterThan(thinGap);
  });

  it('draws a plain dashed line as its dashes, and a dashed arrow with the solid tip of an arrow', async () => {
    const line = await connection('line', { dashed: 'true' });
    expect(line.children.length).toBeGreaterThan(2);
    expect(line.children.every((child) => child instanceof Line)).toBe(true);
    expect(line.getWidth()).toBeCloseTo(4, 6);
    const arrow = await connection('arrow', { dashed: 'true' });
    const tip = arrow.children[arrow.children.length - 1] as VMobject;
    expect(tip).toBeInstanceOf(Polygon);
    expect(tip.fillOpacity).toBe(1);
    // The arrow is trimmed at both ends like a solid one, and its shaft reaches the base of the tip.
    const solid = await connection('arrow', {});
    expect(arrow.getWidth()).toBeCloseTo(solid.getWidth(), 6);
    const shaft = arrow.children.slice(0, -1) as Line[];
    expect(shaft.every((child) => child instanceof Line)).toBe(true);
    expect(Math.max(...shaft.flatMap((dash) => dash.getPoints().map((p) => p[0])))).toBeCloseTo(tip.getLeft()[0], 6);
    expect((await connection('line', { dashed: 'false' })).children).toHaveLength(0);
  });

  it('draws hand-drawn dashes as one outline of separate strokes', () => {
    const subpaths = (dash?: readonly [number, number]) => (sketch.line([0, 0], [4, 0], { seed: 3, ...(dash ? { dash } : {}) }).children[0] as VMobject).getSubpathLengths()?.length ?? 1;
    const dashes = dashSegments([0, 0], [4, 0], 0.3, 0.2).length;
    // Rough.js draws each stroke twice.
    expect(subpaths([0.3, 0.2])).toBe(2 * dashes);
    expect(subpaths()).toBe(2);
    const arrow = sketch.arrow([0, 0], [4, 0], { seed: 3, dash: [0.3, 0.2] });
    expect(arrow.children.length).toBeGreaterThanOrEqual(2);
    expect(arrow.getWidth()).toBeCloseTo(4, 0);
  });

  it('accepts dashed=true or false on arrows and lines only', () => {
    const parse = (body: string) => new MarkupParser().parse(`::: slide {#s}\n[[rectangle: #a x=-3 y=0 width=1 height=1]]\n\n[[rectangle: #b x=3 y=2 width=1 height=1]]\n\n${body}\n:::`);
    expect(() => parse('[[arrow: #a -> #b, #e, dashed=true]]')).not.toThrow();
    expect(() => parse('[[line: #a -> #b, #e, dashed=false, sketch=true]]')).not.toThrow();
    expect(() => parse('[[arrow: #a -> #b, #e, dashed=yes]]')).toThrow(/dashed must be true or false/);
    expect(() => parse('[[circle: #c radius=1 dashed=true]]')).toThrow(/dashed/);
  });
});

describe('halos', () => {
  const element = (attributes: Record<string, string>) => ({ kind: 'line', attributes, line: 1 }) as unknown as ElementSpec;
  const renderer = new MarkupRenderer({ basePath: 'x', background: '#0F172A' });

  it('draw a wider stroke under the shaft, in the deck background or a color of their own', () => {
    const halo = renderer.halo(element({ halo: 'true' }), [0, 0, 0], [4, 0, 0], 4, 0) as Line;
    expect(halo).toBeInstanceOf(Line);
    expect(halo.color.toUpperCase()).toBe('#0F172A');
    // The line's width plus 12, stopping half its width short of each end.
    expect(halo.strokeWidth).toBe(16);
    expect(halo.getStart()[0]).toBeCloseTo(0.08, 9);
    expect(halo.getEnd()[0]).toBeCloseTo(4 - 0.08, 9);
    const yellow = renderer.halo(element({ halo: 'YELLOW', halo_width: '30' }), [0, 0, 0], [4, 0, 0], 2, 0.3) as Line;
    expect(yellow.strokeWidth).toBe(30);
    // An arrow's halo ends where its tip begins.
    expect(yellow.getEnd()[0]).toBeCloseTo(4 - 0.3, 9);
    expect(renderer.halo(element({}), [0, 0, 0], [4, 0, 0], 4, 0)).toBeNull();
    expect(renderer.halo(element({ halo: 'false' }), [0, 0, 0], [4, 0, 0], 4, 0)).toBeNull();
    // Too short a path, or a halo no wider than the line, has none.
    expect(renderer.halo(element({ halo: 'true' }), [0, 0, 0], [0.1, 0, 0], 4, 0)).toBeNull();
    expect(renderer.halo(element({ halo: 'true', halo_width: '4' }), [0, 0, 0], [4, 0, 0], 4, 0)).toBeNull();
    expect(new MarkupRenderer({ basePath: 'x' }).background).toBe('#FFFFFF');
  });

  it('are named on arrows and lines, as true, false or a color', () => {
    const parse = (body: string) => new MarkupParser().parse(`::: slide {#s}\n[[rectangle: #a x=-3 y=0 width=1 height=1]]\n\n[[rectangle: #b x=3 y=2 width=1 height=1]]\n\n${body}\n:::`);
    expect(() => parse('[[arrow: #a -> #b, #e, halo=true, halo_width=20]]')).not.toThrow();
    expect(() => parse('[[line: #a -> #b, #e, halo=WHITE]]')).not.toThrow();
    expect(() => parse('[[line: #a -> #b, #e, halo=nocolor]]')).toThrow(/Invalid color/);
    expect(() => parse('[[line: #a -> #b, #e, halo_width=20]]')).toThrow(/halo_width requires halo/);
    expect(() => parse('[[line: #a -> #b, #e, halo=true, halo_width=-1]]')).toThrow(/halo_width must be nonnegative/);
  });
});
