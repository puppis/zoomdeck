/** Convenience deck definitions for Markdown documents and JSON deck configurations. */
import { defineDeck, type DeckDefinition, type ResolvedDeck, type ViewportSize } from '../deck';
import { PresenterConfig, type PresenterConfigOptions } from '../runtime';
import { MarkupParser } from './parser';
import { MarkupError, normalizeStyles } from './ast';
import { describeOrigin, expandImports } from './imports';
import { LayoutConfig, type LayoutConfigOptions } from './renderer';
import { SlideBuilder, type SlideNamespace } from './slide';
import { loadDefaultFonts } from '../fonts';
import { preloadMathJax } from 'manim-web';
import type { SourceLocation } from '../slides';
import type { ArtworkModule } from '../icons';

export interface MarkupDeckOptions {
  /** Markdown source text. Provide this or `url`. */
  source?: string;
  /** URL of the Markdown file; images resolve relative to it. */
  url?: string;
  /** Base URL for images when `source` is given directly. */
  basePath?: string;
  /** Explicit root slide ID; inferred when omitted. */
  root?: string;
  title?: string;
  layout?: LayoutConfig | LayoutConfigOptions;
  presenter?: PresenterConfig | PresenterConfigOptions;
  background?: string;
  viewport?: ViewportSize;
  showOutline?: boolean;
  /** Slide classes available to `[[subslide: Name]]` directives. */
  classes?: SlideNamespace;
  /** @deprecated Use `classes`. */
  imports?: SlideNamespace;
  /**
   * Markdown files available to `[[import: path]]`, keyed by path relative to the main
   * document; other paths are fetched relative to it (or to `basePath`).
   */
  files?: Record<string, string>;
  /** LaTeX macros for MathJax. */
  macros?: Record<string, string>;
  /** Preloaded assets (path relative to the markup file → URL or data URI) for single-file bundles. */
  assets?: Record<string, string>;
  /** Named styles: attribute strings (`"font_size=18 color=GRAY"`) or objects, applied by role or `.class`. */
  styles?: Record<string, string | Record<string, unknown>>;
  /**
   * Folders searched, after the document's own, for the files it names: imported Markdown,
   * images, videos, pages. Relative to the document (or to `basePath`); absolute URLs as they are.
   */
  paths?: string[];
  /**
   * Folders searched for artworks, `[[artwork: name]]` or an `[[icon: name]]` that is not built in:
   * `name.svg`, or `name.js`, `.mjs` or `.ts` exporting a drawing. Relative to the document;
   * an `artworks/` folder next to it is searched as well, then the `paths`.
   */
  artworks?: string[];
  /** Artwork modules bundled ahead of time, by name, as an export carries them. */
  artworkModules?: Record<string, ArtworkModule>;
}

/**
 * `folders` ending in a slash; with `base`, relative ones become absolute URLs against it (a
 * deck.json names folders relative to itself, while the document may live elsewhere). Without a
 * base they stay relative, to the document or to the keys of a bundle.
 */
export function resolveFolders(folders: string[] | undefined, base?: string): string[] {
  return (folders ?? []).map((folder) => {
    const slashed = folder.endsWith('/') ? folder : `${folder}/`;
    if (!base || /^(?:[a-z]+:)?\/\//i.test(slashed) || slashed.startsWith('/')) return slashed;
    try {
      return new URL(slashed, base).href;
    } catch {
      return slashed;
    }
  });
}

/** The folder of a document URL, as an absolute URL with a trailing slash; undefined without one. */
function deckFolder(url: string | undefined): string | undefined {
  if (!url) return undefined;
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

/** Build a deck definition from a markup document. */
export function markupDeck(options: MarkupDeckOptions): ResolvedDeck {
  const layout = options.layout instanceof LayoutConfig ? options.layout : new LayoutConfig(options.layout ?? {});
  if (options.source === undefined && options.url === undefined) throw new Error('markupDeck requires source or url');
  if (options.source !== undefined && options.url !== undefined) throw new Error('Set either source or url, not both');
  const definition: DeckDefinition = {
    title: options.title ?? (options.url ? options.url.split('/').pop()?.replace(/\.[^.]+$/, '') : undefined) ?? 'Zoomdeck',
    presenter: options.presenter,
    foreground: layout.color,
    background: options.background,
    viewport: options.viewport,
    showOutline: options.showOutline,
    base: deckFolder(options.url ?? options.basePath),
    deck: async () => {
      let source = options.source;
      let basePath = options.basePath;
      if (options.url !== undefined) {
        const url = new URL(options.url, typeof location !== 'undefined' ? location.href : undefined).href;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Cannot load ${options.url} (${response.status})`);
        source = await response.text();
        basePath = basePath ?? url;
      }
      // The fonts, and MathJax when the markup has formulas, load while the markup is parsed and
      // the slides are built, instead of stalling the first line of text or the first formula.
      void loadDefaultFonts();
      if (/\$/.test(source as string)) void preloadMathJax().catch(() => undefined);
      const files = options.files ?? {};
      const base = basePath || (typeof location !== 'undefined' ? location.href : undefined);
      // Search folders: relative to the document (or keys of a bundle), or absolute URLs. An
      // `artworks/` folder next to a document loaded by URL is searched for artworks as well.
      const paths = resolveFolders(options.paths);
      const artworks = [...resolveFolders(options.artworks), ...(options.url !== undefined ? ['artworks/'] : [])];
      const expanded = await expandImports(source as string, {
        load: async (path) => {
          const clean = path.replace(/^\.\//, '');
          const preloaded = files[path] ?? files[clean];
          if (preloaded !== undefined) return preloaded;
          for (const folder of paths) {
            const inFolder = files[folder + clean];
            if (inFolder !== undefined) return inFolder;
          }
          // The document's own folder first, then each search folder; the first that answers.
          const candidates = [path, ...paths.map((folder) => folder + clean)].map((candidate) => new URL(candidate, base).href);
          let status = 0;
          for (const candidate of candidates) {
            const response = await fetch(candidate);
            if (response.ok) return response.text();
            status = status || response.status;
          }
          throw new Error(`HTTP ${status}`);
        },
      });
      // Errors name the imported file a line came from.
      MarkupError.describe = (line) => describeOrigin(expanded.origins[line - 1], line);
      const document = new MarkupParser().parse(expanded.source, { root: options.root, basePath, styles: normalizeStyles(options.styles) });
      const namespace = options.classes ?? options.imports ?? null;
      // Slides and stops remember the document (a URL under the preview server) and line they came from.
      const main = options.url !== undefined ? new URL(options.url, typeof location !== 'undefined' ? location.href : undefined).href : '';
      const locate = (line: number): SourceLocation => {
        const origin = expanded.origins[line - 1];
        if (!origin) return { file: main, line };
        if (!origin.file) return { file: main, line: origin.line };
        let file = origin.file;
        try {
          file = new URL(origin.file, basePath || main || undefined).href;
        } catch {
          /* no base to resolve against: keep the relative path */
        }
        return { file, line: origin.line };
      };
      return new SlideBuilder({ layout }).build(document, {
        namespace, macros: options.macros, assets: options.assets, locate, paths, artworks, artworkModules: options.artworkModules,
      });
    },
  };
  return defineDeck(definition);
}

/** JSON configuration placed next to a Markdown deck (`deck.json`). */
export interface DeckConfig {
  markup: string;
  title?: string;
  root?: string;
  layout?: LayoutConfigOptions;
  presenter?: PresenterConfigOptions;
  background?: string;
  viewport?: ViewportSize;
  showOutline?: boolean;
  macros?: Record<string, string>;
  /** Named styles applied by role (`heading`, `body`, `code`, …) or `.class` tokens. */
  styles?: Record<string, string | Record<string, unknown>>;
  /** Module URL exporting slide classes for `[[subslide: Name ...]]` directives. */
  classes?: string;
  /** @deprecated Use `classes`. */
  imports?: string;
  /** Folders searched, after the deck's own, for imported Markdown, images, videos and pages; relative to this file. */
  paths?: string[];
  /** Folders with artworks of the deck's own (`name.svg`, `name.js`, `name.ts`); `artworks/` next to the Markdown is searched anyway. */
  artworks?: string[];
}

/** Load a `deck.json` configuration and its Markdown document. */
export async function loadDeckConfig(configUrl: string, loadModule?: (url: string) => Promise<SlideNamespace>): Promise<ResolvedDeck> {
  const url = new URL(configUrl, typeof location !== 'undefined' ? location.href : undefined).href;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load ${configUrl} (${response.status})`);
  const config = (await response.json()) as DeckConfig;
  if (typeof config.markup !== 'string') throw new Error('deck.json requires a "markup" path');
  let classes: SlideNamespace | undefined;
  const modulePath = config.classes ?? config.imports;
  if (modulePath) {
    const moduleUrl = new URL(modulePath, url).href;
    classes = loadModule ? await loadModule(moduleUrl) : ((await import(/* @vite-ignore */ moduleUrl)) as SlideNamespace);
  }
  return markupDeck({
    url: new URL(config.markup, url).href,
    title: config.title,
    root: config.root,
    layout: config.layout,
    presenter: config.presenter,
    background: config.background,
    viewport: config.viewport,
    showOutline: config.showOutline,
    macros: config.macros,
    styles: config.styles,
    classes,
    paths: resolveFolders(config.paths, url),
    artworks: resolveFolders(config.artworks, url),
  });
}
