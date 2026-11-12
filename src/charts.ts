/**
 * Charts built from vector shapes: grouped bars, lines with markers and pies,
 * with axes, gridlines, tick labels, category labels, value labels and a
 * legend. Text is produced by a caller-supplied factory so that charts use
 * the deck's typography; everything else is ordinary geometry, crisp or
 * hand-drawn, which fades, animates and exports like any shape.
 */
import { Group, Line, Polygon, Rectangle, VMobject, type Mobject } from 'manim-web';
import { arcPath, pathMobject } from './paths';
import { sketch, type SketchOptions } from './sketch';

export const CHART_TYPES = ['bar', 'line', 'pie'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartData {
  /** Category labels, one per value of each series. */
  categories: string[];
  series: ChartSeries[];
}

/** Colors given to successive series (bars, lines) or slices. */
export const CHART_COLORS = ['#2F6DB5', '#3A9D5D', '#E08A2E', '#8E59B5', '#D23F3F', '#2AA198', '#B8860B', '#6C7A89'];

export interface ChartOptions {
  type?: ChartType;
  /** Size of the plot area (bars, lines) or of the box the pie fits in; 6 × 3.5 by default. */
  width?: number;
  height?: number;
  /** Series colors; `CHART_COLORS` by default. */
  colors?: string[];
  /** Color of axes, ticks and text; black by default. */
  color?: string;
  /** Color of axes and gridlines when different from the text color. */
  axisColor?: string;
  /** Outline color of bars and slices; each one's own color by default. */
  borderColor?: string;
  /** Opacity of bar and slice fills; 0.85 by default. */
  fillOpacity?: number;
  /** Width of series lines and bar outlines, in engine units; 2 by default. */
  strokeWidth?: number;
  /** Text size in points handed to the label factory; 18 by default. */
  fontSize?: number;
  /** Horizontal gridlines at the ticks; on by default for bars and lines. */
  grid?: boolean;
  /** A legend above the plot; on by default when there are several series. */
  legend?: boolean;
  /** Value labels on bars and points, or percentages on slices (always on for pies). */
  values?: boolean;
  /** Fixed value-axis bounds. */
  min?: number;
  max?: number;
  /** Hand-drawn rendering of bars, lines, slices and axes. */
  sketch?: SketchOptions | null;
}

/** Makes a text label of `size` points in `color`; charts place it by its center. */
export type LabelFactory = (text: string, size: number, color: string) => Promise<Mobject>;

/**
 * Parse comma-, semicolon- or tab-separated rows. The first row names the
 * series (its first cell, the category column, is ignored) unless its cells
 * after the first are plain numbers, in which case there is one unnamed
 * series per column; years such as 2023 still count as names. `header`
 * forces either reading. Each later row is a category followed by one value
 * per series.
 */
export function parseChartData(source: string, header?: boolean): ChartData {
  const rows = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',').map((cell) => cell.trim()));
  if (!rows.length) throw new Error('A chart needs at least one row of data');
  const numeric = (cell: string) => cell !== '' && Number.isFinite(Number(cell));
  const yearLike = (cell: string) => /^\d{4}$/.test(cell) && Number(cell) >= 1900 && Number(cell) <= 2100;
  const first = rows[0].slice(1);
  const headed = header ?? (first.length > 0 && (!first.every(numeric) || (rows.length > 1 && first.every(yearLike))));
  const headerRow = headed ? rows[0] : null;
  const body = headed ? rows.slice(1) : rows;
  if (!body.length) throw new Error('A chart needs at least one row of values');
  const columns = Math.max(...body.map((row) => row.length)) - 1;
  if (columns < 1) throw new Error('Each chart row needs a category followed by at least one value');
  const categories = body.map((row) => row[0]);
  const series: ChartSeries[] = [];
  for (let j = 0; j < columns; j += 1) {
    const values = body.map((row, i) => {
      const cell = row[j + 1] ?? '';
      if (!numeric(cell)) throw new Error(`Row ${i + 1} (${row[0] || 'unnamed'}): value ${j + 1} is not a number`);
      return Number(cell);
    });
    series.push({ name: headerRow?.[j + 1] ?? '', values });
  }
  return { categories, series };
}

interface Resolved extends Required<Omit<ChartOptions, 'min' | 'max' | 'axisColor' | 'borderColor' | 'sketch' | 'legend'>> {
  min: number | undefined;
  max: number | undefined;
  axisColor: string;
  borderColor: string | undefined;
  legend: boolean;
  sketch: SketchOptions | null;
}

function resolve(options: ChartOptions, data: ChartData): Resolved {
  const type = options.type ?? 'bar';
  if (!CHART_TYPES.includes(type)) throw new Error(`Unknown chart type ${JSON.stringify(type)}`);
  const color = options.color ?? '#000000';
  const resolved: Resolved = {
    type,
    width: options.width ?? 6,
    height: options.height ?? 3.5,
    colors: options.colors?.length ? options.colors : CHART_COLORS,
    color,
    axisColor: options.axisColor ?? color,
    borderColor: options.borderColor,
    fillOpacity: options.fillOpacity ?? 0.85,
    strokeWidth: options.strokeWidth ?? 2,
    fontSize: options.fontSize ?? 18,
    grid: options.grid ?? true,
    legend: options.legend ?? data.series.length > 1,
    values: options.values ?? false,
    min: options.min,
    max: options.max,
    sketch: options.sketch ?? null,
  };
  for (const key of ['width', 'height', 'fontSize'] as const) {
    if (!Number.isFinite(resolved[key]) || resolved[key] <= 0) throw new Error(`Chart ${key} must be positive`);
  }
  if (resolved.fillOpacity < 0 || resolved.fillOpacity > 1) throw new Error('Chart fillOpacity must be between zero and one');
  if (resolved.min !== undefined && resolved.max !== undefined && resolved.max <= resolved.min) throw new Error('Chart max must exceed min');
  return resolved;
}

/** A "nice" tick step (1, 2 or 5 times a power of ten) for roughly `count` intervals over `span`. */
export function niceStep(span: number, count = 4): number {
  const raw = Math.abs(span) / count || 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / magnitude;
  return (unit < 1.5 ? 1 : unit < 3 ? 2 : unit < 7 ? 5 : 10) * magnitude;
}

/** Value-axis bounds snapped to tick steps, always including zero unless fixed. */
export function valueAxis(values: number[], min?: number, max?: number): { lo: number; hi: number; step: number } {
  let lo = min ?? Math.min(0, ...values);
  let hi = max ?? Math.max(0, ...values);
  if (hi <= lo) hi = lo + 1;
  const step = niceStep(hi - lo);
  if (min === undefined) lo = Math.floor(lo / step + 1e-9) * step;
  if (max === undefined) hi = Math.ceil(hi / step - 1e-9) * step;
  if (hi <= lo) hi = lo + step;
  return { lo, hi, step };
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function strokeLine(start: number[], end: number[], color: string, width: number, o: Resolved, opacity = 1): Mobject {
  if (o.sketch) {
    const line = sketch.line(start, end, { ...o.sketch, color, strokeWidth: width, fillOpacity: 0 });
    if (opacity < 1) line.opacity = opacity;
    return line;
  }
  const line = new Line({ start: [start[0], start[1], 0], end: [end[0], end[1], 0], color, strokeWidth: width });
  if (opacity < 1) line.setStrokeOpacity(opacity);
  return line;
}

function filledRect(x: number, y: number, width: number, height: number, fill: string, outline: string, o: Resolved): Mobject {
  const w = Math.max(width, 1e-6);
  const h = Math.max(Math.abs(height), 1e-6);
  const center: [number, number, number] = [x + w / 2, y + height / 2, 0];
  if (o.sketch) {
    const rect = sketch.rectangle(w, h, { ...o.sketch, color: outline, strokeWidth: o.strokeWidth * 0.75, fillColor: fill, fillOpacity: o.fillOpacity });
    rect.moveTo(center);
    return rect;
  }
  const rect = new Rectangle({ width: w, height: h });
  rect.setStyle({ strokeColor: outline, strokeWidth: o.strokeWidth * 0.75 });
  rect.setFill(fill, o.fillOpacity);
  rect.moveTo(center);
  return rect;
}

/** Place a label's center at `point`, or align one of its edges to it. */
function put(label: Mobject, point: [number, number], align: 'center' | 'right' | 'left' | 'top' | 'bottom' = 'center'): Mobject {
  const [x, y] = point;
  const w = label.getWidth();
  const h = label.getHeight();
  const center: [number, number, number] = [x, y, 0];
  if (align === 'right') center[0] = x - w / 2;
  if (align === 'left') center[0] = x + w / 2;
  if (align === 'top') center[1] = y - h / 2;
  if (align === 'bottom') center[1] = y + h / 2;
  label.moveTo(center);
  return label;
}

async function axes(group: Group, data: ChartData, o: Resolved, label: LabelFactory): Promise<(value: number) => number> {
  const all = data.series.flatMap((s) => s.values);
  const { lo, hi, step } = valueAxis(all, o.min, o.max);
  const y = (value: number) => ((value - lo) / (hi - lo)) * o.height;
  const tickSize = o.fontSize * 0.8;
  for (let value = lo; value <= hi + step * 1e-6; value += step) {
    const level = y(value);
    if (o.grid && level > 1e-6 && level < o.height - 1e-6) group.add(strokeLine([0, level], [o.width, level], o.axisColor, 1, o, 0.25));
    group.add(strokeLine([-0.08, level], [0, level], o.axisColor, o.strokeWidth, o));
    group.add(put(await label(formatNumber(value), tickSize, o.color), [-0.16, level], 'right'));
  }
  const baseline = y(Math.min(Math.max(0, lo), hi));
  group.add(strokeLine([0, 0], [0, o.height], o.axisColor, o.strokeWidth, o));
  group.add(strokeLine([0, baseline], [o.width, baseline], o.axisColor, o.strokeWidth, o));
  const slot = o.width / data.categories.length;
  for (const [i, category] of data.categories.entries()) {
    if (category) group.add(put(await label(category, tickSize, o.color), [slot * (i + 0.5), -0.14], 'top'));
  }
  return y;
}

async function legend(group: Group, data: ChartData, o: Resolved, label: LabelFactory): Promise<void> {
  if (!o.legend) return;
  const size = o.fontSize * 0.8;
  let x = 0;
  const top = o.height + 0.3;
  for (const [j, series] of data.series.entries()) {
    const swatch = filledRect(x, top, 0.26, 0.26, o.colors[j % o.colors.length], o.borderColor ?? o.colors[j % o.colors.length], o);
    group.add(swatch);
    const text = put(await label(series.name || `Series ${j + 1}`, size, o.color), [x + 0.36, top + 0.13], 'left');
    group.add(text);
    x += 0.36 + text.getWidth() + 0.5;
  }
}

async function bars(group: Group, data: ChartData, o: Resolved, label: LabelFactory): Promise<void> {
  const y = await axes(group, data, o, label);
  const slot = o.width / data.categories.length;
  const groupWidth = slot * 0.72;
  const barWidth = groupWidth / data.series.length;
  const base = y(Math.max(0, Math.min(...data.series.flatMap((s) => s.values), 0)));
  for (const [j, series] of data.series.entries()) {
    const color = o.colors[j % o.colors.length];
    for (const [i, value] of series.values.entries()) {
      const x = slot * i + (slot - groupWidth) / 2 + barWidth * j;
      const top = y(value);
      group.add(filledRect(x, base, barWidth, top - base, color, o.borderColor ?? color, o));
      if (o.values) group.add(put(await label(formatNumber(value), o.fontSize * 0.7, o.color), [x + barWidth / 2, top + (top >= base ? 0.08 : -0.08)], top >= base ? 'bottom' : 'top'));
    }
  }
  await legend(group, data, o, label);
}

async function lines(group: Group, data: ChartData, o: Resolved, label: LabelFactory): Promise<void> {
  const y = await axes(group, data, o, label);
  const slot = o.width / data.categories.length;
  for (const [j, series] of data.series.entries()) {
    const color = o.colors[j % o.colors.length];
    const points = series.values.map((value, i) => [slot * (i + 0.5), y(value), 0]);
    if (points.length > 1) {
      if (o.sketch) group.add(sketch.polyline(points, { ...o.sketch, color, strokeWidth: o.strokeWidth * 1.5, fillOpacity: 0 }));
      else {
        const path = new VMobject().setPointsAsCorners(points);
        path.setStyle({ strokeColor: color, strokeWidth: o.strokeWidth * 1.5 });
        path.setFill(color, 0);
        group.add(path);
      }
    }
    for (const [i, point] of points.entries()) {
      const marker = new Polygon({ vertices: [0, 1, 2, 3, 4, 5].map((k) => [Math.cos((k * Math.PI) / 3) * 0.07, Math.sin((k * Math.PI) / 3) * 0.07, 0]), closed: true });
      marker.setStyle({ strokeColor: color, strokeWidth: o.strokeWidth * 0.5 });
      marker.setFill(color, 1);
      marker.moveTo([point[0], point[1], 0]);
      group.add(marker);
      if (o.values) group.add(put(await label(formatNumber(series.values[i]), o.fontSize * 0.7, o.color), [point[0], point[1] + 0.14], 'bottom'));
    }
  }
  await legend(group, data, o, label);
}

async function pie(group: Group, data: ChartData, o: Resolved, label: LabelFactory): Promise<void> {
  const values = data.series[0].values;
  if (values.some((v) => v < 0)) throw new Error('Pie charts need nonnegative values');
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) throw new Error('Pie charts need a positive total');
  const radius = Math.min(o.width, o.height) * 0.4;
  const [cx, cy] = [o.width / 2, o.height / 2];
  let angle = Math.PI / 2;
  for (const [i, value] of values.entries()) {
    if (value <= 0) continue;
    const sweep = (value / total) * 2 * Math.PI;
    const color = o.colors[i % o.colors.length];
    const outline = o.borderColor ?? color;
    let slice: Mobject;
    if (o.sketch) {
      slice = sketch.arc([cx, cy], radius, angle - sweep, sweep, { ...o.sketch, color: outline, strokeWidth: o.strokeWidth * 0.75, fillColor: color, fillOpacity: o.fillOpacity });
    } else {
      const d = sweep >= 2 * Math.PI - 1e-9
        ? arcPath(cx, cy, radius, 0, 2 * Math.PI)
        : `M${cx},${cy} L${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius} ${arcPath(cx, cy, radius, angle, angle - sweep).replace(/^M[^ ]+ /, '')} Z`;
      const vmob = pathMobject(d, 1, true);
      vmob.setStyle({ strokeColor: outline, strokeWidth: o.strokeWidth * 0.75 });
      vmob.setFill(color, o.fillOpacity);
      slice = vmob;
    }
    group.add(slice);
    const middle = angle - sweep / 2;
    const text = `${data.categories[i]} ${Math.round((value / total) * 100)}%`;
    const align = Math.cos(middle) > 0.2 ? 'left' : Math.cos(middle) < -0.2 ? 'right' : 'center';
    group.add(put(await label(text, o.fontSize * 0.8, o.color), [cx + Math.cos(middle) * radius * 1.12, cy + Math.sin(middle) * radius * 1.12], align));
    angle -= sweep;
  }
}

/** Build a chart as a group centered at the origin. */
export async function buildChart(data: ChartData, options: ChartOptions, label: LabelFactory): Promise<Group> {
  if (!data.series.length || !data.categories.length) throw new Error('A chart needs data');
  const o = resolve(options, data);
  const group = new Group();
  if (o.type === 'bar') await bars(group, data, o, label);
  else if (o.type === 'line') await lines(group, data, o, label);
  else await pie(group, data, o, label);
  group.center();
  return group;
}
