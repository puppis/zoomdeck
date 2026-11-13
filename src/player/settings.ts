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
}

export const CORNERS: Corner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
export const PIP_SIZES: Array<[number, string]> = [[0.12, 'Small'], [0.18, 'Medium'], [0.25, 'Large']];

export const DEFAULT_RECORDING: RecordingSettings = { microphone: null, camera: null, mirror: true, corner: 'bottom-right', size: 0.18 };

export function sanitizeRecording(value: unknown): RecordingSettings {
  const result = { ...DEFAULT_RECORDING };
  if (!value || typeof value !== 'object') return result;
  const saved = value as Partial<Record<keyof RecordingSettings, unknown>>;
  if (typeof saved.microphone === 'string' || saved.microphone === null) result.microphone = saved.microphone as string | null;
  if (typeof saved.camera === 'string' || saved.camera === null) result.camera = saved.camera as string | null;
  if (typeof saved.mirror === 'boolean') result.mirror = saved.mirror;
  if (typeof saved.corner === 'string' && CORNERS.includes(saved.corner as Corner)) result.corner = saved.corner as Corner;
  if (typeof saved.size === 'number' && PIP_SIZES.some(([size]) => size === saved.size)) result.size = saved.size;
  return result;
}

export type ActionName =
  | 'next' | 'previous' | 'home' | 'replay' | 'fullscreen' | 'outline' | 'undo' | 'redo' | 'clear' | 'settings' | 'exit' | 'pointer' | 'whiteboard'
  | 'edit' | 'camera' | 'record' | 'resume' | 'print';

export interface ActionInfo {
  name: ActionName;
  label: string;
}

/** Actions in the order the settings dialog lists them. */
export const ACTIONS: ActionInfo[] = [
  { name: 'next', label: 'Next stop' },
  { name: 'previous', label: 'Previous stop' },
  { name: 'home', label: 'First stop' },
  { name: 'replay', label: 'Replay this stop' },
  { name: 'undo', label: 'Undo the last pen or highlighter stroke' },
  { name: 'redo', label: 'Redo a stroke' },
  { name: 'clear', label: 'Clear all strokes on this slide' },
  { name: 'pointer', label: 'Switch between spotlight and laser' },
  { name: 'whiteboard', label: 'Show or hide the whiteboard' },
  { name: 'camera', label: 'Camera: in a corner, then full frame, then off' },
  { name: 'record', label: 'Start or stop recording the talk' },
  { name: 'resume', label: 'Continue the latest recording where it stopped (append)' },
  { name: 'edit', label: 'Open the source of this stop in the editor (preview server)' },
  { name: 'print', label: 'Print the deck to a PDF' },
  { name: 'fullscreen', label: 'Toggle fullscreen' },
  { name: 'exit', label: 'Leave fullscreen' },
  { name: 'outline', label: 'Toggle the slide outline' },
  { name: 'settings', label: 'Open settings' },
];

export const DEFAULT_BINDINGS: Record<ActionName, string[]> = {
  next: ['ArrowRight', 'Space'],
  previous: ['ArrowLeft'],
  home: ['Home'],
  replay: ['r'],
  undo: ['Meta+z', 'Control+z'],
  redo: ['Meta+Shift+z', 'Control+Shift+z', 'Control+y'],
  clear: ['Delete', 'Backspace'],
  pointer: ['l'],
  whiteboard: ['w'],
  camera: ['c'],
  record: ['Shift+r'],
  resume: ['Shift+a'],
  edit: ['e'],
  print: ['Shift+p', 'Meta+p', 'Control+p'],
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
export const MODIFIER_COMBOS = ['', 'Shift', 'Control', 'Alt', 'Meta', 'Shift+Control', 'Shift+Alt', 'Control+Alt'];

/** Modifier combination of each pointer action; null leaves the action without a gesture. */
export type PointerBindings = Record<PointerAction, string | null>;

/** Click-to-advance has no gesture by default: a click on a slide draws, and only the keys move between stops. */
export const DEFAULT_POINTER_BINDINGS: PointerBindings = { pen: '', pointer: 'Shift', advance: null, edit: 'Alt' };

export type PointerMode = 'spotlight' | 'laser';

export interface PlayerSettings {
  bindings: Record<ActionName, string[]>;
  pointer: PointerBindings;
  /** The tool shown while the pointer gesture is held. */
  pointerMode: PointerMode;
  /** null keeps the deck's own setting. */
  reversePlayback: boolean | null;
  /** How pressure and motion shape pen strokes. */
  pen: PenStyle;
  /** Devices and camera layout of a recording. */
  recording: RecordingSettings;
}

const STORAGE_KEY = 'zoomdeck:settings';
const MODIFIERS = ['Control', 'Alt', 'Meta', 'Shift'];

/** Normalize a key event to a binding string such as `Meta+Shift+z` or `ArrowRight`. */
export function keyCombo(event: KeyboardEvent): string | null {
  if (MODIFIERS.includes(event.key)) return null;
  let key = event.key === ' ' ? 'Space' : event.key;
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
    pointer: { ...DEFAULT_POINTER_BINDINGS },
    pointerMode: 'spotlight',
    reversePlayback: null,
    pen: { ...DEFAULT_PEN_STYLE },
    recording: { ...DEFAULT_RECORDING },
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
    if (saved?.recording) settings.recording = sanitizeRecording(saved.recording);
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

/** The action bound to a combo, if any. */
export function actionFor(settings: PlayerSettings, combo: string): ActionName | null {
  for (const action of ACTIONS) if (settings.bindings[action.name].includes(combo)) return action.name;
  return null;
}
