---
title: The desktop app
description: Zoomdeck as a program of its own for macOS, Linux and Windows: the same player and preview server in a window, with menus, native dialogs and the command's flags.
---

Zoomdeck also comes as a desktop program. It is the same player and the same preview server as
`zoomdeck serve`, started inside the app and shown in a window of its own, so a deck behaves
exactly as it does in the browser: the outline, the pen, the whiteboard, the tablet pairing,
recording a talk, the screen, printing and the exports all work, and so do the command's flags.
The app brings what a program is expected to have: a double-clickable icon with no Node.js to
install, decks opened from a menu or from the system, recent decks, and the system's own
permission prompts for the camera and the microphone. It renders through the same engine as
Chrome, so it is as fast as Chrome and the same on every system, not faster.

## Installing

Download the installer for your system from the
[releases](https://github.com/puppis/zoomdeck/releases) of the repository: a `.dmg` (or `.zip`)
for macOS, an `.AppImage` or `.deb` for Linux, an installer or a portable `.exe` for Windows.
The builds are not signed by a registered developer, so the systems warn once:

- **macOS**: the first time, the system says that it cannot verify the developer. Up to Sonoma,
  right-click the app and choose Open, then confirm; on Sequoia and later, open System Settings
  ▸ Privacy & Security and choose Open Anyway under the message, then confirm. Afterwards it opens
  normally. (The same from a terminal: `xattr -d com.apple.quarantine /Applications/Zoomdeck.app`.)
  The first recording asks for the microphone and the camera; filming the screen asks for Screen
  Recording in System Settings, and the app must be started again after granting it.
- **Windows**: SmartScreen shows "Windows protected your PC"; choose More info, then Run anyway.
- **Linux**: make the AppImage executable (`chmod +x`) and run it, or install the `.deb`.

## Using it

Open a deck with **File ▸ Open Deck…** (`deck.json`, a Markdown file or a slide module), from
**Open Recent**, or by passing it on the command line; without a deck the app opens the last
one, or the guide. The window shows the deck as the browser would, and the menus add Reload
Deck, Reveal Deck Folder, full screen, zoom and the developer tools. Links to other pages open
in your browser.

The command line takes the preview's flags:

```bash
# macOS
/Applications/Zoomdeck.app/Contents/MacOS/Zoomdeck path/to/deck.json --host --editor code
# Linux
./Zoomdeck.AppImage path/to/deck.json --port 8000
# Windows
Zoomdeck.exe path\to\deck.json --watch path\to\parts
```

`--host` also listens on the network, so a tablet can pair from the player's settings; `--port`
insists on a port (otherwise the app takes a free one, so it never collides with a preview started
from a terminal); `--editor` names the editor that `E` and Alt + click open source lines with;
`--watch` adds folders whose changes reload the deck; `--scene` picks a named export of a module.
The server's address is in the Help menu and on the terminal, and `zoomdeck jump` from an editor
reaches it like any preview.

**Filming the screen** uses the system's own picker on macOS 15 and later; elsewhere the app films
the screen the window is on, whole.

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
