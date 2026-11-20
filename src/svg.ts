/**
 * SVG artwork as vector mobjects.
 *
 * the engine's `SVGMobject` reads presentation attributes only from shape
 * elements and ignores `transform`, which the Figma-exported lecture artwork
 * relies on. This importer walks the document with a current transformation
 * matrix and inherited styles, converts every shape to cubic Bézier points and
 * keeps compound paths together so holes fill correctly. Clip paths and masks
 * are applied to the geometry they cover (see clip.ts).
 */
import { VGroup, VMobject } from 'manim-web';
import { parsePathData } from './pathdata';
import { parseCssColor } from './markup/ast';
import {
  alongBorder, fillPlacement, intersectFill, intersectPolygons, makeRegion, offsetSubpath, regionContains, strokeOutline, strokePlacement, visibleSide,
  type Region, type Subpath,
} from './clip';
import type { Vec } from './curves';

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

/**
 * A picture an SVG places (an `<image>`, or a rectangle filled with a pattern that holds one):
 * its file, often a `data:` URL, and where it lands in world coordinates. The picture is
 * `width` by `height`, mirrored left to right first when `mirrored`, then turned by `angle`
 * (radians, counterclockwise) and centered on `center`.
 */
export interface SvgImage {
  href: string;
  center: Vec;
  width: number;
  height: number;
  angle: number;
  mirrored: boolean;
  opacity: number;
}

/** Where the importer puts what it draws: shapes, and pictures when the caller takes them. */
interface SvgSink {
  shape(vmob: VMobject): void;
  /** Without it, pictures are left out as before: `<image>` is skipped, a pattern fill drawn flat. */
  image?(image: SvgImage): void;
}

/** One SVG document read for conversion: its frame and the walk that converts an element. */
function svgImporter(svgText: string, options: SvgImportOptions) {
  // Fragments cut out of a larger export often use `xlink:href` without declaring the prefix,
  // which a browser's XML parser rejects at the first use, dropping everything after it.
  const declared = /xlink:/.test(svgText) && !/xmlns:xlink\s*=/.test(svgText) ? svgText.replace(/<svg\b/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"') : svgText;
  const document = new DOMParser().parseFromString(declared, 'image/svg+xml');
  const error = document.querySelector('parsererror');
  if (error) console.warn(`[zoomdown] SVG not well formed; parts may be missing: ${(error.textContent ?? '').trim().split('\n')[0]}`);
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
  let sink: SvgSink = { shape: () => undefined };
  const rootStyle: Style = { fill: '#000000', fillOpacity: 1, stroke: null, strokeWidth: 1, strokeOpacity: 1, opacity: 1 };
  const skip = new Set(['defs', 'clippath', 'mask', 'symbol', 'marker', 'lineargradient', 'radialgradient', 'pattern', 'metadata', 'title', 'desc', 'style']);
  const toWorld = (m: Matrix, x: number, y: number): Vec => {
    const px = m[0] * x + m[2] * y + m[4];
    const py = m[1] * x + m[3] * y + m[5];
    return [(px - box.x - box.width / 2) * scale, -(py - box.y - box.height / 2) * scale];
  };
  /** The subpaths of a shape element in world coordinates, as cubic curves; null for anything else. */
  const worldSubpaths = (element: Element, matrix: Matrix): Subpath[] | null => {
    const d = shapePath(element);
    if (!d) return null;
    return parsePathData(d).filter((subpath) => subpath.length >= 2).map((subpath) => subpath.map(([x, y]) => toWorld(matrix, x, y)));
  };
  /** Visit the shapes under `element`, with their matrices and styles, following `<use>`. */
  const walk = (element: Element, parentMatrix: Matrix, parentStyle: Style, depth: number, clips: readonly Region[], emit: (element: Element, subpaths: Subpath[], matrix: Matrix, style: Style, clips: readonly Region[]) => void): void => {
    const tag = element.tagName.toLowerCase();
    if (skip.has(tag) || depth > 64) return;
    const matrix = multiply(parentMatrix, parseTransform(element.getAttribute('transform')));
    const style = styleOf(element, parentStyle, defaultColor);
    // A clip path or a mask of this element, in its own user space, applies to it and all it holds.
    const own = [...clips];
    for (const kind of ['clip-path', 'mask'] as const) {
      const region = regionOf(element, kind, matrix);
      if (region) own.push(region);
    }
    if (tag === 'use') {
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
      const target = href.startsWith('#') ? document.getElementById(href.slice(1)) : null;
      if (!target) return;
      const offset: Matrix = [1, 0, 0, 1, parseFloat(element.getAttribute('x') ?? '0') || 0, parseFloat(element.getAttribute('y') ?? '0') || 0];
      walk(target, multiply(matrix, offset), style, depth + 1, own, emit);
      return;
    }
    if (sink.image && emit === draw) {
      // A picture: an <image>, or a rectangle filled with a pattern that shows one, stretched over it.
      const picture = tag === 'image' ? hrefOf(element) : tag === 'rect' ? patternPicture(element) : null;
      if (picture) {
        const attr = (name: string, fallback = '0') => parseFloat(element.getAttribute(name) || fallback) || 0;
        emitImage(picture, attr('x'), attr('y'), attr('width'), attr('height'), matrix, style);
        return;
      }
    }
    const subpaths = worldSubpaths(element, matrix);
    if (subpaths) {
      if (subpaths.length) emit(element, subpaths, matrix, style, own);
      return;
    }
    if (tag === 'text') console.warn('[zoomdown] SVG <text> elements are not supported; convert text to paths');
    for (const child of Array.from(element.children)) walk(child, matrix, style, depth + 1, own, emit);
  };
  /** The file an `<image>` or `<use>` names. */
  const hrefOf = (element: Element): string | null => element.getAttribute('href') ?? element.getAttribute('xlink:href');
  /** The picture a rectangle's pattern fill shows (Figma exports picture fills so), or null. */
  const patternPicture = (element: Element): string | null => {
    const id = declaredStyle(element, 'fill')?.match(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/)?.[1];
    const pattern = id ? document.getElementById(id) : null;
    if (!pattern || pattern.tagName.toLowerCase() !== 'pattern') return null;
    for (const child of Array.from(pattern.children)) {
      const tag = child.tagName.toLowerCase();
      const target = tag === 'image' ? child : tag === 'use' ? document.getElementById((hrefOf(child) ?? '').replace(/^#/, '')) : null;
      if (target && target.tagName.toLowerCase() === 'image') return hrefOf(target);
    }
    return null;
  };
  /** Report the picture `href` covering the box at `x`, `y` of size `w` × `h` under `matrix`. */
  const emitImage = (href: string, x: number, y: number, w: number, h: number, matrix: Matrix, style: Style): void => {
    if (!(w > 0 && h > 0)) return;
    const origin = toWorld(matrix, x, y);
    const right = toWorld(matrix, x + w, y);
    const down = toWorld(matrix, x, y + h);
    const across: Vec = [right[0] - origin[0], right[1] - origin[1]];
    const along: Vec = [down[0] - origin[0], down[1] - origin[1]];
    // Unmirrored, the picture's top edge runs to the right of its left edge, which runs down.
    const mirrored = across[0] * along[1] - across[1] * along[0] > 0;
    const angle = Math.atan2(across[1], across[0]) - (mirrored ? Math.PI : 0);
    (sink.image as (image: SvgImage) => void)({
      href,
      center: toWorld(matrix, x + w / 2, y + h / 2),
      width: Math.hypot(across[0], across[1]),
      height: Math.hypot(along[0], along[1]),
      angle,
      mirrored,
      opacity: style.opacity,
    });
  };
  const regions = new Map<string, Region | null>();
  /** The region of the clip path or mask an element names, in the user space of `matrix`; null without one, or one that cannot be applied. */
  const regionOf = (element: Element, kind: 'clip-path' | 'mask', matrix: Matrix): Region | null => {
    const value = declaredStyle(element, kind);
    const id = value?.match(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/)?.[1];
    if (!id) return null;
    const key = `${kind}#${id}#${matrix.join(',')}`;
    if (regions.has(key)) return regions.get(key) as Region | null;
    const source = document.getElementById(id);
    let region: Region | null = null;
    const expected = kind === 'mask' ? 'mask' : 'clippath';
    if (!source || source.tagName.toLowerCase() !== expected) console.warn(`[zoomdown] SVG ${kind} #${id} not found; drawn in full`);
    else if ((source.getAttribute(kind === 'mask' ? 'maskContentUnits' : 'clipPathUnits') ?? 'userSpaceOnUse') !== 'userSpaceOnUse') {
      console.warn(`[zoomdown] SVG ${kind} #${id} in objectBoundingBox units is not supported; drawn in full`);
    } else {
      // A mask lets through its light (or, with mask-type alpha, its opaque) shapes, less its dark ones; a clip path all its shapes.
      const alpha = kind === 'mask' && (declaredStyle(source, 'mask-type') ?? '').trim() === 'alpha';
      const shows: Array<{ subpaths: Subpath[]; rule: 'nonzero' | 'evenodd' }> = [];
      const hides: typeof shows = [];
      const contentMatrix = kind === 'mask' ? matrix : multiply(matrix, parseTransform(source.getAttribute('transform')));
      const sourceStyle = styleOf(source, styleOf(root, rootStyle, defaultColor), defaultColor);
      for (const child of Array.from(source.children)) {
        walk(child, contentMatrix, sourceStyle, 1, [], (shape, subpaths, _matrix, style) => {
          const rule = (declaredStyle(shape, kind === 'mask' ? 'fill-rule' : 'clip-rule') ?? '').trim() === 'evenodd' ? 'evenodd' : 'nonzero';
          const closed = subpaths.map((subpath) => close(subpath));
          if (kind === 'clip-path') shows.push({ subpaths: closed, rule });
          else if (style.fill) {
            const coverage = style.fillOpacity * style.opacity * (alpha ? 1 : luminance(style.fill));
            (coverage >= 0.5 ? shows : hides).push({ subpaths: closed, rule });
          }
        });
      }
      region = makeRegion(shows, hides);
      // A mask or a clip path with nothing in it hides everything.
      if (!region) region = { shows: [], hides: [], box: { minX: 0, minY: 0, maxX: -1, maxY: -1 } };
    }
    regions.set(key, region);
    return region;
  };
  /** A shape as the engine draws it, from world subpaths; `subpaths` already cut by its clips. */
  const shapeMobject = (subpaths: Subpath[]): VMobject => {
    const vmob = new VMobject();
    vmob.setPoints(subpaths.flatMap((subpath) => subpath.map(([x, y]) => [x, y, 0])));
    if (subpaths.length > 1) vmob.setBaseSubpathLengths(subpaths.map((subpath) => subpath.length));
    return vmob;
  };
  const styled = (vmob: VMobject, style: Style, stroke: number, fill: boolean): VMobject => {
    // A shape without a stroke keeps its opacity: the stroke opacity is the mobject's own
    // opacity in the engine, and zeroing it would hide the fill as well; a zero width is enough.
    vmob.setStyle({
      strokeColor: style.stroke ?? style.fill ?? defaultColor,
      strokeWidth: style.stroke ? stroke * 100 : 0,
      strokeOpacity: style.opacity * (style.stroke ? style.strokeOpacity : 1),
    });
    // The stroke color assignment above also resets the fill color, so the fill comes last.
    vmob.setFill(style.fill ?? defaultColor, fill && style.fill ? style.fillOpacity * style.opacity : 0);
    return vmob;
  };
  const draw = (element: Element, subpaths: Subpath[], matrix: Matrix, style: Style, clips: readonly Region[]): void => {
    const ctmScale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
    const strokeWorld = style.stroke ? style.strokeWidth * ctmScale * scale : 0;
    if (!clips.length) {
      sink.shape(styled(shapeMobject(subpaths), style, strokeWorld, true));
      return;
    }
    const inside = (p: Vec) => clips.every((region) => regionContains(region, p));
    // The fill: whole, gone, or cut to the regions.
    const filled = !!style.fill && style.fillOpacity * style.opacity > 0;
    const placement = filled ? fillPlacement(subpaths, inside, clips) : 'outside';
    // The stroke: one along a region's border keeps the half on the visible side; one clear of
    // every border stays whole or goes; one nearer a border than half its width is filled as its
    // outline cut to the regions.
    let whole: Subpath[] = [];
    let outlines: Subpath[] = [];
    let strokeWidth = strokeWorld;
    let strokeIntact = strokeWorld <= 0;
    if (strokeWorld > 0) {
      const border = clips.find((region) => alongBorder(subpaths, region, Math.max(strokeWorld * 0.1, 1e-9)));
      let lines = subpaths;
      let cutBy = clips;
      if (border) {
        lines = subpaths.map((subpath) => offsetSubpath(subpath, (visibleSide(subpath, border, strokeWorld / 4) * strokeWorld) / 4));
        strokeWidth = strokeWorld / 2;
        cutBy = clips.filter((region) => region !== border);
      }
      const cap = (declaredStyle(element, 'stroke-linecap') ?? 'butt').trim() as 'butt' | 'round' | 'square';
      for (const line of lines) {
        const where = cutBy.length ? strokePlacement(line, strokeWidth / 2, cutBy) : 'inside';
        if (where === 'inside') whole.push(line);
        else if (where === 'across') outlines.push(...intersectPolygons(strokeOutline(line, strokeWidth / 2, ['round', 'square'].includes(cap) ? cap : 'butt'), cutBy, true));
      }
      strokeIntact = !border && whole.length === subpaths.length;
    }
    if (placement === 'inside' && strokeIntact) {
      sink.shape(styled(shapeMobject(subpaths), style, strokeWorld, true));
      return;
    }
    if (placement !== 'outside') {
      const fill = placement === 'inside' ? subpaths : intersectFill(subpaths, clips);
      if (fill.length) sink.shape(styled(shapeMobject(fill), { ...style, stroke: null }, 0, true));
    }
    if (whole.length) sink.shape(styled(shapeMobject(whole), style, strokeWidth, false));
    // The cut outline of a stroke, filled in the stroke's color and opacity.
    if (outlines.length) sink.shape(styled(shapeMobject(outlines), { ...style, stroke: null, fill: style.stroke, fillOpacity: style.strokeOpacity }, 0, true));
  };
  // Presentation attributes on the <svg> element itself (a stroke, a fill, an opacity) are inherited like a group's.
  const inherited = styleOf(root, rootStyle, defaultColor);
  return {
    root,
    box,
    scale,
    toWorld,
    /** The style an element passes on to its children, from the root down. */
    styleOf: (element: Element, parent: Style) => styleOf(element, parent, defaultColor),
    inherited,
    /** Convert `element` under `matrix` and `style` into `into`. */
    convert(element: Element, matrix: Matrix, style: Style, into: SvgSink): void {
      sink = into;
      try {
        walk(element, matrix, style, 0, [], draw);
      } finally {
        sink = { shape: () => undefined };
      }
    },
  };
}

/** Convert SVG text into a group of vector mobjects centered at the origin. */
export function svgToMobject(svgText: string, options: SvgImportOptions = {}): VGroup {
  const importer = svgImporter(svgText, options);
  const group = new VGroup();
  const into: SvgSink = { shape: (vmob) => group.add(vmob) };
  for (const child of Array.from(importer.root.children)) importer.convert(child, IDENTITY, importer.inherited, into);
  if (!group.isEmpty()) group.moveTo([0, 0, 0]);
  return group;
}

/** One part of a drawing: an element of its top group, and what it draws in document order. */
export interface SvgPart {
  id: string;
  element: Element;
  items: Array<VMobject | SvgImage>;
}

/**
 * An SVG drawing taken apart, with every part where the drawing puts it: the world origin is the
 * center of its frame (the `viewBox`), `width` (or `height`) its world size. The parts are the
 * children of the root's first `<g>`, the frame group of a Figma export, or of the root without
 * one; `skip` leaves elements out before they are converted. Pictures come back as `SvgImage`s
 * for the caller to load.
 */
export interface SvgDrawing {
  /** The frame in the drawing's own units. */
  frame: { x: number; y: number; width: number; height: number };
  /** The element whose children are the parts. */
  container: Element;
  parts: SvgPart[];
  /** World coordinates of a point given in the container's units. */
  toWorld(x: number, y: number): Vec;
}

export function svgDrawing(svgText: string, options: SvgImportOptions & { skip?: (element: Element) => boolean } = {}): SvgDrawing {
  const importer = svgImporter(svgText, options);
  const root = importer.root;
  const container = Array.from(root.children).find((child) => child.tagName.toLowerCase() === 'g') ?? root;
  // The frame group's transform and style reach its parts; its clip, the slide's edge, does not.
  const matrix = container === root ? IDENTITY : parseTransform(container.getAttribute('transform'));
  const style = container === root ? importer.inherited : importer.styleOf(container, importer.inherited);
  const parts: SvgPart[] = [];
  for (const element of Array.from(container.children)) {
    if (options.skip?.(element)) continue;
    const items: SvgPart['items'] = [];
    importer.convert(element, matrix, style, { shape: (vmob) => items.push(vmob), image: (image) => items.push(image) });
    parts.push({ id: element.id, element, items });
  }
  return { frame: importer.box, container, parts, toWorld: (x, y) => importer.toWorld(matrix, x, y) };
}

/** A property of an element, from its style attribute or its own attribute. */
function declaredStyle(element: Element, name: string): string | null {
  const inline = element.getAttribute('style');
  if (inline) {
    for (const declaration of inline.split(';')) {
      const index = declaration.indexOf(':');
      if (index > 0 && declaration.slice(0, index).trim() === name) return declaration.slice(index + 1).trim();
    }
  }
  return element.getAttribute(name);
}

/** The relative luminance of a `#rrggbb` color, from 0 (black) to 1 (white), as a luminance mask reads it. */
function luminance(color: string): number {
  const hex = color.replace('#', '');
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return 0.2125 * channel(0) + 0.7154 * channel(2) + 0.0721 * channel(4);
}

/** A subpath closed back to its start, as a region's outline is. */
function close(subpath: Subpath): Subpath {
  const [first, last] = [subpath[0], subpath[subpath.length - 1]];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-12) return subpath;
  return [...subpath, [last[0] + (first[0] - last[0]) / 3, last[1] + (first[1] - last[1]) / 3], [last[0] + (2 * (first[0] - last[0])) / 3, last[1] + (2 * (first[1] - last[1])) / 3], first];
}

/** Fetch an SVG file and convert it. */
export async function loadSvgMobject(url: string, options: SvgImportOptions = {}): Promise<VGroup> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image not found: ${url} (${response.status})`);
  return svgToMobject(await response.text(), options);
}
