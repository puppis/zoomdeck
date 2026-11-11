# Zoomdeck

Repository: <https://github.com/puppis/zoomdeck> · Documentation and guide: <https://puppis.github.io/zoomdeck/>

Author a presentation as a tree of **Slides**, each with its own logical canvas and a small
animation program, and present it as a zooming slideshow that runs **entirely in the browser**.
There is no server-side rendering, no LaTeX installation and no video encoding: slides execute
live on a WebGL canvas, and the presentation navigates the slide tree in pre-order, zooming into
each child and back out to its parent.

## Documentation

The topic-by-topic documentation is published at <https://puppis.github.io/zoomdeck/>, with the
guide deck playable at <https://puppis.github.io/zoomdeck/guide.html>. Its sources live in
`docs/site/*.md` and are built into static pages in `docs/html/`, together with
`docs/html/guide.html`, the guide deck as one self-contained file.
`npm install` builds them (through the `prepare` script) and `npm run docs` rebuilds them; open
`docs/html/index.html` in a browser (or `/docs/html/` on the dev server). The pages are
committed, the 15 MB guide file is generated. It
covers getting started, concepts, every part of the dialect, code-authored slides, the player,
the configuration and a one-page reference. `docs/markup.md` is the compact dialect reference and
`docs/roadmap.md` the plan of remaining work.

## Features

- **Slides with fixed logical canvases** (16 × 9 by default), nested with uniform scale, rotation
  and letterboxing; `addChild` places a child viewport in the parent's coordinates; descendant
  transforms compose automatically and child viewports stay ordinary animatable objects.
- **Programs as resumable subcalls**: `build(ctx)` runs once, `construct(ctx)` runs on entry and may
  `yield ctx.visit(child)` from an async generator; remaining children are visited automatically;
  `skipReturn`, `ctx.skipNext()`, `ctx.autoAdvance()`, `ctx.stop({ loop, autoNext, notes })`.
- **First-entry fades, coordinate grids and design borders** (`PresenterConfig`), `padding`,
  `transitionTime`, `pauseOnEntry`/`pauseOnReturn`.
- **Selective rendering** (`onlyThis`), **placeholders**, **`startHere`**.
- **A Markdown dialect**: `::: slide {#id}` containers, includes and subslides with placement and
  visit steps, `[[import: path.md]]` to split a deck into files, styled prose with inline math, display math, images (SVG, raster, animated APNG/GIF
  and videos with `play=once|loop`), live pages (`iframe:`), syntax-highlighted code listings, vector shapes, diagram icons (`icon:`), arrows and lines with
  labels (crisp, or hand-drawn with `sketch=true` through Rough.js), boxes and blobs around several elements, pipe tables and bar/line/pie charts, a `tremble=` vibration, anchor-based and relative positioning, named styles, groups, `focus_only`, fragments
  (`step`, `hide`, `show:`/`hide:`), animation directives (`animate:`, `effect:`, `transform:`,
  `move_along:`, entrance and exit styles), `next:` and `skip_next:`. The dialect is documented in
  [docs/markup.md](docs/markup.md) and demonstrated live by the guide deck.
- **The browser player**: slide outline, breadcrumb, previous/next stops (backwards steps play
  the stop in reverse), replay, Home, speed, a settings dialog with editable key bindings, undo
  and redo of strokes,
  fullscreen, deep links (`#step=N`), spotlight (Shift), highlighter (Shift + drag) and pen
  (Control + drag) with color and tip selectors, loops and automatic advancement.
- **An editing preview** (`zoomdeck serve`) that reloads on save and restores the current
  slide and step, and **static exports** (`zoomdeck build`, `--one-file`).

## How playback works

There are no video clips. When a deck loads, the complete slide program runs once instantly
("recording"), producing one **clip** per authored stop. Each clip keeps the animations that
produced it and the player stores a compact delta snapshot of every settled state. Navigation
restores a snapshot and replays the clip's animations in real time, so backward steps, outline
jumps and replays are immediate and never rerun author code. Author programs therefore run
exactly once per page load.

## Install and run

Node.js 20.19 or newer, or 22.12 or newer, is required (the current LTS release is the simplest
choice). `npm install` checks this first and stops with a clear message otherwise; on an older
or odd-numbered release such as 21.x the install would otherwise fail inside the documentation
build with `TypeError: crypto.hash is not a function`, which comes from Vite, not from a broken
download. Installing a supported Node (for example with `nvm install --lts`) and running
`npm install` again fixes it.

```bash
cd Zoomdeck
npm install
npm run dev
```

The development page opens the **guide deck** (`examples/guide/`), a tour of every feature of the
dialect and the player in which each slide shows the listing that produces it. Other decks are
chosen through the query string:

- `http://localhost:5173/?deck=examples/guide/deck.json` — a Markdown deck with its configuration
- `http://localhost:5173/?deck=path/to/slides.md` — a bare Markdown file with default settings
- `http://localhost:5173/?deck=examples/minimal` — a code-authored deck module (`.ts`)
- `http://localhost:5173/?deck=examples/tree-deck&scene=Demo` — a named export of a module

### Command line

```bash
# Live preview while editing: reloads on save and keeps your current slide/step.
node bin/zoomdeck.mjs serve examples/guide/deck.json

# Static bundle: index.html + assets/ + deck/ (copy or host the whole folder).
node bin/zoomdeck.mjs build examples/guide/deck.json -o build/guide

# One portable file with every asset embedded as a data URI.
node bin/zoomdeck.mjs build examples/guide/deck.json -o build/guide --one-file
```

`serve` accepts `--port N`, `--no-open`, `--scene Name` (for module decks) and repeatable
`--watch PATH`. `build` accepts `--show-outline` and `--scene Name`. The deck argument is a
`deck.json`, a Markdown file, or a JS/TS module exporting a deck definition. Code-authored decks
in `--one-file` mode embed the code but not images they load themselves.

## A minimal deck in code

Drawable objects (text, shapes, images) and animations come from the rendering engine, which the
package re-exports as the `engine` namespace.

```ts
import { Slide, defineDeck, engine, type SlideContext } from 'zoomdeck';

const { BLUE, Dot, FadeIn, Text } = engine;

class Topic extends Slide {
  override build(ctx: SlideContext) {
    ctx.add(new Text({ text: this.name, fontSize: 42, color: ctx.foreground }).moveTo([0, 3, 0]));
  }
  override async construct(ctx: SlideContext) {
    const dot = new Dot({ point: [-3, 0, 0], radius: 0.3, color: BLUE });
    await ctx.play(new FadeIn(dot));
    ctx.stop();
    await ctx.play(dot.animate.shift([6, 0, 0]));
  }
}

export default defineDeck({
  title: 'Minimal',
  deck: () => {
    const root = new Slide('Overview', { build: (ctx) => { ctx.add(new Text({ text: 'Two topics', color: ctx.foreground }).moveTo([0, 3, 0])); } });
    root.addChild(new Topic('Left'), { center: [-4, 0, 0], width: 7 });
    root.addChild(new Topic('Right'), { center: [4, 0, 0], width: 7 });
    return root;
  },
});
```

Programs are `async` functions (or async generators when they visit children) because every
`ctx.play` returns a promise. Coordinates are the slide's own logical coordinates: the engine's
world space *is* the slide's local space, so ordinary `moveTo`, `nextTo`, `shift` and `.animate`
calls work unchanged inside any slide. `ctx.play(anim1, anim2, { runTime, rateFunc })` plays
several animations together with a shared duration and rate function.

| Task | API |
| --- | --- |
| Create a slide | `new Slide(name, { width: 8, startHere: true })` |
| Nest a slide | `parent.addChild(child, { center, width, angle, strokeColor })` |
| Animate, pause, stop | `await ctx.play(...)`, `await ctx.wait()`, `ctx.stop(opts)` |
| Visit a child explicitly | `yield ctx.visit(child)` inside `async *construct` |
| Align to the canvas | `ctx.toEdge(mob, [0, 1, 0], { buff: 0.7 })`, `ctx.toCorner(mob, ...)` |
| Define a deck | `defineDeck({ deck, presenter, background, foreground, viewport })` |
| Markdown deck | `markupDeck({ url, layout, presenter, ... })` or a `deck.json` |
| Presenter options | `new PresenterConfig({...})` / plain options |
| Animated images | `new RasterMovie(rasterImage, { plays })` with `RasterSource.load(url)` |

Objects mutated outside animations (direct `shift` calls between plays) should be reported with
`ctx.touch(obj)` so snapshots record them.

## Markdown decks

Write slides in the Markdown dialect ([docs/markup.md](docs/markup.md); the guide deck under
`examples/guide/` shows every construct next to its source) and place a `deck.json` next to the
file:

```json
{
  "markup": "slides.md",
  "title": "IntroductionToLogic",
  "background": "#FFFFFF",
  "viewport": { "width": 1024, "height": 768 },
  "layout": { "defaultSlideSize": [16, 12], "font": "Times New Roman", "color": "BLACK", "fontSize": 36, "headingSize": 80, "codeSize": 24 },
  "presenter": { "transitionTime": 1.5 },
  "classes": "code-slides.ts",
  "macros": { "N": "\\mathbb{N}" }
}
```

`layout` takes the `LayoutConfig` fields (`fontSize`, `headingSize`, `codeSize`, `color`, `font`,
`codeFont`, `margin`, `gap`, `lineGap`, `animationTime`, `defaultSlideSize`, `textAnchor`); `presenter` takes the
`PresenterConfig` fields; `viewport` sets the presentation proportions the camera fits (the
browser reveals the surrounding canvas when its stage has extra room); `classes` names a module
exporting the `Slide` classes used by `[[subslide: Name ...]]`.

A deck is black text on a white canvas by default (`background` and `layout.color` change
that). Prose uses the bundled Latin Modern Roman face and code the bundled Latin Modern Mono (LaTeX's Computer Modern family) unless `layout.font` or `layout.codeFont`
replace them; `font=` on a paragraph, heading or label picks another face (the handwriting face Zeyada is bundled too)
says otherwise, and formula sizes are calibrated to prose sizes, so text and math look like one
LaTeX document by default. LaTeX renders through MathJax (ams, newcommand and configmacros packages). `\textcolor` and
`\color` with dvipsnames or CSS colors are supported; other LaTeX packages are not. Prose uses
canvas typography with the configured font family; inline math shares the text baseline. Fenced
code blocks become verbatim listings with token colors for Python, JavaScript/TypeScript, C-like
languages, shells, JSON, LaTeX, HTML/SVG and the dialect itself. SVG artwork keeps nested
transforms and inherited styles; `<text>` inside SVG files is not rendered, so export text as
paths.

## Project layout

```text
Zoomdeck/
├── bin/zoomdeck.mjs    serve / build command line (Vite based)
├── src/
│   ├── code-slides.ts             Slide, PlaceholderSlide, Visit, walk
│   ├── geometry.ts           similarity transforms and canvas fitting
│   ├── display.ts            local membership and per-slide Three.js display groups
│   ├── runtime.ts            SlideContext, Presenter, clips, snapshots, PresenterConfig
│   ├── snapshot.ts           identity-preserving state capture
│   ├── raster.ts             APNG/GIF/still decoding, RasterImage, RasterMovie
│   ├── svg.ts                SVG importer with transforms and inherited styles
│   ├── markup/               parser, AST validation, text layout, code listings, renderer, slides, deck loader
│   ├── player/               stage (engine scene + camera fit), replay driver, player, UI, boot
│   ├── deck.ts, index.ts     deck definitions and the public API (`engine` re-exports the renderer)
│   └── dev.ts, index.html    development page
├── docs/site/, docs/html/    documentation sources and the built site (npm run docs)
├── docs/markup.md            compact reference of the Markdown dialect
├── examples/                 the guide deck and two small code-authored decks
└── tests/                    vitest unit tests (parser, code listings, colors, transforms, traversal)
```

Run `npm test` for the unit tests and `npm run typecheck` for TypeScript.

## Editors

`editors/` holds ready-to-use configurations that bind the live preview (`zoomdeck serve`, which
reloads the browser on save and keeps your position) and the one-file export to shortcuts, save
decks as you type and highlight the dialect: a VS Code grammar with tasks and key bindings, a
Sublime Text package, an Emacs mode, a Vim/Neovim plugin and JetBrains External Tools. The
documentation page [Editors](docs/site/editors.md) explains each setup.

## Limitations

- Text is rasterized to canvas textures and redrawn at the screen's resolution whenever the
  camera comes to rest, so it is sharp at every zoom level once settled and may soften briefly
  during a zoom; math, SVG and shapes stay vector.
- The dry recording happens at page load; large decks take a few seconds (a 46-slide lecture
  records in about three seconds on a laptop).
- `PresenterConfig.renderCanvas` and `stillTime` are accepted for compatibility but have no
  effect: the live camera always shows whatever surrounds the viewport.
- Speaker notes are kept in clip metadata (`navigation().clips[i].notes`) but have no panel.
- GIF loop counts are not read from the file (GIFs loop indefinitely unless `plays` is given).

## Using Zoomdeck in your own project

The package ships a compiled ES module (`dist/zoomdeck.js`, built by `npm run build:lib` and on
`npm pack`) with type declarations, so any bundler-based project can depend on it:

```bash
npm install zoomdeck
```

```ts
import { runDeck, markupDeck } from 'zoomdeck';

runDeck(markupDeck({ url: '/decks/lecture/slides.md', title: 'Lecture 1' }));
```

The runtime dependencies (`manim-web`, `three`, `markdown-it`, `gifuct-js`, `roughjs`) are installed with it
and left external, so your bundler resolves them once. The TypeScript sources remain available as
`zoomdeck/source` for projects that prefer to compile them. Without a bundler, use the command
line: `zoomdeck serve <deck>` for editing and `zoomdeck build <deck> -o <folder> [--one-file]` for
a static or single-file export that needs nothing else.

## License

MIT, see [LICENSE](LICENSE). The bundled Latin Modern fonts are distributed under the GUST Font
License (`src/fonts/GUST-FONT-LICENSE.txt`) and the bundled Zeyada handwriting font under the SIL
Open Font License (`src/fonts/ZEYADA-OFL.txt`); the rendering engine `manim-web` and the other
dependencies are MIT-licensed npm packages.
