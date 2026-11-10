---
title: The player
description: Keyboard and pointer controls, outline, reverse playback, deep links, pen and spotlight, speed and fullscreen.
---

<a class="try" href="guide.html#slide=player">Open in the guide ↗</a>

## Controls

| Default keys | Action |
| --- | --- |
| `→`, Space | next stop (plays its animations) |
| `←` | previous stop, playing the current stop backwards |
| Home | first stop |
| R | replay the current stop |
| ⌘Z / Ctrl+Z | undo the last pen or highlighter stroke |
| ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y | redo a stroke |
| Delete, Backspace | clear all strokes on this slide |
| F | toggle fullscreen; Esc leaves it |
| O | toggle the slide outline |
| , | open the settings |

The footer has previous/next buttons, a progress bar, the pen settings, the speed control
(0.5× to 2×), the settings gear and the fullscreen button. The header shows the breadcrumb of the
current slide and the player state.

## Settings

The gear button (or the `,` key) opens the settings dialog. It lists every action with its keys:
click a key to remove it, or choose "Add key" and press the new combination, which may include
modifiers; a combination already used elsewhere moves to the new action. "Restore default
bindings" undoes all changes. The dialog also holds the reverse-playback switch and a reference
of the pointer gestures. Settings are stored in the browser and apply to every deck you open there.

## Pointer tools

- Hold **Shift** for a spotlight that follows the pointer; Shift + scroll resizes it.
- **Shift + drag** draws a highlighter stroke, **Control + drag** draws with the pen; color and
  tip size are in the footer. Strokes belong to the current slide and clear when the slide changes;
  undo, redo and clear act on the current slide's strokes.

## Reverse playback

Going back plays the stop's animations in reverse: fades, property animations, effects, morphs and
camera moves retrace their path, including zooming back into a child you just left. Videos, loops
and updater-driven waits cannot run backwards and are passed over. Pressing `←` again during a
reverse settles it and steps back once more, so quick presses step through stops.
`"presenter": { "reversePlayback": false }` restores instant jumps.

## Outline and deep links

The outline lists every slide; clicking one jumps to its first stop. The address bar follows the
current stop as `#step=N`, which can be shared or bookmarked; `#slide=id` opens the first stop of a
slide by its markup ID (or a slide by name).

## Loops and automatic advancement

Looping stops (`play=loop`, `stop({ loop: true })`) repeat until the next click. Stops marked with
`next` or `autoNext` advance by themselves once played; backward moves never trigger them.

## Editing preview

`zoomdeck serve` and the dev page reload when the deck's files change and return to the
slide and step you were on, using a bookmark saved just before the reload. Parse and reference
errors are shown with the offending line.

## Static exports

A deck can be exported as a static folder or as one self-contained HTML file that opens from
disk; both keep the complete player, including settings and deep links. See
[Exporting a deck](exporting.html).
