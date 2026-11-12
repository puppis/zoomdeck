import { describe, expect, it } from 'vitest';
import { Rectangle, VGroup, VMobject } from 'manim-web';
import { FILL_STYLES, sketch, sketchSeed, type OutlineMobject } from '../src/sketch';
import { MarkupParser } from '../src/markup/parser';
import { ElementSpec } from '../src/markup/ast';

const points = (group: VGroup) => group.children.flatMap((child) => (child as VMobject).getPoints().map((p) => p.join(',')));

describe('sketch', () => {
  it('draws a rectangle close to its exact size, centered at the origin', () => {
    const rect = sketch.rectangle(4, 2, { seed: 7 });
    expect(rect.children).toHaveLength(1);
    expect(rect.getWidth()).toBeCloseTo(4, 0);
    expect(rect.getHeight()).toBeCloseTo(2, 0);
    expect(Math.abs(rect.getCenter()[0])).toBeLessThan(0.2);
    expect(Math.abs(rect.getCenter()[1])).toBeLessThan(0.2);
  });

  it('adds a hatching or a solid fill below the outline', () => {
    const hatched = sketch.circle(1, { seed: 2, fillColor: '#FF0000', fillOpacity: 0.5 });
    expect(hatched.children).toHaveLength(2);
    const [hatching, outline] = hatched.children as VMobject[];
    expect(hatching.fillOpacity).toBe(0);
    expect(String(hatching.strokeColor).toUpperCase()).toBe('#FF0000');
    expect(outline.fillOpacity).toBe(0);
    expect(hatching.getPoints().length).toBeGreaterThan(outline.getPoints().length);
    const solid = sketch.ellipse(3, 1, { seed: 2, fillOpacity: 0.3, fillStyle: 'solid' });
    expect(solid.children).toHaveLength(2);
    expect((solid.children[0] as VMobject).fillOpacity).toBeCloseTo(0.3);
    for (const fillStyle of FILL_STYLES) expect(sketch.rectangle(2, 1, { seed: 1, fillOpacity: 1, fillStyle }).children).toHaveLength(2);
  });

  it('is deterministic for a seed and varies with it', () => {
    expect(points(sketch.polygon([[0, 0], [2, 0], [1, 1.5]], { seed: 5 }))).toEqual(points(sketch.polygon([[0, 0], [2, 0], [1, 1.5]], { seed: 5 })));
    expect(points(sketch.polygon([[0, 0], [2, 0], [1, 1.5]], { seed: 5 }))).not.toEqual(points(sketch.polygon([[0, 0], [2, 0], [1, 1.5]], { seed: 6 })));
    expect(sketchSeed('box@12')).toBe(sketchSeed('box@12'));
    expect(sketchSeed('box@12')).not.toBe(sketchSeed('box@13'));
    expect(Number.isInteger(sketchSeed('x')) && sketchSeed('x') > 0).toBe(true);
  });

  it('builds lines, arrows, arcs, polylines, braces and paths at their coordinates', () => {
    const line = sketch.line([-1, 0], [1, 0], { seed: 1 });
    expect(line.getWidth()).toBeCloseTo(2, 0);
    const arrow = sketch.arrow([0, 0], [3, 0], { seed: 1 });
    expect(arrow.children.length).toBeGreaterThanOrEqual(2);
    expect(arrow.getWidth()).toBeCloseTo(3, 0);
    const arc = sketch.arc([2, 2], 1, 0, Math.PI, { seed: 1 });
    expect(arc.getCenter()[1]).toBeGreaterThan(2.2);
    expect(sketch.arc([0, 0], 1, 0, 1, { seed: 1, fillOpacity: 0.4 }).children).toHaveLength(2);
    const zigzag = sketch.polyline([[0, 0], [1, 1], [2, 0]], { seed: 1 });
    expect(zigzag.getWidth()).toBeCloseTo(2, 0);
    const brace = sketch.brace(4, 0.3, { seed: 1 });
    expect(brace.getWidth()).toBeCloseTo(4, 0);
    expect(brace.getCenter()[1]).toBeLessThan(0);
    expect(sketch.path('M0,0 L2,0 L2,1 Z', { seed: 1 }).getWidth()).toBeCloseTo(2, 0);
    const traced = sketch.of(new Rectangle({ width: 3, height: 1 }), { seed: 1 });
    expect(traced.getWidth()).toBeCloseTo(3, 0);
    expect((traced as OutlineMobject).markupOutline).toBeInstanceOf(Rectangle);
  });

  it('rejects invalid options', () => {
    expect(() => sketch.rectangle(1, 1, { fillStyle: 'plaid' as never })).toThrow(/fill style/);
    expect(() => sketch.rectangle(1, 1, { roughness: -1 })).toThrow(/roughness/);
    expect(() => sketch.rectangle(1, 1, { seed: 1.5 })).toThrow(/seed/);
    expect(() => sketch.arrow([0, 0], [0, 0])).toThrow(/distinct/);
  });
});

describe('sketch attributes in markup', () => {
  const parse = (body: string) => new MarkupParser().parse(`::: slide {#a}\n${body}\n:::`);
  const first = (body: string) => parse(body).slides[0].items[0] as ElementSpec;

  it('accepts sketch and its tuning attributes on shapes, connections and attachments', () => {
    const rect = first('[[rectangle: #r x=0 y=0 width=2 height=1 sketch=true roughness=2 bowing=0.5 fill_style=zigzag hachure_angle=30 hachure_gap=0.2 fill_weight=1 seed=3]]');
    expect(rect.attributes.sketch).toBe('true');
    expect(rect.attributes.fill_style).toBe('zigzag');
    expect(parse('[[arrow: (0,0) -> (1,1), #ar, sketch=true, roughness=1.5]]').slides).toHaveLength(1);
    expect(parse('[[dot: #p x=0 y=0]]\n[[brace: #p, #b, sketch=true]]\n[[box: #p, #bx, sketch=true, fill_style=dots]]').slides).toHaveLength(1);
  });

  it('accepts font on text and labels only', () => {
    expect(first('[A note]{#n x=0 y=0 font=Zeyada font_size=36}').attributes.font).toBe('Zeyada');
    expect(parse('[[arrow: (0,0) -> (1,1), #ar, label="by hand", font=Zeyada]]').slides).toHaveLength(1);
    expect(parse('[[dot: #p x=0 y=0]]\n[[brace: #p, #b, label="x", font=Zeyada]]').slides).toHaveLength(1);
    expect(() => parse('![i](x.png){#i x=0 y=0 font=Zeyada}')).toThrow(/Unknown attributes: font/);
  });

  it('validates the values', () => {
    expect(() => parse('[[circle: #c x=0 y=0 radius=1 sketch=maybe]]')).toThrow(/sketch must be true or false/);
    expect(() => parse('[[circle: #c x=0 y=0 radius=1 fill_style=plaid]]')).toThrow(/fill_style must be one of/);
    expect(() => parse('[[circle: #c x=0 y=0 radius=1 seed=1.5]]')).toThrow(/seed must be an integer/);
    expect(() => parse('[[circle: #c x=0 y=0 radius=1 hachure_gap=0]]')).toThrow(/hachure_gap must be positive/);
    expect(() => parse('[[circle: #c x=0 y=0 radius=1 roughness=-1]]')).toThrow(/roughness must be nonnegative/);
    expect(() => parse('[text]{#t x=0 sketch=true}')).toThrow(/Unknown attributes: sketch/);
  });

  it('applies deck-wide through the shape role', () => {
    const document = new MarkupParser().parse('::: styles\nshape: sketch=true roughness=1.5\ndot: sketch=false\n:::\n::: slide {#a}\n[[circle: #c x=0 y=0 radius=1]]\n[[dot: #d x=0 y=0]]\n:::');
    const [circle, dot] = document.slides[0].items as ElementSpec[];
    expect(circle.attributes.sketch).toBe('true');
    expect(circle.attributes.roughness).toBe('1.5');
    expect(dot.attributes.sketch).toBe('false');
  });
});
