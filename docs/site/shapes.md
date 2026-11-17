---
title: Shapes, connections and attachments
description: Rectangles, circles, dots, ellipses, polygons, arcs and polylines; arrows and lines; braces, boxes and blobs.
---

<a class="try" href="tour.html#slide=shapes">Open in the tour ↗</a>

```markdown
[[rectangle: #box x=-6 y=-2.4 width=3.4 height=1.8 corner_radius=0.3 color=BLUE fill_color=BLUE fill_opacity=0.15]]
[[circle: #disk right-of:#box buff=2.2 radius=0.9 color=GREEN stroke_width=4]]
[[dot: #p x=-8.5 y=-2.4 color=YELLOW]]
[[ellipse: #e x=-5.5 y=-2.4 width=3.4 height=1.6 color=TEAL fill_color=TEAL fill_opacity=0.2]]
[[polygon: #tri points="(-2.5,-3.2) (-0.5,-1.2) (0.5,-3.2)" color=ORANGE fill_color=ORANGE fill_opacity=0.3]]
[[arc: #a x=3.5 y=-2.8 radius=1.4 start_angle=0 angle=2.4 color=RED stroke_width=4]]
[[polyline: #zigzag points="(2,-4.2) (4,-2.3) (6,-3.8) (8,-2)" color=ORANGE stroke_width=3]]
```

## Shapes

Every shape needs an `#id`. All accept `color` (the layout color by default), `stroke_width`
(default 2), `fill_color` and `fill_opacity` (0 by default; polylines have no fill), `opacity`,
the placement attributes of [Positioning](positioning.html), `step`, `hide` and `focus_only`.

| Directive | Required | Optional |
| --- | --- | --- |
| `rectangle` | `width`, `height` | `corner_radius` |
| `ellipse` | `width`, `height` | |
| `circle` | `radius` | |
| `dot` | | `radius` (0.08; filled by default) |
| `polygon` | `points` (three or more) | |
| `arc` | `radius`, `angle` | `start_angle` (radians; `x`, `y` are the arc's center) |
| `polyline` | `points` (two or more) | |

Point-defined shapes (`polygon`, `polyline`, `arc`) keep their coordinates unless they are
positioned; `points` is a quoted, space-separated list of `(x,y)` pairs. Shapes serve as
positioning anchors and as connection endpoints. Every shape, connection and attachment also
takes `sketch=true`, which draws it [by hand](sketch.html) with a hatched or solid fill. Ready-made
symbols for diagrams (people, servers, databases, clouds, …) are [icons](icons.html), which behave
like shapes.

## Connections

<a class="try" href="tour.html#slide=shapes">Open in the tour ↗</a>

```markdown
[[arrow: #box -> #disk, #edge, label="**labeled** $\to$", color=YELLOW]]
[[line: #disk -> (-1.2,-5), #drop, color=GRAY, stroke_width=2]]
[[arrow: (-8.8,-5) -> #box, #pointer, color=RED, step=1]]
```

An arrow or line goes from one endpoint to another: an element ID, attached where the line
between the two meets its border (the outline of a circle, a dot or an ellipse, the facing
bounding edge of anything else), an element at one of its anchors, or a literal `(x,y)` point:

```markdown
[[arrow: #a0.top-right -> #b1.top-left]]
[[line: #a0.bottom -> #b1]]
```

The anchors are those of [`at=`](positioning.html#anchor-expressions): `top-left`, `top`,
`top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`, and the
baseline ones of text. A line ends right on its endpoints; an arrow stops a little short of each,
so that its tip does not touch the element. An arrow's tip grows and shrinks with its
`stroke_width` (0.3 long at the default 4) and is at most a quarter of the arrow, so a short thin
arrow keeps a small tip. Arrows and lines also take an optional `#id`, a
`label` with inline styling and math (sized by `font_size`, set in `font`), `color` for the
line and its label, `label_color` for a label in another color, `stroke_width`, `opacity`,
`step`, `hide` and timing.

The label sits at the middle of the edge, above it by default: upright, and clear of the line
on a slanted or vertical edge. `slanted=true` turns it along the edge, and `label_side=below`
puts it on the other side. Above and below are taken in the label's own frame along the edge,
which reads from left to right, or from bottom to top on a vertical edge, so that a label is never
upside down: above a vertical edge is its left, whichever way the arrow points.

```markdown
[[arrow: #a -> #b, #rise, label="slanted", slanted=true]]
[[arrow: #b -> #c, #fall, label="below", slanted=true, label_side=below]]
```

`dashed=true` draws a line, or an arrow's shaft, in dashes. The dashes begin and end the line
and grow longer with a thicker `stroke_width`; an arrow's tip stays solid, and a hand-drawn
connection (`sketch=true`) gets hand-drawn dashes.

```markdown
[[line: #a -> #c, #link, dashed=true]]
[[arrow: #c -> #a, #back, dashed=true, stroke_width=6, label="optional"]]
``` Connections are created after all other elements, so forward references work;
they cannot anchor other elements and are not hidden implicitly when an endpoint disappears.

## Attachments

<a class="try" href="tour.html#slide=more-shapes">Open in the tour ↗</a>

```markdown
[[brace: #e, #be, side=bottom, label="an ellipse", color=GRAY]]
[[box: #tri, #bx, buff=0.2, corner_radius=0.1, color=GREEN, step=2]]
```

A `brace` is attached to one element, named first; it takes `side` (`bottom` by default, or
`left`, `right`, `top`), `buff`, an inline `label` with `font_size` and `font`, `color` and
`stroke_width`. A `box` (a surrounding rectangle) and a `blob` (a smooth curve at a fixed
distance) enclose one or **several** elements, listed before the first comma; they are described
in [Boxes and blobs](enclosures.html). All attachments accept `step`, `hide`, `opacity` and
timing, may attach to a [group](groups.html) or an [icon](icons.html), and, like connections,
are created after layout. Shapes, icons, connections and attachments can also vibrate over a
range of steps with [`tremble=`](animations.html#tremble).
