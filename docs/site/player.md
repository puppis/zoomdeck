---
title: The player
description: Keyboard and pointer controls, the pen and its pressure styles, the whiteboard, a companion tablet, spotlight and laser, reverse playback, deep links, speed and fullscreen.
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
| L | switch the pointer tool between spotlight and laser |
| W | show or hide the whiteboard; while it is shown the arrows scroll it |
| E | open the source line of this stop in the editor (preview server with `--editor`; see [Editors](editors.html#forward-and-inverse-search)) |
| F | toggle fullscreen; Esc leaves it |
| O | toggle the slide outline |
| , | open the settings |

The footer has previous/next buttons, a progress bar, the pen settings, the speed control
(0.5× to 2×), the settings gear and the fullscreen button. The header shows the breadcrumb of the
current slide and the player state.

## Settings

The gear button (or the `,` key) opens the settings dialog, in five parts:

- **Pointer**: the tool shown by the pointer gesture (spotlight or laser) and the modifier keys
  of each gesture: the pen, the spotlight/highlighter, click-to-advance and the click that opens
  an element's source in the editor (Alt by default). Each can be "Plain"
  (no key), one of Shift, Control, Alt, ⌘/Win or a pair of them, or "Off"; choosing keys already
  used by another gesture frees them from it.
- **Pen**: how pressure and motion shape a stroke; see [The pen](#the-pen).
- **Tablet**: pairing a companion tablet; see [A tablet as a drawing pad](#a-tablet-as-a-drawing-pad).
- **Keyboard**: every action with its keys. Click a key to remove it, or choose "Add key" and press
  the new combination, which may include modifiers; a combination already used elsewhere moves to
  the new action.
- **Advanced**: the reverse-playback switch, on by default.

"Restore default gestures", "Restore the default pen" and "Restore default keys" undo the changes
of their section. Settings are stored in the browser and apply to every deck you open there.

## Pointer tools

With the default gestures:

- **Drag** draws with the pen; a click leaves a dot. Color and tip size are in the footer, where
  "Default" is the deck's text color.
- Hold **Shift** for a spotlight that follows the pointer, or a red laser dot: the `L` key (or the
  Pointer setting) switches between the two. Shift + scroll resizes either; **Shift + drag** draws a
  highlighter stroke.
- A click never moves between stops unless you ask for it: the "Click: next stop" gesture is
  off by default, and binding it to a key (for example Alt) in the settings makes that key +
  click behave like the `→` key.

- **Alt + click** an element to open its source line in your editor, when the deck is served by
  `zoomdeck serve --editor …` (the element nearest to the pointer counts, a text inside a tile
  before the tile); the `E` key opens the line of the current stop. See
  [Editors](editors.html#forward-and-inverse-search).
- **Double-click** a link that points inside the deck (`#slide=`, `#step=`) to follow it; a single
  click over such a link draws, since it often covers a whole tile. Links to pages outside the deck
  open on a single click.

Strokes belong to the current slide and clear when the slide changes; undo, redo and clear act on
the current slide's strokes (or on the whiteboard's while it is shown). Links and live pages keep
working under a plain pen: clicking one opens it rather than drawing, with no highlight while the
pointer rests on it. On a touch screen a finger never draws, so a resting palm leaves no marks;
drawing takes a pen, a stylus or the mouse. A **fingertip rubbed over a stroke erases it**, and
undo brings it back where it was; two fingers scroll the whiteboard. The colors in the footer are
swatches, the first being the deck's own text color.

## The pen

A stroke is a path of samples with pressure, drawn as a filled shape whose width varies along it,
the way drawing applications render ink. A pen with a pressure sensor (Apple Pencil, a Wacom
tablet, a pen-enabled laptop) shapes the line as you press; with a mouse or a basic stylus the width
follows the speed of the hand instead, so a quick flick ends thin. Samples are taken from the
browser's raw pointer stream, before the frame is painted, which keeps the line close to the tip.

The **Pen** section of the settings holds the look:

| Setting | Effect |
| --- | --- |
| Preset | Ballpoint (light pressure effect), Fountain pen (strong, tapered), Marker (constant width), Brush (strongest); moving a slider makes it Custom |
| Pencil width | width of a pencil stroke relative to the tip size, 0.2 to 1.5 (0.6 by default: a pencil draws finer than a mouse at the same tip); mouse strokes are not affected |
| Pencil pressure | how much a real pressure sensor counts, 0.2 to 1.5 (0.6 by default, so a pencil draws about as light as a mouse); mouse strokes are not affected |
| Pressure effect | how much pressure widens the line, from -1 (harder is thinner) to 1 |
| Smoothing | softening of the outline |
| Steadying | how far the line lags behind the hand, which irons out jitter |
| Taper the ends | thin the stroke in and out |
| Vary the width with speed | pressure simulated from speed when the device reports none |

Pencil strokes use half the steadying, since a pressure pen reports dense and precise positions,
the line is extended with the browser's prediction of the pen's next positions so it stays under
the tip, and fast strokes are drawn along a smooth curve through the samples, so quick handwriting
keeps round curves. Changing a setting redraws the strokes already on screen, so you can tune the look
against a line you just drew. Color and tip size stay in the footer; the tip size is the width at medium pressure.
The highlighter always has a constant width.

## The whiteboard

`W` (or the Whiteboard button in the footer) covers the slides with a blank page in the deck's
background color, dotted to show where it scrolls. Draw on it as on a slide. It is a single page
without edges: the **arrow keys** glide the view by a quarter of its width or height, the **mouse
wheel** or a **two-finger scroll** on a trackpad moves it directly, and on a touch screen two
fingers drag it. Space still moves the presentation underneath, so `W` again returns to the slides
where you left them.

The whiteboard keeps its content while you move through the deck, and its undo, redo and clear are
its own: nothing done there touches the strokes on slides. Its content lasts until the page is
reloaded.

## A tablet as a drawing pad

A tablet on the same network can show the current slide and let you draw on it with a pencil,
mirroring the strokes on the presenting screen as they are drawn, in both directions. The tablet
runs none of the engine: it shows a picture of the presenting screen's view, which the presenter
sends again whenever a stop settles or the window is resized, and draws the strokes itself as
vector ink on top. The page therefore loads at once on any tablet, answers the pencil
immediately, and accepts no gesture other than drawing: a pencil or a finger never selects,
scrolls or zooms anything.

1. Serve the deck so that other devices can reach it: `zoomdeck serve deck.json --host`, or
   `npm run dev -- --host` from the checkout. Pairing needs this server; an exported HTML file
   opened from disk cannot pair.
2. On the presenting computer, open the settings and, under **Tablet**, choose "Show the pairing
   code". A QR code and an address appear.
3. Scan the code with the tablet (or type the address): the pad page opens there, with the
   current slide and a toolbar for the tool (pen or highlighter), color swatches, tip size, undo,
   redo, clear and the whiteboard, and nothing else. A fingertip erases the stroke it touches. Adding it to the home screen gives it the whole
   screen.

**Over a cable.** The pairing needs a network between the two devices, not necessarily Wi-Fi. On
a Mac, plug the iPad in, open System Settings → General → Sharing → Internet Sharing, share your
connection "from" the interface you use (Wi-Fi) "to" iPad USB, and turn it on; the computer gets an
address on the cable (192.168.2.1 as a rule), the pairing panel shows a code for it next to the
Wi-Fi one, and the tablet scans that one. The cable link is private and steadier than a crowded
Wi-Fi. An iPad with a cellular plan can also share its own connection to the computer over USB
(Personal Hotspot), which works the same way.

The pad follows the presentation and cannot move it, so a stray touch never changes the slide.
Strokes, undo, redo, clear, and the whiteboard with its scrolling are shared both ways; each
page draws the shared strokes with its own pen style, so the presenting screen always shows them
in the style chosen there. An Apple Pencil hovering over the tablet
shows as a red dot on the presenting screen. A graphics tablet without a screen (a Wacom) needs no
pairing: plugged into the computer, it drives the pointer and draws with pressure directly.

The guide's chapter <a href="guide.html#slide=tablet">Pen, whiteboard and tablet</a> is a test page
for all of this: shapes to trace, a strip for the pressure, a box to write in with the palm resting,
and the checklist to go through once the tablet is paired.

The pad page needs almost no memory, since the deck itself stays on the computer. Opening the
deck itself on a tablet, as a viewer, is also possible when it is small enough: Safari closes a page
that uses too much memory ("A problem repeatedly occurred"), so text is rasterized at the same
base density on every screen and only the lines in view are sharpened to the screen's density.

## Reverse playback

Going back plays the stop's animations in reverse: fades, property animations, effects, morphs and
camera moves retrace their path, including zooming back into a child you just left. Videos, loops
and updater-driven waits cannot run backwards and are passed over. Pressing `←` again during a
reverse settles it and steps back once more, so quick presses step through stops.
`"presenter": { "reversePlayback": false }` restores instant jumps.

## Cuts

`"presenter": { "transition": "cut" }` replaces the view at once when the camera moves between
slides, like turning the pages of a PDF, while fragments and animations inside a slide still
play. `transition=cut` on a slide, include or subslide does the same for that slide alone, and
`transition=zoom` brings the zoom back for one slide of a `cut` deck.

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
errors are shown with the offending line. The editor and the player also follow each other:
`zoomdeck jump <file> <line>` shows the stop of a source line, and `E` or Alt + click opens the
source of a stop or of an element in the editor named by `--editor`; [Editors](editors.html#forward-and-inverse-search)
explains both and the ready-made setups.

## Static exports

A deck can be exported as a static folder or as one self-contained HTML file that opens from
disk; both keep the complete player, including settings and deep links. See
[Exporting a deck](exporting.html).
