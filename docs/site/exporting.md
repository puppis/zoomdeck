---
title: Exporting a deck
description: Turn a deck into a static folder or into one self-contained HTML file that plays anywhere, without Node or a server, or print it to a PDF.
---

<a class="try" href="tour.html#slide=player">Open in the tour ↗</a>

A deck exports from the player itself, where `zoomdown serve` or the desktop app shows it, or
from the command line. Two forms exist, and the player also prints a deck to a
[PDF](#a-pdf-printout).

## From the player

**Export** in the footer, beside the settings gear (or X), opens the Export dialog. Its first
row, *What*, offers this deck as a web page and each recorded talk as a video (see
[Recording a talk](player.html#recording-a-talk) for those); for the web page the rows are:

- **Name**: the file's or the folder's name: by default the deck's folder, and for a PDF the
  PDF's own name (`paper.pdf` becomes `paper.html`, or a folder `paper/`).
- **Form**: one self-contained HTML file, or a folder of files, both described below.
- **Leave the presenter notes out**, for a deck handed to the audience (`--without-notes`).
- **Open the slide outline when the deck starts** (`--show-outline`).
- **Save to**: a folder of your choice, through the browser's own dialog (Chrome, Edge and the
  desktop app; the first choice where it exists): the file is saved where you say, the folder
  form becomes a folder of that name inside the folder you pick. Or the `build/` folder next to
  the deck, as `build/<name>.html` or `build/<name>/`. Or the browser's downloads, the folder
  form as a zip.

The server builds the deck exactly as `zoomdown build` does, in some seconds for a small deck
(the tour takes about ten), while the dialog counts the time; closing it abandons the export.
An earlier export of the same name is replaced, at the place chosen or in `build/`, but a folder
holding anything else is never touched: the dialog asks for another name instead. The `build/`
folder is left out of later exports and does not make the preview reload. A deck opened from an
export, or from a static host, has no server behind it: its Export dialog offers the recorded
talks only.

## From the command line

### One self-contained file

```bash
zoomdown build path/to/slides.md -o out --one-file
```

This writes `out/offline.html`: the player, the engine, the bundled fonts, your Markdown source
and every asset it references (images, animated images, videos, embedded pages) in a single HTML
file. Open it by double-clicking; it runs from disk, from an e-mail attachment or from any static
host, and keeps everything the live deck has: outline, keys, settings, pen, spotlight, reverse
playback and `#step=` / `#slide=` deep links. The tour you can open from the front page of this
documentation is exactly such a file.

Three things to know:

- Size. The player with the engine weighs about 15 MB before your assets, most of it the formula
  renderer, which the file carries as inert text and compiles only when a formula needs it, so
  the page starts long before it would if everything were parsed up front. Assets are embedded
  as data URIs and add their own size, so long videos belong in the folder export instead.
- Code-authored decks (`.ts` modules) embed their code too, but images they load themselves at
  run time are not collected; put such images next to the exported file or use the Markdown
  image syntax.
- Recorded talks are left out: their sound and video would not fit in a page. The folder export
  below ships them.

### A static folder

```bash
zoomdown build path/to/slides.md -o out
```

This writes `out/index.html`, `out/assets/` (the player, split in chunks loaded on demand) and
`out/deck/` (your Markdown and assets as files). Links in the deck folder are followed, to folders
too, so a deck may link a folder it shares with others (`animations -> ../../animations`) and the
export holds real files. The deck's own scripts and `dist`/`build` folders stay behind, except the
files an embedded web page loads by a relative path, including the paths its scripts try
(`'../dist/library.js'`): those travel with the page. Host or copy the whole folder. Because the player
is loaded as ES modules, browsers need the folder served over HTTP rather than opened from disk;
any static server works, for example:

```bash
cd out && python3 -m http.server 8000
```

### Options

| Option | Effect |
| --- | --- |
| `--show-outline` | open the slide outline when the deck starts |
| `--scene Name` | for code-authored decks, export a named export instead of the default one |
| `--without-notes` | leave the presenter's `::: notes` out of the export, for a deck handed to the audience ([Presenter notes](slides.html#presenter-notes) are otherwise part of the deck's files) |
| `-o <folder>` | output folder (required); it is created and existing files are kept |

The folder export also copies the deck's `recordings/` folder, unpacking each talk's bundle into
its media files and timeline, so a published deck shows its Talk button and plays its
[recorded talks](player.html#recording-a-talk); a static host serves them like any other file.

The deck argument is a Markdown file (its settings in its front matter), a PDF (its pages, with the
file copied into `deck/` beside `index.html`, or embedded in the single file) or a JS/TS module exporting a deck
definition. The export records nothing in advance: like the dev page, the exported player
runs the deck's program once when it loads, so changes to the Markdown require a new export while
settings such as key bindings travel with the viewer's browser.

## A PDF printout

The player's **Print** button (P, also ⌘P / Ctrl+P) writes the deck as a PDF, one page per
stage or one per slide, at 1920, 2560 or 3840 pixels of width, drawn by the deck's own renderer
and stored losslessly, with the slides as bookmarks. It works in the preview, in an exported
deck and in the single file alike, since the browser does the rendering; see
[Printing to PDF](player.html#printing-to-pdf) for what a page shows and leaves out.

## From a script

Programmatic use goes through the same entry points as the dev page:

```ts
import { runDeck, loadMarkupDeck } from 'zoomdown';

runDeck(await loadMarkupDeck({ url: '/decks/lecture/slides.md', title: 'Lecture 1', showOutline: true }));
```

Bundle this with Vite (or any bundler that handles ES modules and assets) to obtain a page of
your own layout around the player. For a deck that is one element of a larger page rather than
the page itself, with a handle the page drives it with, see [A deck inside a page](embedding.html).
