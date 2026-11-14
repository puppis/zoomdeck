---
title: A quick tour
description: The main things Zoomdeck does, each shown live on this page with the markup that produces it. Click a deck to give it the keys, then use the arrows.
---

<a class="try" href="tour.html">The same tour as a deck: open the tour ↗</a>

Every deck on this page is the real player, embedded in the page. Click one to give it the
keyboard, press → and ← to move, or use its buttons. The markup beside a deck is all it takes.

## A PDF, as it is

<a class="try" href="tour.html#slide=feat-pdf">This chapter in the tour ↗</a>

Zoomdeck opens a PDF directly: a paper, a poster, slides typeset elsewhere. Each page is a
slide, the pages are visited first to last with a cut between them, the bookmarks name them in
the outline, and the text stays sharp at any zoom because pages are drawn at the density of the
screen. The pen, the spotlight, recording and printing work on a PDF as on any deck.

```zoomdeck src=live/slides.pdf without="camera record screen print"
```

```bash
zoomdeck serve paper.pdf          # present it
zoomdeck build paper.pdf -o out   # export a page that plays it
```

## Plain slides, in a row

<a class="try" href="tour.html#slide=feat-plain">This chapter in the tour ↗</a>

A deck of your own is a Markdown file of `::: slide` containers. Slides that include no other
slide are simply visited in order, with cuts and no animation, like the pages of a document.

```zoomdeck
::: slide {#one}
# One

Three plain slides, visited in order.
:::

::: slide {#two}
# Two

With prose, **emphasis**, `code` and $\sum_{n\ge1} n^{-2} = \pi^2/6$.
:::

::: slide {#three}
# Three

- Lists
- as usual
:::
```

## Slides as a tree

<a class="try" href="tour.html#slide=feat-tree">This chapter in the tour ↗</a>

An `[[include: #id …]]` places one slide inside another, as a viewport with a position and a
size. The camera zooms into each child in turn, goes from a child straight to its next sibling,
and zooms back out after the last one. Here a root has two children and the second child has a
child of its own: first child, next sibling, then down again.

```zoomdeck
::: slide {#talk width=20}
# A talk as a tree

[[include: #first x=-5 y=-1.5 width=8 preview=true]]

[[include: #second x=5 y=-1.5 width=8 preview=true]]
:::

::: slide {#first}
## First child

Visited first.
:::

::: slide {#second}
## Second child

[[include: #detail x=3 y=-1.5 width=7 preview=true]]
:::

::: slide {#detail}
### A detail of the second child

The last stop; then the camera zooms back out.
:::
```

## Spotlight and laser

<a class="try" href="tour.html#slide=feat-spotlight">This chapter in the tour ↗</a>

Hold **Shift** while moving the pointer to dim everything but a circle around it; the `L` key
(or the Pointer setting) turns the spotlight into a red laser dot, Shift + scroll resizes
either, and Shift + drag draws a highlight. Both work on any deck, including a PDF, and are
recorded with a talk. Try it on the deck below.

```zoomdeck code=hidden
::: slide {#spot width=20}
## Spotlight and laser

Hold **Shift** while moving the pointer over this slide: a spotlight follows it. **L** switches between the spotlight and a laser dot, and Shift with the mouse wheel (or a two-finger scroll) changes the size; the settings (⚙, or the comma key) offer the same choices.

[Where does this term come from?]{#q x=-6 y=-1 font_size=26}

[$\displaystyle \frac{\partial L}{\partial \dot q} - \frac{\partial L}{\partial q} = 0$]{#eq x=1 y=-1 font_size=30}
:::
```

## Pen, tablet and whiteboard

<a class="try" href="tour.html#slide=feat-pen">This chapter in the tour ↗</a>

**D** turns the pen on: a drag draws on the slide in the chosen color (keys 1 to 4), with
pressure from a pen or an Apple Pencil, and the strokes stay with the slide. A tablet or an iPad
pairs with the player as a drawing pad (Settings → Tablet), so you write on it and the audience
sees the slide: pressure, palm rejection, erasing with a finger. **W** opens the whiteboard, an
infinite canvas of its own that keeps what you wrote and comes back when you need it again.

```zoomdeck code=hidden
::: slide {#ink width=20}
## Pen and whiteboard

Press **D** and draw on this slide; the keys **1** to **4** (or the dots in the footer) pick the color, and ⌘Z or Ctrl+Z takes a stroke back. Press **W** for the whiteboard, an infinite canvas that scrolls with the arrows and keeps your notes.

[Annotate this: $x^2 + y^2 = r^2$]{#note x=-6 y=-1.5 font_size=30}
:::
```

## Camera, recording and video

<a class="try" href="tour.html#slide=feat-recording">This chapter in the tour ↗</a>

The camera (C) shows you next to or over the slides, as a picture in a corner or full screen.
A recording (R) keeps the whole talk: your voice, the camera and every move on the deck,
strokes included; it plays back on the deck itself, where it stays navigable, and exports as a
plain video file. A shared screen (S), another application say, can be filmed as part of the
talk. The deck below has these controls on; each asks the browser for permission the first time.

```zoomdeck without=none code=hidden
::: slide {#rec width=20}
## Camera and recording

The **Camera** button (C) shows the camera, **Record** (R) starts a talk (voice, camera and the deck), **Screen** (S) films a window or a screen. A recorded talk appears beside the Record button as a **▶ Talk** button, plays back on the deck and exports as a video; **Print** (P) writes the deck to a PDF.
:::
```

## Formulas, diagrams and animation

<a class="try" href="tour.html#slide=feat-math">This chapter in the tour ↗</a>

Formulas are LaTeX, inline or displayed, rendered by MathJax and zoomable like everything else.
Diagrams are directives: arrows between elements, boxes and blobs around them, icons, braces,
and any of them hand-drawn with `sketch=true`. Animations in the style of Manim come with the
same directives: elements are written, drawn, moved, morphed into one another and highlighted,
one step per click.

```zoomdeck
::: slide {#formula width=20}
## A formula and its parts

[$\displaystyle \int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}$]{#gauss x=-6 y=1.2 font_size=40}

[[box: #gauss, #gbox, buff=0.3, corner_radius=0.15, color=TEAL, step=1]]

[Gaussian integral]{#label x=-6 y=-1.8 font_size=24 color=TEAL enter=write step=1}

[[arrow: #label -> #gauss, #why, step=2]]
:::

::: slide {#diagram width=20}
## Arrows, blobs and hand-drawn shapes

[Source]{#src x=-8 y=1 font_size=28}

[Sink]{#dst x=3 y=1 font_size=28}

[[arrow: #src -> #dst, #flow, label="flow", step=1]]

[[rectangle: #hr x=-6.5 y=-2.5 width=3.4 height=1.8 color=BLUE_E fill_opacity=0.5 sketch=true step=2]]

[[circle: #hc right-of:#hr buff=1.5 radius=0.9 color=GREEN_E fill_opacity=0.6 fill_style=cross-hatch sketch=true step=2]]

[[arrow: #hr -> #hc, #ha, sketch=true, step=3]]

[[blob: #hr #hc, #cloud, color=ORANGE, step=4]]
:::

::: slide {#motion width=20}
## Motion

[A point moves]{#mover x=-8 y=1 font_size=28}

[[animate: #mover, dx=10, step=1]]

[[animate: #mover, dy=-3, scale=1.4, color=RED, step=2]]

[[effect: indicate #mover, step=3]]

[Drawn by hand]{#written x=-8 y=-3 font_size=28 enter=write step=4}
:::
```

## And then

- [Getting started](getting-started.html): install, open a deck, export it, set up your editor.
- [Your first deck, stage by stage](first-deck.html): a notebook that builds a deck one cell at
  a time, which you can edit and run in the browser.
- [The player](player.html): everything the controls do, from keys to recordings.
- [The tour deck](tour.html): this tour again, as a presentation, with the markup of every
  chapter next to its result.
