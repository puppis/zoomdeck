/**
 * Load a deck definition, run its program once to record clips, and start
 * the interactive player.
 */
import { defineDeck, type DeckDefinition, type ResolvedDeck } from '../deck';
import { Presenter, type NavigationData, type ProgressEvent } from '../runtime';
import { Player } from './player';
import { PlayerUI } from './ui';
import { Stage } from './stage';
import { LinkLayer } from './links';
import { IframeLayer } from './iframes';
import { VideoClip } from '../video';
import { loadDefaultFonts } from '../fonts';
import type { Bookmark } from '../position';
import { RasterImage } from '../raster';

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
  const stage = new Stage(ui.stageHost, {
    background: deck.background,
    viewportAspect: deck.viewport.width / deck.viewport.height,
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
  const links = new LinkLayer(ui.stageHost, stage);
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
  ui.bind(player, stage, navigation);
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
    // An editing-preview reload restores the slide and step saved before unloading.
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (resume === null && saved) resume = JSON.parse(saved) as Bookmark;
      sessionStorage.removeItem(storageKey);
    } catch {
      /* storage unavailable */
    }
    window.addEventListener('beforeunload', () => {
      try {
        const position = windowWithPosition.zoomdeckPosition?.();
        if (position) sessionStorage.setItem(storageKey, JSON.stringify(position));
      } catch {
        /* storage unavailable */
      }
    });
    const match = location.hash.match(/^#step=(\d+)$/);
    hashStep = match ? Number(match[1]) - 1 : null;
    // `#slide=id` opens the first stop of a markup slide (by ID) or of a slide (by name).
    const slideLink = location.hash.match(/^#slide=(.+)$/);
    if (slideLink) {
      const wanted = decodeURIComponent(slideLink[1]);
      const slide = navigation.slides.find((candidate) => candidate.key === `markup:${wanted}`) ?? navigation.slides.find((candidate) => candidate.name === wanted);
      const first = slide ? player.firstEntry(slide.id) : -1;
      if (first >= 0) hashStep = first;
    }
  }
  const restored = resumedClip(resume, navigation);
  const startClip = navigation.startSlide === null ? null : player.firstEntry(navigation.startSlide);
  const initial = restored ?? (startClip !== null && startClip >= 0 ? startClip : hashStep ?? 0);
  stage.fit();
  await player.goTo(initial >= 0 && initial < navigation.clips.length ? initial : 0, false);
  return { presenter, player, stage, ui, navigation };
}
