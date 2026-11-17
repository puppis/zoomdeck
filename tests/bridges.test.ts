import { describe, expect, it } from 'vitest';
import { Line, Polygon, type Mobject } from 'manim-web';
import {
  BRIDGE_PATHS, FIXED_COLORS, MIN_CROSSING_SINE, bridgeQuad, findBridges, gridCells, mayBridge, withBridges, type BridgePath, type Point2,
} from '../src/bridges';
import { PropertyAnimation } from '../src/animations';
import { MarkupParser } from '../src/markup/parser';
import { LayoutConfig, MarkupRenderer } from '../src/markup/renderer';
import type { ElementSpec } from '../src/markup/ast';

/** A straight path from `a` to `b`, bridging in white with a halo `halo` wide when given. */
function path(a: Point2, b: Point2, halo?: number, joins: [string | null, string | null] = [null, null], width = 4): BridgePath {
  return { strokes: [[a, b]], width, ends: [a, b], shaftEnds: [a, b], joins, bridge: halo === undefined ? null : { color: '#FFFFFF', width: halo } };
}

const dot = (a: Point2, b: Point2) => a[0] * b[0] + a[1] * b[1];

describe('the shape of a halo bridge', () => {
  it('is the parallelogram where the halo of the upper path meets the lower stroke, counterclockwise', () => {
    const square = bridgeQuad([0, 0], [1, 0], [0, 1], 0.1, 0.03);
    expect(square.map(([x, y]) => [Math.abs(x), Math.abs(y)])).toEqual(Array(4).fill([0.03, 0.1]).map(([x, y]) => [expect.closeTo(x, 12), expect.closeTo(y, 12)]));
    const angle = Math.PI / 3;
    const v: Point2 = [Math.cos(angle), Math.sin(angle)];
    const quad = bridgeQuad([1, 2], [1, 0], v, 0.1, 0.03);
    for (const corner of quad) {
      const offset: Point2 = [corner[0] - 1, corner[1] - 2];
      expect(Math.abs(dot(offset, [0, 1]))).toBeCloseTo(0.1, 12);
      expect(Math.abs(dot(offset, [-v[1], v[0]]))).toBeCloseTo(0.03, 12);
    }
    let area = 0;
    for (let i = 0; i < 4; i++) area += quad[i][0] * quad[(i + 1) % 4][1] - quad[(i + 1) % 4][0] * quad[i][1];
    expect(area).toBeGreaterThan(0);
  });
});

describe('crossings that get a bridge', () => {
  const lower = path([0, -2], [0, 2]);
  const upper = path([-2, 0], [2, 0], 16);

  it('are proper crossings, bridged by the path drawn later when it asks for bridges', () => {
    const bridges = findBridges([lower, upper], 0.2);
    expect([...bridges.keys()]).toEqual([1]);
    const [quad] = bridges.get(1) as Point2[][];
    // The halo is 16 engine units wide: the lower stroke is hidden 0.08 (and the margin) on each side.
    expect(Math.max(...quad.map(([, y]) => y))).toBeCloseTo(0.09, 12);
    expect(Math.max(...quad.map(([x]) => x))).toBeCloseTo(0.03, 12);
    // A path drawn earlier, one that asks for none, and a halo no wider than the line get none.
    expect(findBridges([upper, lower], 0.2).size).toBe(0);
    expect(findBridges([lower, path([-2, 0], [2, 0])], 0.2).size).toBe(0);
    expect(findBridges([lower, path([-2, 0], [2, 0], 4)], 0.2).size).toBe(0);
  });

  it('never join paths that leave or reach the same element, or whose ends lie close', () => {
    expect(mayBridge(path([0, -2], [0, 2], undefined, ['a', 'b']), path([-2, 0], [2, 0], 16, ['b', 'c']), 0.2)).toBe(false);
    expect(findBridges([path([0, -2], [0, 2], undefined, ['a', null]), path([-2, 0], [2, 0], 16, [null, 'a'])], 0.2).size).toBe(0);
    expect(mayBridge(path([0, -2], [0, 2]), path([0.1, -2.1], [0, 3], 16), 0.2)).toBe(false);
    expect(mayBridge(path([0, -2], [0, 2]), path([0.1, -2.1], [0, 3], 16), 0.1)).toBe(true);
  });

  it('leave out narrow angles, touching ends and crossings too near an end', () => {
    // Against the vertical lower path, a path a little off the vertical, then a little less off.
    const across = (angle: number) => path([-2 * Math.sin(angle), -2 * Math.cos(angle)], [2 * Math.sin(angle), 2 * Math.cos(angle)], 16);
    expect(findBridges([lower, across(Math.asin(MIN_CROSSING_SINE) * 0.9)], 0.2).size).toBe(0);
    expect(findBridges([lower, across(Math.asin(MIN_CROSSING_SINE) * 1.2)], 0.2).size).toBe(1);
    // A T: the upper path ends on the lower one, or the lower one ends on the upper.
    expect(findBridges([lower, path([-2, 0], [0, 0], 16)], 0.2).size).toBe(0);
    expect(findBridges([path([0, 0], [0, 2]), upper], 0.2).size).toBe(0);
    // Ends a little past the crossing, closer than the gap would reach.
    expect(findBridges([path([0, -0.05], [0, 2]), upper], 0.2).size).toBe(0);
    expect(findBridges([path([0, -0.5], [0, 2]), upper], 0.2).size).toBe(1);
    // An arrow crossing just before its tip passes over: its point is its end, not where the tip begins.
    const arrow: BridgePath = { ...path([-2, 0], [0.2, 0], 16), ends: [[-2, 0], [0.5, 0]] };
    expect(findBridges([lower, arrow], 0.2).size).toBe(1);
    // A crossing just before the tip of the lower arrow would notch the tip: no bridge.
    const under: BridgePath = { ...path([0, -2], [0, 0.05]), ends: [[0, -2], [0, 0.35]] };
    expect(findBridges([under, upper], 0.2).size).toBe(0);
  });

  it('are found through the grid as a test of every pair would find them', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 8 - 4;
    const paths = Array.from({ length: 40 }, (_, index) => path([random(), random()], [random(), random()], index % 3 ? 14 : undefined));
    const count = (found: Map<number, Point2[][]>) => [...found.values()].reduce((sum, quads) => sum + quads.length, 0);
    let pairwise = 0;
    for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) pairwise += count(findBridges([paths[i], paths[j]], 0.2));
    expect(pairwise).toBeGreaterThan(20);
    expect(count(findBridges(paths, 0.2))).toBe(pairwise);
  });

  it('are found in the cells a segment passes through, both cells beside a corner included', () => {
    const cells: string[] = [];
    gridCells([0.5, 0.5], [2.5, 2.5], 1, (x, y) => cells.push(`${x},${y}`));
    expect(cells).toEqual(['0,0', '1,0', '0,1', '1,1', '2,1', '1,2', '2,2']);
    const row: string[] = [];
    gridCells([-1.5, 0.2], [1.5, 0.4], 1, (x, y) => row.push(`${x},${y}`));
    expect(row).toEqual(['-2,0', '-1,0', '0,0', '1,0']);
  });
});

describe('arrows and lines with halo bridges', () => {
  const renderer = new MarkupRenderer({ basePath: 'x', background: '#0F172A' });
  const draw = (kind: 'arrow' | 'line', attributes: Record<string, string>) =>
    renderer.connection({ kind, attributes: { from: '(0,0)', to: '(4,0)', ...attributes }, line: 1 } as unknown as ElementSpec, new Map());

  it('record their stroke, an arrow\'s up to its tip, and their bridges in the deck background or a color', async () => {
    const arrow = BRIDGE_PATHS.get(await draw('arrow', { halo_bridge: 'true' })) as BridgePath;
    expect(arrow.bridge).toEqual({ color: '#0F172A', width: 16 });
    expect(arrow.strokes).toHaveLength(1);
    expect(arrow.shaftEnds[1][0]).toBeCloseTo(4 - 0.08 - 0.3, 9);
    expect(arrow.ends[1][0]).toBeCloseTo(4 - 0.08, 9);
    const line = BRIDGE_PATHS.get(await draw('line', { halo_bridge: 'YELLOW', halo_width: '30' })) as BridgePath;
    expect(line.bridge?.width).toBe(30);
    expect(line.ends[1][0]).toBe(4);
    expect(BRIDGE_PATHS.get(await draw('line', { halo_bridge: 'false' }))?.bridge).toBeNull();
    expect(BRIDGE_PATHS.get(await draw('line', {}))?.bridge).toBeNull();
    expect(new MarkupRenderer({ basePath: 'x' }).background).toBe('#FFFFFF');
  });

  it('follow the strokes a hand-drawn line draws', async () => {
    const sketched = BRIDGE_PATHS.get(await draw('arrow', { sketch: 'true', seed: '3' })) as BridgePath;
    expect(sketched.strokes.length).toBeGreaterThanOrEqual(1);
    expect(sketched.strokes[0].length).toBeGreaterThan(2);
    // The strokes stay near the line and stop short of the tip.
    for (const stroke of sketched.strokes) for (const [x, y] of stroke) {
      expect(Math.abs(y)).toBeLessThan(0.15);
      expect(x).toBeLessThan(4 - 0.08 - 0.3 * 0.8 + 0.1);
    }
  });

  it('draw their bridges under them, in a color no animation changes', () => {
    const line = new Line({ start: [-2, 0, 0], end: [2, 0, 0], color: '#000000' });
    const group = withBridges(line, [bridgeQuad([0, 0], [1, 0], [0, 1], 0.1, 0.03)], '#0F172A');
    const [patch, last] = group.children as Mobject[];
    expect(patch).toBeInstanceOf(Polygon);
    expect(last).toBe(line);
    expect(patch.color.toUpperCase()).toBe('#0F172A');
    expect(FIXED_COLORS.has(patch)).toBe(true);
    const animation = new PropertyAnimation(group, { color: '#FF0000' }, { duration: 1 });
    animation.begin();
    animation.interpolate(1);
    expect(line.color.toUpperCase()).toBe('#FF0000');
    expect(patch.color.toUpperCase()).toBe('#0F172A');
  });

  it('are named on arrows and lines, as true, false or a color, with a tolerance in the layout', () => {
    const parse = (body: string) => new MarkupParser().parse(`::: slide {#s}\n[[rectangle: #a x=-3 y=0 width=1 height=1]]\n\n[[rectangle: #b x=3 y=2 width=1 height=1]]\n\n${body}\n:::`);
    expect(() => parse('[[arrow: #a -> #b, #e, halo_bridge=true, halo_width=20]]')).not.toThrow();
    expect(() => parse('[[line: #a -> #b, #e, halo_bridge=WHITE]]')).not.toThrow();
    expect(() => parse('[[line: #a -> #b, #e, halo_bridge=nocolor]]')).toThrow(/Invalid color/);
    expect(() => parse('[[line: #a -> #b, #e, halo_width=20]]')).toThrow(/halo_width requires halo_bridge/);
    expect(() => parse('[[line: #a -> #b, #e, halo_bridge=true, halo_width=-1]]')).toThrow(/halo_width must be nonnegative/);
    expect(() => parse('[[line: #a -> #b, #e, halo=true]]')).toThrow(/halo/);
    expect(new LayoutConfig().haloBridgeTolerance).toBe(0.2);
    expect(() => new LayoutConfig({ haloBridgeTolerance: -1 })).toThrow(/haloBridgeTolerance/);
  });
});
