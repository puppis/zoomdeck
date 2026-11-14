import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACTIONS, DEFAULT_POINTER_BINDINGS, DEFAULT_RENDERING, actionFor, sanitizePads, defaultSettings, describeModifiers, keyCombo, loadSettings, modifierCombo, pointerActionFor, renderPixelRatio, sanitizeRendering, saveSettings,
} from '../src/player/settings';

describe('player settings', () => {
  beforeEach(() => localStorage.clear());

  it('draws with a plain drag, shows the pointer tool on Shift and leaves click-to-advance off by default', () => {
    const settings = defaultSettings();
    expect(settings.pointer).toEqual(DEFAULT_POINTER_BINDINGS);
    expect(pointerActionFor(settings, '')).toBe('pen');
    expect(pointerActionFor(settings, 'Shift')).toBe('pointer');
    expect(pointerActionFor(settings, 'Alt')).toBe('edit');
    expect(pointerActionFor(settings, 'Shift+Alt')).toBeNull();
    expect(settings.pointer.advance).toBeNull();
    expect(pointerActionFor(settings, 'Control')).toBeNull();
    expect(settings.pointerMode).toBe('spotlight');
    expect(settings.bindings.pointer).toEqual(['l']);
  });

  it('resolves a key within the groups asked for, the first group first, so that the arrows serve the deck, the whiteboard and a playback', () => {
    const settings = defaultSettings();
    expect(actionFor(settings, 'ArrowLeft')).toBe('previous');
    expect(actionFor(settings, 'ArrowLeft', ['board', 'deck'])).toBe('boardLeft');
    expect(actionFor(settings, 'ArrowLeft', ['playback'])).toBe('seekBack');
    expect(actionFor(settings, 'Space', ['playback'])).toBe('playPause');
    expect(actionFor(settings, 'f', ['playback'])).toBeNull();
    expect(actionFor(settings, 'd', ['board', 'deck'])).toBe('draw');
    // Within a group a key serves one action.
    for (const group of ['deck', 'board', 'playback'] as const) {
      const seen = new Map<string, string>();
      for (const action of ACTIONS.filter((info) => info.group === group)) {
        for (const combo of settings.bindings[action.name]) {
          expect(seen.get(combo), `${combo} in ${group}`).toBeUndefined();
          seen.set(combo, action.name);
        }
      }
    }
  });

  it('keeps the trusted tablets, dropping corrupt entries and duplicates, and starts with none', () => {
    expect(defaultSettings().pads).toEqual({ trusted: [] });
    expect(sanitizePads(undefined)).toEqual({ trusted: [] });
    expect(sanitizePads({ trusted: 'no' })).toEqual({ trusted: [] });
    const pads = sanitizePads({ trusted: [{ id: 'a1', name: 'iPad', since: '2026-11-14T10:00:00.000Z' }, { id: 'a1', name: 'twice' }, { name: 'nameless' }, { id: 'b2' }] });
    expect(pads.trusted).toEqual([{ id: 'a1', name: 'iPad', since: '2026-11-14T10:00:00.000Z' }, { id: 'b2', name: 'Tablet', since: '' }]);
    saveSettings({ ...defaultSettings(), pads });
    expect(loadSettings().pads).toEqual(pads);
  });

  it('normalizes held modifiers in a fixed order', () => {
    expect(modifierCombo({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false })).toBe('');
    expect(modifierCombo({ shiftKey: true, ctrlKey: true, altKey: false, metaKey: false })).toBe('Shift+Control');
    expect(describeModifiers(null)).toBe('Off');
    expect(describeModifiers('')).toMatch(/Plain/);
  });

  it('keeps valid saved gestures and the pointer mode, ignoring corrupt values', () => {
    const settings = defaultSettings();
    settings.pointer = { pen: 'Control', pointer: 'Shift', advance: null, edit: 'Alt' };
    settings.pointerMode = 'laser';
    saveSettings(settings);
    const loaded = loadSettings();
    expect(loaded.pointer).toEqual({ pen: 'Control', pointer: 'Shift', advance: null, edit: 'Alt' });
    expect(loaded.pointerMode).toBe('laser');
    localStorage.setItem('zoomdeck:settings', JSON.stringify({ pointer: { pen: 'Hyper' }, pointerMode: 'torch' }));
    const fallback = loadSettings();
    expect(fallback.pointer.pen).toBe('');
    expect(fallback.pointerMode).toBe('spotlight');
  });
});

describe('key combinations', () => {
  it('names an Alt combination by the physical key, since macOS types another character with Alt held', () => {
    expect(keyCombo(new KeyboardEvent('keydown', { key: 'ß', code: 'KeyS', altKey: true }))).toBe('Alt+s');
    expect(keyCombo(new KeyboardEvent('keydown', { key: 's', code: 'KeyS' }))).toBe('s');
    expect(keyCombo(new KeyboardEvent('keydown', { key: 'S', code: 'KeyS', shiftKey: true }))).toBe('Shift+s');
  });
});

describe('key defaults that changed', () => {
  beforeEach(() => localStorage.clear());

  it('moves a saved setup with the former default keys to the new ones, and keeps customized keys', () => {
    const former = defaultSettings();
    former.bindings.replay = ['r'];
    former.bindings.record = ['Shift+r'];
    former.bindings.print = ['Shift+p', 'Meta+p', 'Control+p'];
    saveSettings(former);
    const migrated = loadSettings();
    expect(migrated.bindings.record).toEqual(['r']);
    expect(migrated.bindings.replay).toEqual(['a']);
    expect(migrated.bindings.print).toEqual(['p', 'Meta+p', 'Control+p']);
    former.bindings.record = ['Shift+r', 'x'];
    saveSettings(former);
    expect(loadSettings().bindings.record).toEqual(['Shift+r', 'x']);
    expect(loadSettings().bindings.replay).toEqual(['r']);
    // A setup saved before printing existed still moves the recording keys.
    const older = defaultSettings();
    older.bindings.replay = ['r'];
    older.bindings.record = ['Shift+r'];
    const { print: _print, ...withoutPrint } = older.bindings;
    localStorage.setItem('zoomdeck:settings', JSON.stringify({ ...older, bindings: withoutPrint }));
    const moved = loadSettings();
    expect(moved.bindings.record).toEqual(['r']);
    expect(moved.bindings.replay).toEqual(['a']);
  });
});

describe('rendering settings', () => {
  it('keeps valid rendering choices and drops the rest', () => {
    expect(sanitizeRendering(null)).toEqual(DEFAULT_RENDERING);
    expect(sanitizeRendering({ antialias: false, resolution: 2 })).toEqual({ antialias: false, resolution: 2 });
    expect(sanitizeRendering({ antialias: 'no', resolution: 3 })).toEqual(DEFAULT_RENDERING);
    expect(renderPixelRatio({ antialias: true, resolution: 1 })).toBe(1);
    expect(renderPixelRatio({ antialias: true, resolution: 2 })).toBe(2);
    expect(renderPixelRatio({ antialias: true, resolution: 'auto' })).toBe(Math.min(window.devicePixelRatio || 1, 2));
  });
});
