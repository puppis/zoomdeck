---
title: Hand-drawn shapes
description: sketch=true renders shapes, icons, arrows, lines, braces, boxes and blobs as if drawn by hand, with hatched or solid fills, through Rough.js.
---

<a class="try" href="guide.html#slide=sketch">Open in the guide ↗</a>

```markdown
[[rectangle: #hr x=-6.5 y=-3 width=3.4 height=1.8 color=BLUE_E fill_opacity=0.5 sketch=true]]
[[circle: #hc right-of:#hr buff=1.5 radius=0.9 color=GREEN_E fill_opacity=0.6 fill_style=cross-hatch sketch=true]]
[[polygon: #hp points="(0.5,-3.9) (2,-2) (3.5,-3.9)" color=ORANGE fill_opacity=1 fill_style=solid roughness=2 sketch=true]]
[[arrow: #hr -> #hc, #ha, sketch=true]]
[[brace: #hp, #hb, side=bottom, label="by hand", sketch=true]]
```

Any [shape](shapes.html), [icon](icons.html), connection or attachment (braces, [boxes and
blobs](enclosures.html)) takes `sketch=true` and is then drawn as if by hand: a slightly wobbly outline traced twice, and a fill made of hatching lines instead of a flat
color. The geometry comes from [Rough.js](https://roughjs.com/); Zoomdeck turns its strokes into
ordinary vector objects, so hand-drawn shapes animate, fade, transform, serve as anchors and
endpoints, and export exactly like crisp ones.

## Attributes

| Attribute | Default | Meaning |
| --- | --- | --- |
| `sketch` | `false` | `true` draws the element by hand |
| `roughness` | 1 | amount of wobble: 0 is nearly exact, 2 and above visibly careless |
| `bowing` | 1 | how much straight lines bend |
| `fill_style` | `hachure` | `hachure`, `solid`, `zigzag`, `cross-hatch`, `dots`, `dashed` or `zigzag-line` (dots default to `solid`) |
| `hachure_angle` | -41 | angle of the hatching lines, in degrees |
| `hachure_gap` | 4 × the outline width | distance between hatching lines, in logical units |
| `fill_weight` | half the outline width | width of the hatching lines, like `stroke_width` |
| `seed` | from the element's ID and source line | the random offsets; the same seed always gives the same drawing |

`color`, `stroke_width`, `fill_color` and `fill_opacity` keep their meaning: the fill opacity
becomes the opacity of the hatching lines (or of the solid fill), and it is preserved through
fades and element `opacity`. Without `fill_opacity` a shape is an outline only, as before. The
tuning attributes are accepted without `sketch=true` and then have no effect, which lets a style
define the look once and elements opt in.

## What changes by hand

- **Rectangles** keep their `corner_radius`; **arcs** with a fill are drawn as pie slices.
- **Arrows** get a hand-drawn shaft and a small filled triangular tip; **lines** a single wobbly stroke.
- **Braces** become one stroke along the brace's curve, on the requested `side`, labels included;
  **boxes** are hand-drawn rectangles around their targets and **blobs** hand-drawn curves.
- **Icons** are sketched part by part: the silhouette gets the hatching, the details stay strokes.
- `tremble=` suits hand-drawn elements particularly well: the wobbly outline then quivers like a
  line in an animated sketch (see [Animations](animations.html#tremble)).
- A hand-drawn shape used as a `move_along` path moves the follower along the exact geometry,
  not along the wobble.
- The wobble is defined in the slide's logical units, so it scales with the slide when the camera
  zooms, like a drawing would.

## Handwriting

A handwriting face completes the look: the player bundles **Zeyada** (SIL Open Font License),
and `font=Zeyada` on a paragraph, heading, arrow label or brace label sets it, usually with a
larger `font_size` since handwriting faces are small on the em. A `body: font=Zeyada font_size=34`
style applies it to every paragraph.

## A whole deck by hand

Styles apply by role, so one line turns every shape, connection and attachment of a deck into a
sketch, and elements can still opt out:

```markdown
::: styles
shape: sketch=true roughness=1.2
connection: sketch=true
attachment: sketch=true
dot: sketch=false
:::

[[rectangle: #exact x=0 y=0 width=2 height=1 sketch=false]]
```

The same works from `deck.json` (`"styles": { "shape": "sketch=true" }`); see [Styles](styles.html).

## From code

Code-authored slides get the same drawings through the `sketch` helper, in logical units:

```ts
import { sketch, engine } from 'zoomdeck';

const cloud = sketch.ellipse(4, 2, { color: engine.BLUE_E, fillColor: engine.BLUE_E, fillOpacity: 0.4, seed: 3 });
const pointer = sketch.arrow([-3, -2], [0, -1], { color: engine.RED, strokeWidth: 3 });
const traced = sketch.of(new engine.Circle({ radius: 1 }), { color: engine.GOLD_E, roughness: 1.5 });
```

`sketch.rectangle(width, height, options, cornerRadius)`, `circle(radius)`, `ellipse(width, height)`,
`polygon(points)`, `polyline(points)`, `arc(center, radius, startAngle, angle)`, `line(start, end)`,
`arrow(start, end, options, tipLength, tipWidth)`, `brace(length, depth)`, `path(svgPathData)` and
`of(vmobject)` return engine `VGroup`s; `sketchDrawable(drawable, options)` converts any Rough.js
drawable. Options mirror the attributes in camelCase (`fillStyle`, `hachureAngle`, `hachureGap`,
`fillWeight`, `seed`); `sketchSeed(text)` derives a stable seed from a string.
