/**
 * Slajdomat presentations as decks. Slajdomat (the Figma plugin for zooming slides) exports a
 * presentation as a folder: `manifest.json`, the tree of slides with each slide's events, and one
 * `image.svg` per slide in a folder the manifest names, beside its own viewer (`index.html`).
 * ZoomDown plays such a folder with its own player instead of that viewer: every slide becomes a
 * slide of the deck, each part of its drawing a picture the browser draws from the SVG (exactly as
 * Slajdomat's viewer shows it, and sharp at rest like the deck's own text), and its children sit
 * where the SVG keeps their placeholders. A slide's events become its stops in Slajdomat's
 * order: the entry is a stop, each event ends in one together with the events merged into it, a
 * child event zooms into the child (whose entry is its first stop) and back, and a show or hide
 * fades the part of the slide that carries the event's id. The pen, the whiteboard, the tablet,
 * the camera, printing and recording then work as for any deck.
 */
import { Group, Rectangle, VMobject, type Animation, type Mobject } from 'manim-web';
import { enterAnimation, exitAnimation } from './animations';
import { defineDeck, type ResolvedDeck, type ViewportSize } from './deck';
import { BASE_PAGE_PIXELS, DensityImage, type DensityImageOptions } from './density';
import { setSourceRank } from './display';
import { IframeHost } from './markup/iframe';
import type { PresenterConfig, PresenterConfigOptions, SlideContext } from './runtime';
import { Slide } from './slides';
import { LINKED_OBJECTS } from './links';
import { placeLinks, subpathBoxes, type LinkBox } from './slajdomat-links';
import { svgDrawing, transformBetween, type SvgDrawing, type SvgPart } from './svg';

/** One node of a Slajdomat manifest's tree: a slide (`child`) or an event of its parent slide. */
export interface SlajdomatEvent {
  type: 'child' | 'show' | 'hide' | 'animate';
  /** The slide's id, or the id of the element of its parent's drawing that the event changes. */
  id: string;
  name: string;
  /** Happens with the event before it, in the same click. */
  merged?: boolean;
  /** A slide's events, in order. */
  children?: SlajdomatEvent[];
  /**
   * A slide's embedded web pages, by the id of the object they cover: the page's URL, relative to
   * the presentation, and the object's box in the drawing (relative to its background).
   */
  iframes?: Record<string, string | { url: string; bounds?: { x: number; y: number; width: number; height: number } }>;
}

/** The parts of `manifest.json` that the deck reads. */
export interface SlajdomatManifest {
  presentation?: string;
  /** Folder of each slide's drawing by slide id; the id itself when absent. */
  slideDict?: Record<string, string>;
  tree: SlajdomatEvent;
}

/** How a Slajdomat presentation becomes a deck. */
export interface SlajdomatDeckOptions {
  /** URL of the presentation: its `manifest.json`, its `index.html` or its folder. */
  url: string;
  /** Title shown in the outline and the tab; the presentation's own name otherwise. */
  title?: string;
  presenter?: PresenterConfig | PresenterConfigOptions;
  showOutline?: boolean;
}

/** World width of every slide; heights follow each drawing's proportions. */
const SLIDE_WIDTH = 16;
/** Drawings fetched at once while the deck opens. */
const FETCHES = 6;

/** Whether `value` reads as a Slajdomat manifest: a tree of slides under a root slide. */
export function isSlajdomatManifest(value: unknown): value is SlajdomatManifest {
  const tree = (value as SlajdomatManifest | null)?.tree;
  return !!tree && typeof tree === 'object' && tree.type === 'child' && typeof tree.id === 'string';
}

/** The manifest's URL for the URL of a presentation: its manifest, its viewer page or its folder. */
export function slajdomatManifestUrl(url: string): string {
  const absolute = new URL(url, typeof location !== 'undefined' ? location.href : 'file:///');
  absolute.search = '';
  absolute.hash = '';
  const path = absolute.pathname;
  if (/\/manifest\.json$/i.test(path)) return absolute.href;
  absolute.pathname = /\.html?$/i.test(path) ? path.replace(/[^/]*$/, 'manifest.json') : path.replace(/\/?$/, '/manifest.json');
  return absolute.href;
}

/** The slides of the tree, root first, each before its children. */
function slidesOf(root: SlajdomatEvent): SlajdomatEvent[] {
  const slides: SlajdomatEvent[] = [];
  const visit = (slide: SlajdomatEvent) => {
    slides.push(slide);
    for (const event of slide.children ?? []) if (event.type === 'child') visit(event);
  };
  visit(root);
  return slides;
}

/** The element of a drawing's top group with `id`, the last one as in Slajdomat's viewer. */
function partElement(drawing: SvgDrawing, id: string): Element | null {
  const matches = Array.from(drawing.container.children).filter((element) => element.id === id);
  return matches[matches.length - 1] ?? null;
}

/**
 * Where a child sits in its parent, in the parent's world coordinates: the rectangle of its
 * placeholder (the element with the child's id, or the first rectangle inside it), read from its
 * attributes as Slajdomat's viewer reads it. Null when the drawing has no such rectangle.
 */
export function placeholderBox(drawing: SvgDrawing, id: string): { center: [number, number, number]; width: number; height: number } | null {
  const element = partElement(drawing, id);
  const rect = element?.tagName.toLowerCase() === 'rect' ? element : element?.querySelector('rect');
  if (!rect) return null;
  const read = (name: string) => parseFloat(rect.getAttribute(name) ?? '0') || 0;
  const [x, y, width, height] = [read('x'), read('y'), read('width'), read('height')];
  if (!(width > 0 && height > 0)) return null;
  const [left, top] = drawing.toWorld(x, y);
  const [right, bottom] = drawing.toWorld(x + width, y + height);
  return { center: [(left + right) / 2, (top + bottom) / 2, 0], width: Math.abs(right - left), height: Math.abs(top - bottom) };
}

/** A link of a drawing: its target and its clickable box in world units. */
interface DrawingLink {
  href: string;
  center: [number, number, number];
  width: number;
  height: number;
}

/** The ink box of a text in its own units: its paths' outlines, their transforms applied. */
function inkBox(text: Element, paths: Element[]): LinkBox | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const path of paths) {
    const map = transformBetween(text, path);
    for (const box of subpathBoxes(path.getAttribute('d') ?? '')) {
      for (const [x, y] of [map(box.x0, box.y0), map(box.x1, box.y0), map(box.x0, box.y1), map(box.x1, box.y1)]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x0 <= x1 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/**
 * The links of a drawing, by the part (an element of its top group) that holds each. Figma
 * follows a linked text with one `<a><rect/></a>` per line of the link, the rectangles relative to
 * the text's box, which is not exported: they are placed from the text's ink, as Slajdomat's viewer
 * places them, or, for a text whose outlines are moved, from its ink box.
 */
export function drawingLinks(drawing: SvgDrawing, base: string): Map<Element, DrawingLink[]> {
  const links = new Map<Element, DrawingLink[]>();
  const read = (element: Element, name: string) => parseFloat(element.getAttribute(name) ?? '') || 0;
  for (const first of Array.from(drawing.container.querySelectorAll('a'))) {
    const text = first.previousElementSibling;
    if (!text || text.tagName.toLowerCase() === 'a') continue;
    const anchors: Element[] = [];
    const rects: Element[] = [];
    for (let a: Element | null = first; a && a.tagName.toLowerCase() === 'a'; a = a.nextElementSibling) {
      const rect = a.firstElementChild;
      if (rect && rect.tagName.toLowerCase() === 'rect') {
        anchors.push(a);
        rects.push(rect);
      }
    }
    if (!rects.length) continue;
    const paths = text.tagName.toLowerCase() === 'path' ? [text] : Array.from(text.querySelectorAll('path'));
    const boxes = rects.map((rect) => ({ x: read(rect, 'x'), y: read(rect, 'y'), width: read(rect, 'width'), height: read(rect, 'height') }));
    const moved = [text, ...paths].some((element) => element.hasAttribute('transform'));
    let placed = moved ? null : placeLinks(paths.map((path) => path.getAttribute('d') ?? ''), boxes);
    if (!placed) {
      const ink = inkBox(text, paths);
      if (!ink) continue;
      placed = boxes.map((box) => ({ ...box, x: ink.x + box.x, y: ink.y + box.y }));
    }
    let part: Element = first;
    while (part.parentElement && part.parentElement !== drawing.container) part = part.parentElement;
    if (part.parentElement !== drawing.container) continue;
    placed.forEach((box, index) => {
      const href = anchors[index].getAttribute('href') ?? anchors[index].getAttribute('xlink:href');
      if (!href || !(box.width > 0 && box.height > 0)) return;
      const [left, top] = drawing.toWorldIn(anchors[index], box.x, box.y);
      const [right, bottom] = drawing.toWorldIn(anchors[index], box.x + box.width, box.y + box.height);
      const list = links.get(part) ?? [];
      list.push({
        href: href.startsWith('#') ? href : new URL(href, base).href,
        center: [(left + right) / 2, (top + bottom) / 2, 0],
        width: Math.abs(right - left),
        height: Math.abs(top - bottom),
      });
      links.set(part, list);
    });
  }
  return links;
}

/** The background of a drawing, which Slajdomat's viewer removes: its first element, a rectangle. */
function isBackground(element: Element): boolean {
  return element.tagName.toLowerCase() === 'rect' && element.parentElement?.firstElementChild === element;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * A picture drawn by the browser from SVG: `body` is the markup inside the `<svg>` element and
 * `viewBox` the region of it shown, in its own units, which gives the picture its proportions.
 */
export class SvgPicture extends DensityImage {
  readonly body: string;
  readonly viewBox: [number, number, number, number];

  constructor(body: string, viewBox: [number, number, number, number], options: Omit<DensityImageOptions, 'blank'> = {}) {
    super([viewBox[2], viewBox[3]], { ...options, blank: null });
    this.body = body;
    this.viewBox = viewBox;
    this._start();
  }

  protected async _draw(pixels: number): Promise<HTMLCanvasElement | null> {
    const [, , width, height] = this.viewBox;
    const scale = pixels / Math.max(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    // The picture is drawn at the size it is shown, not scaled up from a smaller drawing.
    const svg = `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" width="${canvas.width}" height="${canvas.height}" viewBox="${this.viewBox.join(' ')}" preserveAspectRatio="none">${this.body}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D is required for SVG pictures');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    } finally {
      URL.revokeObjectURL(url);
    }
    return canvas;
  }

  override copy(): SvgPicture {
    const [width, height] = this.worldSize;
    const clone = new SvgPicture(this.body, this.viewBox, { width, height, base: this.basePixels });
    this._copyBaseAttributesInto(clone, { copyChildren: false });
    return clone;
  }
}

/** The ids an element and everything under it refer to: `url(#id)` in attributes and `#id` links. */
function references(element: Element): Set<string> {
  const ids = new Set<string>();
  for (const node of [element, ...Array.from(element.querySelectorAll('*'))]) {
    for (const attribute of Array.from(node.attributes)) {
      for (const match of attribute.value.matchAll(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g)) ids.add(match[1]);
      if ((attribute.localName === 'href') && attribute.value.startsWith('#')) ids.add(attribute.value.slice(1));
    }
  }
  return ids;
}

/**
 * Rectangles filled with a picture, as Figma exports them (a pattern in bounding-box units that
 * shows an image), turned into the picture itself, clipped to the rectangle: a browser repeats a
 * pattern's tile, so the far edge of the picture would bleed into the near one as a thin line.
 * The picture keeps the pattern's placement in the rectangle, and the rectangle's other attributes
 * (its opacity, say) go to a group around it. `root` is changed in place; the document is not.
 */
function unpatternPictures(root: Element, document: Document): void {
  const id = (value: string | null) => value?.match(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/)?.[1] ?? null;
  for (const rect of Array.from(root.querySelectorAll('rect'))) {
    const style = rect.getAttribute('style') ?? '';
    const pattern = document.getElementById(id(rect.getAttribute('fill')) ?? id(style.match(/fill\s*:\s*([^;]+)/)?.[1] ?? null) ?? '');
    if (!pattern || pattern.tagName.toLowerCase() !== 'pattern' || pattern.getAttribute('patternContentUnits') !== 'objectBoundingBox' || pattern.hasAttribute('patternTransform')) continue;
    const use = Array.from(pattern.children).find((child) => child.tagName.toLowerCase() === 'use');
    const image = use ? document.getElementById((use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '').replace(/^#/, '')) : null;
    if (!use || !image || image.tagName.toLowerCase() !== 'image') continue;
    const read = (name: string) => rect.getAttribute(name) ?? '0';
    const group = document.createElementNS(SVG_NS, 'g');
    for (const attribute of Array.from(rect.attributes)) {
      if (!['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'style'].includes(attribute.name)) group.setAttribute(attribute.name, attribute.value);
    }
    // The rectangle's box, in which the pattern's content lives in units of the box.
    const box = document.createElementNS(SVG_NS, 'svg');
    for (const [name, value] of [['x', read('x')], ['y', read('y')], ['width', read('width')], ['height', read('height')], ['viewBox', '0 0 1 1'], ['preserveAspectRatio', 'none'], ['overflow', 'hidden']]) box.setAttribute(name, value);
    const picture = image.cloneNode(true) as Element;
    picture.removeAttribute('id');
    const placement = [use.getAttribute('transform') ?? '', `translate(${use.getAttribute('x') ?? 0} ${use.getAttribute('y') ?? 0})`, picture.getAttribute('transform') ?? ''].join(' ').trim();
    picture.setAttribute('transform', placement);
    box.appendChild(picture);
    group.appendChild(box);
    rect.replaceWith(group);
  }
}

/** The presentation attributes of an element, for a group that stands in for it. */
function presentation(element: Element, leave: string[]): string {
  return Array.from(element.attributes)
    .filter((attribute) => !leave.includes(attribute.name) && !attribute.name.startsWith('xmlns'))
    .map((attribute) => ` ${attribute.name}="${attribute.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`)
    .join('');
}

/**
 * The SVG markup that draws one part of a drawing alone: the definitions it uses (and the ones
 * those use), and the part inside groups that carry the presentation attributes of the root and
 * of the frame group, so that it inherits what it inherited in the whole drawing.
 */
export function partMarkup(part: SvgPart, container: Element): string {
  const root = container.ownerDocument.documentElement;
  const serializer = new XMLSerializer();
  // A copy of the part, its pictures out of their patterns; the drawing itself stays as it is.
  const holder = container.ownerDocument.createElementNS(SVG_NS, 'g');
  holder.appendChild(part.element.cloneNode(true));
  unpatternPictures(holder, container.ownerDocument);
  const element = holder.firstElementChild as Element;
  const wrapperOpen = container === root ? `<g${presentation(root, ['width', 'height', 'viewBox', 'version', 'id'])}>` : `<g${presentation(root, ['width', 'height', 'viewBox', 'version', 'id'])}><g${presentation(container, ['id'])}>`;
  const wrapperClose = container === root ? '</g>' : '</g></g>';
  // The definitions, followed from the part and the frame group to whatever they use in turn.
  const wanted = references(element);
  if (container !== root) for (const id of references(container.cloneNode(false) as Element)) wanted.add(id);
  const seen = new Set<string>();
  const definitions: string[] = [];
  const pending = [...wanted];
  while (pending.length) {
    const id = pending.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const definition = container.ownerDocument.getElementById(id);
    if (!definition || part.element.contains(definition) || definition.contains(part.element)) continue;
    definitions.push(serializer.serializeToString(definition));
    for (const next of references(definition)) if (!seen.has(next)) pending.push(next);
  }
  const defs = definitions.length ? `<defs>${definitions.join('')}</defs>` : '';
  return `${defs}${wrapperOpen}${serializer.serializeToString(element)}${wrapperClose}`;
}

/** The world box a part covers: its shapes (with their strokes) and pictures; null when it draws nothing. */
export function partBounds(part: SvgPart): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const extend = (x: number, y: number, margin = 0) => {
    minX = Math.min(minX, x - margin);
    minY = Math.min(minY, y - margin);
    maxX = Math.max(maxX, x + margin);
    maxY = Math.max(maxY, y + margin);
  };
  for (const item of part.items) {
    if (item instanceof VMobject) {
      // The shape's stroke reaches half its width beyond the outline (engine widths are a hundredth of a unit).
      const margin = item.strokeWidth / 200;
      for (const point of item.getPoints()) extend(point[0], point[1], margin);
    } else {
      const cos = Math.cos(item.angle);
      const sin = Math.sin(item.angle);
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        extend(item.center[0] + (u * item.width * cos) / 2 - (v * item.height * sin) / 2, item.center[1] + (u * item.width * sin) / 2 + (v * item.height * cos) / 2);
      }
    }
  }
  return minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : null;
}

/** A Slajdomat slide: its drawing taken apart, and a program that plays its events. */
export class SlajdomatSlide extends Slide {
  /** The slide's events, in order. */
  readonly events: SlajdomatEvent[];
  /** The child slide of each child event. */
  readonly childSlides = new Map<SlajdomatEvent, Slide>();
  /** The part each event changes, by the element's id, once built. */
  readonly parts = new Map<string, Mobject>();
  private readonly _svg: string;
  private readonly _base: string;

  constructor(readonly node: SlajdomatEvent, svg: string, frame: { width: number; height: number }, base: string) {
    super(node.name || node.id, { size: [SLIDE_WIDTH, (SLIDE_WIDTH * frame.height) / frame.width] });
    this.events = node.children ?? [];
    this._svg = svg;
    this._base = base;
  }

  override build(ctx: SlideContext): void {
    const placeholders = new Set(this.events.filter((event) => event.type === 'child').map((event) => event.id));
    const drawing = svgDrawing(this._svg, { width: this.width, skip: (element) => isBackground(element) || placeholders.has(element.id) });
    const { frame } = drawing;
    const scale = this.width / frame.width;
    // A world point in the drawing's own units, the inverse of `drawing.toWorld` for the frame.
    const toSvg = (x: number, y: number): [number, number] => [x / scale + frame.x + frame.width / 2, frame.y + frame.height / 2 - y / scale];
    // A part that an event shows first is hidden until then; any other part is on the slide.
    const first = new Map<string, SlajdomatEvent['type']>();
    for (const event of this.events) if (event.type !== 'child' && !first.has(event.id)) first.set(event.id, event.type);
    const longSide = Math.max(this.width, this.height);
    const pages = this._pages(drawing);
    const links = drawingLinks(drawing, this._base);
    for (const [rank, part] of drawing.parts.entries()) {
      const bounds = partBounds(part);
      if (!bounds) continue;
      // A little room around the geometry, for what the browser draws beyond it (a marker, a shadow).
      const pad = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.02 + longSide * 0.002;
      const [left, top] = toSvg(bounds.minX - pad, bounds.maxY + pad);
      const [right, bottom] = toSvg(bounds.maxX + pad, bounds.minY - pad);
      const width = (bounds.maxX - bounds.minX) + 2 * pad;
      const height = (bounds.maxY - bounds.minY) + 2 * pad;
      // Out of view a part keeps a picture as fine as its share of a slide's base picture.
      const base = Math.max(24, Math.round((BASE_PAGE_PIXELS * Math.max(width, height)) / longSide));
      const picture = new SvgPicture(partMarkup(part, drawing.container), [left, top, right - left, bottom - top], { width, height, base });
      picture.moveTo([(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0]);
      // A web page over the part, and the part's links, come and go with it.
      const page = pages.get(part.id);
      pages.delete(part.id);
      const hits = (links.get(part.element) ?? []).map((link) => {
        // All but invisible: the drawing shows the link, the player keeps a clickable area over it.
        const area = new Rectangle({ width: link.width, height: link.height, color: '#FFFFFF', fillOpacity: 0.001, strokeWidth: 0 });
        area.moveTo(link.center);
        LINKED_OBJECTS.set(area as unknown as Mobject, link.href);
        return area as unknown as Mobject;
      });
      const extra = [...(page ? [page] : []), ...hits];
      const obj = (extra.length ? new Group(picture as unknown as Mobject, ...extra) : picture) as unknown as Mobject;
      // Parts draw in the drawing's order, whichever click shows each one.
      setSourceRank(obj, rank);
      if (part.id) this.parts.set(part.id, obj);
      if (first.get(part.id) !== 'show') ctx.add(obj);
    }
    // Pages over objects the drawing does not have (a frame with nothing to draw) are there throughout.
    for (const page of pages.values()) ctx.add(page);
  }

  /**
   * The slide's embedded web pages, by the id of the object they cover: each a live page (as an
   * `[[iframe]]` of a Markdown deck is) over the object's box, while the drawing shows the object
   * itself out of the slide and during zooms, as Slajdomat's viewer does.
   */
  private _pages(drawing: SvgDrawing): Map<string, Mobject> {
    const pages = new Map<string, Mobject>();
    // Boxes in the manifest are relative to the drawing's background (see Slajdomat's viewer).
    const background = drawing.container.firstElementChild;
    const shift = (background?.getAttribute('transform') ?? '').match(/translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)/);
    const [dx, dy] = shift ? [Number(shift[1]), Number(shift[2])] : [0, 0];
    for (const [id, entry] of Object.entries(this.node.iframes ?? {})) {
      const url = typeof entry === 'string' ? entry : entry.url;
      let box = typeof entry === 'string' ? undefined : entry.bounds;
      if (!box) {
        const rect = partElement(drawing, id);
        const read = (name: string) => parseFloat(rect?.getAttribute(name) ?? '') || 0;
        if (rect) box = { x: read('x') - dx, y: read('y') - dy, width: read('width'), height: read('height') };
      }
      if (!url || !box || !(box.width > 0 && box.height > 0)) {
        console.warn(`[zoomdown] The web page ${url || id} of the Slajdomat slide ${this.name} has no place; it is left out`);
        continue;
      }
      const [left, top] = drawing.toWorld(box.x + dx, box.y + dy);
      const [right, bottom] = drawing.toWorld(box.x + dx + box.width, box.y + dy + box.height);
      // All but invisible: the drawing shows the object, the page covers it at rest.
      const frame = new Rectangle({ width: Math.abs(right - left), height: Math.abs(top - bottom), color: '#FFFFFF', fillOpacity: 0.001, strokeWidth: 0 });
      frame.moveTo([(left + right) / 2, (top + bottom) / 2, 0]);
      const host = new IframeHost(new URL(url, this._base).href, frame, null, url);
      host.slide = this;
      pages.set(id, host as unknown as Mobject);
    }
    return pages;
  }

  /** The fade of a show or hide event, or null when the part is already so or there is none. */
  private _overlay(ctx: SlideContext, event: SlajdomatEvent): Animation | null {
    const part = this.parts.get(event.id);
    if (!part) return null;
    if (event.type === 'animate') {
      console.warn(`[zoomdown] Slajdomat animate events are not played yet (${event.name || event.id} on ${this.name})`);
      return null;
    }
    const show = event.type === 'show';
    if (ctx.mobjects.includes(part) === show) return null;
    const timing = { duration: this.fadeTime };
    return show ? enterAnimation('fade', part, timing) : exitAnimation('fade', part, timing);
  }

  override async *construct(ctx: SlideContext): AsyncGenerator<ReturnType<SlideContext['visit']>> {
    const presenter = ctx.presenter;
    if (!presenter.config.pauseOnEntry) ctx.stop();
    const events = this.events;
    for (let start = 0; start < events.length; ) {
      // An event and the ones merged into it make one click.
      let end = start + 1;
      while (end < events.length && events[end].merged) end += 1;
      const pending: Animation[] = [];
      let lastChild: Slide | null = null;
      for (let index = start; index < end; index += 1) {
        const event = events[index];
        if (event.type === 'child') {
          if (pending.length) await ctx.play(...pending.splice(0));
          const child = this.childSlides.get(event) as Slide;
          yield ctx.visit(child);
          lastChild = child;
        } else {
          lastChild = null;
          const animation = this._overlay(ctx, event);
          if (animation) pending.push(animation);
        }
      }
      if (pending.length) await ctx.play(...pending);
      start = end;
      // Back from a child, the runtime may have stopped already, or not have come back at all.
      if (lastChild) {
        const childCtx = presenter.contexts.get(lastChild) as SlideContext;
        if (childCtx.returnSkipped || presenter.config.pauseOnReturn) continue;
      }
      ctx.stop();
    }
  }
}

/**
 * Open a Slajdomat presentation as a deck. Every drawing is fetched now, since each slide's
 * placeholders place its children before the deck starts; the drawings are converted as the
 * slides are built.
 */
export async function slajdomatDeck(options: SlajdomatDeckOptions): Promise<ResolvedDeck> {
  const manifestUrl = slajdomatManifestUrl(options.url);
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`Cannot load ${manifestUrl} (${response.status})`);
  const manifest = (await response.json()) as unknown;
  if (!isSlajdomatManifest(manifest)) throw new Error(`${manifestUrl} is not the manifest of a Slajdomat presentation`);
  const base = new URL('.', manifestUrl).href;
  const slides = slidesOf(manifest.tree);
  const drawings = new Map<SlajdomatEvent, string>();
  const queue = [...slides];
  const fetchNext = async (): Promise<void> => {
    for (let slide = queue.shift(); slide; slide = queue.shift()) {
      const folder = manifest.slideDict?.[slide.id] ?? slide.id;
      // Characters a path keeps as they are (commas, parentheses) stay so: some servers do not decode them.
      const url = new URL(`${encodeURI(folder).replace(/[?#]/g, encodeURIComponent)}/image.svg`, base).href;
      const answer = await fetch(url);
      if (!answer.ok) throw new Error(`Cannot load the drawing of the Slajdomat slide ${slide.name || slide.id}: ${url} (${answer.status})`);
      drawings.set(slide, await answer.text());
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCHES, slides.length) }, fetchNext));
  const frames = new Map<SlajdomatEvent, SvgDrawing>();
  const frameOf = (slide: SlajdomatEvent): SvgDrawing => {
    let drawing = frames.get(slide);
    if (!drawing) {
      // The frame alone, nothing converted: the size of the slide and the places of its children.
      drawing = svgDrawing(drawings.get(slide) as string, { width: SLIDE_WIDTH, skip: () => true });
      frames.set(slide, drawing);
    }
    return drawing;
  };
  const build = (node: SlajdomatEvent): SlajdomatSlide => {
    const drawing = frameOf(node);
    const slide = new SlajdomatSlide(node, drawings.get(node) as string, drawing.frame, base);
    for (const [index, event] of slide.events.entries()) {
      if (event.type !== 'child') continue;
      const child = build(event);
      const box = placeholderBox(drawing, event.id);
      if (!box) console.warn(`[zoomdown] The Slajdomat slide ${slide.name} has no placeholder rectangle for its child ${child.name}; it is placed in the middle`);
      // Slajdomat comes back to the parent after a child, also between two children, unless the
      // next child is merged with it: then the camera goes from one to the other in one click.
      const next = slide.events[index + 1];
      const returnToParent = !(next?.merged && next.type === 'child');
      slide.addChild(child, { ...(box ?? { center: [0, 0, 0], width: SLIDE_WIDTH / 4 }), returnToParent });
      slide.childSlides.set(event, child);
    }
    return slide;
  };
  const rootFrame = frameOf(manifest.tree).frame;
  const viewport: ViewportSize = { width: rootFrame.width, height: rootFrame.height };
  return defineDeck({
    title: options.title ?? (manifest.presentation?.trim() || 'Slajdomat presentation'),
    presenter: options.presenter,
    foreground: '#000000',
    background: '#FFFFFF',
    viewport,
    showOutline: options.showOutline,
    base,
    deck: () => build(manifest.tree),
  });
}
