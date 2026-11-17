import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Line, Rectangle, VGroup } from 'manim-web';
import { Display, LocalScene, inSourceOrder, setSourceRank, sourceRank } from '../src/display';
import { Transform } from '../src/geometry';
import { blobOutline } from '../src/blob';
import { arrowTip } from '../src/markup/renderer';

/** The draw order and transparency of every material under a Three.js object. */
function materials(object: THREE.Object3D): Array<{ order: number; transparent: boolean }> {
  const result: Array<{ order: number; transparent: boolean }> = [];
  object.traverse((node) => {
    const material = (node as THREE.Mesh).material;
    for (const m of material ? (Array.isArray(material) ? material : [material]) : []) result.push({ order: node.renderOrder, transparent: m.transparent });
  });
  return result;
}

describe('the order things are drawn in', () => {
  it('follows the source, whichever click reveals each element; unranked members come last', () => {
    const [a, b, c, flash] = [0, 1, 2, 3].map(() => new Rectangle({ width: 1, height: 1 }));
    setSourceRank(a, 0);
    setSourceRank(b, 1);
    setSourceRank(c, 2);
    expect(sourceRank(b)).toBe(1);
    // b entered last, at a later click, and an effect's flash after a.
    expect(inSourceOrder([a, flash, c, b])).toEqual([a, b, c, flash]);
    const unranked = [flash, new Rectangle({ width: 1, height: 1 })];
    expect(inSourceOrder(unranked)).toBe(unranked);
  });

  it('draws every shape of a member after the shapes before it, all in one pass', () => {
    // An SVG-like member: a filled rectangle, then a line that crosses it.
    const fill = new Rectangle({ width: 4, height: 2 });
    fill.setFill('#BAE6FF', 1);
    fill.setStyle({ strokeWidth: 0 });
    const line = new Line({ start: [-2, -1, 0], end: [2, 1, 0], color: '#000000' });
    const picture = new VGroup(fill, line);
    const local = new LocalScene();
    local.add(picture);
    const display = new Display(local, { contentOpacity: 1, gridOpacity: 0 });
    display.sync(new Transform());
    let order = 0;
    display.prepareRender(800, 600, 16, () => order++);
    const below = materials(fill.getThreeObject());
    const above = materials(line.getThreeObject());
    expect(below.length).toBeGreaterThan(0);
    expect(above.length).toBeGreaterThan(0);
    expect(Math.max(...below.map((m) => m.order))).toBeLessThan(Math.min(...above.map((m) => m.order)));
    // Opaque materials would be drawn before every transparent one, whatever their order.
    expect([...below, ...above].every((m) => m.transparent)).toBe(true);
  });
});

describe('blobs', () => {
  const distance = (loop: number[][], x: number, y: number) => loop.map(([px, py]) => Math.hypot(px - x, py - y));

  it('are round around a dot', () => {
    const [loop] = blobOutline([{ x: 0, y: 0, width: 0.76, height: 0.76, round: true }], { buff: 0.3 });
    for (const d of distance(loop, 0, 0)) expect(d).toBeCloseTo(0.68, 1);
  });

  it('follow an edge between two members, and fill a cycle of edges', () => {
    const dot = (x: number, y: number) => ({ x, y, width: 0.6, height: 0.6, round: true });
    const disc = (x: number, y: number): [number, number, number] => [x, y, 0.3];
    // Far apart, two dots are two loops; joined by an edge, one capsule.
    expect(blobOutline([dot(-3, 0), dot(3, 0)], { buff: 0.3 })).toHaveLength(2);
    const capsule = blobOutline([dot(-3, 0), dot(3, 0)], { buff: 0.3 }, [{ from: disc(-3, 0), to: disc(3, 0) }]);
    expect(capsule).toHaveLength(1);
    // The capsule keeps its width along the edge.
    const middle = capsule[0].filter(([x]) => Math.abs(x) < 0.2).map(([, y]) => Math.abs(y));
    for (const y of middle) expect(y).toBeCloseTo(0.6, 1);
    // A triangle of edges is one outline, without the hole in its middle.
    const corners: Array<[number, number]> = [[-3, -2], [3, -2], [0, 3]];
    const bridges = corners.map((p, i) => ({ from: disc(...p), to: disc(...corners[(i + 1) % 3]) }));
    expect(blobOutline(corners.map(([x, y]) => dot(x, y)), { buff: 0.3 }, bridges)).toHaveLength(1);
  });
});

describe('arrow tips', () => {
  it('are 0.3 long at the default width, shrink on thin arrows and keep to a quarter of a short one', () => {
    expect(arrowTip(4, 3)[0]).toBeCloseTo(0.3, 9);
    expect(arrowTip(4, 3)[1]).toBeCloseTo(0.1, 9);
    expect(arrowTip(1, 3)[0]).toBeCloseTo(0.15, 6);
    expect(arrowTip(4, 0.4)[0]).toBeCloseTo(0.1, 6);
    const [length, width] = arrowTip(2, 0.5);
    expect(width).toBeCloseTo(length / 3, 9);
  });
});
