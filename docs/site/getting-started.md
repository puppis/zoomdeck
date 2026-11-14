---
title: Getting started
description: Install the project, get the zoomdeck command, write a first deck, preview and export it, and set up your editor.
---

## Install

| Needed | Notes |
| --- | --- |
| Node.js 20.19 or newer, or 22.12 or newer, with npm | to install, preview, export and build the documentation; older and odd-numbered releases (such as 21.x) fail with `crypto.hash is not a function` |
| A browser with WebGL 2 | Chrome, Edge, Firefox and Safari of the last few years; this is where decks run |

Nothing else is required: no Python, no LaTeX installation (formulas render through MathJax in
the browser), no video encoder, no font installation (the Latin Modern faces are bundled).

```bash
git clone https://github.com/puppis/zoomdeck.git Zoomdeck
cd Zoomdeck
npm install
npm run dev
```

`npm install` fetches the runtime dependencies (the `manim-web` rendering engine with Three.js
and MathJax inside, `markdown-it` for the dialect, `gifuct-js` for GIFs, `roughjs` for hand-drawn
shapes, and Vite for the preview and exports), checks the Node version first, and builds this
documentation into `docs/html/`, including the standalone guide (`docs/html/guide.html`);
`npm run docs` rebuilds it later.

> **Note** On an older or odd-numbered Node release such as 21.x the install would otherwise stop
> inside the documentation build with `TypeError: crypto.hash is not a function`: that message
> comes from Vite, which needs the Node versions above, and not from a broken download.
> Installing a supported Node (for example with `nvm install --lts`) and running `npm install`
> again fixes it.

`npm run dev` starts a Vite development server (by default on `http://localhost:5173/`) and opens
the **guide deck**. Other decks are selected through the query string:

| URL | Opens |
| --- | --- |
| `/?deck=examples/guide/deck.json` | a Markdown deck with its configuration (the guide) |
| `/?deck=path/to/slides.md` | a bare Markdown file with default settings |
| `/?deck=path/to/paper.pdf` | a PDF, page after page ([Flat documents and PDFs](documents.html)) |
| `/?deck=examples/tree-deck&scene=Demo` | a named export of a module |

The page reloads when a deck file under `examples/` changes and returns to the slide and step you
were looking at.

## The `zoomdeck` command

The command line lives in `bin/zoomdeck.mjs`, which the checkout can run directly as
`node bin/zoomdeck.mjs …`. To call it as plain `zoomdeck` from any folder, from an editor or from
a script, link it into npm's global `bin` directory once, from inside the checkout:

```bash
cd Zoomdeck
npm install        # dependencies first, if you have not yet
npm link           # creates the global `zoomdeck` command, pointing at this checkout
zoomdeck --help    # prints the usage
```

`npm link` makes a symbolic link, so the command always runs the current state of the checkout
and `git pull` updates it; `npm unlink -g zoomdeck` removes it. `npm install -g .` copies the
package instead and must be repeated after updates.

**`zoomdeck: command not found`** afterwards means the global `bin` directory is not on the
`PATH` of the shell that runs the command:

- In a terminal, `npm prefix -g` prints npm's global prefix; its `bin` subfolder (for example
  `/usr/local/bin`, `/opt/homebrew/bin`, or `~/.nvm/versions/node/<version>/bin` with nvm) must
  appear in `echo $PATH`. Node installers normally arrange this for your shell; nvm does it in
  `~/.zshrc` or `~/.bashrc`.
- Editors started from the Dock, the Start menu or a launcher do not read your shell profile, so
  their `PATH` is the system default. The Emacs, Vim and Sublime Text setups in `editors/`
  therefore find the command themselves, through the checkout they belong to or the `PATH` of
  your login shell; for VS Code and JetBrains, either start the editor from a terminal, or write
  the full path of the command (`which zoomdeck` prints it) into the task or tool. See
  [Editors](editors.html).
- With nvm, the link belongs to the Node version that was active when you ran `npm link`; after
  switching versions run it again.

## A first deck

Create a folder with a Markdown file and a configuration next to it.

```markdown
::: slide {#start width=20}
# My first deck

Slides are `::: slide` containers; this one has a 20 × 11.25 canvas.

[[include: #details x=4 y=-2 width=9]]
:::

::: slide {#details}
## Details {y=3}

[Shown on the first click]{#a step=1}

[And on the second]{#b below:#a left-aligned:#a step=2}
:::
```

```json
{
  "markup": "slides.md",
  "title": "First deck"
}
```

Every slide needs an `#id`; the slide nobody includes is the root; `width` on a slide sets its
canvas, while `x`, `y`, `width` on an include place the child inside the parent. Without further
keys a deck is black Latin Modern text on a white canvas, which is also what the guide deck uses;
`background` and `layout.color` change the colors ([Configuration](configuration.html) lists
every key).

Open the deck with `/?deck=path/to/deck.json` on the dev page, or with the command line below.

## Preview and export

```bash
# Live preview of any deck (also outside this checkout): reloads on save, keeps your position.
zoomdeck serve path/to/deck.json          # or: node bin/zoomdeck.mjs serve path/to/deck.json

# Static bundle: index.html + assets/ + deck/. Host or copy the whole folder.
zoomdeck build path/to/deck.json -o build/my-deck

# One self-contained HTML file with every asset embedded.
zoomdeck build path/to/deck.json -o build/my-deck --one-file
```

Both commands accept the `deck.json` or the Markdown file: a Markdown file whose folder holds a
`deck.json` naming it is served or built through that configuration, so handing the file you are
editing to the command (as the editor setups do) gives the same result as naming `deck.json`.

The preview listens on `http://127.0.0.1:8000/`, or on the next free port when 8000 is busy
(another preview is probably still running; the printed address is the one to use). `--port N`
insists on a port. The server stops with Ctrl+C, and also by itself when the program that
started it (an editor's build panel or task) ends.

`serve` accepts `--port N`, `--host` (also listen on the network, for a [tablet](player.html#a-tablet-as-a-drawing-pad)), `--no-open`, `--editor NAME` (the editor that the player's E key and Alt + click open source lines with), `--scene Name` and repeatable `--watch PATH`; `build`
accepts `--show-outline` and `--scene Name`. `zoomdeck jump <file> <line>` moves the running
preview to the stop of a source line. The deck argument is a `deck.json`, a Markdown file, a PDF
or a JS/TS module exporting a deck definition. The single-file export opens by double-click and needs
no server; [Exporting a deck](exporting.html) has the details.

## Present it

The preview and the exports play a deck with the same player, so what you try here is what the
audience will see. `→` or Space advances, `←` goes back (playing the stop backwards), `O` opens
the outline and `F` the fullscreen view. The pointer tools work with a mouse, a pen or a paired
tablet: drag to draw, with pressure on a pencil or stylus; hold Shift for a spotlight or a laser
(`L` switches between them), Shift + drag to highlight; `W` opens a whiteboard without edges.
`C` turns the camera on in a corner of the slides, then full frame, then off, and `S` films the
screen while you work in another application. `R` records
the talk (your voice, the camera while it is on, and every move on the deck) and **▶ Talk** plays
it back on the deck itself or exports it as a video; `P` prints the deck to a PDF, a page
per stage. Every key and gesture can be changed in the settings (`,`). [The player](player.html)
describes each tool in full, and the guide's section 2, Presenting, shows them live.

## Set up your editor

Editing is most comfortable when the browser follows your typing: start the preview once, and
every save reloads the page at the stop you were looking at. The `editors/` folder of the
repository holds ready-made setups for **VS Code, Sublime Text, Emacs, Vim/Neovim and JetBrains
IDEs** that save after a second of idle typing, bind the preview, the jump to the current line
and the single-file export to shortcuts (Ctrl+Alt+B for the browser preview, Ctrl+Alt+J and Ctrl+Alt+P, or ⌘ variants),
let the browser open a stop's or an element's source line in the editor (E, Alt + click), and
highlight the dialect's directives and attributes inside Markdown. [Editors](editors.html)
explains each one and what to do when an editor cannot find the command.

## What a deck folder contains

```text
my-deck/
├── slides.md        the slides, in the Markdown dialect
├── deck.json        title, colors, typography, presenter options, styles, macros
├── code-slides.ts   optional: Slide classes used by [[subslide: Name]]; zoomdeck and manim-web
│                    resolve through the checkout wherever the deck lives
├── parts/           optional: Markdown files spliced in with [[import: path.md]]
├── assets/          images, videos, pages referenced from slides.md
└── recordings/      optional: recorded talks, written by the player (see The player)
```

Paths in `slides.md` resolve relative to the Markdown file.

## Next steps

- [Concepts](concepts.html) explains slides, coordinates and how playback is recorded.
- [The player](player.html) covers presenting in full: keys, pen and spotlight, whiteboard,
  tablet, camera, recording a talk and printing the deck.
- [Slides and the tree](slides.html) starts the topic-by-topic tour of the dialect; the sidebar
  follows the same order, from the content of a slide to the reference.
- The [guide deck](guide.html) shows each topic live; its front page lists the sections, and
  every documentation page opens its chapter with the "Open in the guide" badge.
