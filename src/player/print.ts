/**
 * Printing a deck: every stage a presentation passes through (or the last stage of each slide)
 * rendered by the deck's own engine at a chosen resolution, one per page of a PDF, with the
 * slide tree as the document's outline. The deck navigates through its stops while the pages
 * are drawn, then returns to where it was.
 */
import type { NavigationData } from '../runtime';
import { RasterImage } from '../raster';
import { VideoClip } from '../video';
import type { Player } from './player';
import type { Stage } from './stage';
import { buildPdf, encodeCanvas, type PdfImage, type PdfOutlineItem } from './pdf';

/** Which stops become pages: every stage, or only the last stage of each slide. */
export type PrintPages = 'stages' | 'slides';

export interface PrintPage {
  /** Index of the clip (the stop) shown on the page. */
  clip: number;
  slide: number;
}

/** Page widths offered, in pixels; the height follows the deck's proportions. */
export const PRINT_WIDTHS: Array<[number, string]> = [[1920, 'Full HD (1920 px)'], [2560, 'QHD (2560 px)'], [3840, '4K (3840 px)']];

/**
 * The stops to print, in presentation order: the stages the presentation rests on. Returns to a
 * parent slide show nothing new, and a stop the presentation runs straight through (automatic
 * advancement, as before a looping movie) is seen only as the start of the next, so both are left out.
 */
export function printPages(navigation: NavigationData, mode: PrintPages): PrintPage[] {
  const pages: PrintPage[] = [];
  const last = navigation.clips.length - 1;
  navigation.clips.forEach((clip, index) => {
    if (clip.kind === 'return' || (clip.autoNext && index < last)) return;
    pages.push({ clip: index, slide: clip.slide });
  });
  if (mode === 'stages') return pages;
  const lastOfSlide = new Map<number, PrintPage>();
  for (const page of pages) lastOfSlide.set(page.slide, page);
  return pages.filter((page) => lastOfSlide.get(page.slide) === page);
}

/** The slide tree as PDF bookmarks, each pointing at the first page of its slide. */
export function printOutline(navigation: NavigationData, pages: PrintPage[]): PdfOutlineItem[] {
  const firstPage = new Map<number, number>();
  pages.forEach((page, index) => {
    if (!firstPage.has(page.slide)) firstPage.set(page.slide, index);
  });
  const children = new Map<number | null, NavigationData['slides']>();
  for (const slide of navigation.slides) {
    const list = children.get(slide.parent) ?? [];
    list.push(slide);
    children.set(slide.parent, list);
  }
  // A slide without a page of its own (none in practice) points at its first descendant's page.
  const pageOf = (id: number): number | null => {
    const own = firstPage.get(id);
    if (own !== undefined) return own;
    for (const child of children.get(id) ?? []) {
      const page = pageOf(child.id);
      if (page !== null) return page;
    }
    return null;
  };
  const build = (parent: number | null, seen: Set<number>): PdfOutlineItem[] => {
    const items: PdfOutlineItem[] = [];
    for (const slide of children.get(parent) ?? []) {
      if (seen.has(slide.id)) continue;
      seen.add(slide.id);
      const page = pageOf(slide.id);
      if (page === null) continue;
      items.push({ title: slide.name, page, children: build(slide.id, seen) });
    }
    return items;
  };
  return build(null, new Set());
}

export interface PrintOptions {
  pages: PrintPages;
  /** Page width in pixels. */
  width: number;
  title: string;
  /** Called before each page is drawn, with the number done and the total. */
  onProgress?: (done: number, total: number) => void;
  /** Checked between pages; true abandons the printout. */
  cancelled?: () => boolean;
}

/** Points across a page: a 16:9 deck prints on a 960 × 540 pt page, the size of a widescreen slide. */
const PAGE_WIDTH_PT = 960;

/**
 * Render the pages and build the PDF. The player visits every printed stop at the print size,
 * so the window shows the pages passing by; it comes back to the current stop at the end.
 */
export async function printDeck(player: Player, stage: Stage, options: PrintOptions): Promise<Blob | null> {
  const pages = printPages(player.navigation, options.pages);
  if (!pages.length) throw new Error('There is nothing to print');
  const height = Math.round(options.width / stage.viewportAspect);
  const origin = player.settledIndex;
  const images: PdfImage[] = [];
  let cancelled = false;
  await stage.atPrintSize(options.width, height, async (capture) => {
    for (let i = 0; i < pages.length; i++) {
      if (options.cancelled?.()) {
        cancelled = true;
        return;
      }
      options.onProgress?.(i, pages.length);
      await player.goTo(pages[i].clip, false);
      // Pictures decode and videos seek after the fact: wait for the ones this stop shows.
      await RasterImage.settle();
      await VideoClip.settle();
      images.push(await encodeCanvas(capture()));
      // Let the progress reach the screen between pages.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    options.onProgress?.(pages.length, pages.length);
  });
  await player.goTo(origin, false);
  if (cancelled) return null;
  const bytes = buildPdf({
    title: options.title,
    pageWidth: PAGE_WIDTH_PT,
    pageHeight: PAGE_WIDTH_PT / stage.viewportAspect,
    pages: images,
    outline: printOutline(player.navigation, pages),
  });
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
