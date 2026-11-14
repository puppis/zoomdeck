import { describe, expect, it } from 'vitest';
import { enabledFeatures, featureOf, FEATURES, ACTIONS } from '../src/player/settings';
import { PlayerUI } from '../src/player/ui';
import { defineDeck } from '../src/deck';
import { Slide } from '../src/slides';

describe('features', () => {
  it('maps every action to a feature or to the always-available core', () => {
    for (const action of ACTIONS) {
      const feature = featureOf(action.name);
      if (feature) expect(FEATURES).toContain(feature);
    }
    expect(featureOf('next')).toBeNull();
    expect(featureOf('color2')).toBe('pen');
    expect(featureOf('boardLeft')).toBe('whiteboard');
    expect(featureOf('exit')).toBe('fullscreen');
  });

  it('turns everything on unless a flag says false', () => {
    expect([...enabledFeatures()]).toEqual([...FEATURES]);
    const some = enabledFeatures({ camera: false, record: false, pen: true });
    expect(some.has('camera')).toBe(false);
    expect(some.has('record')).toBe(false);
    expect(some.has('pen')).toBe(true);
    expect(some.size).toBe(FEATURES.length - 2);
  });
});

describe('the embedded player', () => {
  const deck = defineDeck({ title: 'Embedded', deck: () => new Slide('root'), background: '#123456', foreground: '#ffffff' });

  it('leaves the page alone and keeps to its host', () => {
    document.title = 'The page';
    const host = document.createElement('div');
    document.body.append(host);
    const ui = new PlayerUI(host, deck, { embedded: true, useLocation: false, features: { camera: false, screen: false, record: false, outline: false } });
    expect(document.title).toBe('The page');
    expect(document.body.classList.contains('zd-page')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('');
    expect(ui.root.style.getPropertyValue('--background')).toBe('#123456');
    expect(ui.root.style.colorScheme).toBe('dark');
    expect(host.firstElementChild).toBe(ui.root);
    expect(ui.root.querySelector('aside')).toBeNull();
    const groups = [...ui.root.querySelectorAll<HTMLElement>('footer .group')].map((group) => [group.getAttribute('aria-label'), group.hidden]);
    expect(groups).toEqual([['Navigation', false], ['Drawing', false], ['Camera and recording', true], ['Page', false]]);
    expect(ui.has('camera')).toBe(false);
    expect(ui.has('pen')).toBe(true);
    ui.dispose();
    expect(host.children.length).toBe(0);
    host.remove();
  });

  it('owns the page in standalone mode, and gives it back on dispose', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const ui = new PlayerUI(host, deck, { useLocation: false });
    expect(document.title).toBe('Embedded');
    expect(document.body.classList.contains('zd-page')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--foreground')).toBe('#ffffff');
    expect([...ui.root.querySelectorAll<HTMLElement>('footer .group')].every((group) => !group.hidden)).toBe(true);
    ui.dispose();
    expect(document.body.classList.contains('zd-page')).toBe(false);
    host.remove();
  });
});
