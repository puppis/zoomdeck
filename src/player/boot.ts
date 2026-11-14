/**
 * Load a deck definition, run its program once to record clips, and start
 * the interactive player.
 */
import { defineDeck, type DeckDefinition, type ResolvedDeck } from '../deck';
import { Presenter, type NavigationData, type ProgressEvent } from '../runtime';
import { Player } from './player';
import { PlayerUI } from './ui';
import { renderPixelRatio, type Feature } from './settings';
import { loadDeckConfig, markupDeck } from '../markup/deck';
import type { SlideNamespace } from '../markup/slide';
import { Stage } from './stage';
import { LinkLayer } from './links';
import { IframeLayer } from './iframes';
import { VideoClip } from '../video';
import { loadDefaultFonts } from '../fonts';
import { RASTER_STATS } from '../markup/text';
import type { Bookmark } from '../position';
import { RasterImage } from '../raster';
import { PageImage, pdfDeck } from '../pdfdeck';
import { PadLink, padLinkAvailable, padRoom } from './pad';
import { EditorSync, editorSyncAvailable } from './sync';

export interface RunDeckOptions {
  /** Element that receives the player page. Defaults to `document.body`. */
  host?: HTMLElement;
  /** Honour `#step=` and `?resume=` from the page location. Defaults to true. */
  useLocation?: boolean;
  /** Console progress reporting while slides prepare. Defaults to true. */
  log?: boolean;
  /**
   * The player is one element of a larger page: it fills its host, leaves the document's title,
   * colors and styles alone, and reads keys only while it has the focus. Defaults to false.
   */
  embedded?: boolean;
  /** Features to leave out, as `{ camera: false, record: false }`; everything is on by default. */
  features?: Partial<Record<Feature, boolean>>;
}

export interface RunningDeck {
  presenter: Presenter;
  player: Player;
  stage: Stage;
  ui: PlayerUI;
  navigation: NavigationData;
  /** Take the player out of the page: its elements, listeners and rendering resources. */
  destroy: () => void;
}

/** The stages shown on this page: each one redraws when a video or an image decodes. */
const stages = new Set<Stage>();

/** The clip a `#step=N` or `#slide=id` hash points at (a markup slide by ID, or any slide by name), or null. */
function clipForHash(hash: string, navigation: NavigationData, player: Player): number | null {
  const step = hash.match(/^#step=(\d+)$/);
  if (step) return Number(step[1]) - 1;
  const slideLink = hash.match(/^#slide=(.+)$/);
  if (!slideLink) return null;
  const wanted = decodeURIComponent(slideLink[1]);
  const slide = navigation.slides.find((candidate) => candidate.key === `markup:${wanted}`) ?? navigation.slides.find((candidate) => candidate.name === wanted);
  const first = slide ? player.firstEntry(slide.id) : -1;
  return first >= 0 ? first : null;
}

/** The share of the loading done, for the bar: the slides are prepared, then the presentation is recorded. */
function progressShare(event: ProgressEvent): { index: number; total: number } | null {
  const total = event.total ?? 0;
  if (event.phase === 'build' || event.phase === 'visit') return { index: event.index ?? 0, total };
  if (event.phase === 'prepared') return { index: total, total };
  return null;
}

function progressMessage(event: ProgressEvent): string | null {
  if (event.phase === 'build') {
    const label = event.id !== undefined ? ` ${typeof event.id === 'string' ? `id="${event.id}"` : `#${event.id}`} "${event.name}"` : '';
    return `Preparing slide ${event.index}/${event.total}${label}`;
  }
  if (event.phase === 'prepared') return `Prepared ${event.total} slides; recording the presentation…`;
  if (event.phase === 'visit') return `Recording slide ${event.index}/${event.total} "${event.name}"`;
  if (event.phase === 'traversed') return null;
  return null;
}

/** Resolve the clip a saved bookmark refers to, falling back to surviving ancestors. */
export function resumedClip(position: Bookmark | null, navigation: NavigationData): number | null {
  if (!position || typeof position.key !== 'string' || !Number.isInteger(position.step)) return null;
  const parents = Array.isArray(position.ancestors) ? position.ancestors.filter((key) => typeof key === 'string') : [];
  for (const key of [position.key, ...parents]) {
    const slide = navigation.slides.find((item) => item.key === key);
    const choices = slide ? navigation.clips.flatMap((clip, index) => (clip.slide === slide.id ? [index] : [])) : [];
    if (choices.length) {
      return choices[key === position.key ? Math.min(Math.max(position.step, 0), choices.length - 1) : 0];
    }
  }
  return navigation.clips.length ? 0 : null;
}

/** Build the page, record the deck and start playback. */
export async function runDeck(definition: DeckDefinition | ResolvedDeck, options: RunDeckOptions = {}): Promise<RunningDeck> {
  const deck = 'presenter' in definition && definition.presenter && 'transitionTime' in (definition.presenter as object) && 'title' in definition && typeof definition.title === 'string' && 'background' in definition
    ? (definition as ResolvedDeck)
    : defineDeck(definition as DeckDefinition);
  const host = options.host ?? document.body;
  const embedded = options.embedded ?? false;
  // A page that holds the player as one of its elements keeps its own URL and history.
  const useLocation = options.useLocation ?? !embedded;
  const log = options.log ?? true;
  const ui = new PlayerUI(host, deck, { useLocation, embedded, features: options.features });
  const abort = new AbortController();
  const signal = abort.signal;
  const started = performance.now();
  const rendering = ui.settings.rendering;
  const stage = new Stage(ui.stageHost, {
    background: deck.background,
    viewportAspect: deck.viewport.width / deck.viewport.height,
    antialias: rendering.antialias,
    pixelRatio: renderPixelRatio(rendering),
  });
  await loadDefaultFonts();
  const presenter = new Presenter({
    config: deck.presenter,
    viewportAspect: deck.viewport.width / deck.viewport.height,
    foreground: deck.foreground,
    progress: (event) => {
      const share = progressShare(event);
      if (share) ui.setLoading(share);
      const message = progressMessage(event);
      if (message && log) console.info(`[zoomdeck] [+${((performance.now() - started) / 1000).toFixed(1)}s] ${message}`);
    },
  });
  stage.attach(presenter);
  const links = new LinkLayer(ui.stageHost, stage, presenter);
  const iframes = new IframeLayer(ui.stageHost, stage, presenter);
  stage.afterRender.push(() => links.update(), () => iframes.update());
  try {
    const root = await deck.deck();
    await presenter.play(root);
  } catch (error) {
    ui.showError(error instanceof Error ? `${error.message}` : String(error));
    throw error;
  }
  const navigation = presenter.navigation();
  const player = new Player(stage, presenter, navigation);
  // Slides decoded after a settled state is shown must reach the screen, on every stage of the page.
  stages.add(stage);
  const players = new WeakMap<Stage, Player>();
  players.set(stage, player);
  let redraw: number | null = null;
  VideoClip.onUpdate = () => { for (const shown of stages) shown.render(); };
  RasterImage.onUpdate = () => {
    if (redraw !== null) return;
    redraw = requestAnimationFrame(() => {
      redraw = null;
      for (const shown of stages) if (!players.get(shown)?.runner.running) shown.render();
    });
  };
  PageImage.onUpdate = RasterImage.onUpdate;
  // Text is redrawn at the screen's resolution whenever the camera comes to rest or the stage is resized.
  player.on('state', ({ state }) => {
    if (state === 'playing') stage.unrestText();
    else stage.refreshText();
  });
  // Every visible line is redrawn after a resize; wait for the window to settle rather than redraw on each step.
  let refresh: number | null = null;
  stage.afterResize.push(() => {
    if (refresh !== null) clearTimeout(refresh);
    refresh = window.setTimeout(() => {
      refresh = null;
      stage.refreshText();
    }, 150);
  });
  ui.bind(player, stage, navigation);
  // Under the preview or development server a tablet can pair with this page (settings, Tablet).
  if (useLocation && padLinkAvailable()) ui.connectPad(new PadLink(padRoom()));
  // There, the editor and the player also follow each other: a line's stop, a stop's (or an element's) line.
  if (useLocation && editorSyncAvailable()) {
    const sync = new EditorSync(navigation, player);
    sync.listen();
    ui.editSource = (at) => {
      const location = at ? links.sourceAt(at.x, at.y) : null;
      void sync.open(location ?? undefined).then((problem) => {
        if (problem) ui.notice(problem);
      });
    };
  }
  if (log) console.info(`[zoomdeck] [+${((performance.now() - started) / 1000).toFixed(1)}s] Ready: ${navigation.clips.length} clips; ${RASTER_STATS.count} text rasters in ${Math.round(RASTER_STATS.ms)} ms`);

  // The same-origin editing shell transfers a logical bookmark across reloads.
  const windowWithPosition = window as Window & { zoomdeckPosition?: () => Bookmark | null };
  const position = () => {
    const current = player.index;
    const slide = navigation.slides.find((item) => item.id === navigation.clips[current]?.slide);
    if (!slide) return null;
    const ancestors: string[] = [];
    for (let parent = slide.parent; parent !== null; ) {
      const next = navigation.slides.find((item) => item.id === parent);
      if (!next) break;
      ancestors.push(next.key);
      parent = next.parent;
    }
    return {
      key: slide.key,
      ancestors,
      step: navigation.clips.slice(0, current).filter((clip) => clip.slide === slide.id).length,
      atEnd: player.atEnd,
    };
  };
  if (useLocation) windowWithPosition.zoomdeckPosition = position;
  let resume: Bookmark | null = null;
  let hashStep: number | null = null;
  const storageKey = `zoomdeck:${location.pathname}${location.search}`;
  if (useLocation) {
    try {
      resume = JSON.parse(new URLSearchParams(location.search).get('resume') ?? 'null');
    } catch {
      resume = null;
    }
    // A reload the preview server asks for after an edit restores the slide and step the page
    // stood at, saved just before it; a URL opened or reloaded by hand starts where its hash
    // says, or at the first stop.
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (resume === null && saved) resume = JSON.parse(saved) as Bookmark;
      sessionStorage.removeItem(storageKey);
    } catch {
      /* storage unavailable */
    }
    import.meta.hot?.on('vite:beforeFullReload', () => {
      try {
        const bookmark = position();
        if (bookmark) sessionStorage.setItem(storageKey, JSON.stringify(bookmark));
      } catch {
        /* storage unavailable */
      }
    });
    hashStep = clipForHash(location.hash, navigation, player);
    // A hash typed or pasted into the address bar of the open page moves the deck as a fresh load would.
    window.addEventListener('hashchange', () => {
      // A recording being played moves the deck itself; a hash changed meanwhile waits for the viewer to leave it.
      if (ui.playingBack) return;
      const index = clipForHash(location.hash, navigation, player);
      if (index !== null && index !== player.index) void player.goTo(index, false);
    }, { signal });
  }
  // `href=#slide=id` and `href=#step=N` on elements move within the deck instead of opening a page.
  links.navigate = (hash) => {
    const index = clipForHash(hash, navigation, player);
    if (index === null) return false;
    void player.goTo(index, false);
    return true;
  };
  // A tap (a press and release without movement) on an element with an href follows the link:
  // inside the deck by moving to the stop, elsewhere in a new tab. A drag over it still draws,
  // and the dot a tap would leave is taken back. A double-click still works as it did.
  const follow = (href: string): boolean => {
    if (href.startsWith('#')) return Boolean(links.navigate?.(href));
    window.open(href, '_blank', 'noopener,noreferrer');
    return true;
  };
  let tap: { x: number; y: number; at: number; href: string } | null = null;
  ui.stageHost.addEventListener('pointerdown', (event) => {
    tap = null;
    if (ui.playingBack || ui.drawingOn || event.button !== 0 || (event.target as Element | null)?.closest?.('iframe, button, select, input')) return;
    const href = links.linkAt(event.clientX, event.clientY);
    if (href) tap = { x: event.clientX, y: event.clientY, at: performance.now(), href };
  });
  document.addEventListener('pointerup', (event) => {
    const started = tap;
    tap = null;
    if (!started || event.button !== 0) return;
    if (performance.now() - started.at > 500 || Math.hypot(event.clientX - started.x, event.clientY - started.y) > 6) return;
    if (follow(started.href)) ui.dropTaps(1);
  }, { signal });
  ui.stageHost.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    // While drawing is on, links are inert and the pointer stays a pencil over them.
    ui.stageHost.classList.toggle('over-link', !ui.playingBack && !ui.drawingOn && !(event.buttons & 1) && links.linkAt(event.clientX, event.clientY) !== null);
  });
  ui.stageHost.addEventListener('dblclick', (event) => {
    if (ui.playingBack || ui.drawingOn || event.button !== 0) return;
    const hash = links.deckLinkAt(event.clientX, event.clientY);
    if (hash && links.navigate?.(hash)) {
      event.preventDefault();
      ui.dropTaps();
    }
  });
  const restored = resumedClip(resume, navigation);
  const startClip = navigation.startSlide === null ? null : player.firstEntry(navigation.startSlide);
  const initial = restored ?? (startClip !== null && startClip >= 0 ? startClip : hashStep ?? 0);
  stage.fit();
  await player.goTo(initial >= 0 && initial < navigation.clips.length ? initial : 0, false);
  stage.refreshText();
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    abort.abort();
    stages.delete(stage);
    if (useLocation && windowWithPosition.zoomdeckPosition === position) delete windowWithPosition.zoomdeckPosition;
    player.dispose();
    ui.dispose();
    links.dispose();
    iframes.dispose();
    stage.dispose();
  };
  return { presenter, player, stage, ui, navigation, destroy };
}

// ---------------------------------------------------------------------------
// A deck as one element of a larger page
// ---------------------------------------------------------------------------

/** What `mountDeck` shows: a deck definition, or the URL of a `deck.json`, of a Markdown file or of a PDF. */
export type DeckSource = DeckDefinition | ResolvedDeck | string;

export interface MountDeckOptions {
  /** Features to leave out, as `{ camera: false, record: false }`; everything is on by default. */
  features?: Partial<Record<Feature, boolean>>;
  /** Follow `#step=` in the page's URL and write it on every stop. Defaults to false: the page keeps its URL. */
  useLocation?: boolean;
  /** Console progress reporting while slides prepare. Defaults to false. */
  log?: boolean;
  /** The stop to show first, as an index from 0 or a slide name; the deck's own start otherwise. */
  start?: number | string;
}

export interface DeckEvents {
  /** The deck moved to a stop: its index from 0, the slide it belongs to and the step within that slide. */
  stop: { index: number; slide: string; step: number; total: number };
  /** The player's state changed: paused, playing, looping or finished. */
  state: { state: Player['state']; message: string };
}

/** A deck mounted in an element of the page, and the handle the page drives it with. */
export interface DeckHandle {
  readonly element: HTMLElement;
  readonly player: Player;
  readonly ui: PlayerUI;
  readonly stage: Stage;
  readonly navigation: NavigationData;
  /** The stop shown, from 0. */
  readonly index: number;
  /** How many stops the deck has. */
  readonly length: number;
  /** The slides, in outline order: their names, their nesting and the first stop of each. */
  readonly slides: ReadonlyArray<{ name: string; key: string; depth: number; first: number }>;
  /** Show a stop by index, or the first stop of a slide by name; `play` plays it from its start. */
  goTo(target: number | string, play?: boolean): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  home(): Promise<void>;
  replay(): Promise<void>;
  speed: number;
  toggleDrawing(on?: boolean): void;
  toggleWhiteboard(on?: boolean): void;
  toggleOutline(): void;
  fullscreen(): Promise<void>;
  on<K extends keyof DeckEvents>(event: K, listener: (event: DeckEvents[K]) => void): () => void;
  /** Take the deck out of the page and free its resources. */
  destroy(): void;
}

/** Load a `deck.json` (its slide modules through the browser's own `import`), a PDF or a Markdown file. */
async function loadSource(source: string): Promise<ResolvedDeck> {
  if (/\.json(\?|#|$)/.test(source)) {
    return loadDeckConfig(source, async (url) => (await import(/* @vite-ignore */ url)) as SlideNamespace);
  }
  if (/\.pdf(\?|#|$)/i.test(source)) return pdfDeck({ url: source });
  return markupDeck({ url: source });
}

/**
 * Show a deck inside `host`, an element of a larger page, and return the handle that drives it.
 * The player fills the element (give it a size), leaves the rest of the page alone, and reads
 * keys only while it has the focus, which a click on the slides gives it.
 */
export async function mountDeck(host: HTMLElement, source: DeckSource, options: MountDeckOptions = {}): Promise<DeckHandle> {
  const definition = typeof source === 'string' ? await loadSource(source) : source;
  const running = await runDeck(definition, {
    host,
    embedded: true,
    useLocation: options.useLocation ?? false,
    log: options.log ?? false,
    features: options.features,
  });
  const { player, ui, stage, navigation } = running;
  const depthOf = (id: number | null): number => {
    let depth = 0;
    for (let parent = id === null ? null : navigation.slides.find((slide) => slide.id === id)?.parent ?? null; parent !== null; depth++) {
      parent = navigation.slides.find((slide) => slide.id === parent)?.parent ?? null;
    }
    return depth;
  };
  const slides = navigation.slides.map((slide) => ({ name: slide.name, key: slide.key, depth: depthOf(slide.id), first: player.firstEntry(slide.id) }));
  const indexOf = (target: number | string): number | null => {
    if (typeof target === 'number') return Number.isInteger(target) && target >= 0 && target < navigation.clips.length ? target : null;
    const slide = navigation.slides.find((candidate) => candidate.key === `markup:${target}`) ?? navigation.slides.find((candidate) => candidate.name === target);
    const first = slide ? player.firstEntry(slide.id) : -1;
    return first >= 0 ? first : null;
  };
  if (options.start !== undefined) {
    const start = indexOf(options.start);
    if (start !== null) await player.goTo(start, false);
  }
  const handle: DeckHandle = {
    element: ui.root,
    player,
    ui,
    stage,
    navigation,
    get index() {
      return player.index;
    },
    get length() {
      return navigation.clips.length;
    },
    slides,
    async goTo(target, play = false) {
      const index = indexOf(target);
      if (index === null) throw new Error(`No stop ${JSON.stringify(target)} in this deck`);
      await player.goTo(index, play);
    },
    next: () => player.next(),
    previous: () => player.previous(),
    home: () => player.home(),
    replay: () => player.replay(),
    get speed() {
      return player.speed;
    },
    set speed(value: number) {
      player.speed = value;
    },
    toggleDrawing: (on) => ui.toggleDrawing(on),
    toggleWhiteboard: (on) => ui.toggleWhiteboard(on),
    toggleOutline: () => ui.toggleOutline(),
    fullscreen: () => ui.fullscreen(),
    on(event, listener) {
      if (event === 'stop') {
        return player.on('clipchange', ({ index }) => {
          const clip = navigation.clips[index];
          const slide = navigation.slides.find((candidate) => candidate.id === clip.slide);
          const step = navigation.clips.slice(0, index).filter((other) => other.slide === clip.slide).length;
          (listener as (event: DeckEvents['stop']) => void)({ index, slide: slide?.name ?? '', step, total: navigation.clips.length });
        });
      }
      return player.on('state', listener as (event: DeckEvents['state']) => void);
    },
    destroy: running.destroy,
  };
  return handle;
}
