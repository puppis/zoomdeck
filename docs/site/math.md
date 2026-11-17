---
title: Mathematics
description: Inline and display formulas, containers for formula attributes, macros and colored LaTeX.
---

<a class="try" href="tour.html#slide=math">Open in the tour ↗</a>

```markdown
Inline math shares the baseline: $\int_0^1 x^2\,dx = \tfrac13$.

$$
\sum_{k=0}^{n} \binom{n}{k} = 2^n
$$

::: {.element #pythagoras x=0.6 y=-0.4 font_size=34 step=2}
$$ \textcolor{Orange}{a}^2 + {\color{Cerulean} b^2} = c^2 $$
:::

Macros from deck.json: $\N \subset \R$, $\pair{x}{y} \in \R^2$.
```

- **Inline math** uses single dollars and is laid out on the text baseline, wrapping with the
  paragraph. A literal dollar is `\$`.
- **Display math** uses `$$` on its own lines, or `$$ … $$` on one line, and is one element.
  To give it attributes (position, size, step), wrap it in a `::: {.element …}` container.
- Formulas render through MathJax with the `ams`, `newcommand` and `configmacros` packages.
  `macros` in `deck.json` defines commands for the whole deck, written as in MathJax: an
  expansion, or a list of the expansion and its number of arguments, `#1` to `#9` in the
  expansion; a third item makes the first argument optional, with that default, given in
  brackets as in LaTeX's `\newcommand`:

  ```json
  "macros": {
    "N": "\\mathbb{N}", "R": "\\mathbb{R}",
    "pair": ["\\langle #1, #2 \\rangle", 2],
    "norm": ["\\lVert #2 \\rVert_{#1}", 2, "2"]
  }
  ```

  `$\pair{x}{y}$` gives ⟨x, y⟩, `$\norm{v}$` the 2-norm and `$\norm[\infty]{v}$` the other.
  `\boldsymbol` and `\bm` are there too, as bold italic (`\mathbfit`), unless the deck
  defines them.
  An argument is a `{group}`, a command or a single character, as in TeX, and macros may use one
  another. They hold in every formula of the deck; a `\newcommand` inside a formula holds in that
  formula only. A formula LaTeX cannot read, such as one with an unknown command or a missing
  argument, stops the deck with the line and the reason.

- `\textcolor{…}{…}` and `{\color{…} …}` accept dvipsnames (`Orange`, `Cerulean`, `OliveGreen`,
  …) and CSS colors.
- A formula's `font_size` is calibrated to the prose size: `$x$` in a 28-point paragraph has the
  same em as the surrounding words, as in a LaTeX document.
- `width=` limits a formula's width (it is scaled down to fit), `height=` scales it, `font_size=`
  sets the base size, `anchor=top-left` positions a tall aligned formula by its top edge instead of
  its baseline.

> **Note** Math glyphs are vector shapes, so formulas work with every animation and effect,
> including `write`, `transform` and `circumscribe`.
