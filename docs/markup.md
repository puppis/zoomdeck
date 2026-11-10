# The Markdown dialect

A deck is a Markdown file made of **slides**, each a `::: slide {#id} … :::` container with its own
logical canvas. Slides reference each other with `[[include: #id …]]` directives, which form the
tree that the player walks in pre-order while zooming. The guide deck in `examples/guide/` shows
every construct of this page live, each next to the listing that produced it; open it with
`npm run dev` (it is the default deck) and keep it beside this reference.

## Slides and the tree

```markdown
::: slide {#overview title="Lecture overview" width=20}
# Introduction

[[include: #chapter x=4 y=-1 width=8 angle=0.1 step=2]]
:::

::: slide {#chapter}
## A chapter
:::
```

- IDs start with a letter or underscore and continue with letters, digits, `_`, `.` or `-`; they
  are unique in the document. Definition order and heading levels never determine nesting.
- The root is the unique slide that nothing includes. Every slide must belong to that tree;
  unknown references, cycles and including the same slide twice are errors. To repeat a
  component, define it again under a fresh ID.
- `width` / `height` on a **slide** set its canvas (default 16 × 9, or `layout.defaultSlideSize`).
  One dimension infers the other from the default proportions; two choose a different aspect.
- On an **include** or **import**, `x`, `y` place the viewport's center, `width` / `height` size it
  (one dimension keeps the child's aspect, two letterbox it), `angle` rotates it in radians.
  Without `width` and `height` the viewport is at most six units wide. `subslide` is an alias of
  `include`.
- `title="…"` names the slide in the outline; otherwise its first heading, then its ID, is used.
- An include referring to an undefined slide draws a red placeholder rather than failing; the
  placeholder is never a stop, so the deck keeps running while the slide is still unwritten.
- `start_here=true` on a slide, include or import opens playback at that slide (at most one).
  `only_this=true` prepares only that subtree while editing; everything else becomes a placeholder.
- `skip_return=true` on a slide, include or import leaves that subtree straight for the next stop
  (the next sibling, or the parent's next fragment) without zooming back out first.
- Includes and imports accept `.class` styles, `anchor=`, `at=` and `dx`/`dy` like elements.
- Includes without `step` are visited in source order after all numbered steps of their parent;
  `step=N` interleaves a visit with the parent's fragments. On return the parent resumes with its
  previous state, and children keep their final appearance.

## Code-authored children

```markdown
[[import: Orbit x=0 y=-3 width=4 angle=0 step=5]]
```

`import` instantiates a `Slide` subclass exported by the module named by `imports` in
`deck.json` (or passed as `imports` to `markupDeck`). The class must be constructible without
arguments and return a fresh slide; put object creation in `build(ctx)` and animations in
`construct(ctx)`. Qualified names (`helpers.Orbit`) traverse namespaces. Each occurrence creates
its own instance, with the same placement and relative-positioning attributes as an include.

## Text

```markdown
Normal text with **bold**, *italic*, ***both***, `inline code` and [blue **emphasis**]{color=BLUE}.

[CSS colors too]{style="color:#ff0000"} and inline math $E=mc^2$; a literal dollar: \$5.

First line.\\
Second line.

- Bullet items are prose with a marker
```

Paragraphs, headings (`#` to `######`), bold, italic, nested emphasis, code spans and bullet lists
are supported; headings only change the size. Blank lines separate elements. HTML comments are
discarded and raw HTML is shown as text. Links (`[label](https://…)`, also `mailto:` and relative
URLs) are underlined and clickable in the player, opening in a new tab. Explicit line breaks take two
trailing spaces, a backslash before the newline, or `\\`. Prose wraps to the element's `width`,
mixed prose and math share one baseline, and a paragraph with inline math stays one element.

Colors are palette names (`BLUE`, `RED`, `TEAL`, `ORANGE`, `YELLOW`, `GRAY`, …), CSS names, hex
values or `rgb(…)`, written as `color=…` or `style="color:…"` (not both). Nested emphasis and
math inherit the span's color.

## Math

```markdown
Inline math shares the baseline: $\int_0^1 x^2\,dx = \tfrac13$.

$$
\sum_{k=0}^{n} \binom{n}{k} = 2^n
$$

::: {.element #formula x=0 y=-2 width=12 font_size=34 step=2}
$$ \textcolor{Orange}{a}^2 + {\color{Cerulean} b^2} = c^2 $$
:::
```

Single dollars give inline math, `$$` on its own lines (or `$$…$$` on one line) a display formula.
LaTeX renders through MathJax with the ams, newcommand and configmacros packages; `macros` in
`deck.json` defines extra commands. `\textcolor{…}{…}` and `{\color{…} …}` accept dvipsnames and
CSS colors. Wrap a formula in `::: {.element …}` to give it attributes.

## Images, animated images and videos

```markdown
![Illustration](assets/diagram.svg){#image x=3 y=1 width=4}
![Animated model](assets/model.png){#model width=6 play=loop step=1 hide=2}
![Explanation](assets/explanation.gif){#explanation width=4 play=once step=3}
![A recording](assets/clip.mp4){#movie width=8 play=once step=4 muted=false}
```

An image occupies a block of its own and is centered on `x`, `y`; paths resolve relative to the
Markdown file. SVG files keep nested transforms and inherited styles, but `<text>` is not rendered
(outline it first). Raster files may be PNG, JPEG, GIF or WebP. Multi-slide APNG and GIF files take
`play=once` (one cycle, keeping the last frame) or `play=loop` (the reveal is its own stop that
advances into a browser loop; the next click leaves it). A hidden image shown again restarts; images
sharing a step play together, finite ones before loops.

A video file (`.mp4`, `.webm`, `.ogv`, `.mov`) uses the same syntax and plays through the
browser's decoder: `play=once` is one pass as its own stop, `play=loop` keeps looping until the
next click, and without `play` the first frame is shown. Videos start muted so that playback is
never blocked; `muted=false` turns the sound on (the first click of the deck counts as the user
gesture browsers require). Playback follows the clip's clock, so the speed control resyncs rather
than slows the video, and backward navigation jumps over it instead of rewinding. `--one-file`
exports embed videos as data URIs, which grows the file quickly.

## Live pages

```markdown
[[iframe: https://example.org/demo, #demo, x=4 y=-1, width=8, height=4.5, step=2, title="Demo"]]
[[iframe: assets/embedded.html, #local, below:#heading, width=10, height=6]]
```

An `[[iframe: url, #id, …]]` embeds a web page. On the canvas it is a placeholder: the
`poster=` image scaled into the slide, or an outlined box labelled with the `title` (or the URL).
It takes the usual placement attributes plus `width` and `height`, `step`/`hide` and `color`. The
live page appears over the placeholder only once the camera has come to rest on its slide: in
parent previews, during zooms in and out, and after the camera leaves, the placeholder stands in. Interaction inside the page is real, so click outside it to return the
keyboard to the deck. URLs must be `http(s)` or relative to the Markdown file; pages that forbid
framing stay blank. The page is not drawn by the pen or spotlight overlays and is absent from
exported screenshots.

## Shapes, connections and attachments

```markdown
[[rectangle: #box x=-3 y=0 width=4 height=2 corner_radius=0.2 fill_color=BLUE fill_opacity=0.1 step=1]]
[[circle: #state right-of:#box buff=1 radius=0.5 step=1]]
[[dot: #p x=1 y=2 color=YELLOW]]
[[ellipse: #e x=4 y=0 width=3 height=1.5]]
[[polygon: #tri points="(0,0) (2,0) (1,1.5)" fill_color=ORANGE fill_opacity=0.3]]
[[arc: #a x=0 y=-2 radius=1.2 start_angle=0 angle=2.4]]
[[polyline: #plot points="(-4,-2) (-1,-1) (2,1)" color=RED stroke_width=2 step=2]]
[[arrow: #box -> #state, #edge, label="$a$", color=YELLOW, step=3]]
[[line: (-3,-2) -> (3,-2), #baseline, color=GRAY, stroke_width=2]]
[[brace: #e, #eb, side=bottom, label="an ellipse"]]
[[box: #tri, #tb, buff=0.2, corner_radius=0.1, color=GREEN]]
```

Shapes need an `#id`. Rectangles take `width`, `height` and optional `corner_radius`; ellipses
`width` and `height`; circles `radius`; dots an optional `radius` (0.08, filled by default);
polygons at least three `points` (closed, fillable); arcs `radius`, `angle` and optional
`start_angle` (radians, centered on `x`, `y`); polylines at least two distinct `points`. All accept
`color` (the layout color by default), `stroke_width` (default 2), `fill_color` and `fill_opacity`
(0 by default; polylines have no fill), `opacity`, the positioning attributes below, `step`,
`hide` and `focus_only`. Point-defined shapes without positioning keep their coordinates. Shapes
serve as anchors and connection endpoints.

A `brace` or `box` is **attached** to one element, named first: `[[brace: #target, #id, …]]`.
Braces take `side` (`bottom` by default, or `left`, `right`, `top`), `buff`, an optional inline
`label` with `font_size`, `color` and `stroke_width`; boxes (surrounding rectangles) take `buff`,
`corner_radius`, `color`, `stroke_width`, `fill_color` and `fill_opacity`. Both accept `step`,
`hide`, `opacity` and timing. Like connections they are created after layout, so they cannot anchor
other elements or serve as endpoints.

Arrows and lines go from one endpoint to another: an element ID (attached at the facing bounding
edge) or a literal `(x,y)` point. They take an optional `#id`, `label` (inline text and math,
placed above the connection), `color`, `stroke_width`, `step` and `hide`. Connections are created
after all other elements, cannot anchor other elements, and are not hidden implicitly when an
endpoint disappears.

### Hand-drawn shapes

```markdown
[[rectangle: #hr x=-6 y=0 width=3.4 height=1.8 corner_radius=0.3 fill_color=BLUE fill_opacity=0.5 sketch=true]]
[[circle: #hc right-of:#hr buff=1 radius=0.9 fill_color=GREEN fill_opacity=0.6 fill_style=cross-hatch sketch=true]]
[[polygon: #hp points="(0,-2) (1.5,0) (3,-2)" fill_color=ORANGE fill_opacity=1 fill_style=solid roughness=2 sketch=true]]
[[arrow: #hr -> #hc, #ha, sketch=true]]
[[brace: #hc, #hb, side=bottom, label="by hand", sketch=true]]
```

Every shape, connection and attachment takes `sketch=true` and is then drawn as if by hand
(through Rough.js): a wobbly outline traced twice and a fill made of hatching lines. `fill_style`
chooses `hachure` (default; dots default to `solid`), `solid`, `zigzag`, `cross-hatch`, `dots`,
`dashed` or `zigzag-line`; `roughness` (1), `bowing` (1), `hachure_angle` (degrees, -41),
`hachure_gap` (logical units), `fill_weight` (like `stroke_width`) and `seed` (an integer; by
default derived from the element's ID and line, so the drawing is stable across reloads) tune it.
`fill_opacity` becomes the opacity of the hatching and survives fades; a filled arc is drawn as a
pie slice; braces become a single stroke on their side; a hand-drawn `move_along` path moves the
follower along the exact geometry. A `shape: sketch=true` style (also `connection`, `attachment`)
sketches a whole deck, and `sketch=false` opts an element out.

## Code listings

````markdown
```python {#listing x=-7 y=3 width=9 font_size=20 step=2}
def visit(slide):
    yield slide
    for child in slide.children:
        yield from visit(child)
```
````

A fenced block (`` ``` `` or `~~~`, or an indented block) is a verbatim listing. The info string
names the language, optionally followed by the usual `{…}` attributes: `#id`, `x`/`y` (left edge
and first baseline, like prose), `width` (the block shrinks uniformly if a line is wider),
`height`, `font_size` (default `layout.codeSize`, 80 % of the text size), `color`, `anchor`,
`step`/`hide`, `focus_only` and relative placement. Lines never wrap, tabs become four spaces, and
a `::: {.element …}` container around the fence works as for other blocks.

Tokens are colored for `python`, `javascript`/`typescript`/`jsx`/`tsx`, C-like languages (`c`,
`cpp`, `java`, `cs`, `rust`, `go`, `kotlin`, `swift`, …), `bash`/`sh`, `json`, `latex`/`tex`,
`html`/`xml`/`svg` and `markdown` (this dialect: containers, directives, attributes, math, code
spans). Other names, or no name, give plain text. The palette depends on the slide's text color, so
light text on a dark background and dark text on a light background both stay readable;
`layout.codeFont` picks the monospace family.

## Positioning and layout

```markdown
[**Positioned label**]{#label x=2 y=-1.5 width=5 font_size=32 color=RED}

A complete paragraph can also carry attributes. {#paragraph x=0 y=2 width=12}

::: {.element #formula x=0 y=-2 step=3}
$$ E=mc^2 $$
:::
```

Attributes at the end of a block describe that block; brackets around the whole block are optional,
and an `.element` container wraps exactly one paragraph, heading, image, listing or display formula.
IDs are unique within their slide; omitted IDs become `element-N`.

`x`, `y` position the element's **anchor**: for prose, headings, math and listings the default
is `left-baseline` (the left edge and the first baseline), for images, shapes and child viewports
it is `center`. `anchor=` chooses another point: `center`, `top`, `bottom`, `left`, `right`,
`top-left`, `top-right`, `bottom-left`, `bottom-right`, or `left-baseline` / `right-baseline` for
text-like elements (`layout.textAnchor` changes the text default). Blocks without coordinates flow
downward from the top-left margin; text with only `x` keeps flowing at that edge, while an explicit
`y` or a vertical constraint leaves the flow; a center-anchored element defaults an omitted axis to
zero. `dx` and `dy` shift the final position of any positioned element. `width` controls wrapping,
image width and the maximum formula or listing width; `height` scales the result; `font_size`
overrides the layout size; `opacity` (0 to 1) makes any element translucent.

### Anchor expressions

```markdown
[[rectangle: #ref x=-6 y=-2 width=3 height=1.6]]
[My top-left at its bottom-right]{at=top-left:#ref.bottom-right dx=0.2}
[[dot: #d at=#ref.top]]
[Centered on a point]{at=center:(5,-3)}
```

`at=[anchor:]#id[.anchor]` or `at=[anchor:](x,y)` puts one anchor of the element (the prefix, or
`anchor=`, or its default) on an anchor of another element (`center` when omitted) or on a literal
point. It replaces `x`, `y` and the relative constraints below, combines with `dx`/`dy`, leaves
the flow, and follows the same reference rules (same slide, same group, no arrows or lines).

### Relative positioning

```markdown
# A heading {#heading x=0 y=3}

[An explanation]{#explanation below:#heading left-aligned:#heading buff=0.4 width=8}

[A side note]{#note right-of:#explanation top-aligned:#explanation buff=0.5 width=3}

[Large label]{#label x=-6 y=2 font_size=48}
[Small explanation]{x=1 baseline-aligned:#label font_size=24}

[[include: #diagram below:#heading left-aligned:#heading width=6 step=1]]
```

`below`, `above`, `left-of` and `right-of` place an element beyond the reference's bounding edge,
centered on the other axis, at distance `buff` (default `layout.gap`). `left-aligned`,
`right-aligned`, `top-aligned` and `bottom-aligned` match an edge without moving the other axis.
`baseline-aligned` matches the typographic baseline of text, math or listings. One direction and at
most one constraint per axis are allowed; an explicit coordinate may set the free axis. References
target elements of the same slide, including later ones and hidden fragments; sizes are measured
once during preparation, so show/hide never reflows. Includes and imports accept the same
attributes against local elements.

## Styles

```json
"styles": { "footnote": { "font_size": 18, "color": "GRAY" }, "heading": "color=#93C5FD" }
```

```markdown
::: styles
callout: color=ORANGE font_size=30
:::

[A side remark]{.footnote below:#body}
[Look here]{#c .callout x=0 y=-2}
```

A style is a named attribute set, defined in `deck.json` (`styles`, as objects or attribute
strings) or in a `::: styles` block at the top of the Markdown file, which wins for the same
name. Elements, includes and imports opt in with `.name` tokens (several allowed, later ones
win). Styles named after a **role** apply automatically: `heading` (also `h1` … `h6`), `body`,
`math`, `code`, `image`, `shape` (also `rectangle`, `circle`, …), `connection` (`arrow`, `line`),
`attachment` (`brace`, `box`), `group` and `include`. Resolution order: the element's own
attributes, then its classes, then its roles, then the layout defaults. A style may set any
attribute the element accepts, including `anchor`, `width`, `opacity` or `stroke_width`;
unsupported ones are reported like misplaced attributes.

## Groups

```markdown
::: {.group #automaton x=2 y=-0.5 step=1}
[[circle: #q0 x=0 y=0 radius=0.6]]
[$q_0$]{at=#q0.center anchor=center}
[[circle: #q1 x=3 y=0 radius=0.6]]
[[arrow: #q0 -> #q1, #t, label="$a$"]]
:::

[[box: #automaton, #slide, buff=0.3, step=2]]
```

A `::: {.group #id …}` container holds elements, shapes, connections, attachments and nested
groups (no includes, imports or directives). Members are laid out in the group's own coordinates:
flow starts at the local origin, explicit coordinates and `at=` are local, and members may only
reference members of the same group. The group is then one element of the slide: `x`, `y` place
its `origin` (the local `(0,0)`) unless `anchor=` names a bounding-box point; relative constraints,
`at=`, `dx`/`dy`, `width` (the members' wrapping width), `opacity`, `step`, `hide` and
`focus_only` apply to the whole; it can be an `at=` or relative reference, an arrow endpoint and a
brace or box target. Members cannot carry `step`, `hide`, `focus_only` or `play`, and `show`/`hide`
cannot target them. Member IDs without an explicit `#id` are prefixed with the group ID.

## Fragments and click steps

```markdown
[An initial hint]{#hint x=0 y=-2 hide=3}

[First state]{#q0 x=-3 y=0 step=1}

[Second state]{#q1 x=3 y=0 step=2}
[[next: step=2]]

[[show: #hint step=4]]
[[hide: #hint step=5]]
[[skip_next: step=5]]
```

An omitted `step` (or `step=0`) makes an element part of the initial content; `step=N` fades it in
at click N and `hide=M` fades it out later. `[[show: #id step=N]]` and `[[hide: #id step=N]]`
repeat changes; showing a visible element or hiding a hidden one is an error. All changes sharing a
number play together, followed by a pause. Each fade lasts `layout.animationTime` unless the element
sets `run_time=S`; `lag=S` delays its start inside the step, so one click can stagger several
elements. A `show`/`hide` directive may carry its own `run_time` and `lag`. Numbers are local to the slide
and need not be consecutive. Only the root is visible at the start; each descendant fades in on its
first entry and stays visible afterwards.

`[[next: step=N]]` advances automatically once step N (and the child visits it triggers) has
finished. `[[skip_next: step=N]]` omits exactly one following event: a fragment step, a child visit
(with its whole subtree) or the return to the parent, even across numeric gaps. `step=0` applies
either directive to the slide's entry.

## Animations

```markdown
[[animate: #ball, step=1, x=6.5, run_time=1.2, rate=ease_in_out]]
[[animate: #card, step=2, angle=0.4, scale=1.3, color=ORANGE, opacity=0.6]]
[[animate: #label, step=2, at=top-left:#card.bottom-left, dy=-0.2]]
[[effect: indicate #title, step=3, color=YELLOW, scale=1.2]]
[[transform: #before -> #after, step=4]]
[[move_along: #ball, step=5, path=#orbit, run_time=2, rate=linear, rotate=true]]
[[animate: #diagram, step=6, x=3, angle=0.2]]
[A formula]{#f step=7 enter=write exit=shrink}
```

Animation directives play at a numbered step, together with the fades of that step, and share the
timing attributes `run_time`, `lag` and `rate` (`smooth`, `linear`, `rush_into`, `rush_from`,
`there_and_back`, `ease_in`, `ease_out`, `ease_in_out`). Targets must be visible at that step; a
target may be changed only once per step.

- **`animate`** interpolates toward a target state: `x`, `y` or `at=` move the element's anchor
  (`anchor=` picks another point), `dx`/`dy` add an offset, `angle` rotates by that many radians,
  `scale` scales by that factor, `opacity` and `color` set final values. The ID may name an
  **included slide**: its viewport then moves, rotates or scales, and the whole subtree follows.
- **`effect`** plays a named engine effect on an element: `indicate`, `wiggle`, `circumscribe`,
  `flash`, `focus`, `grow`, `shrink`, `write`, `create`, `uncreate`, `draw`, `wave`; `color` and
  `scale` tune the ones that take them. Effects do not change the visibility state.
- **`transform`** morphs a visible element into a hidden one, which becomes the visible element
  afterwards (so later `hide`/`show` directives address the new element). Give the target element
  `step=N` for the transform's own step: the morph then reveals it instead of a fade. It works best
  between formulas and shapes.
- **`move_along`** moves an element along a shape (`circle`, `arc`, `polyline`, `polygon`, …);
  `rotate=true` turns it along the path.
- **`enter=`** and **`exit=`** on an element (or on `show`/`hide` directives) replace the default
  fades: `enter` takes `fade`, `grow`, `write`, `create` or `draw`; `exit` takes `fade`, `shrink`
  or `uncreate`. `write`, `create`, `draw` and `uncreate` suit vector content (math, shapes).

Group members cannot be animated individually; animate the group.

## Decorations visible only in focus

```markdown
[[rectangle: #paper x=0 y=0 width=16 height=9 fill_color=white fill_opacity=1 stroke_width=0 focus_only=true]]

## Detail {#heading x=0 y=5 focus_only=true}
```

Static text, math, images, listings and shapes with `focus_only=true` fade in when their slide is
focused and out when the camera leaves, including to a child. They are drawn behind the ordinary
content, still take part in layout and can anchor other elements. They cannot carry `step`, `hide`
or `play`, and `show`/`hide` directives cannot target them.

## Deck configuration

```json
{
  "markup": "slides.md",
  "title": "A dark deck",
  "imports": "code-slides.ts",
  "root": "overview",
  "background": "#0F172A",
  "viewport": { "width": 16, "height": 9 },
  "layout": { "color": "#F1F5F9", "fontSize": 26, "headingSize": 40, "codeSize": 19, "font": "Georgia" },
  "presenter": { "transitionTime": 0.8, "padding": 1, "showSlideBorders": false, "showSlideGrid": false },
  "macros": { "N": "\\mathbb{N}" }
}
```

A deck is black text on a white canvas unless `background` and `layout.color` say otherwise.
Prose is set in the bundled Latin Modern Roman and code in Latin Modern Mono (the LaTeX text and
typewriter faces) unless `layout.font` or `layout.codeFont` name other families, and formula sizes
are calibrated so that a `font_size` means the same em for text, code and math. `layout` takes `fontSize`, `headingSize`, `codeSize`, `color`, `font`, `codeFont`, `margin`,
`gap`, `lineGap`, `animationTime`, `defaultSlideSize` and `textAnchor`. `presenter` takes
`transitionTime`, `padding`, `pauseOnEntry`, `pauseOnReturn`, `showSlideBorders`,
`slideBorderColor`, `slideBorderWidth`, `showSlideGrid` and `reversePlayback` (default true: the
left key plays the current stop backwards, camera moves included; ops that cannot run backwards,
such as videos and updater-driven waits, are passed over; `false` restores instant jumps). `viewport` sets the proportions the
camera fits; `root` names the root slide explicitly; `showOutline` opens the outline at start.

## Errors

Syntax and reference problems are reported with the source line: unknown attributes, duplicate or
missing IDs, conflicting constraints, positioning cycles, inconsistent visibility, invalid colors,
unknown classes and missing images. Validation happens before any text, image or formula is
created, so a broken deck fails fast.
