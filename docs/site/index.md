---
title: ZoomDown
description: Zooming presentations written in Markdown and played entirely in the browser.
---

ZoomDown is inspired by [Slajdomat](https://github.com/bojanczyk/slajdomat), Mikołaj Bojańczyk’s program for zooming slides, which I used for many years and which gave me the idea of a talk as a tree of slides that the camera zooms through. ZoomDown takes a different direction though: its slides are written mainly in a markup language, whereas Slajdomat draws them in a graphical editor (Figma).

## What ZoomDown does

A ZoomDown presentation is a **forest of slides**, most often a single tree. Each slide has its
own logical canvas and a small animation program; child slides sit inside their parent's canvas
as viewports. Presenting means visiting each tree in pre-order: the camera zooms into each child,
plays its steps and zooms back out (or cuts, when you prefer), so the audience always sees where
a detail belongs; from one root to the next it cuts, as between the pages of a document.

You write slides in a Markdown dialect: prose, LaTeX formulas, images, video, shapes, diagram
icons and arrows (crisp or hand-drawn), boxes and blobs around groups of elements, tables, charts,
code listings, live web pages, fragments that appear on clicks, and animations such as moves,
morphs and effects. When the dialect is not enough, a slide can be a small TypeScript class with
the full animation engine at hand. Everything runs live on a WebGL canvas in the browser: a deck
loads, records itself once, and then plays forwards and backwards instantly. The player brings
an outline, deep links, a pressure-sensitive pen, a highlighter, a whiteboard, a companion
tablet, a camera view, a spotlight or laser, links on any element, and configurable keys and
gestures; it records a talk (voice, camera and every move on the deck) that plays back on the
deck itself or exports as a video, and prints every stage to a PDF. The same deck previews
while you edit it and [exports](exporting.html) to a static folder or to a single HTML file
that plays from disk.

**See it:** the **[tour deck](tour.html)** is itself a ZoomDown presentation, a tour of every
feature with the markup that produces it next to the result. **Source:**
[github.com/puppis/zoomdown](https://github.com/puppis/zoomdown).

## Start here

1. **[A quick tour](features.html)**: the main things ZoomDown does, each shown live on the
   page next to the markup that produces it: a PDF opened as it is, plain slides, a tree of
   slides, the spotlight, the pen and the whiteboard, the camera and recordings, formulas,
   diagrams and animations.
2. **[Getting started](getting-started.html)**: the desktop app or the sources, a deck opened,
   presented and exported, and your editor set up. Then **[Your first deck, stage by
   stage](first-deck.html)** builds a deck cell by cell in a notebook you can edit in the browser.
3. **[Editors](editors.html)**: ready-made setups for VS Code, Sublime Text, Emacs, Vim and
   JetBrains IDEs, so that saving a file updates the browser, a key jumps from a source line to
   its stop and back from a stop or an element to its line, and a shortcut exports the deck.
4. **[Concepts](concepts.html)**: what a slide, a viewport and a stop are, and how a deck is
   recorded and replayed.
5. **[The player](player.html)**: presenting a deck: keys, the pen and the spotlight, the
   whiteboard and a companion tablet, the camera, recording a talk and printing the deck to a PDF.

The rest of the documentation follows the map below, from presenting a deck and the content of
a slide to the reference, and every topic page opens the matching chapter of the tour deck with
its "Open in the tour" badge.

## The tour deck

The tour is ZoomDown's own demonstration and the companion of these pages: a presentation in
which every chapter shows a feature next to the listing that produces it, organized in the same
sections as this documentation. **[Open the tour](tour.html)**: its front page lists the
sections and jumps to any of them on a click, and each chapter links back to its page here.

The tour is a single self-contained HTML file next to these pages, exported from
`examples/tour/` when you run `npm install` (and again by `npm run docs`); it runs from disk or
from any web server, and `npm run dev` opens the same deck live. Its sources (`slides.zd`, with
its settings in the front matter, `code-slides.ts` and a few assets) are a good starting point
for a deck of your own.

## Documentation map

<!-- nav-map -->

## The project

ZoomDown lives at [github.com/puppis/zoomdown](https://github.com/puppis/zoomdown); this site and
the tour are published from it at [puppis.github.io/zoomdown](https://puppis.github.io/zoomdown/).
It needs Node.js 20.19 or newer (or 22.12 or newer) to install and build, and a browser with
WebGL 2 to play decks; nothing else, no Python, LaTeX or video tools. Exported decks are plain
HTML files.
