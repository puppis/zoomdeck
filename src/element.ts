/**
 * The self-contained entry: everything the package exports, engine included, plus a
 * `<zoom-deck>` element, so that a page without a bundler, or the output cell of a notebook,
 * shows a deck with one script tag:
 *
 *     <script type="module" src="zoomdeck.standalone.js"></script>
 *     <zoom-deck src="talk/deck.json" without="camera record"></zoom-deck>
 *
 * `src` is a `deck.json`, a Markdown file or a PDF; without it the deck is the Markdown written
 * inside the element, in a `<script type="text/markdown">` child (verbatim) or as its text.
 * `without` leaves features out, `start` names the first stop, `title` the deck, `outline`
 * opens the outline, `use-location` lets the deck write `#step=` in the page's URL (for a page
 * that is one deck). The element is sized by the page; without a size it is as wide as its
 * container and 16:9.
 */
export * from './index';
import { mountDeck, markupDeck, FEATURES, type DeckHandle, type Feature, type ResolvedDeck } from './index';

const STYLE_ID = 'zoom-deck-style';

function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = 'zoom-deck { display: block; position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; } zoom-deck:not(:defined) { visibility: hidden; }';
  document.head.append(style);
}

/** `without="camera record"` as the feature flags `mountDeck` takes. */
export function featuresWithout(without: string | null): Partial<Record<Feature, boolean>> {
  const flags: Partial<Record<Feature, boolean>> = {};
  for (const name of (without ?? '').split(/[\s,]+/).filter(Boolean)) {
    if ((FEATURES as readonly string[]).includes(name)) flags[name as Feature] = false;
    else console.warn(`[zoomdeck] <zoom-deck without="…">: no feature named ${JSON.stringify(name)}`);
  }
  return flags;
}

/** A deck in an element of the page; see the module comment. */
export class ZoomDeckElement extends HTMLElement {
  static observedAttributes = ['src', 'without', 'start', 'title', 'outline', 'use-location'];
  /** The handle of the mounted deck, once `ready` resolves. */
  handle: DeckHandle | null = null;
  /** Resolves with the handle when the deck is shown, or null when the element was taken out before. */
  ready: Promise<DeckHandle | null> = Promise.resolve(null);
  private _source: string | null = null;
  private _generation = 0;
  private _settled = true;

  connectedCallback(): void {
    ensureStyle();
    // Children parsed after the start tag arrive a moment later: mount once the parser is done with us.
    this._schedule();
  }

  disconnectedCallback(): void {
    this._generation += 1;
    this.handle?.destroy();
    this.handle = null;
  }

  attributeChangedCallback(): void {
    if (this.isConnected && this._settled) this._schedule();
  }

  /** The Markdown written inside the element, kept from the first mount since the player replaces the children. */
  get source(): string | null {
    if (this._source !== null) return this._source;
    const script = this.querySelector('script[type="text/markdown"]');
    const text = script ? script.textContent : this.textContent;
    this._source = text && text.trim() ? text.replace(/^\n/, '') : null;
    return this._source;
  }

  set source(value: string | null) {
    this._source = value;
    if (this.isConnected) this._schedule();
  }

  private _schedule(): void {
    const generation = ++this._generation;
    this._settled = false;
    this.ready = new Promise((resolve) => {
      queueMicrotask(() => {
        void this._mount(generation).then(resolve, (error) => {
          console.error('[zoomdeck] <zoom-deck> could not show its deck', error);
          this._settled = true;
          resolve(null);
        });
      });
    });
  }

  private async _mount(generation: number): Promise<DeckHandle | null> {
    this.handle?.destroy();
    this.handle = null;
    const src = this.getAttribute('src');
    const source = src ? null : this.source;
    if (!src && source === null) {
      this._settled = true;
      return null;
    }
    let deck: string | ResolvedDeck;
    if (src) deck = new URL(src, this.baseURI).href;
    else {
      deck = markupDeck({
        source: source as string,
        basePath: this.getAttribute('base') ? new URL(this.getAttribute('base') as string, this.baseURI).href : this.baseURI,
        title: this.getAttribute('title') ?? 'Deck',
        showOutline: this.hasAttribute('outline'),
      });
    }
    this.replaceChildren();
    const start = this.getAttribute('start');
    const handle = await mountDeck(this, deck, {
      features: featuresWithout(this.getAttribute('without')),
      useLocation: this.hasAttribute('use-location'),
      start: start === null ? undefined : /^\d+$/.test(start) ? Number(start) : start,
    });
    if (generation !== this._generation) {
      handle.destroy();
      return null;
    }
    this.handle = handle;
    this._settled = true;
    this.dispatchEvent(new CustomEvent('deck', { detail: handle }));
    return handle;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('zoom-deck')) customElements.define('zoom-deck', ZoomDeckElement);
