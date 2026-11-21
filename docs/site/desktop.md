---
title: The desktop app
description: ZoomDown as a program of its own for macOS, Linux and Windows: the same player and preview server in a window, with menus, native dialogs and the command's flags.
---

ZoomDown also comes as a desktop program. It is the same player and the same preview server as
`zoomdown serve`, started inside the app and shown in a window of its own, so a deck behaves
exactly as it does in the browser: the outline, the pen, the whiteboard, the tablet pairing,
recording a talk, the screen, printing and the exports all work, and so do the command's flags.
The app brings what a program is expected to have: a double-clickable icon with no Node.js to
install, decks opened from a menu or from the system, recent decks, and the system's own
permission prompts for the camera and the microphone. It renders through the same engine as
Chrome, so a deck looks and runs exactly as it does there, on every system; it is not faster.

## Installing

Download the installer for your system from the
[releases](https://github.com/puppis/zoomdown/releases) of the repository: a `.dmg` (or `.zip`)
for macOS, an `.AppImage` or `.deb` for Linux, an installer or a portable `.exe` for Windows.
The builds are not signed by a registered developer, so the systems warn once:

- **macOS**: the first time, the system says that it cannot verify the developer. Up to Sonoma,
  right-click the app and choose Open, then confirm; on Sequoia and later, open System Settings
  ▸ Privacy & Security and choose Open Anyway under the message, then confirm. Afterwards it opens
  normally. (The same from a terminal: `xattr -d com.apple.quarantine /Applications/ZoomDown.app`.)
  The first recording asks for the microphone and the camera; filming the screen asks for Screen
  Recording in System Settings, and the app must be started again after granting it.
- **Windows**: SmartScreen shows "Windows protected your PC"; choose More info, then Run anyway.
- **Linux**: make the AppImage executable (`chmod +x`) and run it, or install the `.deb`.

## Updates

Once a deck is open, the app asks GitHub whether a newer release is out (nothing runs between
two starts of the app). When there is one, it tells you which, with **Release Notes** to read
what changed, and offers to download it. The download (about 200 MB) takes a couple of minutes
and runs in the background, its progress on the Dock or taskbar icon and in the menu, while you
keep using the deck. Once it is ready, the app asks again: **Install and Restart** quits ZoomDown,
puts the new version in place and starts it again with the same deck; **Later** keeps the
download, and the next start offers it again. **Skip This Version** stops the offers until a
newer one; **Check for Updates…** (in the ZoomDown menu on macOS, in Help elsewhere) looks at any
time. The app offers an update by itself only while a deck is shown, so never over the dialog
that asks for a deck, and a prompt never interrupts a deck presented full screen or another of
the app's dialogs: it waits until you leave full screen or close the dialog. Installing, too,
waits for the app's dialogs to be closed, since one left open would keep the app from quitting.
Every download is checked against the digest GitHub publishes for it.

How the new version is put in place depends on how the app was installed:

- **macOS**: an app in Applications (or any folder you can write to) replaces itself. An app run
  from the disk image, or from Downloads without being moved, cannot: the new disk image is
  downloaded to your Downloads folder and opened, for you to drag ZoomDown to Applications. As the
  builds are not signed by a registered developer, macOS may ask again for the camera, the
  microphone and Screen Recording after an update.
- **Windows**: the installed app runs the new installer silently over the old version, which
  takes a minute or so without a window, and starts again. The portable `.exe` cannot replace
  itself while it runs: the new one is downloaded to your Downloads folder.
- **Linux**: an AppImage in a folder you can write to is replaced by the new one (renamed when its
  name carries the version). For the `.deb`, the new package is downloaded to your Downloads
  folder and opened with the system's software installer, which asks for your password.

Updates come from the releases of the repository, also for an app you built yourself; run from a
checkout (`npm run desktop`), the app does not look for them.

## Using it

Started from a deck (double-clicked or dropped on the app, or passed on the command line) the
app presents it at once. Started bare, it asks for a deck (a `.zd` file, a PDF, a slide
module or a [Slajdomat presentation](documents.html#a-slajdomat-presentation) by its `index.html`; a deck kept as `.md`
opens too), in the folder you used last; the very first time it offers instead to copy the tour
deck, with its examples, to a folder of yours, and opens the copy's `slides.zd`.
**File ▸ Copy the Tour Deck…** does the same later, into a `zoomdown-tour` folder inside the one
you choose; a copy already
there is opened as it is, or its files written afresh while the talks recorded in it stay. The
tour inside the app is only the source of these copies. The window shows the deck as the browser
would, and the menus add Open Deck, Open Recent, Reload Deck, Reveal Deck Folder, full screen, zoom
and the developer tools. Links to other pages open in your browser. Recordings and exported videos
go to a `recordings/` folder next to the deck, as with `zoomdown serve`; **Reveal Deck Folder**
opens the folder that holds it, which is where a talk's bundle (`.zip`, its media files and
timeline) and its rendered video (`.mp4`) can be picked up. When the computer has `ffmpeg` (on
the PATH, in Homebrew's or `/usr/local/bin`, or named by `ZOOMDOWN_FFMPEG`), the app renders
each talk as an MP4 video by itself after the recording stops, in a hidden window, and takes up
again any render that quitting interrupted; see [Rendering a video](player.html#recording-a-talk).

The command line takes the preview's flags:

```bash
# macOS
/Applications/ZoomDown.app/Contents/MacOS/ZoomDown path/to/slides.zd --editor code
# Linux
./ZoomDown.AppImage path/to/slides.zd --port 8000
# Windows
ZoomDown.exe path\to\slides.zd --watch path\to\parts
```

The app listens on the network, so a [tablet](player.html#a-tablet-as-a-drawing-pad) can pair
from the player's settings without any flag; `--local` keeps it to this computer. It takes port
8765 when that is free, so a trusted tablet finds the deck again at the same address, and the
next free port otherwise; `--port` insists on one. The first time, macOS may ask whether ZoomDown
may accept incoming connections: answer Allow for the tablet to reach it. `--editor` names the editor that `E` and Alt + click open source lines with;
`--watch` adds folders whose changes reload the deck; `--scene` picks a named export of a module.
The server's address is in the Help menu and on the terminal, and `zoomdown jump` from an editor
reaches it like any preview.

**Filming the screen** uses the system's own picker on macOS 15 and later; elsewhere the app films
the screen the window is on, whole. The computer's sound comes with it as a loopback of the
output where the platform allows it (Windows, and macOS 13 and later), without a virtual audio
device; where it does not, the share carries the picture alone.

## Opening decks from the system

Decks have the extension `.zd`, and installing the app makes it the program that opens them, so a
double-click on a deck in the Finder, the Explorer or the file manager presents it:

- **macOS**: the app declares the type "ZoomDown deck" (`.zd`, a kind of plain text, so Quick
  Look shows the markup) and opens it by default once it is in Applications; the Finder may need
  a moment, or a first start of the app, to notice. To use another program for a deck, choose
  File ▸ Get Info ▸ Open with.
- **Windows**: the installer (`ZoomDown Setup …exe`) registers `.zd` files; the portable `.exe`
  registers nothing, so choose it once with Open with ▸ Choose another app and "Always use this
  app".
- **Linux**: the `.deb` package adds the type `text/x-zoomdown` for `*.zd` and lists the app for
  it; the AppImage registers nothing by itself (a tool such as AppImageLauncher, or the file
  manager's Open With dialog, sets it up).

A deck written before `.zd`, as `slides.md`, opens from the app's File menu, by dropping it on
the app or from the command line; the system keeps opening `.md` files with your usual
Markdown program. Renaming the deck to `.zd` (its imported parts may keep their names) makes the
double-click work for it too.

## Building it yourself

The app lives in `desktop/` of the repository and is packaged with electron-builder:

```bash
npm install
npm run desktop                 # run the app from the checkout (pass a deck after --)
npm run desktop:dir             # an unpacked build in release/, for a quick check
npm run desktop:build           # the installers for this system, in release/
```

Each system builds its own installers: run `npm run desktop:build` on a Mac for the macOS ones,
on Linux for the AppImage and the `.deb`, on Windows for the installer and the portable program.
The repository's **Desktop app** workflow does the three at once: it runs when a version tag
(`v1.2.3`) is pushed, builds on macOS, Linux and Windows runners and attaches the installers to
the GitHub release of that tag; a manual run of the workflow keeps them as artifacts instead.
