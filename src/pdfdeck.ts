/**
 * A PDF document as a deck: its pages, first to last, as the flat sequence of slides a
 * Markdown document without includes also becomes, cut between pages. Each page is drawn by
 * pdf.js into a texture at the density of the screen wherever the camera rests, and drawn
 * again when the stage changes size, so that its text stays as sharp as the deck's own; pages
 * out of view go back to a small picture, so a long document never holds every page at full
 * resolution. pdf.js loads on the first PDF opened, never before.
 */
import { Mobject } from 'manim-web';
import { DensityImage } from './density';
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

export { BASE_PAGE_PIXELS, MAX_PAGE_PIXELS, PAGE_IMAGES, pagePixels } from './density';

/** Width and height of a page in PDF points, as displayed (its rotation applied). */
export function pageSize(page: Pick<PDFPageProxy, 'getViewport'>): [number, number] {
  const viewport = page.getViewport({ scale: 1 });
  return [viewport.width, viewport.height];
}

/** How a page is drawn: its size and density. */
export interface PageImageOptions {
  /** World size of the page; one dimension keeps the page's proportions. */
  width?: number;
  height?: number;
}

/**
 * A plane showing one page of a PDF, drawn by pdf.js at the density asked of it: the density of
 * the screen for the pages in view, the base picture for the others (see `DensityImage`).
 */
export class PageImage extends DensityImage {
  readonly page: PDFPageProxy;
  private _task: RenderTask | null = null;

  constructor(page: PDFPageProxy, options: PageImageOptions = {}) {
    super(pageSize(page), { ...options, blank: '#FFFFFF' });
    this.page = page;
    this._start();
  }

  protected async _draw(pixels: number): Promise<HTMLCanvasElement | null> {
    const scale = pixels / Math.max(this._natural[0], this._natural[1]);
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
      if ((error as { name?: string })?.name === 'RenderingCancelledException') return null;
      throw error;
    } finally {
      this._task = null;
    }
    return canvas;
  }

  protected override _cancel(): void {
    this._task?.cancel();
  }

  override copy(): PageImage {
    const [width, height] = this.worldSize;
    const clone = new PageImage(this.page, { width, height });
    this._copyBaseAttributesInto(clone, { copyChildren: false });
    return clone;
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

/** How a PDF becomes a deck: its URL or data, its title and whether the outline opens. */
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
/** What `pdfPages` opens: a URL (a `data:` URL included) or the file's bytes. */
export interface PdfSource {
  url?: string;
  data?: ArrayBuffer | Uint8Array;
}

/** The absolute URL of a PDF, as pdf.js takes it; a `data:` URL as it is. */
export function pdfUrl(url: string): string {
  return url.startsWith('data:') ? url : new URL(url, typeof location !== 'undefined' ? location.href : undefined).href;
}

/**
 * The pages of a PDF as slides under a hidden root: in a row, the shape of a deck opened from a
 * PDF (`spacing` is the distance between page centers as a multiple of the largest page side,
 * three so that a padded view never reaches the next page), or stacked at one place (`stack`),
 * the shape of a document placed inside a slide with `[[pdf: file]]`, where the first page shows
 * and every next one appears over the previous as the camera cuts to it.
 */
export async function pdfPages(source: PdfSource, options: { name?: string; spacing?: number; stack?: boolean } = {}): Promise<Slide> {
  if (source.url === undefined && source.data === undefined) throw new Error('pdfPages requires url or data');
  const { getDocument } = await loadPdfJs();
  const url = source.url === undefined ? undefined : pdfUrl(source.url);
  const data = source.data instanceof Uint8Array ? source.data : source.data ? new Uint8Array(source.data) : undefined;
  const document = await getDocument(url !== undefined ? { url } : { data }).promise;
  const names = await pageNames(document);
  const pages: Slide[] = [];
  for (let number = 1; number <= document.numPages; number++) {
    pages.push(new PdfPage(await document.getPage(number), number, names.get(number) ?? `Page ${number}`));
  }
  return pageSequence(pages, { name: options.name ?? 'Document', spacing: options.spacing, stack: options.stack });
}

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
