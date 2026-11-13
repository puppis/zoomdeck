/**
 * Replaying a recorded talk: the recording's sound or video is the clock, and the timeline's
 * events are applied to the deck as the clock passes them. Seeking rebuilds the state at the
 * target time from the events before it, which the deterministic deck makes cheap.
 */
import type { NavigationData } from '../runtime';
import type { Player } from './player';
import { eventsBetween, mediaAt, stateAt, stopIndex, type Timeline, type TimelineEvent, type TimelineMedia, type TimelineState } from './timeline';

/** What a playback needs from the page: the deck, and the things the player interface controls. */
export interface PlaybackHost {
  navigation: NavigationData;
  player: Player;
  /** The element playing the recording's media, when it has any; its time drives the playback. */
  media: HTMLMediaElement | null;
  /** The URL of a media part's file. */
  mediaUrl?: (part: TimelineMedia) => string;
  /** Apply an event other than a navigation; `instant` means no animation (a seek is rebuilding state). */
  apply(event: TimelineEvent, instant: boolean): void;
  /** Remove every stroke from both surfaces before a seek replays the ink. */
  resetInk(): void;
  onTime?: (time: number) => void;
  onEnd?: () => void;
  /** A stop the recording names is gone from the deck. */
  onMissingStop?: (key: string) => void;
}

export class Playback {
  /** The settled state at the playback's clock, for the export and the controls. */
  state: TimelineState;
  private _playing = false;
  private _last = 0;
  /** The dispatch timer: a plain interval, which keeps running (slowly) in a background tab, unlike animation frames. */
  private _timer: number | null = null;
  private readonly _onTimeUpdate = () => this._tick();
  /** Clock for a recording without media: when the current run started, in performance time, and the time it started from. */
  private _runStart: number | null = null;
  private _runFrom = 0;
  /** The media part loaded in the element. */
  private _part: TimelineMedia | null = null;
  private readonly _onEnded = () => this._partEnded();

  constructor(readonly timeline: Timeline, private readonly host: PlaybackHost) {
    this.state = stateAt([], 0);
    host.media?.addEventListener('ended', this._onEnded);
    host.media?.addEventListener('timeupdate', this._onTimeUpdate);
  }

  get duration(): number {
    return this.timeline.duration;
  }

  get playing(): boolean {
    return this._playing;
  }

  /** Milliseconds into the recording. */
  get time(): number {
    const media = this.host.media;
    // A part's clock stops at the part's end: the element may report a little past it before it ends.
    if (media && this._part) return Math.min(this.duration, this._part.start + Math.min(this._part.duration, media.currentTime * 1000));
    if (this._runStart === null) return this._runFrom;
    return Math.min(this.duration, this._runFrom + performance.now() - this._runStart);
  }

  /** Load the media part that covers `time` into the element, when it is not the current one, and position it. */
  private _loadPart(time: number): void {
    const media = this.host.media;
    if (!media) return;
    const part = mediaAt(this.timeline.media, time);
    if (!part) return;
    if (part !== this._part) {
      this._part = part;
      media.src = this.host.mediaUrl ? this.host.mediaUrl(part) : part.file;
      media.load();
    }
    media.currentTime = Math.max(0, (time - part.start) / 1000);
  }

  async play(): Promise<void> {
    if (this._playing) return;
    if (this.time >= this.duration) this.seek(0);
    this._playing = true;
    const media = this.host.media;
    if (media) {
      if (!this._part) this._loadPart(0);
      try {
        await media.play();
      } catch {
        this._playing = false;
        return;
      }
    } else {
      this._runFrom = this.time;
      this._runStart = performance.now();
    }
    if (this._timer === null) this._timer = window.setInterval(() => this._tick(), 30);
  }

  pause(): void {
    if (!this._playing) return;
    this._playing = false;
    const media = this.host.media;
    if (media) media.pause();
    else {
      this._runFrom = this.time;
      this._runStart = null;
    }
    this._stopTimer();
    this.host.player.runner.cancel();
  }

  private _stopTimer(): void {
    if (this._timer !== null) clearInterval(this._timer);
    this._timer = null;
  }

  toggle(): void {
    if (this._playing) this.pause();
    else void this.play();
  }

  /** Jump to a time: rebuild the state the events leave there, then carry on from it. */
  seek(time: number): void {
    const target = Math.max(0, Math.min(this.duration, time));
    const wasPlaying = this._playing;
    if (wasPlaying) this.pause();
    if (this.host.media) this._loadPart(target);
    else this._runFrom = target;
    const events = this.timeline.events;
    const state = stateAt(events, target);
    this.state = state;
    const player = this.host.player;
    if (state.stop) {
      const index = stopIndex(this.host.navigation, state.stop);
      if (index === null) this.host.onMissingStop?.(state.stop.key);
      else void player.goTo(index, false);
    }
    player.speed = state.speed;
    // Ink is replayed op by op; strokes on a slide vanish when another slide is entered, as they did live.
    this.host.resetInk();
    let slide = events.find((event): event is Extract<TimelineEvent, { type: 'go' }> => event.type === 'go')?.stop.key ?? null;
    for (const event of events) {
      if (event.t > target) break;
      if (event.type === 'ink') this.host.apply(event, true);
      else if ((event.type === 'go' || event.type === 'rewind') && event.stop.key !== slide) {
        slide = event.stop.key;
        this.host.apply({ t: event.t, type: 'ink', surface: 'slide', op: { op: 'replace', strokes: [] } }, true);
      }
    }
    this.host.apply({ t: target, type: 'board', on: state.board }, true);
    this.host.apply({ t: target, type: 'pan', x: state.pan.x, y: state.pan.y }, true);
    this.host.apply({ t: target, type: 'camera', on: state.camera }, true);
    if (state.pointer) this.host.apply({ t: target, type: 'pointer', ...state.pointer }, true);
    else this.host.apply({ t: target, type: 'pointer-off' }, true);
    this._last = target;
    this.host.onTime?.(target);
    if (wasPlaying) void this.play();
  }

  /** Stop following the recording and release the media element. */
  dispose(): void {
    this.pause();
    this.host.media?.removeEventListener('ended', this._onEnded);
    this.host.media?.removeEventListener('timeupdate', this._onTimeUpdate);
  }

  /** Apply what the clock has passed; called by the timer and by the media element's own progress events. */
  private _tick(): void {
    if (!this._playing) return;
    const now = this.time;
    this._advance(now);
    this.host.onTime?.(now);
    if (now >= this.duration) this._end();
  }

  /** Apply the events the clock has passed since the last frame. */
  private _advance(now: number): void {
    const due = eventsBetween(this.timeline.events, this._last, now);
    this._last = now;
    if (!due.length) return;
    const player = this.host.player;
    for (const event of due) {
      switch (event.type) {
        case 'go': {
          const index = stopIndex(this.host.navigation, event.stop);
          if (index === null) this.host.onMissingStop?.(event.stop.key);
          else void player.goTo(index, event.autoplay);
          break;
        }
        case 'rewind': {
          const index = stopIndex(this.host.navigation, event.stop);
          if (index === null) this.host.onMissingStop?.(event.stop.key);
          else void player.rewindTo(index);
          break;
        }
        case 'speed': player.speed = event.value; break;
        case 'cut': break;
        default: this.host.apply(event, false);
      }
      this._fold(event);
    }
  }

  /** Keep `state` in step with the events applied. */
  private _fold(event: TimelineEvent): void {
    const state = this.state;
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

  /** A media part ran out: the next one follows, or the talk is over. */
  private _partEnded(): void {
    if (!this._playing || !this._part) return;
    const next = this.timeline.media[this.timeline.media.indexOf(this._part) + 1];
    if (!next) {
      this._end();
      return;
    }
    this._advance(next.start);
    this._loadPart(next.start);
    void this.host.media?.play().catch(() => this._end());
  }

  private _end(): void {
    if (!this._playing) return;
    this._advance(this.duration);
    this._playing = false;
    this._runStart = null;
    this._runFrom = this.duration;
    this._stopTimer();
    this.host.onTime?.(this.duration);
    this.host.onEnd?.();
  }
}
