---
title: Flat documents and PDFs
description: Slides without a tree, read page after page with cuts between them, and PDF files opened directly in the player.
---

Not every talk is a tree. A Markdown file may simply list slides, and a paper or a set of
slides already typeset as a PDF can be shown by the player as it is, page after page.

## A Markdown file without includes

```markdown
::: slide {#first width=20}
# A document without a tree
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

When several slides are included by none, they are the **pages** of a flat document, visited
in the order they are written. The camera cuts from each page to the next, with no zoom and no
fade, as a classical document is read, and the deck ends on the last page. A page is an
ordinary slide otherwise: it has steps, fragments and animations, and it may include children
of its own, which are entered and left with the usual zooms. The outline lists the pages at the
top level. A single slide that nothing includes is, as before, the root of a tree.

A page that would rather pan to its neighbour says `transition=zoom`; the pages then slide past
one another, since they are laid out side by side. `root` in `deck.json` is for trees: naming a
root in a document with several top-level slides is an error.

## A PDF

```bash
zoomdeck serve paper.pdf
zoomdeck build paper.pdf -o build/paper --one-file
```

The player, the `zoomdeck` command, the dev page (`/?deck=path/to/paper.pdf`) and the desktop
app open a PDF directly: each page becomes a slide, the pages form a flat document as above,
and the document's bookmarks, where it has them, name the pages in the outline (the others are
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

## In code

`pageSequence(slides)` arranges slides written in TypeScript as the pages of a flat document:
it returns the hidden root to give `defineDeck`. The root is never a stop and the camera is never
shown its canvas; a move whose nearest common ancestor is a hidden slide is a cut.
