/**
 * Player settings: editable key bindings and playback preferences, kept in
 * `localStorage` so they follow the viewer from deck to deck.
 */

export type ActionName =
  | 'next' | 'previous' | 'home' | 'replay' | 'fullscreen' | 'outline' | 'undo' | 'redo' | 'clear' | 'settings' | 'exit';

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
  fullscreen: ['f'],
  exit: ['Escape'],
  outline: ['o'],
  settings: [','],
};

export interface PlayerSettings {
  bindings: Record<ActionName, string[]>;
  /** null keeps the deck's own setting. */
  reversePlayback: boolean | null;
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

export function defaultSettings(): PlayerSettings {
  return { bindings: Object.fromEntries(Object.entries(DEFAULT_BINDINGS).map(([k, v]) => [k, [...v]])) as PlayerSettings['bindings'], reversePlayback: null };
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
    if (typeof saved?.reversePlayback === 'boolean') settings.reversePlayback = saved.reversePlayback;
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
