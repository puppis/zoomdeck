/**
 * Recording a talk: the microphone, and the camera while it is on, go through MediaRecorder
 * into media files, while the presenter's actions are stamped on the same clock into a
 * timeline. A pause stops both; the gap exists in neither. Turning the camera on or off
 * closes the file so far and begins another on the same clock, since a browser cannot add
 * a picture to a file being written: a part is therefore one or more media files in a row.
 */
import type { MediaLane, RecordedPart, StopRef, TimelineEvent, UntimedEvent } from './timeline';

/** The lanes recorded beside the camera lane, in files that overlap its own. */
export type SideLane = 'screen' | 'system';

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

/**
 * Where the media goes as it is captured, besides memory: the server writing the talk's bundle.
 * A file begins before its first chunk and ends after its last; the sink keeps the order and
 * its own failures (the recorder goes on and keeps everything in memory regardless).
 */
export interface MediaSink {
  /** `index` numbers the files of a recording in the order they begin, from 0: the file's name derives from it, here and in the timeline. */
  begin(capture: { type: string; video: boolean; source: PictureSource; start: number; lane: MediaLane; index: number }): Promise<unknown> | void;
  write(chunk: Blob, lane: MediaLane): Promise<unknown> | void;
  end(lane: MediaLane): Promise<unknown> | void;
}

export interface RecorderOptions {
  /** The microphone (and the camera or the screen, when one is on) at the start; null records the timeline alone (no sound). */
  stream: MediaStream | null;
  /** What the picture in `stream` shows, when it has one. */
  source?: PictureSource;
  /** Receives every media file as it is captured. */
  sink?: MediaSink;
}

/** One media file captured during a part. */
export interface CapturedMedia {
  blob: Blob;
  type: string;
  /** Whether the file has a picture besides the sound, and what it shows. */
  video: boolean;
  source: PictureSource;
  /** The side lane the file belongs to (the screen, or the computer's sound), beside the camera lane and overlapping it; absent for the camera lane. */
  lane?: SideLane;
  /** Where the file begins on the part's clock, and how long it runs there. */
  start: number;
  duration: number;
  /**
   * The file's number among those of the recording, in the order they began, from 0. Files of
   * different lanes overlap, so they end in another order than they begin: the name a file gets
   * where it is written, and in the timeline, both derive from this number.
   */
  index: number;
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
  lane: MediaLane;
  start: number;
  index: number;
}

/** The lane of a captured file as the timeline records it: named for a side lane, absent for the camera lane. */
function laneOf(lane: MediaLane): { lane: SideLane } | Record<string, never> {
  return lane === 'camera' ? {} : { lane };
}

/** One recording in progress. */
export class Recorder {
  state: RecorderState = 'idle';
  private readonly _events: TimelineEvent[] = [];
  private _capture: Capture | null = null;
  /** The side lanes' files being written, beside the camera lane's: the filmed screen, the computer's sound. */
  private readonly _sides: Record<SideLane, Capture | null> = { screen: null, system: null };
  private readonly _captured: CapturedMedia[] = [];
  /** The number the next file gets (see `CapturedMedia.index`). */
  private _nextIndex = 0;
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

  /** The media files so far, the ones being written included (their duration up to now), for a draft of the timeline. */
  get parts(): Array<Omit<CapturedMedia, 'blob'>> {
    const parts: Array<Omit<CapturedMedia, 'blob'>> = this._captured.map(({ type, video, source, lane, start, duration, index }) => ({ type, video, source, ...(lane ? { lane } : {}), start, duration, index }));
    for (const open of this._captures()) {
      if (open.chunks.length) parts.push({ type: open.type, video: open.video, source: open.source, ...laneOf(open.lane), start: open.start, duration: Math.max(0, Math.round(this.elapsed) - open.start), index: open.index });
    }
    return parts;
  }

  /** Whether the screen lane is being written. */
  get filming(): boolean {
    return this._sides.screen !== null;
  }

  /** Whether the system lane (the computer's sound) is being written. */
  get systemSound(): boolean {
    return this._sides.system !== null;
  }

  /** The files being written, in every lane. */
  private _captures(): Capture[] {
    return [this._capture, this._sides.screen, this._sides.system].filter((capture): capture is Capture => capture !== null);
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
    for (const capture of this._captures()) if (capture.recorder.state === 'recording') capture.recorder.pause();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    for (const capture of this._captures()) if (capture.recorder.state === 'paused') capture.recorder.resume();
    this._runStart = performance.now();
    this.state = 'recording';
    this._events.push({ t: Math.round(this.elapsed), type: 'cut' });
  }

  /**
   * Film the screen from now on, beside the camera lane: a video-only file of its own that
   * overlaps the camera lane's files. Nothing happens while the recorder captures nothing (a
   * recording without a microphone keeps the timeline alone).
   */
  startScreen(stream: MediaStream): Promise<void> {
    return this._startSide('screen', stream.getVideoTracks(), 'screen');
  }

  /** Stop filming the screen; the camera lane goes on. */
  stopScreen(): Promise<void> {
    return this._stopSide('screen');
  }

  /**
   * Record the computer's own sound from now on (the audio track of a screen share), in a lane
   * of its own beside the camera lane, whatever the screen lane does; nothing while the
   * recorder captures nothing.
   */
  startSystem(stream: MediaStream): Promise<void> {
    return this._startSide('system', stream.getAudioTracks(), 'camera');
  }

  /** Stop recording the computer's sound. */
  stopSystem(): Promise<void> {
    return this._stopSide('system');
  }

  /** Open a side lane's file from `tracks`, unless the lane is being written or nothing is captured. */
  private _startSide(lane: SideLane, tracks: MediaStreamTrack[], source: PictureSource): Promise<void> {
    const run = async () => {
      if ((this.state !== 'recording' && this.state !== 'paused') || !this._capture || this._sides[lane]) return;
      if (!tracks.length) return;
      this._sides[lane] = await this._openCapture(new MediaStream(tracks), Math.round(this.elapsed), source, lane);
    };
    this._switching = this._switching.then(run, run);
    return this._switching;
  }

  /** Close a side lane's file; the other lanes go on. */
  private _stopSide(lane: SideLane): Promise<void> {
    const run = async () => {
      const capture = this._sides[lane];
      if (!capture) return;
      this._sides[lane] = null;
      await this._closeCapture(capture);
    };
    this._switching = this._switching.then(run, run);
    return this._switching;
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
    for (const lane of ['screen', 'system'] as const) {
      const side = this._sides[lane];
      this._sides[lane] = null;
      if (side) await this._closeCapture(side);
    }
    this.state = 'idle';
    return { part: { events: this._events, duration, media: [] }, media: this._captured, started: this._started ?? new Date() };
  }

  /** Begin the camera lane's media file from `stream` at `start` on the clock; nothing when the stream has no tracks. */
  private async _beginCapture(stream: MediaStream | null, start: number, source: PictureSource): Promise<void> {
    if (!stream || !stream.getTracks().length) return;
    this._capture = await this._openCapture(stream, start, source, 'camera');
  }

  /** Open a media file from `stream` in a lane: the recorder runs, the sink's file is begun. */
  private async _openCapture(stream: MediaStream, start: number, source: PictureSource, lane: MediaLane): Promise<Capture> {
    const video = stream.getVideoTracks().length > 0;
    const type = recordingMimeType(video);
    if (!type) throw new Error('This browser cannot record audio or video');
    // A screen is large and mostly still: a capped bitrate keeps its files within reason.
    const recorder = new MediaRecorder(stream, source === 'screen' && video ? { mimeType: type, videoBitsPerSecond: 2_500_000 } : { mimeType: type });
    // Numbered as it begins, before the sink names it.
    const index = this._nextIndex++;
    const capture: Capture = { recorder, chunks: [], type, video, source, lane, start, index };
    // The sink's file is begun before the first chunk can arrive; a sink that fails is left to itself.
    const sink = this.options.sink;
    if (sink) await Promise.resolve(sink.begin({ type, video, source, start, lane, index })).catch(() => undefined);
    recorder.addEventListener('dataavailable', (event) => {
      if (!event.data.size) return;
      capture.chunks.push(event.data);
      if (sink) void Promise.resolve(sink.write(event.data, lane)).catch(() => undefined);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        recorder.addEventListener('start', () => resolve(), { once: true });
        recorder.addEventListener('error', () => reject(new Error('The recording could not start')), { once: true });
        recorder.start(1000);
      });
    } catch (error) {
      if (sink) await Promise.resolve(sink.end(lane)).catch(() => undefined);
      throw error;
    }
    if (this.state === 'paused') recorder.pause();
    return capture;
  }

  /** Close the camera lane's media file and keep it; resolves with the clock time where it ends. */
  private async _endCapture(): Promise<number> {
    const capture = this._capture;
    this._capture = null;
    if (!capture) return Math.round(this.elapsed);
    return this._closeCapture(capture);
  }

  /** Stop a file's recorder, keep the file with its stretch of the clock, and close the sink's file; resolves with the clock time where it ends. */
  private async _closeCapture(capture: Capture): Promise<number> {
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
      this._captured.push({ blob: new Blob(capture.chunks, { type: capture.type }), type: capture.type, video: capture.video, source: capture.source, ...laneOf(capture.lane), start: capture.start, duration: Math.max(0, end - capture.start), index: capture.index });
    }
    // The last chunk came with the stop event, so the sink's file can close after it.
    const sink = this.options.sink;
    if (sink) await Promise.resolve(sink.end(capture.lane)).catch(() => undefined);
    return end;
  }
}

/** The first navigation event of a recording: where the deck stood when it began. */
export function initialEvents(stop: StopRef | null, board: boolean, pan: { x: number; y: number }, camera: boolean, speed: number, aspect: number | null = null): UntimedEvent[] {
  const events: UntimedEvent[] = [];
  if (aspect && aspect > 0) events.push({ type: 'stage', aspect });
  if (stop) events.push({ type: 'go', stop, autoplay: false });
  if (speed !== 1) events.push({ type: 'speed', value: speed });
  if (board) events.push({ type: 'board', on: true });
  if (pan.x || pan.y) events.push({ type: 'pan', x: pan.x, y: pan.y });
  if (camera) events.push({ type: 'camera', on: true });
  return events;
}
