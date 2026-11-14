---
title: Code listings
description: Fenced code blocks as verbatim listings with syntax colors for common languages and for the slide dialect itself.
---

<a class="try" href="tour.html#slide=listings">Open in the tour ↗</a>

````markdown
```python {#py x=0.6 y=3.7 width=9 step=1}
def visit(slide):
    yield slide                 # pre-order
    for child in slide.children:
        yield from visit(child)
```

```json {x=0.6 y=1.3 step=2}
{ "markup": "slides.md", "layout": { "codeSize": 18 } }
```
````

A fenced block (`` ``` `` or `~~~`) is a verbatim listing. Its info string names the language,
optionally followed by the usual `{…}` attributes: `#id`, `x`/`y` (left edge and first
baseline, like prose), `width` (the block shrinks uniformly if a line is wider), `height`,
`font_size` (default `layout.codeSize`, 80 % of the text size), `color`, `anchor`, `step`/`hide`,
`focus_only`, `.class` and the relative constraints. Lines never wrap and tabs become four spaces.
A `::: {.element …}` container around the fence works as for other blocks.

## Languages

| Names | Highlighting |
| --- | --- |
| `python`, `py` | keywords, builtins, strings (including triple quotes), comments, numbers |
| `javascript`, `typescript`, `js`, `ts`, `jsx`, `tsx`, `java`, `c`, `cpp`, `cs`, `rust`, `go`, `kotlin`, `swift`, `scala`, `dart`, `php` | C-like keywords and types, strings, line and block comments, numbers |
| `bash`, `sh`, `zsh`, `shell`, `console` | keywords and common commands, strings, comments, `$variables`, `--flags` |
| `json` | keys, strings, numbers, literals |
| `latex`, `tex` | commands, math, comments |
| `html`, `xml`, `svg` | tags, attributes, strings, comments |
| `markdown`, `md`, `slides` | this dialect: containers, directives, attributes, math, code spans, headings |
| anything else, or no name | plain text |

Token colors follow the slide's text color: light text on a dark background gets a dark-theme
palette, dark text on a light background a light-theme one. Listings and inline code use the
bundled Latin Modern Mono, the LaTeX typewriter face; `layout.codeFont` picks another monospace
family.

> **Tip** To show markup that itself contains fences, open the outer block with four backticks.
