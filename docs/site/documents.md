---
title: PDFs, flat decks and forests
description: A PDF opened as it is, a Markdown file of plain slides read page after page, and the forest of slides that every deck is, each shown live.
---

The simplest deck is one you already have. This page goes from a PDF shown as it is, through a
Markdown file that lists plain slides, to the forest of slides that every deck is. Every deck
below is the real player: click one to give it the keys, then press → and ←.

## A PDF

Zoomdeck opens a PDF directly: a paper, a poster, slides typeset elsewhere. Each page becomes a
slide, the pages are visited first to last, and the player cuts from one to the next with no
zoom and no fade, as a document is read. The bookmarks of the document, where it has them, name
the pages in the outline; the others are numbered. Here, three pages typeset with LaTeX:

```zoomdeck src=live/slides.pdf without="camera record screen"
```

```bash
zoomdeck serve paper.pdf                       # present it
zoomdeck build paper.pdf -o out/paper --one-file   # a page that plays it, file embedded
```

The command, the development page (`/?deck=path/to/paper.pdf`), the desktop app and
`mountDeck` in a page of your own all take a PDF where they take a deck. The presentation
viewport takes the proportions of the first page, so a portrait paper is shown upright with room
at the sides and landscape slides fill the screen; the title is the document's own, or its file
name. Pages are drawn by [pdf.js](https://mozilla.github.io/pdf.js/) at the density of the
screen wherever the camera rests, drawn again when the window changes size, and reduced to a
small picture once out of view, so the text of a page stays as sharp as the deck's own while a
long document never holds every page at full resolution. The pen, the whiteboard, the spotlight,
recording and printing work on a PDF as on any deck. The exported folder copies the file next
to the page; the single-file export embeds it.

## A Markdown file of plain slides

A Markdown file may simply list slides, one `::: slide` container after another, including none
of them. They are then visited in the order they are written, with a cut from each to the next,
like the pages of the PDF above, and the deck ends on the last one. Each slide is an ordinary
slide otherwise: it has steps, fragments and animations, as the second one here, and it may
include children of its own, which are entered and left with the usual zooms, as the third one
does.

```zoomdeck
::: slide {#first width=20}
# A deck of plain slides

Three slides that include none of the others: the player cuts from each to the next.
:::

::: slide {#second width=20}
## The second page

[Slides keep their steps]{#a step=1}

[And reveal them one at a time]{#b below:#a left-aligned:#a step=2}
:::

::: slide {#third width=20}
## The third page has a child

[[rectangle: #frame x=5 y=-1.2 width=8 height=4.5 color=GRAY stroke_width=1]]

[[include: #detail x=5 y=-1.2 width=8 preview=true]]

The camera zooms into the child and back out to this page; then the deck ends. {x=-9.3 y=-3.6 width=10 font_size=20 color=GRAY}
:::

::: slide {#detail}
### A detail

Children of a page keep their zooms; only the pages themselves cut. {font_size=22}
:::
```

A slide that would rather pan to its neighbour says `transition=zoom`; the slides then glide
past one another, since they are laid out side by side. The same file is at
`examples/document/pages.md` in the repository.

## Forests and trees

Both cases are instances of one rule: a deck is a **forest** of slides. The slides that nothing
includes are its roots, visited first to last with cuts between them; an include places a child
inside a slide, and the camera zooms into children and back out. A PDF is a forest of single
pages, a file of plain slides a forest of single slides, and a talk with one slide that includes
all the others is a single tree, the most common deck of all. Here, a forest of two trees: a
tree of two children, then a second root.

```zoomdeck
::: slide {#lecture width=20}
# A tree with two children

[[rectangle: #frame-1 x=-5 y=-1.5 width=8 height=4.5 color=GRAY stroke_width=1]]

[[include: #part-1 x=-5 y=-1.5 width=8 preview=true]]

[[rectangle: #frame-2 x=5 y=-1.5 width=8 height=4.5 color=GRAY stroke_width=1]]

[[include: #part-2 x=5 y=-1.5 width=8 preview=true]]
:::

::: slide {#part-1}
## First child

Zoomed into, then straight on to the sibling. {font_size=24}
:::

::: slide {#part-2}
## Second child

The last child: the camera zooms back out after it. {font_size=24}
:::

::: slide {#appendix width=20}
# A second root

Reached with a cut from the first tree, as the next page of a document. {font_size=24}
:::
```

The outline lists the roots at the top level and the children under them. `root` in `deck.json`
names the single root of a tree; naming one in a deck with several roots is an error.
[Slides and the forest](slides.html) has the includes, the visit order and the flags that shape
a tree.
