---
title: Shapes, connections and attachments
description: Rectangles, circles, dots, ellipses, polygons, arcs and polylines; arrows and lines; braces and boxes.
---

<a class="try" href="guide.html#slide=shapes">Open in the guide ↗</a>

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
positioning anchors and as connection endpoints.

## Connections

<a class="try" href="guide.html#slide=shapes">Open in the guide ↗</a>

```markdown
[[arrow: #box -> #disk, #edge, label="**labelled** $\to$", color=YELLOW]]
[[line: #disk -> (-1.2,-5), #drop, color=GRAY, stroke_width=2]]
[[arrow: (-8.8,-5) -> #box, #pointer, color=RED, step=1]]
```

An arrow or line goes from one endpoint to another: an element ID (attached at the facing
bounding edge) or a literal `(x,y)` point. They take an optional `#id`, a `label` with inline
styling and math (placed above the connection), `color`, `stroke_width`, `opacity`, `step`,
`hide` and timing. Connections are created after all other elements, so forward references work;
they cannot anchor other elements and are not hidden implicitly when an endpoint disappears.

## Attachments

<a class="try" href="guide.html#slide=more-shapes">Open in the guide ↗</a>

```markdown
[[brace: #e, #be, side=bottom, label="an ellipse", color=GRAY]]
[[box: #tri, #bx, buff=0.2, corner_radius=0.1, color=GREEN, step=2]]
```

A `brace` or `box` is attached to one element, named first. Braces take `side` (`bottom` by
default, or `left`, `right`, `top`), `buff`, an inline `label` with `font_size`, `color` and
`stroke_width`. Boxes (surrounding rectangles) take `buff`, `corner_radius`, `color`,
`stroke_width`, `fill_color` and `fill_opacity`. Both accept `step`, `hide`, `opacity` and timing,
and may attach to a [group](groups.html). Like connections they are created after layout.
