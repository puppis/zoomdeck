---
title: Text
description: Paragraphs, headings, emphasis, colors, code spans, line breaks, lists and links.
---

<a class="try" href="tour.html#slide=prose">Open in the tour ↗</a>

```markdown
Paragraphs wrap to `width`. Use **bold**, *italic*, ***both***, `inline code`
and inline math $e^{i\pi}+1=0$.

[Colored spans]{color=ORANGE} take palette names, [CSS colors]{style="color:#4ADE80"}
or hex values, and [nest **emphasis** and $\sqrt{2}$]{color=YELLOW}.

First line.\\
Second line after an explicit break.

- Bullet items are prose with a marker
  - Nested items indent, and wrap with a hanging indent
    1. Numbered lists nest too
- Headings set size only: `#` to `######`

### A level-3 heading {color=TEAL}

Links like [this one](https://vite.dev) are clickable.
```

## Blocks

Paragraphs, headings (`#` to `######`), bullet and numbered lists and fenced code blocks are
supported. Blank lines separate elements: each paragraph, heading, list item, image, formula and
listing is one element with its own attributes. Headings only change the typography; nesting
comes from includes.

As in LaTeX, a blank line between two texts makes a paragraph break, with a little more space
than between two lines: their baselines are `layout.paragraphSpacing` interlines apart (1.5 by
default), where the interline is the distance between two lines of one paragraph. A text and
another block (a table, an image, a shape) keep the same space between them.

## Lists

Items start with `-`, `*` or `+`, or with a number and `.` or `)`; indenting an item by two or
more spaces nests it under the previous one, to any depth. Each item is one element: its marker
sits in a column of `layout.listIndent` (0.6 units, wider when a number needs it), its prose
wraps to the rest of the width with a hanging indent, and nested items are shifted by one column
per level. Markers are `•`, `–` and `◦` by depth; numbered items show their own number with
its delimiter, so a list may start at any value. Items written line after line follow one
another as lines, one interline apart; blank lines between items are allowed and space them as
paragraphs, and an indented paragraph after a blank line continues the item without a marker. Attributes in braces
work on an item as on any paragraph; an explicit `x` is the left edge of the list, nested items
keep their indentation to its right.

HTML comments are discarded and raw HTML is shown as text. Soft line breaks in the source are
joined; an explicit break takes two trailing spaces, a backslash before the newline, or `\\`.

## Columns

Pieces of text align across lines with `&&` between them, as in a table without rules or in a
LaTeX `align`: in a block that contains `&&`, every line of the source is a row and `&&` ends a
cell, each column is as wide as its widest cell, and a cell starts where the columns before it
end, plus a gap of one em. Spaces around `&&` are free, so the source itself can be aligned:

```zoomdown {height=4}
::: slide {#columns width=16 height=4}

This is a         && test             && (be careful) \\
                  && the second column && and then the third
                  &&                   && the third again
**Name**          && *Value*           && $x^2$
{x=-7 y=1 font_size=22}

:::
```

A row with fewer cells leaves the rest empty, and an empty cell (a line that starts with `&&`,
or two `&&` in a row) skips a column. A row without `&&` is one cell of the first column and
counts toward its width, as in LaTeX, so a long line of prose in such a block pushes the other
columns to its right; keep such lines in a block of their own. Cells do not
wrap: a block wider than its width shrinks as a whole, as a single overlong word does, so give a
wide one a `width`. Styles, formulas, code and links work inside cells. A literal double
ampersand is written `\&&`; a single `&` is ordinary text everywhere. `\\` still breaks a row,
which lets two rows share a source line.

## Inline styling

Bold, italic, nested emphasis, code spans and inline math (`$…$`) can be combined freely. A
paragraph with inline math stays one element: prose and formulas share one baseline, and the
paragraph wraps to its width as a whole.

Colors are written as `[text]{color=…}` or `[text]{style="color:…"}` (not both). A color is a
palette name (`BLUE`, `RED`, `TEAL`, `ORANGE`, `YELLOW`, `GOLD`, `GRAY`, `GREEN`, `PURPLE`, each with
`_A` to `_E` variants, listed in [the manual](manual-markup.html#color-names)), a CSS name, a hex value or `rgb(…)`. Nested emphasis and math inherit the span's
color. A color-only span stays inline; any other attribute makes the bracketed text a positioned
element of its own, which then must be a whole block.

## Links

`[label](https://…)` renders an underlined label that opens the page in a new tab; `mailto:` and
relative URLs work too. Links are clickable while their slide is the one on screen, not in a
parent's preview of it.

Any element can be a link as a whole: `href=` on a paragraph, heading, image, formula, shape,
icon, arrow, brace, box, blob, table, chart or group opens its URL in a new tab when the element
is clicked. The element's look does not change. Targets inside the deck, `#slide=id` and
`#step=N`, move to that stop instead, on a click or a double-click. While the pen is on, links
are inert, so a drag over a tile still draws, and the dot a tap would leave is taken back.

```markdown
[[icon: document #paper x=0 y=0 size=1.2 label="the paper" href=https://arxiv.org/abs/1234.56789]]

::: {.group #team x=4 y=0 href=https://example.org/team}
Our team
:::
```

## Typography defaults

By default prose is set in **Latin Modern Roman** and code spans in **Latin Modern Mono**, the
OpenType versions of the Computer Modern family LaTeX uses, both bundled with the player; formulas
use MathJax's TeX fonts, and a `font_size` means the same em for all three, so a paragraph with
code and formulas inside it looks like one LaTeX paragraph without any tuning. `layout.font` and
`layout.codeFont` replace the faces (`"Georgia"`, `"Fira Code"`, …) while keeping the size
calibration.

Body text uses `layout.fontSize` (28 by default) and headings `layout.headingSize` (42),
shrinking slightly per level. Any element can override its size with
`font_size=` and its color with `color=`, or through a [style](styles.html). A paragraph, heading,
arrow label or brace label can also pick its own face with `font=`: any font the page has, or the
bundled handwriting face **Zeyada**, which pairs with [hand-drawn shapes](sketch.html)
(`[A note]{font=Zeyada font_size=36}`).
