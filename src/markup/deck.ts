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
      const expanded = await expandImports(source as string, {
        load: async (path) => {
          const preloaded = files[path] ?? files[path.replace(/^\.\//, '')];
          if (preloaded !== undefined) return preloaded;
          const base = basePath || (typeof location !== 'undefined' ? location.href : undefined);
          const response = await fetch(new URL(path, base).href);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.text();
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
      return new SlideBuilder({ layout }).build(document, { namespace, macros: options.macros, assets: options.assets, locate });
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
  });
}
