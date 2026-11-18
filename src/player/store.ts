/**
 * Where recordings live: a `recordings/` folder next to the deck, one bundle `<name>.zip` per
 * talk (its media files and timeline), written by the preview server while the talk runs and
 * read by any player through `recordings/index.json`. The folder export unpacks the bundles
 * into plain files, which a static host streams best; talks saved as plain files by earlier
 * versions are read the same way. Without the server (an exported deck, a file opened from
 * disk) a new recording is offered as the same bundle to download.
 */
import { isTimeline, repairFileNames, type MediaLane, type Timeline, type TimelineMedia } from './timeline';
import { openRemoteZip, type RemoteZip } from './zip';

export interface RecordingEntry {
  name: string;
  title: string;
  recorded: string;
  duration: number;
  /** The first media file's name, or null for a timeline without sound. */
  media: string | null;
  video: boolean;
  /** Whether the presenter's voice is in it (false when the microphone was refused; absent in an older index: then any media stands in). */
  voice?: boolean;
  /** Whether a camera picture is in it (absent in an index written before it was kept: then `video` stands in). */
  camera?: boolean;
  /** Whether a filmed screen is in it. */
  screen?: boolean;
  /** Whether the talk has a system lane: the computer's sound, recorded with the screen share. */
  system?: boolean;
  parts?: number;
  /** The bundle holding the talk (`name.zip`); absent when the talk lies in plain files. */
  file?: string;
  /** The talk's rendered video in the recordings folder (`name.video.mp4`, or a `name.video.webm` made in a page), when there is one. */
  movie?: string;
}

export interface RecordingIndex {
  recordings: RecordingEntry[];
}

const ENDPOINT = '/__zoomdown/recordings';

/** Whether this page runs under the preview or development server, which can write the deck folder. */
export function recordingStoreAvailable(): boolean {
  return Boolean(import.meta.hot);
}

/** The URL of a file in the deck's recordings folder. */
export function recordingUrl(base: string, file: string): string {
  return new URL(`recordings/${file}`, base).href;
}

/** The server's URL for one entry of a talk's bundle, streamed with ranges. */
function entryUrl(base: string, name: string, file: string): string {
  return `${ENDPOINT}?${new URLSearchParams({ deck: base, name, file })}`;
}

/** The recordings listed next to the deck, newest first; empty when there is no folder. */
export async function listRecordings(base: string): Promise<RecordingEntry[]> {
  try {
    const response = await fetch(recordingUrl(base, 'index.json'), { cache: 'no-store' });
    if (!response.ok) return [];
    const text = await response.text();
    // The development server answers a missing file with the page itself.
    if (!text.trim().startsWith('{')) return [];
    const index = JSON.parse(text) as Partial<RecordingIndex>;
    const entries = Array.isArray(index.recordings) ? index.recordings : [];
    return entries
      .filter((entry): entry is RecordingEntry => Boolean(entry && typeof entry.name === 'string'))
      .sort((a, b) => (b.recorded ?? '').localeCompare(a.recorded ?? ''));
  } catch {
    return [];
  }
}

/** Bundles opened over plain HTTP (a static host without the server), by URL: their directories are read once. */
const remoteBundles = new Map<string, Promise<RemoteZip>>();

function remoteBundle(base: string, file: string): Promise<RemoteZip> {
  const url = recordingUrl(base, file);
  let bundle = remoteBundles.get(url);
  if (!bundle) {
    bundle = openRemoteZip(url);
    bundle.catch(() => remoteBundles.delete(url));
    remoteBundles.set(url, bundle);
  }
  return bundle;
}

/** Fetch a recording's timeline: out of its bundle (through the server, or by ranges from a static host) or from its plain file. */
export async function loadTimeline(base: string, entry: RecordingEntry): Promise<Timeline> {
  const name = entry.name;
  let value: unknown;
  if (entry.file && recordingStoreAvailable()) {
    const response = await fetch(entryUrl(base, name, `${name}.json`), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Cannot load the recording ${name}`);
    value = await response.json();
  } else if (entry.file) {
    const bundle = await remoteBundle(base, entry.file);
    value = JSON.parse(await (await bundle.read(`${name}.json`)).text());
  } else {
    const response = await fetch(recordingUrl(base, `${name}.json`), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Cannot load the recording ${name}`);
    value = await response.json();
  }
  if (!isTimeline(value)) throw new Error(`${name} is not a recording of a talk`);
  // A talk recorded before files were numbered as they began gets the names its bundle gave them.
  return repairFileNames(value);
}

/**
 * Where a media part of a talk plays from: a plain file's URL, the server's streaming URL for
 * an entry of the bundle, or, from a static host that serves the bundle as it is, the entry
 * fetched whole into memory (a promise, resolved when it is there).
 */
export function mediaSource(base: string, entry: RecordingEntry, part: TimelineMedia): string | Promise<string> {
  if (!entry.file) return recordingUrl(base, part.file);
  if (recordingStoreAvailable()) return entryUrl(base, entry.name, part.file);
  return remoteBundle(base, entry.file).then(async (bundle) => URL.createObjectURL(await bundle.read(part.file)));
}

async function call(method: string, base: string, name: string, query: Record<string, string>, body?: BodyInit, type?: string): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ deck: base, name, ...query });
  const response = await fetch(`${ENDPOINT}?${params}`, { method, body, headers: type ? { 'Content-Type': type } : {} });
  const result = (await response.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string } & Record<string, unknown>;
  if (!response.ok || !result.ok) throw new Error(result.error ?? `The server answered ${response.status}`);
  return result;
}

/**
 * A talk being written to its bundle by the server, as it is recorded: the media files begin
 * and end at the recorder's seams, their chunks go out as they arrive, drafts of the timeline
 * are kept meanwhile, and `finish` closes the bundle with the final timeline. The operations
 * run one after the other; after the first failure every one fails with the same error, so
 * that the caller can offer the talk as a download instead.
 */
export class RecordingSession {
  private _queue: Promise<unknown> = Promise.resolve();
  private _failure: Error | null = null;

  constructor(readonly base: string, readonly name: string) {}

  /** The error that broke the session, when one did. */
  get failure(): Error | null {
    return this._failure;
  }

  private _run<T>(task: () => Promise<T>): Promise<T> {
    const next = this._queue.then(async () => {
      if (this._failure) throw this._failure;
      try {
        return await task();
      } catch (error) {
        this._failure = error as Error;
        throw error;
      }
    });
    this._queue = next.catch(() => undefined);
    return next;
  }

  /** Create the bundle, or cut a saved talk's bundle back to its media to continue it; resolves with the media files it holds already. */
  open(): Promise<number> {
    return this._run(async () => Number((await call('POST', this.base, this.name, { op: 'open' })).parts) || 0);
  }

  /** Begin media file number `part` (1 for the first) in a lane (the camera's, or the screen's beside it); resolves with its name in the bundle. */
  begin(part: number, type: string, lane: MediaLane = 'camera'): Promise<string> {
    return this._run(async () => String((await call('POST', this.base, this.name, { op: 'begin', part: String(part), lane }, undefined, type)).file));
  }

  /** Append a chunk to the media file being written in a lane. */
  chunk(data: Blob, lane: MediaLane = 'camera'): Promise<void> {
    return this._run(async () => {
      await call('POST', this.base, this.name, { op: 'chunk', lane }, data, data.type || 'application/octet-stream');
    });
  }

  /** End the media file being written in a lane; its size and checksum are written into its header. */
  end(lane: MediaLane = 'camera'): Promise<void> {
    return this._run(async () => {
      await call('POST', this.base, this.name, { op: 'end', lane });
    });
  }

  /** Keep a draft of the timeline, so that a talk cut short by a crash is closed from it later. */
  draft(timeline: Timeline): Promise<void> {
    return this._run(async () => {
      await call('POST', this.base, this.name, { op: 'draft' }, JSON.stringify(timeline), 'application/json');
    });
  }

  /** Write the timeline and the directory: the bundle is complete. */
  finish(timeline: Timeline): Promise<void> {
    return this._run(async () => {
      await call('POST', this.base, this.name, { op: 'finish' }, JSON.stringify(timeline), 'application/json');
    });
  }
}

/** The file name of a recording's media: `name.webm` for the first part, `name.part2.webm` from the second on. */
export function mediaFileName(name: string, type: string, part: number): string {
  const extension = type.startsWith('video/mp4') ? 'mp4' : type.startsWith('audio/mp4') ? 'm4a' : 'webm';
  return part > 1 ? `${name}.part${part}.${extension}` : `${name}.${extension}`;
}

/** Describe a captured blob as a media part of the timeline (its `start` is set when it is appended). */
export function describeMedia(name: string, type: string, part: number, duration: number): TimelineMedia {
  return { file: mediaFileName(name, type, part), type, video: type.startsWith('video/'), start: 0, duration };
}

/** Save a file produced by the player (an exported video) in the recordings folder, beside the talk's bundle. */
export async function saveFile(base: string, name: string, extension: string, blob: Blob): Promise<void> {
  await call('PUT', base, name, { kind: extension }, blob, blob.type || 'application/octet-stream');
}

export async function deleteRecording(base: string, name: string): Promise<void> {
  const query = new URLSearchParams({ deck: base, name });
  const response = await fetch(`${ENDPOINT}?${query}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`The server answered ${response.status}`);
}

/** Offer a blob as a download, for players without a server behind them. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
