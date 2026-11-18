---
title: Extending a deck
description: Folders next to the Markdown that add to the player by name, without touching it: snippets, directives, fonts, effects, camera transitions, chart types and data, languages, code themes, themes, artworks and slide classes.
---

A deck extends the player by putting files in folders next to its Markdown. Each folder holds
one kind of thing, one file per name, and the name is what the Markdown says: `[[snippet: card …]]`
expands `snippets/card.md`, `[[gauge: …]]` draws with `directives/gauge.ts`, `[[effect: pulse …]]`
plays `effects/pulse.ts`, `transition=swoop` moves the camera with `transitions/swoop.ts`,
`type=donut` draws with `charts/donut.ts`, `` ```zig `` colors with `languages/zig.json`, and
`font: Inter` loads `fonts/Inter.woff2`. Nothing registers
anything: a name that is not built in is looked up in the folders when the deck is built, and a
name no folder has is an error that names the folders (or, for a font, a family left to the
browser). The preview watches these folders, and the exports carry them: modules are bundled,
files copied into the folder export or embedded in the single file.

```text
talk/
├── slides.md
├── snippets/        card.md             [[snippet: card id=one title="…"]]
├── directives/      gauge.ts            [[gauge: #g level=0.7]]
├── fonts/           Inter.woff2, Inter-Bold.woff2, Inter-Italic.woff2, Inter-BoldItalic.woff2
├── effects/         pulse.ts            [[effect: pulse #id, step=N]], enter=pulse
├── transitions/     swoop.ts            transition=swoop
├── charts/          donut.ts            ```chart {type=donut src=data.csv}
├── languages/       zig.json            ```zig
├── code-themes/     sepia.json          layout: { codeTheme: sepia }
├── themes/          lecture.md          theme: lecture
├── artworks/        rocket.svg, gate.ts [[artwork: rocket]], [[artwork: gate]]
└── slides/          Orbit.ts            [[subslide: Orbit]]
```

The standard folders are found on their own. The front matter names further ones under the same
keys (`snippets`, `directives`, `fonts`, `effects`, `transitions`, `charts`, `languages`,
`codeThemes`, `themes`, `artworks`, `slides`), relative to the file that names them, so a library
shared between talks lives once: `effects: ../shared/effects`, or the same line in a file the
talks extend ([Configuration](configuration.html#shared-settings)). The `paths` folders are
searched last for every kind. Modules may import `manim-web` and `zoomdown` as
[code-authored slides](code-slides.html) do, and need no `node_modules` of their own.

## Snippets

```markdown
::: snippet card
::: slide {#{{id}} width=20}
## {{title}}

[{{note|A detail follows.}}]{#{{id}}-note x=-9 y=-3 font_size=22 color=GRAY}

[[include: #{{id}}-detail x=4 y=-1 width=8 preview=true]]
:::
:::

[[snippet: card id=intro title="Where we start"]]
[[snippet: card id=method title="How it works" note="Three steps, one slide each."]]
```

A snippet is markup written once and used many times: a `::: snippet name` block anywhere in
the document (or an imported file), or the file `snippets/name.md`. `[[snippet: name key=value …]]`
on a line of its own is replaced by the snippet's lines before anything is parsed, with every
`{{key}}` filled from the attributes of the use; `{{key|default}}` has a value when the use gives
none, and a key with neither is an error that names the snippet. A snippet may hold whole slides,
as above, or a few elements inside one; it may use imports and other snippets, and the ids it
needs come from its attributes, so two uses never collide. Errors inside a snippet name the block
and its line. Snippets need no code: they are the way to repeat a slide skeleton, a framed child
with its caption, or a footer.

## Directives

```ts
// directives/gauge.ts
import { Arc, Line, VGroup, type Mobject } from 'manim-web';
import type { DirectiveOptions } from 'zoomdown';

export default async function gauge({ attributes, color, text }: DirectiveOptions): Promise<Mobject[]> {
  const level = Number(attributes.level ?? 0.5);
  const dial = new Arc({ radius: 1, startAngle: Math.PI, angle: -Math.PI, color });
  const needle = new Line({ start: [0, 0, 0], end: [-Math.cos(Math.PI * level), Math.sin(Math.PI * level), 0], color });
  const label = await text(attributes.label ?? `${Math.round(level * 100)} %`, 20);
  label.nextTo(dial, [0, -1, 0], 0.2);
  return [new VGroup(dial, needle), label];
}
```

```markdown
[[gauge: #load x=4 y=0 level=0.7 label="load" step=2]]
```

A directive of the deck's own is any `[[name: …]]` the dialect does not know: it is drawn by
`directives/name.ts`, a module exporting a function (`default`, or `directive`) that receives the
directive's attributes as written, its `name` (so one module may serve several), the deck's typography (`fontSize`, `width`, `color`, `foreground`, `layout`,
the hand-drawn options under `sketch`) and three helpers, `text` for inline markup in the deck's
font, `icon` for a built-in icon and `artwork` for one of the deck's own, and returns a mobject or
a list of them. The result is an element like any other: `x`, `y`, the relative positions, `step`,
`enter`, `exit`, `class` and the animation directives all apply to its `#id`, and the attributes
the module reads (`level`, `label`) are free. Where artworks are symbols, directives are the
diagram vocabulary that needs data: a gauge, a timeline, a gate with its inputs.

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
import { PropertyAnimation, type EffectOptions } from 'zoomdown';

export default function pulse(target: Mobject, { scale = 1.3, color: _color, ...timing }: EffectOptions) {
  return new PropertyAnimation(target, { scale }, { ...timing, rateFunc: thereAndBack });
}
```

An effect module exports a function (`export default`, or a named `effect`) that receives the
target and the directive's options (`color`, `scale`, and the timing: `run_time` as `duration`,
`rate` as `rateFunc`) and returns an animation of the engine: one of its own classes, a
`PropertyAnimation` as above, or a composition of built-in effects. `[[effect: pulse #id, step=N]]`
plays it like a built-in; the name may use letters, digits, `_` and `-`, so `effects/fly-in.ts` is
`[[effect: fly-in …]]`. The same modules serve as **enter and exit styles**: `enter=fly-in` on an
element, or on a `[[show: …]]`, plays the effect when the element appears, `exit=fly-in` when it
leaves, so a deck defines how its things come and go once. Effects load when the deck is built,
before any step plays.

## Camera transitions

```ts
// transitions/swoop.ts
import { smooth } from 'manim-web';
import type { CameraState } from 'zoomdown';

// The camera widens on the way, as if lifting off before landing on the next slide.
export default function swoop(start: CameraState, target: CameraState, alpha: number): CameraState {
  const t = smooth(alpha);
  const lift = Math.sin(Math.PI * alpha) * Math.max(start.width, target.width) * 0.6;
  return {
    center: [start.center[0] + (target.center[0] - start.center[0]) * t, start.center[1] + (target.center[1] - start.center[1]) * t, 0],
    width: start.width + (target.width - start.width) * t + lift,
  };
}
```

`transition=` on a slide or an include, and `presenter: { transition: … }` in the front matter
for the whole deck, take `zoom`, `cut`, or the name of a module in `transitions/`: a function that receives the
camera's start and target (center and width) and how far the move is, 0 to 1 linear in time, and
returns where the camera is; it eases as it likes. A slide's transition governs every move into
that slide, from wherever the camera comes; the move out of it belongs to the next destination.
The move keeps `transitionTime`. Transitions load when the deck is built.

## Chart types

```ts
// charts/donut.ts
import { type ChartData, type ChartOptions, type LabelFactory, CHART_COLORS } from 'zoomdown';
import { Annulus, VGroup } from 'manim-web';

export default function donut(data: ChartData, options: ChartOptions, label: LabelFactory): VGroup { /* … */ }
```

A chart module exports a function (`default`, or `chart`) that receives the parsed data (rows,
series, labels), the fence's options (`width`, `height`, `colors`, `values`, `min`, `max`, `grid`
and the rest) and a label factory that makes text in the deck's font and color, and returns the
drawing. `type=donut` on a chart fence selects it; the function may ignore options it has no use
for. [Tables and charts](tables-charts.html#from-code) has the data shape.

The rows of any chart, built in or not, may come from a file instead of the fence: `src=data.csv`
(or `.tsv`, or `.json`) names a file next to the Markdown or in the `paths` folders, and the fence
stays empty. CSV is read as the fence would be, header row detected or forced with `header=`;
JSON is `{ "categories": [...], "series": [{ "name": "…", "values": [...] }] }`, the Chart.js
shape `{ "labels", "datasets": [{ "label", "data" }] }`, or an array of rows. The exports copy or
embed the file, so data stays out of the slides and one chart module serves many talks.

## Languages and code themes

```json
// languages/zig.json
{ "keywords": ["fn", "pub", "const", "var", "return", "if", "else", "while", "for"], "types": ["u8", "u32", "i64", "void", "bool"],
  "lineComment": ["//"], "strings": ["\""], "aliases": ["ziglang"] }
```

A language profile is a JSON file with the lists the tokenizer uses: `keywords`, `types`,
`lineComment`, `blockComment` (pairs), `strings`, `tripleStrings`, the flags `commands` (TeX
`\name`), `variables` (`$name`), `flags` (`--name`) and `keys` (`"name":`), and `mode`
(`markup` or `tags`) for line-oriented syntaxes.
`aliases` adds other fence names for the same profile. Any fence name the player does not know
is looked for as `languages/<name>.json`, once per deck.

```json
// code-themes/sepia.json
{ "keyword": "#884400", "type": "#556B2F", "string": "#A0522D", "comment": "#8B8378", "number": "#B8860B" }
```

A code theme maps token classes (`keyword`, `type`, `string`, `comment`, `number`, `directive`,
`attribute`, and `plain` for everything else) to colors; `layout: { codeTheme: sepia }` in the
front matter applies `code-themes/sepia.json` to every listing. Classes the theme leaves out keep
the color the deck's text color gives them.

## Themes

```markdown
<!-- themes/lecture.md -->
::: styles
heading: color=BLUE_E
body: font_size=30
footnote: font_size=18 color=GRAY
layout: fontSize=30 headingSize=44 font="Inter"
presenter: transitionTime=1 pauseOnReturn=false
deck: background=#0F172A viewport=16x9
:::
```

A theme is a deck's look kept apart from its slides: a Markdown file whose `::: styles` blocks (or
every line, when it has no block) define [styles](styles.html), with three reserved names for the
settings that are not styles: `layout:` takes the keys of `layout` in the front matter,
`presenter:` those of `presenter`, and `deck:` takes `background=` and `viewport=16x9`.
`theme: lecture` in the front matter applies `themes/lecture.md`; a list `[lecture, wide]`
applies several, later ones over earlier. The deck's own `styles`, `layout`, `presenter`,
`background` and `viewport` win over the theme key by key, and its `::: styles` block over
everything. Since styles cover the roles (`heading`, `body`, `code`, `chart`, `table`, …) and any
class, and the theme sets typography, timing and colors with them, a theme restyles a deck
without touching its slides.
Themes are read before the player starts, so a page of your own that names one uses
`loadMarkupDeck` ([Embedding](embedding.html)) rather than `markupDeck`.

## Artworks and slide classes

[Artworks](icons.html#artworks-of-your-own) of the deck's own, `name.svg` or a module, live in
`artworks/` and are placed with `[[artwork: name …]]`. Slide classes for `[[subslide: Name]]` are
usually gathered in the module `classes` names; a `slides/` folder is the alternative, one
`Name.ts` per class, exporting it by name or as the default: a class the module does not have is
looked for there. The two mix freely, and an export bundles both.
