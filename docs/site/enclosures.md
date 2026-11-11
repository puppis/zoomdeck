---
title: Boxes and blobs
description: Surround a set of elements with a rectangle or with a smooth curve that keeps a chosen distance from every member, crisp or hand-drawn.
---

<a class="try" href="guide.html#slide=enclosures">Open in the guide ↗</a>

```markdown
[[icon: server #web x=-6.5 y=-1.9 size=1.1 color=GREEN_E label="web" label_side=right]]
[[icon: server #worker x=-6.5 y=-3.9 size=1.1 color=GREEN_E label="worker" label_side=right]]
[[icon: database #store x=-1.5 y=-2.9 size=1.1 color=GOLD_E label="store" label_side=right]]
[[box: #web #worker, #tier, buff=0.3, corner_radius=0.2, color=GRAY, step=1]]
[[blob: #web #worker #store, #backend, buff=0.45, smoothness=0.7, color=GREEN_E, fill_opacity=0.08, step=2, hide=3]]
[[blob: #store, #attention, buff=0.3, color=RED, sketch=true, step=3, tremble=3]]
```

A `box` or a `blob` encloses one or more elements. The elements come first, separated by
spaces, up to the first comma; the enclosure's own `#id` and attributes follow. Enclosures are
[attachments](shapes.html#attachments): they are created after layout, so they may name elements
defined later, and they cannot anchor other elements.

## Boxes

`[[box: #a #b …, #id, …]]` draws the joint bounding rectangle of its targets, grown by `buff`
(0.15 by default), optionally with `corner_radius`. It takes `color`, `stroke_width`,
`fill_color`, `fill_opacity`, `opacity`, `step`, `hide`, timing and `sketch=true`. A box around
one element is the familiar surrounding rectangle.

## Blobs

`[[blob: #a #b …, #id, …]]` draws a smooth closed curve that stays at distance `buff` (0.3 by
default) from every target, following their arrangement instead of their joint rectangle: an
L-shaped group gets an L-shaped blob, and targets too far apart for their margins to touch get
separate loops.

| Attribute | Default | Meaning |
| --- | --- | --- |
| `buff` | 0.3 | distance between the targets and the curve |
| `smoothness` | 0.5 | from 0 (the plain outline of the margins, with creases where they meet) to 1 (neighbours merge into one soft shape) |
| `color`, `stroke_width` | the layout color, 2 | the curve |
| `fill_color`, `fill_opacity` | `color`, 0 | the enclosed area |
| `sketch` and its tuning | `false` | a [hand-drawn](sketch.html) curve with a hatched or solid fill |
| `tremble`, `tremble_amplitude`, `tremble_rate` | | a [vibrating](animations.html#tremble) curve, which suits hand-drawn blobs well |

A blob flows around the parts of a composite target separately: the members of a
[group](groups.html), or an [icon](icons.html) and its label. Blobs take `opacity`, `step`,
`hide`, `enter`, `exit`, `run_time` and `lag` like other attachments.

## From code

```ts
import { blobMobject, blobOutline, engine } from 'zoomdeck';

const rects = [{ x: 0, y: 0, width: 2, height: 1 }, { x: 1.5, y: -1.6, width: 1, height: 1 }];
const curve = blobMobject(rects, { buff: 0.4, smoothness: 0.7 });
curve.setStyle({ strokeColor: engine.GREEN_E, strokeWidth: 2 }).setFill(engine.GREEN_E, 0.1);
```

`blobOutline(rects, options)` returns the traced loops as arrays of anchor points,
`blobMobject` the smooth engine `VMobject` through them, and `blobField` the underlying distance
field. Rectangles are given by center and size in logical units.
