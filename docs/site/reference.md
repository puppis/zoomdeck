---
title: Reference
description: Every directive and attribute of the dialect on one page.
---

## Document structure

| Syntax | Purpose |
| --- | --- |
| `::: slide {#id attrs} … :::` | a slide; attrs: `title`, `width`, `height`, `start_here`, `only_this`, `skip_return` |
| `::: styles … :::` | style definitions, `name: attributes` per line, at the top of the file |
| `::: {.element attrs} … :::` | attributes for one paragraph, heading, image, formula or listing |
| `::: {.group #id attrs} … :::` | a group of elements in local coordinates |
| `<!-- … -->` | discarded |

## Elements

| Syntax | Element |
| --- | --- |
| paragraph, `# heading`, `- item` | text (attributes in `{…}` at the end of the block) |
| `[text]{attrs}` | a positioned text block, or a colored span when only `color`/`style` is given |
| `$…$`, `$$ … $$` | inline math (part of a paragraph), display math |
| `![alt](path){attrs}` | image, animated image or video |
| ```` ```lang {attrs} ```` | code listing |
| `[label](url)` | link |

## Directives

| Directive | Form |
| --- | --- |
| `include`, `subslide` | `[[include: #slide, placement, step, start_here, only_this, skip_return]]` |
| `subslide` | `[[subslide: ClassName, placement, step, …]]` (a code-authored child) |
| `import` | `[[import: path.md]]` splices a Markdown file in, between slides or inside one |
| `rectangle`, `ellipse` | `#id width height [corner_radius] fill_color fill_opacity …` |
| `circle`, `dot` | `#id radius …` (dot: radius optional) |
| `polygon`, `polyline` | `#id points="(x,y) (x,y) …" …` |
| `arc` | `#id x y radius angle [start_angle] …` |
| `arrow`, `line` | `[[arrow: #a -> #b, #id, label="…", color, stroke_width, step, hide]]` with `#id` or `(x,y)` endpoints |
| `icon` | `[[icon: name #id size label label_side fill_color fill_opacity stroke_width …]]` (names under [Names](#names)) |
| `brace` | `[[brace: #target, #id, side, buff, label, font_size, font]]` |
| `box`, `blob` | `[[box: #a #b …, #id, buff, corner_radius, fill_color, fill_opacity]]`, `[[blob: #a #b …, #id, buff, smoothness, fill_color, fill_opacity]]` |
| `iframe` | `[[iframe: url, #id, width, height, poster, title, placement, step]]` |
| `show`, `hide` | `[[show: #id step=N run_time lag enter]]`, `[[hide: #id step=N run_time lag exit]]` |
| `animate` | `[[animate: #id, step=N, x y at dx dy anchor angle scale opacity color, run_time lag rate]]` |
| `effect` | `[[effect: name #id, step=N, color, scale, run_time, lag, rate]]` |
| `transform` | `[[transform: #a -> #b, step=N, run_time, lag, rate]]` |
| `move_along` | `[[move_along: #id, step=N, path=#shape, rotate, run_time, lag, rate]]` |
| `next`, `skip_next` | `[[next: step=N]]`, `[[skip_next: step=N]]` |

Attributes are space- or comma-separated `key=value` pairs; quoted values may contain spaces and
commas; `(x,y)` tuples stay whole; `#id` sets the ID; `.name` applies a style.

## Attributes

| Attribute | On | Meaning |
| --- | --- | --- |
| `x`, `y` | elements, children | position of the anchor |
| `anchor` | elements, children | `center`, edges, corners, `left-baseline`, `right-baseline` (text), `origin` (groups) |
| `at` | elements, children | `[anchor:]#id[.anchor]` or `[anchor:](x,y)` |
| `below`, `above`, `left-of`, `right-of` | elements, children | place beside `#id`, at distance `buff` |
| `left-aligned`, `right-aligned`, `top-aligned`, `bottom-aligned`, `baseline-aligned` | elements, children | align an edge or baseline with `#id` |
| `dx`, `dy` | positioned elements | offset after placement |
| `width`, `height` | elements, children | wrapping width or size; viewport size for children |
| `font_size`, `color`, `opacity` | elements | typography and translucency |
| `font`, and `font_size` on labels | text, connection and brace labels | font family (`Zeyada`, the bundled handwriting face, or any loaded font) |
| `fill_color`, `fill_opacity`, `stroke_width` | shapes, icons, boxes, blobs | fill and stroke |
| `size`, `label`, `label_side` | icons | box height; caption text and its side (`below`, `above`, `left`, `right`) |
| `smoothness` | blobs | how softly neighbouring targets merge, 0 to 1 |
| `tremble`, `tremble_amplitude`, `tremble_rate` | shapes, icons, connections, attachments, math, groups | `true`, `N` or `N-M`: vibration over a range of steps, its size and frequency |
| `sketch`, `roughness`, `bowing`, `fill_style`, `hachure_angle`, `hachure_gap`, `fill_weight`, `seed` | shapes, icons, connections, attachments | [hand-drawn](sketch.html) rendering and its tuning |
| `step`, `hide` | elements, children (`step`) | reveal and hide clicks; visit step for children |
| `run_time`, `lag`, `rate` | fades and animations | duration, delay, rate function |
| `enter`, `exit` | elements | `fade`, `grow`, `write`, `create`, `draw` / `fade`, `shrink`, `uncreate` |
| `focus_only` | static elements | visible only while the slide is focused |
| `play`, `muted` | animated images, videos | `once`, `loop`; sound for videos |
| `lang` | listings | language name (normally from the fence info) |
| `class` or `.name` | elements, children | styles |
| `angle` | children, `animate` | rotation in radians |
| `title`, `poster` | iframes | label and preview image |

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
  `attachment`, `brace`, `box`, `blob`.

## Validation

Mistakes are reported before anything is drawn, with the source line: unknown attributes,
duplicate or missing IDs, conflicting constraints, positioning cycles, references across groups,
inconsistent visibility, animations of hidden elements, invalid colors, unknown classes, effects
and rates, and missing images.

## Limitations

- Text is rasterized to canvas textures, redrawn at the screen's resolution whenever the camera
  comes to rest (so it may soften briefly during a zoom); math, SVG and
  shapes stay vector.
- The dry recording happens at page load; large decks take a few seconds.
- Group members cannot have their own fragments; `transform` works best between vector content.
- Live pages are not drawn by the pen or spotlight and are absent from exported screenshots.
- The design mode (dragging elements in the browser) is planned; see the roadmap in the repository.
