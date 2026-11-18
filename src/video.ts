/**
 * Video elements: a video texture that remembers its playhead in snapshots,
 * and the animation that plays it for the duration of one clip.
 */
import { Animation, VideoMobject, linear } from 'manim-web';
import type { SnapshotExtra } from './snapshot';

/** How a video element is made: its source, size and poster. */
export interface VideoClipOptions {
  width?: number;
  height?: number;
  /** Videos start muted so that playback is never blocked by autoplay rules. */
  muted?: boolean;
}

/**
 * What an offline render learns about videos: when a clip starts playing and when it stops, on
 * the page's clock (milliseconds), with its source and whether it is muted, so that the sound
 * of an unmuted clip can be laid into the rendered file at the right place.
 */
export interface VideoRenderHooks {
  onPlay?(clip: VideoClip, info: { src: string; start: number; muted: boolean }): void;
  onStop?(clip: VideoClip, end: number): void;
}

/** A video on a plane; its current time is part of recorded snapshots. */
export class VideoClip extends VideoMobject implements SnapshotExtra {
  /** Called when a seek has produced a new frame while nothing animates. */
  static onUpdate: (() => void) | null = null;
  /**
   * Set while a talk is rendered off the clock: the element is then never played, since the
   * page's clock no longer runs at the speed of its media clock; the playing animation seeks it
   * to the frame of the moment instead, and whoever draws waits for the frame (`settle`).
   */
  static render: VideoRenderHooks | null = null;
  /** Whether a playing animation has this clip running, for the render hooks. */
  private _playing = false;
  /** Seeks under way after a state was restored, for whoever must wait for their frames. */
  private static readonly _seeking = new Set<Promise<void>>();
  private _listening = false;

  /** Resolve once every restored video shows the frame it was asked for (or gave up after a while). */
  static async settle(): Promise<void> {
    while (VideoClip._seeking.size) await Promise.all([...VideoClip._seeking]);
  }

  /** Move the element to `time` and remember the seek until its frame arrives. */
  private _seekTo(time: number): void {
    const video = this._video;
    if (!video) return;
    this._lastSeek = time;
    const seek = new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener('seeked', done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 1500);
      video.addEventListener('seeked', done);
    }).finally(() => VideoClip._seeking.delete(seek));
    VideoClip._seeking.add(seek);
    video.currentTime = time;
  }

  private _lastSeek: number | null = null;

  /** Show the frame at `time` (seconds), waited for by `settle`; a time already shown is left alone. */
  seekTo(time: number): void {
    const video = this._video;
    if (!video) return;
    if (this._lastSeek !== null && Math.abs(this._lastSeek - time) < 1e-3 && Math.abs(video.currentTime - time) < 0.02) return;
    this._seekTo(time);
  }

  /** A playing animation starts this clip (`start` on the page's clock, milliseconds), told to a render under way. */
  renderPlaying(start: number): void {
    if (this._playing) return;
    this._playing = true;
    const video = this._video;
    VideoClip.render?.onPlay?.(this, { src: video?.currentSrc || video?.src || '', start, muted: video ? video.muted : true });
  }

  /** The clip stops, told to a render under way. */
  renderStopped(end: number): void {
    if (!this._playing) return;
    this._playing = false;
    VideoClip.render?.onStop?.(this, end);
  }

  constructor(src: string, options: VideoClipOptions = {}) {
    super({
      src,
      width: options.width,
      height: options.height,
      muted: options.muted ?? true,
      loop: false,
      autoplay: false,
      crossOrigin: 'anonymous',
    });
  }

  /** The underlying video element, once loaded. */
  get element(): HTMLVideoElement | null {
    return this._video;
  }

  /** Why the clip could not load, when it could not; the deck goes on with a blank clip. */
  loadFailure: string | null = null;

  /**
   * Wait for the first frame, but never for ever: a browser that cannot decode the file (a
   * Chromium without H.264, say) may report an error or simply never deliver a frame, and
   * neither may hold up the whole deck. After a failure or 8 seconds the clip is left blank,
   * the reason is logged, and a frame that arrives later still shows.
   */
  override async waitForLoad(): Promise<void> {
    const video = this._video;
    if (video) video.preload = 'auto';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<'timeout'>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout('timeout'), 8000);
    });
    try {
      const outcome = await Promise.race([super.waitForLoad().then(() => 'loaded' as const), timeout]);
      if (outcome === 'timeout') this.loadFailure = 'no frame within 8 s (unsupported codec, or the file is still loading)';
    } catch (error) {
      this.loadFailure = (error as Error).message;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (this.loadFailure) console.warn(`[zoomdown] video ${video?.currentSrc || video?.src || ''}: ${this.loadFailure}`);
    if (video && !this._listening) {
      this._listening = true;
      for (const event of ['seeked', 'loadeddata']) {
        video.addEventListener(event, () => {
          this.refresh();
          VideoClip.onUpdate?.();
        });
      }
    }
  }

  /**
   * Upload the element's current frame at the next render. Three.js relies on
   * the browser's frame callbacks for this, which Chrome delivers sparsely for
   * a video element outside the document, so playback and seeks drive it.
   */
  refresh(): this {
    if (this._texture) this._texture.needsUpdate = true;
    return this;
  }

  /** Pause and show the first frame. */
  rewind(): this {
    const video = this._video;
    if (video) {
      if (VideoClip.render) this.renderStopped(performance.now());
      video.pause();
      this._seekTo(0);
      this.refresh();
    }
    return this;
  }

  captureExtra(): unknown {
    const video = this._video;
    return video ? { time: video.currentTime } : null;
  }

  restoreExtra(value: unknown): void {
    const video = this._video;
    const state = value as { time: number } | null;
    if (!video || !state) return;
    if (VideoClip.render) this.renderStopped(performance.now());
    video.pause();
    if (Math.abs(video.currentTime - state.time) > 0.02) this._seekTo(state.time);
  }
}

/** How a video plays when its element appears: how many times, muted or not. */
export interface VideoPlayOptions {
  /** Number of complete plays; zero marks a browser loop, like `RasterMovie`. */
  plays?: number;
  duration?: number;
}

/** Play a video from its start for one clip; the element advances on its own. */
export class VideoPlay extends Animation {
  /** Videos cannot be scrubbed backwards reliably; reverse navigation jumps over them. */
  readonly irreversible = true;
  readonly plays: number;

  constructor(readonly video: VideoClip, options: VideoPlayOptions = {}) {
    const natural = video.duration;
    super(video, { duration: options.duration ?? (Number.isFinite(natural) && natural > 0 ? natural : 1), rateFunc: linear });
    this.plays = options.plays ?? 1;
  }

  override begin(): void {
    super.begin();
    const element = this.video.element;
    if (!element) return;
    if (VideoClip.render) {
      // Off the clock: the frames are asked for one by one, and the render learns when the clip runs.
      element.pause();
      this.video.seekTo(0);
      this.video.renderPlaying(performance.now());
      return;
    }
    element.currentTime = 0;
    const started = element.play();
    if (started && typeof started.catch === 'function') started.catch(() => undefined);
  }

  interpolate(alpha: number): void {
    const element = this.video.element;
    if (!element) return;
    if (VideoClip.render) {
      this.video.seekTo(Math.max(0, Math.min(this.duration - 0.001, alpha * this.duration)));
      this.video.refresh();
      return;
    }
    this.video.refresh();
    if (element.paused || alpha >= 1) return;
    // Keep the playhead near the clip's clock when the element stalls or the speed changes.
    const want = alpha * this.duration;
    if (Math.abs(element.currentTime - want) > 0.5) element.currentTime = want;
  }

  override finish(): void {
    const element = this.video.element;
    if (element) {
      if (VideoClip.render) this.video.renderStopped(performance.now());
      element.pause();
      if (VideoClip.render) this.video.seekTo(Math.max(0, this.duration - 0.001));
      else element.currentTime = Math.max(0, this.duration - 0.001);
      this.video.refresh();
    }
    super.finish();
  }
}
