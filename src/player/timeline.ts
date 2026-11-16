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
  /** The camera's corner picture set aside while the pointer was over it, so that what it covers showed, and back. */
  | { t: number; type: 'corner'; hidden: boolean }
  /** The spotlight or laser at a point of the slide viewport (surface units, 1000 tall), with its radius. */
  | { t: number; type: 'pointer'; mode: PointerKind; x: number; y: number; r: number }
  | { t: number; type: 'pointer-off' }
  /** Where the recording was paused and resumed; the gap is not in the recording. */
  | { t: number; type: 'cut' }
  /** The proportions (width over height) of the stage the deck was presented on, at the start and after each resize. */
  | { t: number; type: 'stage'; aspect: number };

/** An event without its time stamp, as the recorder receives them (distributes over the union). */
export type UntimedEvent = TimelineEvent extends infer E ? (E extends TimelineEvent ? Omit<E, 't'> : never) : never;

/**
 * One media file of a recording. A talk recorded in one go with the camera left alone has one;
 * a talk continued after a stop has one per part, since a browser cannot append to a finished
 * file, and turning the camera on or off while recording also begins a new file, since a
 * picture cannot join a file being written. `start` is where the file begins on the timeline's
 * clock; the files cover the talk from its start, one after the other.
 */
/**
 * The lanes of a recording: the camera lane carries the microphone and the camera, in files one
 * after the other covering the talk; the side lanes overlap them: the screen lane carries the
 * filmed screen, the system lane the computer's own sound, captured with the screen share.
 */
export type MediaLane = 'camera' | 'screen' | 'system';
/** The lanes recorded beside the camera lane. */
export const SIDE_LANES: readonly MediaLane[] = ['screen', 'system'];
/** Whether a media file belongs to the camera lane (also when it names no lane, as earlier recordings did). */
export function inCameraLane(part: Pick<TimelineMedia, 'lane'>): boolean {
  return !part.lane || part.lane === 'camera';
}

export interface TimelineMedia {
  /** File name next to the timeline, in the deck's recordings folder. */
  file: string;
  type: string;
  /** Whether the file has a picture besides the sound. */
  video: boolean;
  /** What the picture shows: the camera (also when absent), or the screen, filmed while the presenter worked in another application. */
  source?: 'camera' | 'screen';
  /** The lane the file belongs to; absent means the camera lane (where earlier recordings also kept screen files, one picture at a time). */
  lane?: MediaLane;
  start: number;
  duration: number;
}

/**
 * The proportions the deck was presented in for the longest stretch of the talk (a window
 * resized during the talk changes them), or null for a recording made before they were kept.
 */
export function presentedAspect(events: TimelineEvent[], duration: number): number | null {
  const stretches = new Map<number, number>();
  let current: number | null = null;
  let since = 0;
  const close = (until: number) => {
    if (current !== null) stretches.set(current, (stretches.get(current) ?? 0) + Math.max(0, until - since));
  };
  for (const event of events) {
    if (event.type !== 'stage' || !(event.aspect > 0)) continue;
    close(event.t);
    current = Math.round(event.aspect * 1000) / 1000;
    since = event.t;
  }
  close(Math.max(duration, since));
  let best: number | null = null;
  for (const [aspect, length] of stretches) if (best === null || length > (stretches.get(best) ?? 0)) best = aspect;
  return best;
}

/** When the talk first reached `stop` (a move to it, forwards or backwards), in milliseconds; null when it never did. */
export function timeOfStop(events: TimelineEvent[], stop: StopRef): number | null {
  for (const event of events) {
    if ((event.type === 'go' || event.type === 'rewind') && event.stop.key === stop.key && event.stop.step === stop.step) return event.t;
  }
  return null;
}

/** A name for proportions: 16:9, 16:10, 4:3, 3:2, 21:9, or the ratio to one. */
export function aspectName(aspect: number): string {
  const named: Array<[number, string]> = [[16 / 9, '16:9'], [16 / 10, '16:10'], [4 / 3, '4:3'], [3 / 2, '3:2'], [21 / 9, '21:9'], [1, '1:1'], [9 / 16, '9:16'], [5 / 4, '5:4']];
  for (const [value, name] of named) if (Math.abs(value - aspect) < 0.01) return name;
  return `${aspect.toFixed(2)}:1`;
}

/** The camera-lane part that covers time `t` (the sound and the camera), or the last one at the very end; null without media. */
export function mediaAt(media: TimelineMedia[], t: number): TimelineMedia | null {
  const lane = media.filter(inCameraLane);
  if (!lane.length) return null;
  for (const part of lane) if (t < part.start + part.duration) return part;
  return lane[lane.length - 1];
}

/** The part of a side lane that covers time `t`, or null. */
export function laneAt(media: TimelineMedia[], lane: MediaLane, t: number): TimelineMedia | null {
  return media.find((part) => part.lane === lane && t >= part.start && t < part.start + part.duration) ?? null;
}

/** The screen-lane part that covers time `t` (the filmed screen beside the camera), or null. */
export function screenAt(media: TimelineMedia[], t: number): TimelineMedia | null {
  return laneAt(media, 'screen', t);
}

/** The system-lane part that covers time `t` (the computer's sound, recorded with the screen share), or null. */
export function systemAt(media: TimelineMedia[], t: number): TimelineMedia | null {
  return laneAt(media, 'system', t);
}

/** The stretches of the talk during which the screen was filmed, in either lane, as `[from, to]` in milliseconds. */
export function screenIntervals(media: TimelineMedia[]): Array<[number, number]> {
  return media.filter((part) => part.source === 'screen' && part.video).map((part) => [part.start, part.start + part.duration] as [number, number]).sort((a, b) => a[0] - b[0]);
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
  /** Whether the camera's corner picture is set aside (the pointer over it). */
  cornerHidden: boolean;
  pointer: { mode: PointerKind; x: number; y: number; r: number } | null;
}

/** Fold the events at or before `t` into the state they leave behind. */
export function stateAt(events: TimelineEvent[], t: number): TimelineState {
  const state: TimelineState = { stop: null, animated: false, speed: 1, board: false, pan: { x: 0, y: 0 }, camera: false, cornerHidden: false, pointer: null };
  for (const event of events) {
    if (event.t > t) break;
    switch (event.type) {
      case 'go': state.stop = event.stop; state.animated = event.autoplay; break;
      case 'rewind': state.stop = event.stop; state.animated = false; break;
      case 'speed': state.speed = event.value; break;
      case 'board': state.board = event.on; break;
      case 'pan': state.pan = { x: event.x, y: event.y }; break;
      case 'camera': state.camera = event.on; break;
      case 'corner': state.cornerHidden = event.hidden; break;
      case 'pointer': state.pointer = { mode: event.mode, x: event.x, y: event.y, r: event.r }; break;
      case 'pointer-off': state.pointer = null; break;
      case 'ink': case 'cut': case 'stage': break;
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

/** A stretch of talk recorded in one go: its events on its own clock, and what the devices captured, with `start` on that clock. */
export interface RecordedPart {
  events: TimelineEvent[];
  duration: number;
  media: TimelineMedia[];
}

/**
 * Add a part recorded after a stop to a timeline: its events are shifted to the end of the
 * talk, a cut marks the seam, and its media files become further files of the talk.
 */
export function appendPart(timeline: Timeline, part: RecordedPart): Timeline {
  const offset = timeline.duration;
  const events: TimelineEvent[] = [...timeline.events];
  if (offset > 0) events.push({ t: offset, type: 'cut' });
  for (const event of part.events) events.push({ ...event, t: event.t + offset });
  const media = [...timeline.media, ...part.media.map((file) => ({ ...file, start: offset + file.start }))];
  return { ...timeline, duration: offset + part.duration, media, events };
}

/** Whether a parsed JSON value is a timeline this player can replay. */
export function isTimeline(value: unknown): value is Timeline {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Timeline>;
  return candidate.version === 1 && Array.isArray(candidate.events) && typeof candidate.duration === 'number' && !!candidate.deck && Array.isArray(candidate.media);
}
