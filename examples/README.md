# Example decks

Open a deck on the development page (`npm run dev`, then `http://localhost:5173/?deck=...`) or
preview it with `node bin/zoomdeck.mjs serve <deck>`.

| Deck | Open with | What it shows |
| --- | --- | --- |
| **Guide** | `http://localhost:5173/` (the default) or `?deck=examples/guide/deck.json` | A tour of every feature of the Markdown dialect and the player, one chapter per topic, each showing the listing that produces it. It is the live companion of the documentation (`docs/html/index.html`), which links to its chapters with `#slide=` deep links. |
| Minimal | `?deck=examples/minimal` | The smallest code-authored deck: a root with two child slides written as `Slide` subclasses in TypeScript. |
| Tree deck | `?deck=examples/tree-deck&scene=Demo` (also `MovingFrames`, `AutomaticTree`) | Code-authored slides with nesting, resumable subcalls, replacement transforms, trackers, an animated viewport and automatic child traversal. |

## The guide as a template

`examples/guide/` has the shape of any Markdown deck:

```text
guide/
├── slides.md        the slides
├── deck.json        title, typography, presenter options, styles, macros, slide classes
├── code-slides.ts   Slide classes used by [[subslide: Name]]
├── parts/           Markdown files spliced in with [[import: path.md]]
└── assets/          images, an animated PNG, a video, an embeddable page
```

Copy the folder, delete the chapters you do not need and start writing. `deck.json` can be as
short as:

```json
{
  "markup": "slides.md",
  "title": "My deck"
}
```

Code-authored decks export a `defineDeck({...})` value (default export or named exports selected
with `scene=`). Code-authored subslides of markup decks (`[[subslide: Name ...]]`) come from the module
named in `classes` and must be `Slide` subclasses constructible without arguments.
