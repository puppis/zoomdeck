/**
 * The companion tablet: a light page showing a picture of the presenter's
 * current slide, following the presenter's stop and drawing on it. Devices exchange small messages through
 * the preview server's WebSocket (the one Vite uses for reloads), so pairing
 * works wherever the deck is served by `zoomdeck serve` or `npm run dev`, and
 * nowhere else. Every page in the same room sees every message; a page
 * ignores its own.
 */
import type { InkSample, InkStroke } from './ink';

export type InkSurfaceName = 'slide' | 'board';

export type InkOp =
  | { op: 'begin'; stroke: InkStroke }
  | { op: 'extend'; id: string; samples: InkSample[]; pressure?: true }
  | { op: 'end'; id: string }
  | { op: 'erase'; id: string }
  | { op: 'undo' }
  | { op: 'redo' }
  | { op: 'clear' }
  | { op: 'replace'; strokes: InkStroke[] };

export type PadRole = 'presenter' | 'pad';

/** A tablet's identity, made once per browser and kept, so that the presenter can trust it. */
export interface PadDevice {
  id: string;
  /** What the tablet calls itself (iPad, Android tablet), shown to the presenter. */
  name: string;
}

export type PadMessage =
  /** The presenter announces itself; a pad announces itself with its identity and, when opened from the pairing code, the code. */
  | { type: 'hello'; role: 'presenter' }
  | { type: 'hello'; role: 'pad'; device?: PadDevice; code?: string }
  /** The presenter's answer to a pad: admitted (trusted or by the code), or waiting to be allowed. */
  | { type: 'admit'; to: string; ok: boolean; trusted?: boolean }
  /** A pad leaving (the page hidden or closed). */
  | { type: 'bye' }
  | { type: 'state'; clip: number; board: boolean; pan: { x: number; y: number }; aspect: number; background: string; foreground: string }
  /** A picture of the presenter's current view (a JPEG data URL), sent when a stop settles. */
  | { type: 'frame'; image: string; clip: number }
  | { type: 'board'; on: boolean; pan: { x: number; y: number } }
  | ({ type: 'ink'; surface: InkSurfaceName } & InkOp)
  | { type: 'hover'; x: number; y: number; visible: boolean };

interface Envelope {
  room: string;
  from: string;
  message: PadMessage;
}

const EVENT = 'zoomdeck:pad';

/** Whether this page can reach the relay at all (only under the preview or development server). */
export function padLinkAvailable(): boolean {
  return Boolean(import.meta.hot);
}

/** Messages of one room, over the development server's socket. */
export class PadLink {
  readonly id = Math.random().toString(36).slice(2, 10);
  private readonly _handlers = new Set<(message: PadMessage, from: string) => void>();

  constructor(readonly room: string) {
    import.meta.hot?.on(EVENT, (data: Envelope) => {
      if (!data || data.room !== this.room || data.from === this.id) return;
      for (const handler of this._handlers) handler(data.message, data.from);
    });
  }

  send(message: PadMessage): void {
    const envelope: Envelope = { room: this.room, from: this.id, message };
    import.meta.hot?.send(EVENT, envelope);
  }

  on(handler: (message: PadMessage, from: string) => void): () => void {
    this._handlers.add(handler);
    return () => this._handlers.delete(handler);
  }
}

function token(length: number): string {
  return Math.random().toString(36).slice(2, 2 + length);
}

/** A value kept in a storage, made by `make` the first time. */
function remembered(storage: () => Storage, key: string, make: () => string): string {
  let value: string | null = null;
  try {
    value = storage().getItem(key);
  } catch {
    /* storage unavailable */
  }
  if (!value) {
    value = make();
    try {
      storage().setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  }
  return value;
}

/**
 * The presenter's room: a token kept in this browser for good, so that a tablet paired once finds
 * the deck again, whichever deck or tab is presenting. The room only sorts the messages; the
 * admission of a tablet is decided by the presenter, on the pairing code or its trust.
 */
export function padRoom(): string {
  return remembered(() => localStorage, 'zoomdeck:pad-room', () => token(6));
}

/**
 * The pairing code of this presenter tab: a tablet that opens the pad page with it is admitted
 * for the time being, without becoming trusted. A reload keeps the code; a new tab makes another,
 * so a code scanned once does not admit a tablet for good.
 */
export function padCode(): string {
  return remembered(() => sessionStorage, 'zoomdeck:pad-code', () => token(6));
}

/** The name a tablet gives itself, from what the browser tells. */
export function describeDevice(): string {
  const agent = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 1;
  if (/iPad/.test(agent) || (/Macintosh/.test(agent) && touch)) return 'iPad';
  if (/iPhone/.test(agent)) return 'iPhone';
  if (/Android/.test(agent)) return /Mobile/.test(agent) ? 'Android phone' : 'Android tablet';
  if (/Windows/.test(agent) && touch) return 'Windows tablet';
  if (/CrOS/.test(agent)) return 'Chromebook';
  return touch ? 'Tablet' : 'Computer';
}

/** This tablet's identity, made the first time and kept in the browser. */
export function padDevice(): PadDevice {
  const raw = remembered(() => localStorage, 'zoomdeck:pad-device', () => JSON.stringify({ id: token(12), name: describeDevice() }));
  try {
    const parsed = JSON.parse(raw) as Partial<PadDevice>;
    if (typeof parsed.id === 'string' && parsed.id) return { id: parsed.id, name: typeof parsed.name === 'string' && parsed.name ? parsed.name : describeDevice() };
  } catch {
    /* corrupt: a new identity */
  }
  const device = { id: token(12), name: describeDevice() };
  try {
    localStorage.setItem('zoomdeck:pad-device', JSON.stringify(device));
  } catch {
    /* storage unavailable */
  }
  return device;
}

export interface PairingInfo {
  /** Names of this computer on the local network (its Bonjour name, as a rule), which outlive a change of address. */
  names?: string[];
  /** Addresses other devices on the network can use, empty when the server listens on the loopback only. */
  addresses: string[];
  port: number;
  lan: boolean;
}

/** Ask the server how a tablet can reach it. */
export async function fetchPairingInfo(): Promise<PairingInfo | null> {
  try {
    const response = await fetch('/__zoomdeck/pad.json', { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as PairingInfo;
  } catch {
    return null;
  }
}

/** The URL a tablet opens: the light pad page on a network address or name, with the room and the pairing code. */
export function padUrl(address: string, port: number, room: string, code?: string): string {
  const url = new URL(location.href);
  url.hostname = address;
  url.port = String(port);
  url.pathname = '/pad.html';
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', room);
  if (code) url.searchParams.set('code', code);
  return url.toString();
}
