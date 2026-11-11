---
title: Editors
description: Edit a deck and see it in the browser as you type, or export it with a shortcut; ready-made setups for VS Code, Sublime Text, Emacs, Vim/Neovim and JetBrains IDEs, with syntax highlighting.
---

## The loop

Zoomdeck's preview server does the heavy lifting: start it once on a deck and it opens the
browser, watches the deck folder, reloads the page whenever a file is saved and puts the player
back at the stop you were looking at. Editing therefore needs only two things from an editor:

1. **Save without thinking about it.** Every setup below saves the deck after a second of idle
   typing (or when the editor loses focus), so the browser follows you.
2. **Two shortcuts.** One starts the preview server for the deck of the current file, the other
   exports it as a single HTML file into a `build/` folder next to it. The command itself picks up
   the `deck.json` that names the file, so the deck's title, styles, macros and slide classes
   apply whichever file is open.

```bash
zoomdeck serve path/to/slides.md            # or deck.json; opens http://localhost:5173/
zoomdeck build path/to/deck.json -o build --one-file
```

## The `zoomdeck` command

All configurations call a `zoomdeck` command. It exists once you have run `npm link` inside the
Zoomdeck checkout (after `npm install`, on Node 20.19+ or 22.12+), as described under
[Installing the command](getting-started.html#installing-the-zoomdeck-command); `zoomdeck --help`
in a terminal confirms it. Inside a project that lists `zoomdeck` as a dependency, `npx zoomdeck`
works as well.

If an editor reports **`zoomdeck: command not found`** although the terminal finds it, the editor
was started from the Dock, the Start menu or a launcher and did not read your shell profile, so
npm's global `bin` directory (or nvm's, or Homebrew's) is missing from its `PATH`. The Sublime
Text package below reads the `PATH` of your login shell for that reason; VS Code's tasks run
in its integrated terminal, which loads the profile; JetBrains IDEs and Vim's terminal inherit
it too. For the remaining cases, start the editor from a terminal once, or put the full path of
the command (`which zoomdeck`) into the configuration: each one names the command in a single
place (`zoomdeck-command` in Emacs, `g:zoomdeck_command` in Vim, the task or tool definition in
VS Code and JetBrains, the `shell_cmd` lines in Sublime Text). `node /path/to/Zoomdeck/bin/zoomdeck.mjs`
is an equivalent that needs no link, as long as `node` itself is on that `PATH`.

The configurations live in the repository under `editors/`. Highlighting adds, on top of the
editor's Markdown, the slide and styles containers, the `[[directive: …]]` lines, `#id`s,
`.classes`, `key=value` attributes, quoted strings and numbers. Errors in a deck appear in the
browser with their line number (and file, for imported files), so the browser window doubles as
the editor's problems panel.

**If the browser opens on a page that refuses to connect**, read the build panel or terminal:
the server prints the address it actually listens on, `http://127.0.0.1:8000/` or the next free
port when a previous preview still holds 8000. Stopping that previous preview (Tools ▸ Cancel
Build in Sublime Text, closing the task terminal in VS Code, `C-c C-k` in Emacs, closing the
terminal split in Vim, the stop button of the tool window in JetBrains) frees the port; a server
also stops on its own when the program that started it ends.

## Visual Studio Code

| What | Where |
| --- | --- |
| Highlighting | `editors/vscode/zoomdeck-markup/`: copy the folder into `~/.vscode/extensions/` and reload the window; it injects the dialect into Markdown files |
| Tasks | `editors/vscode/tasks.json`: copy to `.vscode/tasks.json` in the deck's workspace |
| Shortcuts | `editors/vscode/keybindings.json`: paste its entries into your `keybindings.json` (Command Palette ▸ "Open Keyboard Shortcuts (JSON)") |
| Autosave | `editors/vscode/settings.json`: `files.autoSave: afterDelay` with a 600 ms delay |

Then, with the deck open: **Ctrl+Alt+P** (⌘⌥P on macOS) starts the preview in a dedicated
terminal, **Ctrl+Alt+B** (⌘⌥B) exports `build/index.html` next to the file. The build task is
also the default build task, so Ctrl+Shift+B works as well. Stop the preview by closing its
terminal.

## Sublime Text

Copy `editors/sublime/Zoomdeck/` to `Packages/Zoomdeck` (Preferences ▸ Browse Packages… opens the
folder). It provides:

- **Zoomdeck Markdown**, a syntax that extends Markdown (Sublime Text 4); files whose first line
  opens a slide or styles block select it automatically, others through View ▸ Syntax.
- A build system with three variants: **Ctrl+Alt+B** exports one HTML file (also Ctrl+B / ⌘B,
  since Zoomdeck is the build system of Markdown files), **Ctrl+Alt+P** starts the preview in the
  build panel (Tools ▸ Cancel Build stops it), and "Build folder" writes the static folder
  export.
- Command Palette entries ("Zoomdeck: Preview deck", "Build HTML file", "Build static folder").
- `save_on_focus_lost`, so switching to the browser saves the deck first. For saving while you
  type, add a plugin such as *auto-save* from Package Control.

The build system's target is `zoomdeck_exec`, a small plugin in the package: it asks your login
shell (the one in `$SHELL`) for its `PATH` once and runs the command with it, so `zoomdeck` is
found even when Sublime Text was launched from the Dock, a launcher or a menu, which otherwise
gives it the bare system `PATH`. If the command still is not found, check that a terminal finds it
(`which zoomdeck`), run "Zoomdeck: Re-read the shell PATH" from the Command Palette after
installing it, or write its absolute path (or `node /path/to/Zoomdeck/bin/zoomdeck.mjs`) into the
`command` setting of `Packages/User/Zoomdeck.sublime-settings`. The Sublime console (View ▸ Show
Console) prints what the plugin found. Tools ▸ Cancel Build stops the preview server.

## Emacs

```elisp
(add-to-list 'load-path "/path/to/Zoomdeck/editors/emacs")
(require 'zoomdeck)
```

`zoomdeck-mode` derives from `markdown-mode` when it is installed (otherwise from `text-mode`),
highlights the dialect and is chosen automatically for files that open with `::: slide` or
`::: styles`. Its keys: **C-c C-p** serves the deck in a `*zoomdeck preview*` compilation buffer,
**C-c C-b** exports one HTML file, **C-c C-k** stops the server. `zoomdeck-autosave-mode` (on by
default) saves the deck after one idle second; `zoomdeck-command`, `zoomdeck-build-directory`,
`zoomdeck-autosave` and `zoomdeck-autosave-delay` are customizable. A graphical Emacs started
from the Dock may not see the shell's `PATH`: either install the `exec-path-from-shell` package,
or set `zoomdeck-command` to the full path that `which zoomdeck` prints.

## Vim and Neovim

Copy `editors/vim/plugin/` and `editors/vim/after/` into `~/.vim/` or `~/.config/nvim/`, or hand
`Zoomdeck/editors/vim` to your plugin manager. Markdown buffers whose first lines open a slide or
styles block get the mappings **\<leader\>zp** (`:ZoomdeckPreview`, in a terminal split) and
**\<leader\>zb** (`:ZoomdeckBuild`), are saved after `updatetime` idle milliseconds (lowered to
one second), and highlight the dialect through `after/syntax/markdown.vim`. `g:zoomdeck_command`
names the command and `g:zoomdeck_autosave = 0` turns the idle save off.

## JetBrains IDEs

Copy `editors/jetbrains/External Tools.xml` to `<configuration directory>/tools/External
Tools.xml` and restart the IDE (WebStorm, IntelliJ IDEA, PyCharm and the others share the
format). Two tools appear under Tools ▸ External Tools ▸ Zoomdeck, **Preview** and **Build
HTML**, each acting on the current file; assign them keys under Settings ▸ Keymap ▸ External
Tools. JetBrains IDEs save files automatically when they lose focus and after idle time
(Settings ▸ Appearance & Behavior ▸ System Settings ▸ Autosave). For highlighting, install the
TextMate Bundles plugin and add `editors/vscode/zoomdeck-markup` as a bundle.

## Any other editor

The ingredients are the same everywhere: a command that runs `zoomdeck serve <file>` and one
that runs `zoomdeck build <file> -o build --one-file` from the file's directory, an autosave
after a short idle delay, and Markdown highlighting. The VS Code grammar is a plain TextMate
grammar that most editors can load, and the browser reports mistakes with their line number.
