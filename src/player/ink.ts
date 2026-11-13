/**
 * Ink: pen and highlighter strokes as sampled paths with pressure, drawn as
 * filled variable-width outlines. A surface keeps the strokes of one drawing
 * area (a slide, or the whiteboard) with its own undo history and, for the
 * whiteboard, a pan offset over an unbounded plane.
 *
 * Coordinates are "surface units": the highlight overlay's viewBox, 1000
 * units tall whatever the screen size, so strokes keep their place and
 * relative width when the window is resized or mirrored on another device.
 */
import { getStroke } from 'perfect-freehand';

export type InkTool = 'pen' | 'highlighter';

export interface InkSample {
  x: number;
  y: number;
  /** Pressure in 0..1; 0.5 when the device reports none. */
  p: number;
}

export interface InkStroke {
  id: string;
  tool: InkTool;
  color: string;
  /** Full width in surface units. */
  size: number;
  /** True when the samples carry real pressure; otherwise width follows speed when the style asks for it. */
  pressure: boolean;
  samples: InkSample[];
}

export type PenPreset = 'ballpoint' | 'fountain' | 'marker' | 'brush' | 'custom';

/** How pressure and motion shape a pen stroke. */
export interface PenStyle {
  preset: PenPreset;
  /** How much pressure thins or thickens the line, -1..1 (0: constant width). */
  thinning: number;
  /** Softening of the outline, 0..1. */
  smoothing: number;
  /** How much the path lags behind the pointer to steady the hand, 0..1. */
  streamline: number;
  /** Thin the stroke towards its ends. */
  taper: boolean;
  /** Derive pressure from speed for devices without a pressure sensor. */
  simulatePressure: boolean;
  /**
   * How much a real pressure sensor counts: the reported pressure is multiplied by this before
   * shaping the line. Below one, a pencil draws lighter; mouse strokes, whose pressure is
   * simulated from speed, are not affected.
   */
  pencilPressure: number;
  /** Width of a pencil stroke relative to the tip size; a pencil draws finer than a mouse at the same tip. */
  pencilWidth: number;
}

export const PEN_PRESETS: Record<Exclude<PenPreset, 'custom'>, Omit<PenStyle, 'preset'>> = {
  ballpoint: { thinning: 0.25, smoothing: 0.5, streamline: 0.45, taper: false, simulatePressure: true, pencilPressure: 0.6, pencilWidth: 0.6 },
  fountain: { thinning: 0.65, smoothing: 0.55, streamline: 0.5, taper: true, simulatePressure: true, pencilPressure: 0.6, pencilWidth: 0.6 },
  marker: { thinning: 0, smoothing: 0.6, streamline: 0.5, taper: false, simulatePressure: false, pencilPressure: 0.6, pencilWidth: 0.6 },
  brush: { thinning: 0.8, smoothing: 0.4, streamline: 0.6, taper: true, simulatePressure: true, pencilPressure: 0.6, pencilWidth: 0.6 },
};

export const PEN_PRESET_LABELS: Record<PenPreset, string> = {
  ballpoint: 'Ballpoint', fountain: 'Fountain pen', marker: 'Marker', brush: 'Brush', custom: 'Custom',
};

export const DEFAULT_PEN_STYLE: PenStyle = { preset: 'ballpoint', ...PEN_PRESETS.ballpoint };

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** A valid pen style from saved or remote data, falling back to the default field by field. */
export function sanitizePenStyle(value: unknown): PenStyle {
  const saved = (value ?? {}) as Partial<PenStyle>;
  const preset = saved.preset && saved.preset in PEN_PRESET_LABELS ? saved.preset : DEFAULT_PEN_STYLE.preset;
  return {
    preset,
    thinning: clamp(saved.thinning, -1, 1, DEFAULT_PEN_STYLE.thinning),
    smoothing: clamp(saved.smoothing, 0, 1, DEFAULT_PEN_STYLE.smoothing),
    streamline: clamp(saved.streamline, 0, 1, DEFAULT_PEN_STYLE.streamline),
    taper: typeof saved.taper === 'boolean' ? saved.taper : DEFAULT_PEN_STYLE.taper,
    simulatePressure: typeof saved.simulatePressure === 'boolean' ? saved.simulatePressure : DEFAULT_PEN_STYLE.simulatePressure,
    pencilPressure: clamp(saved.pencilPressure, 0.1, 2, DEFAULT_PEN_STYLE.pencilPressure),
    pencilWidth: clamp(saved.pencilWidth, 0.2, 2, DEFAULT_PEN_STYLE.pencilWidth),
  };
}

const fmt = (value: number): string => (Math.round(value * 100) / 100).toString();

/** SVG path data of a closed outline, with quadratic segments through the midpoints for a smooth edge. */
export function outlinePath(points: number[][]): string {
  if (points.length === 0) return '';
  if (points.length < 3) {
    const [x, y] = points[0];
    return `M ${fmt(x)} ${fmt(y)} Z`;
  }
  const parts = [`M ${fmt(points[0][0])} ${fmt(points[0][1])} Q`];
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    parts.push(`${fmt(x0)} ${fmt(y0)} ${fmt((x0 + x1) / 2)} ${fmt((y0 + y1) / 2)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

/** Largest gap between consecutive points of a pressure stroke before the curve is subdivided. */
const RESAMPLE_GAP = 3;

/**
 * Fill the gaps of a fast stroke with points on a Catmull-Rom curve through its samples, so the
 * outline stays round where the hand moved faster than the device sampled. Pressure is
 * interpolated. Only for strokes whose width does not come from the spacing of their points.
 */
export function resample(samples: InkSample[], maxGap = RESAMPLE_GAP): InkSample[] {
  if (samples.length < 3) return samples;
  const out: InkSample[] = [samples[0]];
  for (let i = 0; i < samples.length - 1; i++) {
    const p0 = samples[Math.max(0, i - 1)];
    const p1 = samples[i];
    const p2 = samples[i + 1];
    const p3 = samples[Math.min(samples.length - 1, i + 2)];
    const gap = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.min(12, Math.ceil(gap / maxGap));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ x, y, p: p1.p + (p2.p - p1.p) * t });
    }
    out.push(p2);
  }
  return out;
}

/** The filled outline of a stroke under a pen style; `complete` closes the end cap once the pointer is up. */
export function strokeOutline(stroke: InkStroke, style: PenStyle, complete = true): string {
  const pen = stroke.tool === 'pen';
  const gain = stroke.pressure ? style.pencilPressure : 1;
  const simulated = pen && !stroke.pressure && style.simulatePressure;
  const samples = simulated ? stroke.samples : resample(stroke.samples);
  const points = samples.map((sample) => [sample.x, sample.y, Math.min(1, sample.p * gain)]);
  const outline = getStroke(points, {
    size: stroke.size * (pen && stroke.pressure ? style.pencilWidth : 1),
    thinning: pen ? style.thinning : 0,
    smoothing: pen ? style.smoothing : 0.5,
    // A pressure pen reports dense, precise positions: half the steadying keeps it close to the tip.
    streamline: pen ? style.streamline * (stroke.pressure ? 0.5 : 1) : 0.5,
    simulatePressure: simulated,
    easing: (t) => t,
    start: { taper: pen && style.taper, cap: true },
    end: { taper: pen && style.taper, cap: true },
    last: complete,
  });
  return outlinePath(outline);
}

let nextStrokeId = 1;

/** A unique stroke ID; the prefix tells devices apart when strokes are mirrored. */
export function newStrokeId(prefix = 'local'): string {
  return `${prefix}-${Date.now().toString(36)}-${(nextStrokeId++).toString(36)}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Entry {
  stroke: InkStroke;
  path: SVGPathElement;
  complete: boolean;
  /** Wall-clock time the stroke started, to tell the dots of a double-click apart from real strokes. */
  started: number;
}

/** One step of a surface's history: a stroke added, or one erased from a given position. */
type Action = { kind: 'add'; stroke: InkStroke } | { kind: 'erase'; stroke: InkStroke; index: number };

/** Squared distance from a point to a segment. */
function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return x * x + y * y;
}

/**
 * The strokes of one drawing area, drawn into an SVG group, with undo, redo,
 * clear and erasing. Strokes coming from another device join the same
 * history, which stays identical on both as long as every step is mirrored.
 */
export class InkSurface {
  readonly group: SVGGElement;
  private readonly _entries = new Map<string, Entry>();
  private _order: string[] = [];
  private _done: Action[] = [];
  private _undone: Action[] = [];
  private readonly _dirty = new Set<string>();
  private _frame: number | null = null;
  private _pan = { x: 0, y: 0 };

  constructor(parent: SVGElement, private readonly style: () => PenStyle, className = 'ink') {
    this.group = document.createElementNS(SVG_NS, 'g');
    this.group.setAttribute('class', className);
    parent.append(this.group);
  }

  get strokes(): InkStroke[] {
    return this._order.map((id) => (this._entries.get(id) as Entry).stroke);
  }

  get pan(): { x: number; y: number } {
    return { ...this._pan };
  }

  /** Scroll the surface so that surface point (x, y) sits at the overlay's origin. */
  setPan(x: number, y: number): void {
    this._pan = { x, y };
    this.group.setAttribute('transform', `translate(${fmt(-x)} ${fmt(-y)})`);
  }

  has(id: string): boolean {
    return this._entries.has(id);
  }

  private _insert(stroke: InkStroke, index: number, complete: boolean): void {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', stroke.tool);
    path.setAttribute('fill', stroke.color);
    const at = Math.max(0, Math.min(index, this._order.length));
    const next = at < this._order.length ? (this._entries.get(this._order[at]) as Entry).path : null;
    this.group.insertBefore(path, next);
    this._entries.set(stroke.id, { stroke, path, complete, started: performance.now() });
    this._order.splice(at, 0, stroke.id);
    this._mark(stroke.id);
  }

  private _remove(id: string): { stroke: InkStroke; index: number } | null {
    const entry = this._entries.get(id);
    const index = this._order.indexOf(id);
    if (!entry || index < 0) return null;
    entry.path.remove();
    this._entries.delete(id);
    this._order.splice(index, 1);
    this._dirty.delete(id);
    return { stroke: entry.stroke, index };
  }

  /** Start a stroke; a new stroke discards the redo history. */
  begin(stroke: InkStroke): void {
    if (this._entries.has(stroke.id)) return;
    // The surface's own copy: extending it must not touch the caller's stroke, which a recording
    // being replayed hands over again at every seek (and an export at every frame).
    const own = { ...stroke, samples: [...stroke.samples] };
    this._insert(own, this._order.length, false);
    this._done.push({ kind: 'add', stroke: own });
    this._undone = [];
  }

  extend(id: string, samples: InkSample[]): void {
    const entry = this._entries.get(id);
    if (!entry || entry.complete || samples.length === 0) return;
    entry.stroke.samples.push(...samples);
    this._mark(id);
  }

  end(id: string): void {
    const entry = this._entries.get(id);
    if (!entry || entry.complete) return;
    entry.complete = true;
    this._mark(id);
  }

  /**
   * Mark a stroke as carrying real pressure. Safari's first pencil event often reports none,
   * so a stroke may start as a speed-simulated one and learn better from its next samples.
   */
  setPressure(id: string, pressure: boolean): void {
    const entry = this._entries.get(id);
    if (!entry || entry.stroke.pressure === pressure) return;
    entry.stroke.pressure = pressure;
    this._mark(id);
  }

  /** Finish every stroke still open (the pointer was lost). */
  endAll(): void {
    for (const id of this._order) this.end(id);
  }

  /** Take out one stroke (a fingertip rubbed it); undo brings it back where it was. */
  erase(id: string): InkStroke | null {
    const removed = this._remove(id);
    if (!removed) return null;
    this._done.push({ kind: 'erase', stroke: removed.stroke, index: removed.index });
    this._undone = [];
    return removed.stroke;
  }

  /** The topmost stroke whose path passes within `tolerance` of a surface point, if any. */
  strokeAt(x: number, y: number, tolerance: number): string | null {
    for (let i = this._order.length - 1; i >= 0; i--) {
      const { stroke } = this._entries.get(this._order[i]) as Entry;
      const reach = tolerance + stroke.size / 2;
      const reach2 = reach * reach;
      const points = stroke.samples;
      if (points.length === 1) {
        const dx = points[0].x - x;
        const dy = points[0].y - y;
        if (dx * dx + dy * dy <= reach2) return stroke.id;
        continue;
      }
      for (let k = 1; k < points.length; k++) {
        if (segmentDistance2(x, y, points[k - 1].x, points[k - 1].y, points[k].x, points[k].y) <= reach2) return stroke.id;
      }
    }
    return null;
  }

  /** Take back the last step: a stroke added goes away, a stroke erased comes back. */
  undo(): InkStroke | null {
    const action = this._done.pop();
    if (!action) return null;
    if (action.kind === 'add') this._remove(action.stroke.id);
    else this._insert(action.stroke, action.index, true);
    this._undone.push(action);
    return action.stroke;
  }

  /** Replay the last step taken back. */
  redo(): InkStroke | null {
    const action = this._undone.pop();
    if (!action) return null;
    if (action.kind === 'add') this._insert(action.stroke, this._order.length, true);
    else this._remove(action.stroke.id);
    this._done.push(action);
    return action.stroke;
  }

  /** Erase every stroke, newest first; redo restores them one by one. */
  clear(): InkStroke[] {
    const removed: InkStroke[] = [];
    for (const id of [...this._order].reverse()) {
      const stroke = this.erase(id);
      if (stroke) removed.push(stroke);
    }
    return removed;
  }

  /** Drop the newest strokes when they are single taps made within `maxAge` ms (a double-click's dots); returns how many went. */
  dropRecentTaps(count: number, maxAge: number): number {
    const now = performance.now();
    let dropped = 0;
    for (; dropped < count && this._order.length; dropped++) {
      const entry = this._entries.get(this._order[this._order.length - 1]) as Entry;
      const last = this._done[this._done.length - 1];
      if (entry.stroke.samples.length > 3 || now - entry.started > maxAge || last?.kind !== 'add' || last.stroke.id !== entry.stroke.id) break;
      this.undo();
      this._undone.pop();
    }
    return dropped;
  }

  /** Replace the whole content (the state received from another device). */
  replace(strokes: InkStroke[]): void {
    this.reset();
    for (const stroke of strokes) {
      this.begin(stroke);
      this.end(stroke.id);
    }
  }

  /** Forget everything, including the history. */
  reset(): void {
    for (const entry of this._entries.values()) entry.path.remove();
    this._entries.clear();
    this._order = [];
    this._done = [];
    this._undone = [];
    this._dirty.clear();
  }

  /** Redraw every stroke (the pen style changed). */
  restyle(): void {
    for (const id of this._order) this._mark(id);
  }

  private _mark(id: string): void {
    this._dirty.add(id);
    if (this._frame !== null) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this.flush();
    });
  }

  /**
   * Draw a live stroke now, with a few predicted samples appended to its tip (not stored:
   * the next real samples replace them). Keeps the line under the pen instead of a frame behind.
   */
  drawLive(id: string, predicted: InkSample[] = []): void {
    const entry = this._entries.get(id);
    if (!entry || entry.complete) return;
    const stroke = predicted.length ? { ...entry.stroke, samples: [...entry.stroke.samples, ...predicted] } : entry.stroke;
    entry.path.setAttribute('d', strokeOutline(stroke, this.style(), false));
    this._dirty.delete(id);
  }

  /** Draw the pending changes now instead of at the next animation frame. */
  flush(): void {
    const style = this.style();
    for (const id of this._dirty) {
      const entry = this._entries.get(id);
      if (entry) entry.path.setAttribute('d', strokeOutline(entry.stroke, style, entry.complete));
    }
    this._dirty.clear();
  }
}
