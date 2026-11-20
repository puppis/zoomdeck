import { afterEach, describe, expect, it } from 'vitest';
import { linkKind } from '../bin/relay.mjs';
import { PlayerUI } from '../src/player/ui';
import { PadLink, padCode, type CableState, type PadMessage, type PairingInfo } from '../src/player/pad';
import { defineDeck } from '../src/deck';
import { Slide } from '../src/slides';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  try {
    localStorage.removeItem('zoomdown:pairing-choice');
  } catch {
    /* nothing kept */
  }
});

/** A player whose server answers the pairing question with `info`. */
function player(info: PairingInfo): PlayerUI {
  globalThis.fetch = (async () => ({ ok: true, json: async () => info }) as Response) as typeof fetch;
  const host = document.createElement('div');
  document.body.append(host);
  const ui = new PlayerUI(host, defineDeck({ title: 'Pairing', deck: () => new Slide('root') }), { embedded: true, useLocation: false, features: { camera: false, screen: false, record: false } });
  ui.connectPad(new PadLink('room'));
  return ui;
}

type Internals = {
  _cableChanged(state: CableState): void;
  _onPadMessage(message: PadMessage, from: string): void;
  _forgetSilentPads(): void;
  _pads: Map<string, { admitted: boolean; seen?: number }>;
  _cableOffer: HTMLElement;
  _showPairing(preferred?: string): Promise<void>;
  _pairingPanel: HTMLElement;
};

const WIFI = { address: '10.12.0.7', interface: 'en0', kind: 'wifi' as const };
const SHARED = { address: '192.168.2.1', interface: 'bridge100', kind: 'shared' as const };

describe('a network link', () => {
  it('is told apart by its interface and its hardware port', () => {
    expect(linkKind('en0', 'Wi-Fi')).toBe('wifi');
    expect(linkKind('en8', 'iPad USB')).toBe('cable');
    expect(linkKind('bridge100')).toBe('shared');
    expect(linkKind('en0', 'Ethernet')).toBe('other');
    expect(linkKind('wlan0')).toBe('wifi');
    expect(linkKind('usb0')).toBe('cable');
  });
});

describe('a tablet plugged in by cable', () => {
  it('is offered pairing over the cable, or told how to give the cable a network', () => {
    const ui = player({ addresses: [], port: 8000, lan: true }) as unknown as Internals;
    ui._cableChanged({ links: [SHARED], devices: ['iPad'] });
    expect(ui._cableOffer.hidden).toBe(false);
    expect(ui._cableOffer.textContent).toMatch(/iPad is connected by cable\. Pair it/);
    // Dismissed, it stays away until the cable changes.
    (ui._cableOffer.querySelector('.dismiss') as HTMLButtonElement).click();
    expect(ui._cableOffer.hidden).toBe(true);
    ui._cableChanged({ links: [SHARED], devices: ['iPad'] });
    expect(ui._cableOffer.hidden).toBe(true);
    // Plugged out and in again, without Internet Sharing: the advice.
    ui._cableChanged({ links: [], devices: [] });
    ui._cableChanged({ links: [], devices: ['iPad'] });
    expect(ui._cableOffer.hidden).toBe(false);
    expect(ui._cableOffer.textContent).toMatch(/Internet Sharing to iPad USB/);
    // A network shared over Wi-Fi with nothing plugged in is no cable.
    ui._cableChanged({ links: [SHARED], devices: [] });
    expect(ui._cableOffer.hidden).toBe(true);
  });
});

describe('the pairing panel', () => {
  it('shows one code at a time, the cable\'s when one is plugged in, and notes what the name relies on', async () => {
    const ui = player({ names: ['Laptop.local'], addresses: [WIFI.address, SHARED.address], links: [WIFI, SHARED], port: 8765, lan: true }) as unknown as Internals;
    ui._cableChanged({ links: [SHARED], devices: ['iPad'] });
    await ui._showPairing();
    const panel = ui._pairingPanel;
    expect(panel.querySelectorAll('.code').length).toBe(1);
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('.choices button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Name · Laptop.local', 'Cable · 192.168.2.1', 'Wi-Fi · 10.12.0.7']);
    expect(buttons.map((button) => button.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(panel.querySelector('.url')?.textContent).toMatch(/^http:\/\/192\.168\.2\.1:8765\/pad\.html\?room=room/);
    buttons[0].click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.querySelector('.url')?.textContent).toMatch(/^http:\/\/laptop\.local:8765\//i);
    expect(panel.textContent).toMatch(/multicast DNS.*eduroam/);
    expect(localStorage.getItem('zoomdown:pairing-choice')).toBe('name');
  });

  it('starts from the name without a cable, and from the kind chosen last time', async () => {
    const info = { names: ['Laptop.local'], addresses: [WIFI.address], links: [WIFI], port: 8765, lan: true };
    const first = player(info) as unknown as Internals;
    await first._showPairing();
    expect(first._pairingPanel.querySelector('.url')?.textContent).toMatch(/^http:\/\/laptop\.local:8765\//i);
    localStorage.setItem('zoomdown:pairing-choice', 'wifi');
    const second = player(info) as unknown as Internals;
    await second._showPairing();
    expect(second._pairingPanel.querySelector('.url')?.textContent).toMatch(/^http:\/\/10\.12\.0\.7:8765\//);
  });
});

describe('a tablet that went away without a goodbye', () => {
  const IPAD = { id: 'ipad-1', name: 'iPad' };

  it('is forgotten once silent, offered again by cable, and let in again when its page comes back', () => {
    const ui = player({ addresses: [], port: 8000, lan: true }) as unknown as Internals;
    ui._onPadMessage({ type: 'hello', role: 'pad', device: IPAD, code: padCode() }, 'page-1');
    expect(ui._pads.get('page-1')?.admitted).toBe(true);
    // Plugged in while it draws: no offer, a tablet is in.
    ui._cableChanged({ links: [SHARED], devices: ['iPad'] });
    expect(ui._cableOffer.hidden).toBe(true);
    // The cable pulled out: the page goes silent, and is forgotten; plugged in again, the offer is back.
    ui._cableChanged({ links: [], devices: [] });
    (ui._pads.get('page-1') as { seen?: number }).seen = Date.now() - 60_000;
    ui._forgetSilentPads();
    expect(ui._pads.size).toBe(0);
    ui._cableChanged({ links: [SHARED], devices: ['iPad'] });
    expect(ui._cableOffer.hidden).toBe(false);
    // Its page reloads (without the code in its address): let in again for this session.
    ui._onPadMessage({ type: 'hello', role: 'pad', device: IPAD }, 'page-2');
    expect(ui._pads.get('page-2')?.admitted).toBe(true);
    expect(ui._cableOffer.hidden).toBe(true);
    // A page heard from recently stays.
    ui._onPadMessage({ type: 'alive' }, 'page-2');
    ui._forgetSilentPads();
    expect(ui._pads.has('page-2')).toBe(true);
  });

  it('keeps one entry per tablet, the page it came back on', () => {
    const ui = player({ addresses: [], port: 8000, lan: true }) as unknown as Internals;
    ui._onPadMessage({ type: 'hello', role: 'pad', device: IPAD, code: padCode() }, 'page-1');
    ui._onPadMessage({ type: 'hello', role: 'pad', device: IPAD }, 'page-2');
    expect([...ui._pads.keys()]).toEqual(['page-2']);
  });

  it('is told when Internet Sharing does not reach it after being plugged in again', () => {
    const ui = player({ addresses: [], port: 8000, lan: true }) as unknown as Internals;
    ui._cableChanged({ links: [SHARED], devices: ['iPad'], unshared: ['en9'] });
    expect(ui._cableOffer.hidden).toBe(false);
    expect(ui._cableOffer.textContent).toMatch(/Internet Sharing does not reach it.*off and on again/);
  });
});
