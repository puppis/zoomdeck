---
title: Extending a deck
description: Folders next to the Markdown that add to the player by name, without touching it: fonts, effects, chart types, languages, code themes, themes, artworks and slide classes.
---

<a class="try" href="tour.html#slide=animations">Open in the tour ↗</a>

A deck extends the player by putting files in folders next to its Markdown. Each folder holds
one kind of thing, one file per name, and the name is what the Markdown says: `[[effect: pulse …]]`
plays `effects/pulse.ts`, `type=donut` draws with `charts/donut.ts`, `` ```zig `` colors with
`languages/zig.json`, and `"font": "Inter"` loads `fonts/Inter.woff2`. Nothing registers
anything: a name that is not built in is looked up in the folders when the deck is built, and a
name no folder has is an error that names the folders (or, for a font, a family left to the
browser). The preview watches these folders, and the exports carry them: modules are bundled,
files copied into the folder export or embedded in the single file.

```text
talk/
├── slides.md
├── deck.json
├── fonts/           Inter.woff2, Inter-Bold.woff2, Inter-Italic.woff2, Inter-BoldItalic.woff2
├── effects/         pulse.ts            [[effect: pulse #id, step=N]]
├── charts/          donut.ts            ```chart {type=donut}
├── languages/       zig.json            ```zig
├── code-themes/     sepia.json          "layout": { "codeTheme": "sepia" }
├── themes/          lecture.md          "theme": "lecture"
├── artworks/        rocket.svg, gate.ts [[artwork: rocket]], [[artwork: gate]]
└── slides/          Orbit.ts            [[subslide: Orbit]]
```

The standard folders are found on their own. `deck.json` names further ones under the same keys
(`fonts`, `effects`, `charts`, `languages`, `codeThemes`, `themes`, `artworks`, `slides`), relative
to itself, so a library shared between talks lives once: `"effects": ["../shared/effects"]`. The
`paths` folders are searched last for every kind. Modules may import `manim-web` and `zoomdeck`
as [code-authored slides](code-slides.html) do, and need no `node_modules` of their own.

## Fonts

`layout.font`, `layout.codeFont` and `font=` on an element name a family. A family that is not
bundled is looked for in the fonts folders as `Family.woff2` (or `.woff`, `.ttf`, `.otf`), with
the variants `Family-Bold`, `Family-Italic` and `Family-BoldItalic` when the folder has them, and
loaded before any text is laid out, so the layout measures the right face. A family no folder has
is used as a system font, as before. Fonts are files, not modules: the one-file export embeds
them, so a deck keeps its typography on a machine that never installed the font.

## Effects

```ts
// effects/pulse.ts
import { thereAndBack, type Mobject } from 'manim-web';
import { PropertyAnimation, type EffectOptions } from 'zoomdeck';

export default function pulse(target: Mobject, { scale = 1.3, color: _color, ...timing }: EffectOptions) {
  return new PropertyAnimation(target, { scale }, { ...timing, rateFunc: thereAndBack });
}
```

An effect module exports a function (`export default`, or a named `effect`) that receives the
target and the directive's options (`color`, `scale`, and the timing: `run_time` as `duration`,
`rate` as `rateFunc`) and returns an animation of the engine: one of its own classes, a
`PropertyAnimation` as above, or a composition of built-in effects. `[[effect: pulse #id, step=N]]`
plays it like a built-in; the name may use letters, digits, `_` and `-`, so `effects/fly-in.ts` is
`[[effect: fly-in …]]`. Effects load when the deck is built, before any step plays.

## Chart types

```ts
// charts/donut.ts
import { type ChartData, type ChartOptions, type LabelFactory, CHART_COLORS } from 'zoomdeck';
import { Annulus, VGroup } from 'manim-web';

export default function donut(data: ChartData, options: ChartOptions, label: LabelFactory): VGroup { /* … */ }
```

A chart module exports a function (`default`, or `chart`) that receives the parsed data (rows,
series, labels), the fence's options (`width`, `height`, `colors`, `values`, `min`, `max`, `grid`
and the rest) and a label factory that makes text in the deck's font and color, and returns the
drawing. `type=donut` on a chart fence selects it; the function may ignore options it has no use
for. [Tables and charts](tables-charts.html#from-code) has the data shape.

## Languages and code themes

```json
// languages/zig.json
{ "keywords": ["fn", "pub", "const", "var", "return", "if", "else", "while", "for"], "types": ["u8", "u32", "i64", "void", "bool"],
  "lineComment": ["//"], "strings": ["\""], "aliases": ["ziglang"] }
```

A language profile is a JSON file with the lists the tokenizer uses: `keywords`, `types`,
`builtins`, `lineComment`, `blockComment` (pairs), `strings`, `tripleStrings`, and the flags
`commands` (TeX `\name`), `variables` (`$name`), `flags` (`--name`) and `keys` (`"name":`).
`aliases` adds other fence names for the same profile. Any fence name the player does not know
is looked for as `languages/<name>.json`, once per deck.

```json
// code-themes/sepia.json
{ "keyword": "#884400", "type": "#556B2F", "string": "#A0522D", "comment": "#8B8378", "number": "#B8860B" }
```

A code theme maps token classes (`keyword`, `type`, `builtin`, `string`, `comment`, `number`,
`attribute`, `tag`, `punctuation`, `directive`, `math`, …) to colors; `"layout": { "codeTheme":
"sepia" }` applies `code-themes/sepia.json` to every listing. Classes the theme leaves out keep
the color the deck's text color gives them.

## Themes

```markdown
<!-- themes/lecture.md -->
::: styles
heading: color=BLUE_E
body: font_size=30
footnote: font_size=18 color=GRAY
:::
```

A theme is a style sheet of its own: a Markdown file whose `::: styles` blocks (or every line,
when it has no block) define [styles](styles.html), or a JSON file shaped like `styles` in
`deck.json`. `"theme": "lecture"` in `deck.json` applies `themes/lecture.md` under the deck's own
`styles` and `::: styles` block, which win for the same name; a list `["lecture", "wide"]` applies
several, in order. Since styles cover the roles (`heading`, `body`, `code`, `chart`, `table`, …)
and any class, a theme restyles a deck without touching its slides.

## Artworks and slide classes

[Artworks](icons.html#artworks-of-your-own) of the deck's own, `name.svg` or a module, live in
`artworks/` and are placed with `[[artwork: name …]]`. Slide classes for `[[subslide: Name]]` are
usually gathered in the module `classes` names; a `slides/` folder is the alternative, one
`Name.ts` per class, exporting it by name or as the default: a class the module does not have is
looked for there. The two mix freely, and an export bundles both.
