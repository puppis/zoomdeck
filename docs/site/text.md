---
title: Text
description: Paragraphs, headings, emphasis, colors, code spans, line breaks, lists and links.
---

<a class="try" href="guide.html#slide=prose">Open in the guide ↗</a>

```markdown
Paragraphs wrap to `width`. Use **bold**, *italic*, ***both***, `inline code`
and inline math $e^{i\pi}+1=0$.

[Colored spans]{color=ORANGE} take palette names, [CSS colors]{style="color:#4ADE80"}
or hex values, and [nest **emphasis** and $\sqrt{2}$]{color=YELLOW}.

First line.\\
Second line after an explicit break.

- Bullet items are prose with a marker
- Headings set size only: `#` to `######`

### A level-3 heading {color=TEAL}

Links like [this one](https://vite.dev) are clickable.
```

## Blocks

Paragraphs, headings (`#` to `######`), bullet lists and fenced code blocks are supported. Blank
lines separate elements: each paragraph, heading, list item, image, formula and listing is one
element with its own attributes. Headings only change the typography; nesting comes from includes.

HTML comments are discarded and raw HTML is shown as text. Soft line breaks in the source are
joined; an explicit break takes two trailing spaces, a backslash before the newline, or `\\`.

## Inline styling

Bold, italic, nested emphasis, code spans and inline math (`$…$`) can be combined freely. A
paragraph with inline math stays one element: prose and formulas share one baseline, and the
paragraph wraps to its width as a whole.

Colors are written as `[text]{color=…}` or `[text]{style="color:…"}` (not both). A color is a
palette name (`BLUE`, `RED`, `TEAL`, `ORANGE`, `YELLOW`, `GRAY`, `GREEN`, `PURPLE`, with `_A` to
`_E` variants), a CSS name, a hex value or `rgb(…)`. Nested emphasis and math inherit the span's
color. A color-only span stays inline; any other attribute makes the bracketed text a positioned
element of its own, which then must be a whole block.

## Links

`[label](https://…)` renders an underlined label that opens the page in a new tab; `mailto:` and
relative URLs work too. Links are clickable wherever the text is visible on screen, including in
parent previews.

## Typography defaults

By default prose is set in **Latin Modern Roman** and code spans in **Latin Modern Mono**, the
OpenType versions of the Computer Modern family LaTeX uses, both bundled with the player; formulas
use MathJax's TeX fonts, and a `font_size` means the same em for all three, so a paragraph with
code and formulas inside it looks like one LaTeX paragraph without any tuning. `layout.font` and
`layout.codeFont` replace the faces (`"Georgia"`, `"Fira Code"`, …) while keeping the size
calibration.

Body text uses `layout.fontSize` (28 by default) and headings `layout.headingSize`, shrinking
slightly per level; code spans use `layout.codeFont`. Any element can override its size with
`font_size=` and its color with `color=`, or through a [style](styles.html). A paragraph, heading,
arrow label or brace label can also pick its own face with `font=`: any font the page has, or the
bundled handwriting face **Zeyada**, which pairs with [hand-drawn shapes](sketch.html)
(`[A note]{font=Zeyada font_size=36}`).
