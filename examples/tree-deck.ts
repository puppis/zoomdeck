/**
 * Ready-to-run example decks:
 * Demo, MovingFrames and AutomaticTree. Choose one with `?deck=...&scene=Demo`.
 */
import {
  BLUE, GREEN, ORANGE, RED, YELLOW, Circle, Dot, FadeIn, FadeOut, Indicate,
  ReplacementTransform, Rotate, Square, Text, ValueTracker, linear,
} from 'manim-web';
import { Slide, defineDeck, type SlideContext, type DeckDefinition } from '../src/index';

export function heading(ctx: SlideContext, text: string): Text {
  return new Text({ text, fontSize: 42, color: ctx.foreground }).moveTo([0, ctx.height / 2 - 0.9, 0]);
}

/** Innermost demo slide showing scale-independent local movement. */
export class Detail extends Slide {
  override build(ctx: SlideContext): void {
    ctx.add(heading(ctx, 'A canvas inside a canvas'));
    const dot = new Dot({ point: [-3, 0, 0], radius: 0.3, color: YELLOW });
    ctx.objects.dot = dot;
    ctx.add(dot);
    ctx.add(new Text({ color: ctx.foreground, text: 'The dot moves 6 logical units', fontSize: 30 }).moveTo([0, -2, 0]));
  }

  override async construct(ctx: SlideContext): Promise<void> {
    const dot = ctx.objects.dot as Dot;
    await ctx.play(dot.animate.shift([6, 0, 0]), { runTime: 1.1 });
    ctx.stop({ notes: 'Six local units, independent of both ancestor positions and scales.' });
    await ctx.play(new Indicate(dot), { runTime: 0.6 });
  }
}

/** Demo slide containing a rotated object and a nested detail slide. */
export class LocalCoordinates extends Slide {
  detail!: Slide;

  override build(ctx: SlideContext): void {
    ctx.add(heading(ctx, 'Local coordinates'));
    const square = new Square({ sideLength: 1.7, color: BLUE }).moveTo([-3, 0, 0]);
    ctx.objects.square = square;
    ctx.add(square);
    ctx.add(new Text({ color: ctx.foreground, text: 'Every slide starts with a 16 × 9 canvas', fontSize: 28 }).moveTo([0, 2.4, 0]));
    this.detail = this.addChild(new Detail('Deep detail'), {
      center: [3, -0.7, 0], width: 6, strokeColor: GREEN, strokeOpacity: 0.7, strokeWidth: 2,
    });
  }

  override async *construct(ctx: SlideContext) {
    const square = ctx.objects.square as Square;
    await ctx.play(new Rotate(square, { angle: 0.8 }), { runTime: 0.6 });
    ctx.stop();
    yield ctx.visit(this.detail);
    const circle = new Circle({ radius: 0.85, color: ORANGE }).moveTo(square.getCenter());
    await ctx.play(new ReplacementTransform(square, circle), { runTime: 0.6 });
    ctx.stop({ notes: "The child's program returned. The parent continues exactly once." });
  }
}

/** Demo slide exercising fades, transforms, trackers, updaters and stops. */
export class Playback extends Slide {
  override build(ctx: SlideContext): void {
    ctx.add(heading(ctx, 'Ordinary animation playback'));
    ctx.add(new Text({ color: ctx.foreground, text: 'Fades, transforms, trackers and pauses', fontSize: 28 }).moveTo([0, 2.3, 0]));
  }

  override async construct(ctx: SlideContext): Promise<void> {
    const square = new Square({ sideLength: 1.8, color: ORANGE }).moveTo([-3, 0, 0]);
    const circle = new Circle({ radius: 0.9, color: RED }).moveTo([3, 0, 0]);
    await ctx.play(new FadeIn(square), new FadeIn(circle), { runTime: 0.5 });
    ctx.stop();
    await ctx.play(square.animate.shift([2, 0, 0]), circle.animate.shift([-2, 0, 0]), { runTime: 0.8 });
    const [cx, cy] = circle.getCenter();
    await ctx.play(square.animate.moveTo([cx, cy + 2, 0]), { runTime: 0.6 });
    ctx.stop();
    const tracker = new ValueTracker(0);
    const dot = new Dot({ point: [-3, -2, 0], color: YELLOW });
    dot.addUpdater((mob) => mob.moveTo([-3 + tracker.getValue(), -2, 0]));
    ctx.add(dot, tracker);
    await ctx.play(tracker.animate.setValue(6), { runTime: 1, rateFunc: linear });
    dot.clearUpdaters();
    ctx.stop();
    await ctx.play(new FadeOut(square), new FadeOut(circle), { runTime: 0.5 });
  }
}

/** Root slide for the demo, with two explicitly visited children. */
export class Overview extends Slide {
  left!: Slide;
  right!: Slide;

  override build(ctx: SlideContext): void {
    ctx.add(heading(ctx, 'Think in slides'));
    ctx.add(new Text({ color: ctx.foreground, text: 'A tree of small programs on one zoomable canvas', fontSize: 29 }).moveTo([0, 2.5, 0]));
    this.left = this.addChild(new LocalCoordinates('Coordinates'), {
      center: [-4, -0.6, 0], width: 7, strokeColor: BLUE, strokeOpacity: 0.8, strokeWidth: 2,
    });
    this.right = this.addChild(new Playback('Playback'), {
      center: [4, -0.6, 0], width: 7, strokeColor: ORANGE, strokeOpacity: 0.8, strokeWidth: 2,
    });
    const footer = new Text({ color: ctx.foreground, text: 'Overview → detail → overview', fontSize: 27 }).moveTo([0, -3.7, 0]);
    ctx.objects.footer = footer;
    ctx.add(footer);
  }

  override async *construct(ctx: SlideContext) {
    yield ctx.visit(this.left);
    yield ctx.visit(this.right);
    await ctx.play(new Indicate(ctx.objects.footer as Text), { runTime: 0.7 });
  }
}

export const Demo: DeckDefinition = defineDeck({
  title: 'Demo',
  deck: () => new Overview('Overview'),
});

export const MovingFrames: DeckDefinition = defineDeck({
  title: 'MovingFrames',
  deck: () => {
    let child: Slide;
    const root = new Slide('Moving slides', {
      build: (ctx) => { ctx.add(heading(ctx, 'Arrange a slide like any object')); },
      program: async function* (ctx: SlideContext) {
        await ctx.play(child.viewport!.animate.shift([8, 0, 0]).scale(0.75), { runTime: 1 });
        ctx.stop();
        yield ctx.visit(child);
      },
    });
    child = root.addChild(new Detail('Moving detail'), { center: [-4, 0, 0], width: 6, strokeColor: GREEN, strokeOpacity: 0.8 });
    return root;
  },
});

export const AutomaticTree: DeckDefinition = defineDeck({
  title: 'AutomaticTree',
  deck: () => {
    const root = new Slide('Automatic overview', { build: (ctx) => { ctx.add(heading(ctx, 'Automatic tree traversal')); } });
    [[-4, 0, 0], [4, 0, 0]].forEach((center, i) => {
      root.addChild(
        new Slide(`Child ${i + 1}`, {
          build: (ctx) => { ctx.add(heading(ctx, ctx.slide.name)); },
          program: (ctx) => ctx.play(new FadeIn(new Dot({ color: BLUE })), { runTime: 0.4 }),
        }),
        { center, width: 7, strokeColor: BLUE, strokeOpacity: 0.5 },
      );
    });
    return root;
  },
});

export default Demo;
