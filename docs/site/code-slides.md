---
title: Code-authored slides
description: Slides written in TypeScript with the complete animation engine, used alone or imported into Markdown decks.
---

<a class="try" href="guide.html#slide=code-slides">Open in the guide ↗</a>

## Importing a slide into a Markdown deck

```markdown
[[import: Orbit x=5 y=-1.4 width=8 step=1]]
```

```typescript
import { BLUE, Circle, Dot, MoveAlongPath, YELLOW, linear } from 'manim-web';
import { Slide, type SlideContext } from 'zoomdeck';

export class Orbit extends Slide {
  override build(ctx: SlideContext) {
    const path = new Circle({ radius: 2.5, color: BLUE });
    const dot = new Dot({ point: [2.5, 0, 0], color: YELLOW });
    ctx.add(path, dot);
    Object.assign(ctx.objects, { path, dot });
  }
  override async construct(ctx: SlideContext) {
    const { dot, path } = ctx.objects;
    await ctx.play(new MoveAlongPath(dot, { path }), { runTime: 2, rateFunc: linear });
    ctx.stop();
  }
}
```

`deck.json` names the module with `"imports": "code-slides.ts"`. The class must be constructible
without arguments and return a fresh slide; qualified names (`helpers.Orbit`) traverse
namespaces. Each occurrence creates its own instance, with the same placement attributes as an
include. A slide's natural canvas defaults to 16 × 9; pass `{ size: [20, 12] }` or
`width`/`height` to `super()` to change it.

## The Slide API

| Member | Role |
| --- | --- |
| `build(ctx)` | runs once during preparation: create objects, add them with `ctx.add`, place children with `this.addChild` |
| `construct(ctx)` | runs on entry: `await ctx.play(...)`, `await ctx.wait(s)`, `ctx.stop(options)`; an `async *` generator may `yield ctx.visit(child)` |
| `addChild(child, { center, width, height, angle, strokeColor, strokeOpacity, strokeWidth, onlyThis, startHere })` | place a child viewport in this canvas |
| options `skipReturn`, `onlyThis`, `startHere`, `size`, `build`, `program` | the same flags as the markup attributes; callbacks instead of subclassing |

Engine text defaults to white, so give it the deck's text color explicitly, `color: ctx.foreground`
(black on the default white canvas), unless the slide chooses its own colors.

Coordinates are the slide's own: the engine's world space *is* the slide's local space, so
`moveTo`, `nextTo`, `shift` and `.animate` behave as in any scene. Child viewports are ordinary
animatable objects: moving one moves its whole subtree.

## The SlideContext API

| Method | Effect |
| --- | --- |
| `add`, `remove`, `replace`, `clear` | local scene membership |
| `play(...animations, { runTime, rateFunc })` | play engine animations in parallel |
| `wait(seconds)` | hold while updaters run |
| `stop({ loop, autoNext, notes, playbackRate })` | end a clip (a click) |
| `visit(child)` | yield this from a generator to visit a child now |
| `skipNext()`, `autoAdvance()` | the equivalents of `skip_next` and `next` |
| `toEdge(mob, direction, { buff })`, `toCorner`, `toWorld`, `toLocal` | canvas-relative placement |
| `touch(mob)` | report a mutation made outside animations so snapshots record it |
| `objects` | a free map for sharing objects between `build` and `construct` |
| `foreground` | the deck's text color, for engine objects created in code |

Programs run exactly once per page load during recording; keep them deterministic.

## Code-only decks

```typescript
import { defineDeck, Slide } from 'zoomdeck';

export default defineDeck({
  title: 'Minimal',
  presenter: { transitionTime: 0.8 },
  background: '#000000',
  deck: () => {
    const root = new Slide('Overview', { build: (ctx) => { /* … */ } });
    root.addChild(new Topic('Left'), { center: [-4, 0, 0], width: 7 });
    return root;
  },
});
```

A module exporting a deck definition (default export or named exports chosen with `scene=`) runs
on the dev page with `/?deck=path/to/module` and builds with the command line like any deck.
Markdown decks can be created from code too: `markupDeck({ url, layout, presenter, styles, … })`.

## Available engine objects

The package re-exports the rendering engine as the `engine` namespace (or import from
`manim-web` directly): text, formulas, shapes, images, video, groups, value trackers, updaters and
the animation classes (`FadeIn`, `Transform`, `Rotate`, `MoveAlongPath`, `Indicate`, `Write`,
`AnimationGroup`, `Succession`, …). The project adds `PropertyAnimation`, `DelayedAnimation`,
`RasterImage`/`RasterMovie`, `VideoClip`/`VideoPlay` and `makeEffect`.
