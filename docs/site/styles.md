---
title: Styles
description: Named attribute sets applied by class tokens and automatically by roles such as heading, body or code.
---

<a class="try" href="tour.html#slide=styles">Open in the tour ↗</a>

```markdown
---
styles:
  footnote: { font_size: 18, color: GRAY }
  heading: color=BLUE_E
---
```

```markdown
::: styles
callout: color=ORANGE font_size=30
:::

[A side remark]{.footnote below:#body left-aligned:#body}
[Look here]{#c .callout x=0 y=-2}
```

A **style** is a named set of attributes. Styles are defined under `styles` in the front
matter, as attribute strings or maps, or in a `::: styles` block of the Markdown file (one
`name: attributes` line each); the `::: styles` definition wins for the same name. A style sheet
kept apart from the deck is a **theme**, `themes/<name>.md` next to the Markdown, applied with
`theme: lecture` in the front matter under the deck's own styles; see
[Extending a deck](extending.html#themes).

## Classes

Elements, includes and subslides opt into styles with `.name` tokens in their attribute list. Several
classes may be listed; later ones win. A style may set how labels look (`label_pos`,
`label_side`, `slanted`, `label_color`) for elements with and without a label alike: on one
without a label they have no effect, while written on such an element itself they are an
error.

## Roles

Styles named after a **role** apply automatically to every element of that role:

| Role | Applies to |
| --- | --- |
| `heading`, `h1` … `h6` | headings (the level-specific name wins) |
| `body` | paragraphs and list items |
| `math`, `code`, `image`, `iframe`, `table`, `chart`, `group`, `include` | that element kind, or child viewports |
| `shape`, and `rectangle`, `circle`, `dot`, `ellipse`, `polygon`, `arc`, `polyline` | shapes |
| `connection`, `arrow`, `line` | arrows and lines |
| `attachment`, `brace`, `box`, `blob` | braces, boxes and blobs |
| `icon`, `icon-<name>` | every icon, or the icons of one name |

## Resolution

An element's own attributes win, then its classes, then its roles, then the layout defaults.
A style may set any attribute the element accepts (`anchor`, `width`, `opacity`, `stroke_width`,
`enter`, …); an attribute the element kind does not accept is reported like any misplaced
attribute, naming the element's line.

> **Tip** Put common typography in `layout` (`fontSize`, `headingSize`, `codeSize`, `font`,
> `color`) and use styles for the few recurring variations: footnotes, callouts, captions.
> A `shape: sketch=true` style (with `connection` and `attachment`) makes a whole deck
> [hand-drawn](sketch.html).
