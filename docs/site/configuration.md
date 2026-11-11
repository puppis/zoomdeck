---
title: Configuration
description: Every key of deck.json, the layout and presenter options, and the command line.
---

## deck.json

```json
{
  "markup": "slides.md",
  "title": "Zoomdeck guide",
  "root": "guide",
  "classes": "code-slides.ts",
  "background": "#0F172A",
  "viewport": { "width": 16, "height": 9 },
  "layout": { "color": "#F1F5F9", "fontSize": 26, "headingSize": 40, "codeSize": 19 },
  "presenter": { "transitionTime": 0.8, "showSlideBorders": false },
  "styles": { "footnote": { "font_size": 18, "color": "GRAY" } },
  "macros": { "N": "\\mathbb{N}", "R": "\\mathbb{R}" },
  "showOutline": false
}
```

| Key | Meaning |
| --- | --- |
| `markup` | the Markdown file, relative to `deck.json` (required) |
| `title` | the page title and outline root label |
| `root` | the root slide ID, when you want it checked explicitly |
| `classes` | module exporting `Slide` classes for `[[subslide: Name]]` (`imports` is still accepted) |
| `background` | canvas background color (white by default) |
| `viewport` | proportions the camera fits (the stage reveals surrounding canvas when it has room) |
| `layout` | typography and spacing, below |
| `presenter` | timing and camera policy, below |
| `styles` | named styles applied by `.class` tokens and roles, see [Styles](styles.html) |
| `macros` | LaTeX macros for every formula |
| `showOutline` | open the outline at start |

## layout

| Key | Default | Meaning |
| --- | --- | --- |
| `fontSize` | 28 | body text size |
| `headingSize` | 42 | level-1 heading size; deeper levels shrink slightly |
| `codeSize` | 80 % of `fontSize` | listing size |
| `color` | `#000000` | text and default stroke color (black on the default white canvas) |
| `font` | Latin Modern Roman (bundled) | prose font family; the LaTeX text face by default, so prose and formulas share one design |
| `codeFont` | Latin Modern Mono (bundled) | inline code and listings; the LaTeX typewriter face, sized to pair with the text face |
| `margin` | 0.65 | distance of the flow from the canvas edges |
| `gap` | 0.35 | distance between flowing blocks and default `buff` |
| `lineGap` | 0.12 | extra space between wrapped lines |
| `animationTime` | 0.35 | duration of fades |
| `defaultSlideSize` | `[16, 9]` | canvas of slides without `width`/`height` |
| `textAnchor` | `left-baseline` | default anchor of text (`top-left` or `center` possible) |

## presenter

| Key | Default | Meaning |
| --- | --- | --- |
| `transitionTime` | 0.7 | seconds of each camera move; 0 jumps |
| `padding` | 1 | camera width multiplier around a focused slide |
| `pauseOnEntry` | true | stop after entering a slide, before its first step |
| `pauseOnReturn` | true | stop after returning to a parent |
| `showSlideBorders` | false | draw every slide's canvas border (design aid) |
| `slideBorderColor`, `slideBorderWidth` | `#FC6255`, 3 | border style |
| `showSlideGrid` | false | draw a coordinate grid on the focused slide |
| `reversePlayback` | true | play stops backwards on the left key |

## Command line

```bash
node bin/zoomdeck.mjs serve <deck> [--port N] [--no-open] [--scene Name] [--watch PATH]...
node bin/zoomdeck.mjs build <deck> -o <folder> [--one-file] [--show-outline] [--scene Name]
```

`<deck>` is a `deck.json`, a Markdown file (default settings) or a JS/TS module exporting a deck
definition. `serve` watches the deck's folder and any `--watch` path; `build` writes
`index.html`, `assets/` and `deck/` into the folder, or `offline.html` with `--one-file`. Code
decks in `--one-file` mode embed the code but not images they load themselves.

## Development page

`npm run dev` serves `index.html`, which reads `?deck=` (a `deck.json`, a Markdown file or a
module path, also `/@fs/absolute/path`) and `&scene=` for named exports, and opens the guide when
`deck` is omitted. Files under `examples/` trigger a reload on change.

## Package scripts

| Script | Does |
| --- | --- |
| `npm run dev` | development page |
| `npm test`, `npm run typecheck` | unit tests, TypeScript |
| `npm run docs` | rebuild this documentation into `docs/html/` |
| `npm run serve -- <deck>` | the editing preview |
