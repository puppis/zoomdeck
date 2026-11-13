/**
 * Load a deck definition, run its program once to record clips, and start
 * the interactive player.
 */
import { defineDeck, type DeckDefinition, type ResolvedDeck } from '../deck';
import { Presenter, type NavigationData, type ProgressEvent } from '../runtime';
import { Player } from './player';
import { PlayerUI } from './ui';
import { renderPixelRatio } from './settings';
import { Stage } from './stage';
import { LinkLayer } from './links';
import { IframeLayer } from './iframes';
import { VideoClip } from '../video';
import { loadDefaultFonts } from '../fonts';
import type { Bookmark } from '../position';
import { RasterImage } from '../raster';
import { PadLink, padLinkAvailable, padRoom } from './pad';
import { EditorSync, editorSyncAvailable } from './sync';

export interface RunDeckOptions {
  /** Element that receives the player page. Defaults to `document.body`. */
  host?: HTMLElement;
  /** Honour `#step=` and `?resume=` from the page location. Defaults to true. */
  useLocation?: boolean;
  /** Console progress reporting while slides prepare. Defaults to true. */
  log?: boolean;
}

export interface RunningDeck {
  presenter: Presenter;
  player: Player;
  stage: Stage;
  ui: PlayerUI;
  navigation: NavigationData;
}

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
  const useLocation = options.useLocation ?? true;
  const log = options.log ?? true;
  const ui = new PlayerUI(host, deck, { useLocation });
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
      const message = progressMessage(event);
      if (message) {
        ui.setLoading(message);
        if (log) console.info(`[zoomdeck] [+${((performance.now() - started) / 1000).toFixed(1)}s] ${message}`);
      }
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
  // Slides decoded after a settled state is shown must reach the screen.
  let redraw: number | null = null;
  VideoClip.onUpdate = () => stage.render();
  RasterImage.onUpdate = () => {
    if (redraw !== null || player.runner.running) return;
    redraw = requestAnimationFrame(() => {
      redraw = null;
      stage.render();
    });
  };
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
  if (log) console.info(`[zoomdeck] [+${((performance.now() - started) / 1000).toFixed(1)}s] Ready: ${navigation.clips.length} clips`);

  // The same-origin editing shell transfers a logical bookmark across reloads.
  const windowWithPosition = window as Window & { zoomdeckPosition?: () => Bookmark | null };
  windowWithPosition.zoomdeckPosition = () => {
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
        const position = windowWithPosition.zoomdeckPosition?.();
        if (position) sessionStorage.setItem(storageKey, JSON.stringify(position));
      } catch {
        /* storage unavailable */
      }
    });
    hashStep = clipForHash(location.hash, navigation, player);
    // A hash typed or pasted into the address bar of the open page moves the deck as a fresh load would.
    window.addEventListener('hashchange', () => {
      const index = clipForHash(location.hash, navigation, player);
      if (index !== null && index !== player.index) void player.goTo(index, false);
    });
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
    if (event.button !== 0 || (event.target as Element | null)?.closest?.('iframe, button, select, input')) return;
    const href = links.linkAt(event.clientX, event.clientY);
    if (href) tap = { x: event.clientX, y: event.clientY, at: performance.now(), href };
  });
  document.addEventListener('pointerup', (event) => {
    const started = tap;
    tap = null;
    if (!started || event.button !== 0) return;
    if (performance.now() - started.at > 500 || Math.hypot(event.clientX - started.x, event.clientY - started.y) > 6) return;
    if (follow(started.href)) ui.dropTaps(1);
  });
  ui.stageHost.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    ui.stageHost.classList.toggle('over-link', !(event.buttons & 1) && links.linkAt(event.clientX, event.clientY) !== null);
  });
  ui.stageHost.addEventListener('dblclick', (event) => {
    if (event.button !== 0) return;
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
  return { presenter, player, stage, ui, navigation };
}
