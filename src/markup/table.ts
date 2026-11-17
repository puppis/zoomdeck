/**
 * Tables for markup slides: cells of styled prose and math in a grid of
 * rules, with optional backgrounds for the whole table, the header row and
 * alternate rows. Columns take their natural width, or a fixed one, and the
 * natural ones shrink, wrapping their text, when the table would exceed the
 * available width. Rows are as tall as their text reaches above and below its
 * baseline, plus the vertical padding.
 */
import { Group, Line, Rectangle, type Mobject } from 'manim-web';
import type { InlineSpan } from './ast';
import { sketch, type SketchOptions } from '../sketch';
import { baselineY } from './text';

/** Which rules a table may draw. */
export const TABLE_RULES = ['all', 'rows', 'cols', 'outer', 'none'] as const;
/** One of the rule choices of a table. */
export type TableRules = (typeof TABLE_RULES)[number];
/** How the cells of a row line up: on their first baseline, or by the middle, top or bottom of their box. */
export const TABLE_VALIGNS = ['baseline', 'center', 'top', 'bottom'] as const;
export type TableValign = (typeof TABLE_VALIGNS)[number];
export type CellAlign = 'left' | 'center' | 'right';

/** How a table is drawn: font, colors, header, padding, rules and backgrounds. */
export interface TableOptions {
  /** Text size in points; the layout's font size by default. */
  fontSize: number;
  /** Text color and default rule color. */
  color: string;
  /** Column alignments; left where missing. */
  aligns?: CellAlign[];
  /** How the cells of a row line up; on their first baseline by default. */
  valign?: TableValign;
  /** Whether the first row is a header; true by default. */
  header?: boolean;
  /** Space between a cell's text and its rules, in logical units, on all four sides; 0.15 by default. */
  padding?: number;
  /** Space between a cell's text and the rules beside it, and above and below it; `padding` by default. */
  paddingX?: number;
  paddingY?: number;
  /**
   * Fixed widths of the columns, rules to rules, in logical units: one for every column, or one
   * per column, where null leaves a column its natural width. A cell too wide for its column
   * wraps, to a line height at the narrowest; a column too narrow for that and its padding widens.
   */
  columnWidths?: ReadonlyArray<number | null>;
  /** Which rules to draw; all by default. */
  rules?: TableRules;
  /** Color of every rule; the text color by default. */
  borderColor?: string;
  /** Width of every rule in engine units; 1.5 by default. */
  strokeWidth?: number;
  /** Color and width of the horizontal rules, between rows and at the top and bottom; the shared ones by default. */
  rowRuleColor?: string;
  rowRuleWidth?: number;
  /** Color and width of the vertical rules, between columns and at the sides; the shared ones by default. */
  colRuleColor?: string;
  colRuleWidth?: number;
  /** Background of the whole table. */
  fillColor?: string;
  fillOpacity?: number;
  /** Background of the header row; the rule color at 0.12 by default. */
  headerColor?: string;
  headerOpacity?: number;
  /** Background of every second body row, in the rule color; 0 by default. */
  stripeOpacity?: number;
  /** Width the table must fit in; columns shrink and wrap beyond it. */
  maxWidth?: number;
  /** Hand-drawn rules and backgrounds. */
  sketch?: SketchOptions | null;
}

/** Lays out one cell's spans within `maxWidth` logical units. */
export type CellFactory = (spans: InlineSpan[], fontSize: number, maxWidth: number) => Promise<Mobject>;

function rectangle(x: number, y: number, width: number, height: number, color: string, opacity: number, o: Required<Pick<TableOptions, 'sketch'>>): Mobject {
  const center: [number, number, number] = [x + width / 2, y - height / 2, 0];
  if (o.sketch) {
    const rect = sketch.rectangle(width, height, { ...o.sketch, color, strokeWidth: 0, fillColor: color, fillOpacity: opacity, fillStyle: o.sketch.fillStyle ?? 'solid' });
    rect.moveTo(center);
    return rect;
  }
  const rect = new Rectangle({ width, height });
  rect.setStyle({ strokeColor: color, strokeWidth: 0 });
  rect.setFill(color, opacity);
  rect.moveTo(center);
  return rect;
}

function rule(start: number[], end: number[], color: string, width: number, o: Required<Pick<TableOptions, 'sketch'>>): Mobject {
  if (o.sketch) return sketch.line(start, end, { ...o.sketch, color, strokeWidth: width, fillOpacity: 0 });
  return new Line({ start: [start[0], start[1], 0], end: [end[0], end[1], 0], color, strokeWidth: width });
}

/** Build a table as a group centered at the origin; `rows` holds the cells' spans, header first. */
export async function buildTable(rows: InlineSpan[][][], options: TableOptions, cell: CellFactory): Promise<Mobject> {
  if (!rows.length) throw new Error('A table needs at least one row');
  const columns = Math.max(...rows.map((row) => row.length));
  const padding = options.padding ?? 0.15;
  const paddingX = options.paddingX ?? padding;
  const paddingY = options.paddingY ?? padding;
  const header = options.header ?? true;
  const rules = options.rules ?? 'all';
  const borderColor = options.borderColor ?? options.color;
  const strokeWidth = options.strokeWidth ?? 1.5;
  const headerOpacity = options.headerOpacity ?? 0.12;
  const stripeOpacity = options.stripeOpacity ?? 0;
  const sketchy = { sketch: options.sketch ?? null };
  const valign = options.valign ?? 'baseline';
  if (!TABLE_RULES.includes(rules)) throw new Error(`Unknown table rules ${JSON.stringify(rules)}`);
  if (!TABLE_VALIGNS.includes(valign)) throw new Error(`Unknown table valign ${JSON.stringify(valign)}`);
  if (!(paddingX >= 0 && paddingY >= 0)) throw new Error('Table padding must be nonnegative');
  const given = options.columnWidths ?? [];
  if (given.length > 1 && given.length !== columns) throw new Error(`col_width gives ${given.length} widths for ${columns} columns`);
  const fixed = Array.from({ length: columns }, (_, j) => (given.length === 1 ? given[0] : given[j]) ?? null);
  if (fixed.some((w) => w !== null && !(w > 0))) throw new Error('Column widths must be positive');
  const lineHeight = (options.fontSize / 72) * 1.3;
  // Natural widths first: every cell on one line, except in a column of fixed width, whose cells
  // wrap to it, never narrower than a line height, so that a short entry keeps its size and a
  // column too narrow for it and its padding widens.
  const fixedTargets = fixed.map((w) => (w === null ? null : Math.max(w - 2 * paddingX, lineHeight)));
  const render = async (targets: ReadonlyArray<number | null>): Promise<Mobject[][]> =>
    Promise.all(rows.map((row) => Promise.all(Array.from({ length: columns }, (_, j) => {
      const spans = row[j] ?? [];
      return spans.some((s) => s.content.trim()) ? cell(spans, options.fontSize, targets[j] ?? 1000) : Promise.resolve(new Group());
    }))));
  let cells = await render(fixedTargets);
  // A column of natural width is at least a line height wide, so that an empty one still shows.
  const measure = (j: number, floor: number) => Math.max(floor, ...cells.map((row) => row[j].getWidth()));
  let contentWidths = fixed.map((w, j) => measure(j, w === null ? lineHeight : 0));
  const widthOf = (j: number) => (fixed[j] === null ? contentWidths[j] + 2 * paddingX : Math.max(fixed[j] as number, contentWidths[j] + 2 * paddingX));
  const natural = fixed.flatMap((w, j) => (w === null ? [j] : []));
  const total = contentWidths.reduce((sum, _, j) => sum + widthOf(j), 0);
  if (options.maxWidth !== undefined && total > options.maxWidth && natural.length) {
    // Shrink the columns of natural width proportionally and wrap their text; fixed ones keep theirs.
    const kept = fixed.reduce((sum: number, w, j) => sum + (w === null ? 0 : widthOf(j)), 0);
    const available = Math.max(natural.length * lineHeight, options.maxWidth - kept - 2 * paddingX * natural.length);
    const factor = available / natural.reduce((sum, j) => sum + contentWidths[j], 0);
    const targets = fixedTargets.map((target, j) => (fixed[j] === null ? Math.max(lineHeight, contentWidths[j] * factor) : target));
    cells = await render(targets);
    contentWidths = targets.map((target, j) => Math.max(fixed[j] === null ? (target as number) : 0, ...cells.map((row) => row[j].getWidth())));
  }
  const columnWidths = contentWidths.map((_, j) => widthOf(j));
  // How far each cell reaches above and below its first baseline: on the baseline, a row is as
  // tall as its tallest reach above plus its deepest below, so that a formula or a descender
  // never leaves the row.
  const reach = cells.map((row) => row.map((obj) => {
    if (obj.getWidth() <= 0) return null;
    const base = baselineY(obj);
    return { above: obj.getTop()[1] - base, below: base - obj.getBottom()[1] };
  }));
  const rowReach = reach.map((row) => ({
    above: Math.max(0, ...row.map((r) => r?.above ?? 0)),
    below: Math.max(0, ...row.map((r) => r?.below ?? 0)),
  }));
  // A row is as tall as its text, and a row of empty cells a line height, plus the padding.
  const rowHeights = cells.map((row, i) => {
    if (row.every((obj) => obj.getWidth() <= 0)) return lineHeight + 2 * paddingY;
    const content = valign === 'baseline' ? rowReach[i].above + rowReach[i].below : Math.max(0, ...row.map((obj) => obj.getHeight()));
    return content + 2 * paddingY;
  });
  const width = columnWidths.reduce((sum, w) => sum + w, 0);
  const height = rowHeights.reduce((sum, h) => sum + h, 0);
  const xs = [0];
  for (const w of columnWidths) xs.push(xs[xs.length - 1] + w);
  const ys = [0];
  for (const h of rowHeights) ys.push(ys[ys.length - 1] - h);
  const members: Mobject[] = [];
  if ((options.fillOpacity ?? 0) > 0) members.push(rectangle(0, 0, width, height, options.fillColor ?? borderColor, options.fillOpacity as number, sketchy));
  if (header && headerOpacity > 0) members.push(rectangle(0, 0, width, rowHeights[0], options.headerColor ?? borderColor, headerOpacity, sketchy));
  if (stripeOpacity > 0) {
    for (let i = header ? 2 : 1; i < rows.length; i += 2) members.push(rectangle(0, ys[i], width, rowHeights[i], borderColor, stripeOpacity, sketchy));
  }
  const horizontal = rules === 'all' || rules === 'rows';
  const vertical = rules === 'all' || rules === 'cols';
  // Rows and columns may have rules of their own color and width; a rule of width 0 is not drawn.
  const rowColor = options.rowRuleColor ?? borderColor;
  const rowWidth = options.rowRuleWidth ?? strokeWidth;
  const colColor = options.colRuleColor ?? borderColor;
  const colWidth = options.colRuleWidth ?? strokeWidth;
  if (rules !== 'none') {
    // Column rules first, so that where they cross, the row rules lie on top.
    for (let j = 0; j <= columns && colWidth > 0; j += 1) {
      const outer = j === 0 || j === columns;
      if (vertical || outer) members.push(rule([xs[j], 0], [xs[j], -height], colColor, colWidth, sketchy));
    }
    for (let i = 0; i <= rows.length && rowWidth > 0; i += 1) {
      const outer = i === 0 || i === rows.length;
      if (horizontal || outer) members.push(rule([0, ys[i]], [width, ys[i]], rowColor, rowWidth, sketchy));
    }
  }
  cells.forEach((row, i) => {
    row.forEach((obj, j) => {
      if (obj.getWidth() <= 0) return;
      const align = options.aligns?.[j] ?? 'left';
      const x = align === 'left' ? xs[j] + paddingX + obj.getWidth() / 2
        : align === 'right' ? xs[j + 1] - paddingX - obj.getWidth() / 2
        : (xs[j] + xs[j + 1]) / 2;
      obj.moveTo([x, (ys[i] + ys[i + 1]) / 2, 0]);
      if (valign === 'baseline') {
        // The row's shared baseline, with its content centered in the row.
        const { above, below } = rowReach[i];
        const slack = rowHeights[i] - 2 * paddingY - (above + below);
        obj.shift([0, ys[i] - paddingY - slack / 2 - above - baselineY(obj), 0]);
      } else if (valign === 'top') obj.shift([0, ys[i] - paddingY - obj.getTop()[1], 0]);
      else if (valign === 'bottom') obj.shift([0, ys[i + 1] + paddingY - obj.getBottom()[1], 0]);
      members.push(obj);
    });
  });
  const group = new Group(...members);
  group.center();
  return group;
}
