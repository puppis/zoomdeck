/**
 * Rendering a recorded talk off the clock. The page's clock is replaced by a virtual one that
 * the renderer advances frame by frame, so the deck's animations, the playback's events and
 * the text sharpening all run as fast as the machine draws, not as long as the talk lasted.
 * Only the deck is drawn here: the slides or the whiteboard with their ink and the pointer,
 * as the export draws them, at the chosen width. A frame is sent to the server only when the
 * picture changed; the camera, the screen and the sound are in the talk's bundle already, and
 * the server lays them over the deck frames with ffmpeg, following the plan sent at the end.
 */
import { drawFrame, type ExportSource } from './export';
import { PageImage } from '../pdfdeck';
import { RasterImage } from '../raster';
import { VideoClip } from '../video';
import type { Playback } from './playback';
import type { Player } from './player';
import type { Stage } from './stage';
import { presentedAspect, screenIntervals, type Corner, type Timeline, type TimelineEvent } from './timeline';

/** The page's clock under the renderer's control. */
export interface VirtualClock {
  /** Milliseconds since the clock was installed. */
  readonly now: number;
  /** Run every timer due up to `ms`, in order, then one animation frame at `ms`. */
  advanceTo(ms: number): Promise<void>;
  /** Give the page its real clock back. */
  uninstall(): void;
}

interface VirtualTimer {
  due: number;
  run: () => void;
  interval: number | null;
}

/** A real macrotask boundary, unthrottled in background tabs (unlike a timer). */
function realYield(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

/**
 * Replace `performance.now`, `Date.now`, the timers and the animation frames of the page by a
 * clock that stands still until `advanceTo` moves it. Timers fire in order of their due time,
 * each at its own time, and animation frames run once per advance, at the target time; promise
 * chains get to settle after each. The clock starts at zero.
 */
export function installVirtualClock(): VirtualClock {
  const original = {
    now: performance.now.bind(performance),
    dateNow: Date.now,
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };
  const epoch = original.dateNow();
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, VirtualTimer>();
  const frames = new Map<number, FrameRequestCallback>();
  const callable = (handler: TimerHandler, args: unknown[]) => (typeof handler === 'function' ? () => (handler as (...a: unknown[]) => void)(...args) : () => undefined);
  performance.now = () => now;
  Date.now = () => epoch + now;
  window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    const id = nextId++;
    timers.set(id, { due: now + Math.max(0, Number(delay) || 0), run: callable(handler, args), interval: null });
    return id;
  }) as typeof window.setTimeout;
  window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    const id = nextId++;
    const interval = Math.max(1, Number(delay) || 0);
    timers.set(id, { due: now + interval, run: callable(handler, args), interval });
    return id;
  }) as typeof window.setInterval;
  window.clearTimeout = ((id?: number) => { if (id !== undefined) timers.delete(id); }) as typeof window.clearTimeout;
  window.clearInterval = window.clearTimeout as typeof window.clearInterval;
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id: number) => { frames.delete(id); };
  return {
    get now() {
      return now;
    },
    async advanceTo(target) {
      // Timers first, each at its own time, so that a timer set by another lands in order; a
      // page that keeps setting zero-delay timers is cut off rather than looped on forever.
      for (let guard = 0; guard < 10_000; guard++) {
        let next: [number, VirtualTimer] | null = null;
        for (const entry of timers) if (entry[1].due <= target && (!next || entry[1].due < next[1].due)) next = entry;
        if (!next) break;
        const [id, timer] = next;
        now = Math.max(now, timer.due);
        if (timer.interval === null) timers.delete(id);
        else timer.due = now + timer.interval;
        try {
          timer.run();
        } catch (error) {
          console.error(error);
        }
        await Promise.resolve();
      }
      now = target;
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) {
        try {
          callback(now);
        } catch (error) {
          console.error(error);
        }
      }
      await realYield();
    },
    uninstall() {
      performance.now = original.now;
      Date.now = original.dateNow;
      window.setTimeout = original.setTimeout as typeof window.setTimeout;
      window.clearTimeout = original.clearTimeout;
      window.setInterval = original.setInterval as typeof window.setInterval;
      window.clearInterval = original.clearInterval;
      window.requestAnimationFrame = original.requestAnimationFrame;
      window.cancelAnimationFrame = original.cancelAnimationFrame;
      timers.clear();
      frames.clear();
    },
  };
}

/** The sizes a video may be rendered at, named as players and sites name them, by the height of a 16:9 frame. */
export const VIDEO_HEIGHTS: Array<[number, string]> = [[1080, '1080p (Full HD)'], [1440, '1440p (QHD)'], [2160, '2160p (4K)']];

/** The frame width for a video of `height` in the proportions `aspect` (width over height), even. */
export function videoWidthFor(height: number, aspect: number): number {
  return Math.max(2, Math.round((height * aspect) / 2) * 2);
}

/** How the frame's proportions are chosen: as the deck was presented (the recorded stage), the deck's own, or 16:9. */
export type AspectChoice = 'presented' | 'deck' | 'wide';

/** The frame's proportions for a choice; `presented` falls back to the deck's for a recording that kept none. */
export function frameAspect(choice: AspectChoice, timeline: Timeline, deckAspect: number): number {
  if (choice === 'wide') return 16 / 9;
  if (choice === 'presented') return presentedAspect(timeline.events, timeline.duration) ?? deckAspect;
  return deckAspect;
}

/** The size of a video's frame: `size` is a standard height (1080, 1440, 2160) or 'display' for the display's own width, in the proportions `aspect`. */
export function frameSize(size: number | 'display', aspect: number): { width: number; height: number } {
  const width = size === 'display' ? displayWidth() : videoWidthFor(size, aspect);
  return { width, height: Math.max(2, Math.round(width / aspect / 2) * 2) };
}

/** The width of this display in device pixels, even, between 1280 and 3840, for a video sized exactly as the presenter's screen. */
export function displayWidth(): number {
  const pixels = Math.round((typeof screen !== 'undefined' && screen.width ? screen.width : 1920) * (typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1));
  return Math.min(3840, Math.max(1280, Math.round(pixels / 2) * 2));
}

/** The parts of the intervals `a` that lie outside the intervals `b`. */
export function subtractIntervals(a: Array<[number, number]>, b: Array<[number, number]>): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (const [from, to] of a) {
    let cursor = from;
    for (const [cutFrom, cutTo] of [...b].sort((x, y) => x[0] - y[0])) {
      if (cutTo <= cursor || cutFrom >= to) continue;
      if (cutFrom > cursor) result.push([cursor, cutFrom]);
      cursor = Math.max(cursor, cutTo);
    }
    if (cursor < to) result.push([cursor, to]);
  }
  return result;
}

/**
 * The stretches of a talk during which the camera's corner picture is left out, in milliseconds:
 * while the pointer set it aside, and while the filmed screen showed the camera's floating window.
 */
export function cornerHiddenIntervals(events: TimelineEvent[], duration: number): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];
  let since: number | null = null;
  let aside = false;
  let inScreen = false;
  for (const event of events) {
    if (event.type === 'corner') aside = event.hidden;
    else if (event.type === 'camera-in-screen') inScreen = event.on;
    else continue;
    const hidden = aside || inScreen;
    if (hidden && since === null) since = event.t;
    else if (!hidden && since !== null) {
      if (event.t > since) intervals.push([since, event.t]);
      since = null;
    }
  }
  if (since !== null && duration > since) intervals.push([since, duration]);
  return intervals;
}

/** The stretches of a talk during which the camera fills the frame, in milliseconds. */
export function cameraIntervals(events: TimelineEvent[], duration: number): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];
  let since: number | null = null;
  for (const event of events) {
    if (event.type !== 'camera') continue;
    if (event.on && since === null) since = event.t;
    else if (!event.on && since !== null) {
      if (event.t > since) intervals.push([since, event.t]);
      since = null;
    }
  }
  if (since !== null && duration > since) intervals.push([since, duration]);
  return intervals;
}

/** One media file of the talk, as the server lays it over the deck frames. */
export interface RenderPlanMedia {
  file: string;
  /** Milliseconds on the talk's clock. */
  start: number;
  duration: number;
  video: boolean;
  source: 'camera' | 'screen';
  /** The lane: absent for the camera lane; 'screen' for the filmed screen, 'system' for the computer's sound (no picture). */
  lane?: 'screen' | 'system';
}

/** A video inside a slide that played with its sound on: its file and the stretch of the talk it ran for, from its start. */
export interface RenderPlanClip {
  /** The URL the page loaded the video from. */
  src: string;
  /** Milliseconds on the talk's clock. */
  start: number;
  duration: number;
}

/** What the server needs to compose the video: the frame rate and size of the deck frames, the media and where they go. */
export interface RenderPlan {
  fps: number;
  width: number;
  height: number;
  /** The talk's length in milliseconds. */
  duration: number;
  pip: { corner: Corner; size: number };
  media: RenderPlanMedia[];
  /** When the camera fills the frame instead of sitting in its corner. */
  full: Array<[number, number]>;
  /** When the corner picture was set aside, the pointer over it: the camera is not laid over the frame then. */
  cornerHidden?: Array<[number, number]>;
  /** The slides' own videos that played unmuted, for their sound. */
  clips: RenderPlanClip[];
}

/** The plan for a timeline rendered at `width` pixels and `fps` frames a second. */
export function renderPlan(timeline: Timeline, aspect: number, width: number, fps: number, clips: RenderPlanClip[] = []): RenderPlan {
  return {
    fps,
    width,
    height: Math.round(width / aspect / 2) * 2,
    duration: timeline.duration,
    pip: timeline.pip,
    media: timeline.media.map((part) => ({ file: part.file, start: part.start, duration: part.duration, video: part.video, source: part.source ?? 'camera', ...(part.lane === 'screen' || part.lane === 'system' ? { lane: part.lane } : {}) })),
    // While the screen is filmed it fills the frame; the camera keeps its corner over it, never the frame.
    full: subtractIntervals(cameraIntervals(timeline.events, timeline.duration), screenIntervals(timeline.media)),
    cornerHidden: cornerHiddenIntervals(timeline.events, timeline.duration),
    clips,
  };
}

/** Collects the stretches during which the slides' videos played, from the clips' own reports, for the plan. */
export class ClipLog {
  private readonly _open = new Map<unknown, { src: string; start: number; muted: boolean }>();
  readonly clips: RenderPlanClip[] = [];

  played(clip: unknown, info: { src: string; start: number; muted: boolean }): void {
    this._open.set(clip, info);
  }

  stopped(clip: unknown, end: number): void {
    const info = this._open.get(clip);
    if (!info) return;
    this._open.delete(clip);
    if (!info.muted && info.src && end - info.start >= 50) this.clips.push({ src: info.src, start: Math.round(info.start), duration: Math.round(end - info.start) });
  }

  /** Close what is still playing at the end of the talk. */
  finish(end: number): RenderPlanClip[] {
    for (const clip of [...this._open.keys()]) this.stopped(clip, end);
    return this.clips.sort((a, b) => a.start - b.start);
  }
}

export interface RenderOptions {
  width?: number;
  /** The frame's proportions; the deck's when absent. */
  aspect?: number;
  fps?: number;
  /** Receives each frame: the picture when it changed, null when the previous one holds; `t` in milliseconds. */
  onFrame(blob: Blob | null, t: number, index: number): Promise<void> | void;
  onProgress?(fraction: number): void;
  /** Checked between frames; true abandons the render. */
  cancelled?(): boolean;
}

/** What a render produced: how many frames were sent (changed pictures) and the slides' videos that played with sound. */
export interface RenderResult {
  frames: number;
  clips: RenderPlanClip[];
}

/**
 * Render the deck frames of a talk off the clock. `playback` must have no media element: its
 * clock is then the page's, which the virtual clock drives; `source` draws as the export does.
 * Resolves with what was rendered, or null when cancelled.
 */
export async function renderTalk(playback: Playback, player: Player, stage: Stage, source: Omit<ExportSource, 'stage' | 'camera'>, options: RenderOptions): Promise<RenderResult | null> {
  const fps = options.fps ?? 30;
  const width = options.width ?? 1920;
  const aspect = options.aspect ?? source.aspect;
  const height = Math.round(width / aspect / 2) * 2;
  const duration = playback.duration;
  const frames = Math.max(1, Math.ceil((duration / 1000) * fps));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No drawing context');
  let sent = 0;
  let cancelled = false;
  const log = new ClipLog();
  await stage.atPrintSize(width, height, async (capture) => {
    const clock = installVirtualClock();
    // Videos in the slides seek to each frame instead of playing, and say when they run.
    VideoClip.render = { onPlay: (clip, info) => log.played(clip, info), onStop: (clip, end) => log.stopped(clip, end) };
    try {
      playback.seek(0);
      await playback.play();
      let lastRenders = -1;
      let lastSignature = '';
      for (let index = 0; index < frames; index++) {
        if (options.cancelled?.()) {
          cancelled = true;
          return;
        }
        const t = Math.min(duration, Math.round((index * 1000) / fps));
        await clock.advanceTo(t);
        // Pictures decode and pages draw after the fact: wait for what this frame shows.
        await RasterImage.settle();
        await VideoClip.settle();
        await PageImage.settle();
        const state = playback.state;
        const ink = (['slide', 'board'] as const).map((surface) => source.strokes(surface).reduce((total, stroke) => total + stroke.samples.length + 1, 0)).join(',');
        const signature = `${state.board}|${state.pan.x},${state.pan.y}|${state.pointer ? `${state.pointer.mode},${state.pointer.x},${state.pointer.y},${state.pointer.r}` : ''}|${ink}`;
        const changed = index === 0 || stage.renders !== lastRenders || signature !== lastSignature || player.runner.running;
        if (!changed) {
          await options.onFrame(null, t, index);
          continue;
        }
        const shot = capture();
        drawFrame(context, width, height, { ...source, frameAspect: aspect, camera: null, stage: () => ({ canvas: shot, sx: 0, sy: 0, sw: shot.width, sh: shot.height }) }, state);
        lastRenders = stage.renders;
        lastSignature = signature;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('A frame could not be encoded');
        sent += 1;
        await options.onFrame(blob, t, index);
        options.onProgress?.(t / Math.max(1, duration));
      }
      options.onProgress?.(1);
    } finally {
      playback.pause();
      log.finish(clock.now);
      VideoClip.render = null;
      clock.uninstall();
    }
  });
  return cancelled ? null : { frames: sent, clips: log.clips };
}

const ENDPOINT = '/__zoomdeck/render';

/** What the server says about rendering: whether it can (ffmpeg), whether it opens render pages itself (the desktop app), and the jobs. */
export interface RenderStatus {
  ffmpeg: boolean;
  desktop: boolean;
  jobs: RenderJob[];
}

export interface RenderJob {
  talk: string;
  output: string;
  /** `interrupted`: left by an earlier run of the server, to be taken up again. */
  status: 'queued' | 'rendering' | 'composing' | 'done' | 'failed' | 'interrupted';
  progress: number;
  error?: string;
  /** The video file in the recordings folder, once done. */
  file?: string;
}

async function call(method: string, base: string, query: Record<string, string>, body?: BodyInit, type?: string): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ deck: base, ...query });
  const response = await fetch(`${ENDPOINT}?${params}`, { method, body, headers: type ? { 'Content-Type': type } : {} });
  const result = (await response.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string } & Record<string, unknown>;
  if (!response.ok || !result.ok) throw new Error(result.error ?? `The server answered ${response.status}`);
  return result;
}

/** Ask the server whether it renders, and about the jobs of one talk or of all. */
export async function renderStatus(base: string, talk?: string): Promise<RenderStatus> {
  const result = await call('GET', base, talk ? { name: talk } : {});
  return { ffmpeg: Boolean(result.ffmpeg), desktop: Boolean(result.desktop), jobs: Array.isArray(result.jobs) ? (result.jobs as RenderJob[]) : [] };
}

/**
 * Ask the server to render `talk` into `output` (the video's name without extension): the
 * desktop app opens the render page itself; elsewhere the caller opens `url` in a tab.
 * Resolves with whether the server took it on.
 */
export async function requestRender(base: string, talk: string, output: string, url: string): Promise<boolean> {
  const result = await call('POST', base, { op: 'start', name: talk, as: output, url });
  return Boolean(result.started);
}

/** The page that renders `talk` off the clock into `output`, given the deck page's own URL: the size and proportions are resolved there, where the timeline is. */
export function renderPageUrl(talk: string, output: string, size: number | 'display', aspect: AspectChoice, fps = 30): string {
  const url = new URL(location.href);
  url.searchParams.set('render', talk);
  url.searchParams.set('as', output);
  url.searchParams.set('fps', String(fps));
  url.searchParams.set('size', String(size));
  url.searchParams.set('aspect', aspect);
  url.hash = '';
  return url.href;
}

/** A render in progress, as the page sends it to the server: frames as they come, then the plan. */
export class RenderSession {
  private _inFlight = new Set<Promise<void>>();
  private _failure: Error | null = null;

  constructor(readonly base: string, readonly talk: string, readonly output: string) {}

  get failure(): Error | null {
    return this._failure;
  }

  /** Begin: the server makes room for the frames. */
  async open(): Promise<void> {
    await call('POST', this.base, { op: 'open', name: this.talk, as: this.output });
  }

  /** Send frame `index`, shown from `t` milliseconds; a few go out at once, so rendering need not wait for the network. */
  async frame(index: number, t: number, blob: Blob): Promise<void> {
    if (this._failure) throw this._failure;
    while (this._inFlight.size >= 4) await Promise.race(this._inFlight);
    const sending = call('POST', this.base, { op: 'frame', as: this.output, n: String(index), t: String(t) }, blob, 'image/png')
      .then(() => undefined, (error: Error) => { this._failure = error; });
    this._inFlight.add(sending);
    void sending.finally(() => this._inFlight.delete(sending));
  }

  /** Tell the server how far the rendering is, for the list of talks. */
  async progress(fraction: number): Promise<void> {
    await call('POST', this.base, { op: 'progress', as: this.output, value: String(fraction) }).catch(() => undefined);
  }

  /** All frames are out: the server composes the video from them, the media and the plan. */
  async finish(plan: RenderPlan): Promise<void> {
    await Promise.all(this._inFlight);
    if (this._failure) throw this._failure;
    await call('POST', this.base, { op: 'finish', as: this.output }, JSON.stringify(plan), 'application/json');
  }

  /** Give up: the server drops the frames. */
  async cancel(): Promise<void> {
    await call('POST', this.base, { op: 'cancel', as: this.output }).catch(() => undefined);
  }
}
