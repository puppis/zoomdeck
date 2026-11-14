---
title: PDFs, flat decks and forests
description: A PDF opened directly in the player, a Markdown file of plain slides read page after page, and how both are forests of slides.
---

The simplest deck is one you already have. This page goes from a PDF shown as it is, through a
Markdown file that lists plain slides, to the forest of slides that every deck is.

## A PDF

```bash
zoomdeck serve paper.pdf
zoomdeck build paper.pdf -o build/paper --one-file
```

The player, the `zoomdeck` command, the dev page (`/?deck=path/to/paper.pdf`) and the desktop
app open a PDF directly. Each page becomes a slide, the pages are visited first to last, and the
camera cuts from one to the next with no zoom and no fade, as a classical document is read. The
document's bookmarks, where it has them, name the pages in the outline (the others are
numbered). The presentation viewport takes the proportions of the first page, so a portrait
paper is shown upright with room at the sides and a landscape slide deck fills the screen. The
title is the document's own, or its file name.

Pages are drawn by [pdf.js](https://mozilla.github.io/pdf.js/) into pictures at the density
of the screen wherever the camera rests, drawn again when the window changes size, and reduced
to a small picture once they are out of view, so that the text of a page stays as sharp as the
deck's own while a long document never holds every page at full resolution. The pen, the
whiteboard, the spotlight, recording and printing work on a PDF as on any deck; a printout
renders the pages again at the chosen width.

The exported folder copies the file next to the page; the single-file export embeds it. A page
of your own can show a PDF with `mountDeck(element, 'paper.pdf')` or with `pdfDeck({ url })`
([A deck inside a page](embedding.html)).

## A Markdown file of plain slides

```markdown
::: slide {#first width=20}
# A deck of plain slides
:::

::: slide {#second width=20}
## The second page

[Pages can still have steps]{#a step=1}
:::

::: slide {#third width=20}
## The third page has a child
[[include: #detail x=5 y=-1.2 width=8]]
:::

::: slide {#detail}
### A detail
:::
```

A Markdown file may simply list slides, one `::: slide` container after another, including none
of them. They are then visited in the order they are written, with a cut from each to the next,
like the pages of the PDF above; the deck ends on the last one. Each slide is an ordinary slide
otherwise: it has steps, fragments and animations, and it may include children of its own,
which are entered and left with the usual zooms, as the third page above does. A slide that
would rather pan to its neighbour says `transition=zoom`; the slides then slide past one
another, since they are laid out side by side. The example lives in `examples/document/`.

## Forests and trees

Both cases are instances of one rule: a deck is a **forest** of slides. The slides that nothing
includes are its roots, visited first to last with cuts between them; an include places a child
inside a slide, and the camera zooms into children and back out. A PDF is a forest of single
pages, a file of plain slides a forest of single slides, and a talk with one slide that includes
all the others is a single tree, the most common deck of all. The outline lists the roots at the
top level and the children under them. `root` in `deck.json` names the single root of a tree;
naming one in a deck with several roots is an error. [Slides and the forest](slides.html) has
the includes, the visit order and the flags that shape a tree.

## In code

`pageSequence(slides)` makes slides written in TypeScript the roots of a forest, in order; give
its result to `defineDeck` as the deck.
