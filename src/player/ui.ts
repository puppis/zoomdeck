/**
 * The browser interface: slide outline, navigation controls, keyboard
 * shortcuts, spotlight or laser, highlighter and pen overlays, fullscreen, speed and
 * deep links, drawing on a live canvas instead of video clips.
 */
import type { ResolvedDeck } from '../deck';
import type { NavigationData } from '../runtime';
import type { Player } from './player';
import type { Stage } from './stage';
import playerCss from './player.css?inline';
import {
  ACTIONS, DEFAULT_POINTER_BINDINGS, MODIFIER_COMBOS, POINTER_ACTIONS, type ActionName, type PlayerSettings, type PointerAction, type PointerMode,
  actionFor, defaultSettings, describeCombo, describeModifiers, keyCombo, loadSettings, modifierCombo, pointerActionFor, saveSettings,
} from './settings';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

export interface PlayerUIOptions {
  /** Query parameter / hash handling for deep links and preview reloads. */
  useLocation?: boolean;
}

/** Build the player page inside `host` and return the stage container. */
export class PlayerUI {
  readonly root: HTMLElement;
  readonly stageHost: HTMLElement;
  private readonly _slides: HTMLElement;
  private readonly _breadcrumb: HTMLElement;
  private readonly _state: HTMLElement;
  private readonly _counter: HTMLElement;
  private readonly _progress: HTMLProgressElement;
  private readonly _previous: HTMLButtonElement;
  private readonly _next: HTMLButtonElement;
  private readonly _error: HTMLElement;
  private readonly _loading: HTMLElement;
  private readonly _loadingText: HTMLElement;
  private readonly _outlineToggle: HTMLButtonElement;
  private readonly _penColor: HTMLSelectElement;
  private readonly _penSize: HTMLSelectElement;
  private readonly _speed: HTMLSelectElement;
  private readonly _spotlight: HTMLElement;
  private readonly _highlights: SVGSVGElement;
  private readonly _ink: SVGGElement;
  private readonly _sketches: SVGGElement;
  private readonly _buttons = new Map<number, HTMLButtonElement>();
  private readonly _deck: ResolvedDeck;
  private _player: Player | null = null;
  private _stage: Stage | null = null;
  private _navigation: NavigationData | null = null;
  /** Modifier keys currently held, as a `modifierCombo` string. */
  private _modifiers = '';
  private _pointer: { x: number; y: number } | null = null;
  private _radius = 96;
  private _stroke: { path: SVGPathElement; tool: 'pen' | 'highlighter'; data: string } | null = null;
  /** Strokes of the current slide in drawing order, and the ones undone (for redo). */
  private _strokes: SVGPathElement[] = [];
  private _undone: SVGPathElement[] = [];
  private _highlightedSlide: number | null = null;
  private readonly _useLocation: boolean;
  private readonly _settings: PlayerSettings;
  private readonly _dialog: HTMLDialogElement;
  private readonly _shortcuts: HTMLElement;
  private _capturing: ActionName | null = null;

  constructor(host: HTMLElement, deck: ResolvedDeck, options: PlayerUIOptions = {}) {
    this._deck = deck;
    this._useLocation = options.useLocation ?? true;
    this._settings = loadSettings();
    if (!document.getElementById('zd-player-style')) {
      document.head.append(el('style', { id: 'zd-player-style', text: playerCss }));
    }
    document.title = deck.title;
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--background', deck.background);
    rootStyle.setProperty('--foreground', deck.foreground);
    rootStyle.colorScheme = PlayerUI._isLight(deck.background) ? 'light' : 'dark';
    document.body.style.background = deck.background;

    this._slides = el('nav', { class: 'slides', 'aria-label': 'Jump to slide' });
    const aside = el(
      'aside',
      { 'aria-label': 'Slide outline' },
      el('div', { class: 'brand', text: 'ZOOMDECK' }),
      el('h1', { class: 'deck-title', text: deck.title }),
      el('p', { class: 'hint', text: 'Explore the slides or follow the presentation.' }),
      this._slides,
      el(
        'details',
        {},
        el('summary', { text: 'Keyboard shortcuts' }),
        (this._shortcuts = el('p', {})),
      ),
    );
    this._renderShortcuts();
    this._outlineToggle = el('button', {
      class: 'outline-toggle',
      'aria-expanded': 'false',
      'aria-label': 'Toggle slide outline',
      title: 'Toggle slide outline (O)',
      text: '☰',
    });
    this._breadcrumb = el('span', { class: 'breadcrumb' });
    this._state = el('span', { class: 'state', role: 'status', 'aria-live': 'polite', text: 'Loading…' });
    const header = el('header', {}, this._outlineToggle, this._breadcrumb, this._state);

    this.stageHost = el('div', { class: 'zd-stage', tabindex: '0', 'aria-label': 'Presentation' });
    this._highlights = document.createElementNS(SVG_NS, 'svg');
    this._highlights.setAttribute('class', 'highlights');
    this._highlights.setAttribute('aria-hidden', 'true');
    this._ink = document.createElementNS(SVG_NS, 'g');
    this._ink.setAttribute('class', 'highlight-ink');
    this._sketches = document.createElementNS(SVG_NS, 'g');
    this._sketches.setAttribute('class', 'sketches');
    this._highlights.append(this._ink, this._sketches);
    this._spotlight = el('div', { class: 'spotlight', 'aria-hidden': 'true' });
    this._error = el('p', { class: 'error', role: 'alert', hidden: '' });
    this._loadingText = el('span', { text: 'Preparing slides…' });
    this._loading = el('div', { class: 'loading', role: 'status' }, el('span', { class: 'spinner' }), this._loadingText);
    this.stageHost.append(this._highlights, this._spotlight, this._error, this._loading);

    this._previous = el('button', { class: 'previous', 'aria-label': 'Previous stop', title: 'Previous stop (←)', text: '←' });
    this._next = el('button', { class: 'next', 'aria-label': 'Next stop', title: 'Next stop (→)', text: '→' });
    this._penColor = el('select', { 'aria-label': 'Pen color', title: 'Pen color' });
    for (const [value, label] of [
      ['foreground', 'Default'], ['#000000', 'Black'], ['#FFFFFF', 'White'], ['#EF4444', 'Red'],
      ['#FACC15', 'Yellow'], ['#22C55E', 'Green'], ['#3B82F6', 'Blue'],
    ]) this._penColor.append(el('option', { value, text: label }));
    this._penSize = el('select', { 'aria-label': 'Pen tip size', title: 'Pen tip size' });
    for (const size of ['1', '3', '6', '10']) {
      const option = el('option', { value: size, text: `${size} px` });
      if (size === '3') option.selected = true;
      this._penSize.append(option);
    }
    this._speed = el('select', { class: 'speed-select', 'aria-label': 'Playback speed' });
    for (const speed of ['0.5', '1', '1.5', '2']) {
      const option = el('option', { value: speed, text: `${speed}×` });
      if (speed === '1') option.selected = true;
      this._speed.append(option);
    }
    this._counter = el('span', { class: 'counter' });
    const fullscreen = el('button', { class: 'fullscreen', text: 'Fullscreen' });
    const settingsButton = el('button', { class: 'settings-button', 'aria-label': 'Settings', title: 'Settings', text: '⚙' });
    this._dialog = this._buildSettingsDialog();
    this._progress = el('progress', { max: '1', value: '0', 'aria-label': 'Presentation progress' });
    const footer = el(
      'footer',
      {},
      el('div', { class: 'buttons' }, this._previous, this._next),
      el(
        'div',
        { class: 'pen-controls', role: 'group', 'aria-label': 'Pen settings' },
        el('label', {}, 'Pen ', this._penColor),
        el('label', {}, 'Tip ', this._penSize),
      ),
      el('label', { class: 'speed' }, 'Speed ', this._speed),
      this._counter,
      settingsButton,
      fullscreen,
      this._progress,
    );
    const main = el('main', {}, header, this.stageHost, footer);
    this.root = el('div', { class: 'zd-app outline-hidden' }, aside, main, this._dialog);
    host.replaceChildren(this.root);

    this._outlineToggle.addEventListener('click', () => this.toggleOutline());
    fullscreen.addEventListener('click', () => void this.fullscreen());
    settingsButton.addEventListener('click', () => this.openSettings());
    this._previous.addEventListener('click', () => void this._player?.previous());
    this._next.addEventListener('click', () => void this._player?.next());
    this._speed.addEventListener('change', () => {
      if (this._player) this._player.speed = Number(this._speed.value);
    });
    this._penColor.addEventListener('change', () => this._endStroke());
    this._penSize.addEventListener('change', () => this._endStroke());
    this._installPointerTools();
    document.addEventListener('keydown', (event) => this._onKeyDown(event));
    if (deck.showOutline) this.toggleOutline();
    this._updateSpotlight();
  }

  private _renderShortcuts(): void {
    const keys = (action: ActionName) => this._settings.bindings[action].map(describeCombo).join(' / ') || '—';
    const held = (action: PointerAction) => {
      const combo = this._settings.pointer[action];
      return combo === null ? null : combo === '' ? '' : `${describeModifiers(combo)} + `;
    };
    const pen = held('pen');
    const pointer = held('pointer');
    const advance = held('advance');
    const gestures = [
      pen === null ? null : `${pen || 'Plain '}drag: draw with the pen`,
      pointer === null ? null : `${pointer ? `Hold ${pointer.slice(0, -3)}` : 'Hover'}: spotlight or laser (${keys('pointer')} switches)`,
      pointer === null ? null : `${pointer || 'Plain '}drag: highlight · ${pointer || ''}scroll: resize`,
      advance === null ? null : `${advance || 'Plain '}click: next stop`,
    ].filter((line): line is string => line !== null);
    const lines = [
      `${keys('next')}: continue`, `${keys('previous')}: previous stop`, `${keys('replay')}: replay`, `${keys('home')}: overview`,
      `${keys('fullscreen')}: fullscreen`, `${keys('exit')}: normal view`, `${keys('outline')}: toggle outline`,
      ...gestures,
      `${keys('undo')}: undo stroke`, `${keys('redo')}: redo stroke`, `${keys('clear')}: clear strokes`, `${keys('settings')}: settings`,
    ];
    const nodes: Array<Node | string> = [];
    lines.forEach((line, index) => {
      if (index) nodes.push(document.createElement('br'));
      nodes.push(line);
    });
    this._shortcuts.replaceChildren(...nodes);
  }

  private static _isLight(color: string): boolean {
    const match = color.replace('#', '').match(/../g);
    if (!match || match.length < 3) return false;
    const channels = match.slice(0, 3).map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179;
  }

  /** Report preparation progress while the deck runs its dry pass. */
  setLoading(message: string | null): void {
    if (message === null) {
      this._loading.hidden = true;
      return;
    }
    this._loading.hidden = false;
    this._loadingText.textContent = message;
    this._state.textContent = 'Loading…';
  }

  showError(message: string): void {
    this._loading.hidden = true;
    this._error.hidden = false;
    this._error.textContent = message;
    this._state.textContent = 'Error';
  }

  /** Connect the interface to a prepared player. */
  bind(player: Player, stage: Stage, navigation: NavigationData): void {
    this._player = player;
    this._stage = stage;
    this._navigation = navigation;
    if (this._settings.reversePlayback !== null) player.reversePlayback = this._settings.reversePlayback;
    this._syncSettingsForm();
    const slides = new Map(navigation.slides.map((slide) => [slide.id, slide]));
    const ancestors = (id: number | null) => {
      const path: NavigationData['slides'] = [];
      const seen = new Set<number>();
      let slide = id === null ? undefined : slides.get(id);
      while (slide && !seen.has(slide.id)) {
        seen.add(slide.id);
        path.unshift(slide);
        slide = slide.parent === null ? undefined : slides.get(slide.parent);
      }
      return path;
    };
    this._slides.replaceChildren();
    this._buttons.clear();
    for (const slide of navigation.slides) {
      const button = el('button', { text: slide.name });
      button.style.paddingLeft = `${12 + 15 * (ancestors(slide.id).length - 1)}px`;
      const first = player.firstEntry(slide.id);
      button.disabled = first < 0;
      button.addEventListener('click', () => void player.goTo(first, false));
      this._slides.append(button);
      this._buttons.set(slide.id, button);
    }
    player.on('clipchange', ({ index }) => {
      const clip = navigation.clips[index];
      if (clip.slide !== this._highlightedSlide) {
        this._ink.replaceChildren();
        this._sketches.replaceChildren();
        this._strokes = [];
        this._undone = [];
        this._endStroke();
      }
      this._highlightedSlide = clip.slide;
      this._breadcrumb.textContent = ancestors(clip.slide).map((slide) => slide.name).join(' / ');
      this._counter.textContent = `${index + 1} / ${navigation.clips.length}`;
      this._progress.max = navigation.clips.length;
      this._progress.value = index + 1;
      this._previous.disabled = index === 0;
      this._next.disabled = index === navigation.clips.length - 1;
      for (const [id, button] of this._buttons) button.setAttribute('aria-current', String(id === clip.slide));
      if (this._useLocation) history.replaceState(null, '', `#step=${index + 1}`);
      this._layoutHighlights();
    });
    player.on('state', ({ message }) => {
      this._state.textContent = message;
    });
    this._loading.hidden = true;
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this._layoutHighlights()).observe(this.stageHost);
    this._layoutHighlights();
  }

  toggleOutline(): void {
    const hidden = this.root.classList.toggle('outline-hidden');
    this._outlineToggle.setAttribute('aria-expanded', String(!hidden));
  }

  async fullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.root.requestFullscreen();
    } catch {
      this._state.textContent = 'Fullscreen unavailable';
    }
  }

  private _onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable) return;
    const combo = keyCombo(event);
    if (!combo) return;
    if (this._capturing) {
      event.preventDefault();
      if (combo !== 'Escape') this._assignBinding(this._capturing, combo);
      this._capturing = null;
      this._renderBindings();
      return;
    }
    if (this._dialog.open) return;
    if (combo === 'Space' && /^(BUTTON|SUMMARY)$/.test(target.tagName)) return;
    const action = actionFor(this._settings, combo);
    if (!action) return;
    event.preventDefault();
    this._runAction(action);
  }

  private _runAction(action: ActionName): void {
    const player = this._player;
    switch (action) {
      case 'next': void player?.next(); break;
      case 'previous': void player?.previous(); break;
      case 'home': void player?.home(); break;
      case 'replay': void player?.replay(); break;
      case 'fullscreen': void this.fullscreen(); break;
      case 'exit': if (document.fullscreenElement) void this.fullscreen(); break;
      case 'outline': this.toggleOutline(); break;
      case 'undo': this.undoStroke(); break;
      case 'redo': this.redoStroke(); break;
      case 'clear': this.clearStrokes(); break;
      case 'settings': this.openSettings(); break;
      case 'pointer': this.togglePointerMode(); break;
    }
  }

  /** Remove the most recent pen or highlighter stroke on the current slide. */
  undoStroke(): void {
    this._endStroke();
    const path = this._strokes.pop();
    if (!path) return;
    path.remove();
    this._undone.push(path);
  }

  /** Put back the last undone stroke. */
  redoStroke(): void {
    const path = this._undone.pop();
    if (!path) return;
    (path.classList.contains('pen') ? this._sketches : this._ink).append(path);
    this._strokes.push(path);
  }

  /** Remove every stroke on the current slide; redo restores them one by one. */
  clearStrokes(): void {
    this._endStroke();
    while (this._strokes.length) {
      const path = this._strokes.pop() as SVGPathElement;
      path.remove();
      this._undone.push(path);
    }
  }

  // ---------------------------------------------------------------------
  // Settings dialog
  // ---------------------------------------------------------------------

  private _reverseToggle!: HTMLInputElement;
  private _bindingsTable!: HTMLElement;
  private _pointerModeSelect!: HTMLSelectElement;
  private readonly _pointerSelects = new Map<PointerAction, HTMLSelectElement>();

  openSettings(): void {
    this._syncSettingsForm();
    this._renderBindings();
    if (!this._dialog.open) this._dialog.showModal();
  }

  private _buildSettingsDialog(): HTMLDialogElement {
    const dialog = el('dialog', { class: 'settings' });
    const close = el('button', { class: 'close', 'aria-label': 'Close settings', text: '×' });
    close.addEventListener('click', () => dialog.close());

    // Pointer: the tool shown while its gesture is held, and the modifier keys of each gesture.
    this._pointerModeSelect = el('select', { 'aria-label': 'Pointer tool' });
    for (const [value, label] of [['spotlight', 'Spotlight'], ['laser', 'Laser pointer']]) {
      this._pointerModeSelect.append(el('option', { value, text: label }));
    }
    this._pointerModeSelect.addEventListener('change', () => {
      this._settings.pointerMode = this._pointerModeSelect.value as PointerMode;
      saveSettings(this._settings);
      this._updateSpotlight();
    });
    const gestures = el('div', { class: 'bindings' });
    gestures.append(el('div', { class: 'binding gesture' },
      el('span', { class: 'action', text: 'Tool shown while the pointer gesture is held' }), this._pointerModeSelect));
    for (const action of POINTER_ACTIONS) {
      const select = el('select', { 'aria-label': action.label });
      for (const combo of MODIFIER_COMBOS) select.append(el('option', { value: combo, text: describeModifiers(combo) }));
      select.append(el('option', { value: 'off', text: describeModifiers(null) }));
      select.addEventListener('change', () => this._assignPointer(action.name, select.value === 'off' ? null : select.value));
      this._pointerSelects.set(action.name, select);
      gestures.append(el('div', { class: 'binding gesture' }, el('span', { class: 'action', text: action.label }), select));
    }
    const resetPointer = el('button', { text: 'Restore default gestures' });
    resetPointer.addEventListener('click', () => {
      this._settings.pointer = { ...DEFAULT_POINTER_BINDINGS };
      this._settings.pointerMode = 'spotlight';
      saveSettings(this._settings);
      this._syncSettingsForm();
      this._renderShortcuts();
      this._updateSpotlight();
    });

    this._bindingsTable = el('div', { class: 'bindings' });
    const resetKeys = el('button', { text: 'Restore default keys' });
    resetKeys.addEventListener('click', () => {
      this._settings.bindings = defaultSettings().bindings;
      this._capturing = null;
      saveSettings(this._settings);
      this._renderShortcuts();
      this._renderBindings();
    });

    this._reverseToggle = el('input', { type: 'checkbox' });
    this._reverseToggle.addEventListener('change', () => {
      this._settings.reversePlayback = this._reverseToggle.checked;
      if (this._player) this._player.reversePlayback = this._reverseToggle.checked;
      saveSettings(this._settings);
    });

    dialog.append(
      el('header', {}, el('h2', { text: 'Settings' }), close),
      el('section', {},
        el('h3', { text: 'Pointer' }),
        el('p', { class: 'note', text: 'Each gesture is the mouse used with the chosen keys held. Scrolling while the spotlight or laser is shown resizes it; pen color and tip size are in the bar at the bottom. Strokes belong to the slide they were drawn on and clear when you move to another slide.' }),
        gestures,
        resetPointer,
      ),
      el('section', {},
        el('h3', { text: 'Keyboard' }),
        el('p', { class: 'note', text: 'Click a key to remove it, or “Add key” and press the new combination (Esc cancels). Settings are kept in this browser.' }),
        this._bindingsTable,
        resetKeys,
      ),
      el('section', {},
        el('h3', { text: 'Advanced' }),
        el('label', { class: 'row' }, this._reverseToggle, ' Going to the previous stop plays the current stop backwards (off: jump straight to it)'),
        el('p', { class: 'note', text: 'The playback speed is in the bar at the bottom.' }),
      ),
    );
    dialog.addEventListener('close', () => { this._capturing = null; });
    return dialog;
  }

  private _syncSettingsForm(): void {
    this._reverseToggle.checked = this._settings.reversePlayback ?? this._player?.reversePlayback ?? this._deck.presenter.reversePlayback;
    this._pointerModeSelect.value = this._settings.pointerMode;
    for (const [action, select] of this._pointerSelects) select.value = this._settings.pointer[action] ?? 'off';
  }

  /** Bind a pointer action to a modifier combination, freeing it from any other action. */
  private _assignPointer(action: PointerAction, combo: string | null): void {
    if (combo !== null) {
      for (const other of POINTER_ACTIONS) if (other.name !== action && this._settings.pointer[other.name] === combo) this._settings.pointer[other.name] = null;
    }
    this._settings.pointer[action] = combo;
    saveSettings(this._settings);
    this._syncSettingsForm();
    this._renderShortcuts();
    this._endStroke();
    this._updateSpotlight();
  }

  private _assignBinding(action: ActionName, combo: string): void {
    for (const other of ACTIONS) {
      this._settings.bindings[other.name] = this._settings.bindings[other.name].filter((item) => item !== combo);
    }
    this._settings.bindings[action].push(combo);
    saveSettings(this._settings);
    this._renderShortcuts();
  }

  private _renderBindings(): void {
    const rows = ACTIONS.map((action) => {
      const chips = this._settings.bindings[action.name].map((combo) => {
        const chip = el('button', { class: 'chip', title: `Remove ${describeCombo(combo)}`, text: describeCombo(combo) });
        chip.addEventListener('click', () => {
          this._settings.bindings[action.name] = this._settings.bindings[action.name].filter((item) => item !== combo);
          saveSettings(this._settings);
          this._renderShortcuts();
          this._renderBindings();
        });
        return chip;
      });
      const add = el('button', { class: 'add', text: this._capturing === action.name ? 'Press keys…' : 'Add key' });
      add.addEventListener('click', () => {
        this._capturing = this._capturing === action.name ? null : action.name;
        this._renderBindings();
      });
      return el('div', { class: `binding${this._capturing === action.name ? ' capturing' : ''}` },
        el('span', { class: 'action', text: action.label }),
        el('span', { class: 'keys' }, ...chips),
        add,
      );
    });
    this._bindingsTable.replaceChildren(...rows);
  }

  // ---------------------------------------------------------------------
  // Spotlight or laser, highlighter and pen overlays
  // ---------------------------------------------------------------------

  private _viewportPixels(): { width: number; height: number } {
    const aspect = this._deck.viewport.width / this._deck.viewport.height;
    return { width: Math.round(1000 * aspect), height: 1000 };
  }

  private _highlightGeometry() {
    const bounds = this.stageHost.getBoundingClientRect();
    const { width, height } = this._viewportPixels();
    return { bounds, width, height, scale: Math.min(bounds.width / width, bounds.height / height) || 1 };
  }

  private _layoutHighlights(): void {
    const { width, height, scale } = this._highlightGeometry();
    this._highlights.setAttribute('viewBox', `${-width / 2} ${-height / 2} ${width} ${height}`);
    this._highlights.style.width = `${width * scale}px`;
    this._highlights.style.height = `${height * scale}px`;
  }

  private _endStroke(): void {
    this._stroke = null;
    this.stageHost.classList.remove('stroking');
  }

  /** The pointer action selected by the modifier keys currently held. */
  private _activeTool(): PointerAction | null {
    return pointerActionFor(this._settings, this._modifiers);
  }

  private _drawingTool(): 'pen' | 'highlighter' | null {
    const tool = this._activeTool();
    return tool === 'pen' ? 'pen' : tool === 'pointer' ? 'highlighter' : null;
  }

  /** Switch the tool shown by the pointer gesture between the spotlight and the laser. */
  togglePointerMode(): void {
    this._settings.pointerMode = this._settings.pointerMode === 'laser' ? 'spotlight' : 'laser';
    saveSettings(this._settings);
    this._syncSettingsForm();
    this._updateSpotlight();
    this._state.textContent = this._settings.pointerMode === 'laser' ? 'Laser pointer' : 'Spotlight';
  }

  private _addInk(event: PointerEvent | { clientX: number; clientY: number }): void {
    const { bounds, scale } = this._highlightGeometry();
    const x = (event.clientX - bounds.left - bounds.width / 2) / scale;
    const y = (event.clientY - bounds.top - bounds.height / 2) / scale;
    if (!this._stroke) {
      const tool = this._drawingTool();
      if (!tool) return;
      const path = document.createElementNS(SVG_NS, 'path');
      const highlighterWidth = this._settings.pointerMode === 'laser' ? this._radius / 3 : 2 * this._radius;
      path.setAttribute('stroke-width', String((tool === 'pen' ? Number(this._penSize.value) : highlighterWidth) / scale));
      if (tool === 'pen') {
        path.setAttribute('stroke', this._penColor.value === 'foreground' ? this._deck.foreground : this._penColor.value);
        path.classList.add('pen');
      }
      (tool === 'pen' ? this._sketches : this._ink).append(path);
      this._strokes.push(path);
      this._undone = [];
      this._stroke = { path, tool, data: `M ${x} ${y} l 0.001 0` };
      this.stageHost.classList.add('stroking');
    } else this._stroke.data += ` L ${x} ${y}`;
    this._stroke.path.setAttribute('d', this._stroke.data);
  }

  private _updateSpotlight(): void {
    const stage = this.stageHost;
    const tool = this._activeTool();
    if (this._pointer) {
      const bounds = stage.getBoundingClientRect();
      this._spotlight.style.setProperty('--spot-x', `${this._pointer.x - bounds.left}px`);
      this._spotlight.style.setProperty('--spot-y', `${this._pointer.y - bounds.top}px`);
    }
    this._radius = Math.max(24, Math.min(this._radius, Math.max(stage.clientWidth, stage.clientHeight, 24)));
    this._spotlight.style.setProperty('--spot-radius', `${this._radius}px`);
    stage.classList.toggle('laser-mode', this._settings.pointerMode === 'laser');
    stage.classList.toggle('spotlight-active', tool === 'pointer' && this._pointer !== null);
    stage.classList.toggle('sketch-active', tool === 'pen' && this._pointer !== null);
    // Links and live pages give way to a tool selected with a held key, never to a plain gesture.
    stage.classList.toggle('tool-held', tool !== null && this._modifiers !== '' && this._pointer !== null);
  }

  private _releaseSpotlight(): void {
    this._modifiers = '';
    this._endStroke();
    this._updateSpotlight();
  }

  private _installPointerTools(): void {
    const stage = this.stageHost;
    const modifierKeys = ['Shift', 'Control', 'Alt', 'Meta'];
    // Clicks on links, live pages and controls inside the stage are theirs, not the pen's.
    const interactive = (event: Event) => Boolean((event.target as Element | null)?.closest?.('a, iframe, button, select, input'));
    stage.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      this._pointer = { x: event.clientX, y: event.clientY };
      this._modifiers = modifierCombo(event);
      if (this._stroke && this._stroke.tool !== this._drawingTool()) this._endStroke();
      if (this._stroke && event.buttons & 1) {
        for (const sample of event.getCoalescedEvents?.() ?? []) this._addInk(sample);
        this._addInk(event);
      } else if (this._stroke) this._endStroke();
      this._updateSpotlight();
    });
    stage.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.pointerType === 'touch' || interactive(event)) return;
      this._modifiers = modifierCombo(event);
      this._pointer = { x: event.clientX, y: event.clientY };
      const tool = this._activeTool();
      if (tool === 'advance') {
        event.preventDefault();
        void this._player?.next();
        return;
      }
      if (tool !== null) {
        event.preventDefault();
        this._endStroke();
        this._addInk(event);
      }
      this._updateSpotlight();
    });
    document.addEventListener('pointerup', () => this._endStroke());
    stage.addEventListener('pointercancel', () => this._endStroke());
    stage.addEventListener('contextmenu', (event) => {
      // Control + click is a context menu on macOS; keep it for the tools bound to Control.
      if (event.ctrlKey && pointerActionFor(this._settings, modifierCombo(event)) !== null) event.preventDefault();
    });
    stage.addEventListener('pointerleave', () => { this._pointer = null; this._endStroke(); this._updateSpotlight(); });
    document.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      if (!modifierKeys.includes(event.key) || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable) return;
      this._modifiers = modifierCombo(event);
      if (this._stroke && this._stroke.tool !== this._drawingTool()) this._endStroke();
      this._updateSpotlight();
    });
    document.addEventListener('keyup', (event) => {
      if (!modifierKeys.includes(event.key)) return;
      this._modifiers = modifierCombo(event);
      if (this._stroke && this._stroke.tool !== this._drawingTool()) this._endStroke();
      this._updateSpotlight();
    });
    stage.addEventListener('wheel', (event) => {
      if (this._activeTool() !== 'pointer' || this._pointer === null) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      const delta = Math.max(-1000, Math.min(1000, (event.deltaY || event.deltaX) * unit));
      this._radius *= Math.exp(-delta * 0.002);
      this._updateSpotlight();
    }, { passive: false });
    window.addEventListener('blur', () => this._releaseSpotlight());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this._releaseSpotlight(); });
  }
}
