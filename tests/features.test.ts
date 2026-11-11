import { describe, expect, it } from 'vitest';
import { Rectangle, VGroup, VMobject } from 'manim-web';
import { ICON_NAMES, iconParts, makeIcon } from '../src/icons';
import { blobField, blobMobject, blobOutline } from '../src/blob';
import { Tremble } from '../src/animations';
import { MarkupParser } from '../src/markup/parser';
import { ElementSpec, attachmentTargets, parseTremble, styleRoles } from '../src/markup/ast';
import type { OutlineMobject } from '../src/sketch';

const parse = (body: string, styles = '') => new MarkupParser().parse(`${styles}\n::: slide {#s}\n${body}\n:::\n`);
const element = (body: string, id: string, styles = '') => parse(body, styles).slides[0].items.find((item) => item instanceof ElementSpec && item.id === id) as ElementSpec;

describe('icons', () => {
  it('builds every icon from its parts, sized by its box height', () => {
    for (const name of ICON_NAMES) {
      const icon = makeIcon(name, { size: 2 });
      expect(icon.children).toHaveLength(iconParts(name).length);
      expect(icon.getWidth()).toBeGreaterThan(0.6);
      expect(icon.getHeight()).toBeGreaterThan(1);
      expect(icon.getHeight()).toBeLessThanOrEqual(2.05);
    }
    expect(() => makeIcon('rocket' as never)).toThrow(/Unknown icon/);
    expect(() => makeIcon('user', { size: 0 })).toThrow(/size/);
  });

  it('fills only the silhouette parts and keeps the outline color', () => {
    const icon = makeIcon('document', { color: '#112233', fillColor: '#AABBCC', fillOpacity: 0.4 });
    const parts = iconParts('document');
    icon.children.forEach((child, index) => {
      const vmob = child as VMobject;
      expect(String(vmob.strokeColor).toUpperCase()).toBe('#112233');
      expect(vmob.fillOpacity).toBeCloseTo(parts[index].fill ? 0.4 : 0);
    });
  });

  it('draws by hand on request, remembering the crisp geometry', () => {
    const rough = makeIcon('server', { size: 1.5, fillOpacity: 0.3, sketch: { seed: 3 } });
    expect(rough.children).toHaveLength(iconParts('server').length);
    const outline = (rough as OutlineMobject).markupOutline as VGroup;
    expect(outline).toBeInstanceOf(VGroup);
    expect(Math.abs(rough.getHeight() - outline.getHeight())).toBeLessThan(0.3);
    const again = makeIcon('server', { size: 1.5, fillOpacity: 0.3, sketch: { seed: 3 } });
    expect((again.children[0] as VGroup).children.map((c) => (c as VMobject).getPoints().length))
      .toEqual((rough.children[0] as VGroup).children.map((c) => (c as VMobject).getPoints().length));
  });
});

describe('blobs', () => {
  const distance = (rect: { x: number; y: number; width: number; height: number }, [x, y]: number[]) => {
    const dx = Math.abs(x - rect.x) - rect.width / 2;
    const dy = Math.abs(y - rect.y) - rect.height / 2;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  };

  it('keeps the requested distance around one rectangle', () => {
    const rect = { x: 1, y: -2, width: 3, height: 1 };
    const loops = blobOutline([rect], { buff: 0.4 });
    expect(loops).toHaveLength(1);
    expect(loops[0].length).toBeGreaterThan(12);
    for (const point of loops[0]) expect(Math.abs(distance(rect, point) - 0.4)).toBeLessThan(0.08);
  });

  it('merges neighbours into one curve and keeps distant members apart', () => {
    const near = [{ x: 0, y: 0, width: 1, height: 1 }, { x: 1.4, y: 0.2, width: 1, height: 1 }];
    expect(blobOutline(near, { buff: 0.3 })).toHaveLength(1);
    const far = [{ x: 0, y: 0, width: 1, height: 1 }, { x: 6, y: 0, width: 1, height: 1 }];
    expect(blobOutline(far, { buff: 0.3 })).toHaveLength(2);
    // Smoothing bridges a gap that the plain union leaves open.
    const gap = [{ x: 0, y: 0, width: 1, height: 1 }, { x: 2.1, y: 0, width: 1, height: 1 }];
    const field = blobField(gap, { buff: 0.3, smoothness: 1 });
    expect(field(1.05, 0)).toBeLessThan(blobField(gap, { buff: 0.3, smoothness: 0 })(1.05, 0));
  });

  it('produces closed smooth curves as a vector mobject', () => {
    const blob = blobMobject([{ x: 0, y: 0, width: 2, height: 1 }], { buff: 0.25 });
    const points = blob.getPoints();
    expect((points.length - 1) % 3).toBe(0);
    expect(points[0]).toEqual(points[points.length - 1]);
    expect(blob.getWidth()).toBeCloseTo(2.5, 0);
    expect(blob.getHeight()).toBeCloseTo(1.5, 0);
    expect(() => blobOutline([], {})).toThrow(/at least one/);
    expect(() => blobOutline([{ x: 0, y: 0, width: 1, height: 1 }], { smoothness: 2 })).toThrow(/smoothness/);
  });
});

describe('Tremble', () => {
  it('displaces points within the amplitude and restores them when it ends', () => {
    const rect = new Rectangle({ width: 2, height: 1 });
    const original = rect.getLocalPoints();
    const tremble = new Tremble(rect, { amplitude: 0.1, rate: 10, seed: 5 });
    expect(tremble.irreversible).toBe(true);
    tremble.begin();
    tremble.interpolate(0.05);
    const shaken = rect.getLocalPoints();
    expect(shaken.some((p, i) => p[0] !== original[i][0] || p[1] !== original[i][1])).toBe(true);
    shaken.forEach((p, i) => {
      expect(Math.abs(p[0] - original[i][0])).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(Math.abs(p[1] - original[i][1])).toBeLessThanOrEqual(0.1 + 1e-9);
    });
    tremble.interpolate(0.35);
    expect(rect.getLocalPoints()).not.toEqual(shaken);
    tremble.finish();
    expect(rect.getLocalPoints()).toEqual(original);
    expect(() => new Tremble(rect, { rate: 0 })).toThrow(/rate/);
  });
});

describe('markup for icons, enclosures and tremble', () => {
  it('parses icons with their name, label and style roles', () => {
    const icon = element('[[icon: database #db x=1 y=2 size=1.5 label="orders" label_side=right fill_opacity=0.3 sketch=true]]', 'db');
    expect(icon.kind).toBe('icon');
    expect(icon.source).toBe('database');
    expect(icon.attributes.label_side).toBe('right');
    expect(styleRoles(icon)).toEqual(['shape', 'icon', 'icon-database']);
    const styled = element('[[icon: user #u x=0 y=0]]', 'u', '::: styles\nicon: fill_opacity=0.2\nicon-user: color=RED\n:::');
    expect(styled.attributes.fill_opacity).toBe('0.2');
    expect(styled.attributes.color).toBe('RED');
    expect(() => parse('[[icon: rocket #r x=0 y=0]]')).toThrow(/Unknown icon "rocket"/);
    expect(() => parse('[[icon: user x=0 y=0]]')).toThrow(/explicit #id/);
    expect(() => parse('[[icon: user #u label="a" label_side=inside]]')).toThrow(/label_side must be/);
    expect(() => parse('[[icon: user #u label_side=above]]')).toThrow(/requires a label/);
    expect(() => parse('[[icon: user #u width=2]]')).toThrow(/Unknown attributes: width/);
  });

  it('lets boxes and blobs enclose several elements', () => {
    const body = '[[dot: #a x=0 y=0]]\n[[dot: #b x=2 y=0]]\n[[dot: #c x=1 y=1]]\n'
      + '[[box: #a #b, #pair, buff=0.3]]\n[[blob: #a #b #c, #all, buff=0.4, smoothness=0.8, fill_opacity=0.1]]\n[[box: #c, #single, buff=0.1]]';
    const doc = parse(body);
    const items = doc.slides[0].items as ElementSpec[];
    expect(attachmentTargets(items.find((i) => i.id === 'pair') as ElementSpec)).toEqual(['a', 'b']);
    const all = items.find((i) => i.id === 'all') as ElementSpec;
    expect(all.kind).toBe('blob');
    expect(attachmentTargets(all)).toEqual(['a', 'b', 'c']);
    expect(all.attributes.smoothness).toBe('0.8');
    expect(attachmentTargets(items.find((i) => i.id === 'single') as ElementSpec)).toEqual(['c']);
    expect(styleRoles(all)).toEqual(['attachment', 'blob']);
    expect(() => parse('[[dot: #a x=0 y=0]]\n[[blob: #a #zz, #q]]')).toThrow(/Unknown blob target #zz/);
    expect(() => parse('[[dot: #a x=0 y=0]]\n[[dot: #b x=1 y=0]]\n[[brace: #a #b, #q]]')).toThrow(/attaches to one element/);
    expect(() => parse('[[dot: #a x=0 y=0]]\n[[blob: #a, #q, smoothness=3]]')).toThrow(/smoothness must be between/);
    expect(() => parse('[[dot: #a x=0 y=0]]\n[[blob: #a, #q, corner_radius=1]]')).toThrow(/Unknown attributes: corner_radius/);
  });

  it('validates tremble ranges and the kinds that take them', () => {
    expect(parseTremble('true', 2, 1)).toEqual({ start: 2, end: null });
    expect(parseTremble('false', 2, 1)).toBeNull();
    expect(parseTremble('3', 0, 1)).toEqual({ start: 3, end: null });
    expect(parseTremble('1-4', 0, 1)).toEqual({ start: 1, end: 4 });
    expect(() => parseTremble('4-1', 0, 1)).toThrow(/end after they start/);
    expect(() => parseTremble('soon', 0, 1)).toThrow(/tremble must be/);
    const shape = element('[[circle: #c x=0 y=0 radius=1 tremble=1-3 tremble_amplitude=0.08 tremble_rate=6]]', 'c');
    expect(shape.attributes.tremble).toBe('1-3');
    expect(element('[[icon: user #u x=0 y=0 tremble=true]]', 'u').attributes.tremble).toBe('true');
    expect(element('[[dot: #a x=0 y=0]]\n[[blob: #a, #q, tremble=2, step=1]]', 'q').attributes.tremble).toBe('2');
    expect(() => parse('[Hello]{#t x=0 y=0 tremble=true}')).toThrow(/Unknown attributes: tremble/);
    expect(() => parse('[[circle: #c x=0 y=0 radius=1 tremble_rate=3]]')).toThrow(/requires tremble=/);
    expect(() => parse('[[circle: #c x=0 y=0 radius=1 step=1 hide=3 tremble=3]]')).toThrow(/before the element is hidden/);
    expect(() => parse('[[circle: #c x=0 y=0 radius=1 tremble_rate=0 tremble=true]]')).toThrow(/tremble_rate must be positive/);
  });
});
