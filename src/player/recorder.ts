/**
 * Recording a talk: the microphone and, when chosen, the camera go through MediaRecorder
 * into one file, while the presenter's actions are stamped on the same clock into a
 * timeline. A pause stops both; the gap exists in neither.
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

export interface RecorderOptions {
  /** The microphone and camera stream; null records the timeline alone (no sound). */
  stream: MediaStream | null;
}

export interface RecorderResult {
  /** The events and length of this part, on the part's own clock (starting at zero). */
  part: RecordedPart;
  /** The recorded sound and picture; null when nothing was captured. */
  media: Blob | null;
  type: string | null;
  started: Date;
}

/** One recording in progress. */
export class Recorder {
  state: RecorderState = 'idle';
  private readonly _events: TimelineEvent[] = [];
  private readonly _chunks: Blob[] = [];
  private _recorder: MediaRecorder | null = null;
  private _type: string | null = null;
  /** Milliseconds recorded before the current run, and when the current run started (null while paused). */
  private _elapsedBefore = 0;
  private _runStart: number | null = null;
  private _started: Date | null = null;
  readonly video: boolean;

  constructor(private readonly options: RecorderOptions) {
    this.video = Boolean(options.stream?.getVideoTracks().length);
  }

  /** Milliseconds of talk recorded so far, pauses excluded. */
  get elapsed(): number {
    return this._elapsedBefore + (this._runStart === null ? 0 : performance.now() - this._runStart);
  }

  get events(): readonly TimelineEvent[] {
    return this._events;
  }

  /** Start capturing; resolves once the media recorder runs, so the clocks line up. */
  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this._started = new Date();
    const stream = this.options.stream;
    if (stream && stream.getTracks().length) {
      const type = recordingMimeType(this.video);
      if (!type) throw new Error('This browser cannot record audio or video');
      this._type = type;
      const recorder = new MediaRecorder(stream, { mimeType: type });
      this._recorder = recorder;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size) this._chunks.push(event.data);
      });
      await new Promise<void>((resolve, reject) => {
        recorder.addEventListener('start', () => resolve(), { once: true });
        recorder.addEventListener('error', () => reject(new Error('The recording could not start')), { once: true });
        recorder.start(1000);
      });
    }
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
    if (this._recorder?.state === 'recording') this._recorder.pause();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    if (this._recorder?.state === 'paused') this._recorder.resume();
    this._runStart = performance.now();
    this.state = 'recording';
    this._events.push({ t: Math.round(this.elapsed), type: 'cut' });
  }

  /** Stop and hand over the events and the media of this part. */
  async stop(): Promise<RecorderResult> {
    if (this.state === 'idle' || this.state === 'stopping') throw new Error('Nothing is being recorded');
    const duration = Math.round(this.elapsed);
    this._runStart = null;
    this._elapsedBefore = duration;
    this.state = 'stopping';
    const recorder = this._recorder;
    if (recorder && recorder.state !== 'inactive') {
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
    const media = this._chunks.length && this._type ? new Blob(this._chunks, { type: this._type }) : null;
    this.state = 'idle';
    return { part: { events: this._events, duration, media: null }, media, type: this._type, started: this._started ?? new Date() };
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
