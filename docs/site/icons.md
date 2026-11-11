---
title: Icons
description: Thirty-nine diagram symbols built from geometry (people, machines, files, marks and actions) with configurable outline, fill and label, crisp or hand-drawn.
---

<a class="try" href="guide.html#slide=icons">Open in the guide ↗</a>

```markdown
[[icon: user #alice x=-7 y=-2.4 size=1.4 color=BLUE_E label="Alice"]]
[[icon: server #api right-of:#alice buff=3 size=1.4 color=GREEN_E fill_opacity=0.25 label="api" label_side=above]]
[[icon: database #db right-of:#api buff=3 size=1.4 color=GOLD_E fill_opacity=0.3 label="orders"]]
[[icon: cloud #cdn right-of:#db buff=2 size=1.4 color=TEAL_E label="cdn" sketch=true]]
[[arrow: #alice -> #api, #req, label="HTTPS"]]
[[arrow: #api -> #db, #sql, label="SQL", step=1]]
```

`[[icon: name #id …]]` draws one of the symbols that architecture and data-flow diagrams keep
needing. Every icon is built from geometry (a few closed outlines and strokes inside a square
box), so it is an ordinary vector element: it is placed by its center or by an `anchor`, it
works as an endpoint of arrows and lines and as a target of braces, [boxes and blobs](enclosures.html),
it fades in and out with `step` and `hide`, and it [animates](animations.html) like a shape.

## Names

| Group | Icons |
| --- | --- |
| People and machines | `user`, `users`, `client` (a laptop), `desktop`, `phone`, `server`, `database`, `cloud`, `globe` |
| Files and records | `document`, `folder`, `message` (an envelope), `calendar`, `chart` |
| Marks and places | `check`, `cross`, `question`, `exclamation`, `info`, `warning`, `star`, `flag`, `pin`, `home` |
| Actions and tools | `download`, `upload`, `search`, `arrival`, `departure`, `recycle`, `trash`, `key`, `lock`, `shield`, `bolt`, `gear`, `gears`, `puzzle`, `clock` |

All of them share the same construction: one or two closed silhouettes that take the fill, plus
strokes for the details, drawn with the same outline width inside a square box.

## Attributes

| Attribute | Default | Meaning |
| --- | --- | --- |
| `size` | 1 | height of the icon's box, in logical units (widths follow the symbol) |
| `color` | the layout color | outline color |
| `stroke_width` | 2 | outline width, in the units of shapes |
| `fill_color` | `color` | color of the silhouette parts (the body, the cylinder, the page, …) |
| `fill_opacity` | 0 | opacity of that fill; details such as text lines and bands stay strokes |
| `label` | | inline text under the icon, with styling and math |
| `label_side` | `below` | `below`, `above`, `left` or `right` |
| `font_size`, `font` | 80% of the prose size, the prose face | the label's size and font family |
| `sketch` and its tuning | `false` | [hand-drawn](sketch.html) rendering: `roughness`, `bowing`, `fill_style`, `hachure_angle`, `hachure_gap`, `fill_weight`, `seed` |
| `tremble`, `tremble_amplitude`, `tremble_rate` | | [vibration](animations.html#tremble) over a range of steps |

Icons also take `opacity`, `step`, `hide`, `enter`, `exit`, `run_time`, `lag`, the placement
attributes of [Positioning](positioning.html) and `focus_only`. With a `label`, the icon and its
label form one element: the arrow endpoints and the bounding box include the label, while a
[blob](enclosures.html) flows around the symbol and the label separately.

## Styling icons deck-wide

Icons take the style roles `shape`, `icon` and `icon-<name>`, most specific last, so a deck can
set a common look once:

```markdown
::: styles
icon: fill_opacity=0.15 stroke_width=2.5
icon-database: color=GOLD_E
shape: sketch=true
:::
```

## From code

```ts
import { makeIcon, ICON_NAMES, engine } from 'zoomdeck';

const store = makeIcon('database', { size: 1.5, color: engine.GOLD_E, fillColor: engine.GOLD_E, fillOpacity: 0.3 });
const sketched = makeIcon('cloud', { size: 2, sketch: { seed: 7, roughness: 1.5 } });
```

`makeIcon(name, options)` returns an engine `VGroup` with one member per part; `iconParts(name)`
gives the SVG path data of those parts inside the unit box (y up), and `ICON_NAMES` lists the
names. Hand-drawn icons keep their crisp counterpart in `markupOutline`.
