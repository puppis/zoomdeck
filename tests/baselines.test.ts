import { describe, expect, it } from 'vitest';
import { Line, Rectangle } from 'manim-web';
import { markLines, textLines } from '../src/markup/text';
import { LayoutConfig, anchorPoint, placeBeside, placeLabel, placeRelative } from '../src/markup/renderer';
import { MarkupParser } from '../src/markup/parser';
import { ElementSpec, type ListItem } from '../src/markup/ast';

/**
 * A stand-in for a line of text: a box `height` tall whose baseline lies `inkBelow` above its
 * bottom (its descenders), with the font reaching `ascent` above and `descent` below the baseline.
 */
function word(width: number, height: number, inkBelow: number, ascent = 0.3, descent = 0.1, interline = 0.5): Rectangle {
  const box = new Rectangle({ width, height }) as Rectangle & { markupBaselineFraction: number };
  const baseline = -height / 2 + inkBelow;
  box.markupBaselineFraction = baseline / height;
  markLines(box, { first: baseline, last: baseline, ascent, descent, interline });
  return box;
}

const element = (attributes: Record<string, string>) => new ElementSpec('e', 'text', [], attributes, '', 1);

describe('the lines of a text', () => {
  it('follow it when it moves or scales', () => {
    const text = word(2, 0.4, 0.1);
    text.shift([3, -2, 0]);
    text.scale(2);
    const lines = textLines(text) as NonNullable<ReturnType<typeof textLines>>;
    // A quarter of the way up, and the font's reach growing with the text.
    const factor = text.getHeight() / 0.4;
    expect(text.getCenter()[1]).toBeCloseTo(-2, 9);
    expect(lines.first).toBeCloseTo(text.getBottom()[1] + text.getHeight() / 4, 9);
    expect(lines.ascent).toBeCloseTo(0.3 * factor, 9);
    expect(lines.interline).toBeCloseTo(0.5 * factor, 9);
    expect(textLines(new Rectangle({ width: 1, height: 1 }))).toBeNull();
  });

  it('place labels by their font, so that labels with and without descenders share a baseline', () => {
    // 'ace' has no descenders; 'Ag' reaches lower and higher.
    const flat = word(1, 0.2, 0);
    const deep = word(1, 0.4, 0.1);
    const reference = new Rectangle({ width: 4, height: 0.2 });
    placeBeside(flat, reference, [0, -1, 0], 0.1);
    placeBeside(deep, reference, [0, -1, 0], 0.1);
    expect(textLines(flat)?.first).toBeCloseTo(textLines(deep)?.first as number, 9);
    // The top of the first line is the gap below the reference.
    expect((textLines(flat)?.first as number) + 0.3).toBeCloseTo(reference.getBottom()[1] - 0.1, 9);
    // On a level edge too, at any label_buff.
    const edge = new Line({ start: [-2, 0, 0], end: [2, 0, 0] });
    const a = word(1, 0.2, 0);
    const b = word(1, 0.4, 0.1);
    placeLabel(a, edge, [-2, 0, 0], [2, 0, 0], false, 'above', 0.5, 0.4);
    placeLabel(b, edge, [-2, 0, 0], [2, 0, 0], false, 'above', 0.5, 0.4);
    expect(textLines(a)?.first).toBeCloseTo(textLines(b)?.first as number, 9);
    expect((textLines(a)?.last as number) - 0.1).toBeCloseTo(edge.getTop()[1] + 0.4, 9);
  });

  it('line up side by side on a baseline, one under the other a line apart, and are aimed at on their baseline', () => {
    const big = word(2, 0.8, 0.2, 0.6, 0.2, 1);
    const small = word(1, 0.4, 0.1);
    const objects = new Map([['big', big]]);
    placeRelative(element({ 'right-of': '#big' }), small, objects, 0.3);
    expect(textLines(small)?.first).toBeCloseTo(textLines(big)?.first as number, 9);
    const under = word(1, 0.4, 0.1);
    placeRelative(element({ below: '#big' }), under, objects, 0.3);
    // The big line's descent, its lead (1 - 0.6 - 0.2), the buff and the small line's ascent.
    expect(textLines(under)?.first).toBeCloseTo((textLines(big)?.last as number) - 0.2 - 0.2 - 0.3 - 0.3, 9);
    const dot = new Rectangle({ width: 0.1, height: 0.1 });
    placeRelative(new ElementSpec('d', 'dot', [], { at: '#big' }, '', 1), dot, objects, 0.3);
    expect(dot.getCenter()[1]).toBeCloseTo(textLines(big)?.first as number, 9);
    expect(dot.getCenter()[0]).toBeCloseTo(big.getCenter()[0], 9);
    expect(anchorPoint(big, 'baseline')[1]).toBeCloseTo(textLines(big)?.first as number, 9);
  });
});

describe('markup for baselines, label distances and paragraphs', () => {
  const parse = (body: string) => new MarkupParser().parse(`::: slide {#s}\n${body}\n:::`);
  const shapes = '[[rectangle: #a x=-3 y=0 width=1 height=1]]\n\n[[rectangle: #b x=3 y=2 width=1 height=1]]\n\n';

  it('accepts the baseline anchor on text only', () => {
    expect(() => parse('[Hello]{#h at=baseline:(0,0)}')).not.toThrow();
    expect(() => parse(`${shapes}[x]{#t at=#a}\n\n[[dot: #d at=#t.baseline]]`)).not.toThrow();
    expect(() => parse(`${shapes}[[dot: #d at=#a.baseline]]`)).toThrow(/Baseline anchors apply to text/);
  });

  it('takes label_buff on arrows, lines, braces and icons', () => {
    expect(() => parse(`${shapes}[[arrow: #a -> #b, #e, label="x", label_buff=0.4]]`)).not.toThrow();
    expect(() => parse(`${shapes}[[brace: #a, #br, label="x", label_buff=0.2]]`)).not.toThrow();
    expect(() => parse('[[icon: user #u x=0 y=0 label="x" label_buff=0.3]]')).not.toThrow();
    expect(() => parse(`${shapes}[[arrow: #a -> #b, #e, label="x", label_buff=-1]]`)).toThrow(/label_buff must be nonnegative/);
    expect(() => parse(`${shapes}[[arrow: #a -> #b, #e, label_buff=0.4]]`)).toThrow(/label_buff requires a label/);
  });

  it('tells a tight list, written without blank lines, from a loose one', () => {
    const items = (body: string) => parse(body).slides[0].items.map((item) => (item as ElementSpec).list as ListItem);
    expect(items('- one\n- two').map((list) => list.tight)).toEqual([true, true]);
    expect(items('- one\n\n- two').map((list) => list.tight)).toEqual([false, false]);
  });

  it('spaces paragraphs 1.5 interlines apart unless the layout says otherwise', () => {
    expect(new LayoutConfig().paragraphSpacing).toBe(1.5);
    expect(new LayoutConfig({ paragraphSpacing: 2 }).paragraphSpacing).toBe(2);
    expect(() => new LayoutConfig({ paragraphSpacing: -1 })).toThrow(/paragraphSpacing/);
  });
});
