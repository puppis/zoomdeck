---
title: The markup language, in full
description: Every construct of the dialect and every attribute it takes, with values, defaults and the rules the parser enforces; the reference to search when the guide has shown the idea.
---

The guide and the tour show what the dialect can do; this manual lists all of it. Each
construct has its syntax, a table of its attributes with their values and defaults, and the
rules that make a document invalid. The search box at the top finds any name on this page, and
the [index](manual-index.html) lists every construct and attribute alphabetically. The
[API manual](api.html) covers the same ground for a page or a program that drives the player.

## Syntax

### Attribute lists

Attributes follow a construct in braces (`[A caption]{#cap x=2 y=-1}`, `::: slide {#intro width=20}`)
or come after the name of a directive (`[[rectangle: #frame x=0 y=0 width=4 height=2]]`). Inside a
directive they are separated by spaces or commas; elsewhere by spaces. Each attribute is one of:

| Form | Meaning |
| --- | --- |
| `key=value` | a value; quote it with `"…"` or `'…'` when it holds spaces or commas. Inside the quotes a backslash before the quote escapes it and any other backslash stays, so `label="a \\ b"` breaks the line and `label="$\to$"` keeps its formula |
| `key="(x,y) (x,y)"` | parentheses keep a tuple whole, quoted or not: `at=center:(3,-2)` |
| `#name` | the identifier of the element, slide or child: the same as `id=name` |
| `.name` | a [style class](#style-roles-and-classes) to apply; several are allowed, in order |
| `below:#id` | a [relative position](#relative-placement), equivalent to `below=#id`, for `below`, `above`, `left-of`, `right-of`, `left-aligned`, `right-aligned`, `top-aligned`, `bottom-aligned`, `baseline-aligned` |
| `flag` | a bare flag means `flag=true`: `start_here`, `only_this`, `skip_return`, `return_to_parent`, `preview`, `focus_only` |
| `style="color: red"` | an alternative to `color=`; only the CSS `color` property is accepted, and not together with `color=` |

An attribute given twice is an error, and so is a name a construct does not take ("Unknown
attributes: …"). Booleans are `true` or `false`. A trailing `{…}` on a paragraph is read as
attributes when it holds a `#id`, a `.class`, a `key=value` or a `ref:` token; any other braces
are literal text.

### Identifiers

An identifier starts with a letter or `_` and continues with letters, digits, `_`, `.` or `-`.
Slide identifiers are unique in the document; element identifiers are unique within their slide.
Elements without an explicit `#id` are named `element-N` in source order, group members
`groupid.element-N`; these names are not meant to be referenced. Shapes, icons, artworks,
includes and chart or code fences you refer to need an explicit `#id`.

### Numbers and units

Lengths and coordinates are in **logical units** of the slide's canvas, which is 16 × 9 units
by default (`layout.defaultSlideSize`), the origin at its center, `x` to the right and `y` up.
Font sizes are in points, the engine's convention: text of `font_size=28` is about 0.47 units
tall. Angles are in radians. Times are in seconds. Opacities run from 0 to 1. Steps are
nonnegative integers. Every numeric attribute must be a finite number; `width`, `height`,
`font_size` and `size` must be positive; `radius`, `run_time`, `hachure_gap` and `tremble_rate`
must be positive; `buff`, `corner_radius`, `stroke_width`, `lag`, `roughness`, `bowing`,
`fill_weight`, `seed`, `tremble_amplitude` and `padding` must not be negative; `seed` is an
integer; `fill_opacity`, `opacity`, `smoothness`, `header_opacity` and `stripe_opacity` lie
between 0 and 1.

### Colors

A color is an engine palette name, a CSS color name, `#rgb`, `#rrggbb` (an `#rrggbbff` form is
accepted when opaque) or `rgb(…)` with integer or percentage channels, opaque only. The palette
names are listed under [Color names](#color-names). Everywhere a color is taken (`color`,
`fill_color`, `border_color`, `header_color`, `axis_color`, `colors`, inline spans) the same
forms apply.

### Fonts and sizes

`font=` names a family: the bundled text face Latin Modern Roman (the default), the bundled
typewriter face Latin Modern Mono (the default for code), the bundled handwriting face Zeyada,
a family in the deck's `fonts/` folder, or a family installed on the viewer's machine.
`font_size=` is in points; the defaults are `layout.fontSize` (28) for body text, lists, tables
and the labels of connections, `layout.headingSize` (42) for a level-one heading, shrinking by
12 % of that size for each deeper level, and `layout.codeSize` (80 % of the body size) for
listings. Formulas take the size of the text they sit in.

### Links

`href=` on an element, a group, a connection or an attachment makes it clickable; an inline link
`[text](target)` does the same for part of a paragraph. A target is `https://…` or `http://…`,
`mailto:…`, `#…` (a stop of this deck, as the player writes it in the address bar: `#slide=id`,
`#step=N`), `/…` or a relative path. Anything else is rejected.

## Document structure

### ::: slide

```markdown
::: slide {#id title="Shown in the outline" width=20 height=11.25}
…content…
:::
```

A slide is a container opening with `::: slide {…}` and closing with a line holding `:::`.
Everything in the document is inside a slide, except `::: styles` and `::: snippet` blocks,
comments, imports and snippet uses. Nested containers close with their own `:::`, so a slide
may hold `::: {.group}`, `::: {.element}` and `::: notes` blocks.

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `id` | identifier | required | the slide's name, used by `[[include: #id]]`, by the outline links and by `#slide=id` in the address bar |
| `title` | text | the first heading, else the id | the name shown in the outline and the breadcrumb |
| `width`, `height` | units | `layout.defaultSlideSize`, 16 × 9 | the canvas; one of them keeps the default proportions |
| `start_here` | flag | false | playback opens at this slide's entry; at most one slide (or include) may say so |
| `only_this` | flag | false | render only the slides that say so (a partial render while editing); the starting slide must be among them |
| `return_to_parent` | `true`, `false` | unset | after this slide's own program, zoom back to the parent before the next stop (`true`), go straight to the next sibling (`false`), or do so only when no sibling follows (unset) |
| `skip_return` | flag | unset | `return_to_parent=false`, from the other side; not together with it |
| `transition` | `zoom`, `cut`, a name | unset | how the camera arrives at this slide; a name is a module of the deck's `transitions/` folder |
| `preview` | flag | false | show the content before the first visit instead of fading it in on entry |

Rules: a slide identifier is unique; every slide is included by at most one other; the slides
nothing includes are the **roots**, visited first to last with a cut between them, and a deck
with one root is a tree. `root` in the front matter names the root of a single tree and is an
error on a forest. Including a slide that is not defined makes a red placeholder.

### [[include]] and [[subslide]]

```markdown
[[include: #child x=4 y=-1 width=8 step=2 preview]]
[[subslide: #child …]]           the same as include
[[subslide: Orbit x=5 width=6]]  a class of the deck's classes module or slides/ folder
```

An include places another slide as a child inside this one, as a viewport of the given width or
height in the parent's units, centered on `x`, `y` (0, 0 by default). It takes the layout
attributes `x`, `y`, `width`, `height`, `angle`, `anchor`, `at`, `dx`, `dy`, `buff`, `class`
and the relative references, plus:

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `width`, `height` | units | width 6, or the parent's width minus the margins when smaller | the child's size in the parent; one of them keeps the child's proportions |
| `angle` | radians | 0 | rotation of the child's viewport |
| `step` | integer ≥ 1 | after the numbered steps, in source order | the step at which the child is visited; children without a step are visited after the last numbered one, in order |
| `start_here`, `only_this`, `return_to_parent`, `skip_return`, `transition`, `preview` | as for slides | | the same flags, set from the parent's side |

A child may be included once in the whole deck. A `[[subslide: Name]]` with a class name takes
the same attributes; the class comes from the module `classes` names in the front matter or
from `slides/Name.ts`, and a dotted name (`helpers.Orbit`) walks namespaces.

### [[pdf]]

```markdown
[[pdf: assets/paper.pdf #pages x=0 y=-1 width=18 preview=true]]
```

A PDF placed inside a slide: an include whose child is the document, a hidden slide of a page's
size that is never a stop, with the pages stacked in it, the first shown and every next one
appearing over the previous when it is visited. The file comes first, relative to the Markdown
and then searched in the `paths` folders; `#id` is required and must not name a slide of the
document; the other attributes are those of an include, `preview=true` showing the first page
before the visit. The camera zooms into the first page, cuts from each page to the next, and
zooms back out after the last, the slide then showing the last page; the outline lists the
pages, by the document's bookmarks when it has them. The exports copy or embed the file.

### Flags of slides and children

`start_here`, `only_this`, `skip_return`, `return_to_parent`, `preview` and `focus_only` may be
written bare. `skip_return` and `return_to_parent` are two sides of one choice and cannot both
be given. At most one slide of the deck may say `start_here`, whether on the slide itself, on the
include that places it, or on a code-authored child.

### ::: styles

```markdown
::: styles
callout: color=ORANGE font_size=30
heading: color=BLUE_E
:::
```

A style block sits at the top level, before or between slides, one `name: attributes` line per
style. Names are identifiers; the attributes are any the styled construct takes, except `id`
and `class`. The same names may be defined under `styles` in the front matter, as attribute
strings or maps; the `::: styles` definition wins. How styles are applied is under
[Style roles and classes](#style-roles-and-classes).

### ::: snippet and [[snippet]]

```markdown
::: snippet card
::: slide {#{{id}} width=20}
## {{title}}
[{{note|A note}}]{#{{id}}-note x=0 y=-2}
:::
:::

[[snippet: card id=one title="First"]]
```

A snippet is markup written once and expanded wherever `[[snippet: name key=value …]]` stands
on a line of its own, before anything is parsed. It is defined in a `::: snippet name` block
anywhere (in the document or an imported file), whose lines run to the `:::` that closes it,
nested containers included, or in `snippets/name.md`. Placeholders `{{key}}` take the
attribute of the use; `{{key|default}}` has a value when the use gives none; a key with
neither is an error naming the snippet. Snippets may use imports and other snippets, eight
levels deep; a snippet that uses itself is an error. Errors inside an expansion name the block
and its line.

### ::: notes

```markdown
::: notes
The presenter's notes for the slide, in Markdown.
:::

::: notes {step=2}
Notes for step 2 only.
:::
```

Notes blocks inside a slide hold the presenter's notes. They are never laid out: they go to
the [companion tablet](player.html#a-tablet-as-a-drawing-pad), under the picture, the slide's
notes first and the current step's after them. `step=N` is the only attribute. `zoomdeck build
--without-notes` leaves them out of an export.

### [[import]]

```markdown
[[import: parts/footer.md]]
```

An import, on a line of its own, splices a Markdown file in before parsing: between slides it
adds slides and style blocks, inside a slide it adds elements and directives. The path is
relative to the importing file, then searched in the `paths` folders; it may be quoted. Imports
nest eight levels deep and may not form a cycle. Errors in an imported file name the file and
its line. Asset paths in an imported file resolve relative to the main document.

### Comments

`<!-- … -->` is discarded wherever it stands, over several lines too; the lines it covered keep
their numbers for error messages and editor jumps.

## Content blocks

A slide's body is CommonMark with the additions below. Blank lines separate blocks; a line
starting with `:::`, `[[` or `$$` ends the block before it. Each block is one element.

### Paragraphs and headings

A paragraph is a text element; `# Heading` to `###### Heading` are text elements of levels
one to six, in `layout.headingSize` shrinking per level. The attributes of a block go in
braces at the end of its last line, either after the text or around it as `[text]{…}`, which
keeps the braces off the text when the paragraph ends in a bracket:

```markdown
A caption under the figure. {#cap below:#figure font_size=20 color=GRAY}
[Shown on the second click]{#later step=2}
## A heading placed by hand {x=-7 y=4}
```

Text elements take the common attributes:

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `id` | identifier | `element-N` | the name other constructs refer to |
| `x`, `y` | units | flow | the position of the anchor; see [Positioning](#positioning) |
| `width` | units | the width available in the flow | the wrapping width |
| `height` | units | | scale the laid-out block to this height |
| `anchor` | `center`, `top`, `bottom`, `left`, `right`, `top-left`, `top-right`, `bottom-left`, `bottom-right`, `left-baseline`, `baseline`, `right-baseline` | `layout.textAnchor`, left-baseline | the point of the block that `x`, `y`, `at` and the alignments place |
| `at`, `dx`, `dy`, `buff`, `below`, `above`, `left-of`, `right-of`, `left-aligned`, `right-aligned`, `top-aligned`, `bottom-aligned`, `baseline-aligned` | | | relative placement, see [Positioning](#positioning) |
| `color` | color | `layout.color` | the text color; inline spans may override parts |
| `font` | family | `layout.font` | the typeface (text only; code and formulas have their own) |
| `font_size` | points | by level | the size |
| `opacity` | 0 to 1 | 1 | uniform opacity |
| `step`, `hide`, `enter`, `exit`, `run_time`, `lag` | | | visibility and its timing, see [Steps and motion](#steps-and-motion) |
| `focus_only` | flag | false | a decoration shown only while the slide is focused |
| `class` | names | | style classes, the same as `.name` tokens |
| `href` | link | | makes the block a link |

### Inline markup

Inside a paragraph, a heading, a list item, a table cell or the `label` of a connection, brace
or icon:

| Markup | Meaning |
| --- | --- |
| `**bold**`, `*italic*` | emphasis, nested as in CommonMark |
| `` `code` `` | inline code, in the code face |
| `$x^2$` | an inline formula, rendered by MathJax with the deck's `macros`; a dollar needs a backslash to stay literal |
| `[text](https://…)` | a link; targets as under [Links](#links) |
| `[text]{color=RED}` | a colored span; `color` is the only attribute an inline span takes |
| `\\` | a hard line break; a lone newline inside a paragraph is a space |
| `&&` | a column separator: in a block that contains one, every source line is a row and the cells align in columns across the rows, each as wide as its widest cell, an em apart ([Columns](text.html#columns)); `\&&` is a literal |

A `[text]{…}` at the end of a block with any attribute other than `color` is the block's
attribute list, not a span. Raw HTML is not interpreted.

### Lists

```markdown
- A bullet item
  - nested, indented by two spaces
1. A numbered item {#first step=1}
2. The next one {step=2}
```

Bullet (`-`, `*`, `+`) and numbered (`1.`, `1)`) lists nest by indentation. Every item is a text
element of its own, with the attributes written at the end of its line, so items appear one
click at a time. Bullets cycle through •, – and ◦ by depth; numbers keep the delimiter written.
Each level indents by `layout.listIndent` (0.6) and wraps within what remains of the width. A
blank line between items keeps the list together.

### ::: {.element}

```markdown
::: {.element #sales x=5 y=1.6 rules=rows}
| Region | 2023 |
| --- | --- |
| North | 3.2 |
:::
```

A wrapper for exactly one block, giving it attributes a trailing brace cannot: tables, display
math, a fenced listing, a paragraph whose last line would be ambiguous. The block's own
attributes, if any, merge with the wrapper's, which win.

### Display math

```markdown
$$ e^{i\pi} + 1 = 0 $$

$$
\int_0^1 f(x)\,dx
$$
```

`$$` on one line or around several lines is a math element, centered like other blocks in the
flow. It must not be empty. It takes the text attributes except `font`. Its color is `color=`
or the text color; `\color` and similar commands inside the formula are honored. The macros of
the front matter apply.

### Images and video

```markdown
![alt text](figures/plot.png){#plot x=4 y=0 width=6}
![a clip](assets/clip.mp4){#clip width=8 play=loop muted=true}
```

A paragraph holding only an image is an image element. The path is relative to the Markdown
file, then searched in the `paths` folders; a URL is taken as it is. PNG, JPEG, GIF, WebP,
APNG and SVG are images; an SVG keeps its own colors, `currentColor` becoming the text color.
A file ending in `.mp4`, `.m4v`, `.webm`, `.ogv`, `.ogg` or `.mov` is a video. Images take the
common attributes except `font`, plus:

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `width` | units | the available width | the displayed width; `height` instead scales to a height, both distort nothing (the first given wins) |
| `play` | `once`, `loop` | | play a video, an animated GIF, APNG or WebP, or a multi-page TIFF when the element appears: once, or until the slide is left |
| `muted` | `true`, `false` | | videos only: silence the sound |

Without `play=`, a video shows its poster frame and an animated image its first frame.
`play=` on a still image is an error.

### Code listings

````markdown
```python {#listing x=-7 y=3 font_size=18 width=9}
def f(x):
    return x * x
```
````

A fenced block (three or more backticks or tildes, closed by at least as many) is a verbatim
listing with syntax colors. The info string is the language name, then optional attributes;
the attribute `lang` inside the braces is accepted when no name precedes them. Listings take the common
attributes except `font` (the family is `layout.codeFont`), at `layout.codeSize` by default;
lines never wrap, `width` scales the block down to fit. The languages built in are `python`
(`py`), the C-like family (`javascript`, `typescript`, `js`, `ts`, `jsx`, `tsx`, `java`, `c`,
`cpp`, `c++`, `cs`, `rust`, `go`, `kotlin`, `swift`, `scala`, `dart`, `php`), `bash` (`sh`,
`zsh`, `shell`, `console`, `fish`), `json` (`json5`, `jsonc`), `latex` (`tex`), `html`
(`xml`, `svg`, `xhtml`), `markdown` (`md`, `slides`, `zs`, this dialect) and plain `text`; any
other name is looked for as `languages/<name>.json` and shown plain when absent. Token colors
follow the text color, or `layout.codeTheme`. A fence named `chart` is a chart, not a listing;
`zoomdeck` fences exist only in this documentation.

### Tables

```markdown
::: {.element #t x=0 y=0 rules=rows stripe_opacity=0.08 header=true}
| Left | Center | Right |
| :-- | :-: | --: |
| a | b | c |
:::
```

A pipe table with a delimiter row is a table element. The delimiter row sets the alignment of
each column (`:--` left, `:-:` center, `--:` right). Cells hold inline markup. Tables take the
common attributes except `height` and `font`, the hand-drawn attributes, and:

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `header` | `true`, `false` | true | whether the first row is a header |
| `padding` | units | 0.15 | space between a cell's text and its rules |
| `rules` | `all`, `rows`, `cols`, `outer`, `none` | `all` | which rules are drawn |
| `valign` | `baseline`, `center`, `top`, `bottom` | `baseline` | how the cells of a row line up: on their first baseline, so that text, formulas and descenders share a line, or by the middle, top or bottom of their box |
| `border_color` | color | the text color | color of every rule |
| `stroke_width` | engine units | 1.5 | width of every rule |
| `row_rule_color`, `row_rule_width` | color, engine units | `border_color`, `stroke_width` | the horizontal rules, between rows and at the top and bottom; width 0 leaves them out |
| `col_rule_color`, `col_rule_width` | color, engine units | `border_color`, `stroke_width` | the vertical rules, between columns and at the sides; width 0 leaves them out |
| `fill_color`, `fill_opacity` | color, 0 to 1 | none | background of the whole table |
| `header_color`, `header_opacity` | color, 0 to 1 | the rule color at 0.12 | background of the header row |
| `stripe_opacity` | 0 to 1 | 0 | background of every second body row, in the rule color |
| `width` | units | the available width | the width the table must fit in; columns shrink and wrap beyond it |

### Charts

````markdown
```chart {#visits x=4 y=0 width=7 height=3.5 type=line colors="RED_E TEAL_E" values=true}
Month, Visits, Signups
Jan, 12, 3
Feb, 18, 5
```
````

A fence named `chart` holds the data, its info string the options. Rows are separated by
commas, semicolons or tabs; lines starting with `#` are comments. The first row names the
series (its first cell is ignored) unless its cells after the first are plain numbers, years
counting as names; `header=` settles it. Each later row is a category followed by one value
per series. Charts take the common attributes, the hand-drawn attributes, and:

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `type` | `bar`, `line`, `pie`, a name | `bar` | the kind; a name is a module of the deck's `charts/` folder |
| `src` | path | | a CSV, TSV or JSON file with the rows instead of the fence's own, which is then empty; JSON is `{ "categories", "series": [{ "name", "values" }] }`, `{ "labels", "datasets": [{ "label", "data" }] }` or an array of rows |
| `header` | `true`, `false` | detected | whether the first row names the series |
| `width`, `height` | units | 6, 3.5 | the plot area (bars, lines) or the box a pie fits in; labels and the legend add to it |
| `colors` | colors, space- or comma-separated | a built-in palette | series or slice colors |
| `color` | color | the text color | axes, ticks and labels |
| `axis_color` | color | `color` | axes and gridlines |
| `border_color` | color | each series' own | outline of bars and slices |
| `stroke_width` | engine units | 2 | lines and outlines |
| `fill_opacity` | 0 to 1 | 0.85 | bar and slice fills |
| `grid` | `true`, `false` | true for bars and lines | horizontal gridlines at the ticks |
| `legend` | `true`, `false` | true with several series | a legend above the plot |
| `values` | `true`, `false` | false (pies always) | value labels on bars and points, percentages on slices |
| `min`, `max` | numbers | from the data, zero included | fixed bounds of the value axis; `max` must exceed `min` |

A chart needs rows, from the fence or from `src=`, not both. Negative values extend below the
baseline.

## Diagram directives

Directives are `[[kind: …]]` on a line of their own. Those below draw; the directives of
[Steps and motion](#steps-and-motion) change what is shown.

### Shapes

```markdown
[[rectangle: #frame x=0 y=0 width=6 height=3 corner_radius=0.3 fill_color=BLUE_E fill_opacity=0.2]]
[[circle: #c x=-4 y=1 radius=1.2 color=TEAL_E]]
[[dot: #p x=2 y=2]]
[[ellipse: #e x=4 y=0 width=3 height=1.5]]
[[polygon: #tri points="(0,2) (-2,-1) (2,-1)" sketch=true]]
[[polyline: #path points="(-6,0) (-3,2) (0,0)" stroke_width=3]]
[[arc: #a x=0 y=-2 radius=2 start_angle=3.14 angle=-3.14]]
```

Every shape needs an explicit `#id`. Shapes take the common attributes except `font`,
`font_size`, `width` and `height` (which some of them redefine), the hand-drawn attributes,
`tremble`, and:

| Shape | Required | Own attributes |
| --- | --- | --- |
| `rectangle` | `width`, `height` | `corner_radius` (0; at most half the smaller side), `fill_color`, `fill_opacity` |
| `circle` | `radius` | `fill_color`, `fill_opacity` |
| `dot` | | `radius` (0.08), `fill_color`, `fill_opacity` (1: a dot is filled) |
| `ellipse` | `width`, `height` | `fill_color`, `fill_opacity` |
| `polygon` | `points`, at least three `(x,y)` | `fill_color`, `fill_opacity`; the points are absolute coordinates |
| `polyline` | `points`, at least two `(x,y)`, consecutive ones distinct | no fill; the points are absolute coordinates |
| `arc` | `radius`, `angle` (nonzero) | `start_angle` (0), `fill_color`, `fill_opacity`; centered on `x`, `y`, counter-clockwise for a positive angle |

Common to all: `color` (the stroke, `layout.color` by default), `stroke_width` (2, in engine
units: one hundredth of a logical unit), `fill_color` (the stroke color by default),
`fill_opacity` (0 unless noted), `opacity`. `x`, `y` place the center (or the `anchor`);
polygons, polylines and arcs stay at their own coordinates unless positioned.

### [[arrow]] and [[line]]

```markdown
[[arrow: #alice -> #api, #req, label="HTTPS", color=GRAY]]
[[line: (-6,0) -> (6,0), #axis, stroke_width=1]]
```

A connection runs between two endpoints, each an element `#id`, met where the straight line
crosses its border (the outline of a circle, a dot or an ellipse, the bounding box of anything
else), an element at one of its anchors `#id.anchor` (the anchors of [`at=`](#at), such as
`#a.top-right`), or a point `(x,y)`; a line ends right there, an arrow a little short of it. The
endpoints come first, then `#id` and the attributes, comma-separated. Connections are laid out after the elements they join and cannot
be the reference of a position or the target of another connection or attachment.

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `id` | identifier | `element-N` | |
| `from`, `to` | `#id`, `#id.anchor`, `(x,y)` | required, written before the attributes | the endpoints |
| `label` | inline markup | | text at the middle of the connection |
| `label_side` | `above`, `below` | `above` | the side of the edge the label sits on, in the label's own frame along the edge: it reads from left to right (bottom to top on a vertical edge), and `above` is the side its letters stand on, so the left of a vertical edge |
| `slanted` | `true`, `false` | `false` | turn the label along the edge; otherwise it stays upright, beside the middle of the edge and clear of the line |
| `font`, `font_size` | | the text face, `layout.fontSize` | the label's face and size |
| `color` | color | the text color | stroke and label |
| `label_color` | color | `color` | the label alone, in a color other than the stroke's |
| `label_pos` | 0 to 1 | 0.5 | where along the edge the label sits, from its start (0) to its end (1), as `pos` in TikZ |
| `label_buff` | units | 0.1 | the distance between the edge and the label's lines; labels are measured by their font, so labels with and without descenders share a baseline |
| `stroke_width` | engine units | 2 | |
| `dashed` | `true`, `false` | `false` | draw the line, or the arrow's shaft, in dashes that begin and end it; they grow longer with `stroke_width`, the tip stays solid, and a hand-drawn connection gets hand-drawn dashes |
| `halo` | `true`, `false`, a color | `false` | a wider stroke under the line (the shaft of an arrow), in the deck's background with `true` or in the color named: where it crosses a path drawn before, it passes over it, as elements draw in source order |
| `halo_width` | engine units | `stroke_width` + 12 | the width of the halo; requires `halo` |
| `opacity` | 0 to 1 | 1 | |
| `step`, `hide`, `run_time`, `lag`, `href` | | | as for elements; connections fade only |
| `sketch` and the hand-drawn attributes, `tremble`, `tremble_amplitude`, `tremble_rate` | | | see [Appearance](#appearance) and [tremble](#tremble) |

### [[brace]]

```markdown
[[brace: #formula, #under, side=bottom, label="the whole sum", buff=0.2]]
```

A brace hugs one element, or several, on one side: under several it spans their joint bounding
box. The targets come first, then `#id` and the attributes.

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `side` | `left`, `right`, `top`, `bottom` | `bottom` | |
| `buff` | units | 0.15 | distance from the element |
| `label`, `font`, `font_size` | | | text beyond the brace, in the brace's `color` |
| `label_color` | color | `color` | the label in a color of its own |
| `label_buff` | units | 0.1 | the distance between the brace and the label's lines |
| `color`, `stroke_width`, `opacity`, `step`, `hide`, `run_time`, `lag`, `href` | | | as for connections |
| the hand-drawn attributes, `tremble` | | | |

### [[box]] and [[blob]]

```markdown
[[box: #a #b #c, #frame, buff=0.3, corner_radius=0.2, fill_color=GOLD_E, fill_opacity=0.15]]
[[blob: #store #cache, #cloud, buff=0.4, smoothness=0.6, color=RED, sketch=true]]
```

Enclosures surround one or more elements, listed before the first comma: a box is a rounded
rectangle around their bounds, a blob a smooth outline flowing around them (a group's members
and an icon's label count separately).

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `buff` | units | 0.15 for a box, 0.3 for a blob | the margin around the elements |
| `corner_radius` | units | 0 | box only |
| `smoothness` | 0 to 1 | 0.5 | blob only: how closely the outline follows the elements |
| `fill_color`, `fill_opacity` | | the stroke color, 0 | |
| `color`, `stroke_width`, `opacity`, `step`, `hide`, `run_time`, `lag`, `href` | | | as for connections |
| the hand-drawn attributes, `tremble` | | | |

Targets must be text, image, math, code, shapes, icons or groups of the same scope (a group's
members cannot be targeted from outside the group). The listed ids are the attachment's
`target`, which is not written as an attribute.

### [[icon]] and [[artwork]]

```markdown
[[icon: database #db x=3 y=0 size=1.4 label="Store" label_side=right color=GOLD_E]]
[[artwork: rocket #r x=-3 y=0 size=1.6 color=BLUE_E]]
```

An icon is one of the built-in symbols, drawn from geometry in the current stroke: `user`,
`users`, `database`, `server`, `client`, `desktop`, `phone`, `cloud`, `document`, `folder`,
`lock`, `gear`, `gears`, `message`, `globe`, `question`, `exclamation`, `info`, `warning`,
`check`, `cross`, `download`, `upload`, `puzzle`, `search`, `clock`, `calendar`, `arrival`,
`departure`, `recycle`, `trash`, `pin`, `key`, `shield`, `bolt`, `star`, `chart`, `home`,
`flag`. An artwork is one of the deck's own, `name.svg` or `name.ts` in its `artworks/`
folder; `[[icon: name]]` with a name that is not built in is the same as `[[artwork: name]]`.
Both need an explicit `#id` and take the common attributes except `width` and `height`, the
hand-drawn attributes, `tremble`, and:

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `size` | units | 1 | the height |
| `label` | inline markup | | a caption at 80 % of the font size |
| `label_side` | `below`, `above`, `left`, `right` | `below` | where the label sits; requires a label |
| `label_color` | color | `color` | the label in a color of its own; requires a label |
| `label_buff` | units | 0.15 | the distance between the symbol and the label's lines; requires a label |
| `color`, `stroke_width`, `fill_color`, `fill_opacity` | | the text color, 2, the stroke color, 0 | |

An artwork module reads any further attribute it likes, so no attribute name is rejected on
one; a module that returns a list of mobjects gives the artwork parts, which a blob flows
around separately. The icon's style role is `icon-<name>`.

### Directives of the deck's own

```markdown
[[gauge: #load x=4 y=0 level=0.7 label="load" step=2]]
```

Any `[[name: …]]` the dialect does not know is drawn by `directives/name.ts` of the deck. It
takes the common attributes, which position and animate it, and any attribute of its own; see
[Extending a deck](extending.html#directives). Without the module, the deck fails to build
with a message naming the folder.

### [[iframe]]

```markdown
[[iframe: https://example.org/demo #demo x=3 y=0 width=8 height=4.5 title="A live page" poster=assets/demo.png]]
```

A live web page inside the slide; see [Live pages](live-pages.html) for how it behaves while
the camera moves. The URL comes first and must be `http(s)://`, a root-relative or relative
path, or a `.html` file. `width` and `height` are required.

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `url` | address | required, written first | the page to show |
| `width`, `height` | units | required | the frame's size |
| `title` | text | the URL | the accessible name |
| `poster` | path | | an image shown until the page is live, and in exports |
| `stroke_width` | engine units | 0 | a border around the frame, in `color`; none by default |
| `x`, `y`, `anchor`, `at`, `dx`, `dy`, `buff`, the relative references, `class`, `step`, `hide`, `color`, `href`, `run_time`, `lag` | | | as for elements |

### ::: {.group}

```markdown
::: {.group #pair x=4 y=0 width=6 step=1}
[[circle: #c x=0 y=0 radius=0.5]]
A caption {below:#c}
:::
```

A group lays out its members in coordinates of its own, flow starting at the local origin
`(0,0)`, and is then one element: positioned, shown, hidden, animated and enclosed as a whole.
Members are elements, shapes, connections, attachments and nested groups; includes, subslides
and step directives are not allowed inside, and members take no `step`, `hide`, `focus_only`
or `play` of their own. Relative references stay within a group.

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `id` | identifier | `element-N` | members are named `id.element-N` when they have no id |
| `x`, `y` | units | flow | place the group's center, unless `anchor` names another point |
| `anchor` | the anchors, or `origin` | `center` | `origin` is the local (0, 0), where the members' flow starts |
| `width` | units | the available width | the flow width inside the group |
| `at`, `dx`, `dy`, `buff`, the relative references, `class`, `opacity`, `step`, `hide`, `enter`, `exit`, `run_time`, `lag`, `focus_only`, `href` | | | as for elements |
| `tremble`, `tremble_amplitude`, `tremble_rate` | | | shake the group's geometry |

## Positioning

### Flow

Elements without a position flow from the top-left corner of the canvas inside
`layout.margin` (0.65), downward, as wide as the canvas minus the margins. Text is spaced as in
LaTeX: the baselines of two paragraphs (blocks separated by a blank line) are
`layout.paragraphSpacing` interlines apart (1.5; the interline is the distance between the
baselines of two lines of one paragraph), the items of a list written without blank lines one
interline apart, and a text and any other block (a table, a shape, an image) keep the space two
paragraphs have between their lines. Two blocks that are not text are `layout.gap` (0.35) apart. Text wraps at that width; images and tables take it unless they say
otherwise. Nested list items indent. A block with an explicit `y`, an `at`, or a vertical
relative reference (`below`, `above`, `top-aligned`, `bottom-aligned`, `baseline-aligned`)
leaves the flow; a text block with only `x` keeps its flow line and moves horizontally.

### Coordinates and anchors

`x` and `y` place the element's **anchor** at that point: the left end of the first baseline
for text, formulas and listings (`layout.textAnchor`, `left-baseline`), the center for
everything else, groups included. `anchor=` names another point: `center`, `top`,
`bottom`, `left`, `right`, `top-left`, `top-right`, `bottom-left`, `bottom-right`,
`left-baseline`, `baseline` (its middle) or `right-baseline` (the first baseline, for text,
formulas and listings only), and `origin`, the local (0, 0) of a group. For a center-anchored element an omitted coordinate is 0; for a text
element it is the flow position.

### Relative placement

| Attribute | Meaning |
| --- | --- |
| `below:#id`, `above:#id`, `left-of:#id`, `right-of:#id` | put the element next to `#id` on that side, centered on it across the other axis, at distance `buff` (`layout.gap` by default); one direction at most. Between two texts, side by side they share the first baseline, and one below the other they are a line apart: the gap between their lines (font ascent and descent, not ink) is the line gap plus `buff` |
| `left-aligned:#id`, `right-aligned:#id`, `top-aligned:#id`, `bottom-aligned:#id` | align that edge with the edge of `#id` |
| `baseline-aligned:#id` | align the first baselines; both elements must be text, formulas or listings |
| `buff` | the distance of a direction; requires one |
| `x` or `y` with a reference | overrides the axis the reference leaves centered |

A reference names an element of the same slide and scope that is not a connection or an
attachment or, at the slide's top level, a slide it includes, by that slide's id (an element of
the same id comes first):
`[[include: #b below:#a]]` stacks two includes and `[caption]{#c below:#a}` puts a caption
under one. One horizontal and one vertical constraint at most, and not together with the
coordinate of the same axis. References may chain; a cycle is an error.

### at=

```markdown
[Label]{#l at=center:#box.top}      my center on the top of #box
[Label]{#l at=#box}                 my anchor on the center of #box
[[dot: #d at=(3,-2)]]               my anchor on a point
```

`at=[anchor:]#id[.anchor]` or `at=[anchor:](x,y)` lands an anchor of the element (its default
anchor when omitted) on an anchor of another element (its center when omitted) or on a point.
`at` replaces `x`, `y`, `buff` and the relative references, and may not reference a connection
or an attachment.

### Offsets

`dx` and `dy` shift the element after every other placement, in units; they require a
coordinate, an `at` or a relative reference.

### Sizing

`width` is the wrapping width of text, the displayed width of an image, the width a table or a
chart is drawn in, the scale of a listing, the flow width of a group, the size of a child's
viewport and a shape's own dimension. `height` scales text, images, listings and tables to a
height after layout, sizes charts and children, and is a dimension of rectangles and ellipses.
`size` is the height of an icon or artwork.

## Steps and motion

### step and hide

`step=N` on an element, a group or a connection makes it appear at click `N` of its slide;
omitted or `step=0`, it is part of the initial content; `step=-1` makes it the caption of a
child slide, faded in at a click of the parent just before the click that visits the child,
with no `enter=`, see [Before the visit](fragments.html#before-the-visit-step-1).
`hide=M` makes it disappear at click `M`, which must be later than its appearance. Numbers are local to the slide and need not be
consecutive: a lone `step=4` is one click. Changes sharing a number play together, then the
slide pauses; a step that also visits children plays the parent's changes first. Children are
visited at their `step` or, without one, after the last numbered step in source order. Elements
are drawn in source order, whichever click shows each.

### [[show]] and [[hide]]

```markdown
[[show: #a step=2 enter=grow run_time=0.6]]
[[hide: #a step=3 exit=shrink lag=0.2]]
```

Visibility directives repeat changes as often as needed. They take `step` (at least 1),
`run_time`, `lag`, and `enter` on `show` or `exit` on `hide`, which win over the element's own.
Showing an element already visible, hiding one already hidden, or changing one twice in the
same step is an error. Group members are shown and hidden through their group.

### Enter and exit styles

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `enter` | `fade`, `grow`, `write`, `create`, `draw`, or an effect of the deck's own | `fade` | how the element appears |
| `exit` | `fade`, `shrink`, `uncreate`, or an effect of the deck's own | `fade` | how it disappears |
| `run_time` | seconds | `layout.animationTime`, 0.35 | the duration of the fade or effect |
| `lag` | seconds | 0 | a delay before it, within the step |

A name that is not built in is `effects/<name>.ts` of the deck.

### focus_only and preview

`focus_only` marks a static decoration (no `step`, `hide` or `play`) shown only while its slide
is focused: it fades when the camera leaves and cannot be shown, hidden, transformed or
animated. `preview` on a slide, an include or a subslide shows the child's content before its
first visit, instead of fading it in on entry; the presenter's `revealOnEntry: false` does so
for every slide.

### [[next]] and [[skip_next]]

`[[next: step=N]]` advances to the following stop by itself once step `N` and the child visits
it triggers have finished; `step=0` is the slide's entry. `[[skip_next: step=N]]` omits exactly
one following event: a step, a child visit with its subtree, or the return to the parent. Each
takes `step` and nothing else, once per step.

### [[animate]]

```markdown
[[animate: #ball, step=1, x=6.5, run_time=1.2, rate=ease_in_out]]
[[animate: #card, step=2, angle=0.4, scale=1.3, color=ORANGE, opacity=0.6]]
[[animate: #child, step=3, at=center:(4,-2)]]
```

Moves or restyles a visible element, or an included child by its slide id. At least one target
property is required.

| Attribute | Values | Meaning |
| --- | --- | --- |
| `step` | integer ≥ 1 | required |
| `x`, `y` | units | move the anchor there (an omitted axis keeps its value) |
| `at` | as under [at=](#at) | move an anchor onto a point or another element; not together with `x`, `y` |
| `dx`, `dy` | units | move by this much, on top of `x`, `y` or `at` |
| `anchor` | an anchor | which point `x`, `y` and `at` move; a child viewport takes a box anchor, not a baseline or `origin` |
| `angle` | radians | rotate by this much about the center |
| `scale` | positive | scale about the center |
| `opacity` | 0 to 1 | the final opacity |
| `color` | color | the final color |
| `run_time`, `lag`, `rate` | | timing, see below |

### [[effect]]

```markdown
[[effect: indicate #before, step=3, color=GOLD_E, scale=1.2]]
```

Plays a named effect (the `name`, written first) on a visible element without changing its visibility: `indicate`,
`wiggle`, `circumscribe`, `flash`, `focus`, `grow`, `shrink`, `write`, `create`, `uncreate`,
`draw`, `wave`, or an effect of the deck's own (`effects/<name>.ts`; names may hold digits and
hyphens). `color` and `scale` tune the effects that take them; `step`, `run_time`, `lag` and
`rate` as for the others.

### [[transform]]

```markdown
[[transform: #before -> #after, step=4, run_time=1]]
```

Morphs a visible element into a hidden one, which is the visible element afterwards; later
`show` and `hide` directives address the new element. Give the target `step=N` for the
transform's own step: the morph reveals it instead of a fade. Neither may be `focus_only`, and
the two must differ. Attributes: `step`, `run_time`, `lag`, `rate`.

### [[move_along]]

```markdown
[[move_along: #ball, step=5, path=#orbit, run_time=2, rate=linear, rotate=true]]
```

Moves an element along a shape (`circle`, `arc`, `polyline`, `polygon`, `ellipse`,
`rectangle`); `rotate=true` turns it along the path. Attributes: `step`, `path` (required,
`#shape`), `rotate`, `run_time`, `lag`, `rate`.

### Timing: run_time, lag, rate

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `run_time` | seconds, positive | `layout.animationTime` (0.35) | the duration of the change |
| `lag` | seconds, nonnegative | 0 | a delay before it, within the step |
| `rate` | `smooth`, `linear`, `rush_into`, `rush_from`, `there_and_back`, `ease_in`, `ease_out`, `ease_in_out` | `smooth` | the easing, for `animate`, `effect`, `transform` and `move_along` |

### tremble

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `tremble` | `true`, `false`, `N`, `N-M` | | vibrate the element's geometry: from its appearance on, from step `N` on, or from `N` until `M` (which must follow `N` and come before `hide`) |
| `tremble_amplitude` | units | | the size of the vibration; requires `tremble` |
| `tremble_rate` | per second, positive | | its frequency; requires `tremble` |

Only vector geometry trembles: shapes, connections, attachments, icons and artworks, formulas,
groups, tables and charts.

## Appearance

### Hand-drawn rendering (sketch)

`sketch=true` draws a shape, connection, attachment, icon, table or chart as if by hand. The
look is stable across reloads, seeded by the element's id and line unless `seed=` says
otherwise.

| Attribute | Values | Default | Meaning |
| --- | --- | --- | --- |
| `sketch` | `true`, `false` | false | |
| `roughness` | nonnegative | 1 | the wobble: 0 is nearly exact, 2 and above careless |
| `bowing` | nonnegative | 1 | how much straight lines bend |
| `fill_style` | `hachure`, `solid`, `zigzag`, `cross-hatch`, `dots`, `dashed`, `zigzag-line` | `hachure` (`solid` for dots, tables and charts) | the fill pattern when `fill_opacity` is above 0 |
| `hachure_angle` | degrees | | the angle of the hatching |
| `hachure_gap` | positive | | the distance between hatch lines |
| `fill_weight` | nonnegative | | the thickness of hatch lines |
| `seed` | integer | from the element | the random seed |

### Style roles and classes

A style is a named attribute set. It applies through `.name` tokens (or `class="a b"`) on
elements, includes and subslides, and automatically through **roles**: every construct has
roles, and a style named after one applies to all of them. The roles are `body` (paragraphs
and list items), `heading` and `h1` to `h6`, `image`, `math`, `code`, `table`, `chart`,
`iframe`, `group`, `custom`, `shape` with the shape's kind (`rectangle`, `circle`, `dot`,
`ellipse`, `polygon`, `polyline`, `arc`), `icon` with `icon-<name>`, `connection` with `arrow`
or `line`, `attachment` with `brace`, `box` or `blob`, and `include` for children. Layers
apply in this order, each filling in what the earlier ones left unset: the construct's own
attributes win; then its classes, the last written first; then its roles, the most specific
first. `id` and `class` are never copied from a style. A class that no style defines is an
error. A `::: styles` block wins over `styles` in the front matter, which wins over a
theme.

### Color names

The engine palette, usable wherever a color is: `WHITE`, `BLACK`, `GRAY` and `GRAY_A` to
`GRAY_E`, `LIGHT_GRAY`, `LIGHTER_GRAY`, `DARK_GRAY`, `DARKER_GRAY`, `BLUE` and `BLUE_A` to
`BLUE_E`, `DARK_BLUE`, `PURE_BLUE`, `TEAL` and `TEAL_A` to `TEAL_E`, `GREEN` and `GREEN_A` to
`GREEN_E`, `PURE_GREEN`, `YELLOW` and `YELLOW_A` to `YELLOW_E`, `GOLD` and `GOLD_A` to
`GOLD_E`, `ORANGE`, `RED` and `RED_A` to `RED_E`, `PURE_RED`, `MAROON` and `MAROON_A` to
`MAROON_E`, `PURPLE` and `PURPLE_A` to `PURPLE_E`, `PINK`, `LIGHT_PINK`, `LIGHT_BROWN`,
`DARK_BROWN`. In each family `_A` is the lightest and `_E` the darkest; the bare name is `_C`.
Names are matched regardless of case. CSS names (`crimson`, `steelblue`, …) and hex values work
alike.

## The front matter

A deck is its Markdown file, and its settings are the YAML front matter at its top: the lines
between a first line `---` and the next `---` or `...`. They are left blank when the slides are
parsed, so every line keeps its number. Relative paths in it are relative to the file that names
them. An unknown setting is an error that lists the allowed ones.

```markdown
---
title: Lecture 3
viewport: 16x9
layout:
  fontSize: 26
macros:
  pair: ['\langle #1, #2 \rangle', 2]
styles:
  footnote: font_size=18 color=GRAY
---
```

### Settings

| Setting | Value | Meaning |
| --- | --- | --- |
| `title` | text | the page title and the outline's root label; by default the name of the folder holding the Markdown |
| `root` | id | the root of a single tree, checked; an error on a forest |
| `classes` | path | a module exporting slide classes for `[[subslide: Name]]` |
| `layout` | map | typography and spacing, below |
| `presenter` | map | timing and camera policy, below |
| `background` | color | the canvas background (white) |
| `viewport` | `16x9`, `16:9` or `{ width: 16, height: 9 }` | the proportions the camera fits (16 × 9) |
| `showOutline` | `true`, `false` | open the outline at start |
| `macros` | map | LaTeX macros for every formula: name to an expansion, or to `[expansion, number of arguments]`, or to `[expansion, number of arguments, default of the optional first one]`, as in MathJax; single quotes keep backslashes as written, `'\mathbb{N}'` |
| `styles` | map | named styles, a name to an attribute string or a map |
| `theme` | name or list | themes applied under the deck's own settings |
| `extends` | path | a Markdown file (its front matter) or a `.yaml`/`.yml` file (all settings) this one builds on, below |
| `paths` | folder or list of folders | searched, after the Markdown's own folder, for imports, images, videos, pages and data files |
| `artworks`, `fonts`, `effects`, `transitions`, `charts`, `languages`, `codeThemes`, `themes`, `slides`, `directives`, `snippets` | folder or list of folders | the deck's library, besides the folder of the same name next to the Markdown (`code-themes/` for `codeThemes`); see [Extending a deck](extending.html) |

### extends

`extends: ../course.yaml` takes the settings of another file under the file's own: `layout`,
`presenter`, `macros` and `styles` merge entry by entry, the file's own entries winning; the
folder settings add up, the file's own first; every other setting is replaced by the file's
own. Paths resolve against the file that names them. An extended file may extend another; a
cycle is an error. Options given in code to `loadMarkupDeck` or `markupDeck` win over the front
matter in the same way.

### layout

| Key | Default | Meaning |
| --- | --- | --- |
| `fontSize` | 28 | body text size, in points |
| `headingSize` | 42 | level-one heading size; each deeper level is 12 % of it smaller |
| `codeSize` | 80 % of `fontSize` | listing size |
| `color` | `#000000` | text and default stroke color |
| `font` | Latin Modern Roman | the prose family |
| `codeFont` | Latin Modern Mono | inline code and listings |
| `codeTheme` | follows `color` | a code theme of the deck, `code-themes/<name>.json` |
| `margin` | 0.65 | distance of the flow from the canvas edges |
| `gap` | 0.35 | distance between flowing blocks that are not text, and the default `buff` |
| `lineGap` | 0.12 | extra space between wrapped lines |
| `paragraphSpacing` | 1.5 | the distance between the baselines of two paragraphs in the flow, in interlines; a text and another block keep the space two paragraphs have between their lines |
| `listIndent` | 0.6 | indentation per list level, and the minimum width of the marker column |
| `animationTime` | 0.35 | the default `run_time` of fades and effects |
| `defaultSlideSize` | `[16, 9]` | the canvas of slides without `width` or `height` |
| `textAnchor` | `left-baseline` | the default anchor of text (`top-left` or `center` possible) |

### presenter

| Key | Default | Meaning |
| --- | --- | --- |
| `transitionTime` | 0.7 | seconds of each camera move; 0 jumps |
| `transition` | `zoom` | the default move: `cut` replaces the view at once, a name is a camera transition of the deck; a slide's own `transition=` overrides it for the moves into that slide |
| `padding` | 1 | camera width multiplier around a focused slide, at least 1 |
| `pauseOnEntry` | true | stop after entering a slide, before its first step |
| `pauseOnReturn` | true | stop after returning to a parent |
| `showSlideBorders` | false | draw every canvas border (a design aid) |
| `slideBorderColor`, `slideBorderWidth` | `#FC6255`, 3 | the border's style |
| `showSlideGrid` | false | draw a coordinate grid on the focused slide |
| `reversePlayback` | true | play a stop's animations backwards on the left key |
| `revealOnEntry` | true | children fade in when first entered; `false` shows every slide's content from the start |
| `renderCanvas`, `stillTime` | | accepted for older configurations; without effect |

### Library folders

Next to the Markdown, each of these folders extends the player by name when it exists, as do
the folders the settings above list: `artworks/` (`name.svg`, `name.ts`), `fonts/`
(`Family.woff2` and `-Bold`, `-Italic`, `-BoldItalic`), `effects/`, `transitions/`, `charts/`,
`directives/`, `slides/` (modules), `languages/` (`lang.json`), `code-themes/` (`name.json`),
`themes/` (`name.md`), `snippets/` (`name.md`). The `paths` folders are
searched last for every kind. [Extending a deck](extending.html) describes each file format.

### Theme files

A Markdown theme is a style sheet: `::: styles` blocks, or every line when it has none, with
three reserved names. `layout:` takes the keys of `layout` above, `presenter:` those of
`presenter`, and `deck:` takes `background=` and `viewport=16x9`. Later themes of a list
override earlier ones; the deck's own settings override them all.

## Errors

A document that breaks a rule does not build; the message names the line (and the imported
file or snippet) it comes from. Besides the constraints listed above, the parser rejects:

- a slide without `#id`, a duplicate slide or element id, an invalid identifier;
- a document without slides, or whose slides include one another in a cycle;
- `::: slide` or `::: styles` expected at the top level and something else found; inside a
  slide, a container that is not `{.element …}`, `{.group …}` or `notes`;
- an `.element` wrapper around anything but one block; a group holding an include, a subslide
  or a directive; a group member with `step`, `hide`, `focus_only` or `play`;
- an unknown attribute, a duplicate one, a malformed value, an unknown color, an unknown style
  class, an unknown anchor, a baseline anchor on anything but text, `origin` on anything but
  a group;
- a reference to an element that does not exist, or that belongs to another group; a
  connection or attachment used as a reference, endpoint or target; conflicting or cyclic
  positions;
- an element shown when visible, hidden when hidden, changed twice in one step, animated
  while hidden, transformed when not visible (or into one not hidden); `hide` not later than
  `step`; a step of zero on a directive or a child visit;
- `tremble` on an element without vector geometry, or starting after its `hide`;
- an unsupported link target, an iframe without `width` and `height` or with another kind of
  URL, `play=` on a still image;
- a chart without rows, with rows and `src=` both, with a type, color or bound that is not
  valid; a table with an unknown `rules`;
- an effect, enter or exit style, camera transition, chart type, directive, artwork, snippet
  or theme that is neither built in nor found in the deck's folders.
