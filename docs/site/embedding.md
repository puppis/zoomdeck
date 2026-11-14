---
title: A deck inside a page
description: Mounting the player in an element of a larger page, the handle that drives it from the page's own script, and the features it can leave out.
---

The player can be one element of a page of your own instead of the whole page: a lecture's notes
with the deck in a box between two paragraphs, a course site with one deck per chapter, a
documentation page that shows a figure live. `mountDeck` puts a deck inside an element, and
returns a handle the page's own script drives it with. Nothing else about the page changes: its
title, fonts, colors and scrolling stay yours, and the keys reach the deck only after a click on
it. Everything the player does in a page of its own works in the box too, the pen, the whiteboard,
the spotlight, fullscreen, the settings and the slides' own links included, at the same sharpness:
the canvas follows the element's size and the screen's pixel density, and the text is redrawn
whenever the box is resized.

## Mounting

```ts
import { mountDeck } from 'zoomdeck';

const deck = await mountDeck(document.querySelector('#lecture'), '/decks/lecture/deck.json', {
  features: { camera: false, screen: false, record: false },
});
```

The first argument is the element: give it a size with your own CSS (a height, or an
`aspect-ratio`), since the player fills it. The second is the deck: the URL of a `deck.json`,
of a Markdown file or of a PDF, or a deck definition made with `defineDeck`, `markupDeck` or
`pdfDeck`. A
`deck.json` loads its slide classes through the browser's own `import`, so a bundler is not
required for them. The options:

| Option | Meaning |
| --- | --- |
| `features` | The features to leave out, as `{ camera: false }`. Each one hides its controls and makes its keys inert. See below. |
| `start` | The stop shown first: an index from 0, or the name of a slide. Otherwise the deck's own start. |
| `useLocation` | Follow `#step=` in the page's URL and write it on every stop, as the standalone player does. Off by default, so the page keeps its URL. |
| `log` | Progress messages in the console while the deck prepares. Off by default. |

The player keeps the deck's own colors inside its box and uses a light or a dark color scheme
accordingly, whatever the page around it does. Several decks can share a page; each has its own
handle, and each reads the keys only while it has the focus.

## Features

A page that embeds a deck often has no use for a camera or a recorder, and may want nothing but
the slides. These can be left out, one by one, and the footer shows only what is left:

| Feature | What goes with it |
| --- | --- |
| `outline` | The slide outline and its ☰ button. |
| `pen` | The color swatches, drawing with the pen or the highlighter, undo, redo and clear. |
| `whiteboard` | The whiteboard and its scrolling keys. |
| `camera` | The camera in a corner or in full frame. |
| `screen` | Filming the screen. |
| `record` | Recording a talk and playing recorded talks back. |
| `print` | The PDF printout. |
| `fullscreen` | The Fullscreen button and its keys. |
| `settings` | The ⚙ button and the settings dialog. |

Navigation, the spotlight and laser, the slides' links and live pages are always there. The
settings themselves (pen, keys, rendering) are shared with the standalone player in the same
browser, so a key bound once holds everywhere; a page that hides the settings dialog keeps the
defaults, or whatever the viewer set elsewhere.

## Without a bundler: the `<zoom-deck>` element

```html
<script type="module" src="https://puppis.github.io/zoomdeck/zoomdeck/zoomdeck.js"></script>

<zoom-deck src="talk/deck.json" without="camera record"></zoom-deck>

<zoom-deck without="camera record screen" title="Inline">
<script type="text/markdown">
::: slide {#hello}
# Written inside the page
:::
</script>
</zoom-deck>
```

A page without a build step loads the self-contained player, one module with the engine, the
fonts and the stylesheet inside (`npm run build:standalone` writes it to `dist/standalone/`, and
the documentation site serves a copy at the address above; MathJax and pdf.js follow as
separate files only when a deck needs them). The `<zoom-deck>` element then shows a deck:
`src` names a `deck.json`, a Markdown file or a PDF, or the Markdown is written inside the
element, in a `<script type="text/markdown">` child, which the browser keeps verbatim. The
element is as wide as its container and 16:9 unless the page sizes it. Its attributes are the
options of `mountDeck`: `without="camera record"` leaves features out, `start` names the first
stop, `title` the deck, `outline` opens the outline, `use-location` lets the deck write
`#step=` in the page's URL. The handle is `element.handle` once the element's `ready` promise
resolves (a `deck` event fires then too), and setting `element.source` to new Markdown shows
another deck in place. The module also exports everything the package does, so a page can
`import { mountDeck } from '…/zoomdeck.js'` as well.

## In a notebook

```python
import zoomdeck_nb
```

```markdown
%%deck
::: slide {#hello}
# A deck in a cell
:::
```

`docs/site/zoomdeck_nb.py` is a small helper for Jupyter. Once imported, a cell that starts
with `%%deck` holds the Markdown of a deck and nothing else, and its output shows the deck:
the player is loaded from the documentation site (or from the URL in the `ZOOMDECK_BUNDLE`
environment variable) and the deck wears the notebook's colours. Options follow on the magic
line: `--without camera,record`, `--title "A name"`, `--start 2`, `--outline`, `--height 500px`.
`%deck paper.pdf` shows a PDF, a Markdown file or a deck.json by its address, and from code
`deck(markdown)` and `deck(src="…")` return the same display objects. It works in JupyterLab,
the classic notebook and JupyterLite alike. The documentation's own notebooks, such as
[Your first deck, stage by stage](first-deck.html), are built this way: the site renders the
cells with their decks, and the "Open in JupyterLite" badge opens the same notebook in the
browser, where the cells can be edited and run again.

## Driving the deck

The handle exposes the deck's position and the player's actions, for buttons, a table of
contents or a script of the page's own:

```ts
deck.length;                  // how many stops
deck.index;                   // the stop shown, from 0
deck.slides;                  // [{ name, key, depth, first }], in outline order

await deck.next();            // the next stop, played
await deck.previous();
await deck.home();            // the first stop
await deck.replay();          // this stop again
await deck.goTo(12);          // a stop by index, shown settled
await deck.goTo('Results');   // the first stop of a slide, by name or Markdown id
await deck.goTo(12, true);    // played from its start rather than shown settled
deck.speed = 1.5;

deck.toggleDrawing();         // or toggleDrawing(true) / (false)
deck.toggleWhiteboard();
deck.toggleOutline();
await deck.fullscreen();      // the box alone goes fullscreen

const off = deck.on('stop', ({ index, slide, step, total }) => { /* the deck moved */ });
deck.on('state', ({ state }) => { /* paused, playing, looping, finished */ });
off();                        // stop listening

deck.destroy();               // take the deck out of the page and free its resources
```

A `goTo` with a slide name that does not exist rejects, so a typo in a table of contents shows up
in the console. The underlying objects remain reachable as `deck.player`, `deck.ui`, `deck.stage`
and `deck.navigation` for anything the handle does not cover. A page that is itself written as a
single-page application calls `destroy()` when it removes the element, which releases the canvas
and the listeners.

## An example

The checkout has a page that does all of this: `examples/embed/index.html`, served by the
development server at `/examples/embed/index.html`. It mounts the tour in a resizable box
between paragraphs, with buttons and a slide menu of its own below it, and a second, smaller deck
with most features left out.
