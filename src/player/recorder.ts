/**
 * Recording a talk: the microphone, and the camera while it is on, go through MediaRecorder
 * into media files, while the presenter's actions are stamped on the same clock into a
 * timeline. A pause stops both; the gap exists in neither. Turning the camera on or off
 * closes the file so far and begins another on the same clock, since a browser cannot add
 * a picture to a file being written: a part is therefore one or more media files in a row.
 */
import type { RecordedPart, StopRef, TimelineEvent, UntimedEvent } from './timeline';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopping';

/** The media type MediaRecorder accepts here, preferring WebM with Opus; null when it supports none of them. */
export function recordingMimeType(video: boolean): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = video
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** What a captured picture shows. */
export type PictureSource = 'camera' | 'screen';

export interface RecorderOptions {
  /** The microphone (and the camera or the screen, when one is on) at the start; null records the timeline alone (no sound). */
  stream: MediaStream | null;
  /** What the picture in `stream` shows, when it has one. */
  source?: PictureSource;
}

/** One media file captured during a part. */
export interface CapturedMedia {
  blob: Blob;
  type: string;
  /** Whether the file has a picture besides the sound, and what it shows. */
  video: boolean;
  source: PictureSource;
  /** Where the file begins on the part's clock, and how long it runs there. */
  start: number;
  duration: number;
}

export interface RecorderResult {
  /** The events and length of this part, on the part's own clock (starting at zero); its media are named by the caller. */
  part: RecordedPart;
  /** The sound and picture captured, in order; empty when nothing was captured. */
  media: CapturedMedia[];
  started: Date;
}

/** A media file being written. */
interface Capture {
  recorder: MediaRecorder;
  chunks: Blob[];
  type: string;
  video: boolean;
  source: PictureSource;
  start: number;
}

/** One recording in progress. */
export class Recorder {
  state: RecorderState = 'idle';
  private readonly _events: TimelineEvent[] = [];
  private _capture: Capture | null = null;
  private readonly _captured: CapturedMedia[] = [];
  /** Stream changes are applied one after the other, in the order asked. */
  private _switching: Promise<void> = Promise.resolve();
  /** Milliseconds recorded before the current run, and when the current run started (null while paused). */
  private _elapsedBefore = 0;
  private _runStart: number | null = null;
  private _started: Date | null = null;

  constructor(private readonly options: RecorderOptions) {}

  /** Milliseconds of talk recorded so far, pauses excluded. */
  get elapsed(): number {
    return this._elapsedBefore + (this._runStart === null ? 0 : performance.now() - this._runStart);
  }

  get events(): readonly TimelineEvent[] {
    return this._events;
  }

  /** Whether sound or picture is being captured now (a recording without a microphone keeps the timeline alone). */
  get capturing(): boolean {
    return this._capture !== null;
  }

  /** Whether the file being written has a camera picture. */
  get video(): boolean {
    return Boolean(this._capture?.video);
  }

  /** Start capturing; resolves once the media recorder runs, so the clocks line up. */
  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this._started = new Date();
    await this._beginCapture(this.options.stream, 0, this.options.source ?? 'camera');
    this._runStart = performance.now();
    this.state = 'recording';
  }

  /** Stamp an event with the current time. */
  mark(event: UntimedEvent): void {
    if (this.state !== 'recording') return;
    this._events.push({ ...event, t: Math.round(this.elapsed) } as TimelineEvent);
  }

  pause(): void {
    if (this.state !== 'recording') return;
    this._elapsedBefore = this.elapsed;
    this._runStart = null;
    this.state = 'paused';
    const recorder = this._capture?.recorder;
    if (recorder?.state === 'recording') recorder.pause();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    const recorder = this._capture?.recorder;
    if (recorder?.state === 'paused') recorder.resume();
    this._runStart = performance.now();
    this.state = 'recording';
    this._events.push({ t: Math.round(this.elapsed), type: 'cut' });
  }

  /**
   * Capture from another stream from now on (the camera turned on or off): the file so far is
   * closed and a new one begins where it ends on the clock. A recording that captures nothing
   * stays that way, so that the media files always cover the talk from its start.
   */
  switchStream(stream: MediaStream | null, source: PictureSource = 'camera'): Promise<void> {
    const run = async () => {
      if (this.state !== 'recording' && this.state !== 'paused') return;
      if (!this._capture) return;
      // The file ends where the next begins: the clock is read once the recorder has stopped.
      const seam = await this._endCapture();
      await this._beginCapture(stream, seam, source);
    };
    this._switching = this._switching.then(run, run);
    return this._switching;
  }

  /** Stop and hand over the events and the media of this part. */
  async stop(): Promise<RecorderResult> {
    if (this.state === 'idle' || this.state === 'stopping') throw new Error('Nothing is being recorded');
    await this._switching.catch(() => undefined);
    const duration = Math.round(this.elapsed);
    this._runStart = null;
    this._elapsedBefore = duration;
    this.state = 'stopping';
    await this._endCapture();
    this.state = 'idle';
    return { part: { events: this._events, duration, media: [] }, media: this._captured, started: this._started ?? new Date() };
  }

  /** Begin a media file from `stream` at `start` on the clock; nothing when the stream has no tracks. */
  private async _beginCapture(stream: MediaStream | null, start: number, source: PictureSource): Promise<void> {
    if (!stream || !stream.getTracks().length) return;
    const video = stream.getVideoTracks().length > 0;
    const type = recordingMimeType(video);
    if (!type) throw new Error('This browser cannot record audio or video');
    // A screen is large and mostly still: a capped bitrate keeps its files within reason.
    const recorder = new MediaRecorder(stream, source === 'screen' && video ? { mimeType: type, videoBitsPerSecond: 2_500_000 } : { mimeType: type });
    const capture: Capture = { recorder, chunks: [], type, video, source, start };
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) capture.chunks.push(event.data);
    });
    await new Promise<void>((resolve, reject) => {
      recorder.addEventListener('start', () => resolve(), { once: true });
      recorder.addEventListener('error', () => reject(new Error('The recording could not start')), { once: true });
      recorder.start(1000);
    });
    if (this.state === 'paused') recorder.pause();
    this._capture = capture;
  }

  /** Close the media file being written and keep it; resolves with the clock time where it ends. */
  private async _endCapture(): Promise<number> {
    const capture = this._capture;
    this._capture = null;
    if (!capture) return Math.round(this.elapsed);
    const recorder = capture.recorder;
    if (recorder.state !== 'inactive') {
      // The stop event carries the last chunk; a recorder whose tracks ended may report an error instead, or nothing.
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(guard);
          resolve();
        };
        const guard = setTimeout(done, 5000);
        recorder.addEventListener('stop', done, { once: true });
        recorder.addEventListener('error', done, { once: true });
        try {
          recorder.stop();
        } catch {
          done();
        }
      });
    }
    const end = Math.round(this.elapsed);
    if (capture.chunks.length) {
      this._captured.push({ blob: new Blob(capture.chunks, { type: capture.type }), type: capture.type, video: capture.video, source: capture.source, start: capture.start, duration: Math.max(0, end - capture.start) });
    }
    return end;
  }
}

/** The first navigation event of a recording: where the deck stood when it began. */
export function initialEvents(stop: StopRef | null, board: boolean, pan: { x: number; y: number }, camera: boolean, speed: number): UntimedEvent[] {
  const events: UntimedEvent[] = [];
  if (stop) events.push({ type: 'go', stop, autoplay: false });
  if (speed !== 1) events.push({ type: 'speed', value: speed });
  if (board) events.push({ type: 'board', on: true });
  if (pan.x || pan.y) events.push({ type: 'pan', x: pan.x, y: pan.y });
  if (camera) events.push({ type: 'camera', on: true });
  return events;
}
