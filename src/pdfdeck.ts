/**
 * A PDF document as a deck: its pages, first to last, as the flat sequence of slides a
 * Markdown document without includes also becomes, cut between pages. Each page is drawn by
 * pdf.js into a texture at the density of the screen wherever the camera rests, and drawn
 * again when the stage changes size, so that its text stays as sharp as the deck's own; pages
 * out of view go back to a small picture, so a long document never holds every page at full
 * resolution. pdf.js loads on the first PDF opened, never before.
 */
import * as THREE from 'three';
import { Mobject } from 'manim-web';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { defineDeck, type ResolvedDeck, type ViewportSize } from './deck';
import type { PresenterConfig, PresenterConfigOptions, SlideContext } from './runtime';
import { Slide, pageSequence } from './slides';

type PdfJs = typeof import('pdfjs-dist');

let pdfjs: Promise<PdfJs> | null = null;

/** pdf.js and its worker, loaded once on demand. */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= (async () => {
    const [library, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    library.GlobalWorkerOptions.workerSrc = worker.default;
    return library;
  })();
  return pdfjs;
}

/** Pixels along the long side of a page out of view: a small picture, enough for an overview or a thumbnail. */
export const BASE_PAGE_PIXELS = 320;
/** Pixels along the long side of a page at most, whatever the zoom: beyond, the texture would exhaust memory on tablets. */
export const MAX_PAGE_PIXELS = 4096;

/** Pixels along the long side of a page `longSide` world units long drawn at `pxPerWorld`, within the bounds. */
export function pagePixels(longSide: number, pxPerWorld: number): number {
  const wanted = longSide * pxPerWorld;
  if (!Number.isFinite(wanted)) return BASE_PAGE_PIXELS;
  return Math.round(Math.min(MAX_PAGE_PIXELS, Math.max(BASE_PAGE_PIXELS, wanted)));
}

/** The pages on every stage, for the sharpening pass of the stage they are shown on. */
export const PAGE_IMAGES = new Set<PageImage>();

/** Width and height of a page in PDF points, as displayed (its rotation applied). */
export function pageSize(page: Pick<PDFPageProxy, 'getViewport'>): [number, number] {
  const viewport = page.getViewport({ scale: 1 });
  return [viewport.width, viewport.height];
}

export interface PageImageOptions {
  /** World size of the page; one dimension keeps the page's proportions. */
  width?: number;
  height?: number;
}

/**
 * A plane showing one page of a PDF, drawn at the density asked of it. Requests come from the
 * stage: the density of the screen for the pages in view, the base picture for the others. At
 * most two pages render at a time, the ones in view first, then the nearest.
 */
export class PageImage extends Mobject {
  /** Called whenever a page finished drawing after the fact, so the host can redraw. */
  static onUpdate: (() => void) | null = null;
  private static readonly _queue = new Set<PageImage>();
  private static _running = 0;
  private static _waiters: Array<() => void> = [];
  static readonly CONCURRENCY = 2;

  /** Resolve once every page in view shows the picture asked of it. */
  static async settle(): Promise<void> {
    while ([...PAGE_IMAGES].some((page) => page._inView && page._shown !== page._wanted)) {
      await new Promise<void>((resolve) => PageImage._waiters.push(resolve));
    }
  }

  private static _notify(): void {
    const waiters = PageImage._waiters;
    PageImage._waiters = [];
    for (const resolve of waiters) resolve();
  }

  private static _pump(): void {
    while (PageImage._running < PageImage.CONCURRENCY && PageImage._queue.size) {
      let next: PageImage | null = null;
      for (const page of PageImage._queue) if (!next || page._priority < next._priority) next = page;
      const page = next as PageImage;
      PageImage._queue.delete(page);
      if (page._shown === page._wanted || page._rendering) continue;
      PageImage._running += 1;
      page._rendering = page._render(page._wanted).finally(() => {
        page._rendering = null;
        PageImage._running -= 1;
        // The wish may have changed while it drew.
        if (page._shown !== page._wanted && PAGE_IMAGES.has(page)) PageImage._queue.add(page);
        PageImage._notify();
        PageImage._pump();
      });
    }
  }

  readonly page: PDFPageProxy;
  private readonly _points: [number, number];
  private _worldWidth: number;
  private _worldHeight: number;
  private _canvas: HTMLCanvasElement;
  private _texture: THREE.CanvasTexture | null = null;
  private _mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  /** Pixels along the long side of the picture shown (0: none yet) and of the one asked for. */
  private _shown = 0;
  private _wanted = BASE_PAGE_PIXELS;
  private _priority = Infinity;
  private _inView = false;
  private _rendering: Promise<void> | null = null;
  private _task: RenderTask | null = null;

  constructor(page: PDFPageProxy, options: PageImageOptions = {}) {
    super();
    this.page = page;
    this._points = pageSize(page);
    const aspect = this._points[0] / this._points[1];
    if (options.width !== undefined && options.height !== undefined) {
      const boxAspect = options.width / options.height;
      this._worldWidth = aspect > boxAspect ? options.width : options.height * aspect;
      this._worldHeight = aspect > boxAspect ? options.width / aspect : options.height;
    } else if (options.height !== undefined) {
      this._worldHeight = options.height;
      this._worldWidth = options.height * aspect;
    } else {
      this._worldWidth = options.width ?? 16;
      this._worldHeight = this._worldWidth / aspect;
    }
    // A blank white page until the first picture arrives.
    this._canvas = document.createElement('canvas');
    this._canvas.width = 2;
    this._canvas.height = 2;
    const context = this._canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, 2, 2);
    }
    this.fillOpacity = 1;
    PAGE_IMAGES.add(this);
    this.request(BASE_PAGE_PIXELS, Infinity, false);
  }

  /** Pixels along the long side of the picture shown now. */
  get shownPixels(): number {
    return this._shown;
  }

  /** Pixels along the long side of the picture asked for. */
  get wantedPixels(): number {
    return this._wanted;
  }

  /**
   * Ask for a picture `pixels` wide along the long side; `priority` orders the pages waiting
   * (lower first) and `inView` marks the pages a capture must wait for.
   */
  request(pixels: number, priority: number, inView: boolean): void {
    this._wanted = Math.round(pixels);
    this._priority = priority;
    this._inView = inView;
    if (this._shown === this._wanted) {
      PageImage._queue.delete(this);
      return;
    }
    PageImage._queue.add(this);
    PageImage._pump();
  }

  private async _render(pixels: number): Promise<void> {
    const scale = pixels / Math.max(this._points[0], this._points[1]);
    const viewport = this.page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is required for PDF pages');
    try {
      this._task = this.page.render({ canvas, canvasContext: context, viewport });
      await this._task.promise;
    } catch (error) {
      if ((error as { name?: string })?.name === 'RenderingCancelledException') return;
      console.error('[zoomdeck] PDF page failed to draw', error);
      // Give up on this density rather than asking again and again.
      this._shown = pixels;
      return;
    } finally {
      this._task = null;
    }
    if (!PAGE_IMAGES.has(this)) return;
    this._canvas = canvas;
    this._shown = pixels;
    if (this._mesh) {
      // A texture of another size is a new texture: storage once allocated cannot grow.
      this._texture?.dispose();
      this._texture = PageImage._texture(canvas);
      this._mesh.material.map = this._texture;
      this._mesh.material.needsUpdate = true;
    }
    this._markDirty();
    PageImage.onUpdate?.();
  }

  private static _texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    return texture;
  }

  override normalizeTransform(worldMatrix: THREE.Matrix4 = this._ownMatrix()): this {
    return this._flattenAsMesh(worldMatrix);
  }

  protected _createThreeObject(): THREE.Object3D {
    const group = new THREE.Group();
    this._texture = PageImage._texture(this._canvas);
    const material = new THREE.MeshBasicMaterial({
      map: this._texture,
      transparent: true,
      opacity: this._opacity,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      depthWrite: false,
      depthTest: false,
    });
    this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(this._worldWidth, this._worldHeight), material);
    this._mesh.frustumCulled = false;
    group.add(this._mesh);
    return group;
  }

  protected override _syncMaterialToThree(): void {
    if (this._mesh) this._mesh.material.opacity = this._opacity;
  }

  override getDisplayMeshLength(): number {
    return 1;
  }

  override getDisplayMeshes(): THREE.Mesh[] {
    this.getThreeObject();
    return this._mesh ? [this._mesh] : [];
  }

  override getWidth(): number {
    return this._worldWidth * Math.abs(this.scaleVector.x);
  }

  override getHeight(): number {
    return this._worldHeight * Math.abs(this.scaleVector.y);
  }

  override copy(): PageImage {
    const clone = new PageImage(this.page, { width: this._worldWidth, height: this._worldHeight });
    this._copyBaseAttributesInto(clone, { copyChildren: false });
    return clone;
  }

  override dispose(): void {
    PAGE_IMAGES.delete(this);
    PageImage._queue.delete(this);
    this._task?.cancel();
    super.dispose();
    this._texture?.dispose();
  }
}

/** One page of a PDF as a slide: a canvas of the page's proportions, filled by its picture. */
export class PdfPage extends Slide {
  constructor(readonly page: PDFPageProxy, readonly number: number, name: string, width = 16) {
    const [w, h] = pageSize(page);
    super(name, { width, height: (width * h) / w });
  }

  override build(ctx: SlideContext): void {
    ctx.add(new PageImage(this.page, { width: this.width, height: this.height }) as unknown as Mobject);
  }
}

export interface PdfDeckOptions {
  /** URL of the PDF file. Provide this or `data`. */
  url?: string;
  /** The file's bytes. */
  data?: ArrayBuffer | Uint8Array;
  /** Title shown in the outline and the tab; the document's own title, then its file name, otherwise. */
  title?: string;
  presenter?: PresenterConfig | PresenterConfigOptions;
  /** Colors of the player interface and of the canvas around the pages; white pages on white by default. */
  foreground?: string;
  background?: string;
  /** Proportions of the presentation viewport; the first page's by default. */
  viewport?: ViewportSize;
  showOutline?: boolean;
}

/** The names a document's bookmarks give its pages: the first bookmark pointing at a page names it. */
export async function pageNames(document: PDFDocumentProxy, limit = 500): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  try {
    const outline = await document.getOutline();
    if (!outline) return names;
    let seen = 0;
    const visit = async (items: typeof outline): Promise<void> => {
      for (const item of items) {
        if (seen++ >= limit) return;
        let dest = item.dest;
        if (typeof dest === 'string') dest = await document.getDestination(dest);
        if (Array.isArray(dest) && dest.length) {
          const target = dest[0] as unknown;
          const index = typeof target === 'number' ? target : target && typeof target === 'object' ? await document.getPageIndex(target as { num: number; gen: number }).catch(() => -1) : -1;
          const title = (item.title ?? '').trim();
          if (index >= 0 && title && !names.has(index + 1)) names.set(index + 1, title);
        }
        if (item.items?.length) await visit(item.items);
      }
    };
    await visit(outline);
  } catch {
    /* a document without a readable outline keeps its page numbers */
  }
  return names;
}

/** The folder of a document URL, as an absolute URL with a trailing slash; undefined without one. */
function deckFolder(url: string | undefined): string | undefined {
  if (!url || url.startsWith('data:')) return undefined;
  try {
    const absolute = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
    absolute.search = '';
    absolute.hash = '';
    absolute.pathname = absolute.pathname.replace(/[^/]*$/, '');
    return absolute.href;
  } catch {
    return undefined;
  }
}

/**
 * Open a PDF as a deck: its pages become a flat sequence of slides, visited first to last with
 * cuts between them, named after the document's bookmarks where it has them. The document is
 * read here, so the deck knows its title and the proportions of its first page.
 */
export async function pdfDeck(options: PdfDeckOptions): Promise<ResolvedDeck> {
  if (options.url === undefined && options.data === undefined) throw new Error('pdfDeck requires url or data');
  if (options.url !== undefined && options.data !== undefined) throw new Error('Set either url or data, not both');
  const { getDocument } = await loadPdfJs();
  const url = options.url === undefined ? undefined : options.url.startsWith('data:') ? options.url : new URL(options.url, typeof location !== 'undefined' ? location.href : undefined).href;
  const data = options.data instanceof Uint8Array ? options.data : options.data ? new Uint8Array(options.data) : undefined;
  const document = await getDocument(url !== undefined ? { url } : { data }).promise;
  const first = await document.getPage(1);
  const [width, height] = pageSize(first);
  let title = options.title;
  if (title === undefined) {
    const info = (await document.getMetadata().catch(() => null))?.info as { Title?: unknown } | undefined;
    if (typeof info?.Title === 'string' && info.Title.trim()) title = info.Title.trim();
  }
  if (title === undefined && url && !url.startsWith('data:')) title = decodeURIComponent(url.split('/').pop() ?? '').replace(/\.[^.]+$/, '') || undefined;
  const names = await pageNames(document);
  return defineDeck({
    title: title ?? 'Document',
    presenter: options.presenter,
    foreground: options.foreground ?? '#000000',
    background: options.background ?? '#FFFFFF',
    viewport: options.viewport ?? { width, height },
    showOutline: options.showOutline,
    base: deckFolder(url),
    deck: async () => {
      const pages: Slide[] = [];
      for (let number = 1; number <= document.numPages; number++) {
        const page = number === 1 ? first : await document.getPage(number);
        pages.push(new PdfPage(page, number, names.get(number) ?? `Page ${number}`));
      }
      return pageSequence(pages, { name: title ?? 'Document' });
    },
  });
}
