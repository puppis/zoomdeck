/** Code-authored slides imported by the tour through `[[import: Orbit ...]]`. */
import { BLUE_E, Circle, Dot, GOLD_E, MoveAlongPath, Text, linear } from 'manim-web';
import { PageImage, Slide, loadPdfJs, type SlideContext } from 'zoomdeck';

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

/** The first page of a PDF typeset elsewhere, drawn by pdf.js at the density of the screen. */
const PAPER = new URL('./assets/slides.pdf', import.meta.url).href;

export class PaperPage extends Slide {
  constructor() {
    super('A PDF page', { width: 16, height: 9 });
  }

  override async build(ctx: SlideContext): Promise<void> {
    const { getDocument } = await loadPdfJs();
    const page = await (await getDocument({ url: PAPER }).promise).getPage(1);
    ctx.add(new PageImage(page, { width: this.width, height: this.height }));
  }
}
