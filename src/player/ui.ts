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
  ACTIONS, ACTION_GROUPS, CORNERS, DEFAULT_POINTER_BINDINGS, DEFAULT_RECORDING, DEFAULT_TIP_SIZE, MODIFIER_COMBOS, PIP_SIZES, POINTER_ACTIONS, TIP_SIZES,
  type ActionInfo, type ActionName, type Feature, type PlayerSettings, type PointerAction, type PointerMode,
  actionFor, defaultSettings, describeCombo, describeModifiers, enabledFeatures, featureOf, keyCombo, loadSettings, modifierCombo, pointerActionFor, saveSettings,
} from './settings';
import {
  DEFAULT_PEN_STYLE, InkSurface, PEN_PRESETS, PEN_PRESET_LABELS, newStrokeId, type InkSample, type InkStroke, type InkTool, type PenPreset,
} from './ink';
import MarkdownIt from 'markdown-it';
import { PadLink, fetchPairingInfo, padCode, padLinkAvailable, padUrl, type InkOp, type InkSurfaceName, type PadDevice, type PadMessage } from './pad';
import { PEN_COLORS, Swatches } from './swatches';
import { Recorder, initialEvents, type CapturedMedia } from './recorder';
import { Playback } from './playback';
import { exportMimeType, exportVideo, type ExportSource } from './export';
import { PRINT_WIDTHS, printDeck, printPages, type PrintPages } from './print';
import { zipFiles } from './zip';
import {
  checkWebExportPlace, defaultWebExportName, downloadUrl, folderProblem, forgetWebExport, placeWebExport, startWebExport, waitForWebExport, webExportAvailable, webExportFileUrl,
  webExportName, webExportZipUrl, writeWebExportFile, writeWebExportFolder, type DirectoryPickerWindow, type WebPageForm,
} from './webpage';
import { deleteRecording, describeMedia, download, listRecordings, loadTimeline, mediaFileName, mediaSource, recordingStoreAvailable, RecordingSession, recordingUrl, saveFile, type RecordingEntry } from './store';
import { awayFromDeck } from './away';
import { displayWidth, frameAspect, frameSize, renderPageUrl, renderPlan, RenderSession, renderStatus, renderTalk, requestRender, VIDEO_HEIGHTS, type AspectChoice, type RenderStatus } from './render';
import { appendPart, aspectName, formatTime, presentedAspect, recordingName, stopRef, structureHash, timeOfStop, type Corner, type MediaLane, type PointerKind, type Timeline, type TimelineEvent, type TimelineMedia, type UntimedEvent } from './timeline';

/** A tablet page known to the presenter. */
interface PadEntry {
  device: PadDevice | null;
  /** Admitted by trust or by the pairing code: its strokes count and it gets the pictures. */
  admitted: boolean;
  /** Dismissed by the presenter: no prompt for it again in this session. */
  ignored: boolean;
}

/** How far from a stroke's path, in screen pixels, a fingertip still erases it. */
const ERASE_REACH_PX = 12;

const HIGHLIGHTER_COLOR = '#ffdf00';
/** Fraction of the whiteboard viewport one arrow press scrolls. */
const BOARD_STEP = 0.25;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The tracks a recorded talk may have, as the list of talks shows them; the deck's own (the timeline) is always there. */
type TrackKind = 'deck' | 'voice' | 'camera' | 'screen' | 'sound';

/** Small line drawings of the tracks, in a 24-unit box: a slide with a play mark, a microphone, a camera, a screen, a loudspeaker. */
const TRACK_ICON_PATHS: Record<TrackKind, string> = {
  deck: 'M3 5h18v14H3zM10 9.5v5l4.5-2.5z',
  voice: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3M8 21h8',
  camera: 'M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5z',
  screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
  sound: 'M4 9h4l5-4v14l-5-4H4zM16.5 9.5a4 4 0 0 1 0 5M19 7a7.5 7.5 0 0 1 0 10',
};

/** One track's icon, named for screen readers and in its tooltip. */
function trackIcon(kind: TrackKind, label: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'track-icon');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = label;
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', TRACK_ICON_PATHS[kind]);
  svg.append(title, path);
  return svg;
}

/** The live camera as the presenter sets it: off, in a corner of the slides, or full frame. */
export type CameraMode = 'off' | 'corner' | 'full';

/** What the export dialog settles: the file's name (without extension) and where it goes. */
/** The document picture-in-picture API (Chromium): a small always-on-top window with a document of the page's own. */
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number; disallowReturnToOpener?: boolean; preferInitialWindowPlacement?: boolean }): Promise<Window>;
  readonly window: Window | null;
}
type PipWindow = Window & { documentPictureInPicture?: DocumentPictureInPicture };

interface ExportChoice {
  name: string;
  /** How the video is made: off the clock by the server (an MP4), or in this page in real time (a WebM). */
  method: 'server' | 'page';
  /** Where the file goes: a folder chosen through the browser's save dialog, the recordings folder next to the deck, the browser's downloads, or nowhere yet (`keep`: the list of talks plays it and offers it for download). */
  destination: 'pick' | 'folder' | 'download' | 'keep';
  /** The frame: a standard height or the display's own width, in the chosen proportions. */
  size: number | 'display';
  aspect: AspectChoice;
  /** The file chosen through the browser's save dialog, where it offers one. */
  handle?: FileSystemFileHandle;
}

/** The File System Access API's save dialog, present in Chromium browsers and not yet in the DOM typings used here. */
interface SavePickerWindow extends Window {
  showSaveFilePicker?: (options?: { suggestedName?: string; types?: Array<{ description?: string; accept: Record<string, string[]> }> }) => Promise<FileSystemFileHandle>;
}

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
  /**
   * The player is one element of a larger page rather than the page itself: it fills its host,
   * leaves the document's title, colors and styles alone, and takes keys only while it has the
   * focus (a click on the slides gives it). Defaults to false.
   */
  embedded?: boolean;
  /** Features to leave out (`{ camera: false }`); each hides its controls and makes its keys inert. */
  features?: Partial<Record<Feature, boolean>>;
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
  private readonly _loadingBar: HTMLProgressElement;
  private readonly _loadingText: HTMLElement;
  private readonly _outlineToggle: HTMLButtonElement;
  private readonly _penColor: Swatches;
  /** Drawing mode: a plain drag of the mouse draws, and the pointer shows the pen in its color. */
  private _drawingOn = false;
  /** What drawing was before the whiteboard turned it on, to come back to when the whiteboard goes. */
  private _drawingBeforeBoard = false;
  private _tipSelect!: HTMLSelectElement;
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
  // The camera: a live picture while presenting (full frame on C, else in a corner), or the recording's picture during playback.
  private readonly _camera: HTMLVideoElement;
  private _cameraStream: MediaStream | null = null;
  private _cameraMode: CameraMode = 'off';
  /** The screen share, while the presenter films the screen or holds it for the time spent away from the deck. */
  private _screenStream: MediaStream | null = null;
  /** Whether the screen is being filmed now (the Screen button pressed, or the deck left), beside the camera. */
  private _screenFilming = false;
  /** The element showing a recording's filmed screen, full frame under the camera's corner picture. */
  private readonly _screen: HTMLVideoElement;
  /** The element playing a recording's system lane: the computer's sound, captured with the screen share. */
  private readonly _system: HTMLAudioElement;
  /** Whether the filming began by itself when the deck was left, so that coming back ends it. */
  private _autoFilming = false;
  /** The presenter declined to share the screen when the deck was left during a recording: not asked again in this session. */
  private _screenDeclined = false;
  /** The offer to share the screen, while it is up. */
  private _screenOffer: HTMLElement | null = null;
  /** The camera's floating window of the page's own (document picture-in-picture), while it is open. */
  private _pipWindow: Window | null = null;
  /** Whether the pointer is over the camera's corner picture, which then steps aside so that what it covers shows (the setting allows it). */
  private _cornerHovered = false;
  /** During a playback: the recorded corner picture was set aside by the presenter's pointer at this moment. */
  private _playbackCornerHidden = false;
  /** Whether the deck was left while the screen was filmed by hand, so that coming back ends the filming too. */
  private _awayWhileFilming = false;
  /** Prompts of the browser open (its pickers for the screen and the camera), whose focus changes are no leave. */
  private _prompting = 0;
  private _awayTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _screenButton: HTMLButtonElement;
  /** Beside Screen while a share is held: opens the browser's picker again, for another screen or window. */
  private readonly _screenPickButton: HTMLButtonElement;
  /** Whether the camera picture (live, or the recording's during playback) is shown full frame. */
  private _cameraFull = false;
  private readonly _cameraButton: HTMLButtonElement;
  // Recording a talk.
  private _recorder: Recorder | null = null;
  private _printButton: HTMLButtonElement;
  private readonly _fullscreenButton: HTMLButtonElement;
  private readonly _settingsButton: HTMLButtonElement;
  private _recordStream: MediaStream | null = null;
  /** The recording being continued, when the current one appends to an earlier talk. */
  private _appendTo: { name: string; timeline: Timeline } | null = null;
  /** The server writing the talk's bundle while it is recorded; null without the server. */
  private _session: RecordingSession | null = null;
  /** The name of the talk being recorded, chosen when it starts. */
  private _talkName: string | null = null;
  private _draftTick = 0;
  /** What the server says about rendering videos: whether it can (ffmpeg), whether it opens render pages itself, and the jobs of this deck's talks. */
  private _render: RenderStatus = { ffmpeg: false, desktop: false, jobs: [] };
  private _renderToggle!: HTMLInputElement;
  private _renderSizeSelect!: HTMLSelectElement;
  private _renderAspectSelect!: HTMLSelectElement;

  /** The deck viewport's proportions, width over height. */
  private get _deckAspect(): number {
    return this._deck.viewport.width / this._deck.viewport.height;
  }

  /** The stage's proportions as the window shows it now; null before the stage has a size. */
  private _stageAspect(): number | null {
    const width = this.stageHost.clientWidth;
    const height = this.stageHost.clientHeight;
    return width > 0 && height > 0 ? Math.round((width / height) * 1000) / 1000 : null;
  }

  /** A select of video sizes: the standard ones by name, then the display's own; '' stands for the display. */
  private _sizeSelect(label: string, current: number | null): HTMLSelectElement {
    const select = el('select', { 'aria-label': label });
    for (const [height, text] of VIDEO_HEIGHTS) select.append(el('option', { value: String(height), text }));
    select.append(el('option', { value: '', text: `The display's own size (${displayWidth()} px wide)` }));
    select.value = current === null ? '' : String(current);
    return select;
  }

  /** A select of frame proportions; `presented` names the recorded ones when a timeline is given. */
  private _aspectSelect(label: string, current: AspectChoice, timeline: Timeline | null): HTMLSelectElement {
    const select = el('select', { 'aria-label': label });
    const presented = timeline ? presentedAspect(timeline.events, timeline.duration) : null;
    select.append(el('option', { value: 'presented', text: `As presented${presented ? ` (${aspectName(presented)}, the window's)` : timeline ? ` (not kept by this recording: the deck's, ${aspectName(this._deckAspect)})` : ''}` }));
    select.append(el('option', { value: 'deck', text: `The deck's (${aspectName(this._deckAspect)}; drawings made beyond the slides may be cropped)` }));
    select.append(el('option', { value: 'wide', text: '16:9 (drawings made beyond the slides may be cropped)' }));
    select.value = current;
    return select;
  }
  private readonly _recordButton: HTMLButtonElement;
  private readonly _pauseButton: HTMLButtonElement;
  private readonly _recordLabel: HTMLElement;
  private _recordTimer: number | null = null;
  private _pointerMarked = false;
  private _lastPointerMark = 0;
  // Playing a recording back.
  private _playback: Playback | null = null;
  private _playbackName: string | null = null;
  private _playbackPointer: { mode: PointerKind; x: number; y: number; r: number } | null = null;
  private readonly _playbackBar: HTMLElement;
  private readonly _playToggle: HTMLButtonElement;
  private readonly _playTime: HTMLElement;
  private readonly _playRange: HTMLInputElement;
  /** The Export button of the footer, beside the settings: it opens the Export dialog. */
  private readonly _exportButton: HTMLButtonElement;
  /** In the playback bar, the progress of a talk being made into a video in this page. */
  private readonly _exportProgress: HTMLElement;
  private readonly _recordingsButton: HTMLButtonElement;
  private _recordings: RecordingEntry[] = [];
  /**
   * Talks recorded where no server keeps them (a deck on a static host, or a save that failed):
   * their timeline and files stay in memory until the page closes, so that they play back and
   * export like the others; the downloaded bundle is their only lasting copy.
   */
  private readonly _memoryTalks = new Map<string, { timeline: Timeline; files: Map<string, Blob>; urls: Map<string, string> }>();
  /** Videos made in this page during the session, by talk: the list of talks plays them and offers them for download. */
  private readonly _sessionVideos = new Map<string, { url: string; name: string }>();
  /** A talk being exported in this page, in real time: the playback is not to be touched meanwhile. */
  private _exporting = false;
  /** The deck being exported as a web page: the server builds it, then this page delivers it. */
  private _webExporting = false;
  /** The last choices made for the web page in the Export dialog, kept for the session. */
  private _webChoice: { form: WebPageForm; notes: boolean; destination: string | null } = { form: 'file', notes: true, destination: null };
  private _printing = false;
  /** The last choices made in the print dialog, kept for the session. */
  private _printChoice: { pages: PrintPages; width: number } = { pages: 'stages', width: 2560 };
  private _editSource: ((at?: { x: number; y: number }) => void) | null = null;
  private _stateMessage = 'Loading…';
  private _noticeTimer: number | null = null;
  /** The tablets that said hello, by the id of their page: admitted (by trust or the pairing code), or waiting to be allowed. */
  private readonly _pads = new Map<string, PadEntry>();
  private _padRequest!: HTMLElement;
  private _padList!: HTMLElement;
  private _frameTimer: number | null = null;
  private readonly _useLocation: boolean;
  private readonly _embedded: boolean;
  private readonly _features: Set<Feature>;
  /** Listeners on the document and the window, and timers, end with the player: `dispose` aborts them. */
  private readonly _abort = new AbortController();
  private _resizeObserver: ResizeObserver | null = null;
  private readonly _settings: PlayerSettings;
  private readonly _dialog: HTMLDialogElement;
  private readonly _shortcuts: HTMLElement;
  private _capturing: ActionName | null = null;

  constructor(host: HTMLElement, deck: ResolvedDeck, options: PlayerUIOptions = {}) {
    this._deck = deck;
    this._useLocation = options.useLocation ?? true;
    this._embedded = options.embedded ?? false;
    this._features = enabledFeatures(options.features);
    this._settings = loadSettings();
    this._renderingAtLoad = JSON.stringify(this._settings.rendering);
    if (!document.getElementById('zd-player-style')) {
      document.head.append(el('style', { id: 'zd-player-style', text: playerCss }));
    }
    const colorScheme = PlayerUI._isLight(deck.background) ? 'light' : 'dark';
    if (!this._embedded) {
      // The page is the player's: its title, colors and scrollbars follow the deck.
      document.title = deck.title;
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty('--background', deck.background);
      rootStyle.setProperty('--foreground', deck.foreground);
      rootStyle.colorScheme = colorScheme;
      document.body.classList.add('zd-page');
      document.body.style.background = deck.background;
    }

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
    this._recordLabel = el('span', { class: 'record-label', hidden: '', role: 'status' });
    const header = el('header', {}, this._outlineToggle, this._breadcrumb, this._recordLabel, this._state);

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
    this._camera = el('video', { class: 'camera', hidden: '', playsinline: '', autoplay: '', 'aria-label': 'Camera' });
    this._camera.muted = true;
    this._camera.addEventListener('loadedmetadata', () => this._layoutCamera());
    this._camera.addEventListener('emptied', () => this._layoutCamera());
    this._screen = el('video', { class: 'screen', hidden: '', playsinline: '', 'aria-label': 'The filmed screen' });
    this._screen.muted = true;
    this._screen.addEventListener('loadedmetadata', () => this._layoutCamera());
    this._system = el('audio', { class: 'system', hidden: '', 'aria-label': "The computer's sound" }) as HTMLAudioElement;
    this._error = el('p', { class: 'error', role: 'alert', hidden: '' });
    // While the deck loads: a bar and the slide count, nothing more.
    this._loadingBar = el('progress', { max: '1', value: '0', 'aria-label': 'Loading the deck' });
    this._loadingText = el('span', { class: 'count' });
    this._loading = el('div', { class: 'loading', role: 'status' }, this._loadingBar, this._loadingText);
    // Playback of a recorded talk: play or pause, a scrubber, the time, the export, and the way out.
    this._playToggle = el('button', { class: 'play-toggle', 'aria-label': 'Play or pause the recording', text: '▶' });
    this._playRange = el('input', { type: 'range', min: '0', max: '1000', value: '0', 'aria-label': 'Position in the recording' });
    this._playTime = el('span', { class: 'play-time', text: '0:00 / 0:00' });
    this._exportProgress = el('span', { class: 'export-progress', role: 'status', hidden: '' });
    const talks = el('button', { class: 'talks-button', text: 'Talks…', title: 'Choose, continue or delete a recorded talk' });
    talks.addEventListener('click', () => this.openRecordingList());
    const closePlayback = el('button', { class: 'close-playback', 'aria-label': 'Leave the recording', title: 'Leave the recording (Esc)', text: '×' });
    this._playbackBar = el('div', { class: 'playback-bar', hidden: '', role: 'group', 'aria-label': 'Recording playback' },
      this._playToggle, this._playRange, this._playTime, this._exportProgress, talks, closePlayback);
    this._playToggle.addEventListener('click', () => this._playback?.toggle());
    this._playRange.addEventListener('input', () => {
      const playback = this._playback;
      if (playback) playback.seek((Number(this._playRange.value) / 1000) * playback.duration);
    });
    closePlayback.addEventListener('click', () => this.closeRecording());
    this._padRequest = el('div', { class: 'pad-request', role: 'dialog', 'aria-label': 'A tablet asks to draw here', hidden: '' });
    this.stageHost.append(this._boardLayer, this._highlights, this._screen, this._system, this._camera, this._spotlight, this._remoteCursor, this._error, this._loading, this._padRequest);

    this._previous = el('button', { class: 'previous', 'aria-label': 'Previous stop', title: 'Previous stop (←)', text: '←' });
    this._next = el('button', { class: 'next', 'aria-label': 'Next stop', title: 'Next stop (→)', text: '→' });
    this._penColor = new Swatches(deck.foreground, (value) => this._pickColor(value), { toggle: true });
    this._updatePenCursor();
    this._speed = el('select', { class: 'speed-select', 'aria-label': 'Playback speed' });
    for (const speed of ['0.5', '1', '1.5', '2']) {
      const option = el('option', { value: speed, text: `${speed}×` });
      if (speed === '1') option.selected = true;
      this._speed.append(option);
    }
    this._counter = el('span', { class: 'counter' });
    this._boardButton = el('button', { class: 'board-button', text: 'Whiteboard', title: 'Show or hide the whiteboard (W)', 'aria-pressed': 'false' });
    this._boardButton.addEventListener('click', () => this.toggleWhiteboard());
    this._cameraButton = el('button', { class: 'camera-button', text: 'Camera', title: 'Turn the camera on in its corner, or off (C steps through the corner, full frame and off; full frame pauses the filming of the screen)', 'aria-pressed': 'false' });
    this._cameraButton.addEventListener('click', () => void this.toggleCamera(this._cameraMode === 'off' ? 'corner' : 'off'));
    this._screenButton = el('button', { class: 'screen-button', text: 'Screen', title: 'Film the screen, beside the camera, for the time spent in another application, or stop (S); red while the browser lets this page capture a screen', 'aria-pressed': 'false' });
    this._screenButton.addEventListener('click', () => void this.toggleScreen());
    this._screenPickButton = el('button', { class: 'screen-pick', text: '⌄', title: 'Choose another screen or window to film', 'aria-label': 'Choose another screen or window', hidden: '' });
    this._screenPickButton.addEventListener('click', () => void this.pickScreen());
    this._recordButton = el('button', { class: 'record-button', text: '● Record', title: 'Start or stop recording the talk (R)', 'aria-pressed': 'false' });
    this._recordButton.addEventListener('click', () => void this.toggleRecording());
    this._pauseButton = el('button', { class: 'pause-button', text: 'Pause', title: 'Pause or resume the recording', hidden: '' });
    this._pauseButton.addEventListener('click', () => this.pauseRecording());
    this._recordingsButton = el('button', { class: 'recordings-button', text: '▶ Talk', title: 'Play a recorded talk', hidden: '' });
    this._recordingsButton.addEventListener('click', () => this.openRecordings());
    this._fullscreenButton = el('button', { class: 'fullscreen', text: 'Fullscreen' });
    this._printButton = el('button', { class: 'print-button', text: 'Print', title: 'Print the deck to a PDF (P)' });
    this._printButton.addEventListener('click', () => this.openPrint());
    this._exportButton = el('button', { class: 'export-button', text: 'Export', title: 'Export the deck as a web page, or a recorded talk as a video (X)', hidden: '' });
    this._exportButton.addEventListener('click', () => void this.openExport());
    this._settingsButton = el('button', { class: 'settings-button', 'aria-label': 'Settings', title: 'Settings', text: '⚙' });
    this._dialog = this._buildSettingsDialog();
    this._progress = el('progress', { max: '1', value: '0', 'aria-label': 'Presentation progress' });
    const footer = el(
      'footer',
      {},
      el('div', { class: 'group buttons', role: 'group', 'aria-label': 'Navigation' }, this._previous, this._next, this._counter),
      el(
        'div',
        { class: 'group pen-controls', role: 'group', 'aria-label': 'Drawing' },
        this._penColor.element,
        this._boardButton,
      ),
      el('div', { class: 'group record-controls', role: 'group', 'aria-label': 'Camera and recording' }, this._cameraButton, this._screenButton, this._screenPickButton, this._recordButton, this._pauseButton, this._recordingsButton),
      el('div', { class: 'group page-controls', role: 'group', 'aria-label': 'Page' }, this._printButton, this._fullscreenButton, this._exportButton, this._settingsButton),
      // During a playback the bar takes the whole footer: nothing else can be used meanwhile.
      this._playbackBar,
      this._progress,
    );
    // A button clicked with the pointer gives the focus back to the page, so that the next key
    // goes to the deck without drawing a focus ring around the button; keyboard users keep theirs.
    for (const bar of [header, footer]) {
      bar.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest('button');
        if (!button || event.detail === 0) return;
        // Embedded, the keys reach the deck only while the focus is inside it, so the stage takes it over.
        if (this._embedded) this.stageHost.focus({ preventScroll: true });
        else button.blur();
      });
    }
    const main = el('main', {}, header, this.stageHost, footer);
    this.root = el('div', { class: 'zd-app outline-hidden' }, aside, main, this._dialog);
    this.root.style.setProperty('--background', deck.background);
    this.root.style.setProperty('--foreground', deck.foreground);
    this.root.style.colorScheme = colorScheme;
    this._applyFeatures(header, footer);
    host.replaceChildren(this.root);

    this._outlineToggle.addEventListener('click', () => this.toggleOutline());
    this._fullscreenButton.addEventListener('click', () => void this.fullscreen());
    this._settingsButton.addEventListener('click', () => this.openSettings());
    this._previous.addEventListener('click', () => void this._player?.previous());
    this._next.addEventListener('click', () => void this._player?.next());
    this._speed.addEventListener('change', () => {
      if (this._player) this._player.speed = Number(this._speed.value);
    });
    this._installPointerTools();
    // The camera's corner picture steps aside while the pointer is over it, so that what it covers shows.
    this.stageHost.addEventListener('pointermove', (event) => this._hoverCamera(event.clientX, event.clientY), { passive: true, signal: this._abort.signal });
    this.stageHost.addEventListener('pointerleave', () => this._hoverCamera(null, null), { signal: this._abort.signal });
    this._keys.addEventListener('keydown', ((event: KeyboardEvent) => this._onKeyDown(event)) as EventListener, { signal: this._abort.signal });
    // Leaving the deck for another tab, application or workspace, and coming back.
    document.addEventListener('visibilitychange', () => this._checkAway(), { signal: this._abort.signal });
    window.addEventListener('blur', () => this._checkAway(), { signal: this._abort.signal });
    window.addEventListener('focus', () => this._checkAway(), { signal: this._abort.signal });
    // The focus moving into or out of a live page (an iframe of the deck) counts as leaving and coming back.
    document.addEventListener('focusin', () => this._checkAway(), { signal: this._abort.signal });
    if (deck.showOutline && this._features.has('outline')) this.toggleOutline();
    this._layoutCamera();
    this._updateSpotlight();
  }

  /** Where the keys are read: the whole page in standalone mode, the player itself when embedded. */
  private get _keys(): EventTarget {
    return this._embedded ? this.root : document;
  }

  /** Whether a feature is on; the actions of one left out do nothing. */
  has(feature: Feature): boolean {
    return this._features.has(feature);
  }

  /** Hide the controls of the features left out, and the groups that end up empty. */
  private _applyFeatures(header: HTMLElement, footer: HTMLElement): void {
    const off = (feature: Feature) => !this._features.has(feature);
    this._outlineToggle.hidden = off('outline');
    if (off('outline')) this.root.querySelector('aside')?.remove();
    this._penColor.element.hidden = off('pen');
    this._boardButton.hidden = off('whiteboard');
    this._cameraButton.hidden = off('camera');
    this._screenButton.hidden = off('screen');
    if (off('screen')) this._screenPickButton.remove();
    this._recordButton.hidden = off('record');
    if (off('record')) {
      this._pauseButton.remove();
      this._recordingsButton.remove();
    }
    this._printButton.hidden = off('print');
    this._fullscreenButton.hidden = off('fullscreen');
    this._settingsButton.hidden = off('settings');
    this._updateExportButtons();
    for (const group of footer.querySelectorAll<HTMLElement>('.group')) {
      group.hidden = [...group.children].every((child) => (child as HTMLElement).hidden);
    }
    // The header keeps the breadcrumb and the state even when the outline, its only button, is left out.
    header.classList.toggle('no-outline', off('outline'));
  }

  /**
   * Take the player down: its listeners on the page, its observers, the camera and a recording in
   * progress, and the elements it built. The deck's own objects (stage, player) are disposed by the caller.
   */
  dispose(): void {
    this._abort.abort();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._noticeTimer !== null) clearTimeout(this._noticeTimer);
    if (this._frameTimer !== null) clearTimeout(this._frameTimer);
    this._finishStroke();
    if (this._recorder) void this.toggleRecording();
    if (this._screenHeld()) void this.toggleScreen();
    this._exitPip();
    this._offerCameraWindow(false);
    if (this._cameraMode !== 'off') void this.toggleCamera('off');
    this.closeRecording();
    if (document.fullscreenElement === this.root) void document.exitFullscreen();
    if (this._dialog.open) this._dialog.close();
    if (!this._embedded) document.body.classList.remove('zd-page');
    this.root.remove();
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
      pen === null ? null : `${pen || 'Plain '}drag: draw with the pen while drawing is on (${keys('draw')} toggles it, the whiteboard turns it on; ${keys('color1')}–${keys('color4')} are the colors, which turn it on, and off again for the color in use; a stylus always draws)`,
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
      `${keys('whiteboard')}: whiteboard (${(['boardLeft', 'boardRight', 'boardUp', 'boardDown'] as const).map(keys).join(' ')}, scrolling or two fingers move it)`,
      `${keys('camera')}: camera in its corner (a floating window while the deck is left), then full frame (which pauses the filming of the screen), then off`, `${keys('screen')}: hold a screen share (the browser asks which) or let it go; leaving the deck films it`, `${keys('record')}: record the talk, or continue a saved one`,
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

  /** Show how far the deck's preparation is: the slide reached out of the total. */
  setLoading(progress: { index: number; total: number } | null): void {
    if (progress === null) {
      this._loading.hidden = true;
      return;
    }
    this._loading.hidden = false;
    this._loadingBar.value = progress.total ? progress.index / progress.total : 0;
    this._loadingText.textContent = `${progress.index} / ${progress.total}`;
    this._state.textContent = 'Loading…';
  }

  showError(message: string): void {
    this._loading.hidden = true;
    this._error.hidden = false;
    this._error.textContent = message;
    this._stateMessage = 'Error';
    this._state.textContent = 'Error';
  }

  /** Connect the interface to a prepared player. */
  bind(player: Player, stage: Stage, navigation: NavigationData): void {
    this._player = player;
    this._stage = stage;
    this._navigation = navigation;
    // A recording keeps the stage's proportions, so that a video can show what the window showed.
    let resized: number | null = null;
    stage.afterResize.push(() => {
      if (resized !== null) clearTimeout(resized);
      resized = window.setTimeout(() => {
        resized = null;
        const aspect = this._stageAspect();
        if (aspect && this._recorder) this._note({ type: 'stage', aspect });
      }, 300);
    });
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
      button.addEventListener('click', () => {
        if (!this._playback) void player.goTo(first, false);
      });
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
    player.on('navigate', ({ index, autoplay, rewind }) => {
      const stop = stopRef(navigation, index);
      if (!stop) return;
      this._note(rewind ? { type: 'rewind', stop } : { type: 'go', stop, autoplay });
    });
    player.on('speedchange', ({ value }) => {
      this._note({ type: 'speed', value });
      this._speed.value = String(value);
    });
    void this._refreshRecordings();
    player.on('state', ({ state, message }) => {
      this._stateMessage = message;
      this._renderState();
      // Once a stop settles (text sharpened by then), the tablet gets a fresh picture.
      if (state !== 'playing' && state !== 'looping') this._requestFrame(250);
    });
    this._loading.hidden = true;
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        this._layoutHighlights();
        this._requestFrame(400);
      });
      this._resizeObserver.observe(this.stageHost);
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
    // Any open dialog (settings, recordings, print) keeps the keys to itself.
    if (this._dialog.open || this.root.querySelector('dialog[open]')) return;
    if (combo === 'Space' && /^(BUTTON|SUMMARY)$/.test(target.tagName)) return;
    // While a recording plays, the keys serve the playback: the deck follows the recording, not the viewer.
    if (this._playback) {
      const deckAction = actionFor(this._settings, combo);
      const action = actionFor(this._settings, combo, ['playback']) ?? (deckAction === 'fullscreen' ? deckAction : null);
      if (!action) return;
      event.preventDefault();
      this._runAction(action);
      return;
    }
    // The whiteboard's keys (the arrows scroll it) come before the deck's while it is shown.
    const action = actionFor(this._settings, combo, this._boardOn ? ['board', 'deck'] : ['deck']);
    if (!action) return;
    event.preventDefault();
    this._runAction(action);
  }

  private _runAction(action: ActionName): void {
    const feature = featureOf(action);
    if (feature && !this._features.has(feature)) return;
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
      case 'draw': this.toggleDrawing(); break;
      case 'color1': case 'color2': case 'color3': case 'color4':
        this.pickPenColor(Number(action.slice(5)));
        break;
      case 'settings': this.openSettings(); break;
      case 'pointer': this.togglePointerMode(); break;
      case 'whiteboard': this.toggleWhiteboard(); break;
      case 'edit':
        if (this._editSource) this._editSource();
        else this.notice('Open the deck with zoomdeck serve to jump to the editor');
        break;
      case 'camera': void this.toggleCamera(); break;
      case 'screen': void this.toggleScreen(); break;
      case 'record': void this.toggleRecording(); break;
      case 'print': this.openPrint(); break;
      case 'export': void this.openExport(); break;
      case 'boardLeft': this._panBoardBy(-1, 0); break;
      case 'boardRight': this._panBoardBy(1, 0); break;
      case 'boardUp': this._panBoardBy(0, 1); break;
      case 'boardDown': this._panBoardBy(0, -1); break;
      // While a video is exported from the page, the recording must play through untouched: its keys are off.
      case 'playPause': if (!this._exporting) this._playback?.toggle(); break;
      case 'seekBack': if (this._playback && !this._exporting) this._playback.seek(this._playback.time - 5000); break;
      case 'seekForward': if (this._playback && !this._exporting) this._playback.seek(this._playback.time + 5000); break;
      case 'playStart': if (!this._exporting) this._playback?.seek(0); break;
      case 'closePlayback': if (this._playback) this.closeRecording(); break;
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

  /**
   * Run `action` once no modifier key is held, or after a moment. The editor is launched by
   * the server right away, and some editors read a modifier held at launch as a request for
   * a special mode (Option opens Sublime Text in safe mode on macOS), so the gesture's own key
   * must be up first.
   */
  private _whenModifiersReleased(action: () => void): void {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      document.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', run);
      action();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) run();
    };
    document.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', run);
    window.setTimeout(run, 2500);
  }

  /** Show a message in the header for a few seconds, then the player state again. */
  notice(message: string): void {
    if (this._noticeTimer !== null) clearTimeout(this._noticeTimer);
    this._state.textContent = message;
    this._noticeTimer = window.setTimeout(() => {
      this._noticeTimer = null;
      this._renderState();
    }, 3000);
  }

  /**
   * The header's state: the player's, then what is on, as in "Paused | Whiteboard | Camera | Screen | Recording".
   * The camera and the screen are independent, so both may show.
   */
  private _composeState(): string {
    const parts = [this._stateMessage];
    if (this._boardOn) parts.push('Whiteboard');
    if (this._drawingOn) parts.push('Pen');
    if (this._playback) {
      if (this._screenShown()) parts.push('Screen');
      if (this._cameraFull && !this._camera.hidden && !this._screenShown()) parts.push('Camera');
    } else {
      if (this._cameraMode !== 'off') parts.push('Camera');
      if (this._screenFilming) parts.push('Screen');
    }
    const recorder = this._recorder;
    if (recorder) parts.push(recorder.state === 'paused' ? 'Recording paused' : 'Recording');
    return parts.join(' | ');
  }

  /** During playback, whether a filmed screen fills the frame now: from the screen lane, or from the camera lane of an earlier recording. */
  private _screenShown(): boolean {
    return Boolean(this._playback && (this._playback.screenPart || (this._playback.part?.source === 'screen' && this._camera.videoWidth > 0)));
  }

  /** The element showing the filmed screen during playback, for the export: the screen element, or the camera element for an earlier recording; null when none. */
  private _screenVideo(): HTMLVideoElement | null {
    if (!this._playback) return null;
    if (this._playback.screenPart) return this._screen;
    return this._playback.part?.source === 'screen' ? this._camera : null;
  }

  /** Show the state in the header, unless a notice is up. */
  private _renderState(): void {
    if (this._noticeTimer === null) this._state.textContent = this._composeState();
  }

  /** Remove the most recent stroke of the surface in front (the whiteboard when shown, else the slide). */
  undoStroke(): void {
    this._finishStroke();
    const surface = this._activeSurface();
    if (this._surface(surface).undo()) {
      this._broadcast({ type: 'ink', surface, op: 'undo' });
      this._note({ type: 'ink', surface, op: { op: 'undo' } });
    }
  }

  /** Put back the last undone stroke. */
  redoStroke(): void {
    const surface = this._activeSurface();
    if (this._surface(surface).redo()) {
      this._broadcast({ type: 'ink', surface, op: 'redo' });
      this._note({ type: 'ink', surface, op: { op: 'redo' } });
    }
  }

  /** Erase every stroke of the surface in front; undo brings them back one by one. */
  clearStrokes(): void {
    this._finishStroke();
    const surface = this._activeSurface();
    if (this._surface(surface).clear().length) {
      this._broadcast({ type: 'ink', surface, op: 'clear' });
      this._note({ type: 'ink', surface, op: { op: 'clear' } });
    }
  }

  /** Show or hide the whiteboard: a blank page with its own strokes and history, kept while slides change. */
  toggleWhiteboard(on = !this._boardOn): void {
    if (this._playback || !this._features.has('whiteboard')) return;
    this._setBoardShown(on);
    this._broadcast({ type: 'board', on, pan: { ...this._boardTarget } });
  }

  // ---------------------------------------------------------------------
  // Camera: off, in a corner or full frame as the presenter sets it; the recording's picture during playback
  // ---------------------------------------------------------------------

  /**
   * Step the camera (off → in a corner → full frame → off), or go straight to `mode`. The first
   * step asks the browser for the camera chosen in the settings. A recording in progress keeps
   * the camera while it is on; during a playback only full frame or not can be chosen. The
   * camera is independent of the screen: it stays as set while the screen is filmed, in its
   * corner only, since the screen has the frame then.
   */
  async toggleCamera(mode?: CameraMode): Promise<void> {
    if (this._playback) {
      this._setCameraFull(mode ? mode === 'full' : !this._cameraFull);
      return;
    }
    const next = mode ?? (this._cameraMode === 'off' ? 'corner' : this._cameraMode === 'corner' ? 'full' : 'off');
    if (next === this._cameraMode) return;
    if (next !== 'off' && !this._cameraStream && !(await this._acquireCamera())) return;
    const wasOn = this._cameraMode !== 'off';
    const wasFull = this._cameraMode === 'full';
    this._cameraMode = next;
    this._cameraButton.setAttribute('aria-pressed', String(next !== 'off'));
    this._setCameraFull(next === 'full');
    // Only the corner picture floats, and only while the deck is left.
    this._offerCameraWindow(next === 'corner');
    if (next === 'off') {
      // The recording closes the file with the picture before the camera goes.
      if (wasOn) await this._recordPicture();
      this._setCameraStream(null);
    } else if (next === 'full') {
      // Full frame is the page's: the floating window closes, and the screen is not filmed meanwhile.
      this._exitPip();
      if (this._screenFilming) await this._setScreenFilming(false);
      if (!wasOn) await this._recordPicture();
    } else {
      await this._recordPicture();
    }
    this._layoutCamera();
    // A deck left meanwhile (back from full frame, say) films again, and the corner picture floats.
    if (wasFull || next === 'corner') this._checkAway();
  }

  /**
   * The camera's corner picture is in the page while the deck has the focus, where the rendered
   * video has it too, and floats over the other applications in a window of its own while the
   * deck is left: the window opens when the deck is left, where the browser allows a page to open
   * one then (after a click into a live page of the deck, or when Chrome asks on leaving the tab),
   * and closes when the deck has the focus again. Whenever the window is open the frame in the
   * page is hidden, so that a filmed screen never shows the camera twice; where the window cannot
   * open, the camera stays in the recording's own lane and the video lays it over the screen.
   */
  private async _floatCamera(float: boolean): Promise<void> {
    if (float) {
      if (this._cameraMode !== 'corner' || this._pipWindow || !(await this._openCameraWindow())) return;
    } else {
      if (!this._pipWindow) return;
      this._exitPip();
    }
    this._layoutCamera();
    await this._recordPicture();
  }

  /** Let Chrome open the floating window by itself when the deck's tab is left, as it does for a page that uses the camera; only while the camera is in its corner. */
  private _offerCameraWindow(on: boolean): void {
    try {
      navigator.mediaSession?.setActionHandler('enterpictureinpicture' as MediaSessionAction, on ? () => void this._floatCamera(true) : null);
    } catch {
      /* not an action this browser knows */
    }
  }

  /** The pointer moved over the stage, or left it (null): the corner picture steps aside while the pointer is over it, where the setting asks so. */
  private _hoverCamera(x: number | null, y: number | null): void {
    const camera = this._camera;
    let over = false;
    if (x !== null && y !== null && this._settings.recording.hideCameraOnHover && !camera.hidden && !camera.classList.contains('full')) {
      const box = camera.getBoundingClientRect();
      over = x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    }
    if (over === this._cornerHovered) return;
    this._setCornerHovered(over);
    this._layoutCamera();
  }

  /** The corner picture set aside by the pointer, or back; a recording keeps it, so that the video shows what the presenter showed. */
  private _setCornerHovered(on: boolean): void {
    if (on === this._cornerHovered) return;
    this._cornerHovered = on;
    if (!this._playback) this._note({ type: 'corner', hidden: on });
  }

  /**
   * Whether the camera lane of the recording carries the camera picture now: while the camera
   * is on, except when the whole screen is filmed with the camera floating over it in the
   * browser's picture-in-picture window, which the filmed screen shows already.
   */
  private _cameraInRecording(): boolean {
    if (this._cameraMode === 'off' || !this._cameraStream) return false;
    const wholeScreen = this._screenFilming && this._screenSurface() === 'monitor';
    return !(wholeScreen && this._cameraFloating());
  }

  /** Whether the camera is in its floating window over the other applications now. */
  private _cameraFloating(): boolean {
    return this._pipWindow !== null;
  }

  /**
   * Let the recording in progress, if any, capture the camera lane that applies from now on:
   * the sound with the camera while it is in the recording, else the sound alone. The screen is
   * a lane of its own (see `_setScreenFilming`).
   */
  private async _recordPicture(): Promise<void> {
    const recorder = this._recorder;
    if (!recorder || !recorder.capturing) return;
    const audio = this._recordStream?.getAudioTracks() ?? [];
    const camera = this._cameraInRecording() ? this._cameraStream?.getVideoTracks() ?? [] : [];
    try {
      await recorder.switchStream(new MediaStream([...audio, ...camera]), 'camera');
    } catch (error) {
      this.notice(`The picture could not be recorded: ${(error as Error).message}`);
    }
  }

  /** The deck was left during a recording without a share: offer the browser's picker; a refusal holds for the rest of the session. */
  private _offerScreen(): void {
    const offer = el('div', { class: 'render-offer screen-offer', role: 'status' });
    const share = el('button', { class: 'add', text: 'Share the screen' });
    const later = el('button', { text: 'Not in this session' });
    const close = () => {
      offer.remove();
      if (this._screenOffer === offer) this._screenOffer = null;
    };
    share.addEventListener('click', () => {
      close();
      void this._acquireScreen().then((shared) => {
        if (shared) this._checkAway();
      });
    });
    later.addEventListener('click', () => {
      close();
      this._screenDeclined = true;
    });
    offer.append(el('span', { text: "The recording cannot include what happens outside this window, or inside a live page, nor the computer's sound, unless the screen is shared. Share it now? The browser asks which; with the share held, leaving the deck films it by itself." }), share, later);
    this.root.append(offer);
    this._screenOffer = offer;
  }

  /**
   * Open the camera's floating window (document picture-in-picture), the size the settings give
   * the corner picture, with the camera filling it, mirrored as the presenter sees it: it stays in
   * view over every application, and a filmed screen shows it (see `_floatCamera`). The browser
   * places it and keeps a close button on it; closing it turns the camera off. Resolves with
   * whether it opened; where the browser has no such windows, or allows none now, it does not.
   */
  private async _openCameraWindow(): Promise<boolean> {
    const stream = this._cameraStream;
    if (!stream || this._pipWindow) return Boolean(this._pipWindow);
    const documentPip = (window as PipWindow).documentPictureInPicture;
    if (!documentPip) return false;
    const width = Math.round(this.stageHost.clientWidth * this._settings.recording.size) || 320;
    const height = Math.round((width * 9) / 16);
    const focused = document.hasFocus();
    try {
      const pip = await documentPip.requestWindow({ width, height, disallowReturnToOpener: true });
      this._pipWindow = pip;
      const doc = pip.document;
      doc.title = 'Camera';
      const style = doc.createElement('style');
      style.textContent = 'html,body{margin:0;height:100%;background:#000;overflow:hidden}video{display:block;width:100%;height:100%;object-fit:cover}video.mirror{transform:scaleX(-1)}';
      doc.head.append(style);
      const video = doc.createElement('video');
      video.muted = true;
      video.autoplay = true;
      video.setAttribute('playsinline', '');
      video.className = this._settings.recording.mirror ? 'mirror' : '';
      video.srcObject = stream;
      doc.body.append(video);
      void video.play().catch(() => undefined);
      // The new window took the focus: the page gets it back (a live page of the deck, say), so that the keys keep working there.
      if (focused) window.focus();
      // Closed with the browser's button: the camera goes off with its window.
      pip.addEventListener('pagehide', () => {
        if (this._pipWindow !== pip) return;
        this._pipWindow = null;
        if (this._cameraMode === 'corner') void this.toggleCamera('off');
        else this._layoutCamera();
      });
      this._layoutCamera();
      return true;
    } catch {
      return false;
    }
  }

  private _exitPip(): void {
    const pip = this._pipWindow;
    if (pip) {
      this._pipWindow = null;
      pip.close();
    }
  }

  // ---------------------------------------------------------------------
  // Filming the screen: what happens in another application while the talk goes on there
  // ---------------------------------------------------------------------

  /**
   * Film the screen from now on, or stop; a recording in progress takes it in a lane of its own,
   * beside the camera. Starting films the share still held from before without asking; with
   * none, it asks the browser which screen or window to share (its picker, which a page can
   * neither skip nor fill in, opens on the kind of surface chosen last time). Stopping keeps the
   * share held for the next time, until it is ended from the browser's own bar; the next start
   * then asks again. The Screen button is red exactly while a share is held, and the header
   * says when the screen is filmed; there is no notice.
   */
  async toggleScreen(): Promise<void> {
    if (this._playback) return;
    if (this._screenHeld()) {
      // Letting the share go ends a filming under way with it.
      if (this._screenFilming) await this._setScreenFilming(false);
      this._releaseScreen();
      return;
    }
    if (!(await this._acquireScreen())) return;
    // The deck may be left already (a live page has the focus, say): the new share films from now on.
    this._checkAway();
  }

  /** Ask the browser for another screen or window in place of the share held, and film it. */
  async pickScreen(): Promise<void> {
    if (this._playback || !(await this._acquireScreen())) return;
    if (!this._screenFilming) {
      await this._setScreenFilming(true);
      return;
    }
    // Filming goes on with the new share: the screen lane closes its file and begins another.
    const recorder = this._recorder;
    const screen = this._screenStream;
    if (recorder?.capturing && screen) {
      await recorder.stopScreen();
      await recorder.startScreen(screen).catch((error: Error) => this.notice(`The screen could not be recorded: ${error.message}`));
    }
    await this._recordPicture();
  }

  /** The kind of surface shared, as the browser reports it: 'monitor', 'window', 'browser', or null when it does not say. */
  private _screenSurface(): string | null {
    return (this._screenStream?.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface ?? null;
  }

  /** What is shared, for the button's title: "the entire screen", "a window", "a tab", or "the screen" when the browser does not say. */
  private _screenLabel(): string {
    const surface = this._screenSurface();
    return surface === 'monitor' ? 'the entire screen' : surface === 'window' ? 'a window' : surface === 'browser' ? 'a tab' : 'the screen';
  }

  /** Whether a share from before is still live, so that it can be filmed again without the picker. */
  private _screenHeld(): boolean {
    return Boolean(this._screenStream?.getVideoTracks().some((track) => track.readyState === 'live'));
  }

  /** Ask the browser for a screen, replacing any share held; false (with a notice) when it cannot, or the picker was dismissed. */
  private async _acquireScreen(): Promise<boolean> {
    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
      this.notice('This browser cannot capture the screen here');
      return false;
    }
    try {
      // The picker opens on the kind of surface chosen last time (a whole screen at first) and leaves this tab out.
      // The computer's sound comes with the share where the browser offers it (a whole screen or a tab, with the box ticked), untouched by the microphone's processing.
      const audio = this._settings.recording.systemAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false;
      const options = { video: { displaySurface: this._settings.recording.screenSurface, frameRate: { ideal: 15 } }, audio, systemAudio: 'include', selfBrowserSurface: 'exclude' };
      this._prompting++;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions);
      } finally {
        this._promptEnded();
      }
      this._releaseScreen();
      this._screenStream = stream;
      const surface = (stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
      if (surface === 'monitor' || surface === 'window' || surface === 'browser') {
        this._settings.recording.screenSurface = surface;
        saveSettings(this._settings);
      }
      // Stopping the share from the browser's own bar ends the track.
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (this._screenStream !== stream) return;
          this.notice('The browser ended the screen share; S asks again');
          void this._setScreenFilming(false).then(() => this._releaseScreen());
        });
      }
      // The sound alone may end too (the browser's bar has a control for it): its lane closes.
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => void this._syncSystemLane());
      this._updateScreenButton();
      void this._syncSystemLane();
      return true;
    } catch (error) {
      this.notice(`No screen: ${(error as Error).message}`);
      return false;
    }
  }

  private _releaseScreen(): void {
    const stream = this._screenStream;
    this._screenStream = null;
    for (const track of stream?.getVideoTracks() ?? []) track.stop();
    // The sound's track outlives the share until its lane has closed its file, so that the file ends cleanly.
    const audio = stream?.getAudioTracks() ?? [];
    const closing = this._recorder?.systemSound ? this._recorder.stopSystem() : Promise.resolve();
    void closing.catch(() => undefined).finally(() => {
      for (const track of audio) track.stop();
    });
    this._updateScreenButton();
  }

  /**
   * Record the computer's sound exactly while a recording captures and the share held carries
   * it (and the setting asks for it): in a lane of its own, all along, whatever the screen
   * lane does, so that the sound of a demonstration is kept also while the deck has the focus.
   */
  private async _syncSystemLane(): Promise<void> {
    const recorder = this._recorder;
    if (!recorder?.capturing) return;
    const audio = this._screenStream?.getAudioTracks().filter((track) => track.readyState === 'live') ?? [];
    const want = audio.length > 0 && this._settings.recording.systemAudio;
    if (want && !recorder.systemSound) await recorder.startSystem(new MediaStream(audio)).catch((error: Error) => this.notice(`The computer's sound could not be recorded: ${error.message}`));
    else if (!want && recorder.systemSound) await recorder.stopSystem();
  }

  /** Whether the share held carries the computer's sound. */
  private _systemSoundHeld(): boolean {
    return Boolean(this._screenStream?.getAudioTracks().some((track) => track.readyState === 'live'));
  }

  /** The Screen button: red exactly while the browser lets this page capture a screen (a share held), "Filming" while the screen is filmed. */
  private _updateScreenButton(): void {
    const held = this._screenHeld();
    this._screenPickButton.hidden = !held;
    this._screenButton.classList.toggle('held', held);
    this._screenButton.textContent = 'Screen';
    this._screenButton.title = held
      ? `Let the share of ${this._screenLabel()} go (S); while it is held, leaving the deck films it; the arrow beside picks another`
      : 'Share a screen (S): the browser asks which; while the share is held, leaving the deck for another application or a live page films it, beside the camera';
  }

  /**
   * Film the screen into the recording, in a lane of its own beside the camera, or stop. The
   * camera stays as the presenter set it, in its corner only while the screen has the frame;
   * when the whole screen is filmed with the camera floating over it, the camera lane keeps the
   * sound alone, since the picture is in the filmed screen already. After the filming the camera
   * lane starts a new file, so that the screen's file can join the bundle at once.
   */
  private async _setScreenFilming(on: boolean): Promise<void> {
    if (on === this._screenFilming) return;
    // While the camera fills the frame the presenter is on the slides: no filming until it leaves full frame.
    if (on && this._cameraFull) return;
    this._screenFilming = on;
    this._autoFilming = false;
    this._awayWhileFilming = false;
    this._screenButton.setAttribute('aria-pressed', String(on));
    this.root.classList.toggle('screen-filming', on);
    this._updateScreenButton();
    this._renderState();
    const recorder = this._recorder;
    if (recorder?.capturing) {
      const screen = this._screenStream;
      if (on && screen) await recorder.startScreen(screen).catch((error: Error) => this.notice(`The screen could not be recorded: ${error.message}`));
      else if (!on) await recorder.stopScreen();
    }
    await this._recordPicture();
  }

  /**
   * The deck was left or come back to (the page hidden or shown, the window out of focus or in):
   * settle what that means a moment later, once the focus has stopped moving.
   */
  private _checkAway(): void {
    if (this._awayTimer !== null) clearTimeout(this._awayTimer);
    this._awayTimer = setTimeout(() => {
      this._awayTimer = null;
      this._applyAway();
    }, 250);
  }

  /**
   * While a share is held, leaving the deck films the screen by itself (the camera, if on, is
   * set aside) and coming back stops the filming and brings the camera back, unless the
   * setting says otherwise. A filming started by hand is left alone until the deck is left and
   * come back to. The browser's own prompts take the focus too, so a check waits for them.
   */
  private _applyAway(): void {
    if (this._playback || this._prompting) return;
    // The camera's window exists only while the deck is left: the focus in it changes nothing.
    if (this._pipWindow && !this._pipWindow.closed && this._pipWindow.document.hasFocus()) return;
    const away = awayFromDeck(this.stageHost, document);
    void this._floatCamera(away);
    if (!this._screenHeld()) {
      // Left during a recording with no share: the browser's picker needs a click, so the deck asks for one, once per session.
      if (away && this._recorder && !this._screenDeclined && !this._screenOffer) this._offerScreen();
      return;
    }
    if (away) {
      if (this._screenFilming) {
        this._awayWhileFilming = true;
      } else {
        void this._setScreenFilming(true);
        this._autoFilming = true;
      }
    } else if (this._screenFilming && (this._autoFilming || this._awayWhileFilming)) {
      void this._setScreenFilming(false);
    }
  }

  /** A prompt of the browser closed: count it out once the focus has settled, then look where the deck stands. */
  private _promptEnded(): void {
    setTimeout(() => {
      this._prompting--;
      this._checkAway();
    }, 500);
  }

  private _setCameraFull(on: boolean): void {
    if (on === this._cameraFull) return;
    this._finishStroke();
    this._cameraFull = on;
    this._note({ type: 'camera', on });
    this._layoutCamera();
    this._updateSpotlight();
    this._renderState();
  }

  /** Start the camera chosen in the settings for a live picture; false (with a notice) when there is none. */
  private async _acquireCamera(): Promise<boolean> {
    const choice = this._settings.recording.camera;
    if (choice === 'none') {
      this.notice('Choose a camera in the settings (Recording) first');
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.notice('This browser gives no access to a camera here');
      return false;
    }
    try {
      this._prompting++;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: this._captureConstraints().video || true });
      } finally {
        this._promptEnded();
      }
      this._setCameraStream(stream);
      return true;
    } catch (error) {
      this.notice(`No camera: ${(error as Error).message}`);
      return false;
    }
  }

  /** Show a live stream in the camera element (null releases it). */
  private _setCameraStream(stream: MediaStream | null): void {
    for (const track of this._cameraStream?.getTracks() ?? []) track.stop();
    this._cameraStream = stream;
    if (!stream) this._exitPip();
    if (stream) {
      this._camera.removeAttribute('src');
      this._camera.srcObject = stream;
      this._camera.muted = true;
      void this._camera.play().catch(() => undefined);
    } else if (!this._playback) {
      this._camera.srcObject = null;
      if (this._cameraFull) this._setCameraFull(false);
    }
    if (!stream) {
      this._cameraMode = 'off';
      this._cameraButton.setAttribute('aria-pressed', 'false');
    }
    this._layoutCamera();
  }

  /** Place the camera picture: hidden without a source, full frame when switched to, else in the chosen corner. */
  private _layoutCamera(): void {
    const camera = this._camera;
    // A filmed screen fills the frame, fitted rather than cropped: from the screen lane in its own
    // element, or, for a recording made before the screen had a lane, from the camera lane's file.
    // Either takes the frame the moment its part is chosen, before a frame has arrived, so that the
    // live page underneath never shows its present content in place of the recorded picture.
    const screenLane = Boolean(this._playback?.screenPart);
    const oldScreen = Boolean(this._playback?.part?.source === 'screen');
    // Live: the camera while it is on, in the page only when it has no floating window of its own or fills the frame.
    // Playback: the camera lane's file, when it carries a picture (a filmed screen counts from the start).
    const hasPicture = this._playback ? camera.videoWidth > 0 || oldScreen : Boolean(this._cameraStream) && (this._cameraFull || !this._pipWindow);
    camera.hidden = !hasPicture;
    const floating = this._pipWindow?.document.querySelector('video');
    if (floating) floating.className = this._settings.recording.mirror ? 'mirror' : '';
    const { corner, size, mirror } = this._settings.recording;
    camera.dataset.corner = corner;
    camera.style.setProperty('--pip-size', `${size * 100}%`);
    // The presenter's own picture mirrors like a mirror does; a recording is shown as recorded.
    this._screen.hidden = !screenLane;
    camera.classList.toggle('mirror', mirror && !this._playback);
    camera.classList.toggle('screen', oldScreen);
    // The camera never fills the frame over a filmed screen: it keeps its corner there.
    const full = oldScreen || (this._cameraFull && !screenLane);
    camera.classList.toggle('full', full);
    // The corner picture steps aside under the pointer (the viewer's, or the presenter's as recorded); a picture gone or full frame ends that.
    if (this._cornerHovered && (!hasPicture || full)) this._setCornerHovered(false);
    camera.classList.toggle('aside', hasPicture && !full && (this._cornerHovered || (Boolean(this._playback) && this._playbackCornerHidden)));
    this.stageHost.classList.toggle('camera-on', (full && hasPicture) || screenLane);
    this._renderState();
  }

  // ---------------------------------------------------------------------
  // Recording a talk
  // ---------------------------------------------------------------------

  /** Stamp an event on the recording's clock, when one is running. */
  private _note(event: UntimedEvent): void {
    this._recorder?.mark(event);
  }

  /** Record the laser or spotlight while it is shown, a few times a second, and when it goes. */
  private _markPointer(shown: boolean): void {
    if (!this._recorder) return;
    if (!shown) {
      if (this._pointerMarked) this._note({ type: 'pointer-off' });
      this._pointerMarked = false;
      return;
    }
    const now = performance.now();
    if (this._pointerMarked && now - this._lastPointerMark < 33) return;
    this._lastPointerMark = now;
    this._pointerMarked = true;
    const pointer = this._pointer as { x: number; y: number };
    const { scale } = this._highlightGeometry();
    const point = this._surfacePoint(pointer.x, pointer.y, 'slide');
    this._note({ type: 'pointer', mode: this._settings.pointerMode, x: Math.round(point.x), y: Math.round(point.y), r: Math.round(this._radius / scale) });
  }

  get recording(): boolean {
    return this._recorder !== null;
  }

  async toggleRecording(): Promise<void> {
    if (this._recorder) await this.stopRecording();
    else await this.startRecording();
  }

  /** Continue a recording: the dialog opens with it chosen; the new part is stamped after its end and kept as a further media file. */
  async continueRecording(entry: RecordingEntry): Promise<void> {
    await this.startRecording(entry);
  }

  /**
   * Record the talk with the devices chosen in the settings, after the dialog that says what is
   * kept and asks whether to start a new talk or to continue a saved one (`preselect` names the
   * one offered first).
   */
  async startRecording(preselect: RecordingEntry | null = null): Promise<void> {
    if (this._recorder || !this._player || !this._navigation) return;
    const choice = await this._confirmRecording(preselect);
    if (choice === false || this._recorder) return;
    let append: { name: string; timeline: Timeline } | null = null;
    if (choice) {
      try {
        append = { name: choice.name, timeline: await loadTimeline(this._deck.base as string, choice) };
      } catch (error) {
        this.notice((error as Error).message);
        return;
      }
    }
    if (this._playback) this.closeRecording();
    this._stopDeviceTest();
    // The microphone is opened here; the camera is the presenter's to turn on, and is recorded while it is.
    let stream: MediaStream | null = null;
    if (typeof navigator.mediaDevices?.getUserMedia === 'function') {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: this._captureConstraints().audio });
      } catch (error) {
        this.notice(`Cannot record: ${(error as Error).message}`);
        return;
      }
    } else {
      this.notice('This browser gives no access to a microphone here; recording the timeline only');
    }
    // A share asked for at the start, while the click that started this still counts, so that leaving the deck films it.
    if (stream && this._settings.recording.screenOnRecord && !this._screenStream) await this._acquireScreen();
    const screenTracks = this._screenFilming ? this._screenStream?.getVideoTracks() ?? [] : [];
    const videoTracks = screenTracks.length ? screenTracks : this._cameraStream?.getVideoTracks() ?? [];
    // The talk's bundle is opened now and written as the talk goes; without the server, or when it refuses, the talk is kept in memory for a download.
    const name = append?.name ?? recordingName(new Date());
    let session: RecordingSession | null = null;
    if (this._deck.base && recordingStoreAvailable()) {
      session = new RecordingSession(this._deck.base, name);
      try {
        await session.open();
      } catch (error) {
        this.notice(`The server cannot keep the talk (${(error as Error).message}); it will be offered as a download`);
        session = null;
      }
    }
    let number = (append?.timeline.media.length ?? 0) + 1;
    const sink = session ? { begin: (capture: { type: string; lane: MediaLane }) => session.begin(number++, capture.type, capture.lane), write: (chunk: Blob, lane: MediaLane) => session.chunk(chunk, lane), end: (lane: MediaLane) => session.end(lane) } : undefined;
    const recorder = new Recorder({ stream: stream && videoTracks.length ? new MediaStream([...stream.getAudioTracks(), ...videoTracks]) : stream, source: screenTracks.length ? 'screen' : 'camera', sink });
    try {
      await recorder.start();
    } catch (error) {
      this.notice((error as Error).message);
      for (const track of stream?.getTracks() ?? []) track.stop();
      // The bundle opened for nothing: a continued talk gets its timeline back, a new one is removed.
      if (session && append) await session.finish(append.timeline).catch(() => undefined);
      else if (session) await deleteRecording(this._deck.base as string, name).catch(() => undefined);
      return;
    }
    this._recorder = recorder;
    this._recordStream = stream;
    void this._syncSystemLane();
    this._appendTo = append;
    this._session = session;
    this._talkName = name;
    this._draftTick = 0;
    this._pointerMarked = false;
    for (const event of initialEvents(stopRef(this._navigation, this._player.index), this._boardOn, this._boardTarget, this._cameraFull, this._player.speed, this._stageAspect())) recorder.mark(event);
    if (this._cornerHovered) recorder.mark({ type: 'corner', hidden: true });
    this._recordButton.textContent = '■ Stop';
    this._recordButton.setAttribute('aria-pressed', 'true');
    this._pauseButton.hidden = false;
    this._pauseButton.textContent = 'Pause';
    this._recordLabel.hidden = false;
    this._recordTimer = window.setInterval(() => this._updateRecordLabel(), 500);
    this._updateRecordLabel();
    const what = stream ? (screenTracks.length ? 'with the screen' : videoTracks.length ? 'with the camera' : 'the sound (the camera or the screen join while they are on)') : 'the timeline only';
    this.notice(append ? `Continuing ${append.name} at ${formatTime(append.timeline.duration)}, recording ${what}` : `Recording ${what}`);
  }

  /**
   * Say what a recording will keep and where it goes, and ask whether to start a new talk or to
   * continue a saved one: resolves with the talk to continue, null for a new one, or false when
   * the dialog is dismissed.
   */
  private _confirmRecording(preselect: RecordingEntry | null): Promise<RecordingEntry | null | false> {
    const option = (select: HTMLSelectElement) => select.selectedOptions[0]?.textContent ?? 'Default';
    const camera = this._settings.recording.camera === 'none'
      ? 'no camera (the settings say None)'
      : this._cameraMode === 'off'
        ? `the camera (${option(this._cameraSelect)}) while it is on: it is off now, and the Camera button or C turns it on whenever you want it in the recording`
        : `the camera (${option(this._cameraSelect)}), on now ${this._cameraMode === 'full' ? 'full frame' : 'in a corner'}, for as long as it stays on`;
    const where = this._deck.base && recordingStoreAvailable()
      ? 'completes the talk\'s bundle in the recordings/ folder next to the deck, which is written while you talk, so nothing is left to do'
      : 'offers the talk as a zip bundle to download, to put in a recordings/ folder next to the deck as it is, and offers to make a video of it in this page';
    const dialog = el('dialog', { class: 'settings record' });
    const close = el('button', { class: 'close', 'aria-label': 'Close', text: '×' });
    // What to record: a new talk, or more of a saved one (only where the server keeps them).
    const what = el('select', { 'aria-label': 'What to record' });
    what.append(el('option', { value: '', text: 'A new talk' }));
    const continuable = this._deck.base && recordingStoreAvailable() ? this._recordings : [];
    for (const entry of continuable) {
      const when = entry.recorded ? new Date(entry.recorded).toLocaleString() : entry.name;
      what.append(el('option', { value: entry.name, text: `Continue the talk of ${when} (${formatTime(entry.duration)})` }));
    }
    if (preselect && continuable.includes(preselect)) what.value = preselect.name;
    const seam = el('p', { class: 'note' });
    const start = el('button', { class: 'add', autofocus: '' });
    const cancel = el('button', { text: 'Cancel' });
    const update = () => {
      const chosen = continuable.find((entry) => entry.name === what.value) ?? null;
      start.textContent = chosen ? 'Continue recording' : 'Start recording';
      seam.textContent = chosen ? `What follows is appended to ${chosen.name} after ${formatTime(chosen.duration)}, with a cut at the seam; the deck should stand where the talk left it.` : '';
      seam.hidden = !chosen;
    };
    what.addEventListener('change', update);
    update();
    dialog.append(
      el('header', {}, el('h2', { text: 'Record the talk' }), close),
      el('section', {},
        ...(continuable.length ? [el('div', { class: 'row' }, el('label', {}, 'Record ', what))] : []),
        el('p', { class: 'note', text: `The recording keeps your voice through the microphone (${option(this._micSelect)}), ${camera}, and every move on the deck: the stops, the ink, the whiteboard, the pointer and the camera switches. The slides themselves are not filmed; the talk plays back on the deck and exports as a video.` }),
        ...(this._screenHeld() ? [] : [el('p', { class: 'note' }, el('strong', { text: 'No screen share is held: ' }), 'until the screen is shared, the recording cannot include other windows and applications, what happens inside a live page, or the computer\'s sound. Your voice and the camera are recorded either way. Share the screen with Screen or S, now or during the talk; the first time you leave the deck during the talk, the deck offers it.')]),
        ...(this._screenHeld() && this._settings.recording.systemAudio && !this._systemSoundHeld() ? [el('p', { class: 'note' }, el('strong', { text: 'The share carries no sound: ' }), 'the computer\'s sound will not be in the recording. The browser offers it for a whole screen or a tab, with its box ticked in the share dialog; the arrow beside Screen opens the dialog again.')] : []),
        el('p', { class: 'note', text: `The Screen button or S holds a screen share${this._settings.recording.screenOnRecord ? ' (the browser asks which screen when the recording starts)' : ' (the browser asks which screen)'} and lets it go again; while a share is held, leaving the deck for another tab, application, workspace or live page films the screen by itself, beside the camera, and coming back stops the filming. The computer's sound, when the share carries it, is recorded all along, also while you are on the deck. The camera stays as you set it: in its corner of the deck, and in a floating window over the other applications while the deck is left.` }),
        el('p', { class: 'note', text: `The header counts the time. Pause leaves a gap out of the talk; Stop (the same key or button) ends the recording and ${where}.${this._deck.base && recordingStoreAvailable() ? ' A stopped talk can be continued later from this dialog or from the list of talks.' : ' Until this page closes, the talk also plays back here, from ▶ Talk.'}` }),
        seam,
        el('div', { class: 'row' }, start, cancel)),
    );
    return new Promise((resolve) => {
      let result: RecordingEntry | null | false = false;
      start.addEventListener('click', () => {
        result = continuable.find((entry) => entry.name === what.value) ?? null;
        dialog.close();
      });
      cancel.addEventListener('click', () => dialog.close());
      close.addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => { dialog.remove(); resolve(result); });
      this.root.append(dialog);
      dialog.showModal();
    });
  }

  private _updateRecordLabel(): void {
    const recorder = this._recorder;
    if (!recorder) return;
    const offset = this._appendTo?.timeline.duration ?? 0;
    this._recordLabel.textContent = `${recorder.state === 'paused' ? '❚❚' : '●'} ${formatTime(offset + recorder.elapsed)}`;
    this._recordLabel.classList.toggle('paused', recorder.state === 'paused');
    this._renderState();
    // Every ten seconds the server gets a draft of the timeline, so that a talk cut short by a crash is closed from it.
    if (this._session && this._talkName && recorder.state === 'recording' && ++this._draftTick % 20 === 0) {
      void this._session.draft(this._timelineSoFar(recorder, this._talkName)).catch(() => undefined);
    }
  }

  /** A fresh timeline for a talk that began at `started`. */
  private _freshTimeline(started: Date): Timeline {
    return {
      version: 1,
      deck: { title: this._deck.title, hash: structureHash(this._navigation as NavigationData) },
      recorded: started.toISOString(),
      duration: 0,
      media: [],
      pip: { corner: this._settings.recording.corner, size: this._settings.recording.size },
      events: [],
    };
  }

  /** Describe captured media files as the timeline lists them, numbered after the talk's existing ones (name.webm, name.part2.webm, …). */
  private _describeParts(name: string, first: number, parts: ReadonlyArray<Omit<CapturedMedia, 'blob'>>): TimelineMedia[] {
    return parts.map((captured, index) => ({ ...describeMedia(name, captured.type, first + index, captured.duration), start: captured.start, ...(captured.source === 'screen' ? { source: 'screen' as const } : {}), ...(captured.lane ? { lane: captured.lane } : {}) }));
  }

  /** The timeline as it would be if the talk stopped now. */
  private _timelineSoFar(recorder: Recorder, name: string): Timeline {
    const previous = this._appendTo?.timeline ?? this._freshTimeline(new Date());
    return appendPart(previous, { events: [...recorder.events], duration: Math.round(recorder.elapsed), media: this._describeParts(name, previous.media.length + 1, recorder.parts) });
  }

  /** Pause the recording, or resume it; the gap is left out of the talk. */
  pauseRecording(): void {
    const recorder = this._recorder;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      this._finishStroke();
      recorder.pause();
      this._pauseButton.textContent = 'Resume';
    } else if (recorder.state === 'paused') {
      recorder.resume();
      this._pauseButton.textContent = 'Pause';
    }
    this._updateRecordLabel();
  }

  /** Stop recording and keep the talk next to the deck, or offer it as downloads. */
  async stopRecording(): Promise<void> {
    const recorder = this._recorder;
    if (!recorder) return;
    this._finishStroke();
    if (this._pointerMarked) {
      this._note({ type: 'pointer-off' });
      this._pointerMarked = false;
    }
    this._recorder = null;
    this._screenOffer?.remove();
    this._screenOffer = null;
    if (this._recordTimer !== null) clearInterval(this._recordTimer);
    this._recordTimer = null;
    this._recordLabel.hidden = true;
    this._recordButton.textContent = '● Record';
    this._recordButton.setAttribute('aria-pressed', 'false');
    this._pauseButton.hidden = true;
    this._renderState();
    const result = await recorder.stop();
    // The microphone is released; the camera stays as the presenter left it, and a screen share
    // stays held for the next time (S), until the browser's bar ends it.
    for (const track of this._recordStream?.getAudioTracks() ?? []) track.stop();
    this._recordStream = null;
    await this._setScreenFilming(false);
    // A new talk, or the one being continued: the part is appended either way.
    const append = this._appendTo;
    this._appendTo = null;
    const session = this._session;
    this._session = null;
    const name = this._talkName ?? append?.name ?? recordingName(result.started);
    this._talkName = null;
    const previous = append?.timeline ?? this._freshTimeline(result.started);
    const first = previous.media.length + 1;
    const files = result.media.map((captured, index) => ({ captured, number: first + index }));
    const timeline = appendPart(previous, { ...result.part, media: this._describeParts(name, first, result.media) });
    if (session) {
      // The media is in the bundle already: the timeline and the directory close it.
      try {
        await session.finish(timeline);
        await this._refreshRecordings();
        this.notice(append ? `Continued recordings/${name}.zip, now ${formatTime(timeline.duration)}` : `Saved as recordings/${name}.zip`);
        if (this._settings.recording.renderOnStop) void this._offerRender(name);
      } catch (error) {
        this.notice(`Could not save: ${(error as Error).message}`);
        await this._offerDownload(name, timeline, files);
      }
    } else {
      await this._offerDownload(name, timeline, files);
    }
  }

  /** Offer the recording as its bundle to download, the same zip the server keeps; the files one by one only when the archive cannot be made. */
  private async _offerDownload(name: string, timeline: Timeline, files: Array<{ captured: CapturedMedia; number: number }>): Promise<void> {
    const entries = [
      ...files.map((file) => ({ name: mediaFileName(name, file.captured.type, file.number), blob: file.captured.blob })),
      { name: `${name}.json`, blob: new Blob([JSON.stringify(timeline)], { type: 'application/json' }) },
    ];
    try {
      download(await zipFiles(entries), `${name}.zip`);
      this.notice(`${name}.zip downloaded: put it in a recordings/ folder next to the deck`);
    } catch {
      for (const entry of entries) download(entry.blob, entry.name);
      this.notice('Recording downloaded: put the files in a recordings/ folder next to the deck');
    }
    // The talk stays playable here until the page closes, and a video of it is offered: the bundle is a file only Zoomdeck plays.
    this._memoryTalks.set(name, { timeline, files: new Map(entries.slice(0, -1).map((entry) => [entry.name, entry.blob])), urls: new Map() });
    await this._refreshRecordings();
    this._offerVideo(name);
  }

  /**
   * After a talk recorded where no server keeps it: offer to make a video of it now, composed
   * in this page from the recorded tracks while the talk plays once, in real time, as the
   * server's render is offered elsewhere. It goes where the viewer chooses, or to the downloads.
   */
  private _offerVideo(name: string): void {
    if (!this._features.has('export') || !exportMimeType()) return;
    for (const stale of this.root.querySelectorAll('.render-offer')) stale.remove();
    const offer = el('div', { class: 'render-offer', role: 'status' });
    const go = el('button', { class: 'add', text: 'Make the video now' });
    const later = el('button', { text: 'Later' });
    go.addEventListener('click', () => {
      void (async () => {
        const entry = this._recordings.find((candidate) => candidate.name === name);
        if (!entry) return;
        let handle: FileSystemFileHandle | undefined;
        if (typeof (window as SavePickerWindow).showSaveFilePicker === 'function') {
          try {
            // Asked while the click still counts for the browser; the file is written when the video is done.
            handle = await (window as SavePickerWindow).showSaveFilePicker?.({ suggestedName: `${name}.video.webm`, types: [{ description: 'WebM video', accept: { 'video/webm': ['.webm'] } }] });
          } catch (error) {
            if ((error as DOMException).name === 'AbortError') return; // dismissed: the offer stays
          }
        }
        offer.remove();
        const recording = this._settings.recording;
        await this._exportTalk(entry, { name: `${name}.video`, method: 'page', destination: handle ? 'pick' : 'download', handle, size: recording.renderHeight ?? 'display', aspect: recording.renderAspect });
      })();
    });
    later.addEventListener('click', () => offer.remove());
    offer.append(el('span', { text: `Make a video of ${name}? The recorded tracks are composed in this page while the talk plays once, in real time, into a file that plays anywhere; the zip keeps them apart for Zoomdeck. Until this page closes, Export can also make it later.` }), go, later);
    this.root.append(offer);
  }

  /** A talk kept in memory, as the index would list it. */
  private _memoryEntry(name: string, timeline: Timeline): RecordingEntry {
    const media = timeline.media;
    return {
      name,
      title: timeline.deck.title,
      recorded: timeline.recorded,
      duration: timeline.duration,
      media: media.length ? media[0].file : null,
      video: media.some((part) => part.video),
      camera: media.some((part) => part.video && part.source !== 'screen'),
      screen: media.some((part) => part.source === 'screen'),
      ...(media.some((part) => part.lane === 'system') ? { system: true } : {}),
      parts: media.length,
    };
  }

  /** The URL of a file of a talk kept in memory, made once. */
  private _memoryUrl(talk: { files: Map<string, Blob>; urls: Map<string, string> }, file: string): string {
    let url = talk.urls.get(file);
    if (!url) {
      const blob = talk.files.get(file);
      if (!blob) throw new Error(`${file} is not in the recording`);
      url = URL.createObjectURL(blob);
      talk.urls.set(file, url);
    }
    return url;
  }

  // ---------------------------------------------------------------------
  // Playing a recorded talk
  // ---------------------------------------------------------------------

  private async _refreshRecordings(): Promise<void> {
    const base = this._deck.base;
    // Without the recorder there is no Talk button either: a deck in a page is not asked about its recordings.
    const listed = base && this._features.has('record') ? await listRecordings(base) : [];
    const kept = this._features.has('record') ? [...this._memoryTalks.entries()].filter(([name]) => !listed.some((entry) => entry.name === name)).map(([name, talk]) => this._memoryEntry(name, talk.timeline)) : [];
    this._recordings = [...listed, ...kept].sort((a, b) => (b.recorded ?? '').localeCompare(a.recorded ?? ''));
    this._render = base && this._features.has('record') && recordingStoreAvailable() ? await renderStatus(base).catch(() => ({ ffmpeg: false, desktop: false, jobs: [] })) : { ffmpeg: false, desktop: false, jobs: [] };
    this._recordingsButton.hidden = this._recordings.length === 0;
    this._recordingsButton.textContent = this._recordings.length > 1 ? `▶ Talks (${this._recordings.length})` : '▶ Talk';
    this._updateExportButtons();
  }

  /** The footer's Talk button: one recording opens at once, several are offered in the list. */
  openRecordings(): void {
    if (this._recordings.length === 1) void this.openRecording(this._recordings[0]);
    else this.openRecordingList();
  }

  /**
   * The list of recorded talks, one row each: when it was recorded, how long it lasts, which
   * tracks it has (small icons), and its buttons on one line: Play, its video (Render video, or
   * Rendered video once there is one), and Continue and Delete where the server keeps the talk.
   * Also reached from the playback bar. A render under way shows its progress in its button.
   */
  openRecordingList(): void {
    if (!this._recordings.length) {
      this.notice('No recorded talk yet: Record starts one');
      return;
    }
    // One list at a time: a list left behind (its close event is delivered later) would stack under the new one.
    for (const stale of this.root.querySelectorAll('dialog.recordings')) stale.remove();
    const dialog = el('dialog', { class: 'settings recordings' });
    const close = el('button', { class: 'close', 'aria-label': 'Close', text: '×' });
    close.addEventListener('click', () => dialog.close());
    const body = el('tbody');
    const fill = () => body.replaceChildren(...this._recordings.map((entry) => this._talkRow(entry, dialog, fill)));
    fill();
    const table = el('table', { class: 'talks' },
      el('thead', {}, el('tr', {},
        el('th', { text: 'Recorded' }),
        el('th', { text: 'Length' }),
        el('th', { text: 'Tracks' }),
        el('th', { 'aria-label': 'Actions' }))),
      body);
    // While a render runs, the rows follow its progress.
    const timer = window.setInterval(() => {
      if (!this._render.jobs.some((job) => ['queued', 'rendering', 'composing'].includes(job.status))) return;
      void this._refreshRecordings().then(() => {
        if (dialog.open) fill();
      });
    }, 3000);
    const done = el('button', { class: 'done', text: 'Close' });
    done.addEventListener('click', () => dialog.close());
    dialog.append(el('header', {}, el('h2', { text: 'Recorded talks' }), close), el('section', {}, table), el('div', { class: 'actions' }, done));
    dialog.addEventListener('close', () => {
      clearInterval(timer);
      dialog.remove();
    });
    this.root.append(dialog);
    dialog.showModal();
  }

  /** A talk's row in the list of talks. */
  private _talkRow(entry: RecordingEntry, dialog: HTMLDialogElement, refresh: () => void): HTMLTableRowElement {
    const when = entry.recorded ? new Date(entry.recorded).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : entry.name;
    const kept = this._memoryTalks.has(entry.name);
    // Continued and deleted only where the server keeps the talk; a talk in this page alone has its zip as its lasting copy.
    const stored = Boolean(this._deck.base && recordingStoreAvailable()) && !kept;
    const play = el('button', { text: 'Play', title: 'Play the talk on the deck' });
    play.addEventListener('click', () => {
      dialog.close();
      void this.openRecording(entry);
    });
    // The full name where the row has room, "Continue" on a narrow window.
    const more = el('button', { title: 'Continue recording: record on from where this talk stopped', 'aria-label': 'Continue recording' },
      el('span', { class: 'label-long', text: 'Continue recording' }), el('span', { class: 'label-short', text: 'Continue' }));
    more.hidden = !stored;
    more.addEventListener('click', () => {
      dialog.close();
      void this.continueRecording(entry);
    });
    const remove = el('button', { text: 'Delete', title: 'Delete the talk and its video' });
    remove.hidden = !stored;
    remove.addEventListener('click', () => {
      if (!confirm(`Delete the recording of ${when}?`)) return;
      void deleteRecording(this._deck.base as string, entry.name).then(() => this._refreshRecordings()).then(() => {
        // The talk being played is gone with its files: the deck is the viewer's again.
        if (this._playbackName === entry.name) this.closeRecording();
        if (this._recordings.length) refresh();
        else dialog.close();
      }).catch((error: Error) => this.notice(error.message));
    });
    const tracks: Array<[TrackKind, boolean, string]> = [
      ['deck', true, 'The deck: its stops, ink, pointer and camera switches, replayed from the timeline'],
      ['voice', Boolean(entry.media), 'Voice'],
      ['camera', entry.camera ?? entry.video, 'Camera'],
      ['screen', Boolean(entry.screen), 'Filmed screen'],
      ['sound', Boolean(entry.system), "Computer's sound"],
    ];
    const icons = el('span', { class: 'track-icons' });
    // A track missing leaves its place empty, so that the icons line up in columns.
    for (const [kind, present, label] of tracks) icons.append(present ? trackIcon(kind, label) : el('span', { class: 'track-gap', 'aria-hidden': 'true' }));
    const whenCell = el('td', { class: 'when' }, when);
    if (kept) whenCell.append(el('span', { class: 'tag', text: 'this page only', title: 'Kept in this page until it closes; the zip downloaded at Stop is its lasting copy' }));
    return el('tr', {},
      whenCell,
      el('td', { class: 'length', text: formatTime(entry.duration) }),
      el('td', { class: 'tracks' }, icons),
      el('td', { class: 'buttons' }, play, this._videoButton(entry, dialog, refresh), more, remove));
  }

  /**
   * A talk's video button. Once there is a video (rendered by the server, or made in this page
   * during the session), Rendered video plays it, with a way to download it. Before, Render
   * video makes one: off the clock by the server where it has ffmpeg (an MP4 in recordings/,
   * the button following its progress), else in this page while the talk plays once (a WebM,
   * kept for the session). The size and the proportions are those of the Recording settings;
   * the Export dialog offers every choice.
   */
  private _videoButton(entry: RecordingEntry, dialog: HTMLDialogElement, refresh: () => void): HTMLButtonElement {
    const talk = entry.name;
    const base = this._deck.base;
    const button = el('button', { class: 'video-button' });
    // The full names where the row has room, shorter ones on a narrow window.
    const label = (long: string, short: string) => button.replaceChildren(el('span', { class: 'label-long', text: long }), el('span', { class: 'label-short', text: short }));
    if ((entry.movie && base) || this._sessionVideos.has(talk)) {
      label('Rendered video', 'Video');
      button.title = 'Play the rendered video; it can be downloaded from there';
      button.addEventListener('click', () => {
        dialog.close();
        this._showRenderedVideo(entry);
      });
      return button;
    }
    const job = this._render.jobs.find((candidate) => candidate.talk === talk && candidate.status !== 'done') ?? null;
    if (job && ['queued', 'rendering', 'composing'].includes(job.status)) {
      const percent = Math.round(job.progress * 100);
      button.textContent = job.status === 'queued' ? 'Queued…' : job.status === 'composing' ? `Composing… ${percent}%` : `Rendering… ${percent}%`;
      button.disabled = true;
      return button;
    }
    const server = Boolean(base && recordingStoreAvailable() && this._render.ffmpeg) && !this._memoryTalks.has(talk);
    const page = Boolean(exportMimeType());
    label('Render video', 'Render');
    button.hidden = !this._features.has('export') || !(server || page);
    button.title = job?.status === 'failed'
      ? `The last render failed (${job.error ?? 'unknown error'}); render it again`
      : job?.status === 'interrupted'
        ? 'The last render was interrupted; render it again'
        : server
          ? 'Render the talk into an MP4 video, off the clock and faster than real time'
          : 'Make a video of the talk in this page, while it plays once in real time';
    if (job?.status === 'failed' || job?.status === 'interrupted') button.classList.add('failed');
    const recording = this._settings.recording;
    button.addEventListener('click', () => {
      if (server) {
        button.disabled = true;
        button.textContent = 'Queued…';
        void this.startRender(talk, `${talk}.video`).then(refresh);
        return;
      }
      dialog.close();
      void this._exportTalk(entry, { name: `${talk}.video`, method: 'page', destination: 'keep', size: recording.renderHeight ?? 'display', aspect: recording.renderAspect });
    });
    return button;
  }

  /** Play a talk's rendered video in a dialog of its own, with a button to download it. */
  private _showRenderedVideo(entry: RecordingEntry): void {
    const session = this._sessionVideos.get(entry.name);
    const base = this._deck.base;
    const url = session ? session.url : entry.movie && base ? recordingUrl(base, entry.movie) : null;
    if (!url) return;
    const file = session ? session.name : (entry.movie as string);
    const when = entry.recorded ? new Date(entry.recorded).toLocaleString() : entry.name;
    for (const stale of this.root.querySelectorAll('dialog.rendered-video')) stale.remove();
    const dialog = el('dialog', { class: 'settings rendered-video' });
    const close = el('button', { class: 'close', 'aria-label': 'Close', text: '×' });
    const video = el('video', { controls: '', autoplay: '', playsinline: '', src: url, 'aria-label': `The video of the talk of ${when}` });
    const save = el('button', { class: 'add', text: 'Download', title: `Save ${file}` });
    save.addEventListener('click', () => downloadUrl(url, file));
    const done = el('button', { text: 'Close' });
    for (const button of [close, done]) button.addEventListener('click', () => dialog.close());
    dialog.append(
      el('header', {}, el('h2', { text: `Video of the talk of ${when}` }), close),
      el('section', {}, video),
      el('div', { class: 'actions' }, save, done),
    );
    dialog.addEventListener('close', () => {
      video.pause();
      dialog.remove();
    });
    this.root.append(dialog);
    dialog.showModal();
  }

  /** Load a recording and show the playback bar; the deck now follows the recording, which plays unless `autoplay` is false (an export starts it itself). */
  async openRecording(entry: RecordingEntry, autoplay = true): Promise<void> {
    const base = this._deck.base;
    const player = this._player;
    const navigation = this._navigation;
    const memory = this._memoryTalks.get(entry.name) ?? null;
    if ((!base && !memory) || !player || !navigation) return;
    if (this._recorder) await this.stopRecording();
    this.closeRecording();
    let timeline;
    try {
      timeline = memory ? memory.timeline : await loadTimeline(base as string, entry);
    } catch (error) {
      this.notice((error as Error).message);
      return;
    }
    if (timeline.deck.hash !== structureHash(navigation)) this.notice('The deck changed since this talk was recorded; stops that moved may not match');
    this._finishStroke();
    this._setCameraStream(null);
    this._cameraButton.disabled = true;
    const camera = this._camera;
    if (timeline.media.length) {
      camera.srcObject = null;
      camera.muted = false;
    }
    this._playbackName = entry.name;
    this._playback = new Playback(timeline, {
      navigation,
      player,
      media: timeline.media.length ? camera : null,
      screen: timeline.media.some((part) => part.lane === 'screen') ? this._screen : null,
      system: timeline.media.some((part) => part.lane === 'system') ? this._system : null,
      onScreen: () => this._layoutCamera(),
      mediaUrl: (part) => (memory ? this._memoryUrl(memory, part.file) : mediaSource(base as string, entry, part)),
      apply: (event, instant) => this._applyTimelineEvent(event, instant),
      resetInk: () => {
        this._slideInk.reset();
        this._boardInk.reset();
      },
      onTime: (time) => {
        this._playRange.value = String(Math.round((time / Math.max(1, timeline.duration)) * 1000));
        this._playTime.textContent = `${formatTime(time)} / ${formatTime(timeline.duration)}`;
        this._playToggle.textContent = this._playback?.playing ? '❚❚' : '▶';
      },
      onEnd: () => {
        this._playToggle.textContent = '▶';
      },
      onMissingStop: (key) => this.notice(`The slide ${key.replace(/^markup:/, '')} is no longer in the deck`),
    });
    this.root.classList.add('playing-back');
    this._playbackBar.hidden = false;
    this._updateExportButtons();
    this._layoutCamera();
    // The talk starts where the deck stands: the moment it first reached the stop shown now, or its start when it never did.
    const here = stopRef(navigation, player.index);
    const from = here ? timeOfStop(timeline.events, here) : null;
    if (!autoplay) {
      this._playback.seek(0);
      return;
    }
    if (from === null && here && player.index > 0) this.notice('The talk never reached this stop; playing it from the start');
    this._playback.seek(from ?? 0);
    void this._playback.play();
  }

  /** Whether a recording is being played: the deck then follows it and takes no navigation, drawing or links from the viewer. */
  get playingBack(): boolean {
    return this._playback !== null;
  }

  /** Whether drawing is on (D): a plain drag draws, and links and live pages under the pointer are inert. */
  get drawingOn(): boolean {
    return this._drawingOn;
  }

  /** Leave the recording: the deck is the viewer's again, where the recording left it. */
  closeRecording(): void {
    const playback = this._playback;
    if (!playback) return;
    if (this._exporting) return;
    playback.dispose();
    this._playback = null;
    this._playbackName = null;
    this._playbackPointer = null;
    this._playbackCornerHidden = false;
    const camera = this._camera;
    camera.pause();
    camera.removeAttribute('src');
    camera.load();
    camera.muted = true;
    this._screen.pause();
    this._screen.removeAttribute('src');
    this._screen.load();
    this._screen.hidden = true;
    this._system.pause();
    this._system.removeAttribute('src');
    this._system.load();
    if (this._cameraFull) this._setCameraFull(false);
    this._cameraButton.disabled = false;
    this._playbackBar.hidden = true;
    this.root.classList.remove('playing-back');
    this._layoutCamera();
    this._updateSpotlight();
  }

  /**
   * Have `talk` rendered into `recordings/<output>.mp4` off the clock: the desktop app opens the
   * render page in a hidden window of its own; a browser opens it in a new tab (from a click,
   * or the tab is blocked). The list of talks shows the progress and opens the video.
   */
  async startRender(talk: string, output: string, size: number | 'display' = this._settings.recording.renderHeight ?? 'display', aspect: AspectChoice = this._settings.recording.renderAspect): Promise<void> {
    const base = this._deck.base;
    if (!base || !recordingStoreAvailable()) return;
    const url = renderPageUrl(talk, output, size, aspect);
    try {
      const taken = await requestRender(base, talk, output, url);
      if (!taken && !window.open(url, '_blank')) {
        this.notice('The browser blocked the render page; allow pop-ups for this site, or open it yourself from the list of talks');
        return;
      }
      this.notice(`Rendering ${talk} to recordings/${output}.mp4 in the background; the list of talks shows the progress`);
      await this._refreshRecordings();
    } catch (error) {
      this.notice(`Cannot render: ${(error as Error).message}`);
    }
  }

  /**
   * A video rendered by the server lands in the recordings folder; one wanted elsewhere is copied
   * from there when the render ends: into the file chosen through the browser's save dialog, or
   * as a download. This page watches the job meanwhile and must stay open.
   */
  private _deliverWhenRendered(talk: string, output: string, destination: 'pick' | 'download', handle?: FileSystemFileHandle): void {
    const base = this._deck.base;
    if (!base) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      void (async () => {
        const status = await renderStatus(base, talk).catch(() => null);
        const job = status?.jobs.find((candidate) => candidate.output === output) ?? null;
        if (job && job.status !== 'done' && job.status !== 'failed') {
          if (Date.now() - started > 6 * 3600_000) clearInterval(timer);
          return;
        }
        clearInterval(timer);
        if (job?.status === 'failed') {
          this.notice(`Rendering failed: ${job.error ?? 'unknown error'}`);
          return;
        }
        try {
          const response = await fetch(recordingUrl(base, `${output}.mp4`), { cache: 'no-store' });
          if (!response.ok) throw new Error(`the server answered ${response.status}`);
          const blob = await response.blob();
          if (handle) {
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            this.notice(`Video saved as ${handle.name} (and in recordings/)`);
          } else {
            download(blob, `${output}.mp4`);
            this.notice(`${output}.mp4 downloaded (and kept in recordings/)`);
          }
        } catch (error) {
          this.notice(`The video is in recordings/${output}.mp4, but could not be copied: ${(error as Error).message}`);
        }
      })();
    }, 3000);
  }

  /** After a recording: the talk is rendered by itself in the desktop app; a browser, which cannot open a tab without a click, offers a button. */
  private async _offerRender(talk: string): Promise<void> {
    const base = this._deck.base;
    if (!base || !recordingStoreAvailable()) return;
    const status = await renderStatus(base).catch(() => null);
    if (!status?.ffmpeg) return;
    this._render = status;
    if (status.desktop) {
      await this.startRender(talk, `${talk}.video`);
      return;
    }
    for (const stale of this.root.querySelectorAll('.render-offer')) stale.remove();
    const offer = el('div', { class: 'render-offer', role: 'status' });
    const go = el('button', { class: 'add', text: 'Render the video now' });
    const later = el('button', { text: 'Later' });
    go.addEventListener('click', () => {
      offer.remove();
      void this.startRender(talk, `${talk}.video`);
    });
    later.addEventListener('click', () => offer.remove());
    offer.append(el('span', { text: `Render ${talk} as an MP4 video? It runs in a tab of its own, faster than real time; the list of talks shows the progress and can start it later too.` }), go, later);
    this.root.append(offer);
  }

  /**
   * Render `talk` off the clock in this page, for the server to compose into
   * `recordings/<output>.mp4` (the page opened with `?render=` does this and nothing else):
   * the deck frames go out as they are drawn, the plan at the end, and the page waits for the
   * video before closing itself where it was opened for this alone.
   */
  async renderTalkOffline(talk: string, output: string, fps = 30, size: number | 'display' = 1080, aspectChoice: AspectChoice = 'presented'): Promise<void> {
    const base = this._deck.base;
    const player = this._player;
    const navigation = this._navigation;
    const stage = this._stage;
    if (!base || !player || !navigation || !stage || !recordingStoreAvailable()) return;
    await this._refreshRecordings();
    const entry = this._recordings.find((candidate) => candidate.name === talk) ?? { name: talk, title: '', recorded: '', duration: 0, media: null, video: false };
    let timeline: Timeline;
    try {
      timeline = await loadTimeline(base, entry);
    } catch (error) {
      this.notice((error as Error).message);
      return;
    }
    if (this._recorder) await this.stopRecording();
    this.closeRecording();
    this._setCameraStream(null);
    this._cameraButton.disabled = true;
    const progress = el('div', { class: 'render-progress', text: `Rendering ${talk}…` });
    this.root.append(progress);
    // Without a media element the playback runs on the page's clock, which the renderer drives.
    const playback = new Playback(timeline, {
      navigation,
      player,
      media: null,
      apply: (event, instant) => this._applyTimelineEvent(event, instant),
      resetInk: () => {
        this._slideInk.reset();
        this._boardInk.reset();
      },
      onMissingStop: (key) => this.notice(`The slide ${key.replace(/^markup:/, '')} is no longer in the deck`),
    });
    this._playback = playback;
    this._playbackName = talk;
    this.root.classList.add('playing-back');
    const session = new RenderSession(base, talk, output);
    const aspect = frameAspect(aspectChoice, timeline, this._deckAspect);
    const { width } = frameSize(size, aspect);
    const source = {
      aspect: this._deckAspect,
      background: this._deck.background,
      foreground: this._deck.foreground,
      penStyle: () => this._settings.pen,
      strokes: (surface: InkSurfaceName) => this._surface(surface).strokes,
      screen: () => null,
      mirror: false,
      pip: timeline.pip,
    };
    let outcome = '';
    try {
      await session.open();
      let reported = 0;
      const sent = await renderTalk(playback, player, stage, source, {
        fps,
        width,
        aspect,
        onFrame: async (blob, t, index) => {
          if (blob) await session.frame(index, t, blob);
        },
        onProgress: (fraction) => {
          progress.textContent = `Rendering ${talk}: ${Math.round(fraction * 100)}%`;
          if (fraction - reported >= 0.02 || fraction === 1) {
            reported = fraction;
            void session.progress(fraction);
          }
        },
      });
      if (sent === null) {
        await session.cancel();
        outcome = 'Rendering abandoned';
      } else {
        await session.finish(renderPlan(timeline, aspect, width, fps, sent.clips));
        progress.textContent = `Composing ${output}.mp4…`;
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const status = await renderStatus(base, talk).catch(() => null);
          const job = status?.jobs.find((candidate) => candidate.output === output) ?? null;
          if (!job || job.status === 'done') {
            outcome = `Rendered recordings/${output}.mp4`;
            break;
          }
          if (job.status === 'failed') {
            outcome = `Rendering failed: ${job.error ?? 'unknown error'}`;
            break;
          }
          progress.textContent = `Composing ${output}.mp4: ${Math.round(job.progress * 100)}%`;
        }
      }
    } catch (error) {
      outcome = `Rendering failed: ${(error as Error).message}`;
      await session.cancel();
    } finally {
      playback.dispose();
      this._playback = null;
      this._playbackName = null;
      this._playbackPointer = null;
      this.root.classList.remove('playing-back');
      this._cameraButton.disabled = false;
      this._layoutCamera();
      this._updateSpotlight();
    }
    progress.textContent = outcome;
    this.notice(outcome);
    await this._refreshRecordings();
    // A page opened for this alone (a tab from the list of talks, the desktop app's window) is done.
    if (window.opener) setTimeout(() => window.close(), 2000);
    else setTimeout(() => progress.remove(), 6000);
  }

  /** Apply a recorded event (other than a navigation) to this page. */
  private _applyTimelineEvent(event: TimelineEvent, instant: boolean): void {
    switch (event.type) {
      case 'ink': this._applyInk(event.surface, event.op); break;
      case 'board': if (event.on !== this._boardOn) this._setBoardShown(event.on); break;
      case 'pan': this._setBoardPan(event.x, event.y, !instant); break;
      case 'camera': this._setCameraFull(event.on); break;
      case 'corner':
        this._playbackCornerHidden = event.hidden;
        this._layoutCamera();
        break;
      case 'pointer':
        this._playbackPointer = { mode: event.mode, x: event.x, y: event.y, r: event.r };
        this._updateSpotlight();
        break;
      case 'pointer-off':
        this._playbackPointer = null;
        this.stageHost.classList.remove('spotlight-active');
        this._updateSpotlight();
        break;
      case 'go': case 'rewind': case 'speed': case 'cut': case 'stage': break;
    }
  }

  // ---------------------------------------------------------------------
  // Exporting: the deck as a web page, a recorded talk as a video
  // ---------------------------------------------------------------------

  /** Whether the deck can be exported as a web page here: a preview server builds it from the deck's own file. */
  private _webExportAvailable(): boolean {
    return webExportAvailable(this._deck.file);
  }

  /** The recorded talks that can be exported as videos: all of them, where this page or the server can make a video. */
  private _exportableTalks(): RecordingEntry[] {
    if (!this._features.has('record')) return [];
    const server = Boolean(this._deck.base && recordingStoreAvailable() && this._render.ffmpeg);
    return server || exportMimeType() ? this._recordings : [];
  }

  /** The Export button shows where there is something to export, and the export feature is on. */
  private _updateExportButtons(): void {
    const shown = this._features.has('export') && (this._webExportAvailable() || this._exportableTalks().length > 0);
    this._exportButton.hidden = !shown;
    const group = this._exportButton.parentElement;
    if (group) group.hidden = [...group.children].every((child) => (child as HTMLElement).hidden);
  }

  /** A talk's timeline: the one played back, or read from its files. */
  private async _timelineOf(entry: RecordingEntry): Promise<Timeline> {
    if (this._playback && this._playbackName === entry.name) return this._playback.timeline;
    const memory = this._memoryTalks.get(entry.name);
    if (memory) return memory.timeline;
    return loadTimeline(this._deck.base as string, entry);
  }

  /**
   * The Export dialog. *What* offers the deck as a web page, where a preview server can build
   * it, and each recorded talk as a video; the rows below follow the choice. `talk` is chosen
   * first when given (the playback bar passes the talk it plays); otherwise the web page is.
   */
  async openExport(talk: string | null = null): Promise<void> {
    if (!this._features.has('export')) return;
    if (this._recorder) {
      this.notice('Stop the recording before exporting');
      return;
    }
    if (this._exporting || this._webExporting) {
      this.notice('An export is under way');
      return;
    }
    const web = this._webExportAvailable();
    const talks = this._exportableTalks();
    if (!web && !talks.length) {
      this.notice('Nothing to export here: the deck becomes a web page where zoomdeck serve or the desktop app shows it, and recorded talks become videos');
      return;
    }
    for (const stale of this.root.querySelectorAll('dialog.export')) stale.remove();
    const dialog = el('dialog', { class: 'settings export' });
    const close = el('button', { class: 'close', 'aria-label': 'Close', text: '×' });
    const what = el('select', { 'aria-label': 'What to export' });
    const deckGroup = el('optgroup', { label: 'This deck' });
    const webOption = el('option', { value: 'web', text: web ? 'As a web page (HTML)' : 'As a web page (HTML), where zoomdeck serve or the desktop app shows the deck' });
    webOption.disabled = !web;
    deckGroup.append(webOption);
    what.append(deckGroup);
    if (talks.length) {
      const talkGroup = el('optgroup', { label: 'A recorded talk, as a video' });
      for (const entry of talks) {
        const when = entry.recorded ? new Date(entry.recorded).toLocaleString() : entry.name;
        talkGroup.append(el('option', { value: `talk:${entry.name}`, text: `${when} · ${formatTime(entry.duration)}` }));
      }
      what.append(talkGroup);
    }
    what.value = talk && talks.some((entry) => entry.name === talk) ? `talk:${talk}` : web ? 'web' : `talk:${talks[0].name}`;
    const rows = el('div', { class: 'export-rows' });
    const status = el('p', { class: 'note' });
    const run = el('button', { class: 'add', text: 'Export' });
    const cancel = el('button', { text: 'Cancel' });
    dialog.append(
      el('header', {}, el('h2', { text: 'Export' }), close),
      el('section', {}, el('div', { class: 'row' }, el('label', {}, 'What ', what)), rows, status, el('div', { class: 'row' }, run, cancel)),
    );
    let cancelled = false;
    // While the web page is built and written, the choices hold still; the ones enabled before come back after.
    let locked: Array<HTMLInputElement | HTMLSelectElement | HTMLButtonElement> = [];
    const lock = (on: boolean) => {
      if (on) {
        locked = [...dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'), run].filter((control) => !control.disabled);
        for (const control of locked) control.disabled = true;
      } else {
        for (const control of locked) control.disabled = false;
        locked = [];
      }
    };
    // The rows of the choice, and what Export then does: true closes the dialog.
    let action: (() => Promise<boolean>) | null = null;
    let generation = 0;
    const show = async () => {
      const mine = ++generation;
      action = null;
      run.disabled = true;
      rows.replaceChildren();
      status.textContent = '';
      if (what.value === 'web') {
        action = this._webExportRows(rows, status, run, lock, () => cancelled);
        run.disabled = false;
        return;
      }
      const entry = talks.find((candidate) => `talk:${candidate.name}` === what.value);
      if (!entry) return;
      status.textContent = 'Reading the talk…';
      let timeline: Timeline;
      try {
        timeline = await this._timelineOf(entry);
      } catch (error) {
        if (mine === generation) status.textContent = (error as Error).message;
        return;
      }
      if (mine !== generation) return;
      action = this._videoExportRows(entry, timeline, rows, status, run);
      run.disabled = false;
    };
    what.addEventListener('change', () => void show());
    run.addEventListener('click', () => {
      const go = action;
      if (!go) return;
      void go().then((done) => {
        if (done) dialog.close();
      });
    });
    cancel.addEventListener('click', () => dialog.close());
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      cancelled = true;
      dialog.remove();
    });
    this.root.append(dialog);
    dialog.showModal();
    await show();
  }

  /**
   * The rows for the deck as a web page: its name, its form, the notes and the outline, and
   * where it goes. Export then has the server build it while the dialog shows the progress.
   */
  private _webExportRows(rows: HTMLElement, status: HTMLElement, run: HTMLButtonElement, lock: (on: boolean) => void, cancelled: () => boolean): () => Promise<boolean> {
    const choice = this._webChoice;
    const nameInput = el('input', { type: 'text', value: defaultWebExportName(this._deck.file, this._deck.title), 'aria-label': 'Name', spellcheck: 'false' });
    const suffix = el('span', { class: 'note' });
    const form = el('select', { 'aria-label': 'Form of the web page' });
    form.append(
      el('option', { value: 'file', text: 'One self-contained HTML file (opens from disk, by a double click)' }),
      el('option', { value: 'folder', text: 'A folder of files, recorded talks included (for a web server)' }),
    );
    form.value = choice.form;
    const notes = el('input', { type: 'checkbox' });
    notes.checked = !choice.notes;
    const outline = el('input', { type: 'checkbox' });
    // A deck that opens its outline by itself keeps doing so.
    outline.checked = this._deck.showOutline;
    outline.disabled = this._deck.showOutline;
    const where = el('select', { 'aria-label': 'Where to save the web page' });
    const pickers = () => form.value === 'folder'
      ? typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'
      : typeof (window as SavePickerWindow).showSaveFilePicker === 'function';
    const fillWhere = () => {
      const previous = where.value || choice.destination;
      where.replaceChildren();
      if (pickers()) where.append(el('option', { value: 'pick', text: 'A folder of my choice (asked when the export starts)' }));
      where.append(el('option', { value: 'build', text: 'The build/ folder next to the deck' }));
      where.append(el('option', { value: 'download', text: form.value === 'folder' ? "The browser's downloads, as a zip" : "The browser's downloads" }));
      if (previous && [...where.options].some((option) => option.value === previous)) where.value = previous;
    };
    const describe = () => {
      const name = webExportName(nameInput.value);
      const folder = form.value === 'folder';
      suffix.textContent = folder ? '/' : '.html';
      const made = folder
        ? 'A folder: index.html, the player in chunks loaded on demand, and the deck\'s files in deck/, the recorded talks unpacked among them. A browser needs the folder served over HTTP: any static host or server.'
        : 'The player, the engine, the fonts, the deck and every asset it uses, in one file that opens by a double click, from disk, an attachment or any host. Recorded talks are left out; the folder carries them.';
      const delivered = where.value === 'pick'
        ? folder ? ` It is written into a folder ${name} inside the folder you choose.` : ' It is saved where you choose.'
        : where.value === 'build'
          ? ` It is written to build/${name}${folder ? '/' : '.html'} next to the deck, replacing an earlier export of that name.`
          : ` It arrives in the downloads as ${name}${folder ? '.zip' : '.html'}.`;
      status.textContent = `${made}${delivered} The server builds it first, in some seconds for a small deck; keep this dialog open.`;
    };
    form.addEventListener('change', () => {
      fillWhere();
      describe();
    });
    where.addEventListener('change', describe);
    nameInput.addEventListener('input', describe);
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') run.click();
    });
    fillWhere();
    describe();
    rows.append(
      el('div', { class: 'row' }, el('label', {}, 'Name ', nameInput), suffix),
      el('div', { class: 'row' }, el('label', {}, 'Form ', form)),
      el('div', { class: 'row' }, el('label', {}, notes, ' Leave the presenter notes out, for a deck handed to the audience')),
      el('div', { class: 'row' }, el('label', {}, outline, ' Open the slide outline when the deck starts')),
      el('div', { class: 'row' }, el('label', {}, 'Save to ', where)),
    );
    queueMicrotask(() => nameInput.select());
    return () => {
      this._webChoice = { form: form.value as WebPageForm, notes: !notes.checked, destination: where.value };
      return this._exportWebPage(webExportName(nameInput.value), form.value as WebPageForm, !notes.checked, outline.checked, where.value as 'pick' | 'build' | 'download', status, lock, cancelled);
    };
  }

  /**
   * Have the server build the deck as a web page and deliver it: into the folder or the file
   * chosen (asked first, while the click still counts for the browser), the deck's build/
   * folder, or the downloads. Resolves true when the dialog may close.
   */
  private async _exportWebPage(name: string, form: WebPageForm, notes: boolean, outline: boolean, destination: 'pick' | 'build' | 'download', status: HTMLElement, lock: (on: boolean) => void, cancelled: () => boolean): Promise<boolean> {
    const file = this._deck.file;
    if (!file || this._webExporting) return false;
    let folder: FileSystemDirectoryHandle | null = null;
    let target: FileSystemFileHandle | null = null;
    if (destination === 'pick') {
      try {
        if (form === 'folder') folder = (await (window as DirectoryPickerWindow).showDirectoryPicker?.({ id: 'zoomdeck-export', mode: 'readwrite' })) ?? null;
        else target = (await (window as SavePickerWindow).showSaveFilePicker?.({ suggestedName: `${name}.html`, types: [{ description: 'Web page', accept: { 'text/html': ['.html'] } }] })) ?? null;
      } catch (error) {
        // Dismissed, the dialog stays as it was; a picker that fails says so, and another place can be chosen.
        if ((error as DOMException).name !== 'AbortError') status.textContent = `No folder can be chosen here (${(error as Error).message}); choose another place to save to.`;
        return false;
      }
      if (!folder && !target) return false;
      const problem = folder ? await folderProblem(folder, name) : null;
      if (problem) {
        status.textContent = problem;
        return false;
      }
    } else if (destination === 'build') {
      // A name taken by something else in build/ is refused before the build, not after.
      try {
        await checkWebExportPlace(file, name, form);
      } catch (error) {
        status.textContent = (error as Error).message;
        return false;
      }
    }
    this._webExporting = true;
    lock(true);
    let id: string | null = null;
    let keep = false;
    try {
      id = await startWebExport(file, { form, notes, outline });
      const started = performance.now();
      const result = await waitForWebExport(id, () => {
        status.textContent = `Building the web page… ${Math.round((performance.now() - started) / 1000)} s`;
      }, cancelled);
      if (!result) return true;
      if (result.status === 'failed') throw new Error(result.error ?? 'the build failed');
      if (folder) {
        const done = await writeWebExportFolder(id, result.files, folder, name, (count, total) => {
          status.textContent = `Writing file ${count} of ${total}…`;
        }, cancelled);
        if (done) this.notice(`Exported into ${folder.name}/${name}/`);
      } else if (target) {
        status.textContent = 'Writing the file…';
        await writeWebExportFile(id, target);
        this.notice(`Exported as ${target.name}`);
      } else if (destination === 'build') {
        this.notice(`Exported into ${await placeWebExport(id, name)} next to the deck`);
      } else {
        // The download streams from the server's copy, which therefore stays (the server removes it within the hour).
        keep = true;
        if (form === 'folder') downloadUrl(webExportZipUrl(id, name), `${name}.zip`);
        else downloadUrl(webExportFileUrl(id, 'offline.html', `${name}.html`), `${name}.html`);
        this.notice(`${name}${form === 'folder' ? '.zip' : '.html'} is downloading`);
      }
      return true;
    } catch (error) {
      status.textContent = `The export failed: ${(error as Error).message}`;
      return false;
    } finally {
      if (id && !keep) void forgetWebExport(id);
      this._webExporting = false;
      lock(false);
    }
  }

  /** The rows for a talk as a video: its name, how it is made, where it goes, its size and proportions. Export then starts it and closes the dialog. */
  private _videoExportRows(entry: RecordingEntry, timeline: Timeline, rows: HTMLElement, status: HTMLElement, run: HTMLButtonElement): () => Promise<boolean> {
    const talk = entry.name;
    const folder = Boolean(this._deck.base && recordingStoreAvailable());
    const picker = typeof (window as SavePickerWindow).showSaveFilePicker === 'function';
    const server = folder && this._render.ffmpeg;
    const page = Boolean(exportMimeType());
    const nameInput = el('input', { type: 'text', value: `${talk}.video`, 'aria-label': 'File name', spellcheck: 'false' });
    // How the video is made, and separately where the file goes.
    const how = el('select', { 'aria-label': 'How the video is made' });
    if (server) how.append(el('option', { value: 'server', text: 'Off the clock, by the server (MP4; faster than real time, this page stays free)' }));
    if (page) how.append(el('option', { value: 'page', text: 'In this page, in real time (WebM; takes as long as the talk)' }));
    const where = el('select', { 'aria-label': 'Where to save the video' });
    if (picker) where.append(el('option', { value: 'pick', text: 'A folder of my choice (asked when the export starts)' }));
    if (folder) where.append(el('option', { value: 'folder', text: 'The recordings/ folder next to the deck' }));
    where.append(el('option', { value: 'download', text: "The browser's downloads" }));
    const suffix = el('span', { class: 'note', text: '.webm' });
    const sizeSelect = this._sizeSelect('Size of the video', this._settings.recording.renderHeight);
    const aspectSelect = this._aspectSelect('Proportions of the video', this._settings.recording.renderAspect, timeline);
    const chosenSize = (): number | 'display' => Number(sizeSelect.value) || 'display';
    const chosenAspect = () => aspectSelect.value as AspectChoice;
    const describe = () => {
      const offline = how.value === 'server';
      suffix.textContent = offline ? '.mp4' : '.webm';
      const frame = frameSize(chosenSize(), frameAspect(chosenAspect(), timeline, this._deckAspect));
      const size = `${frame.width} by ${frame.height} pixels`;
      const made = offline
        ? `The talk is rendered in a page of its own, off the clock and faster than real time, and ffmpeg lays the camera, the screen and the sound from the recording over the deck: an MP4 file (H.264 and AAC), ${size}. The list of talks shows the progress.`
        : `The talk opens and plays from the start while the video is written, which takes as long as the talk; keep this window visible until it ends. The file is WebM (VP9 and Opus), ${size}, with the slides or the whiteboard and their ink, the camera in its corner or full frame, the pointer, and the sound.`;
      const delivered = offline && where.value !== 'folder'
        ? ` The server writes the video into the recordings/ folder, where the list of talks opens it; when the render ends, this page ${where.value === 'pick' ? 'writes a copy to the folder you chose' : 'offers a copy as a download'}, so keep this page open until then.`
        : '';
      status.textContent = made + delivered;
    };
    how.addEventListener('change', describe);
    where.addEventListener('change', describe);
    sizeSelect.addEventListener('change', describe);
    aspectSelect.addEventListener('change', describe);
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') run.click();
    });
    describe();
    rows.append(
      el('div', { class: 'row' }, el('label', {}, 'Name ', nameInput), suffix),
      ...(server && page ? [el('div', { class: 'row' }, el('label', {}, 'Made ', how))] : []),
      el('div', { class: 'row' }, el('label', {}, 'Save to ', where)),
      el('div', { class: 'row' }, el('label', {}, 'Size ', sizeSelect)),
      el('div', { class: 'row' }, el('label', {}, 'Proportions ', aspectSelect)),
    );
    queueMicrotask(() => nameInput.select());
    return async () => {
      // Characters a file name or the server refuse become dashes; an empty name falls back to the talk's.
      const name = nameInput.value.trim().replace(/[^\w.-]+/g, '-').replace(/^[^A-Za-z0-9]+|-+$/g, '') || `${talk}.video`;
      const destination = where.value as ExportChoice['destination'];
      const method = (how.value === 'server' ? 'server' : 'page') as ExportChoice['method'];
      let handle: FileSystemFileHandle | undefined;
      if (destination === 'pick') {
        try {
          // The picker must follow the click directly; the file is written when the export, or the render, ends.
          const extension = method === 'server' ? 'mp4' : 'webm';
          handle = await (window as SavePickerWindow).showSaveFilePicker?.({ suggestedName: `${name}.${extension}`, types: [{ description: method === 'server' ? 'MP4 video' : 'WebM video', accept: { [method === 'server' ? 'video/mp4' : 'video/webm']: [`.${extension}`] } }] });
        } catch (error) {
          // Dismissed, the dialog stays as it was; a picker that fails says so, and another place can be chosen.
          if ((error as DOMException).name !== 'AbortError') status.textContent = `No file can be chosen here (${(error as Error).message}); choose another place to save to.`;
          return false;
        }
        if (!handle) return false;
      }
      void this._exportTalk(entry, { name, method, destination, handle, size: chosenSize(), aspect: chosenAspect() });
      return true;
    };
  }

  /**
   * Export a talk as a video: off the clock by the server, or in this page in real time, where
   * the talk is opened (when another, or none, plays) and played from its start while it is
   * filmed; the playback bar shows the progress meanwhile.
   */
  private async _exportTalk(entry: RecordingEntry, choice: ExportChoice): Promise<void> {
    const talk = entry.name;
    const name = choice.name;
    if (choice.method === 'server') {
      await this.startRender(talk, name, choice.size, choice.aspect);
      // The server writes into the recordings folder; a file wanted elsewhere is handed over from there when the render ends.
      if (choice.destination === 'pick' || choice.destination === 'download') this._deliverWhenRendered(talk, name, choice.destination, choice.handle);
      return;
    }
    if (this._exporting) return;
    // Opened without playing: a play started and paused at once would end after the export's own play began, and stop it.
    if (!this._playback || this._playbackName !== talk) await this.openRecording(entry, false);
    const playback = this._playback;
    if (!playback || this._playbackName !== talk || this._exporting) return;
    if (playback.playing) playback.pause();
    const aspect = frameAspect(choice.aspect, playback.timeline, this._deckAspect);
    const { width } = frameSize(choice.size, aspect);
    this._exporting = true;
    this._exportProgress.textContent = 'Exporting… 0%';
    this._exportProgress.hidden = false;
    this._playRange.disabled = true;
    this._playToggle.disabled = true;
    const source: ExportSource = {
      aspect: this._deckAspect,
      frameAspect: aspect,
      background: this._deck.background,
      foreground: this._deck.foreground,
      penStyle: () => this._settings.pen,
      strokes: (surface) => this._surface(surface).strokes,
      stage: () => this._stageCrop(aspect),
      camera: playback.timeline.media.length ? this._camera : null,
      screen: () => this._screenVideo(),
      system: playback.timeline.media.some((part) => part.lane === 'system') ? this._system : null,
      mirror: false,
      pip: playback.timeline.pip,
    };
    try {
      const blob = await exportVideo(playback, source, {
        width,
        onProgress: (fraction) => {
          this._exportProgress.textContent = `Exporting… ${Math.round(fraction * 100)}%`;
        },
      });
      // The video stays in this page for the session too: the list of talks plays it and offers it for download.
      const previous = this._sessionVideos.get(talk);
      if (previous) URL.revokeObjectURL(previous.url);
      this._sessionVideos.set(talk, { url: URL.createObjectURL(blob), name: `${name}.webm` });
      if (choice.handle) {
        const writable = await choice.handle.createWritable();
        await writable.write(blob);
        await writable.close();
        this.notice(`Video saved as ${choice.handle.name}`);
      } else if (choice.destination === 'folder') {
        await saveFile(this._deck.base as string, name, 'webm', blob);
        await this._refreshRecordings();
        this.notice(`Video saved as recordings/${name}.webm`);
      } else if (choice.destination === 'keep') {
        this.notice('The video is ready: Rendered video, in the list of talks, plays it and downloads it');
      } else {
        download(blob, `${name}.webm`);
        this.notice(`${name}.webm downloaded`);
      }
    } catch (error) {
      this.notice(`Export failed: ${(error as Error).message}`);
    } finally {
      this._exporting = false;
      this._exportProgress.hidden = true;
      this._playRange.disabled = false;
      this._playToggle.disabled = false;
    }
  }

  // ---------------------------------------------------------------------
  // Printing
  // ---------------------------------------------------------------------

  /** The print dialog: which stops become pages and at what resolution; the PDF is then downloaded. */
  openPrint(): void {
    const player = this._player;
    const stage = this._stage;
    const navigation = this._navigation;
    if (!player || !stage || !navigation || this._printing) return;
    if (this._recorder) {
      this.notice('Stop the recording before printing');
      return;
    }
    if (this._playback) {
      this.notice('Leave the recording before printing');
      return;
    }
    const dialog = el('dialog', { class: 'settings print' });
    const close = el('button', { class: 'close', 'aria-label': 'Close', text: '×' });
    close.addEventListener('click', () => dialog.close());
    const pagesSelect = el('select', { 'aria-label': 'Pages' });
    const counts: Record<PrintPages, number> = { stages: printPages(navigation, 'stages').length, slides: printPages(navigation, 'slides').length };
    for (const [value, label] of [['stages', `Every stage (${counts.stages} pages)`], ['slides', `The last stage of each slide (${counts.slides} pages)`]] as Array<[PrintPages, string]>) {
      const option = el('option', { value, text: label });
      if (value === this._printChoice.pages) option.selected = true;
      pagesSelect.append(option);
    }
    const widthSelect = el('select', { 'aria-label': 'Resolution' });
    for (const [width, label] of PRINT_WIDTHS) {
      const option = el('option', { value: String(width), text: label });
      if (width === this._printChoice.width) option.selected = true;
      widthSelect.append(option);
    }
    const run = el('button', { class: 'add', text: 'Print to PDF' });
    const status = el('p', { class: 'note', text: 'Each page is a stage of the deck, drawn as the screen shows it, without ink or pointer; the slides become the bookmarks of the file. The deck leafs through its stops while the pages are made, then comes back here.' });
    const done = el('button', { text: 'Close' });
    done.addEventListener('click', () => dialog.close());
    run.addEventListener('click', () => {
      this._printChoice = { pages: pagesSelect.value as PrintPages, width: Number(widthSelect.value) };
      pagesSelect.disabled = widthSelect.disabled = run.disabled = true;
      done.textContent = 'Cancel';
      void this._print(dialog, status).finally(() => dialog.close());
    });
    dialog.append(
      el('header', {}, el('h2', { text: 'Print the deck' }), close),
      el('section', {},
        el('div', { class: 'row' }, el('label', {}, 'Pages ', pagesSelect)),
        el('div', { class: 'row' }, el('label', {}, 'Resolution ', widthSelect)),
        status,
        el('div', { class: 'row' }, run, done)),
    );
    dialog.addEventListener('close', () => dialog.remove());
    this.root.append(dialog);
    dialog.showModal();
  }

  /** Render the pages and download the file; closing the dialog cancels. */
  private async _print(dialog: HTMLDialogElement, status: HTMLElement): Promise<void> {
    const player = this._player;
    const stage = this._stage;
    if (!player || !stage) return;
    this._printing = true;
    this._printButton.disabled = true;
    this._finishStroke();
    try {
      const blob = await printDeck(player, stage, {
        ...this._printChoice,
        title: this._deck.title,
        onProgress: (done, total) => {
          status.textContent = done < total ? `Printing page ${done + 1} of ${total}…` : 'Writing the file…';
        },
        cancelled: () => !dialog.open,
      });
      if (!blob) {
        this.notice('Printing cancelled');
        return;
      }
      const name = this._deck.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'deck';
      download(blob, `${name}.pdf`);
      this.notice(`${name}.pdf is ready`);
    } catch (error) {
      this.notice(`Printing failed: ${(error as Error).message}`);
    } finally {
      this._printing = false;
      this._printButton.disabled = false;
    }
  }

  /** The WebGL canvas and the device-pixel rectangle of the deck's viewport in it, after a fresh render. */
  /** The live canvas, freshly rendered, and the centered part of it in the proportions `aspect` (the deck's by default), as large as the canvas allows. */
  private _stageCrop(aspect = this._deckAspect): { canvas: HTMLCanvasElement; sx: number; sy: number; sw: number; sh: number } | null {
    const stage = this._stage;
    const canvas = this.stageHost.querySelector('canvas');
    if (!stage || !canvas || canvas.width === 0) return null;
    stage.render();
    const wide = canvas.width / canvas.height > aspect;
    const sw = Math.max(1, Math.round(wide ? canvas.height * aspect : canvas.width));
    const sh = Math.max(1, Math.round(wide ? canvas.height : canvas.width / aspect));
    return { canvas, sx: Math.round((canvas.width - sw) / 2), sy: Math.round((canvas.height - sh) / 2), sw, sh };
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

  /** The settings as saved in this browser; the stage is created from their rendering part. */
  get settings(): PlayerSettings {
    return this._settings;
  }

  /** Open the settings, on the category last looked at (or `category`: pointer, pen, recording, tablet, keyboard, advanced). */
  openSettings(category?: string): void {
    this._syncSettingsForm();
    this._renderBindings();
    if (category) this._showSettingsCategory(category);
    if (!this._dialog.open) this._dialog.showModal();
  }

  /** The settings' categories: a list on the left, one pane shown at a time; the choice is kept in this browser. */
  private _settingsCategories: Array<{ id: string; tab: HTMLButtonElement; pane: HTMLElement }> = [];

  private _showSettingsCategory(id: string): void {
    const categories = this._settingsCategories;
    const chosen = categories.find((category) => category.id === id) ?? categories[0];
    if (!chosen) return;
    for (const category of categories) {
      const on = category === chosen;
      category.tab.setAttribute('aria-selected', String(on));
      category.tab.tabIndex = on ? 0 : -1;
      category.pane.hidden = !on;
    }
    try {
      localStorage.setItem('zoomdeck:settings-category', chosen.id);
    } catch {
      /* storage unavailable */
    }
  }

  private _buildSettingsDialog(): HTMLDialogElement {
    const dialog = el('dialog', { class: 'settings main' });
    const close = el('button', { class: 'close', 'aria-label': 'Close settings', text: '×' });
    close.addEventListener('click', () => dialog.close());
    const done = el('button', { class: 'done', text: 'Close' });
    done.addEventListener('click', () => dialog.close());

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

    // Rendering: the WebGL context is made once, so these apply when the page loads again.
    this._antialiasToggle = el('input', { type: 'checkbox' });
    this._antialiasToggle.addEventListener('change', () => {
      this._settings.rendering.antialias = this._antialiasToggle.checked;
      saveSettings(this._settings);
      this._renderingChanged();
    });
    this._resolutionSelect = el('select', { 'aria-label': 'Render resolution' });
    for (const [value, label] of [['auto', 'The screen\'s (up to 2×)'], ['1', '1×: fewer pixels, faster'], ['2', '2×: sharper on a low-resolution screen, heavier']]) {
      this._resolutionSelect.append(el('option', { value, text: label }));
    }
    this._resolutionSelect.addEventListener('change', () => {
      const value = this._resolutionSelect.value;
      this._settings.rendering.resolution = value === 'auto' ? 'auto' : (Number(value) as 1 | 2);
      saveSettings(this._settings);
      this._renderingChanged();
    });
    const reload = el('button', { class: 'add', text: 'Reload now' });
    reload.addEventListener('click', () => location.reload());
    this._renderingNote = el('p', { class: 'note', hidden: '' }, 'The rendering options take effect when the page is loaded again. ', reload);
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
    this._tipSelect = el('select', { 'aria-label': 'Tip size' });
    for (const size of TIP_SIZES) this._tipSelect.append(el('option', { value: String(size), text: `${size} px` }));
    this._tipSelect.addEventListener('change', () => {
      this._finishStroke();
      this._settings.tipSize = Number(this._tipSelect.value);
      saveSettings(this._settings);
    });
    const penRows = el('div', { class: 'bindings' });
    penRows.append(el('div', { class: 'binding gesture' }, el('span', { class: 'action', text: 'Tip size (the width at medium pressure)' }), this._tipSelect));
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
      this._settings.tipSize = DEFAULT_TIP_SIZE;
      this._penChanged();
    });

    // Recording: the devices and the camera picture's place.
    this._micSelect = el('select', { 'aria-label': 'Microphone' });
    this._cameraSelect = el('select', { 'aria-label': 'Camera' });
    this._fillDeviceSelects([]);
    this._micSelect.addEventListener('change', () => {
      this._settings.recording.microphone = this._micSelect.value || null;
      saveSettings(this._settings);
      if (this._testStream) void this._startDeviceTest();
    });
    this._cameraSelect.addEventListener('change', () => {
      this._settings.recording.camera = this._cameraSelect.value || null;
      saveSettings(this._settings);
      if (this._cameraStream && !this._recorder) this._setCameraStream(null);
      if (this._testStream) void this._startDeviceTest();
    });
    const detect = el('button', { text: 'Detect devices' });
    detect.addEventListener('click', () => void this._detectDevices());
    // The test: the chosen devices opened as a recording would, with the picture, a sound level and a sample to hear.
    this._testButton = el('button', { text: 'Test the devices', title: 'Show the camera picture and the sound level of the chosen devices' });
    this._testButton.addEventListener('click', () => void this._toggleDeviceTest());
    this._testVideo = el('video', { class: 'preview', hidden: '', playsinline: '', autoplay: '', 'aria-label': 'Camera test picture' });
    this._testVideo.muted = true;
    this._testLevel = el('span');
    this._listenButton = el('button', { class: 'add', text: 'Hear a 3-second sample', title: 'Record three seconds from the microphone and play them back' });
    this._listenButton.disabled = true;
    this._listenButton.addEventListener('click', () => void this._listenToSample());
    this._testStatus = el('p', { class: 'note' });
    this._testPanel = el('div', { class: 'device-test', hidden: '' },
      this._testVideo,
      el('div', { class: 'sound' }, el('div', { class: 'meter', role: 'meter', 'aria-label': 'Sound level' }, this._testLevel), this._listenButton),
      this._testStatus);
    this._screenAskToggle = el('input', { type: 'checkbox' });
    this._screenAskToggle.addEventListener('change', () => {
      this._settings.recording.screenOnRecord = this._screenAskToggle.checked;
      saveSettings(this._settings);
    });
    this._systemAudioToggle = el('input', { type: 'checkbox' });
    this._systemAudioToggle.addEventListener('change', () => {
      this._settings.recording.systemAudio = this._systemAudioToggle.checked;
      saveSettings(this._settings);
      void this._syncSystemLane();
    });
    this._renderToggle = el('input', { type: 'checkbox' });
    this._renderToggle.addEventListener('change', () => {
      this._settings.recording.renderOnStop = this._renderToggle.checked;
      saveSettings(this._settings);
    });
    this._renderSizeSelect = this._sizeSelect('Size of rendered and exported videos', DEFAULT_RECORDING.renderHeight);
    this._renderSizeSelect.addEventListener('change', () => {
      this._settings.recording.renderHeight = Number(this._renderSizeSelect.value) || null;
      saveSettings(this._settings);
    });
    this._renderAspectSelect = this._aspectSelect('Proportions of rendered and exported videos', DEFAULT_RECORDING.renderAspect, null);
    this._renderAspectSelect.addEventListener('change', () => {
      this._settings.recording.renderAspect = this._renderAspectSelect.value as AspectChoice;
      saveSettings(this._settings);
    });
    this._hoverCameraToggle = el('input', { type: 'checkbox' });
    this._hoverCameraToggle.addEventListener('change', () => {
      this._settings.recording.hideCameraOnHover = this._hoverCameraToggle.checked;
      saveSettings(this._settings);
      if (!this._hoverCameraToggle.checked) this._hoverCamera(null, null);
    });
    this._mirrorToggle = el('input', { type: 'checkbox' });
    this._mirrorToggle.addEventListener('change', () => {
      this._settings.recording.mirror = this._mirrorToggle.checked;
      saveSettings(this._settings);
      this._layoutCamera();
      this._testVideo.classList.toggle('mirror', this._mirrorToggle.checked);
    });
    this._cornerSelect = el('select', { 'aria-label': 'Corner of the camera picture' });
    for (const corner of CORNERS) this._cornerSelect.append(el('option', { value: corner, text: corner.replace('-', ' ') }));
    this._cornerSelect.addEventListener('change', () => {
      this._settings.recording.corner = this._cornerSelect.value as Corner;
      saveSettings(this._settings);
      this._layoutCamera();
    });
    this._pipSizeSelect = el('select', { 'aria-label': 'Size of the camera picture' });
    for (const [size, label] of PIP_SIZES) this._pipSizeSelect.append(el('option', { value: String(size), text: label }));
    this._pipSizeSelect.addEventListener('change', () => {
      this._settings.recording.size = Number(this._pipSizeSelect.value);
      saveSettings(this._settings);
      this._layoutCamera();
      // The floating window cannot be resized once open: it opens again at the new size (the change is a gesture, which the browser wants).
      if (this._pipWindow) {
        this._exitPip();
        void this._openCameraWindow();
      }
    });
    const recordingRows = el('div', { class: 'bindings' },
      el('div', { class: 'binding gesture' }, el('span', { class: 'action', text: 'Microphone' }), this._micSelect),
      el('div', { class: 'binding gesture' }, el('span', { class: 'action', text: 'Camera (None: no camera at all)' }), this._cameraSelect),
      el('div', { class: 'binding gesture' }, el('span', { class: 'action', text: 'Corner of the camera picture' }), this._cornerSelect),
      el('div', { class: 'binding gesture' }, el('span', { class: 'action', text: 'Size of the camera picture' }), this._pipSizeSelect),
      el('label', { class: 'binding gesture row' }, el('span', { class: 'action', text: 'Mirror my own picture while presenting' }), this._mirrorToggle),
      el('label', { class: 'binding gesture row' }, el('span', { class: 'action', text: 'Hide the camera picture while the mouse is over it, to show what it covers (a recording keeps it hidden then too)' }), this._hoverCameraToggle),
      el('label', { class: 'binding gesture row' }, el('span', { class: 'action', text: 'Ask for the screen when a recording starts, so that a share is held from the start' }), this._screenAskToggle),
      el('label', { class: 'binding gesture row' }, el('span', { class: 'action', text: "Record the computer's sound with the screen share, in a track of its own, when the browser offers it (a whole screen or a tab, with the box ticked in the share dialog)" }), this._systemAudioToggle),
      el('label', { class: 'binding gesture row' }, el('span', { class: 'action', text: 'Render the talk as an MP4 video when a recording stops, off the clock, where the server has ffmpeg (the desktop app does it in the background; a browser offers a button, since it opens a tab for it)' }), this._renderToggle),
      el('div', { class: 'binding gesture' }, el('span', { class: 'action', text: 'Size of rendered and exported videos' }), this._renderSizeSelect),
      el('div', { class: 'binding gesture' }, el('span', { class: 'action', text: 'Proportions of rendered and exported videos' }), this._renderAspectSelect),
    );
    const resetRecording = el('button', { text: 'Restore the default recording settings' });
    resetRecording.addEventListener('click', () => {
      this._settings.recording = { ...DEFAULT_RECORDING };
      saveSettings(this._settings);
      this._syncSettingsForm();
      this._layoutCamera();
    });
    this._recordingStatus = el('p', { class: 'note' });

    // Tablet: pairing through the preview server.
    this._pairingStatus = el('p', { class: 'note' });
    this._padList = el('div', { class: 'bindings pads', hidden: '' });
    this._pairingPanel = el('div', { class: 'pairing' });
    const pairButton = el('button', { text: 'Show the pairing code' });
    pairButton.addEventListener('click', () => void this._showPairing());
    this._padNotesToggle = el('input', { type: 'checkbox' });
    this._padNotesToggle.addEventListener('change', () => {
      this._settings.pads.notes = this._padNotesToggle.checked;
      saveSettings(this._settings);
      this._sendState();
    });
    const padNotesRow = el('p', { class: 'note' }, el('label', {}, this._padNotesToggle, ' Show the presenter notes (::: notes blocks of the deck) on the tablet, under the picture'));

    const categories: Array<[string, string, HTMLElement]> = [
      ['pointer', 'Pointer', el('section', { role: 'tabpanel', id: 'zd-settings-pointer' },
        el('h3', { text: 'Pointer' }),
        el('p', { class: 'note', text: 'Each gesture is the mouse used with the chosen keys held. Scrolling while the spotlight or laser is shown resizes it. The pen colors are in the bar at the bottom, where the color in use is pressed while drawing is on; the tip size is under Pen below. Strokes belong to the slide they were drawn on and clear when you move to another slide; the whiteboard keeps its own.' }),
        gestures,
        resetPointer,
      )],
      ['pen', 'Pen', el('section', { role: 'tabpanel', id: 'zd-settings-pen' },
        el('h3', { text: 'Pen' }),
        el('p', { class: 'note', text: 'A pen or stylus with a pressure sensor (Apple Pencil, Wacom) shapes the line as you press; the sliders tune how. Changes also redraw the strokes already on screen.' }),
        penRows,
        resetPen,
      )],
      ['recording', 'Recording', el('section', { class: 'recording', role: 'tabpanel', id: 'zd-settings-recording' },
        el('h3', { text: 'Recording' }),
        el('p', { class: 'note', text: 'Record (R, or the button in the bar) keeps your voice, the camera while it is on (the Camera button or C), and everything you do on the deck: stops, ink, the whiteboard, the pointer and the camera switches. The slides are not filmed; a recording replays on the deck itself and exports as a video. Pause leaves a gap out.' }),
        this._recordingStatus,
        // Finding the devices comes first: the lists below are empty until they are detected.
        el('div', { class: 'row' }, detect, this._testButton),
        this._testPanel,
        recordingRows,
        el('div', { class: 'row' }, resetRecording),
      )],
      ['tablet', 'Tablet', el('section', { class: 'tablet', role: 'tabpanel', id: 'zd-settings-tablet' },
        el('h3', { text: 'Tablet' }),
        el('p', { class: 'note', text: 'A tablet on the same network can show this deck and draw on it: open the code or address below on the tablet. It follows the presentation and cannot move it; strokes drawn on either device appear on both. The code admits a tablet for this session; a tablet you trust (from the prompt on the deck, or here) comes back on its own, without the code. Pairing needs the preview server started with --host (zoomdeck serve --host, or npm run dev -- --host); the desktop app listens on the network by itself.' }),
        this._pairingStatus,
        this._padList,
        pairButton,
        this._pairingPanel,
        padNotesRow,
      )],
      ['keyboard', 'Keyboard', el('section', { role: 'tabpanel', id: 'zd-settings-keyboard' },
        el('h3', { text: 'Keyboard' }),
        el('p', { class: 'note', text: 'Click a key to remove it, or “Add key” and press the new combination (Esc cancels); a key already used in the same group moves to the new action. Settings are kept in this browser.' }),
        this._bindingsTable,
        resetKeys,
      )],
      ['advanced', 'Advanced', el('section', { role: 'tabpanel', id: 'zd-settings-advanced' },
        el('h3', { text: 'Advanced' }),
        el('div', { class: 'bindings' },
          el('div', { class: 'binding gesture' }, el('span', { class: 'action', text: 'Playback speed of the animations' }), this._speed),
          el('label', { class: 'binding gesture row' }, el('span', { class: 'action', text: 'Antialiasing: smoother edges on shapes and lines (the costliest option on Firefox)' }), this._antialiasToggle),
          el('div', { class: 'binding gesture' }, el('span', { class: 'action', text: 'Render resolution' }), this._resolutionSelect),
        ),
        this._renderingNote,
        el('label', { class: 'row' }, this._reverseToggle, ' Going to the previous stop plays the current stop backwards (off: jump straight to it)'),
      )],
    ];
    // The categories as a list on the left, one pane at a time; arrows move along the list, as in a tab list.
    const list = el('nav', { class: 'categories', role: 'tablist', 'aria-label': 'Settings categories' });
    this._settingsCategories = categories.map(([id, label, pane]) => {
      const tab = el('button', { role: 'tab', text: label, 'aria-controls': pane.id, 'aria-selected': 'false' });
      tab.addEventListener('click', () => this._showSettingsCategory(id));
      list.append(tab);
      return { id, tab, pane };
    });
    list.addEventListener('keydown', (event) => {
      const ids = this._settingsCategories.map((category) => category.id);
      const current = ids.indexOf(this._settingsCategories.find((category) => category.tab.getAttribute('aria-selected') === 'true')?.id ?? ids[0]);
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = this._settingsCategories[(current + step + ids.length) % ids.length];
      this._showSettingsCategory(next.id);
      next.tab.focus();
    });
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem('zoomdeck:settings-category');
    } catch {
      /* storage unavailable */
    }
    dialog.append(
      el('header', {}, el('h2', { text: 'Settings' }), close),
      el('div', { class: 'layout' }, list, el('div', { class: 'panes' }, ...categories.map(([, , pane]) => pane))),
      el('div', { class: 'actions' }, done),
    );
    this._showSettingsCategory(remembered ?? 'pointer');
    dialog.addEventListener('close', () => {
      this._capturing = null;
      this._stopDeviceTest();
    });
    return dialog;
  }

  private _micSelect!: HTMLSelectElement;
  private _cameraSelect!: HTMLSelectElement;
  private _mirrorToggle!: HTMLInputElement;
  private _padNotesToggle!: HTMLInputElement;
  private _screenAskToggle!: HTMLInputElement;
  private _systemAudioToggle!: HTMLInputElement;
  private _hoverCameraToggle!: HTMLInputElement;
  private _antialiasToggle!: HTMLInputElement;
  private _resolutionSelect!: HTMLSelectElement;
  private _renderingNote!: HTMLElement;
  /** The rendering settings the page was loaded with; a difference shows the reload note. */
  private _renderingAtLoad = '';

  private _renderingChanged(): void {
    this._renderingNote.hidden = JSON.stringify(this._settings.rendering) === this._renderingAtLoad;
  }
  private _cornerSelect!: HTMLSelectElement;
  private _pipSizeSelect!: HTMLSelectElement;
  private _recordingStatus!: HTMLElement;

  /** Fill the device lists from what the browser reports (labels appear once a device was used or detected). */
  private _fillDeviceSelects(devices: MediaDeviceInfo[]): void {
    const { microphone, camera } = this._settings.recording;
    const fill = (select: HTMLSelectElement, kind: MediaDeviceKind, chosen: string | null, none: string | null) => {
      select.replaceChildren(el('option', { value: '', text: 'Default' }));
      if (none) select.append(el('option', { value: 'none', text: none }));
      let index = 0;
      for (const device of devices) {
        if (device.kind !== kind || !device.deviceId) continue;
        index += 1;
        select.append(el('option', { value: device.deviceId, text: device.label || `${kind === 'videoinput' ? 'Camera' : 'Microphone'} ${index}` }));
      }
      if (chosen && ![...select.options].some((option) => option.value === chosen)) select.append(el('option', { value: chosen, text: 'Chosen earlier (not found now)' }));
      select.value = chosen ?? '';
    };
    fill(this._micSelect, 'audioinput', microphone, null);
    fill(this._cameraSelect, 'videoinput', camera, 'None');
  }

  /** Ask for the devices once (the browser prompts), then list them by name. */
  private async _detectDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      this._recordingStatus.textContent = 'This browser gives no access to microphones or cameras here (a secure context is needed).';
      return;
    }
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
      for (const track of probe.getTracks()) track.stop();
    } catch (error) {
      this._recordingStatus.textContent = `No device: ${(error as Error).message}`;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    this._fillDeviceSelects(devices);
    const mics = devices.filter((device) => device.kind === 'audioinput').length;
    const cameras = devices.filter((device) => device.kind === 'videoinput').length;
    this._recordingStatus.textContent = `${mics} microphone${mics === 1 ? '' : 's'}, ${cameras} camera${cameras === 1 ? '' : 's'}.`;
  }

  // Testing the devices: the chosen camera's picture, the microphone's level, and a short sample to hear.
  private _testButton!: HTMLButtonElement;
  private _testPanel!: HTMLElement;
  private _testVideo!: HTMLVideoElement;
  private _testLevel!: HTMLElement;
  private _testStatus!: HTMLElement;
  private _listenButton!: HTMLButtonElement;
  private _testStream: MediaStream | null = null;
  private _meter: { context: AudioContext; frame: number } | null = null;
  private _sampleAudio: HTMLAudioElement | null = null;

  /** The microphone and camera the settings choose, as capture constraints. */
  private _captureConstraints(): { audio: MediaTrackConstraints | true; video: MediaTrackConstraints | false } {
    const choice = this._settings.recording;
    const video = choice.camera === 'none' ? false : { ...(choice.camera ? { deviceId: { exact: choice.camera } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } };
    const audio = choice.microphone ? { deviceId: { exact: choice.microphone } } : true;
    return { audio, video };
  }

  /** Open the chosen devices as a recording does; when the camera fails, the sound alone, with the camera's error. */
  private async _openDevices(): Promise<{ stream: MediaStream; cameraError: string | null }> {
    const { audio, video } = this._captureConstraints();
    try {
      return { stream: await navigator.mediaDevices.getUserMedia({ audio, video }), cameraError: null };
    } catch (error) {
      if (!video) throw error;
      return { stream: await navigator.mediaDevices.getUserMedia({ audio }), cameraError: (error as Error).message };
    }
  }

  private async _toggleDeviceTest(): Promise<void> {
    if (this._testStream) this._stopDeviceTest();
    else await this._startDeviceTest();
  }

  /** Open the chosen devices and show what they capture: the camera picture and a bar following the sound level. */
  private async _startDeviceTest(): Promise<void> {
    this._stopDeviceTest();
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      this._recordingStatus.textContent = 'This browser gives no access to microphones or cameras here (a secure context is needed).';
      return;
    }
    this._testButton.disabled = true;
    this._testPanel.hidden = false;
    this._testStatus.textContent = 'Opening the devices…';
    let opened: { stream: MediaStream; cameraError: string | null };
    try {
      opened = await this._openDevices();
    } catch (error) {
      this._testStatus.textContent = `No device: ${(error as Error).message}`;
      this._testButton.disabled = false;
      return;
    }
    const stream = opened.stream;
    this._testStream = stream;
    this._testButton.disabled = false;
    this._testButton.textContent = 'Stop the test';
    const video = stream.getVideoTracks()[0] ?? null;
    const audio = stream.getAudioTracks()[0] ?? null;
    this._testVideo.hidden = !video;
    this._testVideo.classList.toggle('mirror', this._settings.recording.mirror);
    if (video) {
      this._testVideo.srcObject = new MediaStream([video]);
      void this._testVideo.play().catch(() => undefined);
    }
    if (audio) this._startMeter(new MediaStream([audio]));
    this._listenButton.disabled = !audio || typeof MediaRecorder === 'undefined';
    const parts = [
      video ? `Camera: ${video.label || 'unnamed'}.` : opened.cameraError ? `No camera (${opened.cameraError}).` : 'No camera.',
      audio ? `Microphone: ${audio.label || 'unnamed'}. Speak: the bar follows the sound level.` : 'No microphone.',
    ];
    this._testStatus.textContent = parts.join(' ');
    // A device that is unplugged, or taken by another application, ends its track.
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => {
        if (this._testStream === stream) this._stopDeviceTest('A device stopped; test again to see the others.');
      });
    }
  }

  /** Release the devices under test; `status` is left in the panel, which otherwise folds away. */
  private _stopDeviceTest(status = ''): void {
    const stream = this._testStream;
    this._testStream = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    this._stopMeter();
    this._sampleAudio?.pause();
    this._sampleAudio = null;
    this._testVideo.srcObject = null;
    this._testVideo.hidden = true;
    this._testButton.textContent = 'Test the devices';
    this._testButton.disabled = false;
    this._listenButton.disabled = true;
    this._testStatus.textContent = status;
    this._testPanel.hidden = !status;
  }

  /** Drive the level bar from the sound: full at −6 dBFS, empty at −60 dBFS. */
  private _startMeter(stream: MediaStream): void {
    const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const meter = { context, frame: 0 };
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += value * value;
      const rms = Math.sqrt(sum / samples.length);
      const level = Math.min(1, Math.max(0, (20 * Math.log10(rms || 1e-6) + 60) / 54));
      this._testLevel.style.width = `${(level * 100).toFixed(1)}%`;
      this._testLevel.classList.toggle('loud', level > 0.92);
      meter.frame = requestAnimationFrame(tick);
    };
    meter.frame = requestAnimationFrame(tick);
    this._meter = meter;
    void context.resume();
  }

  private _stopMeter(): void {
    const meter = this._meter;
    this._meter = null;
    if (!meter) return;
    cancelAnimationFrame(meter.frame);
    void meter.context.close().catch(() => undefined);
    this._testLevel.style.width = '0';
    this._testLevel.classList.remove('loud');
  }

  /** Record three seconds from the microphone under test and play them back, to hear what a recording would keep. */
  private async _listenToSample(): Promise<void> {
    const stream = this._testStream;
    const audio = stream?.getAudioTracks()[0];
    if (!stream || !audio || typeof MediaRecorder === 'undefined') return;
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    this._listenButton.disabled = true;
    const chunks: Blob[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(new MediaStream([audio]), type ? { mimeType: type } : undefined);
    } catch (error) {
      this._testStatus.textContent = `The sample could not be recorded: ${(error as Error).message}`;
      return;
    }
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
    recorder.start();
    for (let left = 3; left > 0; left -= 1) {
      this._testStatus.textContent = `Recording a sample, speak… ${left}`;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (this._testStream !== stream) break;
    }
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    if (this._testStream !== stream) return;
    const sample = new Audio(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' })));
    this._sampleAudio = sample;
    this._testStatus.textContent = 'Playing the sample back…';
    const finish = (text: string) => {
      URL.revokeObjectURL(sample.src);
      if (this._sampleAudio !== sample) return;
      this._sampleAudio = null;
      this._testStatus.textContent = text;
      this._listenButton.disabled = false;
    };
    sample.addEventListener('ended', () => finish('The sample played; the bar follows the sound level again.'), { once: true });
    sample.addEventListener('error', () => finish('The sample could not be played back.'), { once: true });
    try {
      await sample.play();
    } catch (error) {
      finish(`The sample could not be played back: ${(error as Error).message}`);
    }
  }

  private _syncSettingsForm(): void {
    this._reverseToggle.checked = this._settings.reversePlayback ?? this._player?.reversePlayback ?? this._deck.presenter.reversePlayback;
    this._padNotesToggle.checked = this._settings.pads.notes;
    const recording = this._settings.recording;
    this._micSelect.value = recording.microphone ?? '';
    this._cameraSelect.value = recording.camera ?? '';
    this._mirrorToggle.checked = recording.mirror;
    this._screenAskToggle.checked = recording.screenOnRecord;
    this._systemAudioToggle.checked = recording.systemAudio;
    this._hoverCameraToggle.checked = recording.hideCameraOnHover;
    this._renderToggle.checked = recording.renderOnStop;
    this._renderSizeSelect.value = recording.renderHeight === null ? '' : String(recording.renderHeight);
    this._renderAspectSelect.value = recording.renderAspect;
    this._antialiasToggle.checked = this._settings.rendering.antialias;
    this._resolutionSelect.value = String(this._settings.rendering.resolution);
    this._renderingChanged();
    this._cornerSelect.value = recording.corner;
    this._pipSizeSelect.value = String(recording.size);
    this._recordingStatus.textContent = this._deck.base && recordingStoreAvailable()
      ? 'Recordings are saved in a recordings/ folder next to the deck, one zip bundle per talk (its media files and timeline), written while the talk is recorded.'
      : 'Without the preview server a recording is offered as a zip bundle to download (its media files and timeline), to put in a recordings/ folder next to the deck as it is.';
    this._pointerModeSelect.value = this._settings.pointerMode;
    for (const [action, select] of this._pointerSelects) select.value = this._settings.pointer[action] ?? 'off';
    const pen = this._settings.pen;
    this._tipSelect.value = String(this._settings.tipSize);
    this._penPreset.value = pen.preset;
    for (const [key, range] of this._penRanges) range.value = String(pen[key]);
    for (const [key, toggle] of this._penToggles) toggle.checked = pen[key];
    const connected = this._admittedPads();
    this._pairingStatus.textContent = !padLinkAvailable()
      ? 'Pairing is not available here: this deck is not served by the preview or development server.'
      : connected
        ? `${connected} tablet${connected > 1 ? 's' : ''} connected.`
        : 'No tablet connected yet.';
    this._renderPadList();
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
      this._pairingPanel.append(el('p', { class: 'note', text: 'The server listens on this computer only. Restart it with --host (zoomdeck serve --host, or npm run dev -- --host; the desktop app listens on the network unless started with --local) so the tablet can reach it, then come back here.' }));
      return;
    }
    // One code per name or address: the computer's name on the network outlives a change of
    // address; a tablet on a cable (USB sharing) reaches the computer on another link than the
    // Wi-Fi, and only the tablet knows which one it can see.
    const room = this._pad?.room ?? '';
    const code = padCode();
    const names = info.names ?? [];
    const targets = [
      ...names.map((host) => ({ host, caption: `By name: ${host} finds this computer on any network the two share, whatever its address.` })),
      ...info.addresses.map((host) => ({ host, caption: `By address: ${host}.` })),
    ].slice(0, 5);
    this._pairingPanel.append(el('p', { class: 'note', text: 'The code admits the tablet for this session. To let it come back on its own, choose "Always allow" when it asks, or Trust it in the list above: it then opens the pad page from a bookmark or its home screen, without the code.' }));
    if (info.addresses.length > 1) {
      this._pairingPanel.append(el('p', { class: 'note', text: 'This computer has several network addresses; scan the one the tablet shares (the Wi-Fi, or the USB connection when sharing over the cable).' }));
    }
    let QRCode: typeof import('qrcode') | null = null;
    try {
      QRCode = await import('qrcode');
    } catch {
      QRCode = null;
    }
    for (const { host, caption } of targets) {
      const url = padUrl(host, info.port, room, code);
      const canvas = el('canvas', { class: 'qr', 'aria-label': `Pairing code for ${host}` });
      this._pairingPanel.append(el('div', { class: 'code' }, canvas, el('div', {}, el('p', { class: 'note', text: caption }), el('p', { class: 'note url', text: url }))));
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
    // A key serves one action in its group; the same key may do something else while the whiteboard is shown or a talk plays.
    const group = ACTIONS.find((info) => info.name === action)?.group;
    for (const other of ACTIONS) {
      if (other.group === group) this._settings.bindings[other.name] = this._settings.bindings[other.name].filter((item) => item !== combo);
    }
    this._settings.bindings[action].push(combo);
    saveSettings(this._settings);
    this._renderShortcuts();
  }

  private _renderBindings(): void {
    const rows = ACTION_GROUPS.flatMap(([group, heading]) => [
      el('div', { class: 'binding-group', text: heading }),
      ...ACTIONS.filter((action) => action.group === group).map((action) => this._bindingRow(action)),
    ]);
    this._bindingsTable.replaceChildren(...rows);
  }

  private _bindingRow(action: ActionInfo): HTMLElement {
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
    // While a recording plays, the pointer has no tool: no tap advances, nothing draws, no spotlight but the recorded one.
    if (this._playback) return null;
    return pointerActionFor(this._settings, this._modifiers);
  }

  private _drawingTool(pointerType?: string): InkTool | null {
    if (!this._features.has('pen')) return null;
    const tool = this._activeTool();
    return tool === 'pen' ? (this._penReady(pointerType) ? 'pen' : null) : tool === 'pointer' ? 'highlighter' : null;
  }

  /**
   * Whether the pen gesture draws: while drawing is on (D, which the whiteboard turns on), and
   * always for a stylus, which is held to draw. The mouse otherwise only clicks.
   */
  private _penReady(pointerType?: string): boolean {
    return this._drawingOn || pointerType === 'pen';
  }

  /**
   * Turn drawing on or off: while on, a plain drag draws, the pointer is a pencil in the pen's
   * color, and links and live pages under it are inert, so that a stroke can cross them.
   */
  toggleDrawing(on = !this._drawingOn): void {
    if (this._playback || on === this._drawingOn) return;
    // The whiteboard is there to be drawn on: drawing stays on for as long as it is shown.
    if (!on && this._boardOn) {
      this.notice('Drawing stays on with the whiteboard; W hides it');
      return;
    }
    this._drawingOn = on;
    if (!on) this._finishStroke();
    this._penColor.setActive(on);
    this.stageHost.classList.toggle('drawing-on', on);
    if (on) this.stageHost.classList.remove('over-link');
    this._updatePenCursor();
    this._updateSpotlight();
    this._renderState();
  }

  /**
   * The keys 1 to 4 are the footer's color swatches (1 is the deck's own color): a color turns
   * drawing on in that color, and the color in use turns drawing off again.
   */
  pickPenColor(index: number): void {
    const entry = PEN_COLORS[index - 1];
    if (entry) this._pickColor(entry[0]);
  }

  /** A click on a swatch: the color in use while drawing is on toggles drawing off; any other turns it on in that color. */
  private _pickColor(value: string): void {
    if (this._playback) return;
    if (this._drawingOn && value === this._penColor.value) {
      this.toggleDrawing(false);
      return;
    }
    this._finishStroke();
    this._penColor.select(value);
    this._updatePenCursor();
    this.toggleDrawing(true);
  }

  /**
   * The pointer over the stage while drawing is on: a pencil in the pen's color, its tip at the
   * top left as the hot spot and its body running to the south east, edged in white and dark so
   * that it shows on any ground.
   */
  private _updatePenCursor(): void {
    const color = this._penColor.value === 'foreground' ? this._deck.foreground : this._penColor.value;
    const body = 'M4.4 15.3 16.9 2.9l4.2 4.2L8.7 19.6Z';
    const tip = 'M3 21l1.4-5.7 4.3 4.3Z';
    // Drawn with the tip at the bottom left, then flipped so that it points down.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g stroke-linejoin="round" transform="matrix(1 0 0 -1 0 24)">`
      + `<path d="${body}" fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke"/>`
      + `<path d="${tip}" fill="#f3e3c3" stroke="#fff" stroke-width="3" paint-order="stroke"/>`
      + `<path d="${body}" fill="none" stroke="#000" stroke-opacity=".7"/><path d="${tip}" fill="none" stroke="#000" stroke-opacity=".7"/>`
      + `<path d="M13.4 6.4l4.2 4.2" fill="none" stroke="#000" stroke-opacity=".35"/><path d="M3 21l.5-2 1.5 1.5Z" fill="#333"/></g></svg>`;
    this.stageHost.style.setProperty('--pen-cursor', `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 3, crosshair`);
  }

  /** Switch the tool shown by the pointer gesture between the spotlight and the laser. */
  togglePointerMode(): void {
    this._settings.pointerMode = this._settings.pointerMode === 'laser' ? 'spotlight' : 'laser';
    saveSettings(this._settings);
    this._syncSettingsForm();
    this._updateSpotlight();
    this.notice(this._settings.pointerMode === 'laser' ? 'Laser pointer' : 'Spotlight');
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
      size: (tool === 'pen' ? this._settings.tipSize : highlighterWidth) / scale,
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
    this._note({ type: 'ink', surface, op: { op: 'begin', stroke: { ...stroke, samples: [...stroke.samples] } } });
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
    if (this._recorder) this._note({ type: 'ink', surface: live.surface, op: { op: 'extend', id: live.id, samples, ...(live.pressure ? { pressure: true as const } : {}) } });
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
    this._note({ type: 'ink', surface: live.surface, op: { op: 'end', id: live.id } });
    try {
      this.stageHost.releasePointerCapture(live.pointerId);
    } catch {
      /* not captured */
    }
    this.stageHost.classList.remove('stroking');
  }

  /** Remove the dots left by the taps of a click or double-click that followed a link. */
  dropTaps(count = 2): void {
    this._finishStroke();
    const surface = this._activeSurface();
    const dropped = this._surface(surface).dropRecentTaps(count, 1500);
    for (let n = 0; n < dropped; n++) {
      this._broadcast({ type: 'ink', surface, op: 'undo' });
      this._note({ type: 'ink', surface, op: { op: 'undo' } });
    }
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
    if (x !== this._boardTarget.x || y !== this._boardTarget.y) this._note({ type: 'pan', x, y });
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
    const changed = on !== this._boardOn;
    if (changed) this._note({ type: 'board', on });
    this._boardOn = on;
    this._boardLayer.hidden = !on;
    this.stageHost.classList.toggle('board-on', on);
    this._boardButton.setAttribute('aria-pressed', String(on));
    // The whiteboard is there to be drawn on: it turns drawing on, and leaves it as it was before.
    if (changed && on) {
      this._drawingBeforeBoard = this._drawingOn;
      this.toggleDrawing(true);
    } else if (changed) {
      this.toggleDrawing(this._drawingBeforeBoard);
    }
    this._renderState();
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
    this._note({ type: 'ink', surface, op: { op: 'erase', id } });
  }

  /** Two fingers on a touch screen scroll the whiteboard; a single finger never draws, it erases. */
  private _touchMove(event: PointerEvent): void {
    const previous = this._touches.get(event.pointerId);
    if (!previous) return;
    this._touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this._playback) return;
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
    // A recording being played shows its own pointer, where the presenter had it.
    const replayed = this._playbackPointer;
    if (replayed) {
      const { bounds, scale } = this._highlightGeometry();
      this._spotlight.style.setProperty('--spot-x', `${bounds.width / 2 + replayed.x * scale}px`);
      this._spotlight.style.setProperty('--spot-y', `${bounds.height / 2 + replayed.y * scale}px`);
      this._spotlight.style.setProperty('--spot-radius', `${Math.max(8, replayed.r * scale)}px`);
      stage.classList.toggle('laser-mode', replayed.mode === 'laser');
      stage.classList.add('spotlight-active');
      stage.classList.remove('sketch-active', 'tool-held');
      return;
    }
    if (this._pointer) {
      const bounds = stage.getBoundingClientRect();
      this._spotlight.style.setProperty('--spot-x', `${this._pointer.x - bounds.left}px`);
      this._spotlight.style.setProperty('--spot-y', `${this._pointer.y - bounds.top}px`);
    }
    this._radius = Math.max(24, Math.min(this._radius, Math.max(stage.clientWidth, stage.clientHeight, 24)));
    this._spotlight.style.setProperty('--spot-radius', `${this._radius}px`);
    stage.classList.toggle('laser-mode', this._settings.pointerMode === 'laser');
    const shown = tool === 'pointer' && this._pointer !== null;
    stage.classList.toggle('spotlight-active', shown);
    this._markPointer(shown);
    stage.classList.toggle('sketch-active', tool === 'pen' && this._pointer !== null && this._penReady());
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
      // A pointer on the slides brings the keys to the deck; drawing cancels the browser's own focus change.
      if (this._embedded && !interactive(event)) stage.focus({ preventScroll: true });
      if (event.pointerType === 'touch') {
        this._touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (!interactive(event) && !this._playback) this._fingerErase(event);
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
        const at = { x: event.clientX, y: event.clientY };
        if (this._editSource) this._whenModifiersReleased(() => this._editSource?.(at));
        else this.notice('Open the deck with zoomdeck serve to jump to the editor');
        return;
      }
      const drawing = this._drawingTool(event.pointerType);
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
    document.addEventListener('pointerup', release, { signal: this._abort.signal });
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
    const signal = this._abort.signal;
    this._keys.addEventListener('keydown', ((event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (!modifierKeys.includes(event.key) || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable) return;
      this._modifiers = modifierCombo(event);
      if (this._live && this._live.tool !== this._drawingTool()) this._finishStroke();
      this._updateSpotlight();
    }) as EventListener, { signal });
    this._keys.addEventListener('keyup', ((event: KeyboardEvent) => {
      if (!modifierKeys.includes(event.key)) return;
      this._modifiers = modifierCombo(event);
      if (this._live && this._live.tool !== this._drawingTool()) this._finishStroke();
      this._updateSpotlight();
    }) as EventListener, { signal });
    stage.addEventListener('wheel', (event) => {
      if (this._playback) return;
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
    window.addEventListener('blur', () => this._releaseSpotlight(), { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this._releaseSpotlight(); }, { signal });
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
      notes: this._settings.pads.notes ? this._notesHtml(this._player.clips[this._player.index]?.notes ?? '') : '',
    });
  }

  private _notesMarkdown: MarkdownIt | null = null;

  /** The presenter's notes of a stop, Markdown rendered for the tablet; formulas stay as written. */
  private _notesHtml(markdown: string): string {
    if (!markdown.trim()) return '';
    this._notesMarkdown ??= new MarkdownIt('commonmark', { html: false, linkify: false });
    return this._notesMarkdown.render(markdown);
  }

  private _onPadMessage(message: PadMessage, from: string): void {
    switch (message.type) {
      case 'hello':
        if (message.role === 'pad') this._onPadHello(from, message.device ?? null, message.code);
        break;
      case 'bye':
        this._pads.delete(from);
        this._renderPadRequest();
        this._syncSettingsForm();
        break;
      // The tablet's strokes and board stay out of a recording being played, like the viewer's own;
      // a tablet not admitted yet is heard but not followed.
      case 'board':
        if (!this._playback && this._padAdmitted(from)) this._applyBoard(message.on, message.pan);
        break;
      case 'ink':
        if (!this._playback && this._padAdmitted(from)) this._applyInk(message.surface, message);
        break;
      case 'hover':
        if (this._padAdmitted(from)) this._showRemoteCursor(message);
        break;
      case 'state':
      case 'frame':
      case 'admit':
        break;
    }
  }

  private _padAdmitted(from: string): boolean {
    return this._pads.get(from)?.admitted ?? false;
  }

  private _admittedPads(): number {
    let count = 0;
    for (const entry of this._pads.values()) if (entry.admitted) count += 1;
    return count;
  }

  private _isTrusted(device: PadDevice | null): boolean {
    return Boolean(device) && this._settings.pads.trusted.some((known) => known.id === device!.id);
  }

  /**
   * A tablet announces itself: it is admitted when this browser trusts it or when it opened the
   * pad page with this tab's pairing code; otherwise it waits for the presenter to allow it, once
   * or for good, from a prompt on the deck or the settings.
   */
  private _onPadHello(from: string, device: PadDevice | null, code: string | undefined): void {
    const entry = this._pads.get(from) ?? { device, admitted: false, ignored: false };
    entry.device = device;
    this._pads.set(from, entry);
    const trusted = this._isTrusted(device);
    if (entry.admitted || trusted || (Boolean(code) && code === padCode())) {
      this._admitPad(from, trusted);
      return;
    }
    if (device) this._pad?.send({ type: 'admit', to: device.id, ok: false });
    this._renderPadRequest();
    this._syncSettingsForm();
  }

  private _admitPad(from: string, trusted: boolean): void {
    const entry = this._pads.get(from);
    if (!entry) return;
    entry.admitted = true;
    if (entry.device) this._pad?.send({ type: 'admit', to: entry.device.id, ok: true, trusted });
    this.notice(`${entry.device?.name ?? 'Tablet'} connected`);
    this._sendState();
    this._pad?.send({ type: 'ink', surface: 'slide', op: 'replace', strokes: this._slideInk.strokes });
    this._pad?.send({ type: 'ink', surface: 'board', op: 'replace', strokes: this._boardInk.strokes });
    this._sendFrame();
    this._renderPadRequest();
    this._syncSettingsForm();
  }

  /** Allow a tablet for good: it then opens the pad page without the code, in every deck of this browser. */
  private _trustPad(device: PadDevice): void {
    if (!this._isTrusted(device)) this._settings.pads.trusted.push({ id: device.id, name: device.name, since: new Date().toISOString() });
    saveSettings(this._settings);
    for (const entry of this._pads.values()) if (entry.device?.id === device.id && entry.admitted) this._pad?.send({ type: 'admit', to: device.id, ok: true, trusted: true });
    this._syncSettingsForm();
  }

  /** Forget a tablet: it is out at once, and asks again next time. */
  private _forgetPad(id: string): void {
    this._settings.pads.trusted = this._settings.pads.trusted.filter((known) => known.id !== id);
    saveSettings(this._settings);
    for (const entry of this._pads.values()) {
      if (entry.device?.id !== id) continue;
      entry.admitted = false;
      entry.ignored = true;
      this._pad?.send({ type: 'admit', to: id, ok: false });
    }
    this._syncSettingsForm();
  }

  /** The prompt on the deck for the first tablet waiting to be allowed, if any. */
  private _renderPadRequest(): void {
    const waiting = [...this._pads].find(([, entry]) => !entry.admitted && !entry.ignored && entry.device);
    if (!waiting) {
      this._padRequest.hidden = true;
      this._padRequest.replaceChildren();
      return;
    }
    const [from, entry] = waiting;
    const device = entry.device!;
    const once = el('button', { text: 'Allow once' });
    once.addEventListener('click', () => this._admitPad(from, false));
    const always = el('button', { class: 'primary', text: 'Always allow' });
    always.addEventListener('click', () => {
      this._trustPad(device);
      this._admitPad(from, true);
    });
    const ignore = el('button', { class: 'dismiss', text: '×', 'aria-label': 'Ignore' });
    ignore.addEventListener('click', () => {
      entry.ignored = true;
      this._renderPadRequest();
    });
    this._padRequest.replaceChildren(el('span', { text: `${device.name} asks to draw on this deck.` }), once, always, ignore);
    this._padRequest.hidden = false;
  }

  /** The Tablet section's list: the tablets connected now and those trusted. */
  private _renderPadList(): void {
    const rows: HTMLElement[] = [];
    const listed = new Set<string>();
    for (const [from, entry] of this._pads) {
      const device = entry.device;
      const name = device?.name ?? 'Tablet';
      const trusted = this._isTrusted(device);
      const state = entry.admitted ? (trusted ? 'connected, trusted' : 'connected for this session') : entry.ignored ? 'ignored' : 'waiting to be allowed';
      const row = el('div', { class: 'binding gesture pad' }, el('span', { class: 'action', text: `${name} · ${state}` }));
      if (device && trusted) {
        const forget = el('button', { text: 'Forget' });
        forget.addEventListener('click', () => this._forgetPad(device.id));
        row.append(forget);
        listed.add(device.id);
      } else if (device && entry.admitted) {
        const trust = el('button', { text: 'Trust' });
        trust.addEventListener('click', () => this._trustPad(device));
        row.append(trust);
      } else if (device) {
        const allow = el('button', { text: 'Allow' });
        allow.addEventListener('click', () => this._admitPad(from, false));
        row.append(allow);
      }
      rows.push(row);
    }
    for (const known of this._settings.pads.trusted) {
      if (listed.has(known.id)) continue;
      const since = known.since ? new Date(known.since) : null;
      const when = since && !Number.isNaN(since.getTime()) ? `, since ${since.toLocaleDateString()}` : '';
      const forget = el('button', { text: 'Forget' });
      forget.addEventListener('click', () => this._forgetPad(known.id));
      rows.push(el('div', { class: 'binding gesture pad' }, el('span', { class: 'action', text: `${known.name} · trusted${when}, not connected` }), forget));
    }
    this._padList.replaceChildren(...rows);
    this._padList.hidden = rows.length === 0;
  }

  private _applyBoard(on: boolean, pan: { x: number; y: number }): void {
    if (on !== this._boardOn) this._setBoardShown(on);
    if (pan.x !== this._boardTarget.x || pan.y !== this._boardTarget.y) this._setBoardPan(pan.x, pan.y, true);
  }

  private _applyInk(surface: InkSurfaceName, op: InkOp): void {
    const target = this._surface(surface);
    if (this._recorder) this._note({ type: 'ink', surface, op: op.op === 'begin' ? { ...op, stroke: { ...op.stroke, samples: [...op.stroke.samples] } } : op });
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
    if (!this._pad || this._admittedPads() === 0) return;
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
