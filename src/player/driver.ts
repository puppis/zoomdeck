/** Real-time replay of recorded clip operations. */
import type { Clip, Op, Presenter } from '../runtime';
import type { Stage } from './stage';

export type ReplayResult = 'done' | 'cancelled';

/** Drives recorded operations with requestAnimationFrame, honouring speed. */
export class LiveRunner {
  speed = 1;
  private _token = 0;
  private _cancel: (() => void) | null = null;

  constructor(private readonly stage: Stage, private readonly presenter: Presenter) {}

  get running(): boolean {
    return this._cancel !== null;
  }

  cancel(): void {
    this._token += 1;
    this._cancel?.();
    this._cancel = null;
  }

  private _restoreMembership(op: Op): void {
    const ctx = this.presenter.contexts.get(op.slide);
    if (ctx) ctx.mobjects = [...op.membership];
  }

  /** Replay one clip from the state recorded before it. */
  async replay(clip: Clip, rate = 1): Promise<ReplayResult> {
    this.cancel();
    const token = this._token;
    for (const op of clip.ops) {
      if (token !== this._token) return 'cancelled';
      this._restoreMembership(op);
      op.reset();
      op.begin();
      if (op.duration <= 0) {
        if (op.kind === 'wait') op.update(0);
        op.interpolate(1);
      } else {
        const result = await this._animate(op, rate, token);
        if (result === 'cancelled') return 'cancelled';
      }
      op.finish();
      op.cleanUp();
      this.stage.render();
    }
    return token === this._token ? 'done' : 'cancelled';
  }

  /**
   * Play one clip backwards, from its settled end state to the state before it.
   * `restoreStart` puts the scene at the clip's start; each op is then brought
   * to its own start and driven from alpha 1 down to 0. Ops that cannot run
   * backwards are passed over instantly.
   */
  async replayReverse(clip: Clip, rate: number, restoreStart: () => void): Promise<ReplayResult> {
    this.cancel();
    const token = this._token;
    const ops = clip.ops;
    for (let k = ops.length - 1; k >= 0; k--) {
      if (token !== this._token) return 'cancelled';
      restoreStart();
      for (let i = 0; i < k; i++) {
        const earlier = ops[i];
        this._restoreMembership(earlier);
        earlier.reset();
        earlier.begin();
        if (earlier.kind === 'wait') earlier.update(earlier.duration);
        earlier.interpolate(1);
        earlier.finish();
        earlier.cleanUp();
      }
      const op = ops[k];
      if (!op.reversible || op.duration <= 0) continue;
      this._restoreMembership(op);
      op.reset();
      op.begin();
      const result = await this._animate(op, rate, token, true);
      if (result === 'cancelled') return 'cancelled';
    }
    if (token !== this._token) return 'cancelled';
    restoreStart();
    this.stage.render();
    return 'done';
  }

  private _animate(op: Op, rate: number, token: number, reverse = false): Promise<ReplayResult> {
    return new Promise((resolve) => {
      let elapsed = 0;
      let last = performance.now();
      let handle: number | null = null;
      let settled = false;
      // Background tabs and hidden panes throttle requestAnimationFrame, so a
      // timer keeps wall-clock progress; whichever fires first advances the op.
      const timer = setInterval(() => tick(performance.now()), 50);
      const finish = (result: ReplayResult) => {
        if (settled) return;
        settled = true;
        if (handle !== null) cancelAnimationFrame(handle);
        clearInterval(timer);
        if (this._cancel === cancel) this._cancel = null;
        resolve(result);
      };
      const cancel = () => finish('cancelled');
      this._cancel = cancel;
      op.interpolate(reverse ? 1 : 0);
      this.stage.render();
      const tick = (now: number) => {
        if (settled) return;
        if (token !== this._token) return finish('cancelled');
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)) * this.speed * rate;
        if (dt <= 0) return;
        last = now;
        elapsed += dt;
        const progress = Math.min(1, elapsed / op.duration);
        if (!reverse) op.update(dt);
        op.interpolate(reverse ? 1 - progress : progress);
        this.stage.render();
        if (progress >= 1) finish('done');
      };
      const loop = (now: number) => {
        handle = null;
        tick(now);
        if (!settled) handle = requestAnimationFrame(loop);
      };
      handle = requestAnimationFrame(loop);
    });
  }
}
