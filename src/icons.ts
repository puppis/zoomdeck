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
  'user', 'users', 'database', 'server', 'client', 'desktop', 'phone', 'cloud', 'document', 'folder', 'lock', 'gear', 'message', 'globe',
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

function gearPath(): string {
  const teeth = 8;
  const outer = 0.5;
  const inner = 0.37;
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
