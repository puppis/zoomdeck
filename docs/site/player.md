---
title: The player
description: Keyboard and pointer controls, the pen and its pressure styles, the whiteboard, a companion tablet, the camera, recording a talk and exporting it as a video, printing the deck to a PDF, spotlight and laser, reverse playback, deep links, speed and fullscreen.
---

<a class="try" href="guide.html#slide=player">Open in the guide ↗</a>

## Controls

| Default keys | Action |
| --- | --- |
| `→`, Space | next stop (plays its animations) |
| `←` | previous stop, playing the current stop backwards |
| Home | first stop |
| A | replay the current stop (play it again) |
| ⌘Z / Ctrl+Z | undo the last pen or highlighter stroke |
| ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y | redo a stroke |
| Delete, Backspace | clear all strokes on this slide |
| L | switch the pointer tool between spotlight and laser |
| W | show or hide the whiteboard; while it is shown the arrows scroll it |
| C | camera: in a corner, then full frame, then off |
| S | film the screen, for the time spent in another application, or stop |
| R | record the talk (a new one, or continuing a saved one), or stop recording |
| E | open the source line of this stop in the editor (preview server with `--editor`; see [Editors](editors.html#forward-and-inverse-search)) |
| P, ⌘P / Ctrl+P | print the deck to a PDF, one page per stage |
| F | toggle fullscreen; Esc leaves it |
| O | toggle the slide outline |
| , | open the settings |

The footer has four groups: the previous/next buttons with the stop counter; the pen color and
tip and the Whiteboard button; the Camera, Record, Pause and Talk buttons; and, at the right,
Print, Fullscreen and the settings gear. A progress bar runs along its top edge. The header shows
the breadcrumb of the current slide and the player state.

## Settings

The gear button (or the `,` key) opens the settings dialog, in six parts:

- **Pointer**: the tool shown by the pointer gesture (spotlight or laser) and the modifier keys
  of each gesture: the pen, the spotlight/highlighter, click-to-advance and the click that opens
  an element's source in the editor (Alt by default). Each can be "Plain"
  (no key), one of Shift, Control, Alt, ⌘/Win or a pair of them, or "Off"; choosing keys already
  used by another gesture frees them from it.
- **Pen**: how pressure and motion shape a stroke; see [The pen](#the-pen).
- **Recording**: the microphone and camera, where the camera picture sits, and whether the screen
  is filmed while the page is hidden; see
  [Recording a talk](#recording-a-talk).
- **Tablet**: pairing a companion tablet; see [A tablet as a drawing pad](#a-tablet-as-a-drawing-pad).
- **Keyboard**: every action with its keys. Click a key to remove it, or choose "Add key" and press
  the new combination, which may include modifiers; a combination already used elsewhere moves to
  the new action.
- **Advanced**: the playback speed of the animations (0.5× to 2×) and the reverse-playback switch,
  on by default.

Close at the bottom (or the × in the header, or Esc) closes the dialog; the settings are saved as
they are changed.

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

## The camera

The camera is yours to turn on. **Camera** in the footer turns it on in a corner of the slides,
or off again; `C` steps through the three states: in a corner, full frame in place of the slides
or the whiteboard (a way to show a real blackboard, an object or yourself without leaving the
deck), and off. The first step asks the browser for the camera chosen in the settings
(Recording). In the corner the picture is mirrored like a mirror, so that you can see yourself;
the corner, the size and the mirroring are settings. The pen never draws on the camera: strokes
belong to slides and to the whiteboard. A recording keeps the camera exactly while it is on, so
you can record a talk without it even with a camera attached, or bring it in for some moments
only.

## Recording a talk

**Record** in the footer, or `R`, records the talk (a dialog first says what will be kept and where it goes, and offers to continue a saved talk instead of starting a new one): your voice through the microphone, the
camera while it is on (see [The camera](#the-camera); recording never turns it on by itself),
and everything you do on the deck, each on the same clock: the stops you move through and how
(played forwards, backwards or jumped to), every pen and highlighter stroke as it is drawn, undo
and clear, the whiteboard with its scrolling, the laser or spotlight while it is shown, the
playback speed and the camera switches. The slides themselves are not filmed. A recording is
therefore a few files: the sound or video from the microphone and camera (WebM, or MP4 in Safari;
a further file each time the camera is turned on or off, since a picture cannot join a file
being written, and when the talk is continued after a stop), and a small *timeline* of what happened,
naming each stop by its slide and step. It plays back on the deck itself, as sharp as the live
deck at any window size, and survives edits to the deck that leave its slides in place; the
player warns when the deck changed since the talk was recorded.

The header shows the running time while recording. **Pause** stops both the microphone and the
clock, and resuming leaves the gap out of the talk. **Stop** saves the recording in a
`recordings/` folder next to the deck when the deck is served by `zoomdeck serve` or the
development page; otherwise the two files are offered as downloads, to put in such a folder by
hand. When `ffmpeg` is installed, the server also rewrites the media file so that it carries its
duration and can be seeked in any player. The recording is named after the date and time,
`talk-2026-11-13-1030`.

**Filming the screen.** A talk may leave the deck for a while: a demonstration in another
application, a terminal, a web page. **Screen** in the footer, or `S`, asks the browser which
screen or window to share and films it, in place of the camera, until you press it again or stop
the share from the browser's own bar; choose the entire screen to follow yourself across
applications. With "Film the screen while this page is hidden" in the settings, a recording asks
for the screen when it starts and films it by itself whenever the page is hidden, as when you
switch to another application, and goes back to the deck when you return; the switch still works
at any time. A filmed stretch is a further media file of the talk; in playback and in the exported
video it fills the frame, whole, and the deck stands still meanwhile. Your voice goes on through
the microphone, while the sound of other applications is not captured. The browser needs the
system's permission to record the screen (macOS asks once), and screen files are larger than
camera files, about twenty megabytes a minute.

**Continuing a talk.** A stopped recording can be taken up again later, even after closing the
browser: the Record dialog offers every saved talk to continue, and so does the **Continue**
button in the list of talks. What follows is stamped after the end of the earlier part, with a cut
marking the seam, and is kept as a further media file of the same recording (`talk.part2.webm`,
since a browser cannot append to a finished file); playback and the export run through the
parts as one talk. The header counts from where the talk stood. Stop and Continue therefore
also serve as a pause that outlives the page, and the deck may be edited in between, as long as
the slides already visited stay.

Choose the devices first, in the settings under **Recording**: "Detect devices" asks the browser
once for the microphone and camera, after which both lists show the devices by name ("None" for
the camera leaves it out altogether). "Test the
devices" opens the chosen ones as a recording would and shows what they capture: the camera
picture, and a bar that follows the sound level as you speak; "Hear a 3-second sample" records
three seconds from the microphone and plays them back, so you hear what the recording will keep.
Changing a device while the test runs switches to it, and the test ends when the dialog closes.
The same section sets the corner (bottom right by default) and the size of the camera picture,
which is where it appears while you present and in the exported video, and whether your own
picture is mirrored while presenting (the recording is never mirrored).

**Playing a recording.** When the deck's folder holds recordings, the footer shows **Talk** (with
their number when there are several); it opens the recording, or a list to choose from, with a
Delete button where the server can remove files. The same list opens from **Talks…** in the
playback bar, so one recording can be continued or deleted as well. During playback the deck follows the recording:
stops play as they did, strokes appear as they were drawn, the whiteboard and the camera switch
when they did, and the laser or spotlight moves where the presenter pointed. A bar over the
slides has play and pause (also Space), a scrubber (also `←` and `→`, five seconds at a time),
the time, **Export video** and a way out (also Esc); seeking anywhere rebuilds the state at that
moment. The recording's own sound plays, and its camera picture sits in the corner it was
recorded with, or full frame where the presenter switched to it. Your keys and clicks on the deck
are off until you leave the recording.

**Exporting a video.** Export video renders the open recording as a video file: the slides or the
whiteboard with their ink, the camera in its corner or full frame, the pointer, and the recorded
sound, at 1920 pixels wide in the deck's proportions. A dialog first asks for the file's name
and where it goes: the `recordings/` folder next to the deck (with the preview server), a folder
of your choice through the browser's own save dialog (Chrome and Edge), or the browser's
downloads. The recording plays from the start while
the frames are captured, so the export takes exactly as long as the talk, and the window must
stay visible meanwhile (a hidden tab draws nothing). The result is a WebM file (VP9 and Opus),
saved as `recordings/<name>.video.webm` next to the recording or downloaded; `ffmpeg -i
talk.video.webm -c:v libx264 -c:a aac talk.mp4` turns it into an MP4 when a tool or a site wants
one. The timeline is independent of the clock that produced it, so a later version can render the
same recording off line, faster than real time.

**What travels where.** The folder export (`zoomdeck build … -o folder`) copies the `recordings/`
folder, so a deck published that way shows its Talk button to viewers; the single-file export
leaves recordings out, since a talk's media would not fit in a page. Playback needs a browser that
can play the recorded file: a WebM from Chrome or Firefox plays in those two, an MP4 from Safari
plays everywhere.

## Printing to PDF

**Print** in the footer (or P, also ⌘P / Ctrl+P) writes the deck as a PDF file, one page
per stage: every stop the presentation passes through, in order, as the screen shows it at that
stop, with the camera where it rests. Returns to a parent slide after its children, which show
nothing new, and stops the presentation runs straight through (automatic advancement, as before
a looping movie), seen only as the start of the next, are left out. The dialog offers two choices:

- **Pages**: every stage, or only the last stage of each slide, which makes a handout without the
  intermediate steps. The page counts are shown next to each choice.
- **Resolution**: the width of each page picture, 1920, 2560 or 3840 pixels; the height follows
  the deck's proportions. A 16:9 deck prints on a 960 × 540 pt page (the size of a widescreen
  slide), so 2560 pixels are about 190 dpi and 3840 about 290 dpi.

The pages are drawn by the deck's own renderer at the chosen resolution, with the text
rasterized at that density, so they are as sharp as the screen at rest, and stored losslessly
(deflated, as PDF readers decode natively; a browser that cannot deflate gets fine JPEG pages
instead). Formulas, shapes, images and code look as they do on screen; pen strokes, highlights,
the whiteboard, the spotlight and the camera picture are not part of a page, and an embedded
page (`iframe:`) prints as its frame with its poster or caption. The slide tree becomes the
bookmarks of the file, so a PDF reader's outline lists the slides.

A stop whose animation leaves the picture as it was (an indication, a flash, a full turn along a path) prints as a page that looks like the one before it: it is a stage all the same.

While the pages are made the deck leafs through its stops in the window, at the pace of the
renderer (a page takes a fraction of a second; a long deck at 4K, a minute or two); closing the
dialog cancels, and the deck comes back to the stop you were at either way. The file is
downloaded by the browser, named after the deck's title. Printing is not available while a talk
is recorded or played back.

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
