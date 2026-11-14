---
title: Slides and the forest
description: Slide containers, canvas sizes, includes, visit order, start and preview flags, placeholders.
---

<a class="try" href="tour.html#slide=tree">Open in the tour ↗</a>

## Slide containers

```markdown
::: slide {#overview title="Lecture overview" width=20}
# Introduction

[[include: #chapter x=4 y=-1 width=8 angle=0.1 step=2]]
:::

::: slide {#chapter}
## A chapter
:::
```

- Every slide is a `::: slide {#id} … :::` container. IDs start with a letter or underscore and
  continue with letters, digits, `_`, `.` or `-`; they are unique in the document.
- Definition order and heading levels never determine nesting; only includes do.
- A deck is a **forest**: the slides that nothing includes are its roots, visited first to last
  with cuts between them, and every other slide belongs to the tree of one root. Most decks are
  a single tree; a deck whose slides include none of the others is a
  [flat document](documents.html), as the pages of a PDF are. Unknown references, cycles and
  including the same slide twice are errors. To show the same content twice, define it twice
  under different IDs.
- `title="…"` names the slide in the outline; otherwise its first heading, then its ID, is used.

## Canvas size

`width` and `height` on a slide set its canvas. The default is 16 × 9 (or
`layout.defaultSlideSize`); one dimension infers the other from the default proportions, two
choose a different aspect ratio.

```markdown
::: slide {#wide width=32}        → 32 × 18
::: slide {#square width=10 height=10}
```

## Includes

```markdown
[[include: #diagram x=4.5 y=-2 width=9 angle=0.08]]
[[subslide: #notes below:#heading left-aligned:#heading width=6 step=1]]
```

An include places the referenced slide's viewport in the current canvas. `x`, `y` are the center
of the viewport (or the point named by `anchor=`), `width`/`height` its size (one dimension keeps
the child's aspect ratio, two letterbox it), `angle` rotates it in radians. Without `width` and
`height` the viewport is at most six units wide. Includes accept the relative constraints, `at=`,
`dx`/`dy` and `.class` styles of [Positioning](positioning.html). `[[subslide: #id …]]` is the
same thing; `subslide` also places [code-authored children](#code-authored-children).

An include referring to an **undefined** slide draws a red placeholder rather than failing, and
the placeholder is never a stop, so a deck keeps running while a slide is still unwritten.

## Visit order

Children without `step` are visited in source order after all numbered steps of the parent.
`step=N` interleaves a visit with the parent's fragments: the parent's changes of step N play
first, then the child is visited. When a child ends, the camera goes straight to the next sibling
while one is left to visit, and zooms back to the parent only after the last one; the parent then
resumes with its previous state, and children keep their final appearance as previews. A fragment
of the parent that falls between two children plays while the camera is still on the first of
them; `return_to_parent` on that child brings the camera back before it ([Flags](#flags)).

```markdown
[Shown first]{#a step=1}
[[include: #left x=-4 y=-2 width=7 step=1]]     ← visited after the reveal of step 1
[Shown next]{#b step=2}
[[include: #right x=4 y=-2 width=7]]            ← visited after step 2
```

## Flags

| Attribute | On | Effect |
| --- | --- | --- |
| `start_here=true` | slide, include, subslide | open playback at this slide (at most one in a deck) |
| `only_this=true` | slide, include | prepare only this subtree while editing; everything else becomes a placeholder |
| `return_to_parent` | slide, include, subslide | zoom back to the parent after this child even when a sibling follows; `return_to_parent=false` is `skip_return` |
| `skip_return` | slide, include, subslide | leave this child straight for the next stop even when it is the last one, without zooming back to the parent; `skip_return=false` is `return_to_parent` |
| `transition=cut` | slide, include, subslide | enter and leave this slide without a camera animation; `transition=zoom` restores the zoom under a `cut` deck |
| `preview=true` | slide, include, subslide | show the child's content before its first visit instead of fading it in on entry, as the tiles of the tour's front page do |

A flag written bare means `=true`: `[[include: #proof skip_return]]`. By default a child returns
to its parent only when it is the last one visited, so the camera moves from sibling to sibling
and comes back once at the end; `return_to_parent` and `skip_return` force either choice for one
child. They are the two sides of one choice and are never written together.

## Cuts instead of zooms

By default the camera flies between slides. `transition=cut` on a slide (or on the include that
places it) replaces the view at once whenever the camera moves into or out of that slide, as
between the pages of a PDF; fades of focus-only decorations still play. To present a whole deck
that way, set `"presenter": { "transition": "cut" }` in deck.json; individual slides can then
ask for `transition=zoom` again. When two slides disagree, the cut wins.

## Code-authored children

```markdown
[[subslide: Orbit x=0 y=-3 width=4 step=5]]
```

`subslide` with a class name instead of a `#id` instantiates a `Slide` subclass exported by the
module named by `classes` in `deck.json`; see [Code-authored slides](code-slides.html). It takes
the same placement attributes as an include.

## Splitting a deck into files

<a class="try" href="tour.html#slide=imports">Open in the tour ↗</a>

```markdown
::: slide {#intro}
## Introduction
[[import: parts/footer.md]]
:::

[[import: parts/appendix.md]]
```

`[[import: path.md]]` splices another Markdown file into the document before it is parsed.
Between slides the file contributes slides and `::: styles` blocks; inside a slide it contributes
elements and directives, as if its lines were written there. Paths are relative to the importing
file (so a file in `parts/` imports its neighbours by bare name), imported files may import
others, and import lines inside fenced code are left alone. Error messages name the imported
file and the line within it. Asset paths (images, videos, pages) in an imported file keep
resolving relative to the main document, like everything else.

Exports embed the imported files, so a built deck needs no server to resolve them; the
preview server reloads when any of them changes.
