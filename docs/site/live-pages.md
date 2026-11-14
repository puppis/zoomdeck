---
title: Live pages
description: Embedded web pages shown while their slide is focused, with a poster for previews.
---

<a class="try" href="tour.html#slide=media">Open in the tour ↗</a>

```markdown
[[iframe: assets/embedded.html, #page, x=5 y=-1.2, width=8, height=4.5, step=2, poster=assets/page.png]]
[[iframe: https://example.org/demo, #demo, below:#heading, width=10, height=6, title="Demo"]]
```

An `[[iframe: url, #id, …]]` embeds a web page. On the canvas it is a **placeholder**: the
`poster=` image scaled into the slide, or an outlined box labelled with the `title` (or the URL).
The placeholder takes the usual placement attributes plus `width` and `height`, `step`/`hide`,
`color` and `.class`.

The **live page** appears over the placeholder only once the camera has come to rest on the
page's slide. In parent previews, during zooms in and out, and after the camera leaves, the
placeholder stands in. Interaction inside the page is real: click outside it to return the
keyboard to the deck.

- URLs must be `http(s)` or relative to the Markdown file; pages that forbid framing stay blank.
- The page is not drawn by the pen or spotlight overlays and is absent from exported screenshots.
- A poster is the only way to show the page's look in previews, since browsers do not allow
  rasterising another page.

## Links

Plain Markdown links in prose, `[label](https://…)`, are underlined on the canvas and clickable
wherever they are visible; see [Text](text.html).
