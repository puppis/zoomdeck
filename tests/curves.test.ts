import { describe, expect, it } from 'vitest';
import { Circle, Polygon, VMobject, type Mobject } from 'manim-web';
import { Spline, dashPieces, isViaList, lineCubic, throughPoints, viaPoints, waveCubics, type Vec } from '../src/curves';
import { BRIDGE_PATHS, type BridgePath } from '../src/bridges';
import { sketch } from '../src/sketch';
import { MarkupParser } from '../src/markup/parser';
import { MarkupRenderer, tipSize, type RoundMobject } from '../src/markup/renderer';
import type { ElementSpec } from '../src/markup/ast';

const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const renderer = new MarkupRenderer({ basePath: 'x' });

/** A connection as the renderer draws it, between fixed points or the circles named. */
function connection(kind: 'arrow' | 'line', attributes: Record<string, string>, objects = new Map<string, Mobject>()): Promise<Mobject> {
  const element = { kind, attributes: { from: '(0,0)', to: '(4,0)', ...attributes }, line: 1 } as unknown as ElementSpec;
  return renderer.connection(element, objects);
}

function circle(x: number, y: number, radius = 0.25): Mobject {
  const c = new Circle({ radius });
  c.moveTo([x, y, 0]);
  (c as RoundMobject).markupRound = true;
  return c;
}

describe('paths of curves', () => {
  it('are measured by their length, and give points, directions and parts along it', () => {
    const line = new Spline([lineCubic([0, 0], [3, 4])]);
    expect(line.length).toBeCloseTo(5, 9);
    expect(distance(line.pointAt(2.5), [1.5, 2])).toBeLessThan(1e-9);
    expect(distance(line.directionAt(1), [0.6, 0.8])).toBeLessThan(1e-9);
    const part = line.part(1, 2);
    expect(part.length).toBeCloseTo(1, 9);
    expect(distance(part.start, [0.6, 0.8])).toBeLessThan(1e-9);
    // How far back from the end a chord of 1 reaches.
    expect(line.backFromEnd(1)).toBeCloseTo(4, 6);
    // Where it leaves a disc around its start.
    expect(line.exit((p) => Math.hypot(p[0], p[1]) < 2)).toBeCloseTo(2, 6);
    expect(line.entry((p) => Math.hypot(p[0] - 3, p[1] - 4) < 1)).toBeCloseTo(4, 6);
  });

  it('pass smoothly through given points, and cut into dashes that begin and end them', () => {
    const points: Vec[] = [[0, 0], [1, 1], [2, 0], [3, 1]];
    const path = new Spline(throughPoints(points));
    expect(path.cubics).toHaveLength(3);
    path.cubics.forEach((c, i) => {
      expect(distance(c[0], points[i])).toBeLessThan(1e-12);
      expect(distance(c[3], points[i + 1])).toBeLessThan(1e-12);
    });
    // The direction at each inner point is shared by the curves on either side.
    for (let i = 1; i < path.cubics.length; i++) {
      const [a, b] = [path.cubics[i - 1], path.cubics[i]];
      const before = [a[3][0] - a[2][0], a[3][1] - a[2][1]];
      const after = [b[1][0] - b[0][0], b[1][1] - b[0][1]];
      expect(Math.abs(before[0] * after[1] - before[1] * after[0])).toBeLessThan(1e-9);
    }
    const dashes = dashPieces(path, path.length, 0.2, 0.1);
    expect(distance(dashes[0][0][0], [0, 0])).toBeLessThan(1e-9);
    const last = dashes[dashes.length - 1];
    expect(distance(last[last.length - 1][3], [3, 1])).toBeLessThan(1e-6);
  });

  it('wave regularly, leaving and arriving along the line', () => {
    const wave = new Spline(waveCubics([0, 0], [4, 0], 2.5, 0.3));
    expect(distance(wave.start, [0, 0])).toBeLessThan(1e-12);
    expect(distance(wave.end, [4, 0])).toBeLessThan(1e-12);
    expect(distance(wave.directionAt(0), [1, 0])).toBeLessThan(1e-6);
    expect(distance(wave.directionAt(wave.length), [1, 0])).toBeLessThan(1e-6);
    const ys = wave.polyline().map(([, y]) => y);
    expect(Math.max(...ys)).toBeCloseTo(0.3, 2);
    expect(Math.min(...ys)).toBeCloseTo(-0.3, 2);
    // The first crest is to the left of the way, up here.
    expect(wave.pointAt(wave.length * 0.1)[1]).toBeGreaterThan(0);
  });

  it('read via points from the slide, from the start, or from the point before', () => {
    expect(viaPoints('+(1,2) ++(1,0) (5,5) +(0, -1)', [1, 1])).toEqual([[2, 3], [3, 3], [5, 5], [1, 0]]);
    expect(isViaList('+(0.4,-0.3) +(0.1,-0.9) +(0.8,-1.1)')).toBe(true);
    for (const bad of ['', 'x', '(a,b)', '+(1,2) junk', '(1)']) expect(isViaList(bad)).toBe(false);
  });
});

describe('arrow tips', () => {
  it('are sized for a stroke, at most a quarter of the arrow, unless the author gives a size', () => {
    const [length, half] = tipSize('triangle', 4, 10);
    expect(length).toBeCloseTo(0.3, 9);
    expect(half).toBeCloseTo(0.1, 9);
    const [open, spread] = tipSize('open', 4, 10);
    expect(open).toBeCloseTo(0.2, 9);
    expect(spread).toBeCloseTo(0.14, 9);
    expect(tipSize('open', 7, 0.45)[0]).toBeCloseTo(0.45 / 4, 9);
    expect(tipSize('open', 7, 0.45, 0.17, 0.15)).toEqual([0.17, 0.15]);
    expect(tipSize('triangle', 4, 0.45, 0.3)[0]).toBe(0.3);
    expect(tipSize('triangle', 4, 0.45, 0.3)[1]).toBeCloseTo(0.1, 9);
    expect(tipSize('open', 4, 1, undefined, 0.14)[0]).toBeCloseTo(0.2, 9);
  });

  it('may be open: two strokes meeting at the end, which the stroke reaches', async () => {
    const arrow = await connection('arrow', { tip: 'open' });
    const [stroke, tip] = arrow.children as VMobject[];
    expect(arrow.children).toHaveLength(2);
    expect(stroke.fillOpacity).toBe(0);
    const end = 4 - 0.08;
    const points = stroke.getPoints();
    expect(points[points.length - 1][0]).toBeCloseTo(end, 9);
    // The tip's sides: 0.2 back from the point, 0.14 to each side.
    const corners = tip.getPoints();
    expect(distance(corners[0], [end - 0.2, 0.14])).toBeLessThan(1e-9);
    expect(corners.some((p) => distance(p, [end, 0]) < 1e-9)).toBe(true);
    expect(distance(corners[corners.length - 1], [end - 0.2, -0.14])).toBeLessThan(1e-9);
    // Bridges follow the shaft only, up to where the tip begins.
    const path = BRIDGE_PATHS.get(arrow) as BridgePath;
    expect(path.shaftEnds[1][0]).toBeCloseTo(end - 0.2, 6);
    expect(path.ends[1][0]).toBeCloseTo(end, 9);
  });

  it('may be none, and keep the size an author gives on a short bold arrow', async () => {
    const bare = await connection('arrow', { tip: 'none' });
    expect(bare.children).toHaveLength(1);
    const hop = await connection('arrow', { to: '(0.45,0)', stroke_width: '7', tip: 'open', tip_length: '0.17', tip_width: '0.15' });
    const corners = (hop.children[1] as VMobject).getPoints();
    expect(distance(corners[0], [0.45 - 0.08 - 0.17, 0.15])).toBeLessThan(1e-9);
    // A filled tip of a given length is not capped either.
    const filled = BRIDGE_PATHS.get(await connection('arrow', { to: '(0.45,0)', tip_length: '0.2' })) as BridgePath;
    expect(filled.shaftEnds[1][0]).toBeCloseTo(0.45 - 0.08 - 0.2, 9);
  });

  it('stay solid on a dashed arrow, and are sketched by hand on a hand-drawn one', async () => {
    const dashed = await connection('arrow', { tip: 'open', dashed: 'true' });
    const [stroke, tip] = dashed.children as VMobject[];
    expect((stroke.getSubpathLengths() ?? []).length).toBeGreaterThan(2);
    expect(tip.getSubpathLengths()?.length ?? 1).toBe(1);
    const drawn = sketch.curve([[[0, 0], [1, 0], [2, 0], [3, 0]]], { seed: 3 }, { open: true, corners: [[2.8, 0.1], [3, 0], [2.8, -0.1]] });
    expect((drawn as { markupShaft?: VMobject[] }).markupShaft?.length).toBeGreaterThan(0);
    expect(drawn.children.length).toBeGreaterThan((drawn as { markupShaft?: VMobject[] }).markupShaft?.length as number);
    const filled = sketch.curve([[[0, 0], [1, 0], [2, 0], [3, 0]]], { seed: 3 }, { open: false, corners: [[3, 0], [2.7, 0.1], [2.7, -0.1]] });
    expect(filled.children.some((child) => (child as VMobject).fillOpacity === 1)).toBe(true);
    const plain = await connection('arrow', { tip: 'open', sketch: 'true', seed: '2' });
    expect((BRIDGE_PATHS.get(plain) as BridgePath).strokes.length).toBeGreaterThan(0);
  });
});

describe('curved arrows and lines', () => {
  const objects = new Map<string, Mobject>([['a', circle(0, 0)], ['b', circle(3, 0)]]);
  const ends = (obj: Mobject) => (BRIDGE_PATHS.get(obj) as BridgePath).ends;

  it('bend: leave and arrive at that angle to the line between the elements, on their outlines', async () => {
    const arrow = await connection('arrow', { from: '#a', to: '#b', bend: '30' }, objects);
    const [start, end] = ends(arrow);
    // On the outline, past the gap an arrow leaves, at about 30 degrees to the left of the way.
    expect(Math.hypot(start[0], start[1])).toBeCloseTo(0.25 + 0.08, 1);
    expect((Math.atan2(start[1], start[0]) * 180) / Math.PI).toBeGreaterThan(25);
    expect((Math.atan2(start[1], start[0]) * 180) / Math.PI).toBeLessThan(35);
    expect(end[1]).toBeGreaterThan(0);
    const right = await connection('arrow', { from: '#a', to: '#b', bend: '-30' }, objects);
    expect(ends(right)[0][1]).toBeLessThan(0);
    // The arc rises between them, and a tighter looseness keeps it lower.
    const top = (obj: Mobject) => Math.max(...(BRIDGE_PATHS.get(obj) as BridgePath).strokes.flat().map(([, y]) => y));
    expect(top(arrow)).toBeGreaterThan(0.3);
    expect(top(await connection('arrow', { from: '#a', to: '#b', bend: '30', looseness: '0.5' }, objects))).toBeLessThan(top(arrow));
  });

  it('loop: leave an element and come back to it on the side named', async () => {
    const loop = await connection('arrow', { from: '#a', to: '#a', loop: 'above' }, objects);
    const [start, end] = ends(loop);
    expect(Math.hypot(start[0], start[1])).toBeGreaterThan(0.25);
    expect(start[0]).toBeLessThan(0);
    expect(end[0]).toBeGreaterThan(0);
    const ys = (BRIDGE_PATHS.get(loop) as BridgePath).strokes.flat().map(([, y]) => y);
    expect(Math.max(...ys)).toBeGreaterThan(0.6);
    const right = await connection('line', { from: '#a', to: '#a', loop: 'right' }, objects);
    expect(Math.min(...(BRIDGE_PATHS.get(right) as BridgePath).strokes.flat().map(([x]) => x))).toBeGreaterThan(0);
    await expect(connection('arrow', { from: '#a', to: '#b', loop: 'above' }, objects)).rejects.toThrow(/same element at both ends/);
  });

  it('wavy: wave between the outlines, and via: pass through points given from the start', async () => {
    const wave = await connection('arrow', { from: '#a', to: '#b', wavy: '2', amplitude: '0.2' }, objects);
    const [start, end] = ends(wave);
    expect(start[1]).toBeCloseTo(0, 9);
    expect(end[1]).toBeCloseTo(0, 9);
    expect(Math.max(...(BRIDGE_PATHS.get(wave) as BridgePath).strokes.flat().map(([, y]) => y))).toBeGreaterThan(0.15);
    const via = await connection('line', { from: '#a', to: '#b', via: '+(1,1) +(2,-1)' }, objects);
    const stroke = (BRIDGE_PATHS.get(via) as BridgePath).strokes[0];
    for (const point of [[1, 1], [2, -1]]) expect(Math.min(...stroke.map((p) => distance(p, point)))).toBeLessThan(0.01);
    // It starts where it leaves the first circle and ends where it enters the second.
    expect(Math.hypot(stroke[0][0], stroke[0][1])).toBeCloseTo(0.25, 6);
    expect(distance(stroke[stroke.length - 1], [3, 0])).toBeCloseTo(0.25, 6);
  });

  it('carry a way to move along them, and their tip on their last stretch', async () => {
    const arrow = await connection('arrow', { from: '#a', to: '#b', bend: '40' }, objects);
    const outline = (arrow as { markupOutline?: VMobject }).markupOutline as VMobject;
    expect(outline).toBeInstanceOf(VMobject);
    expect(distance(outline.getPoints()[0], ends(arrow)[0])).toBeLessThan(1e-9);
    const triangle = arrow.children.find((child) => child instanceof Polygon) as Polygon;
    // The triangle's point is the end; its base lies on the curve, which arrives from above.
    const corners = triangle.getVertices();
    expect(distance(corners[0], ends(arrow)[1])).toBeLessThan(1e-9);
    expect((corners[1][1] + corners[2][1]) / 2).toBeGreaterThan(ends(arrow)[1][1]);
  });

  it('are named on arrows and lines, one way at a time, with tips on arrows only', () => {
    const parse = (body: string) => new MarkupParser().parse(`::: slide {#s}\n[[circle: #a x=-2 y=0 radius=0.3]]\n\n[[circle: #b x=2 y=0 radius=0.3]]\n\n${body}\n:::`);
    for (const ok of [
      '[[arrow: #a -> #b, tip=open, tip_length=0.2, tip_width=0.1]]', '[[arrow: #a -> #b, bend=20, looseness=1.5]]', '[[arrow: #a -> #a, loop=above]]',
      '[[line: #a -> #a, loop=45]]', '[[arrow: #a -> #b, wavy=2.5, amplitude=0.3, dashed=true]]', '[[arrow: #a -> #b, via="+(0.4,-0.3) ++(0.1,-0.9) (1,1)"]]',
    ]) expect(() => parse(ok)).not.toThrow();
    expect(() => parse('[[line: #a -> #b, tip=open]]')).toThrow(/tip applies to arrows only/);
    expect(() => parse('[[arrow: #a -> #b, tip=arrowhead]]')).toThrow(/tip must be triangle, open or none/);
    expect(() => parse('[[arrow: #a -> #b, tip_length=0]]')).toThrow(/tip_length must be positive/);
    expect(() => parse('[[arrow: #a -> #b, bend=20, wavy=2]]')).toThrow(/bend and wavy cannot be combined/);
    expect(() => parse('[[arrow: #a -> #b, loop=above]]')).toThrow(/same element at both ends/);
    expect(() => parse('[[arrow: #a -> #a, loop=sideways]]')).toThrow(/loop must be above/);
    expect(() => parse('[[arrow: #a -> #b, via="(1,x)"]]')).toThrow(/via must list points/);
    expect(() => parse('[[arrow: #a -> #b, looseness=2]]')).toThrow(/looseness requires bend or loop/);
    expect(() => parse('[[arrow: #a -> #b, amplitude=2]]')).toThrow(/amplitude requires wavy/);
    expect(() => parse('[[arrow: #a -> #b, wavy=0]]')).toThrow(/wavy must be positive/);
    // A style may give every arrow an open tip.
    expect(() => new MarkupParser().parse('::: styles\narrow: tip=open\n:::\n\n::: slide {#s}\n[[circle: #a x=-2 y=0 radius=0.3]]\n\n[[circle: #b x=2 y=0 radius=0.3]]\n\n[[arrow: #a -> #b]]\n:::')).not.toThrow();
  });
});
