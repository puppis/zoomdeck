import { describe, expect, it } from 'vitest';
import { Group, Line, Rectangle, VMobject } from 'manim-web';
import { CHART_COLORS, buildChart, niceStep, parseChartData, valueAxis } from '../src/charts';
import { buildTable } from '../src/markup/table';
import { columnWidths, tablePadding } from '../src/markup/renderer';
import { MarkupParser } from '../src/markup/parser';
import { ElementSpec, TableSpec, span } from '../src/markup/ast';
import type { InlineSpan } from '../src/markup/ast';

const parse = (body: string) => new MarkupParser().parse(`::: slide {#s}\n${body}\n:::\n`);
const element = (body: string, id: string) => parse(body).slides[0].items.find((item) => item instanceof ElementSpec && item.id === id) as ElementSpec;

/** A stand-in for prose: a rectangle 0.12 units per character wide, wrapped to `maxWidth`. */
const fakeText = async (text: string, size: number, maxWidth: number) => {
  const natural = Math.max(0.05, text.length * 0.12 * (size / 20));
  const lines = Math.max(1, Math.ceil(natural / maxWidth));
  const rect = new Rectangle({ width: Math.min(natural, maxWidth), height: 0.3 * lines * (size / 20) });
  return rect;
};

describe('chart data', () => {
  it('reads headers, years and bare numbers', () => {
    const named = parseChartData('Region, 2022, 2023\nNorth, 3, 5\nSouth, 2, 4');
    expect(named.categories).toEqual(['North', 'South']);
    expect(named.series.map((s) => s.name)).toEqual(['2022', '2023']);
    expect(named.series[1].values).toEqual([5, 4]);
    const bare = parseChartData('Chrome; 64\nSafari; 19');
    expect(bare.series).toEqual([{ name: '', values: [64, 19] }]);
    expect(bare.categories).toEqual(['Chrome', 'Safari']);
    expect(parseChartData('a\t1\nb\t2', true).categories).toEqual(['b']);
    expect(parseChartData('Year, 2020\n2021, 3', false).series[0].values).toEqual([2020, 3]);
    expect(() => parseChartData('Name, V\nNorth, x')).toThrow(/not a number/);
    expect(() => parseChartData('')).toThrow(/at least one row/);
    expect(() => parseChartData('Only, labels\nhere')).toThrow(/at least one value|not a number/);
  });

  it('chooses readable axis bounds', () => {
    expect(niceStep(10)).toBe(2);
    expect(niceStep(0.37)).toBe(0.1);
    expect(valueAxis([3.2, 4.1, 1.6])).toEqual({ lo: 0, hi: 5, step: 1 });
    expect(valueAxis([-2, 8])).toEqual({ lo: -2, hi: 8, step: 2 });
    expect(valueAxis([5, 7], 0, 10)).toEqual({ lo: 0, hi: 10, step: 2 });
  });
});

describe('charts', () => {
  const data = parseChartData('Region, 2022, 2023\nNorth, 3, 5\nSouth, 2, 4');
  const label = async (text: string, size: number) => fakeText(text, size, 10);

  it('builds grouped bars inside the requested plot size with a legend', async () => {
    const chart = await buildChart(data, { width: 6, height: 3 }, label);
    expect(chart).toBeInstanceOf(Group);
    const rects = chart.children.filter((c) => c instanceof Rectangle && c.fillOpacity > 0) as Rectangle[];
    // Four bars plus two legend swatches.
    expect(rects.length).toBe(6);
    const tallest = Math.max(...rects.map((r) => r.getHeight()));
    expect(tallest).toBeCloseTo(3, 1);
    expect(String((rects[0] as unknown as { _getColorState(): { fillColor?: string } })._getColorState().fillColor).toUpperCase()).toBe(CHART_COLORS[0]);
    expect(chart.getWidth()).toBeGreaterThan(6);
    const plain = await buildChart(data, { legend: false, grid: false, type: 'line' }, label);
    expect(plain.children.filter((c) => c instanceof Rectangle && c.fillOpacity > 0)).toHaveLength(0);
    expect(plain.children.some((c) => c instanceof VMobject && c.getPoints().length > 4)).toBe(true);
  });

  it('builds pies whose slices cover the whole circle', async () => {
    const pie = await buildChart(parseChartData('a, 1\nb, 1\nc, 2'), { type: 'pie', width: 4, height: 4 }, label);
    const slices = pie.children.filter((c) => c instanceof VMobject && c.fillOpacity > 0) as VMobject[];
    expect(slices).toHaveLength(3);
    expect(pie.getWidth()).toBeGreaterThan(3.2);
    await expect(buildChart(parseChartData('a, -1\nb, 2'), { type: 'pie' }, label)).rejects.toThrow(/nonnegative/);
    await expect(buildChart(data, { type: 'donut' as never }, label)).rejects.toThrow(/Unknown chart type/);
  });

  it('draws by hand on request', async () => {
    const rough = await buildChart(data, { sketch: { seed: 3 }, legend: false }, label);
    expect(rough.children.some((c) => c instanceof VMobject && !(c instanceof Rectangle) && c.children.length >= 2)).toBe(true);
  });
});

describe('tables', () => {
  const cell = (text: string): InlineSpan[] => [span(text)];
  const factory = (spans: InlineSpan[], size: number, maxWidth: number) => fakeText(spans.map((s) => s.content).join(''), size, maxWidth);

  it('sizes columns by content, draws the requested rules and shades the header', async () => {
    const rows = [[cell('Name'), cell('Value')], [cell('A long first cell'), cell('1')], [cell('B'), cell('22')]];
    const table = await buildTable(rows, { fontSize: 20, color: '#000000', padding: 0.1 }, factory);
    const rects = table.children.filter((c) => c instanceof Rectangle && c.fillOpacity > 0 && c.getWidth() > 2) as Rectangle[];
    expect(rects).toHaveLength(1); // header shading spans the table
    expect(table.getWidth()).toBeGreaterThan(2.5);
    const lines = table.children.filter((c) => c instanceof Line);
    expect(lines).toHaveLength(4 + 3); // rows + 1 horizontal rules, columns + 1 vertical rules
    const outer = await buildTable(rows, { fontSize: 20, color: '#000000', rules: 'outer', headerOpacity: 0 }, factory);
    expect(outer.children.filter((c) => c instanceof Line)).toHaveLength(4);
    const none = await buildTable(rows, { fontSize: 20, color: '#000000', rules: 'none', headerOpacity: 0 }, factory);
    expect(none.children.filter((c) => c instanceof Line)).toHaveLength(0);
  });

  it('draws row and column rules in colors and widths of their own, or the shared ones', async () => {
    const rows = [[cell('Name'), cell('Value')], [cell('A'), cell('1')], [cell('B'), cell('22')]];
    const lines = (table: Group) => table.children.filter((c) => c instanceof Line) as Line[];
    const level = (line: Line) => Math.abs(line.getStart()[1] - line.getEnd()[1]) < 1e-9;
    const style = (line: Line) => `${line.color.toUpperCase()} ${line.strokeWidth}`;
    const shared = await buildTable(rows, { fontSize: 20, color: '#000000', borderColor: '#888888', strokeWidth: 2 }, factory) as Group;
    expect(new Set(lines(shared).map(style))).toEqual(new Set(['#888888 2']));
    const split = await buildTable(rows, { fontSize: 20, color: '#000000', borderColor: '#888888', strokeWidth: 2, rowRuleColor: '#0000FF', rowRuleWidth: 3, colRuleColor: '#FF0000' }, factory) as Group;
    expect(new Set(lines(split).filter(level).map(style))).toEqual(new Set(['#0000FF 3']));
    // The columns keep the shared width when only their color is given.
    expect(new Set(lines(split).filter((line) => !level(line)).map(style))).toEqual(new Set(['#FF0000 2']));
    // Row rules come after column rules, so they lie on top where they cross.
    const kinds = lines(split).map(level);
    expect(kinds.indexOf(true)).toBeGreaterThan(kinds.lastIndexOf(false));
    // Width 0 leaves out the rules of that direction, the sides of the frame included.
    const rowsOnly = await buildTable(rows, { fontSize: 20, color: '#000000', colRuleWidth: 0 }, factory) as Group;
    expect(lines(rowsOnly)).toHaveLength(4);
    expect(lines(rowsOnly).every(level)).toBe(true);
  });

  it('lines the cells of a row up on their first baseline, or by the middle, top or bottom of their box', async () => {
    // Cells as boxes whose first baseline lies at a given height: a word with a descender, a tall
    // formula over its baseline, and a plain word.
    const baseline = (height: number, above: number) => {
      const box = new Rectangle({ width: 0.6, height }) as Rectangle & { markupBaselineFraction: number };
      // The baseline lies `above` below the top: from the center, a fraction of the height.
      box.markupBaselineFraction = (height / 2 - above) / height;
      return box;
    };
    const makers = [() => baseline(0.3, 0.2), () => baseline(0.6, 0.45), () => baseline(0.25, 0.25)];
    const factory = (index: () => number) => async () => makers[index()]();
    const build = async (valign?: 'baseline' | 'center' | 'top' | 'bottom') => {
      let n = 0;
      const rows = [[cell('a'), cell('b'), cell('c')]];
      const table = await buildTable(rows, { fontSize: 20, color: '#000000', header: false, rules: 'none', ...(valign ? { valign } : {}) }, factory(() => n++ % 3)) as Group;
      return table.children.filter((c) => c instanceof Rectangle && (c as Rectangle).fillOpacity === 0) as Array<Rectangle & { markupBaselineFraction: number }>;
    };
    const baselines = (cells: Array<Rectangle & { markupBaselineFraction: number }>) => cells.map((c) => c.getCenter()[1] + c.markupBaselineFraction * c.getHeight());
    const onBaseline = await build();
    expect(onBaseline).toHaveLength(3);
    for (const y of baselines(onBaseline)) expect(y).toBeCloseTo(baselines(onBaseline)[0], 9);
    const centered = await build('center');
    for (const c of centered) expect(c.getCenter()[1]).toBeCloseTo(centered[0].getCenter()[1], 9);
    const top = await build('top');
    for (const c of top) expect(c.getTop()[1]).toBeCloseTo(top[0].getTop()[1], 9);
    const bottom = await build('bottom');
    for (const c of bottom) expect(c.getBottom()[1]).toBeCloseTo(bottom[0].getBottom()[1], 9);
  });

  it('pads across and down apart, and makes every row at least as tall as the letters of its font', async () => {
    // Stand-ins whose ink reaches a given height above the baseline and depth below it: the
    // strut's letters, an ellipsis, letters without ascenders, a capital, and a tall formula.
    const reach: Record<string, [number, number]> = { Hdp: [0.22, 0.08], '…': [0.03, 0], ace: [0.12, 0], A: [0.2, 0], F: [0.4, 0.1] };
    const factory = async (spans: InlineSpan[]) => {
      const [above, below] = reach[spans.map((s) => s.content).join('')];
      const box = new Rectangle({ width: 0.3, height: above + below }) as Rectangle & { markupBaselineFraction: number };
      box.markupBaselineFraction = ((above + below) / 2 - above) / (above + below);
      return box;
    };
    const height = async (text: string, valign?: 'center') => (await buildTable([[cell(text)]], {
      fontSize: 20, color: '#000000', header: false, rules: 'outer', paddingX: 0.2, paddingY: 0.05, ...(valign ? { valign } : {}),
    }, factory)).getHeight();
    // Plain text, an ellipsis, an empty row: all as tall as the strut, 0.3, plus the padding.
    for (const text of ['…', 'ace', 'A', '']) expect(await height(text)).toBeCloseTo(0.3 + 0.1, 6);
    // A formula reaching beyond the letters makes its row taller, above and below.
    expect(await height('F')).toBeCloseTo(0.4 + 0.1 + 0.1, 6);
    // By the middle of their boxes, the strut's whole height at least.
    expect(await height('…', 'center')).toBeCloseTo(0.3 + 0.1, 6);
    const lineHeight = (20 / 72) * 1.3;
    const wide = await buildTable([[cell('…'), cell('')]], { fontSize: 20, color: '#000000', header: false, rules: 'outer', paddingX: 0.2, paddingY: 0.05 }, factory);
    expect(wide.getWidth()).toBeCloseTo(2 * (lineHeight + 0.4), 6);
  });

  it('gives columns a fixed width, one for all or one each, and wraps their cells to it', async () => {
    const options = { fontSize: 20, color: '#000000', header: false, rules: 'outer' as const, padding: 0.07 };
    // Empty cells no longer shrink their column to a line height.
    const same = await buildTable([[cell('A'), cell(''), cell('')]], { ...options, columnWidths: [0.37] }, factory);
    expect(same.getWidth()).toBeCloseTo(3 * 0.37, 6);
    const lineHeight = (20 / 72) * 1.3;
    const each = await buildTable([[cell('A'), cell(''), cell('')]], { ...options, columnWidths: [0.5, null, 1] }, factory);
    expect(each.getWidth()).toBeCloseTo(0.5 + lineHeight + 0.14 + 1, 6);
    // A long cell wraps to its column, less the padding: three lines of the stand-in.
    const wrapped = await buildTable([[cell('A long text here')]], { ...options, columnWidths: [1] }, factory);
    expect(wrapped.getWidth()).toBeCloseTo(1, 6);
    expect(wrapped.getHeight()).toBeCloseTo(0.9 + 0.14, 6);
    await expect(buildTable([[cell('A'), cell('B')]], { ...options, columnWidths: [1, 2, 3] }, factory)).rejects.toThrow(/3 widths for 2 columns/);
  });

  it('shrinks and wraps columns to fit a maximum width', async () => {
    const rows = [[cell('A very long header that takes a lot of room'), cell('Another long header text')], [cell('x'), cell('y')]];
    const wide = await buildTable(rows, { fontSize: 20, color: '#000000' }, factory);
    const narrow = await buildTable(rows, { fontSize: 20, color: '#000000', maxWidth: 5 }, factory);
    expect(wide.getWidth()).toBeGreaterThan(8);
    expect(narrow.getWidth()).toBeLessThanOrEqual(5.6);
    expect(narrow.getHeight()).toBeGreaterThan(wide.getHeight());
  });
});

describe('markup for tables and charts', () => {
  it('accepts row and column rule colors and widths on tables', () => {
    const table = '| a | b |\n| :- | :- |\n| 1 | 2 |';
    expect(() => parse(`::: {.element #t row_rule_color=BLUE row_rule_width=3 col_rule_color=RED col_rule_width=0}\n${table}\n:::`)).not.toThrow();
    expect(() => parse(`::: {.element #t row_rule_width=-1}\n${table}\n:::`)).toThrow(/row_rule_width must be nonnegative/);
    expect(() => parse(`::: {.element #t col_rule_color=nope}\n${table}\n:::`)).toThrow(/Invalid color/);
    expect(() => parse(`::: {.element #t valign=top}\n${table}\n:::`)).not.toThrow();
    expect(() => parse(`::: {.element #t valign=middle}\n${table}\n:::`)).toThrow(/valign must be baseline, center, top or bottom/);
  });

  it('takes padding as one value or two, vertical first, and column widths as one or one per column', () => {
    const table = '| a | b |\n| :- | :- |\n| 1 | 2 |';
    expect(() => parse(`::: {.element #t padding="0.02 0.07" padding_x=0.1 col_width="0.4 auto"}\n${table}\n:::`)).not.toThrow();
    expect(() => parse(`::: {.element #t padding="0.1 0.2 0.3"}\n${table}\n:::`)).toThrow(/padding must be one or two nonnegative numbers/);
    expect(() => parse(`::: {.element #t padding=-1}\n${table}\n:::`)).toThrow(/padding must be one or two/);
    expect(() => parse(`::: {.element #t padding_y=-1}\n${table}\n:::`)).toThrow(/padding_y must be nonnegative/);
    expect(() => parse(`::: {.element #t col_width=0}\n${table}\n:::`)).toThrow(/col_width must be positive/);
    expect(() => parse(`::: {.element #t col_width="1 2 3"}\n${table}\n:::`)).toThrow(/col_width gives 3 widths for 2 columns/);
    expect(tablePadding({ padding: '0.02 0.07' })).toEqual({ paddingY: 0.02, paddingX: 0.07 });
    expect(tablePadding({ padding: '0.1', padding_y: '0' })).toEqual({ paddingY: 0, paddingX: 0.1 });
    expect(tablePadding({})).toEqual({});
    expect(columnWidths('0.4 auto, 1')).toEqual([0.4, null, 1]);
  });

  it('parses pipe tables with alignments and inline styling', () => {
    const table = element('| Name | Value |\n| :--- | ---: |\n| **Bold** $x$ | 1 |\n| [red]{color=RED} | 2 |', 'element-1') as TableSpec;
    expect(table).toBeInstanceOf(TableSpec);
    expect(table.kind).toBe('table');
    expect(table.aligns).toEqual(['left', 'right']);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[1][0].map((s) => [s.content, s.bold, s.kind])).toEqual([['Bold', true, 'text'], [' ', false, 'text'], ['x', false, 'math']]);
    expect(table.rows[2][0][0].color).toBe('RED');
    const styled = element('::: {.element #t x=1 y=2 rules=rows header_opacity=0.3 stripe_opacity=0.1 sketch=true}\n| A | B |\n| --- | --- |\n| 1 | 2 |\n:::', 't') as TableSpec;
    expect(styled).toBeInstanceOf(TableSpec);
    expect(styled.attributes.rules).toBe('rows');
    expect(styled.rows).toHaveLength(2);
    expect(() => parse('::: {.element #t rules=diagonal}\n| A |\n| --- |\n| 1 |\n:::')).toThrow(/rules must be one of/);
    expect(() => parse('::: {.element #t header=maybe}\n| A |\n| --- |\n| 1 |\n:::')).toThrow(/header must be true or false/);
    expect(() => parse('::: {.element #t height=2}\n| A |\n| --- |\n| 1 |\n:::')).toThrow(/Unknown attributes: height/);
  });

  it('parses chart fences and validates their options', () => {
    const chart = element('```chart {#c x=0 y=0 type=line colors="RED BLUE" values=true min=0}\nA, 1\nB, 2\n```', 'c');
    expect(chart.kind).toBe('chart');
    expect(chart.source).toBe('A, 1\nB, 2');
    expect(chart.attributes.type).toBe('line');
    expect('lang' in chart.attributes).toBe(false);
    // A type that is not built in is a chart of the deck's own, looked up in its charts folders when the deck is rendered.
    expect(element('```chart {#c type=donut}\nA, 1\n```', 'c').attributes.type).toBe('donut');
    expect(() => parse('```chart {#c type="no way"}\nA, 1\n```')).toThrow(/Chart type must be one of/);
    expect(() => parse('```chart {#c colors="RED nope"}\nA, 1\n```')).toThrow(/Invalid color/);
    expect(() => parse('```chart {#c min=5 max=1}\nA, 1\n```')).toThrow(/max must exceed min/);
    expect(() => parse('```chart {#c}\n\n```')).toThrow(/needs rows of data/);
    expect(() => parse('```chart {#c grid=sometimes}\nA, 1\n```')).toThrow(/grid must be true or false/);
  });
});
