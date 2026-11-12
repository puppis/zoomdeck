import { describe, expect, it } from 'vitest';
import { Group, Line, Rectangle, VMobject } from 'manim-web';
import { CHART_COLORS, buildChart, niceStep, parseChartData, valueAxis } from '../src/charts';
import { buildTable } from '../src/markup/table';
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
    expect(() => parse('```chart {#c type=donut}\nA, 1\n```')).toThrow(/Chart type must be one of/);
    expect(() => parse('```chart {#c colors="RED nope"}\nA, 1\n```')).toThrow(/Invalid color/);
    expect(() => parse('```chart {#c min=5 max=1}\nA, 1\n```')).toThrow(/max must exceed min/);
    expect(() => parse('```chart {#c}\n\n```')).toThrow(/needs rows of data/);
    expect(() => parse('```chart {#c grid=sometimes}\nA, 1\n```')).toThrow(/grid must be true or false/);
  });
});
