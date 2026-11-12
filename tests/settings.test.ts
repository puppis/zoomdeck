import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_POINTER_BINDINGS, defaultSettings, describeModifiers, loadSettings, modifierCombo, pointerActionFor, saveSettings,
} from '../src/player/settings';

describe('player settings', () => {
  beforeEach(() => localStorage.clear());

  it('draws with a plain drag, shows the pointer tool on Shift and advances on Alt + click by default', () => {
    const settings = defaultSettings();
    expect(settings.pointer).toEqual(DEFAULT_POINTER_BINDINGS);
    expect(pointerActionFor(settings, '')).toBe('pen');
    expect(pointerActionFor(settings, 'Shift')).toBe('pointer');
    expect(pointerActionFor(settings, 'Alt')).toBe('advance');
    expect(pointerActionFor(settings, 'Control')).toBeNull();
    expect(settings.pointerMode).toBe('spotlight');
    expect(settings.bindings.pointer).toEqual(['l']);
  });

  it('normalizes held modifiers in a fixed order', () => {
    expect(modifierCombo({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false })).toBe('');
    expect(modifierCombo({ shiftKey: true, ctrlKey: true, altKey: false, metaKey: false })).toBe('Shift+Control');
    expect(describeModifiers(null)).toBe('Off');
    expect(describeModifiers('')).toMatch(/Plain/);
  });

  it('keeps valid saved gestures and the pointer mode, ignoring corrupt values', () => {
    const settings = defaultSettings();
    settings.pointer = { pen: 'Control', pointer: 'Shift', advance: null };
    settings.pointerMode = 'laser';
    saveSettings(settings);
    const loaded = loadSettings();
    expect(loaded.pointer).toEqual({ pen: 'Control', pointer: 'Shift', advance: null });
    expect(loaded.pointerMode).toBe('laser');
    localStorage.setItem('zoomdeck:settings', JSON.stringify({ pointer: { pen: 'Hyper' }, pointerMode: 'torch' }));
    const fallback = loadSettings();
    expect(fallback.pointer.pen).toBe('');
    expect(fallback.pointerMode).toBe('spotlight');
  });
});
