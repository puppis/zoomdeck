/**
 * Diagram icons built from geometry: people, machines, storage, documents and
 * a few other everyday symbols of architecture diagrams.
 *
 * Every icon is a list of parts drawn inside a unit box (coordinates between
 * -0.5 and 0.5, y up), each part being SVG path data plus whether it carries
 * the icon's fill. Parts become ordinary vector mobjects, crisp or hand-drawn,
 * so icons take the same colors, fills, animations and effects as shapes.
 */
import { VGroup } from 'manim-web';
import { sketch, type OutlineMobject, type SketchOptions } from './sketch';
import { circlePath, ellipsePath, pathMobject, rectPath } from './paths';

export const ICON_NAMES = [
  'user', 'users', 'database', 'server', 'client', 'desktop', 'phone', 'cloud', 'document', 'folder', 'lock', 'gear', 'gears', 'message',
  'globe', 'question', 'exclamation', 'info', 'warning', 'check', 'cross', 'download', 'upload', 'puzzle', 'search', 'clock', 'calendar',
  'arrival', 'departure', 'recycle', 'trash', 'pin', 'key', 'shield', 'bolt', 'star', 'chart', 'home', 'flag',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export interface IconPart {
  /** SVG path data inside the unit box, y up. */
  d: string;
  /** Whether the part is a closed silhouette that receives the fill. */
  fill: boolean;
}

export interface IconOptions {
  /** Height of the unit box in logical units; 1 by default. */
  size?: number;
  /** Outline color; black by default. */
  color?: string;
  /** Outline width in engine units; 2 by default. */
  strokeWidth?: number;
  /** Color of the filled parts; the outline color by default. */
  fillColor?: string;
  /** Opacity of the filled parts; 0 by default. */
  fillOpacity?: number;
  /** Hand-drawn rendering options; null or absent for crisp lines. */
  sketch?: SketchOptions | null;
}

const BODY: IconPart[] = [
  { d: circlePath(0, 0.28, 0.17), fill: true },
  { d: 'M-0.4,-0.5 C-0.4,-0.08 -0.2,0.04 0,0.04 C0.2,0.04 0.4,-0.08 0.4,-0.5 Z', fill: true },
];

/** Translate and scale path data of unit-box parts. */
function place(parts: IconPart[], dx: number, dy: number, scale: number): IconPart[] {
  return parts.map((part) => ({
    fill: part.fill,
    d: part.d.replace(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g, (_, x: string, y: string) => `${Number(x) * scale + dx},${Number(y) * scale + dy}`)
      .replace(/([HV])(-?\d*\.?\d+)/g, (_, command: string, value: string) => `${command}${Number(value) * scale + (command === 'H' ? dx : dy)}`),
  }));
}

function gearPath(teeth = 8, outer = 0.5, inner = 0.37): string {
  const steps: string[] = [];
  for (let i = 0; i < teeth; i += 1) {
    const base = (i / teeth) * Math.PI * 2;
    const step = (Math.PI * 2) / teeth;
    // Each tooth: a flank up, the tip, a flank down, then the valley between teeth.
    for (const [radius, fraction] of [[inner, 0.08], [outer, 0.2], [outer, 0.38], [inner, 0.5]] as const) {
      const angle = base + step * fraction;
      steps.push(`${(Math.cos(angle) * radius).toFixed(4)},${(Math.sin(angle) * radius).toFixed(4)}`);
    }
  }
  return `M${steps[0]} L${steps.slice(1).join(' L')} Z`;
}

function starPath(points = 5, outer = 0.5, inner = 0.2): string {
  const steps: string[] = [];
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = Math.PI / 2 + (i * Math.PI) / points;
    steps.push(`${(Math.cos(angle) * radius).toFixed(4)},${(Math.sin(angle) * radius).toFixed(4)}`);
  }
  return `M${steps[0]} L${steps.slice(1).join(' L')} Z`;
}

/** A circular arc from angle `a0` to `a1` (radians, counterclockwise) as cubic curves. */
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const segments = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  const step = (a1 - a0) / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (a: number): [number, number] => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  const fmt = (v: number) => v.toFixed(4);
  let d = `M${fmt(point(a0)[0])},${fmt(point(a0)[1])}`;
  for (let i = 0; i < segments; i += 1) {
    const a = a0 + step * i;
    const b = a + step;
    const [x1, y1] = point(a);
    const [x2, y2] = point(b);
    d += ` C${fmt(x1 - Math.sin(a) * r * k)},${fmt(y1 + Math.cos(a) * r * k)} ${fmt(x2 + Math.sin(b) * r * k)},${fmt(y2 - Math.cos(b) * r * k)} ${fmt(x2)},${fmt(y2)}`;
  }
  return d;
}

/** The three chasing arrows of a recycling symbol: arcs with a small head at each end. */
function recycleParts(): IconPart[] {
  const parts: IconPart[] = [];
  const r = 0.4;
  for (let i = 0; i < 3; i += 1) {
    const a0 = Math.PI / 2 + (i * 2 * Math.PI) / 3 + 0.25;
    const a1 = a0 + (2 * Math.PI) / 3 - 0.55;
    parts.push({ d: arcPath(0, 0, r, a0, a1), fill: false });
    // Arrow head tangent to the arc at its end.
    const [ex, ey] = [Math.cos(a1) * r, Math.sin(a1) * r];
    const [tx, ty] = [-Math.sin(a1), Math.cos(a1)];
    const [nx, ny] = [Math.cos(a1), Math.sin(a1)];
    const tip = [ex + tx * 0.14, ey + ty * 0.14];
    const left = [ex + nx * 0.1, ey + ny * 0.1];
    const right = [ex - nx * 0.1, ey - ny * 0.1];
    const fmt = (v: number) => v.toFixed(4);
    parts.push({ d: `M${fmt(left[0])},${fmt(left[1])} L${fmt(tip[0])},${fmt(tip[1])} L${fmt(right[0])},${fmt(right[1])} Z`, fill: true });
  }
  return parts;
}

const TRAY: IconPart = { d: 'M-0.45,-0.12 V-0.44 H0.45 V-0.12 H0.3 V-0.29 H-0.3 V-0.12 Z', fill: true };
const DOT = (cy: number): IconPart => ({ d: circlePath(0, cy, 0.045), fill: false });

const PARTS: Record<IconName, IconPart[]> = {
  user: BODY,
  users: [...place(BODY, 0.18, 0.05, 0.72), ...place(BODY, -0.14, -0.04, 0.9)],
  database: [
    { d: 'M-0.4,0.3 V-0.33 C-0.4,-0.49 0.4,-0.49 0.4,-0.33 V0.3 C0.4,0.46 -0.4,0.46 -0.4,0.3 Z', fill: true },
    { d: ellipsePath(0, 0.3, 0.4, 0.12), fill: true },
    { d: 'M-0.4,0.07 C-0.4,-0.09 0.4,-0.09 0.4,0.07', fill: false },
    { d: 'M-0.4,-0.15 C-0.4,-0.31 0.4,-0.31 0.4,-0.15', fill: false },
  ],
  server: [
    { d: rectPath(-0.36, -0.5, 0.72, 1, 0.04), fill: true },
    { d: 'M-0.36,0.17 H0.36 M-0.36,-0.17 H0.36', fill: false },
    { d: 'M-0.26,0.34 H-0.02 M-0.26,0 H-0.02 M-0.26,-0.34 H-0.02', fill: false },
    { d: circlePath(0.22, 0.34, 0.035) + circlePath(0.22, 0, 0.035) + circlePath(0.22, -0.34, 0.035), fill: true },
  ],
  client: [
    { d: rectPath(-0.4, -0.18, 0.8, 0.62, 0.05), fill: true },
    { d: rectPath(-0.34, -0.12, 0.68, 0.5), fill: false },
    { d: 'M-0.5,-0.34 H0.5 C0.5,-0.24 0.46,-0.18 0.4,-0.18 H-0.4 C-0.46,-0.18 -0.5,-0.24 -0.5,-0.34 Z', fill: true },
  ],
  desktop: [
    { d: rectPath(-0.5, -0.12, 1, 0.62, 0.04), fill: true },
    { d: rectPath(-0.44, -0.06, 0.88, 0.5), fill: false },
    { d: 'M-0.08,-0.12 V-0.34 H0.08 V-0.12 M-0.3,-0.4 H0.3', fill: false },
  ],
  phone: [
    { d: rectPath(-0.26, -0.5, 0.52, 1, 0.08), fill: true },
    { d: rectPath(-0.2, -0.34, 0.4, 0.7), fill: false },
    { d: 'M-0.07,0.43 H0.07', fill: false },
    { d: circlePath(0, -0.42, 0.04), fill: false },
  ],
  cloud: [
    {
      d: 'M-0.26,-0.32 C-0.48,-0.32 -0.5,0 -0.28,0.02 C-0.3,0.24 -0.02,0.3 0.06,0.14 C0.14,0.36 0.46,0.28 0.4,0.06 '
        + 'C0.56,0.02 0.56,-0.32 0.36,-0.32 Z',
      fill: true,
    },
  ],
  document: [
    { d: 'M-0.36,0.5 H0.14 L0.36,0.28 V-0.5 H-0.36 Z', fill: true },
    { d: 'M0.14,0.5 V0.28 H0.36', fill: false },
    { d: 'M-0.22,0.08 H0.22 M-0.22,-0.08 H0.22 M-0.22,-0.24 H0.22', fill: false },
  ],
  folder: [
    { d: 'M-0.5,-0.38 V0.3 H-0.12 L0,0.4 H0.5 V-0.38 Z', fill: true },
    { d: 'M-0.5,0.14 H0.5', fill: false },
  ],
  lock: [
    { d: rectPath(-0.34, -0.5, 0.68, 0.52, 0.06), fill: true },
    { d: 'M-0.2,0.02 V0.22 C-0.2,0.5 0.2,0.5 0.2,0.22 V0.02', fill: false },
    { d: circlePath(0, -0.22, 0.05), fill: false },
  ],
  gear: [
    { d: gearPath(), fill: true },
    { d: circlePath(0, 0, 0.15), fill: false },
  ],
  message: [
    { d: rectPath(-0.5, -0.34, 1, 0.68, 0.04), fill: true },
    { d: 'M-0.5,0.3 L0,-0.06 L0.5,0.3', fill: false },
  ],
  globe: [
    { d: circlePath(0, 0, 0.5), fill: true },
    { d: ellipsePath(0, 0, 0.22, 0.5), fill: false },
    { d: 'M-0.5,0 H0.5 M-0.433,0.25 H0.433 M-0.433,-0.25 H0.433', fill: false },
  ],
  gears: [
    ...place([{ d: gearPath(8, 0.5, 0.37), fill: true }, { d: circlePath(0, 0, 0.16), fill: false }], -0.16, 0.14, 0.72),
    ...place([{ d: gearPath(6, 0.5, 0.35), fill: true }, { d: circlePath(0, 0, 0.16), fill: false }], 0.3, -0.28, 0.44),
  ],
  question: [
    { d: circlePath(0, 0, 0.5), fill: true },
    { d: 'M-0.16,0.12 C-0.16,0.4 0.18,0.4 0.18,0.14 C0.18,-0.02 0,-0.04 0,-0.18', fill: false },
    DOT(-0.32),
  ],
  exclamation: [{ d: circlePath(0, 0, 0.5), fill: true }, { d: 'M0,0.3 V-0.12', fill: false }, DOT(-0.3)],
  info: [{ d: circlePath(0, 0, 0.5), fill: true }, { d: 'M0,0.1 V-0.32', fill: false }, DOT(0.27)],
  warning: [{ d: 'M0,0.5 L0.5,-0.42 H-0.5 Z', fill: true }, { d: 'M0,0.2 V-0.1', fill: false }, DOT(-0.26)],
  check: [{ d: circlePath(0, 0, 0.5), fill: true }, { d: 'M-0.24,0.02 L-0.08,-0.16 L0.26,0.2', fill: false }],
  cross: [{ d: circlePath(0, 0, 0.5), fill: true }, { d: 'M-0.18,0.18 L0.18,-0.18 M-0.18,-0.18 L0.18,0.18', fill: false }],
  download: [TRAY, { d: 'M0,0.48 V-0.1', fill: false }, { d: 'M-0.2,0.12 L0,-0.1 L0.2,0.12', fill: false }],
  upload: [TRAY, { d: 'M0,-0.1 V0.48', fill: false }, { d: 'M-0.2,0.26 L0,0.48 L0.2,0.26', fill: false }],
  puzzle: [
    {
      d: 'M-0.42,0.3 H-0.12 C-0.12,0.54 0.12,0.54 0.12,0.3 H0.42 V0.08 C0.64,0.08 0.64,-0.16 0.42,-0.16 V-0.42 H-0.42 V-0.16 '
        + 'C-0.2,-0.16 -0.2,0.08 -0.42,0.08 Z',
      fill: true,
    },
  ],
  search: [{ d: circlePath(-0.1, 0.12, 0.3), fill: true }, { d: 'M0.12,-0.1 L0.44,-0.42', fill: false }],
  clock: [{ d: circlePath(0, 0, 0.5), fill: true }, { d: 'M0,0.3 V0 H0.22', fill: false }],
  calendar: [
    { d: rectPath(-0.45, -0.45, 0.9, 0.8, 0.05), fill: true },
    { d: 'M-0.45,0.12 H0.45 M-0.22,0.35 V0.5 M0.22,0.35 V0.5', fill: false },
    { d: 'M-0.28,-0.08 H0.28 M-0.28,-0.26 H0.28', fill: false },
  ],
  arrival: [{ d: 'M0.08,0.46 H0.44 V-0.46 H0.08 Z', fill: true }, { d: 'M-0.46,0 H0.2 M0.02,0.18 L0.2,0 L0.02,-0.18', fill: false }],
  departure: [{ d: 'M-0.44,0.46 H-0.08 V-0.46 H-0.44 Z', fill: true }, { d: 'M-0.2,0 H0.46 M0.28,0.18 L0.46,0 L0.28,-0.18', fill: false }],
  recycle: recycleParts(),
  trash: [
    { d: 'M-0.34,0.22 L-0.28,-0.5 H0.28 L0.34,0.22 Z', fill: true },
    { d: 'M-0.45,0.22 H0.45 M-0.12,0.22 V0.34 H0.12 V0.22', fill: false },
    { d: 'M-0.12,0.04 V-0.34 M0,0.04 V-0.34 M0.12,0.04 V-0.34', fill: false },
  ],
  pin: [
    { d: 'M0,-0.5 C-0.1,-0.3 -0.38,-0.06 -0.38,0.14 C-0.38,0.36 -0.2,0.5 0,0.5 C0.2,0.5 0.38,0.36 0.38,0.14 C0.38,-0.06 0.1,-0.3 0,-0.5 Z', fill: true },
    { d: circlePath(0, 0.14, 0.12), fill: false },
  ],
  key: [
    { d: circlePath(-0.26, 0.22, 0.18), fill: true },
    { d: 'M-0.13,0.09 L0.44,-0.48 M0.18,-0.22 L0.3,-0.1 M0.32,-0.36 L0.44,-0.24', fill: false },
  ],
  shield: [
    { d: 'M0,0.5 L0.42,0.34 V-0.02 C0.42,-0.26 0.22,-0.42 0,-0.5 C-0.22,-0.42 -0.42,-0.26 -0.42,-0.02 V0.34 Z', fill: true },
    { d: 'M-0.16,0.02 L-0.04,-0.12 L0.2,0.16', fill: false },
  ],
  bolt: [{ d: 'M0.12,0.5 L-0.3,-0.04 H-0.02 L-0.12,-0.5 L0.3,0.06 H0.02 Z', fill: true }],
  star: [{ d: starPath(), fill: true }],
  chart: [
    { d: rectPath(-0.42, -0.45, 0.2, 0.3) + rectPath(-0.1, -0.45, 0.2, 0.6) + rectPath(0.22, -0.45, 0.2, 0.9), fill: true },
    { d: 'M-0.5,-0.45 H0.5', fill: false },
  ],
  home: [{ d: 'M-0.45,0 L0,0.45 L0.45,0 V-0.45 H-0.45 Z', fill: true }, { d: 'M-0.1,-0.45 V-0.1 H0.1 V-0.45', fill: false }],
  flag: [{ d: 'M-0.35,0.46 H0.4 L0.26,0.2 L0.4,-0.06 H-0.35 Z', fill: true }, { d: 'M-0.35,-0.5 V0.5', fill: false }],
};

/** Path data of the parts of an icon in the unit box. */
export function iconParts(name: IconName): IconPart[] {
  const parts = PARTS[name];
  if (!parts) throw new Error(`Unknown icon ${JSON.stringify(name)}`);
  return parts;
}

/** Create an icon as a group of vector parts, crisp or hand-drawn. */
export function makeIcon(name: IconName, options: IconOptions = {}): VGroup {
  const size = options.size ?? 1;
  if (!Number.isFinite(size) || size <= 0) throw new Error('Icon size must be finite and positive');
  const color = options.color ?? '#000000';
  const strokeWidth = options.strokeWidth ?? 2;
  const fillColor = options.fillColor ?? color;
  const fillOpacity = options.fillOpacity ?? 0;
  const parts = iconParts(name);
  const crisp = new VGroup();
  for (const part of parts) {
    const vmob = pathMobject(part.d, size, part.fill);
    vmob.setStyle({ strokeColor: color, strokeWidth });
    vmob.setFill(fillColor, part.fill ? fillOpacity : 0);
    crisp.add(vmob);
  }
  if (!options.sketch) return crisp;
  const rough = new VGroup();
  for (const part of parts) {
    const base: SketchOptions = { ...options.sketch, color, strokeWidth, fillColor, fillOpacity: part.fill ? fillOpacity : 0 };
    const seed = options.sketch.seed === undefined ? undefined : options.sketch.seed + rough.children.length;
    rough.add(sketch.path(part.d, { ...base, ...(seed === undefined ? {} : { seed }) }, size));
  }
  (rough as OutlineMobject).markupOutline = crisp;
  return rough;
}
