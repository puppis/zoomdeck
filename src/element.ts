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
 * container and, once the deck is shown, exactly as tall as the player needs for a stage of
 * the deck's own proportions under its header and footer, so that the slides fill the stage
 * with no room around them (a `height` in the element's style is kept instead). A deck written
 * inside the element, and a PDF, take the page's own colours
 * (the element's background and text colour, so a dark page shows a dark deck, and the deck
 * follows when the colour scheme changes) unless `background` and `foreground` say otherwise;
 * a `deck.json` keeps its own.
 */
export * from './index';
import { mountDeck, markupDeck, pdfDeck, FEATURES, type DeckHandle, type Feature, type ResolvedDeck } from './index';

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

/** A CSS colour as `#rrggbb`, or null for transparency and anything a canvas cannot parse. */
function hexColor(value: string): string | null {
  if (typeof document === 'undefined') return null;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(value);
  if (match) {
    if (match[4] !== undefined && Number(match[4]) === 0) return null;
    return '#' + [match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('');
  }
  context.fillStyle = value;
  return /^#[0-9a-f]{6}$/i.test(context.fillStyle) ? context.fillStyle : null;
}

/** The colours of the page around `element`: the nearest opaque background behind it and its text colour. */
export function pageColors(element: HTMLElement): { background: string; foreground: string } {
  let background: string | null = null;
  for (let node: HTMLElement | null = element; node && !background; node = node.parentElement) {
    background = hexColor(getComputedStyle(node).backgroundColor);
  }
  const foreground = hexColor(getComputedStyle(element).color) ?? '#000000';
  return { background: background ?? '#ffffff', foreground };
}

/** A deck in an element of the page; see the module comment. */
export class ZoomDeckElement extends HTMLElement {
  static observedAttributes = ['src', 'without', 'start', 'title', 'outline', 'use-location', 'background', 'foreground'];
  private static readonly _scheme = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
  private _onScheme: (() => void) | null = null;
  /** The handle of the mounted deck, once `ready` resolves. */
  handle: DeckHandle | null = null;
  /** Resolves with the handle when the deck is shown, or null when the element was taken out before. */
  ready: Promise<DeckHandle | null> = Promise.resolve(null);
  private _source: string | null = null;
  private _generation = 0;
  private _settled = true;
  private _sizer: ResizeObserver | null = null;

  connectedCallback(): void {
    ensureStyle();
    // Children parsed after the start tag arrive a moment later: mount once the parser is done with us.
    this._schedule();
  }

  disconnectedCallback(): void {
    this._generation += 1;
    this.handle?.destroy();
    this.handle = null;
    this._followScheme(false);
    this._sizer?.disconnect();
    this._sizer = null;
  }

  /**
   * Keep the element as tall as a stage of the deck's proportions plus the player's header and
   * footer, following the element's width (and the footer, which wraps when narrow), unless
   * the page gave the element a height of its own.
   */
  private _fitHeight(handle: DeckHandle): void {
    this._sizer?.disconnect();
    this._sizer = null;
    if (this.style.height || typeof ResizeObserver === 'undefined') return;
    const header = this.querySelector('.zd-app header') as HTMLElement | null;
    const footer = this.querySelector('.zd-app footer') as HTMLElement | null;
    const aside = this.querySelector('.zd-app aside') as HTMLElement | null;
    const fit = () => {
      if (this.handle !== handle) return;
      // The stage is what remains beside the outline, when it is open.
      const asideWidth = aside && getComputedStyle(aside).display !== 'none' ? aside.offsetWidth : 0;
      const width = this.clientWidth - asideWidth;
      if (width <= 0) return;
      const chrome = (header?.offsetHeight ?? 0) + (footer?.offsetHeight ?? 0);
      const height = Math.round(width / handle.stage.viewportAspect + chrome);
      if (Math.abs(height - this.offsetHeight) < 1) return;
      this.style.aspectRatio = 'auto';
      this.style.height = `${height}px`;
    };
    this._sizer = new ResizeObserver(fit);
    this._sizer.observe(this);
    if (footer) this._sizer.observe(footer);
    if (aside) this._sizer.observe(aside);
    fit();
  }

  /** While the deck wears the page's colours, a change of colour scheme mounts it again in the new ones. */
  private _followScheme(on: boolean): void {
    const scheme = ZoomDeckElement._scheme;
    if (!scheme) return;
    if (on && !this._onScheme) {
      this._onScheme = () => this._schedule();
      scheme.addEventListener('change', this._onScheme);
    } else if (!on && this._onScheme) {
      scheme.removeEventListener('change', this._onScheme);
      this._onScheme = null;
    }
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
    if (this._sizer) {
      // The height was ours: let the next deck choose again.
      this._sizer.disconnect();
      this._sizer = null;
      this.style.height = '';
      this.style.aspectRatio = '';
    }
    const src = this.getAttribute('src');
    const source = src ? null : this.source;
    if (!src && source === null) {
      this._settled = true;
      return null;
    }
    // Colours: the attributes, else the page's own for a deck written here or a PDF; a deck.json keeps its own.
    const own = this.hasAttribute('background') || this.hasAttribute('foreground');
    const inherited = !own && (!src || /\.pdf(\?|#|$)/i.test(src));
    const page = inherited ? pageColors(this) : null;
    const background = this.getAttribute('background') ?? page?.background;
    const foreground = this.getAttribute('foreground') ?? page?.foreground;
    this._followScheme(inherited);
    let deck: string | ResolvedDeck;
    if (src) {
      const url = new URL(src, this.baseURI).href;
      deck = inherited ? await pdfDeck({ url, background, foreground, showOutline: this.hasAttribute('outline') }) : url;
    } else {
      deck = markupDeck({
        source: source as string,
        basePath: this.getAttribute('base') ? new URL(this.getAttribute('base') as string, this.baseURI).href : this.baseURI,
        title: this.getAttribute('title') ?? 'Deck',
        showOutline: this.hasAttribute('outline'),
        background,
        layout: foreground ? { color: foreground } : undefined,
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
    this._fitHeight(handle);
    this.dispatchEvent(new CustomEvent('deck', { detail: handle }));
    return handle;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('zoom-deck')) customElements.define('zoom-deck', ZoomDeckElement);
