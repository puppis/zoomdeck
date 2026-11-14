---
title: Fragments and steps
description: Reveal and hide elements on clicks, time the fades, advance automatically and skip events.
---

<a class="try" href="guide.html#slide=fragments">Open in the guide ↗</a>

```markdown
[Visible on entry, hidden at step 3]{#hint x=0.6 y=1.7 hide=3}

[Appears at step 1]{#one x=0.6 y=0.9 step=1 color=GREEN}

[Step 2 reveals this, then advances by itself]{#two x=0.6 y=0.1 step=2 color=YELLOW}
[[next: step=2]]

[Step 3 shows this and hides the hint]{#three x=0.6 y=-0.7 step=3}

[[show: #hint step=4]]
[[hide: #one step=4]]
[[skip_next: step=4]]

[Never shown: step 5 is skipped]{#five x=0.6 y=-1.5 step=5}

[Step 6 follows step 4 directly]{#six x=0.6 y=-2.3 step=6 color=RED}
```

## Steps

An omitted `step` (or `step=0`) makes an element part of the slide's initial content; `step=N`
fades it in at click N and `hide=M` fades it out later. `[[show: #id step=N]]` and
`[[hide: #id step=N]]` repeat changes as often as needed. Showing a visible element or hiding a
hidden one is an error, reported with its line.

Numbers are local to each slide and need not be consecutive: a lone `step=4` creates one click,
not four. All changes sharing a number play together, followed by a pause; if a step also visits
children, the parent's changes play first.

## Timing

<a class="try" href="guide.html#slide=anchors">Open in the guide ↗</a>

Each fade lasts `layout.animationTime` unless the element sets `run_time=S`; `lag=S` delays its
start inside the step, so one click can stagger several elements. A `show`/`hide` directive may
carry its own `run_time`, `lag` and `rate`.

```markdown
[Fades in over 1.5 s]{#slow x=-3.5 y=-0.4 step=1 run_time=1.5}
[Starts 0.5 s later]{#later below:#slow left-aligned:#slow step=1 lag=0.5}
```

## Entrance and exit styles

`enter=` and `exit=` on an element (or on `show`/`hide` directives) replace the default fades:

| `enter=` | `exit=` |
| --- | --- |
| `fade` (default), `grow`, `write`, `create`, `draw` | `fade` (default), `shrink`, `uncreate` |

`write`, `create`, `draw` and `uncreate` suit vector content (formulas and shapes).

## Automatic advancement

`[[next: step=N]]` advances to the following stop automatically once step N (and the child
visits it triggers) has finished; `step=0` marks the slide's entry. Chains of `next` play without
clicks; backward and outline jumps show the recorded states without starting playback.

## Skipping the next event

`[[skip_next: step=N]]` omits exactly one following event: a fragment step, a child visit (with
its whole subtree) or the return to the parent, even across numeric gaps. On a child's last step
it suppresses the zoom back to the parent, which is also what `skip_return` on the include
does more declaratively.

## Animated images

Images with `play=once` or `play=loop` play when they are revealed: finite ones finish before the
pause, loops become a looping stop that the next click leaves. See [Images](images.html).
