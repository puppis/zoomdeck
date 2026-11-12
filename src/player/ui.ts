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
import {
  DEFAULT_PEN_STYLE, InkSurface, PEN_PRESETS, PEN_PRESET_LABELS, newStrokeId, type InkSample, type InkStroke, type InkTool, type PenPreset,
} from './ink';
import { PadLink, fetchPairingInfo, padLinkAvailable, padUrl, type InkOp, type InkSurfaceName, type PadMessage } from './pad';
import { Swatches } from './swatches';

/** How far from a stroke's path, in screen pixels, a fingertip still erases it. */
const ERASE_REACH_PX = 12;

const HIGHLIGHTER_COLOR = '#ffdf00';
/** Fraction of the whiteboard viewport one arrow press scrolls. */
const BOARD_STEP = 0.25;

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
  private readonly _penColor: Swatches;
  private readonly _penSize: HTMLSelectElement;
  private readonly _speed: HTMLSelectElement;
  private readonly _spotlight: HTMLElement;
  private readonly _highlights: SVGSVGElement;
  private readonly _slideInk: InkSurface;
  private readonly _boardLayer: HTMLElement;
  private readonly _board: SVGSVGElement;
  private readonly _boardInk: InkSurface;
  private readonly _remoteCursor: HTMLElement;
  private readonly _boardButton: HTMLButtonElement;
  private readonly _buttons = new Map<number, HTMLButtonElement>();
  private readonly _deck: ResolvedDeck;
  private _player: Player | null = null;
  private _stage: Stage | null = null;
  private _navigation: NavigationData | null = null;
  /** Modifier keys currently held, as a `modifierCombo` string. */
  private _modifiers = '';
  private _pointer: { x: number; y: number } | null = null;
  private _radius = 96;
  /** The stroke being drawn: its surface, pointer, and the samples not yet sent to the other device. */
  private _live: { id: string; tool: InkTool; surface: InkSurfaceName; pointerId: number; pending: InkSample[]; frame: number | null; pressure: boolean; announce: boolean } | null = null;
  private _highlightedSlide: number | null = null;
  private _boardOn = false;
  private _boardPan = { x: 0, y: 0 };
  private _boardTarget = { x: 0, y: 0 };
  private _boardFrame: number | null = null;
  private readonly _touches = new Map<number, { x: number; y: number }>();
  /** When a pen was last seen: fingers near a working pen are palms, not erasers. */
  private _penSeen = 0;
  private _pad: PadLink | null = null;
  private _editSource: ((at?: { x: number; y: number }) => void) | null = null;
  private _stateMessage = 'Loading…';
  private _noticeTimer: number | null = null;
  private _padsSeen = new Set<string>();
  private _frameTimer: number | null = null;
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
    const penStyle = () => this._settings.pen;
    this._highlights = document.createElementNS(SVG_NS, 'svg');
    this._highlights.setAttribute('class', 'highlights slide');
    this._highlights.setAttribute('aria-hidden', 'true');
    this._slideInk = new InkSurface(this._highlights, penStyle, 'slide-ink');
    // The whiteboard: an opaque page over the slides with its own strokes, scrolled over an unbounded plane.
    this._boardLayer = el('div', { class: 'whiteboard', hidden: '', 'aria-label': 'Whiteboard' });
    this._board = document.createElementNS(SVG_NS, 'svg');
    this._board.setAttribute('class', 'highlights board');
    this._board.setAttribute('aria-hidden', 'true');
    this._boardInk = new InkSurface(this._board, penStyle, 'board-ink');
    this._boardLayer.append(this._board);
    this._spotlight = el('div', { class: 'spotlight', 'aria-hidden': 'true' });
    this._remoteCursor = el('div', { class: 'remote-cursor', hidden: '', 'aria-hidden': 'true' });
    this._error = el('p', { class: 'error', role: 'alert', hidden: '' });
    this._loadingText = el('span', { text: 'Preparing slides…' });
    this._loading = el('div', { class: 'loading', role: 'status' }, el('span', { class: 'spinner' }), this._loadingText);
    this.stageHost.append(this._boardLayer, this._highlights, this._spotlight, this._remoteCursor, this._error, this._loading);

    this._previous = el('button', { class: 'previous', 'aria-label': 'Previous stop', title: 'Previous stop (←)', text: '←' });
    this._next = el('button', { class: 'next', 'aria-label': 'Next stop', title: 'Next stop (→)', text: '→' });
    this._penColor = new Swatches(deck.foreground, () => this._finishStroke());
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
    this._boardButton = el('button', { class: 'board-button', text: 'Whiteboard', title: 'Show or hide the whiteboard (W)', 'aria-pressed': 'false' });
    this._boardButton.addEventListener('click', () => this.toggleWhiteboard());
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
        el('label', {}, 'Pen ', this._penColor.element),
        el('label', {}, 'Tip ', this._penSize),
        this._boardButton,
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
    this._penSize.addEventListener('change', () => this._finishStroke());
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
    const edit = this._editSource ? held('edit') : null;
    const gestures = [
      pen === null ? null : `${pen || 'Plain '}drag: draw with the pen`,
      pointer === null ? null : `${pointer ? `Hold ${pointer.slice(0, -3)}` : 'Hover'}: spotlight or laser (${keys('pointer')} switches)`,
      pointer === null ? null : `${pointer || 'Plain '}drag: highlight · ${pointer || ''}scroll: resize`,
      advance === null ? null : `${advance || 'Plain '}click: next stop`,
      edit === null ? null : `${edit || 'Plain '}click: open the element's source in the editor`,
    ].filter((line): line is string => line !== null);
    const lines = [
      `${keys('next')}: continue`, `${keys('previous')}: previous stop`, `${keys('replay')}: replay`, `${keys('home')}: overview`,
      `${keys('fullscreen')}: fullscreen`, `${keys('exit')}: normal view`, `${keys('outline')}: toggle outline`,
      ...gestures,
      `${keys('undo')}: undo stroke`, `${keys('redo')}: redo stroke`, `${keys('clear')}: clear strokes`,
      `${keys('whiteboard')}: whiteboard (arrows, scrolling or two fingers move it)`,
      ...(this._editSource ? [`${keys('edit')}: open this stop's source in the editor`] : []),
      `${keys('settings')}: settings`,
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
        if (this._live?.surface === 'slide') this._finishStroke();
        this._slideInk.reset();
        this._broadcast({ type: 'ink', surface: 'slide', op: 'replace', strokes: [] });
      }
      this._highlightedSlide = clip.slide;
      this._sendState();
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
    player.on('state', ({ state, message }) => {
      this._stateMessage = message;
      if (this._noticeTimer === null) this._state.textContent = message;
      // Once a stop settles (text sharpened by then), the tablet gets a fresh picture.
      if (state !== 'playing' && state !== 'looping') this._requestFrame(250);
    });
    this._loading.hidden = true;
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        this._layoutHighlights();
        this._requestFrame(400);
      }).observe(this.stageHost);
    }
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
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[combo];
    if (this._boardOn && arrow) {
      event.preventDefault();
      this._panBoardBy(arrow[0], arrow[1]);
      return;
    }
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
      case 'whiteboard': this.toggleWhiteboard(); break;
      case 'edit':
        if (this._editSource) this._editSource();
        else this.notice('Open the deck with zoomdeck serve to jump to the editor');
        break;
    }
  }

  /**
   * How the inverse search opens the editor: with the point of a click, the element under it;
   * without, the current stop. Null (the default) outside the preview server.
   */
  set editSource(handler: ((at?: { x: number; y: number }) => void) | null) {
    this._editSource = handler;
    this._renderShortcuts();
  }

  get editSource(): ((at?: { x: number; y: number }) => void) | null {
    return this._editSource;
  }

  /** Show a message in the header for a few seconds, then the player state again. */
  notice(message: string): void {
    if (this._noticeTimer !== null) clearTimeout(this._noticeTimer);
    this._state.textContent = message;
    this._noticeTimer = window.setTimeout(() => {
      this._noticeTimer = null;
      this._state.textContent = this._stateMessage;
    }, 3000);
  }

  /** Remove the most recent stroke of the surface in front (the whiteboard when shown, else the slide). */
  undoStroke(): void {
    this._finishStroke();
    const surface = this._activeSurface();
    if (this._surface(surface).undo()) this._broadcast({ type: 'ink', surface, op: 'undo' });
  }

  /** Put back the last undone stroke. */
  redoStroke(): void {
    const surface = this._activeSurface();
    if (this._surface(surface).redo()) this._broadcast({ type: 'ink', surface, op: 'redo' });
  }

  /** Erase every stroke of the surface in front; undo brings them back one by one. */
  clearStrokes(): void {
    this._finishStroke();
    const surface = this._activeSurface();
    if (this._surface(surface).clear().length) this._broadcast({ type: 'ink', surface, op: 'clear' });
  }

  /** Show or hide the whiteboard: a blank page with its own strokes and history, kept while slides change. */
  toggleWhiteboard(on = !this._boardOn): void {
    this._setBoardShown(on);
    this._broadcast({ type: 'board', on, pan: { ...this._boardTarget } });
  }

  // ---------------------------------------------------------------------
  // Settings dialog
  // ---------------------------------------------------------------------

  private _reverseToggle!: HTMLInputElement;
  private _bindingsTable!: HTMLElement;
  private _pointerModeSelect!: HTMLSelectElement;
  private readonly _pointerSelects = new Map<PointerAction, HTMLSelectElement>();
  private _penPreset!: HTMLSelectElement;
  private readonly _penRanges = new Map<'thinning' | 'smoothing' | 'streamline' | 'pencilPressure' | 'pencilWidth', HTMLInputElement>();
  private readonly _penToggles = new Map<'taper' | 'simulatePressure', HTMLInputElement>();
  private _pairingStatus!: HTMLElement;
  private _pairingPanel!: HTMLElement;

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

    // Pen: how pressure and motion shape a stroke.
    this._penPreset = el('select', { 'aria-label': 'Pen preset' });
    for (const [value, label] of Object.entries(PEN_PRESET_LABELS)) this._penPreset.append(el('option', { value, text: label }));
    this._penPreset.addEventListener('change', () => {
      const preset = this._penPreset.value as PenPreset;
      if (preset !== 'custom') this._settings.pen = { preset, ...PEN_PRESETS[preset] };
      else this._settings.pen = { ...this._settings.pen, preset };
      this._penChanged();
    });
    const penRows = el('div', { class: 'bindings' });
    penRows.append(el('div', { class: 'binding gesture' }, el('span', { class: 'action', text: 'Preset' }), this._penPreset));
    const ranges: Array<['thinning' | 'smoothing' | 'streamline' | 'pencilPressure' | 'pencilWidth', string, number, number]> = [
      ['pencilWidth', 'Pencil width, relative to the tip size (mouse strokes unaffected)', 0.2, 1.5],
      ['pencilPressure', 'Pencil pressure (lower draws lighter; mouse strokes unaffected)', 0.2, 1.5],
      ['thinning', 'Pressure effect (negative: harder is thinner)', -1, 1],
      ['smoothing', 'Smoothing of the outline', 0, 1],
      ['streamline', 'Steadying (the line lags the hand)', 0, 1],
    ];
    for (const [key, label, min, max] of ranges) {
      const range = el('input', { type: 'range', min: String(min), max: String(max), step: '0.05', 'aria-label': label });
      range.addEventListener('input', () => {
        this._settings.pen = { ...this._settings.pen, preset: 'custom', [key]: Number(range.value) };
        this._penChanged();
      });
      this._penRanges.set(key, range);
      penRows.append(el('div', { class: 'binding gesture' }, el('span', { class: 'action', text: label }), range));
    }
    const toggles: Array<['taper' | 'simulatePressure', string]> = [
      ['taper', 'Taper the ends of a stroke'],
      ['simulatePressure', 'Vary the width with speed when the device has no pressure sensor (mouse, basic styluses)'],
    ];
    for (const [key, label] of toggles) {
      const toggle = el('input', { type: 'checkbox' });
      toggle.addEventListener('change', () => {
        this._settings.pen = { ...this._settings.pen, preset: 'custom', [key]: toggle.checked };
        this._penChanged();
      });
      this._penToggles.set(key, toggle);
      penRows.append(el('label', { class: 'binding gesture row' }, el('span', { class: 'action', text: label }), toggle));
    }
    const resetPen = el('button', { text: 'Restore the default pen' });
    resetPen.addEventListener('click', () => {
      this._settings.pen = { ...DEFAULT_PEN_STYLE };
      this._penChanged();
    });

    // Tablet: pairing through the preview server.
    this._pairingStatus = el('p', { class: 'note' });
    this._pairingPanel = el('div', { class: 'pairing' });
    const pairButton = el('button', { text: 'Show the pairing code' });
    pairButton.addEventListener('click', () => void this._showPairing());

    dialog.append(
      el('header', {}, el('h2', { text: 'Settings' }), close),
      el('section', {},
        el('h3', { text: 'Pointer' }),
        el('p', { class: 'note', text: 'Each gesture is the mouse used with the chosen keys held. Scrolling while the spotlight or laser is shown resizes it; pen color and tip size are in the bar at the bottom. Strokes belong to the slide they were drawn on and clear when you move to another slide; the whiteboard keeps its own.' }),
        gestures,
        resetPointer,
      ),
      el('section', {},
        el('h3', { text: 'Pen' }),
        el('p', { class: 'note', text: 'A pen or stylus with a pressure sensor (Apple Pencil, Wacom) shapes the line as you press; the sliders tune how. Changes also redraw the strokes already on screen.' }),
        penRows,
        resetPen,
      ),
      el('section', { class: 'tablet' },
        el('h3', { text: 'Tablet' }),
        el('p', { class: 'note', text: 'A tablet on the same network can show this deck and draw on it: open the code or address below on the tablet. It follows the presentation and cannot move it; strokes drawn on either device appear on both. Pairing needs the preview server started with --host (zoomdeck serve --host, or npm run dev -- --host).' }),
        this._pairingStatus,
        pairButton,
        this._pairingPanel,
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
    const pen = this._settings.pen;
    this._penPreset.value = pen.preset;
    for (const [key, range] of this._penRanges) range.value = String(pen[key]);
    for (const [key, toggle] of this._penToggles) toggle.checked = pen[key];
    this._pairingStatus.textContent = !padLinkAvailable()
      ? 'Pairing is not available here: this deck is not served by the preview or development server.'
      : this._padsSeen.size
        ? `${this._padsSeen.size} tablet${this._padsSeen.size > 1 ? 's' : ''} connected.`
        : 'No tablet connected yet.';
  }

  private _penChanged(): void {
    saveSettings(this._settings);
    this._syncSettingsForm();
    this._slideInk.restyle();
    this._boardInk.restyle();
  }

  /** Render the tablet's URL as a QR code, or explain what is missing. */
  private async _showPairing(): Promise<void> {
    this._pairingPanel.replaceChildren();
    if (!this._pad) {
      this._pairingPanel.append(el('p', { class: 'note', text: 'Pairing is not available here.' }));
      return;
    }
    const info = await fetchPairingInfo();
    if (!info) {
      this._pairingPanel.append(el('p', { class: 'note', text: 'The server did not answer; is this the preview or development server?' }));
      return;
    }
    if (!info.lan || info.addresses.length === 0) {
      this._pairingPanel.append(el('p', { class: 'note', text: 'The server listens on this computer only. Restart it with --host (zoomdeck serve --host, or npm run dev -- --host) so the tablet can reach it, then come back here.' }));
      return;
    }
    // One code per address: a tablet on a cable (USB sharing) reaches the computer on another
    // link than the Wi-Fi, and only the tablet knows which one it can see.
    const room = this._pad?.room ?? '';
    if (info.addresses.length > 1) {
      this._pairingPanel.append(el('p', { class: 'note', text: 'This computer has several network addresses; scan the one the tablet shares (the Wi-Fi, or the USB connection when sharing over the cable).' }));
    }
    let QRCode: typeof import('qrcode') | null = null;
    try {
      QRCode = await import('qrcode');
    } catch {
      QRCode = null;
    }
    for (const address of info.addresses.slice(0, 4)) {
      const url = padUrl(address, info.port, room);
      const canvas = el('canvas', { class: 'qr', 'aria-label': `Pairing code for ${address}` });
      this._pairingPanel.append(el('div', { class: 'code' }, canvas, el('p', { class: 'note url', text: url })));
      try {
        if (QRCode) await QRCode.toCanvas(canvas, url, { width: 200, margin: 1 });
        else canvas.remove();
      } catch {
        canvas.remove();
      }
    }
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
    this._finishStroke();
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
  // Ink: pen and highlighter strokes on the slide or the whiteboard
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
    for (const svg of [this._highlights, this._board]) {
      svg.setAttribute('viewBox', `${-width / 2} ${-height / 2} ${width} ${height}`);
      svg.style.width = `${width * scale}px`;
      svg.style.height = `${height * scale}px`;
    }
    this._layoutBoardGrid();
  }

  /** The dotted grid of the whiteboard scrolls with its content. */
  private _layoutBoardGrid(): void {
    const { scale } = this._highlightGeometry();
    const cell = 50 * scale;
    this._boardLayer.style.backgroundSize = `${cell}px ${cell}px`;
    this._boardLayer.style.backgroundPosition =
      `calc(50% - ${(this._boardPan.x * scale) % cell}px) calc(50% - ${(this._boardPan.y * scale) % cell}px)`;
  }

  /** Surface coordinates of a page point: slide units around the stage center, plus the whiteboard's pan. */
  private _surfacePoint(clientX: number, clientY: number, surface: InkSurfaceName): { x: number; y: number } {
    const { bounds, scale } = this._highlightGeometry();
    const x = (clientX - bounds.left - bounds.width / 2) / scale;
    const y = (clientY - bounds.top - bounds.height / 2) / scale;
    return surface === 'board' ? { x: x + this._boardPan.x, y: y + this._boardPan.y } : { x, y };
  }

  private _activeSurface(): InkSurfaceName {
    return this._boardOn ? 'board' : 'slide';
  }

  private _surface(name: InkSurfaceName): InkSurface {
    return name === 'board' ? this._boardInk : this._slideInk;
  }

  /** The pointer action selected by the modifier keys currently held. */
  private _activeTool(): PointerAction | null {
    return pointerActionFor(this._settings, this._modifiers);
  }

  private _drawingTool(): InkTool | null {
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

  private _sample(event: { clientX: number; clientY: number; pressure?: number; pointerType?: string }, surface: InkSurfaceName): InkSample {
    const { x, y } = this._surfacePoint(event.clientX, event.clientY, surface);
    const p = event.pointerType === 'pen' && event.pressure ? event.pressure : 0.5;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, p: Math.round(p * 1000) / 1000 };
  }

  private _beginStroke(event: PointerEvent, tool: InkTool): void {
    this._finishStroke();
    const surface = this._activeSurface();
    const { scale } = this._highlightGeometry();
    const highlighterWidth = this._settings.pointerMode === 'laser' ? this._radius / 3 : 2 * this._radius;
    const stroke: InkStroke = {
      id: newStrokeId(this._pad?.id ?? 'local'),
      tool,
      color: tool === 'pen' ? (this._penColor.value === 'foreground' ? this._deck.foreground : this._penColor.value) : HIGHLIGHTER_COLOR,
      size: (tool === 'pen' ? Number(this._penSize.value) : highlighterWidth) / scale,
      pressure: event.pointerType === 'pen' && event.pressure > 0,
      samples: [this._sample(event, surface)],
    };
    this._surface(surface).begin(stroke);
    this._live = { id: stroke.id, tool, surface, pointerId: event.pointerId, pending: [], frame: null, pressure: stroke.pressure, announce: false };
    try {
      this.stageHost.setPointerCapture(event.pointerId);
    } catch {
      /* capture unavailable */
    }
    this.stageHost.classList.add('stroking');
    this._broadcast({ type: 'ink', surface, op: 'begin', stroke });
  }

  /** Add the samples of a move event (every coalesced one) to the live stroke. */
  private _extendStroke(event: PointerEvent): void {
    const live = this._live;
    if (!live || event.pointerId !== live.pointerId) return;
    const events = event.getCoalescedEvents?.() ?? [];
    const source = events.length ? events : [event];
    const samples = source.map((sample) => this._sample(sample, live.surface));
    const surface = this._surface(live.surface);
    surface.extend(live.id, samples);
    if (!live.pressure && source.some((sample) => sample.pointerType === 'pen' && sample.pressure > 0)) {
      live.pressure = true;
      live.announce = true;
      surface.setPressure(live.id, true);
    }
    // Draw at once rather than at the next frame, with the browser's prediction of where the pen goes.
    const predicted = (event.getPredictedEvents?.() ?? []).slice(0, 4).map((sample) => this._sample(sample, live.surface));
    surface.drawLive(live.id, predicted);
    if (!this._pad) return;
    live.pending.push(...samples);
    if (live.frame === null) {
      live.frame = requestAnimationFrame(() => {
        live.frame = null;
        this._flushPending(live);
      });
    }
  }

  /** Send the samples gathered since the last frame to the other device. */
  private _flushPending(live: NonNullable<PlayerUI['_live']>): void {
    if (live.pending.length === 0 && !live.announce) return;
    this._broadcast({ type: 'ink', surface: live.surface, op: 'extend', id: live.id, samples: live.pending, ...(live.announce ? { pressure: true as const } : {}) });
    live.pending = [];
    live.announce = false;
  }

  private _finishStroke(): void {
    const live = this._live;
    if (!live) return;
    this._live = null;
    if (live.frame !== null) cancelAnimationFrame(live.frame);
    this._flushPending(live);
    this._surface(live.surface).end(live.id);
    this._broadcast({ type: 'ink', surface: live.surface, op: 'end', id: live.id });
    try {
      this.stageHost.releasePointerCapture(live.pointerId);
    } catch {
      /* not captured */
    }
    this.stageHost.classList.remove('stroking');
  }

  /** Remove the dots left by the clicks of a double-click. */
  dropTaps(): void {
    this._finishStroke();
    const surface = this._activeSurface();
    const dropped = this._surface(surface).dropRecentTaps(2, 1500);
    for (let n = 0; n < dropped; n++) this._broadcast({ type: 'ink', surface, op: 'undo' });
  }

  // ---------------------------------------------------------------------
  // Whiteboard panning: arrows glide by a quarter of the view, wheel and two fingers scroll directly
  // ---------------------------------------------------------------------

  /** Scroll the whiteboard by a fraction of its viewport; dy > 0 moves the view up. */
  private _panBoardBy(dx: number, dy: number): void {
    const { width, height } = this._viewportPixels();
    this._setBoardPan(this._boardTarget.x + dx * width * BOARD_STEP, this._boardTarget.y - dy * height * BOARD_STEP, true);
    this._broadcast({ type: 'board', on: this._boardOn, pan: { ...this._boardTarget } });
  }

  /** Move the whiteboard viewport to (x, y), at once or gliding there. */
  private _setBoardPan(x: number, y: number, animate: boolean): void {
    this._boardTarget = { x, y };
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    // A hidden page gets no animation frames, so a paired device in the background jumps instead.
    if (!animate || reduced || document.hidden) {
      if (this._boardFrame !== null) {
        cancelAnimationFrame(this._boardFrame);
        this._boardFrame = null;
      }
      this._applyBoardPan(x, y);
      return;
    }
    if (this._boardFrame !== null) return;
    const step = () => {
      const dx = this._boardTarget.x - this._boardPan.x;
      const dy = this._boardTarget.y - this._boardPan.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        this._boardFrame = null;
        this._applyBoardPan(this._boardTarget.x, this._boardTarget.y);
        return;
      }
      this._applyBoardPan(this._boardPan.x + dx * 0.2, this._boardPan.y + dy * 0.2);
      this._boardFrame = requestAnimationFrame(step);
    };
    this._boardFrame = requestAnimationFrame(step);
  }

  private _applyBoardPan(x: number, y: number): void {
    this._boardPan = { x, y };
    this._boardInk.setPan(x, y);
    this._layoutBoardGrid();
  }

  private _boardSyncFrame: number | null = null;

  /** Tell the other device where the whiteboard is, at most once per frame. */
  private _queueBoardBroadcast(): void {
    if (!this._pad || this._boardSyncFrame !== null) return;
    this._boardSyncFrame = requestAnimationFrame(() => {
      this._boardSyncFrame = null;
      this._broadcast({ type: 'board', on: this._boardOn, pan: { ...this._boardTarget } });
    });
  }

  private _setBoardShown(on: boolean): void {
    this._finishStroke();
    this._boardOn = on;
    this._boardLayer.hidden = !on;
    this.stageHost.classList.toggle('board-on', on);
    this._boardButton.setAttribute('aria-pressed', String(on));
    this._state.textContent = on ? 'Whiteboard' : 'Slides';
    this._updateSpotlight();
  }

  /**
   * A fingertip rubbed over a stroke erases it. Not while a pen is at work or was just seen
   * (that finger is a resting palm), and not for a wide contact, which is a palm as well.
   */
  private _fingerErase(event: PointerEvent): void {
    // Safari reports a fingertip as 40 to 60 px across, a palm as well over 100; a hovering pen does not count as working.
    if (this._touches.size !== 1 || this._live || performance.now() - this._penSeen < 300) return;
    if (event.width > 90 || event.height > 90) return;
    const surface = this._activeSurface();
    const { scale } = this._highlightGeometry();
    const point = this._surfacePoint(event.clientX, event.clientY, surface);
    const id = this._surface(surface).strokeAt(point.x, point.y, ERASE_REACH_PX / scale);
    if (!id) return;
    this._surface(surface).erase(id);
    this._broadcast({ type: 'ink', surface, op: 'erase', id });
  }

  /** Two fingers on a touch screen scroll the whiteboard; a single finger never draws, it erases. */
  private _touchMove(event: PointerEvent): void {
    const previous = this._touches.get(event.pointerId);
    if (!previous) return;
    this._touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this._touches.size === 1) {
      this._fingerErase(event);
      return;
    }
    if (!this._boardOn || this._touches.size < 2) return;
    const { scale } = this._highlightGeometry();
    const share = this._touches.size;
    this._setBoardPan(
      this._boardTarget.x - (event.clientX - previous.x) / scale / share,
      this._boardTarget.y - (event.clientY - previous.y) / scale / share,
      false,
    );
    this._queueBoardBroadcast();
  }

  // ---------------------------------------------------------------------
  // Spotlight or laser
  // ---------------------------------------------------------------------

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
    this._finishStroke();
    this._updateSpotlight();
  }

  private _installPointerTools(): void {
    const stage = this.stageHost;
    const modifierKeys = ['Shift', 'Control', 'Alt', 'Meta'];
    // Clicks on links, live pages and controls inside the stage are theirs, not the pen's.
    const interactive = (event: Event) => Boolean((event.target as Element | null)?.closest?.('a, iframe, button, select, input'));
    // Cancelling touch events on the stage (not on links, pages or controls) ends Safari's gesture
    // arbitration at once: with a palm resting, a pencil coming down otherwise looks like a pinch
    // and its first events are held back, which loses the start of quick strokes.
    for (const type of ['touchstart', 'touchmove', 'touchend'] as const) {
      stage.addEventListener(type, (event) => { if (!interactive(event)) event.preventDefault(); }, { passive: false });
    }
    // Raw updates reach the page before the frame is painted, which is what makes a pen feel immediate.
    const raw = 'onpointerrawupdate' in stage;
    if (raw) {
      stage.addEventListener('pointerrawupdate' as 'pointermove', (event: PointerEvent) => {
        if (event.pointerType !== 'touch' && event.buttons & 1) this._extendStroke(event);
      });
    }
    stage.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') {
        this._touchMove(event);
        return;
      }
      if (event.pointerType === 'pen' && event.buttons & 1) this._penSeen = performance.now();
      this._pointer = { x: event.clientX, y: event.clientY };
      this._modifiers = modifierCombo(event);
      if (this._live) {
        if (!(event.buttons & 1)) this._finishStroke();
        else if (!raw) this._extendStroke(event);
      }
      this._updateSpotlight();
    });
    stage.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') {
        this._touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (!interactive(event)) this._fingerErase(event);
        return;
      }
      if (event.pointerType === 'pen') this._penSeen = performance.now();
      if (event.button !== 0 || interactive(event)) return;
      this._modifiers = modifierCombo(event);
      this._pointer = { x: event.clientX, y: event.clientY };
      const tool = this._activeTool();
      if (tool === 'advance') {
        event.preventDefault();
        void this._player?.next();
        return;
      }
      if (tool === 'edit') {
        event.preventDefault();
        if (this._editSource) this._editSource({ x: event.clientX, y: event.clientY });
        else this.notice('Open the deck with zoomdeck serve to jump to the editor');
        return;
      }
      const drawing = this._drawingTool();
      if (drawing) {
        event.preventDefault();
        this._beginStroke(event, drawing);
      }
      this._updateSpotlight();
    });
    const release = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        this._touches.delete(event.pointerId);
        return;
      }
      if (event.pointerType === 'pen') this._penSeen = performance.now();
      if (this._live && this._live.pointerId === event.pointerId) this._finishStroke();
    };
    document.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('contextmenu', (event) => {
      // Control + click is a context menu on macOS; keep it for the tools bound to Control.
      if (event.ctrlKey && pointerActionFor(this._settings, modifierCombo(event)) !== null) event.preventDefault();
    });
    stage.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch') return;
      this._pointer = null;
      this._updateSpotlight();
    });
    document.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      if (!modifierKeys.includes(event.key) || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable) return;
      this._modifiers = modifierCombo(event);
      if (this._live && this._live.tool !== this._drawingTool()) this._finishStroke();
      this._updateSpotlight();
    });
    document.addEventListener('keyup', (event) => {
      if (!modifierKeys.includes(event.key)) return;
      this._modifiers = modifierCombo(event);
      if (this._live && this._live.tool !== this._drawingTool()) this._finishStroke();
      this._updateSpotlight();
    });
    stage.addEventListener('wheel', (event) => {
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      if (this._boardOn && this._activeTool() !== 'pointer') {
        event.preventDefault();
        const { scale } = this._highlightGeometry();
        this._setBoardPan(this._boardTarget.x + (event.deltaX * unit) / scale, this._boardTarget.y + (event.deltaY * unit) / scale, false);
        this._queueBoardBroadcast();
        return;
      }
      if (this._activeTool() !== 'pointer' || this._pointer === null) return;
      event.preventDefault();
      const delta = Math.max(-1000, Math.min(1000, (event.deltaY || event.deltaX) * unit));
      this._radius *= Math.exp(-delta * 0.002);
      this._updateSpotlight();
    }, { passive: false });
    window.addEventListener('blur', () => this._releaseSpotlight());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this._releaseSpotlight(); });
  }

  // ---------------------------------------------------------------------
  // The companion tablet
  // ---------------------------------------------------------------------

  /** Join a pairing room: this page drives the stop and sends pictures; both devices draw. */
  connectPad(link: PadLink): void {
    this._pad = link;
    link.on((message, from) => this._onPadMessage(message, from));
    link.send({ type: 'hello', role: 'presenter' });
    this._syncSettingsForm();
  }

  private _broadcast(message: PadMessage): void {
    this._pad?.send(message);
  }

  private _sendState(): void {
    if (!this._pad || !this._player) return;
    this._pad.send({
      type: 'state',
      clip: this._player.index,
      board: this._boardOn,
      pan: { ...this._boardTarget },
      aspect: this._deck.viewport.width / this._deck.viewport.height,
      background: this._deck.background,
      foreground: this._deck.foreground,
    });
  }

  private _onPadMessage(message: PadMessage, from: string): void {
    switch (message.type) {
      case 'hello':
        if (message.role !== 'pad') break;
        this._padsSeen.add(from);
        this._state.textContent = 'Tablet connected';
        this._syncSettingsForm();
        this._sendState();
        this._pad?.send({ type: 'ink', surface: 'slide', op: 'replace', strokes: this._slideInk.strokes });
        this._pad?.send({ type: 'ink', surface: 'board', op: 'replace', strokes: this._boardInk.strokes });
        this._sendFrame();
        break;
      case 'board':
        this._applyBoard(message.on, message.pan);
        break;
      case 'ink':
        this._applyInk(message.surface, message);
        break;
      case 'hover':
        this._showRemoteCursor(message);
        break;
      case 'state':
      case 'frame':
        break;
    }
  }

  private _applyBoard(on: boolean, pan: { x: number; y: number }): void {
    if (on !== this._boardOn) this._setBoardShown(on);
    if (pan.x !== this._boardTarget.x || pan.y !== this._boardTarget.y) this._setBoardPan(pan.x, pan.y, true);
  }

  private _applyInk(surface: InkSurfaceName, op: InkOp): void {
    const target = this._surface(surface);
    switch (op.op) {
      case 'begin': target.begin(op.stroke); break;
      case 'extend':
        target.extend(op.id, op.samples);
        if (op.pressure) target.setPressure(op.id, true);
        break;
      case 'end': target.end(op.id); break;
      case 'erase': target.erase(op.id); break;
      case 'undo': target.undo(); break;
      case 'redo': target.redo(); break;
      case 'clear': target.clear(); break;
      case 'replace': target.replace(op.strokes); break;
    }
  }

  /** Send the tablet a picture of the current view, a moment after things settle. */
  private _requestFrame(delay: number): void {
    if (!this._pad || this._padsSeen.size === 0) return;
    if (this._frameTimer !== null) clearTimeout(this._frameTimer);
    this._frameTimer = window.setTimeout(() => {
      this._frameTimer = null;
      this._sendFrame();
    }, delay);
  }

  /**
   * Capture the deck's viewport (the letterboxed area the ink overlay covers) from the WebGL
   * canvas right after a render, when its buffer is still readable, as a JPEG data URL.
   */
  private _sendFrame(): void {
    const stage = this._stage;
    const canvas = this.stageHost.querySelector('canvas');
    if (!this._pad || !stage || !canvas || canvas.width === 0) return;
    stage.render();
    const { width, height, scale } = this._highlightGeometry();
    const ratio = canvas.width / Math.max(1, this.stageHost.clientWidth);
    const sw = Math.max(1, Math.round(width * scale * ratio));
    const sh = Math.max(1, Math.round(height * scale * ratio));
    const sx = Math.round((canvas.width - sw) / 2);
    const sy = Math.round((canvas.height - sh) / 2);
    const k = Math.min(1, 1600 / sw);
    const target = document.createElement('canvas');
    target.width = Math.max(1, Math.round(sw * k));
    target.height = Math.max(1, Math.round(sh * k));
    const context = target.getContext('2d');
    if (!context) return;
    context.fillStyle = this._deck.background;
    context.fillRect(0, 0, target.width, target.height);
    try {
      context.drawImage(canvas, sx, sy, sw, sh, 0, 0, target.width, target.height);
      this._pad.send({ type: 'frame', image: target.toDataURL('image/jpeg', 0.85), clip: this._player?.index ?? 0 });
    } catch {
      /* a tainted or lost canvas: the tablet keeps its last picture */
    }
  }

  private _showRemoteCursor(message: { x: number; y: number; visible: boolean }): void {
    this._remoteCursor.hidden = !message.visible;
    if (!message.visible) return;
    const { bounds, scale } = this._highlightGeometry();
    const pan = this._boardOn ? this._boardPan : { x: 0, y: 0 };
    this._remoteCursor.style.left = `${bounds.width / 2 + (message.x - pan.x) * scale}px`;
    this._remoteCursor.style.top = `${bounds.height / 2 + (message.y - pan.y) * scale}px`;
  }
}
