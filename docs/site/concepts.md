---
title: Concepts
description: Slides, logical coordinates, the zooming camera, and how a deck is recorded and replayed.
---

## Slides and the tree

A presentation is a tree of **slides**. In Markdown a slide is a `::: slide` container; in code it
is an instance of `Slide`. Every slide owns a **logical canvas**, 16 × 9 units by default, and its
content is authored in those units regardless of where the slide ends up on screen.

A child slide is placed in its parent through a **viewport**: a rectangle in the parent's canvas
that shows the child's whole canvas, scaled uniformly, possibly rotated and letterboxed. Because
viewports nest, the transform of a slide is the composition of the transforms of its ancestors,
and when a viewport moves every descendant follows.

```text
root (32 × 18)
├── chapter A (16 × 9, viewport at x=-8, width 12)
│   ├── detail A1
│   └── detail A2 (rotated by 0.1 rad)
└── chapter B
```

## Pre-order visits

Playback walks the tree in pre-order: a slide runs its own steps and visits its children in
order, each visit zooming the camera into the child's viewport; returning zooms back out. The
order within a slide is the source order of its includes, unless an include carries `step=N`,
which interleaves the visit with the parent's numbered fragments. A child's content is invisible
until its first visit and fades in then, unless `presenter.revealOnEntry` is `false`. `skip_return` and `skip_next`
let a presentation flow from one child straight to the next.

## Coordinates

Inside a slide, coordinates are the slide's own: the origin is the center of the canvas, `x` grows
to the right and `y` upwards, and one unit is one unit of the canvas whatever the zoom level. Text
is positioned by its left edge and first baseline, images and shapes by their center, and any
element can choose another anchor. Children are placed by the center of their viewport.

## Stops, clips and recording

When a deck loads, the complete slide program runs once, instantly. Every `stop` (a click) closes
a **clip** that remembers the animations that produced it, and the player stores a compact delta
snapshot of the settled state after each clip. Navigation restores a snapshot and replays the
clip's animations in real time, so:

- forward and backward steps, outline jumps and deep links are immediate;
- the left key can play the current stop backwards, because clips are made of interpolations;
- author code runs exactly once per page load, like a single render.

Visibility follows the tree: only the root is visible at the start, each descendant fades in on its
first entry and stays visible afterwards, so parents show their finished children as previews.

## What runs where

| Part | Role |
| --- | --- |
| Markdown dialect | slides, elements, placement, fragments and animations as text |
| `deck.json` | title, colors, typography, presenter options, styles, macros, slide classes |
| Code slides | TypeScript `Slide` subclasses with the complete animation engine |
| Player | outline, keyboard, pen, spotlight, speed, fullscreen, deep links |
| Command line | editing preview with reload, static and single-file exports |
