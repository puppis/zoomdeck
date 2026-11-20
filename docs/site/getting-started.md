---
title: Getting started
description: Get ZoomDown as a desktop app or from the sources, open a deck, present it, export it to a folder or a single file, and set up your editor.
---

[A quick tour](features.html) showed what ZoomDown does; this page gets it onto your computer
and a deck of yours into it. There are two ways in: the desktop app, which needs nothing else,
and the sources, which bring the `zoomdown` command and the live development page.

## The desktop app

Download the build for your system from the
[releases](https://github.com/puppis/zoomdown/releases): a `.dmg` for macOS, an `.AppImage` or
`.deb` for Linux, an installer or a portable `.exe` for Windows. The app is the player and the
preview server in a window of its own: open a deck (a `.zd` file) or a PDF from the File menu,
by dropping it on the app, or by double-clicking it, since the installers make the app the one
that opens `.zd` files, and present as in the browser.
The builds are not signed by a registered developer, so each system warns once the first time;
[The desktop app](desktop.html) says what to click, and what the app's menus offer.

## From the sources

You need Node.js 20.19 or newer (or 22.12 or newer; odd-numbered releases such as 21.x fail
inside the build with `crypto.hash is not a function`) and a browser with WebGL 2. Nothing else:
no Python, no LaTeX, no video tools; formulas render through MathJax and the fonts are bundled.

```bash
git clone https://github.com/puppis/zoomdown.git ZoomDown
cd ZoomDown
npm install        # dependencies, and this documentation into docs/html/
npm run dev        # the development page, with the tour deck
npm link           # optional: the `zoomdown` command, from any folder
```

`npm run dev` serves `http://localhost:5173/`, which opens the tour deck; `?deck=` selects
another: `/?deck=path/to/slides.zd`, `/?deck=path/to/paper.pdf`, or
`/?deck=examples/tree-deck&scene=Demo` for a code-authored deck. The page reloads when a deck
file changes and comes back to the stop you were looking at.

`npm link` puts a `zoomdown` command on your path that runs the checkout as it is (so `git pull`
updates it; `npm unlink -g zoomdown` removes it). Without it, `node bin/zoomdown.mjs` from the
checkout does the same. If a shell or an editor answers `command not found`, npm's global `bin`
folder (`npm prefix -g` prints its parent) is not on that program's `PATH`; the editor setups
below find the command on their own, and [Editors](editors.html) covers the rest.

## Open a deck

```bash
zoomdown serve talk/slides.zd          # also paper.pdf
zoomdown serve talk/slides.zd --host   # reachable on the network, for a tablet
```

The preview opens the deck in your browser at `http://127.0.0.1:8000/` (or the next free port,
printed in the terminal), reloads it on every save and keeps your position. The argument is a
`.zd` file (its settings in its front matter; a deck's `.md` too), a PDF, a JS/TS module exporting a deck, or a
[Slajdomat presentation](slajdomat.html)'s folder. Ctrl+C stops the server; it also stops by itself when the
program that started it, an editor's build panel say, ends.

## Present it

The preview, the exports and the app all play a deck with the same player, so what you try here
is what the audience sees. `→` or Space advances and `←` goes back; `O` opens the outline, `F`
the fullscreen view and `,` the settings, where every key and gesture can be changed. Hold Shift
for the spotlight (`L` makes it a laser), press `D` to draw and `W` for the whiteboard, `C` for
the camera, `R` to record a talk, `P` to print the deck and `X` to export it. [The player](player.html) describes
each tool, and chapters 4 to 6 of the [tour](tour.html#slide=feat-spotlight) show them live.

## Export it

```bash
zoomdown build talk/slides.zd -o out/talk             # a folder: index.html, assets/, deck/
zoomdown build talk/slides.zd -o out/talk --one-file  # one HTML file, every asset inside
```

**Export** in the player's footer (X) does the same from the deck you are looking at, into a
folder you pick, the `build/` folder next to the deck or the downloads. The folder is hosted or
copied as a whole; the single file opens by double-click and needs no server. Both run the deck's program when they load, so a changed deck needs a new export. The
player's Print button writes a PDF with a page per stage or per slide.
[Exporting a deck](exporting.html) has the options.

## Write a first deck

A deck is a Markdown file with the extension `.zd`, and nothing more is needed to start; the
title and other settings go in its front matter, between `---` lines at the top, when you want
them. The extension marks the file as a deck: the system opens it with the desktop app, and the
[editor setups](editors.html) give it the dialect's highlighting and shortcuts while leaving other
Markdown alone. A deck written before `.zd`, as `slides.md`, still opens everywhere; renaming it
(and its imported parts) is all it takes to move it over.

```markdown
---
title: First deck
---

::: slide {#start width=20}
# My first deck

Slides are `::: slide` containers; this one has a 20 × 11.25 canvas.

[[include: #details x=4 y=-2 width=9 preview=true]]
:::

::: slide {#details}
## Details

[Shown on the first click]{#a step=1}

[And on the second]{#b step=2}
:::
```

Every slide has an `#id`; the slides nothing includes are visited first to last; `width` on a
slide sets its canvas, and `x`, `y`, `width` on an include place a child inside its parent. The
notebook [Your first deck, stage by stage](first-deck.html) builds such a deck one cell at a
time, with the result under each cell, and lets you edit it in the browser. A deck folder grows
from there:

```text
talk/
├── slides.zd        the slides, in the Markdown dialect; its front matter holds the title,
│                    colors, typography, presenter options, styles, macros
├── assets/          images, videos, pages referenced from slides.zd
├── parts/           optional: more markup, spliced in with [[import: path.zd]]
├── artworks/        optional: artworks of your own, name.svg or name.ts, for [[artwork: name]]
├── snippets/, directives/, fonts/, effects/, …  optional: markup used many times, directives, fonts, effects, camera transitions, chart types, languages, code themes, themes, slide classes
├── code-slides.ts   optional: Slide classes used by [[subslide: Name]]
└── recordings/      talks recorded by the player (one zip bundle each), when the deck is served
```

Paths in `slides.zd` resolve relative to it, then in the folders `paths` names
in the front matter, so figures shared between talks can stay in one place. The optional folders
extend the player by name, one file each; [Extending a deck](extending.html) lists them.

## Set up your editor

Editing is most comfortable when the browser follows your typing. The `editors/` folder of the
repository has ready-made setups for **VS Code, Sublime Text, Emacs, Vim/Neovim and JetBrains
IDEs**: they save after a second of idle typing, bind the preview, the jump from a source line
to its stop and the single-file export to shortcuts, let the player open a stop's source line
in the editor (E, or Alt + click on an element), and highlight the dialect inside Markdown.
[Editors](editors.html) explains each one.

## Next steps

- [Concepts](concepts.html): what a slide, a viewport and a stop are, and how a deck is
  recorded once and replayed.
- After the two notebooks, [PDFs, flat decks and forests](documents.html) and
  [Slides and the forest](slides.html) start the topic-by-topic part of the documentation, in
  the sidebar's order, from the content of a slide to the reference manuals.
- The [tour](tour.html) shows every topic live, and each documentation page opens its chapter
  with the "Open in the tour" badge.
- The reference manuals, [the markup language in full](manual-markup.html) and
  [the API in full](api.html), list every construct, attribute and export; the search box at
  the top of every page finds any name in the documentation.
