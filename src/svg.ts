/**
 * SVG artwork as vector mobjects.
 *
 * the engine's `SVGMobject` reads presentation attributes only from shape
 * elements and ignores `transform`, which the Figma-exported lecture artwork
 * relies on. This importer walks the document with a current transformation
 * matrix and inherited styles, converts every shape to cubic Bézier points and
 * keeps compound paths together so holes fill correctly.
 */
import { VGroup, VMobject, parseSVGPathData } from 'manim-web';
import { parseCssColor } from './markup/ast';

type Matrix = [number, number, number, number, number, number];

interface Style {
  fill: string | null;
  fillOpacity: number;
  stroke: string | null;
  strokeWidth: number;
  strokeOpacity: number;
  opacity: number;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function parseTransform(value: string | null): Matrix {
  let matrix: Matrix = IDENTITY;
  if (!value) return matrix;
  const pattern = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (const match of value.matchAll(pattern)) {
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let m: Matrix = IDENTITY;
    switch (match[1]) {
      case 'matrix':
        if (args.length === 6) m = args as Matrix;
        break;
      case 'translate':
        m = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case 'scale':
        m = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const angle = ((args[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        m = [cos, sin, -sin, cos, 0, 0];
        if (args.length >= 3) {
          m = multiply(multiply([1, 0, 0, 1, args[1], args[2]], m), [1, 0, 0, 1, -args[1], -args[2]]);
        }
        break;
      }
      case 'skewX':
        m = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        m = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    matrix = multiply(matrix, m);
  }
  return matrix;
}

function styleOf(element: Element, parent: Style, defaultColor: string): Style {
  const declared: Record<string, string> = {};
  const inline = element.getAttribute('style');
  if (inline) {
    for (const declaration of inline.split(';')) {
      const index = declaration.indexOf(':');
      if (index > 0) declared[declaration.slice(0, index).trim()] = declaration.slice(index + 1).trim();
    }
  }
  const read = (name: string) => declared[name] ?? element.getAttribute(name);
  const color = (value: string | null, fallback: string | null): string | null => {
    if (value === null || value === undefined) return fallback;
    const trimmed = value.trim();
    if (trimmed === 'none' || trimmed === 'transparent') return null;
    if (trimmed === 'currentColor' || trimmed === 'inherit') return trimmed === 'inherit' ? fallback : defaultColor;
    if (trimmed.startsWith('url(')) return fallback ?? defaultColor;
    try {
      return parseCssColor(trimmed);
    } catch {
      return fallback;
    }
  };
  const number = (value: string | null, fallback: number) => {
    if (value === null || value === undefined) return fallback;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    fill: color(read('fill'), parent.fill),
    fillOpacity: parent.fillOpacity * number(read('fill-opacity'), 1),
    stroke: color(read('stroke'), parent.stroke),
    strokeWidth: number(read('stroke-width'), parent.strokeWidth),
    strokeOpacity: parent.strokeOpacity * number(read('stroke-opacity'), 1),
    opacity: parent.opacity * number(read('opacity'), 1),
  };
}

function shapePath(element: Element): string | null {
  const attr = (name: string, fallback = '0') => parseFloat(element.getAttribute(name) || fallback);
  switch (element.tagName.toLowerCase()) {
    case 'path':
      return element.getAttribute('d');
    case 'rect': {
      const x = attr('x');
      const y = attr('y');
      const w = attr('width');
      const h = attr('height');
      let rx = attr('rx', 'NaN');
      let ry = attr('ry', 'NaN');
      if (Number.isNaN(rx) && Number.isNaN(ry)) return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
      if (Number.isNaN(rx)) rx = ry;
      if (Number.isNaN(ry)) ry = rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      return `M${x + rx},${y} H${x + w - rx} A${rx},${ry} 0 0 1 ${x + w},${y + ry} V${y + h - ry} A${rx},${ry} 0 0 1 ${x + w - rx},${y + h} H${x + rx} A${rx},${ry} 0 0 1 ${x},${y + h - ry} V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = attr('cx');
      const cy = attr('cy');
      const rx = element.tagName.toLowerCase() === 'circle' ? attr('r') : attr('rx');
      const ry = element.tagName.toLowerCase() === 'circle' ? attr('r') : attr('ry');
      return `M${cx + rx},${cy} A${rx},${ry} 0 1 0 ${cx - rx},${cy} A${rx},${ry} 0 1 0 ${cx + rx},${cy} Z`;
    }
    case 'line':
      return `M${attr('x1')},${attr('y1')} L${attr('x2')},${attr('y2')}`;
    case 'polyline':
    case 'polygon': {
      const coordinates = (element.getAttribute('points') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
      if (coordinates.length < 4) return null;
      let d = `M${coordinates[0]},${coordinates[1]}`;
      for (let i = 2; i + 1 < coordinates.length; i += 2) d += ` L${coordinates[i]},${coordinates[i + 1]}`;
      return element.tagName.toLowerCase() === 'polygon' ? d + ' Z' : d;
    }
    default:
      return null;
  }
}

export interface SvgImportOptions {
  /** Target width in world units; defaults to a height of two units. */
  width?: number;
  height?: number;
  /** Color used for `currentColor`. */
  defaultColor?: string;
}

/** Convert SVG text into a group of vector mobjects centered at the origin. */
export function svgToMobject(svgText: string, options: SvgImportOptions = {}): VGroup {
  const document = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = document.querySelector('svg');
  if (!root) throw new Error('No <svg> element found');
  const viewBox = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const widthAttr = parseFloat(root.getAttribute('width') ?? '');
  const heightAttr = parseFloat(root.getAttribute('height') ?? '');
  const box = viewBox.length === 4 && viewBox.every(Number.isFinite)
    ? { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] }
    : { x: 0, y: 0, width: Number.isFinite(widthAttr) ? widthAttr : 100, height: Number.isFinite(heightAttr) ? heightAttr : 100 };
  let scale: number;
  if (options.width !== undefined && options.height !== undefined) {
    scale = Math.min(options.width / box.width, options.height / box.height);
  } else if (options.width !== undefined) scale = options.width / box.width;
  else if (options.height !== undefined) scale = options.height / box.height;
  else scale = 2 / box.height;
  const defaultColor = options.defaultColor ?? '#000000';
  const group = new VGroup();
  const rootStyle: Style = { fill: '#000000', fillOpacity: 1, stroke: null, strokeWidth: 1, strokeOpacity: 1, opacity: 1 };
  const skip = new Set(['defs', 'clippath', 'mask', 'symbol', 'marker', 'lineargradient', 'radialgradient', 'pattern', 'metadata', 'title', 'desc', 'style']);
  const toWorld = (m: Matrix, x: number, y: number): [number, number, number] => {
    const px = m[0] * x + m[2] * y + m[4];
    const py = m[1] * x + m[3] * y + m[5];
    return [(px - box.x - box.width / 2) * scale, -(py - box.y - box.height / 2) * scale, 0];
  };
  const visit = (element: Element, parentMatrix: Matrix, parentStyle: Style, depth: number): void => {
    const tag = element.tagName.toLowerCase();
    if (skip.has(tag) || depth > 64) return;
    const matrix = multiply(parentMatrix, parseTransform(element.getAttribute('transform')));
    const style = styleOf(element, parentStyle, defaultColor);
    if (tag === 'use') {
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
      const target = href.startsWith('#') ? document.getElementById(href.slice(1)) : null;
      if (!target) return;
      const offset: Matrix = [1, 0, 0, 1, parseFloat(element.getAttribute('x') ?? '0') || 0, parseFloat(element.getAttribute('y') ?? '0') || 0];
      visit(target, multiply(matrix, offset), style, depth + 1);
      return;
    }
    const d = shapePath(element);
    if (d) {
      const subpaths = parseSVGPathData(d).filter((subpath) => subpath.length >= 2);
      if (subpaths.length) {
        const points: number[][] = [];
        const lengths: number[] = [];
        for (const subpath of subpaths) {
          const converted = subpath.map(([x, y]) => toWorld(matrix, x, y));
          points.push(...converted);
          lengths.push(converted.length);
        }
        const vmob = new VMobject();
        vmob.setPoints(points);
        if (lengths.length > 1) vmob.setBaseSubpathLengths(lengths);
        const ctmScale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
        const strokeWorld = style.stroke ? style.strokeWidth * ctmScale * scale : 0;
        vmob.setStyle({
          strokeColor: style.stroke ?? style.fill ?? defaultColor,
          strokeWidth: style.stroke ? strokeWorld * 100 : 0,
          strokeOpacity: style.stroke ? style.strokeOpacity * style.opacity : 0,
        });
        // The stroke color assignment above also resets the fill color, so the fill comes last.
        vmob.setFill(style.fill ?? defaultColor, style.fill ? style.fillOpacity * style.opacity : 0);
        group.add(vmob);
      }
      return;
    }
    if (tag === 'text') console.warn('[zoomdeck] SVG <text> elements are not supported; convert text to paths');
    for (const child of Array.from(element.children)) visit(child, matrix, style, depth + 1);
  };
  for (const child of Array.from(root.children)) visit(child, IDENTITY, rootStyle, 0);
  if (!group.isEmpty()) group.moveTo([0, 0, 0]);
  return group;
}

/** Fetch an SVG file and convert it. */
export async function loadSvgMobject(url: string, options: SvgImportOptions = {}): Promise<VGroup> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image not found: ${url} (${response.status})`);
  return svgToMobject(await response.text(), options);
}
