/** Deck definitions for Markdown documents, their settings in their front matter. */
import { defineDeck, type DeckDefinition, type ResolvedDeck, type ViewportSize } from '../deck';
import { PresenterConfig, type PresenterConfigOptions } from '../runtime';
import { MarkupParser } from './parser';
import { MarkupError, normalizeStyles } from './ast';
import type { MacroDefinition } from './latex';
import { describeOrigin, expandImports } from './imports';
import { LayoutConfig, type LayoutConfigOptions } from './renderer';
import { SlideBuilder, type SlideNamespace } from './slide';
import { loadDefaultFonts } from '../fonts';
import { preloadMathJax } from 'manim-web';
import type { SourceLocation } from '../slides';
import type { ArtworkModule } from '../icons';
import type { EffectModule } from '../animations';
import type { ChartModule } from '../charts';
import { CodeSlideSpec, IncludeSpec } from './ast';
import type { DirectiveModule } from '../directives';
import { transitionFromModule, type TransitionModule } from '../runtime';
import { pdfPages } from '../pdfdeck';
import type { Slide } from '../slides';
import { FOLDER_SETTINGS, parseSettings, resolveSettings, splitFrontMatter, type DeckSettings } from './frontmatter.mjs';

/**
 * What a Markdown deck is made with: the source or URL, preloaded files and assets, and the
 * library folders and modules. The settings (title, layout, presenter, macros, styles, themes,
 * folders) come from the Markdown's front matter; given here, they win over it.
 */
export interface MarkupDeckOptions {
  /** Markdown source text. Provide this, `url`, or both when the text at `url` is read already. */
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
  /** LaTeX macros for every formula: an expansion, or [expansion, number of arguments, default of an optional first one]. */
  macros?: Record<string, MacroDefinition>;
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
  /** Folders with font files (`Family.woff2`, `-Bold`, `-Italic`, `-BoldItalic` variants); `fonts/` next to the document is searched anyway. */
  fonts?: string[];
  /** Folders with effect modules for `[[effect: name …]]`; `effects/` next to the document is searched anyway. */
  effects?: string[];
  /** Folders with chart modules for `type=`; `charts/` next to the document is searched anyway. */
  charts?: string[];
  /** Folders with language profiles (`lang.json`) for listings; `languages/` next to the document is searched anyway. */
  languages?: string[];
  /** Folders with code themes (`name.json`) for `layout.codeTheme`; `code-themes/` next to the document is searched anyway. */
  codeThemes?: string[];
  /** Folders with themes, style sheets as `name.md` (`::: styles` blocks); `themes/` next to the document is searched anyway. */
  themes?: string[];
  /** The theme(s) to apply, by name, before the deck's own `styles`. */
  theme?: string | string[];
  /** Folders with slide classes, `Name.js`/`.ts` exporting the class, for `[[subslide: Name]]`; `slides/` next to the document is searched anyway. */
  slides?: string[];
  /** Folders with directive modules for `[[name: …]]` the dialect does not know; `directives/` next to the document is searched anyway. */
  directives?: string[];
  /** Folders with snippets, `name.md` with `{{placeholders}}`, for `[[snippet: name …]]`; `snippets/` next to the document is searched anyway. */
  snippets?: string[];
  /** Folders with camera transition modules for `transition=name`; `transitions/` next to the document is searched anyway. */
  transitions?: string[];
  effectModules?: Record<string, EffectModule>;
  chartModules?: Record<string, ChartModule>;
  directiveModules?: Record<string, DirectiveModule>;
  transitionModules?: Record<string, TransitionModule>;
  /** Slide classes bundled ahead of time, by name, as an export carries them. */
  slideModules?: Record<string, unknown>;
}

/**
 * `folders` ending in a slash; with `base`, relative ones become absolute URLs against it (a file
 * extended names folders relative to itself, while the document may live elsewhere). Without a
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

/** A module `Name.js`, `.mjs` or `.ts` in the first of `folders` (relative to `base`) that serves it as JavaScript; null when none does. */
async function libraryModule(name: string, folders: string[], base: string | undefined): Promise<unknown> {
  if (typeof fetch === 'undefined') return null;
  for (const folder of folders) {
    for (const extension of ['js', 'mjs', 'ts']) {
      let url: string;
      try {
        url = new URL(`${folder}${name}.${extension}`, base).href;
      } catch {
        continue;
      }
      try {
        const response = await fetch(url, { method: 'HEAD' });
        if (!response.ok || !/javascript|ecmascript|typescript/.test(response.headers.get('content-type') ?? '')) continue;
        return await import(/* @vite-ignore */ url);
      } catch {
        /* the next candidate */
      }
    }
  }
  return null;
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

/** The library folders of a deck: those the options name, and the standard ones next to a document loaded by URL. */
function libraryFolders(options: MarkupDeckOptions) {
  const standard = (name: string) => (options.url !== undefined ? [`${name}/`] : []);
  const kind = (named: string[] | undefined, name: string) => [...resolveFolders(named), ...standard(name)];
  return {
    paths: resolveFolders(options.paths),
    artworks: kind(options.artworks, 'artworks'),
    fonts: kind(options.fonts, 'fonts'),
    effects: kind(options.effects, 'effects'),
    charts: kind(options.charts, 'charts'),
    languages: kind(options.languages, 'languages'),
    codeThemes: kind(options.codeThemes, 'code-themes'),
    themes: kind(options.themes, 'themes'),
    slides: kind(options.slides, 'slides'),
    directives: kind(options.directives, 'directives'),
    snippets: kind(options.snippets, 'snippets'),
    transitions: kind(options.transitions, 'transitions'),
  };
}

/** The URL the document's relative paths resolve against. */
function deckBase(options: MarkupDeckOptions): string | undefined {
  const here = typeof location !== 'undefined' ? location.href : undefined;
  if (options.basePath) return options.basePath;
  if (options.url !== undefined) {
    try {
      return new URL(options.url, here).href;
    } catch {
      return here;
    }
  }
  return here;
}

/** A reader of the deck's library text files: preloaded in a bundle, else the first folder that serves the file. */
function libraryReader(options: MarkupDeckOptions, base: string | undefined, paths: string[]): (file: string, folders: string[]) => Promise<string | null> {
  const files = options.files ?? {};
  const assets = options.assets ?? {};
  return async (file, folders) => {
    const clean = file.replace(/^\.\//, '');
    for (const folder of folders) {
      const preloaded = files[folder + clean] ?? assets[folder + clean];
      if (preloaded !== undefined) return preloaded.startsWith('data:') ? await (await fetch(preloaded)).text() : preloaded;
    }
    if (typeof fetch === 'undefined') return null;
    for (const folder of [...folders, ...paths]) {
      try {
        const response = await fetch(new URL(folder + clean, base).href);
        if (response.ok && !(response.headers.get('content-type') ?? '').includes('text/html')) return response.text();
      } catch {
        /* the next folder */
      }
    }
    return null;
  };
}

/** What a theme sets: styles, and the deck settings a Markdown theme gives under `layout:`, `presenter:` and `deck:`. */
export interface ThemeParts {
  styles?: Record<string, string | Record<string, unknown>>;
  layout?: LayoutConfigOptions;
  presenter?: PresenterConfigOptions;
  background?: string;
  viewport?: ViewportSize;
}

const THEME_SECTIONS = new Set(['layout', 'presenter', 'deck']);

function themeValue(value: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/**
 * Parse a theme: a Markdown file whose `::: styles` blocks (or every line) define styles, with
 * the reserved names `layout:`, `presenter:` and `deck:` (`background=`, `viewport=16x9`) for
 * the deck settings.
 */
export function parseTheme(text: string): ThemeParts {
  const parts: ThemeParts = { styles: {} };
  for (const [name, attributes] of Object.entries(MarkupParser.parseStyles(text))) {
    if (!THEME_SECTIONS.has(name)) {
      (parts.styles as Record<string, Record<string, unknown>>)[name] = attributes;
      continue;
    }
    const values = Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, themeValue(String(value))]));
    if (name === 'layout') parts.layout = values as LayoutConfigOptions;
    else if (name === 'presenter') parts.presenter = values as PresenterConfigOptions;
    else {
      if (typeof values.background === 'string') parts.background = values.background;
      if (typeof values.viewport === 'string') {
        const [width, height] = values.viewport.split(/[x×:\s]+/).map(Number);
        if (width > 0 && height > 0) parts.viewport = { width, height };
        else throw new MarkupError(`A theme's viewport is written as 16x9, not ${JSON.stringify(values.viewport)}`);
      }
    }
  }
  return parts;
}

/** `theme` over `base`: a later theme's settings win. */
function mergeThemes(base: ThemeParts, theme: ThemeParts): ThemeParts {
  return {
    styles: { ...(base.styles ?? {}), ...(theme.styles ?? {}) },
    layout: { ...(base.layout ?? {}), ...(theme.layout ?? {}) },
    presenter: { ...(base.presenter ?? {}), ...(theme.presenter ?? {}) },
    background: theme.background ?? base.background,
    viewport: theme.viewport ?? base.viewport,
  };
}

/** The options with a theme under them: the deck's own settings and styles win. */
export function applyTheme(options: MarkupDeckOptions, theme: ThemeParts): MarkupDeckOptions {
  return {
    ...options,
    theme: undefined,
    styles: { ...(theme.styles ?? {}), ...(options.styles ?? {}) },
    layout: options.layout instanceof LayoutConfig ? options.layout : { ...(theme.layout ?? {}), ...(options.layout ?? {}) },
    presenter: options.presenter instanceof PresenterConfig ? options.presenter : { ...(theme.presenter ?? {}), ...(options.presenter ?? {}) },
    background: options.background ?? theme.background,
    viewport: options.viewport ?? theme.viewport,
  };
}

/**
 * The options with a deck's settings under them: what the options say wins, maps (layout,
 * presenter, macros, styles) merge entry by entry, and the options' folders come before the
 * settings' ones.
 */
function withSettings(options: MarkupDeckOptions, settings: DeckSettings): MarkupDeckOptions {
  const folders = Object.fromEntries(FOLDER_SETTINGS.map((key) => {
    const own = (options as Record<string, unknown>)[key] as string[] | undefined;
    const theirs = (settings as Record<string, unknown>)[key] as string[] | undefined;
    return [key, own || theirs ? [...(own ?? []), ...(theirs ?? [])] : undefined];
  }));
  return {
    ...options,
    ...folders,
    title: options.title ?? settings.title,
    root: options.root ?? settings.root,
    background: options.background ?? settings.background,
    viewport: options.viewport ?? settings.viewport,
    showOutline: options.showOutline ?? settings.showOutline,
    theme: options.theme ?? settings.theme,
    layout: options.layout instanceof LayoutConfig ? options.layout : { ...(settings.layout as LayoutConfigOptions | undefined), ...options.layout },
    presenter: options.presenter instanceof PresenterConfig ? options.presenter : { ...(settings.presenter as PresenterConfigOptions | undefined), ...options.presenter },
    macros: settings.macros || options.macros ? { ...(settings.macros as Record<string, MacroDefinition> | undefined), ...options.macros } : undefined,
    styles: settings.styles || options.styles ? { ...settings.styles, ...options.styles } : undefined,
  };
}

/**
 * Build a deck definition from a markup document: read it, take the settings of its front matter
 * and of the files it `extends`, load its slide classes, and apply the theme(s) it names (`name.md`
 * in the themes folders, in order, under the deck's own styles, layout, presenter settings,
 * background and viewport). Options given here win over the front matter. The way to open a deck
 * by its URL: every setting is known before the player starts.
 */
export async function loadMarkupDeck(options: MarkupDeckOptions): Promise<ResolvedDeck> {
  const here = typeof location !== 'undefined' ? location.href : undefined;
  const url = options.url !== undefined ? new URL(options.url, here).href : undefined;
  let text = options.source;
  if (text === undefined) {
    if (url === undefined) throw new Error('loadMarkupDeck requires source or url');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot load ${options.url} (${response.status})`);
    text = await response.text();
  }
  const where = url ?? options.basePath ?? here ?? 'the deck';
  let resolved: Awaited<ReturnType<typeof resolveSettings>>;
  try {
    resolved = await resolveSettings(text, where, {
      read: async (target) => {
        const response = await fetch(target);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      },
      join: (base, path) => new URL(path, base).href,
    });
  } catch (error) {
    throw new MarkupError((error as Error).message);
  }
  let classes = options.classes ?? options.imports;
  if (!classes && resolved.settings.classes) classes = (await import(/* @vite-ignore */ resolved.settings.classes)) as SlideNamespace;
  const merged = withSettings({ ...options, classes, source: resolved.body, url: options.url }, resolved.settings);
  const names = [merged.theme ?? []].flat();
  if (!names.length) return markupDeck({ ...merged, theme: undefined });
  const folders = libraryFolders(merged);
  const read = libraryReader(merged, deckBase(merged), folders.paths);
  let theme: ThemeParts = {};
  for (const name of names) {
    const markdown = await read(`${name}.md`, folders.themes);
    if (markdown === null) throw new MarkupError(`No theme ${name}.md in the deck's themes folders`);
    theme = mergeThemes(theme, parseTheme(markdown));
  }
  return markupDeck(applyTheme(merged, theme));
}

/**
 * Build a deck definition from a markup document given as text, its front matter applied under
 * the options; with only a URL, the document must have no front matter (`loadMarkupDeck` reads
 * one before the player starts).
 */
export function markupDeck(options: MarkupDeckOptions): ResolvedDeck {
  if (options.source === undefined && options.url === undefined) throw new Error('markupDeck requires source or url');
  if (options.source !== undefined) {
    const { yaml, body } = splitFrontMatter(options.source);
    if (yaml !== null) {
      const settings = parseSettings(yaml, options.url ?? 'the deck');
      if (settings.extends || settings.theme || settings.classes) {
        throw new Error('A deck whose front matter extends a file, names a theme or slide classes is opened by loadMarkupDeck, which loads them before the player starts');
      }
      const base = deckBase(options);
      for (const key of FOLDER_SETTINGS) {
        const folders = (settings as Record<string, unknown>)[key] as string | string[] | undefined;
        if (folders !== undefined) (settings as Record<string, unknown>)[key] = resolveFolders([folders].flat(), base);
      }
      options = withSettings({ ...options, source: body }, settings);
    }
  }
  const layout = options.layout instanceof LayoutConfig ? options.layout : new LayoutConfig(options.layout ?? {});
  if (options.theme !== undefined) throw new Error('A theme is applied by loadMarkupDeck, which loads it before the player starts: use it in place of markupDeck');
  // The presenter's table of camera transitions is filled when the deck loads; it is shared by reference.
  const presenter = options.presenter instanceof PresenterConfig ? options.presenter : new PresenterConfig({ ...(options.presenter ?? {}), transitions: { ...(options.presenter?.transitions ?? {}) } });
  const transitions = presenter.transitions;
  const definition: DeckDefinition = {
    title: options.title ?? defaultTitle(options.url ?? options.basePath),
    presenter,
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
        if (source === undefined) {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Cannot load ${options.url} (${response.status})`);
          source = await response.text();
          if (splitFrontMatter(source).yaml !== null) {
            throw new MarkupError(`${options.url} has front matter: open it with loadMarkupDeck, which reads its settings before the player starts`);
          }
        }
        basePath = basePath ?? url;
      }
      // The fonts, and MathJax when the markup has formulas, load while the markup is parsed and
      // the slides are built, instead of stalling the first line of text or the first formula.
      void loadDefaultFonts();
      if (/\$/.test(source as string)) void preloadMathJax().catch(() => undefined);
      const files = options.files ?? {};
      const base = basePath || (typeof location !== 'undefined' ? location.href : undefined);
      // The library folders: relative to the document (or keys of a bundle), or absolute URLs.
      const folders = libraryFolders(options);
      const { paths } = folders;
      const read = libraryReader(options, base, paths);
      const expanded = await expandImports(source as string, {
        snippet: (name) => read(`${name}.md`, folders.snippets),
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
      // Slide classes: the module given, the bundled ones, and `Name.ts` in the slides folders for what is still missing.
      const namespace: SlideNamespace = { ...(options.classes ?? options.imports ?? {}), ...(options.slideModules ?? {}) };
      for (const slide of document.slides) {
        for (const item of slide.items) {
          if (!(item instanceof CodeSlideSpec)) continue;
          const name = item.className.split('.')[0];
          if (name in namespace) continue;
          const found = await libraryModule(name, folders.slides, base);
          if (found) {
            const exported = found as Record<string, unknown>;
            namespace[name] = (exported[name] ?? exported.default ?? found) as SlideNamespace[string];
          }
        }
      }
      // Camera transitions of the deck's own, named by slides, includes or the presenter: loaded now, into the presenter's table.
      const named = new Set<string>();
      const note = (mode: unknown) => {
        if (typeof mode === 'string' && mode !== 'zoom' && mode !== 'cut') named.add(mode);
      };
      note(presenter.transition);
      for (const slide of document.slides) {
        note(slide.attributes.transition);
        for (const item of slide.items) if (item instanceof IncludeSpec) note(item.attributes.transition);
      }
      for (const name of named) {
        if (name in transitions) continue;
        const module = options.transitionModules?.[name] ?? ((await libraryModule(name, folders.transitions, base)) as TransitionModule | null);
        if (!module) throw new MarkupError(`Unknown transition ${JSON.stringify(name)}: not zoom or cut and no ${name}.js or ${name}.ts in the deck's transitions folders`);
        transitions[name] = transitionFromModule(module, name);
      }
      // The documents placed with [[pdf: file]] load now, their pages as slides under a hidden root.
      const documents = new Map<string, Slide>();
      for (const slide of document.slides) {
        const src = slide.placeholder ? slide.attributes.src : undefined;
        if (!src) continue;
        const clean = src.replace(/^\.\//, '');
        const preloaded = (options.assets ?? {})[src] ?? (options.assets ?? {})[clean];
        let url = preloaded ?? new URL(src, base).href;
        if (!preloaded && typeof fetch !== 'undefined') {
          // The document's own folder first, then the search folders.
          for (const candidate of [url, ...paths.map((folder) => new URL(folder + clean, base).href)]) {
            try {
              const response = await fetch(candidate, { method: 'HEAD' });
              if (response.ok && !(response.headers.get('content-type') ?? '').includes('text/html')) {
                url = candidate;
                break;
              }
            } catch {
              /* the next candidate */
            }
          }
        }
        try {
          documents.set(slide.id, await pdfPages({ url }, { name: clean.split('/').pop() ?? clean, stack: true }));
        } catch (error) {
          throw new MarkupError(`Cannot open the PDF ${src} (${(error as Error).message})`, slide.line);
        }
      }
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
        namespace: Object.keys(namespace).length ? namespace : null, macros: options.macros, assets: options.assets, locate,
        paths, artworks: folders.artworks, artworkModules: options.artworkModules,
        fonts: folders.fonts, effects: folders.effects, charts: folders.charts, languages: folders.languages, codeThemes: folders.codeThemes,
        directives: folders.directives, effectModules: options.effectModules, chartModules: options.chartModules, directiveModules: options.directiveModules,
        documents,
      });
    },
  };
  return defineDeck(definition);
}

/**
 * A deck's title when its front matter gives none: the name of the folder holding the Markdown
 * (`tour` for `tour/slides.md`), else the file's own name, else Zoomdeck. The same wherever the
 * deck is opened or built.
 */
export function defaultTitle(location: string | undefined): string {
  if (!location) return 'Zoomdeck';
  let path = location;
  try {
    path = decodeURIComponent(new URL(location, 'file:///').pathname);
  } catch {
    /* a plain path */
  }
  const parts = path.split('/').filter(Boolean);
  const file = parts.pop();
  const folder = parts.pop();
  return folder ?? file?.replace(/\.[^.]+$/, '') ?? 'Zoomdeck';
}
