---
title: Icons
description: Thirty-nine diagram symbols built from geometry (people, machines, files, marks and actions) with configurable outline, fill and label, crisp or hand-drawn.
---

<a class="try" href="tour.html#slide=icons">Open in the tour ↗</a>

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
| `font_size`, `font` | the prose size, the prose face | the size the label is 80 % of, and its font family |
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

## Artworks of your own

```markdown
[[artwork: rocket #r x=2 y=0 size=1.6 color=BLUE_E label="an SVG"]]
[[artwork: traffic-light #t right-of:#r buff=1 size=1.6 lit=red label="a module"]]
```

The built-in names are not the end of it. An `artworks/` folder next to the Markdown file (and
any folder named under `artworks` or `paths` in `deck.json`) holds artworks of the deck's own,
one file per name, and `[[artwork: name …]]` (or `[[icon: name …]]` with a name that is not
built in) places one like an icon, with `size`, `label`, `label_side` and a position:

- **`name.svg`**: the drawing as it is, with its own colors, scaled to `size` in height;
  `currentColor` in the file takes `color=` when given, else the deck's text color.
- **`name.js`, `name.mjs` or `name.ts`**: a module that draws with the engine. It exports a
  function (`export default`, or `artwork`) that receives the icon options, `size`, `color`,
  `strokeWidth`, `fillColor`, `fillOpacity`, `sketch`, the deck's `foreground` and every
  `attributes` of the directive as strings, and returns a mobject, several, or a list of parts;
  or it exports `parts`, path data in the unit box like the built-in icons, which are then
  drawn exactly like them, hand-drawn look included. A module may import `manim-web` and
  `zoomdeck` as the slide classes do. Attributes the module reads (`lit=red` above) are free.

Compound figures belong here too: a module returns a `VGroup` of whatever shapes, labels and
icons it likes, built from the directive's attributes, so a diagram vocabulary of your own
(a traffic light, a gate, a server rack) is one file per symbol. Exports bundle the modules
and copy or embed the SVG files; the tour's `examples/tour/artworks/` holds one of each. The
other folders a deck extends the player with, fonts, effects, camera transitions, chart types,
languages, code themes, themes, snippets, directives and slide classes, work the same way:
[Extending a deck](extending.html).

## From code

```ts
import { makeIcon, ICON_NAMES, engine } from 'zoomdeck';

const store = makeIcon('database', { size: 1.5, color: engine.GOLD_E, fillColor: engine.GOLD_E, fillOpacity: 0.3 });
const sketched = makeIcon('cloud', { size: 2, sketch: { seed: 7, roughness: 1.5 } });
```

`makeIcon(name, options)` returns an engine `VGroup` with one member per part; `iconParts(name)`
gives the SVG path data of those parts inside the unit box (y up), and `ICON_NAMES` lists the
names. Hand-drawn icons keep their crisp counterpart in `markupOutline`.
