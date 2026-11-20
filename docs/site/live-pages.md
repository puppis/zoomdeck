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
`poster=` image fitted to the page's box, or a lightly tinted box labeled with the `title` (or the
URL). The placeholder takes the usual placement attributes plus `width` and `height`,
`step`/`hide`, `color` and `.class`. A page has no border unless `stroke_width=` asks for one, in
`color`, around the placeholder and the live page alike.

The **live page** appears over the placeholder only once the camera has come to rest on the
page's slide. In parent previews, during zooms in and out, and after the camera leaves, the
placeholder stands in. Interaction inside the page is real: clicks and keys go to it, except the
deck's own keys. A key the deck has a use for (a shortcut, the arrows included) goes to the deck
alone, so that the page and the deck never both act on it; other keys go to the page, and so does
everything typed into a field of the page. A page from another site cannot be listened to: it has
the keys while the pointer is over it, and they return to the deck when the pointer leaves it.
With drawing on (D), or a pointer tool held, the page lets the pointer through, so that a stroke
can cross it.

- URLs must be `http(s)` or relative to the Markdown file; pages that forbid framing stay blank.
- The page is not drawn by the pen or spotlight overlays and is absent from exported screenshots.
- A poster is the only way to show the page's look in previews, since browsers do not allow
  rasterizing another page.

## Not to be confused with links

Plain Markdown links in prose, `[label](https://…)`, are underlined on the canvas and clickable
wherever they are visible; see [Text](text.html).
