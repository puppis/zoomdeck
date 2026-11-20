---
title: Slajdomat presentations
description: A presentation exported by Slajdomat, the Figma plugin for zooming slides, played by ZoomDown as it was conceived, with the pen, the tablet, the camera, printing and recording on top.
---

[Slajdomat](https://github.com/bojanczyk/slajdomat) makes zooming slides in Figma and exports a
presentation as a folder: its viewer page `index.html`, a `manifest.json` with the tree of slides
and the events of each, and one drawing `image.svg` per slide. ZoomDown opens such a folder and
plays it with its own player instead of Slajdomat's viewer, so the slides look and run as they
were made while everything the player offers works on them: the outline, the spotlight and the
laser, the pen and the whiteboard, the tablet as a drawing pad, the camera, printing the deck,
recording a talk and rendering it as a video.

## Opening one

```bash
zoomdown serve path/to/Presentation             # the folder of the export
zoomdown serve path/to/Presentation/index.html  # or its viewer page, or its manifest.json
```

The desktop app opens the viewer page from File ▸ Open Deck… (or a drop on the app, or the
command line), and the development page takes the manifest: `/?deck=path/to/manifest.json`. In
code, `slajdomatDeck({ url })` reads a presentation by the URL of its manifest, its viewer page or
its folder, and returns a deck for `runDeck` or `mountDeck`. The deck's title is the
presentation's name, and its proportions those of the first slide.

## How it plays

Every slide of the tree becomes a slide of the deck, and its children sit where the drawing keeps
their placeholders. The stops are Slajdomat's, one for one:

- entering a slide is a stop;
- each event ends in a stop, together with the events merged into it;
- a child event zooms into the child, whose entry is its first stop, and back to the parent;
  a child merged with the next child goes straight from one to the other, as in Slajdomat;
- a show or hide event fades the object of the drawing that carries the event's id, and an
  object that an event shows first is hidden until then.

Each object of a drawing is drawn by the browser from the SVG, exactly as Slajdomat's own viewer
draws it (gradients, clip paths, pictures and all), at the density of the screen wherever the
camera rests, so its text is as sharp as a deck's own at rest. Out of view an object keeps a small
picture. The embedded web pages of a slide (objects named `iframe: url` in Figma) are live pages,
as in a Markdown deck: the page appears over its object once the camera rests on the slide, and
the object as drawn shows during the zooms and from elsewhere. Pages that the export keeps in a
folder beside it, such as `../Animations`, are served too.

A child's content appears when the camera first enters it, as Slajdomat reveals it, and stays.
Fades take ZoomDown's time rather than Slajdomat's second, and the camera moves as it does in any
deck.

## What is left out

- Slajdomat's `animate` events (an object moved or resized between steps) are not played yet;
  the object stays as drawn, and the console says so.
- Slajdomat's own tools have ZoomDown's in their place: the comments, the search, the stopwatch
  and the sound recordings of the viewer's "chronicle" are not read. Talks recorded with ZoomDown
  go to a `recordings/` folder in the export's folder.
- The export cannot be built into a web page with `zoomdown build` or the player's Export yet;
  present it with `zoomdown serve` or the desktop app.
