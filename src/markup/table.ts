/**
 * Tables for markup slides: cells of styled prose and math in a grid of
 * rules, with optional backgrounds for the whole table, the header row and
 * alternate rows. Columns take their natural width and shrink, wrapping their
 * text, when the table would exceed the available width.
 */
import { Group, Line, Rectangle, type Mobject } from 'manim-web';
import type { InlineSpan } from './ast';
import { sketch, type SketchOptions } from '../sketch';

export const TABLE_RULES = ['all', 'rows', 'cols', 'outer', 'none'] as const;
export type TableRules = (typeof TABLE_RULES)[number];
export type CellAlign = 'left' | 'center' | 'right';

export interface TableOptions {
  /** Text size in points; the layout's font size by default. */
  fontSize: number;
  /** Text color and default rule color. */
  color: string;
  /** Column alignments; left where missing. */
  aligns?: CellAlign[];
  /** Whether the first row is a header; true by default. */
  header?: boolean;
  /** Space between a cell's text and its rules, in logical units; 0.15 by default. */
  padding?: number;
  /** Which rules to draw; all by default. */
  rules?: TableRules;
  borderColor?: string;
  /** Width of the rules in engine units; 1.5 by default. */
  strokeWidth?: number;
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
  const header = options.header ?? true;
  const rules = options.rules ?? 'all';
  const borderColor = options.borderColor ?? options.color;
  const strokeWidth = options.strokeWidth ?? 1.5;
  const headerOpacity = options.headerOpacity ?? 0.12;
  const stripeOpacity = options.stripeOpacity ?? 0;
  const sketchy = { sketch: options.sketch ?? null };
  if (!TABLE_RULES.includes(rules)) throw new Error(`Unknown table rules ${JSON.stringify(rules)}`);
  if (!(padding >= 0)) throw new Error('Table padding must be nonnegative');
  const lineHeight = (options.fontSize / 72) * 1.3;
  // Natural widths first: every cell on one line.
  const render = async (widths: number[] | null): Promise<Mobject[][]> =>
    Promise.all(rows.map((row) => Promise.all(Array.from({ length: columns }, (_, j) => {
      const spans = row[j] ?? [];
      return spans.some((s) => s.content.trim()) ? cell(spans, options.fontSize, widths ? widths[j] : 1000) : Promise.resolve(new Group());
    }))));
  let cells = await render(null);
  let contentWidths = Array.from({ length: columns }, (_, j) => Math.max(lineHeight, ...cells.map((row) => row[j].getWidth())));
  const total = contentWidths.reduce((sum, w) => sum + w + 2 * padding, 0);
  if (options.maxWidth !== undefined && total > options.maxWidth) {
    // Shrink the columns proportionally and wrap their text.
    const available = Math.max(columns * lineHeight, options.maxWidth - 2 * padding * columns);
    const factor = available / contentWidths.reduce((sum, w) => sum + w, 0);
    const targets = contentWidths.map((w) => Math.max(lineHeight, w * factor));
    cells = await render(targets);
    contentWidths = targets.map((w, j) => Math.max(w, ...cells.map((row) => row[j].getWidth())));
  }
  const columnWidths = contentWidths.map((w) => w + 2 * padding);
  const rowHeights = cells.map((row) => Math.max(lineHeight, ...row.map((obj) => obj.getHeight())) + 2 * padding);
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
  if (rules !== 'none') {
    for (let i = 0; i <= rows.length; i += 1) {
      const outer = i === 0 || i === rows.length;
      if (horizontal || outer) members.push(rule([0, ys[i]], [width, ys[i]], borderColor, strokeWidth, sketchy));
    }
    for (let j = 0; j <= columns; j += 1) {
      const outer = j === 0 || j === columns;
      if (vertical || outer) members.push(rule([xs[j], 0], [xs[j], -height], borderColor, strokeWidth, sketchy));
    }
  }
  cells.forEach((row, i) => {
    row.forEach((obj, j) => {
      if (obj.getWidth() <= 0) return;
      const align = options.aligns?.[j] ?? 'left';
      const x = align === 'left' ? xs[j] + padding + obj.getWidth() / 2
        : align === 'right' ? xs[j + 1] - padding - obj.getWidth() / 2
        : (xs[j] + xs[j + 1]) / 2;
      obj.moveTo([x, (ys[i] + ys[i + 1]) / 2, 0]);
      members.push(obj);
    });
  });
  const group = new Group(...members);
  group.center();
  return group;
}
