/**
 * The timeline of a recorded talk: what the presenter did, on the clock of the recorded
 * audio or video. The slides are never filmed; a player replays the timeline against the
 * deck, so a recording stays sharp at any size and small on disk, and an export renders it
 * frame by frame (in real time today, offline later: nothing here depends on the wall clock).
 *
 * Stops are named by slide key and step rather than by clip number, so a recording survives
 * edits that do not remove the slides it visits.
 */
import type { NavigationData } from '../runtime';
import type { InkOp, InkSurfaceName } from './pad';

/** A stop of the deck: a slide (by its stable key) and the ordinal of the stop within it. */
export interface StopRef {
  key: string;
  step: number;
}

/** The slide key and step of a clip index, or null when the index is out of range. */
export function stopRef(navigation: NavigationData, index: number): StopRef | null {
  const clip = navigation.clips[index];
  if (!clip) return null;
  const slide = navigation.slides.find((candidate) => candidate.id === clip.slide);
  if (!slide) return null;
  let step = 0;
  for (let i = 0; i < index; i++) if (navigation.clips[i].slide === clip.slide) step += 1;
  return { key: slide.key, step };
}

/** The clip index of a stop, clamped to the slide's last stop; null when the slide is gone. */
export function stopIndex(navigation: NavigationData, stop: StopRef): number | null {
  const slide = navigation.slides.find((candidate) => candidate.key === stop.key);
  if (!slide) return null;
  const indices: number[] = [];
  navigation.clips.forEach((clip, index) => {
    if (clip.slide === slide.id) indices.push(index);
  });
  if (!indices.length) return null;
  return indices[Math.min(Math.max(stop.step, 0), indices.length - 1)];
}

/** A short hash of the deck's structure (slides and their stops), to tell when a recording no longer fits the deck. */
export function structureHash(navigation: NavigationData): string {
  let hash = 0x811c9dc5;
  const feed = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const slide of navigation.slides) feed(`${slide.key}|`);
  for (const clip of navigation.clips) feed(`${clip.slide}:${clip.kind};`);
  return hash.toString(16).padStart(8, '0');
}

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type PointerKind = 'spotlight' | 'laser';

/** One thing the presenter did, `t` milliseconds into the recording (pauses removed). */
export type TimelineEvent =
  /** Show a stop; with `autoplay` its animations play, else its settled end state appears. */
  | { t: number; type: 'go'; stop: StopRef; autoplay: boolean }
  /** Play the current stop backwards and settle at `stop`. */
  | { t: number; type: 'rewind'; stop: StopRef }
  | { t: number; type: 'speed'; value: number }
  | { t: number; type: 'ink'; surface: InkSurfaceName; op: InkOp }
  | { t: number; type: 'board'; on: boolean }
  /** The whiteboard viewport, in surface units. */
  | { t: number; type: 'pan'; x: number; y: number }
  | { t: number; type: 'camera'; on: boolean }
  /** The spotlight or laser at a point of the slide viewport (surface units, 1000 tall), with its radius. */
  | { t: number; type: 'pointer'; mode: PointerKind; x: number; y: number; r: number }
  | { t: number; type: 'pointer-off' }
  /** Where the recording was paused and resumed; the gap is not in the recording. */
  | { t: number; type: 'cut' };

/** An event without its time stamp, as the recorder receives them (distributes over the union). */
export type UntimedEvent = TimelineEvent extends infer E ? (E extends TimelineEvent ? Omit<E, 't'> : never) : never;

/**
 * One media file of a recording. A talk recorded in one go has one; a talk continued after a
 * stop has one per part, since a browser cannot append to a finished file. `start` is where
 * the part begins on the timeline's clock.
 */
export interface TimelineMedia {
  /** File name next to the timeline, in the deck's recordings folder. */
  file: string;
  type: string;
  /** Whether the file has a camera picture besides the sound. */
  video: boolean;
  start: number;
  duration: number;
}

/** The media part that covers time `t`, or the last one at the very end; null without media. */
export function mediaAt(media: TimelineMedia[], t: number): TimelineMedia | null {
  if (!media.length) return null;
  for (const part of media) if (t < part.start + part.duration) return part;
  return media[media.length - 1];
}

export interface Timeline {
  version: 1;
  deck: { title: string; hash: string };
  /** ISO date of the recording. */
  recorded: string;
  /** Length in milliseconds, pauses removed. */
  duration: number;
  /** The sound or video, in one or more parts; empty when nothing was captured. */
  media: TimelineMedia[];
  /** Where the camera picture sits when it is not full frame, as a share of the frame width. */
  pip: { corner: Corner; size: number };
  events: TimelineEvent[];
}

/** The settled state the timeline describes at time `t`: everything but the ink, which is replayed op by op. */
export interface TimelineState {
  stop: StopRef | null;
  /** True when the last navigation at or before `t` was still animating when it was issued. */
  animated: boolean;
  speed: number;
  board: boolean;
  pan: { x: number; y: number };
  camera: boolean;
  pointer: { mode: PointerKind; x: number; y: number; r: number } | null;
}

/** Fold the events at or before `t` into the state they leave behind. */
export function stateAt(events: TimelineEvent[], t: number): TimelineState {
  const state: TimelineState = { stop: null, animated: false, speed: 1, board: false, pan: { x: 0, y: 0 }, camera: false, pointer: null };
  for (const event of events) {
    if (event.t > t) break;
    switch (event.type) {
      case 'go': state.stop = event.stop; state.animated = event.autoplay; break;
      case 'rewind': state.stop = event.stop; state.animated = false; break;
      case 'speed': state.speed = event.value; break;
      case 'board': state.board = event.on; break;
      case 'pan': state.pan = { x: event.x, y: event.y }; break;
      case 'camera': state.camera = event.on; break;
      case 'pointer': state.pointer = { mode: event.mode, x: event.x, y: event.y, r: event.r }; break;
      case 'pointer-off': state.pointer = null; break;
      case 'ink': case 'cut': break;
    }
  }
  return state;
}

/** The ink events at or before `t`, in order, to replay onto fresh surfaces. */
export function inkUpTo(events: TimelineEvent[], t: number): Array<Extract<TimelineEvent, { type: 'ink' }>> {
  const ops: Array<Extract<TimelineEvent, { type: 'ink' }>> = [];
  for (const event of events) {
    if (event.t > t) break;
    if (event.type === 'ink') ops.push(event);
  }
  return ops;
}

/** The events after `from` and at or before `to`, in order: what a running playback must apply when its clock advances. */
export function eventsBetween(events: TimelineEvent[], from: number, to: number): TimelineEvent[] {
  return events.filter((event) => event.t > from && event.t <= to);
}

/** `m:ss` for a duration in milliseconds. */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** A file-safe recording name from the date: `talk-2026-11-13-1030`. */
export function recordingName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `talk-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** A stretch of talk recorded in one go: its events on its own clock, and what the devices captured. */
export interface RecordedPart {
  events: TimelineEvent[];
  duration: number;
  media: TimelineMedia | null;
}

/**
 * Add a part recorded after a stop to a timeline: its events are shifted to the end of the
 * talk, a cut marks the seam, and its media file becomes a further part.
 */
export function appendPart(timeline: Timeline, part: RecordedPart): Timeline {
  const offset = timeline.duration;
  const events: TimelineEvent[] = [...timeline.events];
  if (offset > 0) events.push({ t: offset, type: 'cut' });
  for (const event of part.events) events.push({ ...event, t: event.t + offset });
  const media = [...timeline.media];
  if (part.media) media.push({ ...part.media, start: offset, duration: part.duration });
  return { ...timeline, duration: offset + part.duration, media, events };
}

/** Whether a parsed JSON value is a timeline this player can replay. */
export function isTimeline(value: unknown): value is Timeline {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Timeline>;
  return candidate.version === 1 && Array.isArray(candidate.events) && typeof candidate.duration === 'number' && !!candidate.deck && Array.isArray(candidate.media);
}
