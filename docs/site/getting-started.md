---
title: Getting started
description: Install the project, open the development page, write a Markdown deck and export it.
---

## Install

Node.js 20.19 or newer, or 22.12 or newer, is required (the current LTS release is the simplest
choice); `npm install` checks this first. On an older or odd-numbered release such as 21.x the
install would otherwise stop inside the documentation build with `TypeError: crypto.hash is not a
function`: that message comes from Vite, which needs those Node versions, and not from a broken
download. Installing a supported Node (for example with `nvm install --lts`) and running
`npm install` again fixes it.

```bash
cd Zoomdeck
npm install
npm run dev
```

`npm install` also builds this documentation into `docs/html/`, including the standalone guide
(`docs/html/guide.html`); `npm run docs` rebuilds it later. `npm run dev` starts a Vite development
server (by default on `http://localhost:5173/`) and opens the **guide deck**. Other decks are selected through the query string:

| URL | Opens |
| --- | --- |
| `/?deck=examples/guide/deck.json` | a Markdown deck with its configuration (the guide) |
| `/?deck=path/to/slides.md` | a bare Markdown file with default settings |
| `/?deck=examples/minimal` | a code-authored deck module (`examples/minimal.ts`) |
| `/?deck=examples/tree-deck&scene=Demo` | a named export of a module |

The page reloads when a deck file under `examples/` changes and returns to the slide and step you
were looking at.

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

Without further keys a deck is black Latin Modern text on a white canvas, which is also what the
guide deck uses; `background` and `layout.color` change the colors.

Open it with `/?deck=path/to/deck.json` on the dev page, or with the command line below. Every
slide needs an `#id`; the slide nobody includes is the root; `width` on a slide sets its canvas,
while `x`, `y`, `width` on an include place the child inside the parent.

## Installing the `zoomdeck` command

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
  their `PATH` is the system default. The Sublime Text package in `editors/` therefore reads the
  `PATH` of your login shell before running the command; for other editors, either start the
  editor from a terminal, or
  write the full path of the command into the configuration (`which zoomdeck` prints it; for
  Emacs set `zoomdeck-command`, for Vim `g:zoomdeck_command`, and for VS Code and JetBrains edit
  the command in the task or tool). See [Editors](editors.html).
- With nvm, the link belongs to the Node version that was active when you ran `npm link`; after
  switching versions run it again.

## The command line

```bash
# Live preview of any deck (also outside this checkout): reloads on save, keeps your position.
zoomdeck serve path/to/deck.json          # or: node bin/zoomdeck.mjs serve path/to/deck.json

# Static bundle: index.html + assets/ + deck/. Host or copy the whole folder.
zoomdeck build path/to/deck.json -o build/my-deck

# One self-contained HTML file with every asset embedded.
zoomdeck build path/to/deck.json -o build/my-deck --one-file
```

Ready-made editor setups (VS Code, Sublime Text, Emacs, Vim, JetBrains) that bind the preview and
the export to shortcuts and save as you type are described in [Editors](editors.html).

`serve` accepts `--port N`, `--no-open`, `--scene Name` and repeatable `--watch PATH`; `build`
accepts `--show-outline` and `--scene Name`. The deck argument is a `deck.json`, a Markdown file or
a JS/TS module exporting a deck definition. The single-file export opens by double-click and needs
no server; [Exporting a deck](exporting.html) has the details, and [Configuration](configuration.html)
every key.

## What a deck folder contains

```text
my-deck/
├── slides.md        the slides, in the Markdown dialect
├── deck.json        title, colors, typography, presenter options, styles, macros
├── code-slides.ts   optional: Slide classes used by [[subslide: Name]]
├── parts/           optional: Markdown files spliced in with [[import: path.md]]
└── assets/          images, videos, pages referenced from slides.md
```

Paths in `slides.md` resolve relative to the Markdown file.

## Next steps

- [Concepts](concepts.html) explains slides, coordinates and how playback is recorded.
- [Slides and the tree](slides.html) starts the topic-by-topic tour of the dialect.
- The guide deck shows each topic live; pages link to their chapter with an "Open in the guide" badge.
