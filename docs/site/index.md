---
title: Zoomdeck
description: Zooming presentations written in Markdown and played entirely in the browser.
---

## What Zoomdeck does

A Zoomdeck presentation is a **tree of slides**. Each slide has its own logical canvas and a
small animation program; child slides sit inside their parent's canvas as viewports. Presenting
means visiting the tree in pre-order: the camera zooms into each child, plays its steps and zooms
back out, so the audience always sees where a detail belongs.

You write slides in a Markdown dialect: prose, LaTeX formulas, images, video, shapes, diagram
icons and arrows (crisp or hand-drawn), boxes and blobs around groups of elements, code listings, live web pages, fragments that appear on clicks, and animations such as moves, morphs
and effects. When the dialect is not enough, a slide can be a small TypeScript class with the full
animation engine at hand. Everything runs live on a WebGL canvas in the browser: a deck loads,
records itself once, and then plays forwards and backwards instantly, with an outline, deep links,
a pen, a highlighter, a spotlight and configurable keys. The same deck previews while you edit it
and [exports](exporting.html) to a static folder or to a single HTML file that plays from disk.

## Requirements

| Needed | Notes |
| --- | --- |
| Node.js 20 or newer, with npm | to install, preview, export and build the documentation |
| A browser with WebGL 2 | Chrome, Edge, Firefox and Safari of the last few years; this is where decks run |
| `npm install` | fetches the only runtime dependencies: the `manim-web` rendering engine (Three.js and MathJax inside), `markdown-it` for the dialect, `gifuct-js` for GIFs, `roughjs` for hand-drawn shapes, and Vite for the preview and exports |

Nothing else is required: no Python, no LaTeX installation (formulas render through MathJax in
the browser), no video encoder, no font installation (the Latin Modern text face is bundled).
Exported decks are plain HTML and need no server to be viewed.

```bash
cd Zoomdeck
npm install
npm run dev        # opens the guide deck at http://localhost:5173/
```

[Getting started](getting-started.html) continues from here with a first deck and the command
line.

## The guide

The guide deck is Zoomdeck's own demonstration and the companion of this documentation: a
presentation in which every chapter shows a feature next to the listing that produces it.
**[Open the guide](guide.html)** — it is a single self-contained HTML file next to these pages,
exported from `examples/guide/` when you run `npm install` (and again by `npm run docs`); it runs
from disk or from any web server, and `npm run dev` opens the same deck live. Each chapter has its own link:

| Chapter | Opens |
| --- | --- |
| [Slides form a tree](guide.html#slide=tree) | containers, includes, nested zooming |
| [Prose and inline styling](guide.html#slide=prose) | emphasis, colors, breaks, lists, links |
| [Mathematics](guide.html#slide=math) | inline and display formulas, macros, colored LaTeX |
| [Images and animated images](guide.html#slide=images) | SVG, raster, APNG and GIF playback |
| [Shapes and connections](guide.html#slide=shapes) | rectangles, circles, polylines, arrows, lines |
| [More shapes, braces, boxes and opacity](guide.html#slide=more-shapes) | dots, ellipses, polygons, arcs, attachments |
| [Hand-drawn shapes](guide.html#slide=sketch) | `sketch=true`, fill styles, roughness, deck-wide sketching |
| [Icons for diagrams](guide.html#slide=icons) | `icon:` symbols with fill, outline and labels |
| [Boxes and blobs](guide.html#slide=enclosures) | enclosures around several elements, `tremble=` |
| [Positioning and relative layout](guide.html#slide=layout) | flow, coordinates, relative constraints |
| [Anchors, offsets and timing](guide.html#slide=anchors) | `anchor=`, `dx`/`dy`, `run_time`, `lag` |
| [Anchor expressions and styles](guide.html#slide=styles) | `at=`, classes, roles, style sheets |
| [Groups](guide.html#slide=groups) | elements laid out in local coordinates |
| [Fragments and click steps](guide.html#slide=fragments) | `step`, `hide`, `show`, `next`, `skip_next` |
| [Decorations visible only in focus](guide.html#slide=focus) | `focus_only` panels and captions |
| [Children, visit order and placeholders](guide.html#slide=children) | visit steps, `skip_return`, undefined slides |
| [Importing markup from files](guide.html#slide=imports) | `[[import: path.md]]` between slides and inside them |
| [Code-authored slides](guide.html#slide=code-slides) | a TypeScript `Slide` placed as a subslide |
| [Code listings](guide.html#slide=listings) | fenced code with syntax colors |
| [Animations from markup](guide.html#slide=animations) | `animate`, `effect`, `transform`, `move_along` |
| [Video, live pages and going back](guide.html#slide=media) | video, iframes, reverse playback |
| [The player and deck.json](guide.html#slide=player) | keys, pointer tools, configuration, command line |

The project lives at [github.com/puppis/zoomdeck](https://github.com/puppis/zoomdeck); this site
and the guide are published from it at [puppis.github.io/zoomdeck](https://puppis.github.io/zoomdeck/).
The guide's sources are in `examples/guide/`: `slides.md`, `deck.json`, `code-slides.ts` and a
few generated assets. Copying that folder is a good way to start a deck; [exporting](exporting.html) your own deck
the same way (`zoomdeck build <deck> -o <folder> --one-file`) gives a file like `guide.html`.

## Documentation

<div class="cards">
<a href="getting-started.html"><strong>Getting started</strong><span>Install, run the dev page, write a first deck, export it.</span></a>
<a href="concepts.html"><strong>Concepts</strong><span>Slides, logical coordinates, stops and how playback is recorded.</span></a>
<a href="slides.html"><strong>Slides and the tree</strong><span>Containers, includes, sizes, visit order, placeholders.</span></a>
<a href="positioning.html"><strong>Positioning</strong><span>Anchors, flow, relative constraints and <code>at=</code> expressions.</span></a>
<a href="fragments.html"><strong>Fragments</strong><span>Steps, show and hide, timing, automatic advancement.</span></a>
<a href="animations.html"><strong>Animations</strong><span>Move, rotate, scale, recolor, effects, morphs, paths and trembling.</span></a>
<a href="code-slides.html"><strong>Code-authored slides</strong><span>TypeScript slides with the full engine, mixed into Markdown decks.</span></a>
<a href="player.html"><strong>The player</strong><span>Keys, settings, pen and spotlight, reverse playback.</span></a>
<a href="exporting.html"><strong>Exporting a deck</strong><span>A static folder, or one HTML file that plays anywhere.</span></a>
<a href="configuration.html"><strong>Configuration</strong><span>Every key of deck.json and the command line.</span></a>
<a href="reference.html"><strong>Reference</strong><span>Every directive and attribute on one page.</span></a>
</div>
