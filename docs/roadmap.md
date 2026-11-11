# Markup roadmap

Status of the desirable features of the Markdown dialect, and a phased plan to reach the missing
ones without letting the sources or the syntax grow clumsy. Status legend: **done**, **partial**,
**missing**. Where a feature is partial, the gap is stated precisely. File names refer to `src/`.

## 1. Assessment

| # | Feature | Status | Today | Gap |
| --- | --- | --- | --- | --- |
| 1 | Hierarchical slide order, pre-order visit | **done** | Slides form a tree through includes; the presenter walks it stacklessly in pre-order; `step` interleaves visits with fragments. | — |
| 2 | Nested subslides, zoom in / zoom out | **done** | `[[include: … x y width height angle]]`; entering animates the camera into the viewport, returning zooms out; uniform scale, rotation, letterboxing. | Viewports can only be *animated* (moved while presenting) from code-authored slides, not from markup (see 4). |
| 3 | Element types | **done** | Text, LaTeX, code listings, images (SVG, raster, APNG/GIF movies), videos, rectangles, circles, dots, ellipses, polygons, arcs, polylines, braces, boxes, arrows, lines, clickable links, iframes (live while focused), subslides, imported code slides. | — |
| 4 | Element animations beyond fade | **done** | `[[animate]]` (move, rotate, scale, opacity, color, also on included viewports), `[[effect]]` (twelve engine effects), `[[transform]]`, `[[move_along]]`, `enter=`/`exit=` styles, `rate=`; code slides keep the full engine. | Keyframe chains inside one click beyond `lag` (phase 4 or later if needed). |
| 5 | Logical coordinates, dynamic global coordinates | **done** | Each slide has its own canvas; the display groups compose ancestor transforms; moving a viewport repositions all descendants (`presenter.reposition`, demonstrated by `MovingFrames`). | — |
| 6 | Advanced anchor-based positioning | **done** | `anchor=` on every element and viewport; `at=[anchor:]#id[.anchor]` and `at=(x,y)` expressions; `below/above/left-of/right-of` + `buff`, `*-aligned`, `baseline-aligned`; `dx`/`dy`. | Nothing planned; per-line baselines of paragraphs only if a need appears. |
| 7 | Compound objects with derived anchors | **done** | `::: {.group #id}` containers: members in local coordinates, union-box anchors plus `origin`, positioned, faded and attached to as one element; nestable. | Members cannot have their own fragments (planned relaxation if needed). |
| 8 | Sizes, colors, opacity, default styles per role | **done** | Per-element attributes; named styles in `deck.json` and `::: styles` blocks, applied by `.class` tokens and by roles (`heading`, `body`, `code`, `shape`, …); `LayoutConfig` defaults. | — |
| 9 | Grouping of animations: parallel, sequence, automatic | **done** | Same step number = parallel (fades, animations, effects alike); `run_time`, `lag` and `rate` per change; `[[next: step=N]]` = auto-advance; `skip_return=true` enters the next sibling without zooming out. | An explicit sequence keyword inside one click could replace hand-computed `lag` values later. |
| 10 | Edit the document and see the effect immediately | **done** | `zoomdeck serve` and the dev page reload on save (Markdown, deck.json, assets) and restore the current stop; errors show the source line. | Reload re-records the whole deck (a few seconds on large decks); incremental re-recording deferred. |
| 11 | Reverse playback on the left key | **done** | The left key plays the current stop backwards (fades, property animations, effects, camera moves); videos, loops and updater-driven waits are passed over; `reversePlayback: false` restores jumps. | — |
| 13 | Hand-drawn shapes | **done** | `sketch=true` on shapes, connections and attachments, with `fill_style`, `roughness`, `bowing`, `hachure_*`, `fill_weight`, `seed`; Rough.js geometry converted to engine paths (`src/sketch.ts`); deck-wide through style roles; `sketch` helper for code slides (added 2026-11-11). | — |
| 14 | Diagram icons, enclosures, tremble | **done** | `[[icon: name …]]` (thirty-nine symbols built from paths in `src/icons.ts`, with fill, outline, label, sketching, style roles `icon`/`icon-<name>`); `box` around several elements and `[[blob: …]]` (distance-field contour in `src/blob.ts`, `buff`, `smoothness`); `tremble=true|N|N-M` vibration of vector geometry recorded as looping clips (`Tremble` in `animations.ts`) (added 2026-11-11). | — |
| 15 | Importing markup files | **done** | `[[import: path.md]]` splices files before parsing (`src/markup/imports.ts`), with per-line origins for error messages, nested imports and cycle detection; exports embed the files. The code-authored child keyword became `[[subslide: ClassName]]` and the `deck.json` key `classes` (added 2026-11-11). | — |
| 12 | Design mode: drag objects in the browser | **missing** | Elements know their source line (`ElementSpec.line`) and the player exposes `navigation()`; nothing interactive. | Hit-testing, dragging in logical coordinates, writing attributes back into the file. |

Everything that is **done** or **partial** is exercised by `examples/guide/` and described in
`docs/markup.md`; both must be updated together with each phase below.

## 2. Design principles for what follows

- **One mechanism, several spellings.** New syntax should compile to a small number of internal
  concepts: an *anchor expression*, a *style*, an *action* at a *step*. Shorthands stay as sugar
  over them, so the current decks keep working unchanged.
- **Validate before rendering.** New attributes go through `ASTTransformer` with source lines,
  like the existing ones, so mistakes are reported at load and never at playback time.
- **Keep the recording model.** Every new animation is an ordinary engine animation played inside
  `MarkupSlide.construct`, so clips, snapshots, outline jumps, speed control and static exports
  keep working without special cases. Reverse playback (phase 4) is built on the same ops.
- **DOM only where WebGL cannot.** Links, iframes and (if needed) HTML video live in a transparent
  DOM layer kept in sync with the camera; everything else stays on the canvas.

## 3. Phases

Each phase ships with: tests in `tests/`, a section in `docs/markup.md`, and a slide (or a new
chapter) in the guide deck. Phases are ordered so that later ones build on earlier abstractions;
within a phase the items are independent.

### Phase 1 — small gaps, no new concepts (done 2026-11-10)

Low risk, mostly additive validation and rendering. Implemented; see the guide chapters
"More shapes, braces, boxes and opacity" and "Anchors, offsets and timing".

1. **More shapes**: `[[dot: #p x=1 y=2]]` (radius 0.08 by default), `[[ellipse: … width height]]`,
   `[[polygon: … points="(…)"]]` (closed, fillable), `[[arc: … radius start_angle angle]]`,
   `[[brace: #a side=left label="…"]]`, `[[box: #a buff=0.1]]` (surrounding rectangle). All reuse the
   shape attribute set (`color`, `stroke_width`, `fill_color`, `fill_opacity`, positioning, `step`).
2. **`opacity`** on every element (text, math, images, listings, shapes), kept through fades.
3. **`skip_return=true`** on a slide or include: the next sibling is entered straight from this
   subtree, the documented way to "move to the next subslide without zooming out".
4. **Timing attributes** on fragments: `run_time=0.6` and `lag=0.3` (delay inside the step), so
   several elements of one click can appear staggered without extra steps.
5. **`dx` / `dy` offsets** usable with any relative constraint (`below:#h dy=-0.2`).
6. **`anchor=` for images, shapes, listings and viewports**, with the full anchor vocabulary of
   phase 2 item 1, so `x`/`y` can address a corner or an edge midpoint of anything.
7. **Clickable links** rendered as text with an underline and a DOM hit area (`[text](url)`): the
   first use of the overlay layer, limited to opening a URL in a new tab.

### Phase 2 — anchors, styles, groups (done 2026-11-10)

Implemented as proposed; see the guide chapters "Anchor expressions and styles" and "Groups".
Group members use group-local coordinates and reference only members; styles live in `deck.json`
and in a `::: styles` block that wins for the same name.

1. **Anchor expressions.** One grammar for positions:

   ```
   at=#ref.anchor            my default anchor at that point
   at=top-left:#ref.bottom-right   my top-left at its bottom-right
   at=(2,-1) anchor=center   explicit point (equivalent to x=2 y=-1 anchor=center)
   ```

   Anchors: `center`, `top`, `bottom`, `left`, `right`, `top-left`, `top-right`, `bottom-left`,
   `bottom-right`, plus `baseline-left`/`baseline-right` for text, math and listings. `dx`/`dy`
   apply after. Existing `below:`/`above:`/`*-aligned`/`baseline-aligned` become sugar compiled to
   the same resolver (`placeRelative` is replaced by one `resolvePlacement`). Dependencies and
   cycles are checked as today.
2. **Styles.** `deck.json` (and `markupDeck`) accept `"styles": { "footnote": { "font_size": 18,
   "color": "GRAY" }, "title": {…} }`; elements opt in with classes, `{.footnote}`; the resolution
   order is element attributes → classes (in order) → built-in role (`heading`, `body`, `code`,
   `label`) → `layout`. Styles can also set `anchor`, `width`, `opacity`, `stroke_width`.
3. **Groups.** `::: {.group #g x=… y=… anchor=…}` encloses several blocks and directives. The
   group is one element for positioning, visibility (`step`, `hide`), opacity and later
   animations; its anchors come from the union of its members. Members are laid out in the
   group's own coordinates (origin at the group's anchor), which makes diagrams relocatable as a
   unit. Open question: whether members may also reference elements outside the group (proposal:
   yes for reading positions, no for being referenced).
4. **Anchors of compounds**: paragraphs expose per-line baselines (`#p.line-2.baseline-left`) only
   if a concrete need appears; otherwise the union box and first baseline suffice.

### Phase 3 — animations from markup (done 2026-11-10)

Implemented with directives; see the guide chapter "Animations from markup".

All compile to engine animations inside `construct`, recorded like fades.

1. **Property animations** at a step:

   ```
   [[animate: #box step=3 x=4 y=-1 angle=0.5 scale=1.4 opacity=0.3 color=RED run_time=1 rate=smooth]]
   ```

   Positions use the same anchor expressions (`at=#target.left`). Several `animate` directives at
   one step run in parallel; `lag` staggers them; `[[next]]` chains steps.
2. **Effects**: `[[effect: indicate #id step=2]]`, with `wiggle`, `circumscribe`, `flash`, `write`,
   `create`, `grow`, `shrink`, `uncreate`, `focus`. Unknown names are validated against a fixed list
   with their parameters (`color`, `run_time`, `scale`).
3. **Morphing**: `[[transform: #a -> #b step=4]]` (replacement transform; `#b` must be hidden until
   then) and `[[move_along: #dot path=#curve step=5]]`.
4. **Animated viewports**: `animate` applies to includes and imports too (`x`, `y`, `width`,
   `angle`), so a subslide can slide or grow while presenting; descendants follow through the
   existing `reposition` path.
5. **Entrance styles** as sugar: `step=2 enter=write|grow|draw` replaces the default fade for that
   element; `exit=` likewise.

### Phase 4 — media, DOM elements, playback (done 2026-11-10)

Decisions: reverse the whole clip on the left key; videos through the browser decoder; iframes live only
while their slide is focused; the plain dev page reloads on deck changes (full re-record).
Also: placeholders of undefined slides are drawn but no longer visited.

1. **Video**: `![caption](clip.mp4){play=once|loop step=1 width=6}` through the engine's
   `VideoMobject` (a video texture; plays like an APNG movie, including the auto-advance into a
   loop). Browsers require a user gesture before playback; the first click of a deck satisfies it.
2. **Iframes and rich links**: `[[iframe: https://… x=0 y=0 width=10 height=6 step=1]]` in the DOM
   overlay layer, positioned every frame from the slide's transform and the camera; faded with the
   slide's content opacity; hidden while culled. Limitations stated in the docs: not covered by the
   pen/spotlight overlays, not part of static screenshots.
3. **Reverse playback**: the left key restores the previous snapshot *after* replaying the current
   clip with α from 1 to 0 (camera moves, fades, property animations and effects are all
   interpolations). Ops that cannot be reversed (movies, morphs with structural changes) fall back
   to the instant restore. A `presenter.reverse=false` switch keeps the present behaviour.
4. **Faster live editing**: the preview keeps the camera and current stop across reloads already;
   add an incremental mode that re-records only the slides whose source changed when the tree shape
   is unchanged, and watch the Markdown file in the plain dev page too.

### Phase 5 — design mode

1. An **inspector** toggle (key `I`) that draws the bounding boxes and anchors of the focused
   slide's elements with their IDs and current logical coordinates, in the DOM overlay.
2. **Dragging** an element moves it in logical coordinates (through the inverse slide transform);
   `Shift` constrains to one axis, arrows nudge. Includes and imports can be dragged and resized.
3. **Write-back**: the preview server accepts an update (`POST /__zd/edit` with slide ID, element
   ID and new attributes); it rewrites the `{…}` attributes of that element's source line using the
   recorded line numbers, and the reload restores the position. Elements positioned relatively
   keep their constraints unless the user drops the constraint explicitly in the inspector.
4. Later: snapping to other anchors and to the grid, and a palette to insert shapes.

## 4. Open questions to settle before each phase

- **Groups** (phase 2): member coordinates relative to the group or to the slide? Proposal:
  relative to the group's anchor point, since that is what makes a diagram movable.
- **Animation syntax** (phase 3): directives (`[[animate: #id step=3 x=4]]`) as proposed, or
  keyframes written on the element itself (`{step=1 ... @3: x=4}`)? Directives keep elements
  readable and match `show`/`hide`; keyframes keep one object's story in one place.
- **Reverse playback** (phase 4): should returning from a child by the left key zoom *back into*
  it (true reverse) or jump to the previous stop with the usual forward camera move?
- **Styles** (phase 2): defined in `deck.json` only, or also in a `::: styles` block at the top
  of the Markdown file? Proposal: both, with the Markdown block taking precedence.
- **Links/iframes** (phases 1 and 4): acceptable that DOM elements are not drawn by the pen and
  spotlight overlays and are absent from exported screenshots?
- **Video** (phase 4): is MP4/WebM through the browser's decoder enough, or must frame-accurate
  playback (as with APNG) be preserved for scrubbing and reverse?
