/**
 * Video elements: a video texture that remembers its playhead in snapshots,
 * and the animation that plays it for the duration of one clip.
 */
import { Animation, VideoMobject, linear } from 'manim-web';
import type { SnapshotExtra } from './snapshot';

export interface VideoClipOptions {
  width?: number;
  height?: number;
  /** Videos start muted so that playback is never blocked by autoplay rules. */
  muted?: boolean;
}

/** A video on a plane; its current time is part of recorded snapshots. */
export class VideoClip extends VideoMobject implements SnapshotExtra {
  /** Called when a seek has produced a new frame while nothing animates. */
  static onUpdate: (() => void) | null = null;
  private _listening = false;

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

  override async waitForLoad(): Promise<void> {
    await super.waitForLoad();
    const video = this._video;
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
      video.pause();
      video.currentTime = 0;
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
    video.pause();
    if (Math.abs(video.currentTime - state.time) > 0.02) video.currentTime = state.time;
  }
}

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
    element.currentTime = 0;
    const started = element.play();
    if (started && typeof started.catch === 'function') started.catch(() => undefined);
  }

  interpolate(alpha: number): void {
    const element = this.video.element;
    if (!element) return;
    this.video.refresh();
    if (element.paused || alpha >= 1) return;
    // Keep the playhead near the clip's clock when the element stalls or the speed changes.
    const want = alpha * this.duration;
    if (Math.abs(element.currentTime - want) > 0.5) element.currentTime = want;
  }

  override finish(): void {
    const element = this.video.element;
    if (element) {
      element.pause();
      element.currentTime = Math.max(0, this.duration - 0.001);
      this.video.refresh();
    }
    super.finish();
  }
}
