---
title: Tables and charts
description: Pipe tables with styled cells, rules and shading, and bar, line and pie charts drawn from rows of numbers, crisp or hand-drawn.
---

<a class="try" href="tour.html#slide=tables">Open in the tour ↗</a>

```markdown
::: {.element #sales x=5 y=1.3 rules=rows stripe_opacity=0.08}
| Region | 2023 | 2024 |
| :--- | ---: | ---: |
| North | 3.2 | **5.0** |
| South | 2.1 | $\pi$ |
:::

```chart {#bars x=5 y=-2.6 width=6 height=2.6 values=true}
Region, 2023, 2024
North, 3.2, 5.0
South, 2.1, 3.1
```
```

## Tables

A Markdown pipe table (a header row, a delimiter row, then body rows) becomes a grid of cells.
Cells hold the usual inline markup: emphasis, code, math, colored spans and links. The delimiter
row sets each column's alignment (`:---` left, `:---:` center, `---:` right). Like a formula, a
table is positioned and styled by wrapping it in a `::: {.element …}` container, which also gives
it its `#id`, `step`, `hide` and the placement attributes of [Positioning](positioning.html);
tables are centered on `x`, `y` unless `anchor=` says otherwise. Columns take the width of their
widest cell; when the table would exceed `width` (the available width by default), columns shrink
in proportion and their text wraps.

| Attribute | Default | Meaning |
| --- | --- | --- |
| `rules` | `all` | which lines to draw: `all`, `rows`, `cols`, `outer` or `none` |
| `border_color` | the text color | color of the rules and the default shading color |
| `stroke_width` | 1.5 | width of the rules |
| `header` | `true` | whether the first row is a header (shaded; `false` treats it as a body row) |
| `header_color`, `header_opacity` | the rule color, 0.12 | background of the header row |
| `stripe_opacity` | 0 | background of every second body row, in the rule color |
| `fill_color`, `fill_opacity` | the rule color, 0 | background of the whole table |
| `padding` | 0.15 | space between a cell's text and its rules |
| `font_size`, `font`, `color`, `opacity` | the layout's | typography and translucency |
| `sketch` and its tuning | `false` | [hand-drawn](sketch.html) rules and backgrounds |

Tables take the style role `table`, so `table: rules=rows header_opacity=0.2` in a styles block
sets a deck-wide look, and `tremble=` makes their rules vibrate like any vector geometry.

## Charts

A fenced block whose language is `chart` holds the data; its info string holds the options:

````markdown
```chart {#visits x=4 y=0 width=7 height=3.5 type=line colors="RED_E TEAL_E"}
Month, Visits, Signups
Jan, 12, 3
Feb, 18, 5
Mar, 15, 4
```
````

Rows are separated by commas, semicolons or tabs. The first row names the series (its first cell
labels the category column and is ignored) unless its cells after the first are plain numbers;
years such as `2023` still count as names, and `header=true` or `header=false` settles doubtful
cases. Each later row is a category followed by one value per series. Lines starting with `#` are
comments.

| Attribute | Default | Meaning |
| --- | --- | --- |
| `type` | `bar` | `bar` (grouped bars), `line` (lines with markers) or `pie` (the first series as slices) |
| `width`, `height` | 6, 3.5 | size of the plot area, or of the box a pie fits in; axis labels and the legend add to it |
| `colors` | a built-in palette | series (or slice) colors, space- or comma-separated |
| `fill_opacity` | 0.85 | opacity of bars and slices |
| `border_color` | each bar's own color | outline of bars and slices (`WHITE` separates slices cleanly) |
| `stroke_width` | 2 | width of axes, series lines and outlines |
| `axis_color` | the text color | axes, ticks and gridlines |
| `grid` | `true` | horizontal gridlines at the ticks |
| `legend` | `true` with several series | legend above the plot |
| `values` | `false` | value labels on bars and points (pies always show percentages) |
| `min`, `max` | from the data | fixed bounds of the value axis |
| `font_size`, `font`, `color`, `opacity` | the layout's | typography (labels use 75% of the size) and translucency |
| `sketch` and its tuning | `false` | [hand-drawn](sketch.html) bars, lines, slices and axes |

Charts are centered on `x`, `y`, take `anchor=`, the relative constraints, `step`, `hide`,
`enter`/`exit` and `tremble=`, serve as endpoints and attachment targets, and carry the style
role `chart`. Negative values extend below the baseline; the value axis always includes zero
unless `min`/`max` move it.

## From code

```ts
import { buildChart, parseChartData, buildTable, engine } from 'zoomdeck';

const data = parseChartData('Region, 2023, 2024\nNorth, 3.2, 5\nSouth, 2.1, 3.1');
const chart = await buildChart(data, { type: 'bar', width: 6, height: 3, values: true }, makeLabel);
```

`buildChart(data, options, label)` returns an engine `Group` centered at the origin; `label(text,
size, color)` must return a text mobject, for example the renderer's `text()` method, so charts
use the deck's typography. `niceStep` and `valueAxis` expose the axis arithmetic. `buildTable(rows,
options, cell)` works the same way with a cell factory that lays out inline spans within a width.
