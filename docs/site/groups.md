---
title: Groups
description: Several elements laid out in their own coordinates and handled as one element of the slide.
---

<a class="try" href="tour.html#slide=groups">Open in the tour ↗</a>

```markdown
::: {.group #automaton x=2 y=-0.5 step=1}
[[circle: #q0 x=0 y=0 radius=0.6 color=BLUE]]
[$q_0$]{at=#q0.center anchor=center}
[[circle: #q1 x=3 y=0 radius=0.6 color=BLUE]]
[$q_1$]{at=#q1.center anchor=center}
[[arrow: #q0 -> #q1, #t, label="$a$"]]
:::

[[box: #automaton, #gbox, buff=0.3, color=GREEN, step=2]]

::: {.group #legend below:#automaton left-aligned:#automaton buff=0.9}
[[dot: #k1 x=0 y=0 color=BLUE]]
[a state]{at=#k1.right anchor=left-baseline dx=0.2}
:::
```

A `::: {.group #id …}` container holds elements, shapes, connections, attachments and nested
groups (no includes, subslides or directives).

## Local coordinates

Members are laid out in the group's own coordinates: flow starts at the local origin, explicit
coordinates and `at=` are local, and members may only reference other members of the same group.
Member IDs without an explicit `#id` are prefixed with the group ID (`automaton.element-2`).

## One element of the slide

The group is then a single element: `x`, `y` place its **origin** (the local `(0,0)`) unless
`anchor=` names a bounding-box point; relative constraints, `at=`, `dx`/`dy`, `width` (the
members' wrapping width), `opacity`, `step`, `hide`, `focus_only` and `enter`/`exit` apply to the
whole. A group can be an `at=` or relative reference, an arrow endpoint, a brace or box target, and
the target of an [animation](animations.html).

Members cannot carry `step`, `hide`, `focus_only` or `play`, and `show`/`hide`/`animate`
directives cannot target them: animate the group.
