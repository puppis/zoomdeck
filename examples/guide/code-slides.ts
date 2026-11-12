/** Code-authored slides imported by the guide through `[[import: Orbit ...]]`. */
import { BLUE_E, Circle, Dot, GOLD_E, MoveAlongPath, Text, linear } from 'manim-web';
import { Slide, type SlideContext } from '../../src/index';

/** A dot travelling once around a circle, then a stop. */
export class Orbit extends Slide {
  override build(ctx: SlideContext): void {
    const path = new Circle({ radius: 2.5, color: BLUE_E });
    const dot = new Dot({ point: [2.5, 0, 0], radius: 0.2, color: GOLD_E });
    ctx.add(new Text({ color: ctx.foreground, text: 'Orbit: a Slide subclass', fontSize: 28 }).moveTo([0, 3.6, 0]), path, dot);
    Object.assign(ctx.objects, { path, dot });
  }

  override async construct(ctx: SlideContext): Promise<void> {
    await ctx.play(new MoveAlongPath(ctx.objects.dot as Dot, { path: ctx.objects.path as Circle }), { runTime: 2, rateFunc: linear });
    ctx.stop();
  }
}
