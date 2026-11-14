/**
 * Player settings: editable key bindings and playback preferences, kept in
 * `localStorage` so they follow the viewer from deck to deck.
 */

import { DEFAULT_PEN_STYLE, sanitizePenStyle, type PenStyle } from './ink';
import type { Corner } from './timeline';

/** How a talk is recorded: which devices, and where the camera picture sits. */
export interface RecordingSettings {
  /** Microphone device id; null for the browser's default. */
  microphone: string | null;
  /** Camera device id; null for the default camera, 'none' for no camera at all. */
  camera: string | null;
  /** Flip the camera picture as a mirror does (for the presenter's own view and the recording). */
  mirror: boolean;
  /** Corner of the camera picture when the slides are shown. */
  corner: Corner;
  /** Width of the camera picture as a share of the frame width. */
  size: number;
  /** Film the screen whenever the page is hidden during a recording (the presenter went to another application). */
  screenWhenHidden: boolean;
  /** The kind of surface shared last time (a whole screen, a window or a tab), which the browser's picker opens on. */
  screenSurface: 'monitor' | 'window' | 'browser';
}

export const SCREEN_SURFACES = ['monitor', 'window', 'browser'] as const;

export const CORNERS: Corner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
export const PIP_SIZES: Array<[number, string]> = [[0.12, 'Small'], [0.18, 'Medium'], [0.25, 'Large']];

export const DEFAULT_RECORDING: RecordingSettings = { microphone: null, camera: null, mirror: true, corner: 'bottom-right', size: 0.18, screenWhenHidden: false, screenSurface: 'monitor' };

export function sanitizeRecording(value: unknown): RecordingSettings {
  const result = { ...DEFAULT_RECORDING };
  if (!value || typeof value !== 'object') return result;
  const saved = value as Partial<Record<keyof RecordingSettings, unknown>>;
  if (typeof saved.microphone === 'string' || saved.microphone === null) result.microphone = saved.microphone as string | null;
  if (typeof saved.camera === 'string' || saved.camera === null) result.camera = saved.camera as string | null;
  if (typeof saved.mirror === 'boolean') result.mirror = saved.mirror;
  if (typeof saved.corner === 'string' && CORNERS.includes(saved.corner as Corner)) result.corner = saved.corner as Corner;
  if (typeof saved.size === 'number' && PIP_SIZES.some(([size]) => size === saved.size)) result.size = saved.size;
  if (typeof saved.screenWhenHidden === 'boolean') result.screenWhenHidden = saved.screenWhenHidden;
  if (typeof saved.screenSurface === 'string' && (SCREEN_SURFACES as readonly string[]).includes(saved.screenSurface)) result.screenSurface = saved.screenSurface as RecordingSettings['screenSurface'];
  return result;
}

export type ActionName =
  | 'next' | 'previous' | 'home' | 'replay' | 'fullscreen' | 'outline' | 'undo' | 'redo' | 'clear' | 'settings' | 'exit' | 'pointer' | 'whiteboard'
  | 'edit' | 'camera' | 'screen' | 'record' | 'print' | 'draw'
  | 'color1' | 'color2' | 'color3' | 'color4'
  | 'boardLeft' | 'boardRight' | 'boardUp' | 'boardDown'
  | 'playPause' | 'seekBack' | 'seekForward' | 'playStart' | 'closePlayback';

/**
 * When an action's keys are listened to: `deck` while presenting; `board` while the whiteboard
 * is shown, before the deck's; `playback` while a recorded talk plays, when the deck's keys are
 * off (fullscreen apart). A key can serve one action in each.
 */
export type ActionGroup = 'deck' | 'board' | 'playback';

export const ACTION_GROUPS: ReadonlyArray<readonly [ActionGroup, string]> = [
  ['deck', 'While presenting'],
  ['board', 'While the whiteboard is shown, before the keys above'],
  ['playback', 'While a recorded talk plays, when only these and fullscreen work'],
];

export interface ActionInfo {
  name: ActionName;
  label: string;
  group: ActionGroup;
}

/** Actions in the order the settings dialog lists them. */
export const ACTIONS: ActionInfo[] = [
  { name: 'next', label: 'Next stop', group: 'deck' },
  { name: 'previous', label: 'Previous stop', group: 'deck' },
  { name: 'home', label: 'First stop', group: 'deck' },
  { name: 'replay', label: 'Replay this stop (play it again)', group: 'deck' },
  { name: 'undo', label: 'Undo the last pen or highlighter stroke', group: 'deck' },
  { name: 'redo', label: 'Redo a stroke', group: 'deck' },
  { name: 'clear', label: 'Clear all strokes on this slide', group: 'deck' },
  { name: 'draw', label: 'Drawing on or off: while on, a plain drag draws, the pointer is a pencil in the pen\'s color and links are inert', group: 'deck' },
  { name: 'color1', label: 'Pen color 1, Default (the deck\'s text color): drawing on in it, or off when it is the color in use', group: 'deck' },
  { name: 'color2', label: 'Pen color 2, Red: drawing on in it, or off when it is the color in use', group: 'deck' },
  { name: 'color3', label: 'Pen color 3, Blue: drawing on in it, or off when it is the color in use', group: 'deck' },
  { name: 'color4', label: 'Pen color 4, Green: drawing on in it, or off when it is the color in use', group: 'deck' },
  { name: 'pointer', label: 'Switch between spotlight and laser', group: 'deck' },
  { name: 'whiteboard', label: 'Show or hide the whiteboard', group: 'deck' },
  { name: 'camera', label: 'Camera: in a corner, then full frame, then off', group: 'deck' },
  { name: 'screen', label: 'Film the screen for the time spent in another application, or stop; the browser asks which screen the first time', group: 'deck' },
  { name: 'record', label: 'Record the talk (a new one, or continuing a saved one), or stop recording', group: 'deck' },
  { name: 'edit', label: 'Open the source of this stop in the editor (preview server)', group: 'deck' },
  { name: 'print', label: 'Print the deck to a PDF', group: 'deck' },
  { name: 'fullscreen', label: 'Toggle fullscreen', group: 'deck' },
  { name: 'exit', label: 'Leave fullscreen', group: 'deck' },
  { name: 'outline', label: 'Toggle the slide outline', group: 'deck' },
  { name: 'settings', label: 'Open settings', group: 'deck' },
  { name: 'boardLeft', label: 'Scroll the whiteboard left', group: 'board' },
  { name: 'boardRight', label: 'Scroll the whiteboard right', group: 'board' },
  { name: 'boardUp', label: 'Scroll the whiteboard up', group: 'board' },
  { name: 'boardDown', label: 'Scroll the whiteboard down', group: 'board' },
  { name: 'playPause', label: 'Play or pause', group: 'playback' },
  { name: 'seekBack', label: 'Back five seconds', group: 'playback' },
  { name: 'seekForward', label: 'Forward five seconds', group: 'playback' },
  { name: 'playStart', label: 'Back to the start', group: 'playback' },
  { name: 'closePlayback', label: 'Leave the playback', group: 'playback' },
];

export const DEFAULT_BINDINGS: Record<ActionName, string[]> = {
  next: ['ArrowRight', 'Space'],
  previous: ['ArrowLeft'],
  home: ['Home'],
  replay: ['a'],
  undo: ['Meta+z', 'Control+z'],
  redo: ['Meta+Shift+z', 'Control+Shift+z', 'Control+y'],
  clear: ['Delete', 'Backspace'],
  draw: ['d'],
  color1: ['1'],
  color2: ['2'],
  color3: ['3'],
  color4: ['4'],
  boardLeft: ['ArrowLeft'],
  boardRight: ['ArrowRight'],
  boardUp: ['ArrowUp'],
  boardDown: ['ArrowDown'],
  playPause: ['Space', 'k'],
  seekBack: ['ArrowLeft'],
  seekForward: ['ArrowRight'],
  playStart: ['Home'],
  closePlayback: ['Escape'],
  pointer: ['l'],
  whiteboard: ['w'],
  camera: ['c'],
  screen: ['s'],
  record: ['r'],
  edit: ['e'],
  print: ['p', 'Meta+p', 'Control+p'],
  fullscreen: ['f'],
  exit: ['Escape'],
  outline: ['o'],
  settings: [','],
};

/** Mouse gestures on the stage: which modifier keys, held while clicking or dragging, select each tool. */
export type PointerAction = 'pen' | 'pointer' | 'advance' | 'edit';

export interface PointerActionInfo {
  name: PointerAction;
  label: string;
}

export const POINTER_ACTIONS: PointerActionInfo[] = [
  { name: 'pen', label: 'Pen: drag to draw' },
  { name: 'pointer', label: 'Spotlight or laser while held; drag to highlight' },
  { name: 'advance', label: 'Click: next stop (off unless you bind a key)' },
  { name: 'edit', label: 'Click: open the source of the element in the editor (preview server)' },
];

/** Modifier combinations a pointer action can be bound to; `''` is a plain click or drag. */
/**
 * Defaults of earlier versions that changed since: settings saved with exactly these keys were
 * never customized, so they follow the new defaults instead of pinning the old ones.
 */
const FORMER_BINDINGS: Array<Partial<Record<ActionName, string[]>>> = [
  { replay: ['r'], record: ['Shift+r'] },
  { print: ['Shift+p', 'Meta+p', 'Control+p'] },
];

/** How the stage renders; read when the page loads, since the WebGL context is created once. */
export interface RenderingSettings {
  /** Multisampled edges on shapes and lines; the costliest option on Firefox. */
  antialias: boolean;
  /** Device pixels per CSS pixel: 'auto' follows the screen (up to 2), 1 and 2 force it (2 supersamples a low-resolution screen). */
  resolution: 'auto' | 1 | 2;
}

export const DEFAULT_RENDERING: RenderingSettings = { antialias: true, resolution: 'auto' };

export function sanitizeRendering(value: unknown): RenderingSettings {
  const result = { ...DEFAULT_RENDERING };
  if (!value || typeof value !== 'object') return result;
  const saved = value as Partial<Record<keyof RenderingSettings, unknown>>;
  if (typeof saved.antialias === 'boolean') result.antialias = saved.antialias;
  if (saved.resolution === 'auto' || saved.resolution === 1 || saved.resolution === 2) result.resolution = saved.resolution;
  return result;
}

/** The pixel ratio the stage should render at for a rendering setting, on this screen. */
export function renderPixelRatio(rendering: RenderingSettings): number {
  if (rendering.resolution !== 'auto') return rendering.resolution;
  return typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
}

export const MODIFIER_COMBOS = ['', 'Shift', 'Control', 'Alt', 'Meta', 'Shift+Control', 'Shift+Alt', 'Control+Alt'];

/** Modifier combination of each pointer action; null leaves the action without a gesture. */
export type PointerBindings = Record<PointerAction, string | null>;

/** Click-to-advance has no gesture by default: a click on a slide draws, and only the keys move between stops. */
export const DEFAULT_POINTER_BINDINGS: PointerBindings = { pen: '', pointer: 'Shift', advance: null, edit: 'Alt' };

export type PointerMode = 'spotlight' | 'laser';

/** A tablet allowed to draw on the decks of this browser without the pairing code. */
export interface TrustedPad {
  id: string;
  name: string;
  /** When it was allowed, as an ISO date. */
  since: string;
}

export interface PadSettings {
  trusted: TrustedPad[];
}

export function sanitizePads(value: unknown): PadSettings {
  const result: PadSettings = { trusted: [] };
  if (!value || typeof value !== 'object') return result;
  const saved = value as { trusted?: unknown };
  if (!Array.isArray(saved.trusted)) return result;
  for (const item of saved.trusted as Array<Partial<TrustedPad>>) {
    if (!item || typeof item.id !== 'string' || !item.id || result.trusted.some((known) => known.id === item.id)) continue;
    result.trusted.push({ id: item.id, name: typeof item.name === 'string' && item.name ? item.name : 'Tablet', since: typeof item.since === 'string' ? item.since : '' });
  }
  return result;
}

/** The pen tip sizes offered, in screen pixels. */
export const TIP_SIZES: readonly number[] = [1, 3, 6, 10];
export const DEFAULT_TIP_SIZE = 3;

export interface PlayerSettings {
  bindings: Record<ActionName, string[]>;
  pointer: PointerBindings;
  /** The tool shown while the pointer gesture is held. */
  pointerMode: PointerMode;
  /** null keeps the deck's own setting. */
  reversePlayback: boolean | null;
  /** How pressure and motion shape pen strokes. */
  pen: PenStyle;
  /** The width of a pen stroke at medium pressure, in screen pixels: one of TIP_SIZES. */
  tipSize: number;
  /** Antialiasing and pixel ratio of the stage. */
  rendering: RenderingSettings;
  /** Devices and camera layout of a recording. */
  recording: RecordingSettings;
  /** The tablets allowed to draw without the pairing code. */
  pads: PadSettings;
}

const STORAGE_KEY = 'zoomdeck:settings';
const MODIFIERS = ['Control', 'Alt', 'Meta', 'Shift'];

/** Normalize a key event to a binding string such as `Meta+Shift+z` or `ArrowRight`. */
export function keyCombo(event: KeyboardEvent): string | null {
  if (MODIFIERS.includes(event.key)) return null;
  let key = event.key === ' ' ? 'Space' : event.key;
  // With Alt held, macOS types another character (Alt with S gives ß): the physical key names the letter or digit.
  if (event.altKey && /^(?:Key[A-Z]|Digit[0-9])$/.test(event.code)) key = event.code.replace(/^Key|^Digit/, '');
  if (key.length === 1) key = key.toLowerCase();
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.metaKey) parts.push('Meta');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const PRETTY: Record<string, string> = {
  Control: IS_MAC ? '⌃' : 'Ctrl', Alt: IS_MAC ? '⌥' : 'Alt', Meta: IS_MAC ? '⌘' : 'Win', Shift: IS_MAC ? '⇧' : 'Shift',
  ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Escape: 'Esc', Backspace: '⌫', Delete: 'Del',
};

/** Human-readable form of a binding. */
export function describeCombo(combo: string): string {
  return combo.split('+').map((part) => PRETTY[part] ?? (part.length === 1 ? part.toUpperCase() : part)).join(IS_MAC ? '' : '+');
}

/** The modifier combination held during a pointer event, in the order of `MODIFIER_COMBOS`. */
export function modifierCombo(event: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): string {
  const parts: string[] = [];
  if (event.shiftKey) parts.push('Shift');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.metaKey) parts.push('Meta');
  return parts.join('+');
}

/** Human-readable form of a pointer binding. */
export function describeModifiers(combo: string | null): string {
  if (combo === null) return 'Off';
  if (combo === '') return 'Plain (no key)';
  return combo.split('+').map((part) => PRETTY[part] ?? part).join(IS_MAC ? '' : '+');
}

/** The pointer action bound to a modifier combination, if any. */
export function pointerActionFor(settings: PlayerSettings, combo: string): PointerAction | null {
  for (const action of POINTER_ACTIONS) if (settings.pointer[action.name] === combo) return action.name;
  return null;
}

export function defaultSettings(): PlayerSettings {
  return {
    bindings: Object.fromEntries(Object.entries(DEFAULT_BINDINGS).map(([k, v]) => [k, [...v]])) as PlayerSettings['bindings'],
    rendering: { ...DEFAULT_RENDERING },
    pointer: { ...DEFAULT_POINTER_BINDINGS },
    pointerMode: 'spotlight',
    reversePlayback: null,
    pen: { ...DEFAULT_PEN_STYLE },
    tipSize: DEFAULT_TIP_SIZE,
    recording: { ...DEFAULT_RECORDING },
    pads: { trusted: [] },
  };
}

export function loadSettings(): PlayerSettings {
  const settings = defaultSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<PlayerSettings> | null;
    if (saved?.bindings) {
      for (const action of ACTIONS) {
        const list = saved.bindings[action.name];
        if (Array.isArray(list)) settings.bindings[action.name] = list.filter((item) => typeof item === 'string');
      }
      for (const former of FORMER_BINDINGS) {
        const untouched = Object.entries(former).every(([name, keys]) => JSON.stringify(settings.bindings[name as ActionName]) === JSON.stringify(keys));
        if (untouched) for (const name of Object.keys(former) as ActionName[]) settings.bindings[name] = [...DEFAULT_BINDINGS[name]];
      }
    }
    if (saved?.pointer) {
      for (const action of POINTER_ACTIONS) {
        const combo = saved.pointer[action.name];
        if (combo === null || (typeof combo === 'string' && MODIFIER_COMBOS.includes(combo))) settings.pointer[action.name] = combo;
      }
    }
    if (saved?.pointerMode === 'spotlight' || saved?.pointerMode === 'laser') settings.pointerMode = saved.pointerMode;
    if (typeof saved?.reversePlayback === 'boolean') settings.reversePlayback = saved.reversePlayback;
    if (saved?.pen) settings.pen = sanitizePenStyle(saved.pen);
    if (typeof saved?.tipSize === 'number' && TIP_SIZES.includes(saved.tipSize)) settings.tipSize = saved.tipSize;
    if (saved?.recording) settings.recording = sanitizeRecording(saved.recording);
    if (saved?.pads) settings.pads = sanitizePads(saved.pads);
    if (saved?.rendering) settings.rendering = sanitizeRendering(saved.rendering);
  } catch {
    /* no storage or corrupt data: defaults */
  }
  return settings;
}

export function saveSettings(settings: PlayerSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

/** The action bound to a combo among the given groups, the first group taking precedence, if any. */
export function actionFor(settings: PlayerSettings, combo: string, groups: readonly ActionGroup[] = ['deck']): ActionName | null {
  for (const group of groups) {
    for (const action of ACTIONS) if (action.group === group && settings.bindings[action.name].includes(combo)) return action.name;
  }
  return null;
}
