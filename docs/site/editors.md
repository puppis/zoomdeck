---
title: Editors
description: Edit a deck and see it in the browser as you type, jump between a source line and its stop in both directions, or export the deck with a shortcut; ready-made setups for VS Code, Sublime Text, Emacs, Vim/Neovim and JetBrains IDEs, with syntax highlighting.
---

## The loop

Zoomdeck's preview server does the heavy lifting: start it once on a deck and it opens the
browser, watches the deck folder, reloads the page whenever a file is saved and puts the player
back at the stop you were looking at. Editing therefore needs only two things from an editor:

1. **Save without thinking about it.** Every setup below saves the deck after a second of idle
   typing (or when the editor loses focus), so the browser follows you.
2. **Three shortcuts.** One starts the preview server for the deck of the current file, one
   shows the stop of the current line in the browser, the third exports the deck as a single
   HTML file into a `build/` folder next to it. The command itself picks up the `deck.json` that
   names the file, so the deck's title, styles, macros and slide classes apply whichever file is
   open.

```bash
zoomdeck serve path/to/slides.md --editor code   # or deck.json; opens http://127.0.0.1:8000/
zoomdeck jump path/to/slides.md 42               # the browser shows the stop of line 42
zoomdeck build path/to/deck.json -o build --one-file
```

## Forward and inverse search

While the preview server runs, the editor and the browser follow each other, as a LaTeX editor
and a PDF viewer do with SyncTeX:

- **Forward search**, editor → browser: `zoomdeck jump <file> <line>` (also `file:line`) moves
  the player to the stop that shows that line. The setups below bind it to a key and save the
  file first, so the browser shows what you see. The stop chosen is the one at which everything
  written up to that line has appeared: a line inside a slide's text goes to the slide, the line
  of an element with `step=3` to its third step, a line after an `[[include: …]]` to the return
  from that child, and a line of an imported file to the slide it belongs to. The command finds
  the server by itself: every preview registers where it runs and which folders it serves, and
  the jump goes to the preview of the file's folder (to every running preview when none matches,
  since a file may be imported from elsewhere).
- **Inverse search**, browser → editor: the **E** key opens the source line of the current stop
  in the editor, and **Alt + click** opens the line of the element under the pointer: the text,
  formula, image, shape or listing you clicked, also inside a child's preview tile, or the
  `[[include: …]]` line when you click a tile's empty area. The modifier is the "Click: open the
  source of the element" gesture of the Pointer settings (Control works too, the context menu is
  suppressed). For this the server must know your editor: `zoomdeck serve … --editor <name>`,
  where the name is `emacs`, `sublime`, `code` (also `codium`, `cursor`), `vim`, `gvim`, `mvim`,
  `textmate`, `zed`, `jetbrains` (the first IDE launcher on the `PATH`) or one of `idea`,
  `webstorm`, `pycharm`, `phpstorm`, `goland`, `clion`, `rubymine`, `rider`, `rustrover`, or any
  command with `{file}` and `{line}` in it, such as `--editor "gedit +{line} {file}"` (quote an
  argument that contains spaces). The environment variable `ZOOMDECK_EDITOR` is the default.
  The setups below pass the right value when they start the preview, so nothing needs
  configuring; the server prints what it will run. Without an editor the player says so in its
  header when you press E.

Both directions work on saved files: after an edit the browser reloads at the same stop, and a
jump sent during the reload is picked up when the page is back.

## The `zoomdeck` command

All configurations call a `zoomdeck` command. It exists once you have run `npm link` inside the
Zoomdeck checkout (after `npm install`, on Node 20.19+ or 22.12+), as described under
[The `zoomdeck` command](getting-started.html#the-zoomdeck-command); `zoomdeck --help`
in a terminal confirms it. Inside a project that lists `zoomdeck` as a dependency, `npx zoomdeck`
works as well.

If an editor reports **`zoomdeck: command not found`** although the terminal finds it, the editor
was started from the Dock, the Start menu or a launcher and did not read your shell profile, so
npm's global `bin` directory (or nvm's, or Homebrew's) is missing from its `PATH`. The Emacs,
Vim and Sublime Text setups below cope with that by themselves: when the command is not on the
editor's path they run the `bin/zoomdeck.mjs` of the checkout they belong to with `node`, or ask
your login shell where the command is. VS Code's tasks run in its integrated terminal, which
loads the profile, and JetBrains IDEs inherit it too. For the remaining cases, start the editor
from a terminal once, or put the full path of the command (`which zoomdeck`) into the
configuration: each one names the command in a single place (`zoomdeck-command` in Emacs,
`g:zoomdeck_command` in Vim, the task or tool definition in VS Code and JetBrains, the
`shell_cmd` lines in Sublime Text). `node /path/to/Zoomdeck/bin/zoomdeck.mjs` is an equivalent
that needs no link, as long as `node` itself is on that `PATH`.

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

Then, with the deck open: **Ctrl+Alt+B** (⌘⌥B on macOS) starts the preview in a dedicated
terminal (B as in browser), **Ctrl+Alt+J** (⌘⌥J) shows the stop of the cursor line in the
browser, **Ctrl+Alt+P** (⌘⌥P) exports `build/index.html` next to the file. In deck files these
bindings take precedence over VS Code's own use of ⌘⌥B / Ctrl+Alt+B (the secondary side bar). The build task is also the default build
task, so Ctrl+Shift+B works as well. Stop the preview by closing its terminal. The preview task
passes `--editor code`, so E or Alt+click in the browser opens the line in VS Code through its
`code` command (Command Palette ▸ "Shell Command: Install 'code' command in PATH" on macOS, if
it is missing).

## Sublime Text

Copy `editors/sublime/Zoomdeck/` to `Packages/Zoomdeck` (Preferences ▸ Browse Packages… opens the
folder). It provides:

- **Zoomdeck Markdown**, a syntax that extends Markdown (Sublime Text 4); files whose first line
  opens a slide or styles block select it automatically, others through View ▸ Syntax.
- A build system with three variants: **Ctrl+Alt+B** starts the preview in the build panel
  (Tools ▸ Cancel Build stops it), **Ctrl+Alt+P** exports one HTML file (also Ctrl+B / ⌘B,
  since Zoomdeck is the build system of Markdown files), and "Build folder" writes the static
  folder export.
- **Ctrl+Alt+J** shows the stop of the cursor line in the browser; E or Alt+click in the browser
  brings Sublime Text to the line (the preview is started with `--editor` pointing at the `subl`
  launcher of the running Sublime Text, wherever it is installed).
- Command Palette entries ("Zoomdeck: Preview deck", "Jump to this line in the browser", "Build
  HTML file", "Build static folder").
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
`::: styles`. Its keys: **C-c C-b** serves the deck in a `*zoomdeck preview*` compilation buffer,
**C-c C-j** shows the stop of the current line in the browser, **C-c C-p** exports one HTML
file (the same three also on **C-M-b**, **C-M-j** and **C-M-p**, that is Ctrl+Alt+B, J and P as
in the other editors, in deck buffers only; `zoomdeck-ctrl-alt-keys` set to nil keeps those keys
for `backward-sexp` and friends), **C-c C-k** stops the server. E or Alt+click in the browser brings Emacs to the line: the
preview is started with an `emacsclient` command for this Emacs session (`zoomdeck-inverse-search`,
on by default, starts the Emacs server when it is not running). `zoomdeck-autosave-mode` (on by
default) saves the deck after one idle second; `zoomdeck-command`, `zoomdeck-build-directory`,
`zoomdeck-autosave` and `zoomdeck-autosave-delay` are customizable. The mode finds the command
by itself: on Emacs's own path, else in the checkout the package was loaded from (its
`bin/zoomdeck.mjs` run with `node`), else on the path of your login shell, which a graphical Emacs
often does not inherit; `zoomdeck-command` overrides all of that, for example with
`"node /path/to/Zoomdeck/bin/zoomdeck.mjs"`. "command not found" in the compilation buffer
therefore means an Emacs older than this package: reload `zoomdeck.el`.

## Vim and Neovim

Copy `editors/vim/plugin/` and `editors/vim/after/` into `~/.vim/` or `~/.config/nvim/`, or hand
`Zoomdeck/editors/vim` to your plugin manager. Markdown buffers whose first lines open a slide or
styles block get the mappings **\<leader\>zb** (`:ZoomdeckPreview`, in a terminal split),
**\<leader\>zj** (`:ZoomdeckJump`, the stop of the cursor line in the browser) and
**\<leader\>zp** (`:ZoomdeckBuild`), plus Ctrl+Alt+B, J and P where the terminal or GUI
delivers them (Neovim in a modern terminal, gvim, MacVim), are saved after `updatetime` idle milliseconds (lowered to
one second), and highlight the dialect through `after/syntax/markdown.vim`. E or Alt+click in
the browser brings Vim to the line through its server: Neovim always has one, Vim needs
`+clientserver` and a name (`vim --servername DECK`; gvim and MacVim name themselves), and
without one the preview starts without inverse search. The plugin finds the command on Vim's
path, else runs the checkout's own `bin/zoomdeck.mjs` with `node`, else asks your login shell;
`g:zoomdeck_command` overrides it, and `g:zoomdeck_autosave = 0` turns the idle save off.

## JetBrains IDEs

Copy `editors/jetbrains/External Tools.xml` to `<configuration directory>/tools/External
Tools.xml` and restart the IDE (WebStorm, IntelliJ IDEA, PyCharm and the others share the
format). Three tools appear under Tools ▸ External Tools ▸ Zoomdeck, **Preview**, **Jump to
this line** and **Build HTML**, each acting on the current file; assign them keys under
Settings ▸ Keymap ▸ External Tools (Ctrl+Alt+B, J and P match the other editors; the IDE will
ask about its own uses of the first and the last, Go to Implementation and Extract Parameter). The preview passes `--editor jetbrains`, which runs the first
IDE launcher found on the `PATH` (`idea`, `webstorm`, `pycharm`, …; Tools ▸ Create Command-line
Launcher creates one); replace it with your IDE's name in the XML to be sure. JetBrains IDEs save files automatically when they lose focus and after idle time
(Settings ▸ Appearance & Behavior ▸ System Settings ▸ Autosave). For highlighting, install the
TextMate Bundles plugin and add `editors/vscode/zoomdeck-markup` as a bundle.

## Any other editor

The ingredients are the same everywhere: a command that runs `zoomdeck serve <file> --editor …`
(with your editor's name, or a command containing `{file}` and `{line}`), one that runs
`zoomdeck jump <file> <line>` with the cursor line, and one that runs
`zoomdeck build <file> -o build --one-file` from the file's directory, an autosave after a short
idle delay, and Markdown highlighting. The VS Code grammar is a plain TextMate grammar that most
editors can load, and the browser reports mistakes with their line number. An editor that can
send an HTTP request needs no command for the forward search: `POST /__zoomdeck/sync/jump` on
the preview's address with a JSON body `{"file": "/absolute/path.md", "line": 42}` (or the same
as `?file=…&line=…` on a GET) does what `zoomdeck jump` does, and `GET /__zoomdeck/sync` answers
with the configured editor.
