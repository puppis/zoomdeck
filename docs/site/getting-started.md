---
title: Getting started
description: Install the project, open the development page, write a Markdown deck and export it.
---

## Install

Node 20 or newer is required.

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

## The command line

```bash
# Live preview of any deck (also outside this checkout): reloads on save, keeps your position.
node bin/zoomdeck.mjs serve path/to/deck.json

# Static bundle: index.html + assets/ + deck/. Host or copy the whole folder.
node bin/zoomdeck.mjs build path/to/deck.json -o build/my-deck

# One self-contained HTML file with every asset embedded.
node bin/zoomdeck.mjs build path/to/deck.json -o build/my-deck --one-file
```

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
