/** The smallest useful tree, authored entirely in logical coordinates. */
import { BLUE, Dot, FadeIn, Text } from 'manim-web';
import { Slide, defineDeck, type SlideContext } from '../src/index';

class Topic extends Slide {
  override build(ctx: SlideContext): void {
    ctx.add(new Text({ color: ctx.foreground, text: this.name, fontSize: 42 }).moveTo([0, 3, 0]));
  }

  override async construct(ctx: SlideContext): Promise<void> {
    const dot = new Dot({ point: [-3, 0, 0], radius: 0.3, color: BLUE });
    await ctx.play(new FadeIn(dot));
    ctx.stop();
    await ctx.play(dot.animate.shift([6, 0, 0]));
  }
}

export default defineDeck({
  title: 'Minimal',
  deck: () => {
    const root = new Slide('Overview', { build: (ctx) => { ctx.add(new Text({ color: ctx.foreground, text: 'Two topics' }).moveTo([0, 3, 0])); } });
    root.addChild(new Topic('Left'), { center: [-4, 0, 0], width: 7 });
    root.addChild(new Topic('Right'), { center: [4, 0, 0], width: 7 });
    return root;
  },
});
