/**
 * Where recordings live: a `recordings/` folder next to the deck, written by the preview
 * server and read by any player through `recordings/index.json`, which the folder export
 * ships as well. Without the server (an exported deck, a file opened from disk) a new
 * recording is offered as downloads instead.
 */
import { isTimeline, type Timeline, type TimelineMedia } from './timeline';

export interface RecordingEntry {
  name: string;
  title: string;
  recorded: string;
  duration: number;
  /** The media file name, or null for a timeline without sound. */
  media: string | null;
  video: boolean;
}

export interface RecordingIndex {
  recordings: RecordingEntry[];
}

const ENDPOINT = '/__zoomdeck/recordings';

/** Whether this page runs under the preview or development server, which can write the deck folder. */
export function recordingStoreAvailable(): boolean {
  return Boolean(import.meta.hot);
}

/** The URL of a file in the deck's recordings folder. */
export function recordingUrl(base: string, file: string): string {
  return new URL(`recordings/${file}`, base).href;
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

/** Fetch a recording's timeline. */
export async function loadTimeline(base: string, name: string): Promise<Timeline> {
  const response = await fetch(recordingUrl(base, `${name}.json`), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Cannot load the recording ${name}`);
  const value: unknown = await response.json();
  if (!isTimeline(value)) throw new Error(`${name}.json is not a recording of a talk`);
  return value;
}

async function send(method: string, base: string, name: string, kind: string, body: BodyInit, type: string, part = 0): Promise<{ file?: string }> {
  const query = new URLSearchParams({ deck: base, name, kind });
  if (part) query.set('part', String(part));
  const response = await fetch(`${ENDPOINT}?${query}`, { method, body, headers: { 'Content-Type': type } });
  const result = (await response.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string; file?: string };
  if (!response.ok || !result.ok) throw new Error(result.error ?? `The server answered ${response.status}`);
  return result;
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

/** Save a media part next to the deck through the preview server (it is the large part, so it goes first). */
export async function saveMedia(base: string, name: string, part: number, media: Blob, type: string): Promise<void> {
  await send('PUT', base, name, 'media', media, type, part);
}

/** Save (or rewrite) a recording's timeline, which makes it appear in the index. */
export async function saveTimeline(base: string, name: string, timeline: Timeline): Promise<void> {
  await send('PUT', base, name, 'timeline', JSON.stringify(timeline), 'application/json');
}

/** Save a file produced by the player (an exported video) in the recordings folder. */
export async function saveFile(base: string, name: string, extension: string, blob: Blob): Promise<void> {
  await send('PUT', base, name, extension, blob, blob.type || 'application/octet-stream');
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
