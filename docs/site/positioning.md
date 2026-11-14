---
title: Positioning
description: Anchors, flow, explicit coordinates, relative constraints, at= expressions, offsets and sizes.
---

<a class="try" href="tour.html#slide=layout">Open in the tour ↗</a>

## Anchors

`x`, `y` position an element's **anchor**. The default anchor is `left-baseline` for prose,
headings, math and listings (the left edge and the first baseline) and `center` for images,
shapes, listings' siblings and child viewports. `anchor=` chooses another point:

| Anchors | Available on |
| --- | --- |
| `center`, `top`, `bottom`, `left`, `right`, `top-left`, `top-right`, `bottom-left`, `bottom-right` | every element and viewport |
| `left-baseline`, `right-baseline` | text, math and listings |
| `origin` | groups (their local origin) |

```markdown
![](assets/tiles.png){#img x=-9.35 y=0.4 width=4 anchor=top-left}
[[rectangle: #r x=9.35 y=-5 width=3 height=1.2 anchor=bottom-right]]
[Ends at x = 9.35]{#rb x=9.35 y=-0.4 anchor=right-baseline}
```

`layout.textAnchor` changes the default for text.

## Flow

Blocks without coordinates flow downward from the top-left margin of the canvas, separated by
`layout.gap`. Text with only `x` keeps flowing at that left edge; an explicit `y`, an `at=` or a
vertical constraint leaves the flow. Elements that leave the flow do not reserve space, so later
blocks move up. A center-anchored element with one missing coordinate defaults that axis to zero.

## Relative constraints

<a class="try" href="tour.html#slide=layout">Open in the tour ↗</a>

```markdown
### A heading {#h x=0.6 y=1.6}

[Below it, left-aligned]{#p below:#h left-aligned:#h buff=0.3}

[A side note]{#note right-of:#p buff=0.5 font_size=18 color=GRAY}

[Big]{#big x=0.6 y=-1.4 font_size=48}
[shares the baseline]{x=2.3 baseline-aligned:#big}
```

- `below`, `above`, `left-of` and `right-of` place the element beyond the reference's bounding
  edge, centered on the other axis, at distance `buff` (default `layout.gap`).
- `left-aligned`, `right-aligned`, `top-aligned` and `bottom-aligned` match an edge without moving
  the other axis.
- `baseline-aligned` matches the typographic baseline of text, math or listings.
- One direction and at most one constraint per axis are allowed; an explicit coordinate may set
  the free axis (`below:#h x=0`).

References target elements of the same slide (and the same [group](groups.html)), including
later ones and hidden fragments, but never arrows, lines, braces or boxes. Sizes are measured once
during preparation; dependency cycles are reported with their line.

## Anchor expressions

<a class="try" href="tour.html#slide=styles">Open in the tour ↗</a>

```markdown
[[rectangle: #ref x=-6 y=-2.2 width=3 height=1.6]]
[My top-left at its bottom-right]{#tl at=top-left:#ref.bottom-right dx=0.2}
[[dot: #d at=#ref.top color=RED]]
[Centered on a point]{#cp at=center:(5,-3.6)}
```

`at=[anchor:]#id[.anchor]` or `at=[anchor:](x,y)` puts one anchor of the element (the prefix,
or `anchor=`, or its default) on an anchor of another element (`center` when omitted) or on a
literal point. It replaces `x`, `y` and the relative constraints, combines with `dx`/`dy`, and
follows the same reference rules. Inside directives, keep `(x,y)` tuples together; the comma
inside parentheses does not split attributes.

## Offsets and sizes

- `dx`, `dy` shift the final position of any positioned element.
- `width` controls paragraph wrapping, image width and the maximum width of formulas and listings;
  `height` scales the result; `font_size` overrides the layout size.
- `opacity` (0 to 1) makes any element translucent; fades preserve it.

## Children

Includes and imports take the same attributes against local elements: `x`, `y`, `anchor`, `at=`,
the relative constraints, `dx`/`dy` and `.class` styles. Their `width`/`height` size the viewport,
not the child's canvas.
