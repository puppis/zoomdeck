/** Deck definitions: the browser analogue of a `ZoomingScene` subclass. */
import type { Slide } from './slides';
import { PresenterConfig, type PresenterConfigOptions } from './runtime';

export interface ViewportSize {
  width: number;
  height: number;
}

export interface DeckDefinition {
  /** Title shown in the player outline and the browser tab. */
  title?: string;
  /** Return a fresh, unattached root slide. Called once per load. */
  deck: () => Slide | Promise<Slide>;
  /** Camera transitions and automatic stops for the whole deck. */
  presenter?: PresenterConfig | PresenterConfigOptions;
  /** Default element color, used by the player interface. Defaults to white. */
  foreground?: string;
  /** Camera background color. Defaults to white. */
  background?: string;
  /** Presentation viewport proportions; the camera fits slides into this rectangle. */
  viewport?: ViewportSize;
  /** Open the slide outline when the player starts. */
  showOutline?: boolean;
  /** URL of the folder the deck's files are loaded from, where recordings of talks are kept. */
  base?: string | null;
}

export interface ResolvedDeck {
  title: string;
  deck: () => Slide | Promise<Slide>;
  presenter: PresenterConfig;
  foreground: string;
  background: string;
  viewport: ViewportSize;
  showOutline: boolean;
  base: string | null;
}

/** Normalize a deck definition, applying defaults. */
export function defineDeck(definition: DeckDefinition): ResolvedDeck {
  if (typeof definition.deck !== 'function') throw new TypeError('defineDeck requires a deck() factory');
  const presenter =
    definition.presenter instanceof PresenterConfig ? definition.presenter : new PresenterConfig(definition.presenter ?? {});
  const viewport = definition.viewport ?? { width: 16, height: 9 };
  if (!(viewport.width > 0) || !(viewport.height > 0)) throw new Error('viewport dimensions must be positive');
  return {
    title: definition.title ?? 'Zoomdeck',
    deck: definition.deck,
    presenter,
    foreground: definition.foreground ?? '#000000',
    background: definition.background ?? '#FFFFFF',
    viewport: { width: viewport.width, height: viewport.height },
    showOutline: Boolean(definition.showOutline),
    base: definition.base ?? null,
  };
}
