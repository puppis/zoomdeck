/** Real-time replay of recorded clip operations. */
import type { Clip, Op, Presenter } from '../runtime';
import type { Stage } from './stage';

export type ReplayResult = 'done' | 'cancelled';

/** How long without an animation frame before the timer takes over the ticks (frames are being throttled). */
const FRAME_STALL_MS = 100;

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

  /**
   * Replay one clip from the state recorded before it. The clip's settled end is not drawn here:
   * the player restores the stop's recorded state after a replay that is done and draws that, in
   * the same task, so a picture drawn here would be replaced before it is shown.
   */
  async replay(clip: Clip, rate = 1): Promise<ReplayResult> {
    this.cancel();
    const token = this._token;
    const lastOp = clip.ops[clip.ops.length - 1];
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
      if (op !== lastOp) this.stage.render();
    }
    return token === this._token ? 'done' : 'cancelled';
  }

  /**
   * Play one clip backwards, from its settled end state to the state before it.
   * `restoreStart` puts the scene at the clip's start; each op is then brought
   * to its own start and driven from alpha 1 down to 0. Ops that cannot run
   * backwards are passed over instantly. As with `replay`, the settled state is
   * drawn by the player, which restores the target stop and draws it in the same task.
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
    return 'done';
  }

  private _animate(op: Op, rate: number, token: number, reverse = false): Promise<ReplayResult> {
    return new Promise((resolve) => {
      let elapsed = 0;
      let last = performance.now();
      let handle: number | null = null;
      let settled = false;
      // Background tabs and hidden panes throttle requestAnimationFrame, so a timer keeps
      // wall-clock progress while no frame has come for a while. While frames come, they alone
      // advance the op: a tick from the timer would draw a picture that the next frame replaces
      // before it is ever shown.
      let lastFrame = performance.now();
      const timer = setInterval(() => {
        const now = performance.now();
        if (now - lastFrame >= FRAME_STALL_MS) tick(now);
      }, 50);
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
        // The op's last step is drawn by what follows it in this same task (the next op's start,
        // the end of a clip, or the player's settled state), so it is not drawn twice.
        if (progress >= 1) return finish('done');
        this.stage.render();
      };
      const loop = (now: number) => {
        handle = null;
        lastFrame = performance.now();
        tick(now);
        if (!settled) handle = requestAnimationFrame(loop);
      };
      handle = requestAnimationFrame(loop);
    });
  }
}
