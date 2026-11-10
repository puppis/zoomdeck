---
title: Animations
description: Move, rotate, scale, recolor and fade elements, play named effects, morph one element into another, follow paths, and move child viewports.
---

<a class="try" href="guide.html#slide=animations">Open in the guide ↗</a>

```markdown
[[animate: #ball, step=1, x=6.5, run_time=1.2, rate=ease_in_out]]
[[animate: #card, step=2, angle=0.4, scale=1.3, color=ORANGE, opacity=0.6, run_time=1]]
[[effect: indicate #before, step=3, color=YELLOW]]
[[effect: circumscribe #card, step=3, color=RED, lag=0.3]]
[[transform: #before -> #after, step=4, run_time=1]]
[[move_along: #ball, step=5, path=#orbit, run_time=2, rate=linear]]
[[animate: #satellite, step=7, x=7.5, y=-3.6, angle=-0.3, run_time=1.5]]
[[include: #satellite x=5.5 y=-3.6 width=4 step=8]]
```

Animation directives play at a numbered step together with the fades of that step. They share
`run_time`, `lag` and `rate`; targets must be visible at that step, and a target may be changed
only once per step.

## animate

`[[animate: #id, step=N, …]]` interpolates toward a target state:

| Attribute | Meaning |
| --- | --- |
| `x`, `y` | move the element's anchor (`anchor=` picks another point) |
| `at=` | move the anchor onto another element's anchor or a point, as in [Positioning](positioning.html) |
| `dx`, `dy` | add an offset to the move |
| `angle` | rotate by that many radians about the center |
| `scale` | scale by that factor about the center |
| `opacity`, `color` | final values |

The ID may name an **included slide**: its viewport then moves, rotates or scales, and the whole
subtree follows, as in the guide where a child is slid and tilted before it is visited.

## effect

`[[effect: name #id, step=N, …]]` plays an engine effect without changing visibility:

`indicate`, `wiggle`, `circumscribe`, `flash`, `focus`, `grow`, `shrink`, `write`, `create`,
`uncreate`, `draw`, `wave`. `color` and `scale` tune the ones that take them.

## transform

`[[transform: #a -> #b, step=N]]` morphs a visible element into a hidden one, which becomes the
visible element afterwards, so later `hide`/`show` directives address the new element. Give the
target `step=N` for the transform's own step: the morph then reveals it instead of a fade. Works
best between formulas and shapes.

## move_along

`[[move_along: #id, step=N, path=#shape]]` moves an element along a circle, arc, polyline or
polygon; `rotate=true` turns it along the path.

## Rates

`rate=` takes `smooth` (default), `linear`, `rush_into`, `rush_from`, `there_and_back`,
`ease_in`, `ease_out`, `ease_in_out`.

## Sequencing

Changes of one step run in parallel; `lag` staggers them and `run_time` sets each duration.
`[[next: step=N]]` chains steps without clicks. Group members cannot be animated individually;
animate the [group](groups.html).

> **Note** Every directive compiles to an engine animation played by the same machinery as the
> fades, so clips, snapshots, outline jumps, replay and reverse playback treat them alike.
