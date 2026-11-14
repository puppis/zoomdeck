---
title: Reference
description: Every container, element, directive and attribute of the dialect, grouped by topic, with the page that explains each.
---

The dialect in one place, in the order of the documentation: the structure of a document, the
content of a slide, diagrams, layout, motion, and the names that attributes accept. Each group
links to the page with the explanations and examples.

## Document structure

[Slides and the forest](slides.html) · [Styles](styles.html) · [Groups](groups.html)

| Syntax | Purpose |
| --- | --- |
| `::: slide {#id attrs} … :::` | a slide; attrs: `title`, `width`, `height`, `start_here`, `only_this`, `return_to_parent`, `skip_return`, `transition`, `preview` |
| `[[include: #slide, placement, step, start_here, only_this, return_to_parent, skip_return, transition, preview]]` | a child slide placed in this one; `subslide: #id` is the same |
| `[[subslide: ClassName, placement, step, …]]` | a code-authored child ([Code-authored slides](code-slides.html)) |
| `[[import: path.md]]` | splices a Markdown file in, between slides or inside one |
| `::: styles … :::` | style definitions, `name: attributes` per line, at the top of the file |
| `::: {.element attrs} … :::` | attributes for one paragraph, heading, image, formula, table or listing |
| `::: {.group #id attrs} … :::` | a group of elements in local coordinates |
| `<!-- … -->` | discarded |

Attributes are space- or comma-separated `key=value` pairs; quoted values may contain spaces and
commas; `(x,y)` tuples stay whole; `#id` sets the ID; `.name` applies a style.

## Content of a slide

[Text](text.html) · [Mathematics](math.html) · [Images and video](images.html) · [Code listings](code.html) · [Tables and charts](tables-charts.html)

| Syntax | Element |
| --- | --- |
| paragraph, `# heading`, `- item`, `1. item` | text (attributes in `{…}` at the end of the block); indented items nest |
| `[text]{attrs}` | a positioned text block, or a colored span when only `color`/`style` is given |
| `[label](url)` | a link inside prose |
| `$…$`, `$$ … $$` | inline math (part of a paragraph), display math |
| `![alt](path){attrs}` | image, animated image or video (`play=once|loop`, `muted`) |
| ```` ```lang {attrs} ```` | code listing |
| `\| a \| b \|` rows with a `\| --- \| --- \|` delimiter | table (attributes through a `::: {.element …}` container) |
| ```` ```chart {attrs} ```` with rows of `label, v1, v2` | bar, line or pie chart |
| `[[iframe: url, #id, width, height, poster, title, placement, step]]` | a live web page ([Live pages](live-pages.html)) |

| Attribute | On | Meaning |
| --- | --- | --- |
| `font_size`, `color`, `opacity` | elements | typography and translucency |
| `font`, and `font_size` on labels | text, connection and brace labels | font family (`Zeyada`, the bundled handwriting face, or any loaded font) |
| `lang` | listings | language name (normally from the fence info) |
| `play`, `muted` | animated images, videos | `once`, `loop`; sound for videos |
| `title`, `poster` | iframes | label and preview image |
| `rules`, `header`, `padding`, `border_color`, `header_color`, `header_opacity`, `stripe_opacity` | tables | rules, header row, cell padding and shading |
| `type`, `colors`, `axis_color`, `border_color`, `grid`, `legend`, `values`, `min`, `max`, `header` | charts | chart kind, palette, axes, gridlines, legend, value labels and axis bounds |
| `href` | every element, group, connection and attachment | URL opened when the element is clicked; `#slide=id` and `#step=N` move within the deck on a double-click |

## Diagrams

[Shapes, connections and attachments](shapes.html) · [Icons](icons.html) · [Boxes and blobs](enclosures.html) · [Hand-drawn shapes](sketch.html)

| Directive | Form |
| --- | --- |
| `rectangle`, `ellipse` | `#id width height [corner_radius] fill_color fill_opacity …` |
| `circle`, `dot` | `#id radius …` (dot: radius optional) |
| `polygon`, `polyline` | `#id points="(x,y) (x,y) …" …` |
| `arc` | `#id x y radius angle [start_angle] …` |
| `icon` | `[[icon: name #id size label label_side fill_color fill_opacity stroke_width …]]` (names under [Names](#names)) |
| `arrow`, `line` | `[[arrow: #a -> #b, #id, label="…", color, stroke_width, step, hide]]` with `#id` or `(x,y)` endpoints |
| `brace` | `[[brace: #target, #id, side, buff, label, font_size, font]]` |
| `box`, `blob` | `[[box: #a #b …, #id, buff, corner_radius, fill_color, fill_opacity]]`, `[[blob: #a #b …, #id, buff, smoothness, fill_color, fill_opacity]]` |

| Attribute | On | Meaning |
| --- | --- | --- |
| `color`, `stroke_width` | shapes, icons, connections, attachments | stroke color and width |
| `fill_color`, `fill_opacity` | shapes, icons, boxes, blobs | fill |
| `size`, `label`, `label_side` | icons | box height; caption text and its side (`below`, `above`, `left`, `right`) |
| `buff` | attachments | distance from the targets |
| `side` | braces | `bottom`, `top`, `left`, `right` |
| `corner_radius` | rectangles, boxes | rounded corners |
| `smoothness` | blobs | how softly neighbouring targets merge, 0 to 1 |
| `sketch`, `roughness`, `bowing`, `fill_style`, `hachure_angle`, `hachure_gap`, `fill_weight`, `seed` | shapes, icons, connections, attachments | hand-drawn rendering and its tuning |

## Layout

[Positioning](positioning.html) · [Groups](groups.html) · [Styles](styles.html)

| Attribute | On | Meaning |
| --- | --- | --- |
| `x`, `y` | elements, children | position of the anchor |
| `anchor` | elements, children | `center`, edges, corners, `left-baseline`, `right-baseline` (text), `origin` (groups) |
| `at` | elements, children | `[anchor:]#id[.anchor]` or `[anchor:](x,y)` |
| `below`, `above`, `left-of`, `right-of` | elements, children | place beside `#id`, at distance `buff` |
| `left-aligned`, `right-aligned`, `top-aligned`, `bottom-aligned`, `baseline-aligned` | elements, children | align an edge or baseline with `#id` |
| `dx`, `dy` | positioned elements | offset after placement |
| `width`, `height` | elements, children | wrapping width or size; viewport size for children |
| `angle` | children, `animate` | rotation in radians |
| `class` or `.name` | elements, children | styles |

## Motion and interaction

[Fragments and steps](fragments.html) · [Animations](animations.html) · [Focus-only decorations](focus.html)

| Directive | Form |
| --- | --- |
| `show`, `hide` | `[[show: #id step=N run_time lag enter]]`, `[[hide: #id step=N run_time lag exit]]` |
| `animate` | `[[animate: #id, step=N, x y at dx dy anchor angle scale opacity color, run_time lag rate]]` |
| `effect` | `[[effect: name #id, step=N, color, scale, run_time, lag, rate]]` |
| `transform` | `[[transform: #a -> #b, step=N, run_time, lag, rate]]` |
| `move_along` | `[[move_along: #id, step=N, path=#shape, rotate, run_time, lag, rate]]` |
| `next`, `skip_next` | `[[next: step=N]]`, `[[skip_next: step=N]]` |

| Attribute | On | Meaning |
| --- | --- | --- |
| `step`, `hide` | elements, children (`step`) | reveal and hide clicks; visit step for children |
| `run_time`, `lag`, `rate` | fades and animations | duration, delay, rate function |
| `enter`, `exit` | elements | `fade`, `grow`, `write`, `create`, `draw` / `fade`, `shrink`, `uncreate` |
| `tremble`, `tremble_amplitude`, `tremble_rate` | shapes, icons, connections, attachments, math, groups, tables, charts | `true`, `N` or `N-M`: vibration over a range of steps, its size and frequency |
| `focus_only` | static elements | visible only while the slide is focused |
| `start_here`, `only_this`, `return_to_parent`, `skip_return`, `transition`, `preview` | slides, includes, subslides | opening stop, partial preparation, zooming back to the parent after this child or leaving it straight for the next stop (by default only the last child returns), `zoom` or `cut`, content shown before the first visit; written bare, a flag means `=true` ([Slides and the forest](slides.html#flags)) |

## Names

- **Colors**: palette names (`BLUE`, `TEAL`, `GREEN`, `YELLOW`, `GOLD`, `RED`, `MAROON`, `PURPLE`,
  `PINK`, `ORANGE`, `GRAY`, `WHITE`, `BLACK`, with `_A` … `_E` variants), CSS names, `#rgb`,
  `#rrggbb`, `rgb(…)`.
- **Effects**: `indicate`, `wiggle`, `circumscribe`, `flash`, `focus`, `grow`, `shrink`, `write`,
  `create`, `uncreate`, `draw`, `wave`.
- **Rates**: `smooth`, `linear`, `rush_into`, `rush_from`, `there_and_back`, `ease_in`,
  `ease_out`, `ease_in_out`.
- **Fill styles** (hand-drawn shapes): `hachure`, `solid`, `zigzag`, `cross-hatch`, `dots`,
  `dashed`, `zigzag-line`.
- **Icons**: `user`, `users`, `client`, `desktop`, `phone`, `server`, `database`, `cloud`, `globe`, `document`, `folder`, `message`, `calendar`, `chart`, `check`, `cross`, `question`, `exclamation`, `info`, `warning`, `star`, `flag`, `pin`, `home`, `download`, `upload`, `search`, `arrival`, `departure`, `recycle`, `trash`, `key`, `lock`, `shield`, `bolt`, `gear`, `gears`, `puzzle`, `clock`.
- **Style roles**: `heading`, `h1` … `h6`, `body`, `math`, `code`, `image`, `iframe`, `group`,
  `include`, `shape` and shape kinds, `icon` and `icon-<name>`, `connection`, `arrow`, `line`,
  `attachment`, `brace`, `box`, `blob`, `table`, `chart`.
- **Link targets**: `https://…`, `http://…`, `mailto:…`, `#slide=id`, `#step=N`, absolute (`/…`)
  and relative (`./…`) paths.

## Validation

Mistakes are reported before anything is drawn, with the source line: unknown attributes,
duplicate or missing IDs, conflicting constraints, positioning cycles, references across groups,
inconsistent visibility, animations of hidden elements, invalid colors, unknown classes, effects
and rates, unsupported link targets, and missing images.

## Limitations

- Text is rasterized to canvas textures, redrawn at the screen's resolution whenever the camera
  comes to rest (so it may soften briefly during a zoom); math, SVG and
  shapes stay vector.
- The dry recording happens at page load; large decks take a few seconds.
- Group members cannot have their own fragments; `transform` works best between vector content.
- Live pages are not drawn by the pen or spotlight and are absent from exported screenshots.
- The design mode (dragging elements in the browser) is planned; see the roadmap in the repository.
