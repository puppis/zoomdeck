/**
 * Navigation over recorded clips: forward playback, settled previous states,
 * outline jumps, replay, loops and automatic advancement.
 */
import type { NavigationData, Presenter } from '../runtime';
import { LiveRunner } from './driver';
import type { Stage } from './stage';

export type PlayerState = 'loading' | 'paused' | 'playing' | 'looping' | 'finished';

export interface PlayerEvents {
  clipchange: { index: number };
  state: { state: PlayerState; message: string };
  /** A navigation was requested: a stop shown or played, or the current stop rewound to `index`. */
  navigate: { index: number; autoplay: boolean; rewind: boolean };
  speedchange: { value: number };
}

type Listener<K extends keyof PlayerEvents> = (event: PlayerEvents[K]) => void;

export class Player {
  readonly runner: LiveRunner;
  index = 0;
  state: PlayerState = 'paused';
  /** True after the current clip has been played forward to its end. */
  atEnd = true;
  /** Play stops backwards on `previous()`; starts from the deck's presenter setting. */
  reversePlayback: boolean;
  /** Target stop of a reverse replay in progress, or null. */
  private _reversing: number | null = null;
  private _request = 0;
  private readonly _listeners: { [K in keyof PlayerEvents]: Set<Listener<K>> } = {
    clipchange: new Set(),
    state: new Set(),
    navigate: new Set(),
    speedchange: new Set(),
  };

  constructor(
    readonly stage: Stage,
    readonly presenter: Presenter,
    readonly navigation: NavigationData,
  ) {
    this.runner = new LiveRunner(stage, presenter);
    this.reversePlayback = presenter.config.reversePlayback;
  }

  get clips(): NavigationData['clips'] {
    return this.navigation.clips;
  }

  on<K extends keyof PlayerEvents>(type: K, listener: Listener<K>): () => void {
    this._listeners[type].add(listener);
    return () => this._listeners[type].delete(listener);
  }

  private _emit<K extends keyof PlayerEvents>(type: K, event: PlayerEvents[K]): void {
    for (const listener of this._listeners[type]) listener(event);
  }

  private _setState(state: PlayerState, message: string): void {
    this.state = state;
    this._emit('state', { state, message });
  }

  set speed(value: number) {
    if (this.runner.speed === value) return;
    this.runner.speed = value;
    this._emit('speedchange', { value });
  }

  get speed(): number {
    return this.runner.speed;
  }

  /** Index of the first entry clip of a slide, or -1. */
  firstEntry(frameId: number): number {
    return this.clips.findIndex((clip) => clip.slide === frameId && clip.kind === 'entry');
  }

  /**
   * Show clip `next`. With `autoplay`, play it from its recorded start state;
   * otherwise display its settled end state. `hold` keeps a clip that would
   * run straight on into the next (a reveal before a loop) at its own end.
   */
  async goTo(next: number, autoplay = false, hold = false): Promise<void> {
    if (!Number.isInteger(next) || next < 0 || next >= this.clips.length) return;
    const token = ++this._request;
    this.runner.cancel();
    this._reversing = null;
    this.index = next;
    this.atEnd = !autoplay;
    this._emit('navigate', { index: next, autoplay, rewind: false });
    this._emit('clipchange', { index: next });
    const history = this.presenter.history;
    if (!autoplay) {
      history.restore(next);
      this.stage.render();
      this._setState('paused', next === this.clips.length - 1 ? 'Finished' : 'Paused');
      return;
    }
    const clip = history.clips[next];
    for (;;) {
      history.restore(next - 1);
      this._setState(clip.loop ? 'looping' : 'playing', clip.loop ? 'Looping' : 'Playing');
      const result = await this.runner.replay(clip, clip.playbackRate);
      if (token !== this._request || result === 'cancelled') return;
      history.restore(next);
      this.stage.render();
      this.atEnd = true;
      if (clip.loop) continue;
      break;
    }
    if (clip.autoNext && !hold && next < this.clips.length - 1) {
      void this.goTo(next + 1, true);
      return;
    }
    this._setState(next === this.clips.length - 1 ? 'finished' : 'paused', next === this.clips.length - 1 ? 'Finished' : 'Paused');
  }

  /** The stop the player is at or heading to while a reverse replay runs. */
  get settledIndex(): number {
    return this._reversing ?? this.index;
  }

  next(): Promise<void> {
    return this.goTo(this.settledIndex + 1, true);
  }

  /** Go back one stop, playing the current stop's animations backwards when enabled. */
  async previous(): Promise<void> {
    // A press during a reverse replay settles that replay at its target and steps back again.
    const current = this.settledIndex;
    const target = current - 1;
    if (target < 0) return;
    const clip = this.presenter.history.clips[current];
    const canReverse = this.reversePlayback && (this.atEnd || this._reversing !== null)
      && clip && clip.ops.some((op) => op.reversible && op.duration > 0);
    if (!canReverse) return this.goTo(target, false);
    return this.rewindTo(target);
  }

  /** Play the current stop backwards and settle at `target`, the stop before it. */
  async rewindTo(target: number): Promise<void> {
    const current = this.settledIndex;
    const clip = this.presenter.history.clips[current];
    if (target !== current - 1 || !clip) return this.goTo(target, false);
    const token = ++this._request;
    this.runner.cancel();
    this._reversing = target;
    this.index = current;
    this.atEnd = true;
    const history = this.presenter.history;
    history.restore(current);
    this._emit('navigate', { index: target, autoplay: false, rewind: true });
    this._emit('clipchange', { index: target });
    this._setState('playing', 'Rewinding');
    const result = await this.runner.replayReverse(clip, clip.playbackRate, () => history.restore(target));
    if (token !== this._request || result === 'cancelled') return;
    this._reversing = null;
    this.index = target;
    history.restore(target);
    this.stage.render();
    this._setState('paused', 'Paused');
  }

  /**
   * Play the stop the viewer rests on again, from where it began: a stop reached through clips
   * that run straight on (the reveal before a loop) replays from the first of them, and a stop
   * that would itself run on is held at its end, so a replay never moves the counter.
   */
  replay(): Promise<void> {
    const settled = this.settledIndex;
    if (this.clips[settled]?.autoNext) return this.goTo(settled, true, true);
    let from = settled;
    while (from > 0 && this.clips[from - 1].autoNext) from -= 1;
    return this.goTo(from, true);
  }

  home(): Promise<void> {
    return this.goTo(0, false);
  }

  dispose(): void {
    this.runner.cancel();
  }
}
