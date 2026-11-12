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

export type PadMessage =
  | { type: 'hello'; role: PadRole }
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

/** The presenter's room: a token kept for the tab, so a reload keeps the pairing. */
export function padRoom(): string {
  const key = 'zoomdeck:pad-room';
  let room: string | null = null;
  try {
    room = sessionStorage.getItem(key);
  } catch {
    /* storage unavailable */
  }
  if (!room) {
    room = Math.random().toString(36).slice(2, 8);
    try {
      sessionStorage.setItem(key, room);
    } catch {
      /* storage unavailable */
    }
  }
  return room;
}

export interface PairingInfo {
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

/** The URL a tablet opens: the light pad page on a network address, with the room token. */
export function padUrl(address: string, port: number, room: string): string {
  const url = new URL(location.href);
  url.hostname = address;
  url.port = String(port);
  url.pathname = '/pad.html';
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', room);
  return url.toString();
}
