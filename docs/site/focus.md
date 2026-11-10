---
title: Focus-only decorations
description: Elements that appear only while their slide is focused, such as an opaque local canvas.
---

<a class="try" href="guide.html#slide=focus">Open in the guide ↗</a>

```markdown
[[rectangle: #paper x=0 y=0 width=20 height=11.25 fill_color="#1E293B" fill_opacity=1 stroke_width=0 focus_only=true]]

## Decorations visible only in focus

[This caption fades in with focus and out when the camera leaves]{#caption x=-9.35 y=0.6 width=19 focus_only=true color=TEAL}
```

Static text, math, images, listings, shapes and groups with `focus_only=true` fade in when their
slide is focused and out when the camera leaves, including to a child. They are drawn behind the
slide's ordinary content, still take part in layout and can anchor other elements.

The typical use is an opaque local canvas with its heading: while the slide is focused the parent's
text cannot show through, and on return the panel disappears so the parent is not covered.

Focus-only elements cannot carry `step`, `hide` or `play`, and `show`/`hide`/`transform`
directives cannot target them. Transparent zoom-only slides need no local canvas.
