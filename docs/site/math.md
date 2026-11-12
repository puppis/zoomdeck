---
title: Mathematics
description: Inline and display formulas, containers for formula attributes, macros and colored LaTeX.
---

<a class="try" href="guide.html#slide=math">Open in the guide ↗</a>

```markdown
Inline math shares the baseline: $\int_0^1 x^2\,dx = \tfrac13$.

$$
\sum_{k=0}^{n} \binom{n}{k} = 2^n
$$

::: {.element #pythagoras x=0.6 y=-0.4 font_size=34 step=2}
$$ \textcolor{Orange}{a}^2 + {\color{Cerulean} b^2} = c^2 $$
:::

Macros from deck.json: $\N \subset \R$.
```

- **Inline math** uses single dollars and is laid out on the text baseline, wrapping with the
  paragraph. A literal dollar is `\$`.
- **Display math** uses `$$` on its own lines, or `$$ … $$` on one line, and is one element.
  To give it attributes (position, size, step), wrap it in a `::: {.element …}` container.
- Formulas render through MathJax with the `ams`, `newcommand` and `configmacros` packages.
  `macros` in `deck.json` defines commands for the whole deck:

```json
"macros": { "N": "\\mathbb{N}", "R": "\\mathbb{R}" }
```

- `\textcolor{…}{…}` and `{\color{…} …}` accept dvipsnames (`Orange`, `Cerulean`, `OliveGreen`,
  …) and CSS colors.
- A formula's `font_size` is calibrated to the prose size: `$x$` in a 28-point paragraph has the
  same em as the surrounding words, as in a LaTeX document.
- `width=` limits a formula's width (it is scaled down to fit), `height=` scales it, `font_size=`
  sets the base size, `anchor=top-left` positions a tall aligned formula by its top edge instead of
  its baseline.

> **Note** Math glyphs are vector shapes, so formulas work with every animation and effect,
> including `write`, `transform` and `circumscribe`.
