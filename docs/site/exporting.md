---
title: Exporting a deck
description: Turn a deck into a static folder or into one self-contained HTML file that plays anywhere, without Node or a server.
---

<a class="try" href="guide.html#slide=player">Open in the guide ↗</a>

A deck that previews on the dev page can be exported with the command line. Two forms exist.

## One self-contained file

```bash
node bin/zoomdeck.mjs build path/to/deck.json -o out --one-file
```

This writes `out/offline.html`: the player, the engine, the bundled fonts, your Markdown source
and every asset it references (images, animated images, videos, embedded pages) in a single HTML
file. Open it by double-clicking; it runs from disk, from an e-mail attachment or from any static
host, and keeps everything the live deck has: outline, keys, settings, pen, spotlight, reverse
playback and `#step=` / `#slide=` deep links. The guide you can open from the front page of this
documentation is exactly such a file.

Two things to know:

- Size. The player with the engine weighs about 15 MB before your assets, most of it the formula
  renderer; assets are embedded as data URIs and add their own size, so long videos belong in the
  folder export instead.
- Code-authored decks (`.ts` modules) embed their code too, but images they load themselves at
  run time are not collected; put such images next to the exported file or use the Markdown
  image syntax.
- Recorded talks are left out: their sound and video would not fit in a page. The folder export
  below ships them.

## A static folder

```bash
node bin/zoomdeck.mjs build path/to/deck.json -o out
```

This writes `out/index.html`, `out/assets/` (the player, split in chunks loaded on demand) and
`out/deck/` (your Markdown and assets as files). Host or copy the whole folder. Because the player
is loaded as ES modules, browsers need the folder served over HTTP rather than opened from disk;
any static server works, for example:

```bash
cd out && python3 -m http.server 8000
```

## Options

| Option | Effect |
| --- | --- |
| `--show-outline` | open the slide outline when the deck starts |
| `--scene Name` | for code-authored decks, export a named export instead of the default one |
| `-o <folder>` | output folder (required); it is created and existing files are kept |

The folder export also copies the deck's `recordings/` folder, so a published deck shows its
Talk button and plays its [recorded talks](player.html#recording-a-talk); a static host serves
them like any other file.

The deck argument is a `deck.json`, a Markdown file (default settings) or a JS/TS module exporting
a deck definition. The export records nothing in advance: like the dev page, the exported player
runs the deck's program once when it loads, so changes to the Markdown require a new export while
settings such as key bindings travel with the viewer's browser.

## From a script

Programmatic use goes through the same entry points as the dev page:

```ts
import { runDeck, markupDeck } from 'zoomdeck';

runDeck(markupDeck({ url: '/decks/lecture/slides.md', title: 'Lecture 1', showOutline: true }));
```

Bundle this with Vite (or any bundler that handles ES modules and assets) to obtain a page of
your own layout around the player.
