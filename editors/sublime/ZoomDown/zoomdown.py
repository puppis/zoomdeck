"""Run the zoomdown command from Sublime Text with the PATH of the user's login shell.

Sublime Text started from the Dock, a launcher or a menu inherits the bare system PATH, not
the one your shell profile builds (where nvm, Homebrew or npm's global bin directory live),
so a plain build system fails with "zoomdown: command not found" even though a terminal finds
the command. This plugin provides the `zoomdown_exec` build target: it asks your login shell
once for its PATH, caches it, and runs the build system's command with it. The command itself
can be changed in ZoomDown.sublime-settings ("command": a name or an absolute path, or
"node /path/to/ZoomDown/bin/zoomdown.mjs").

It also connects the editor and the browser in both directions: the preview is started with
`--editor` pointing at this Sublime Text, so E or Alt+click in the player opens the source line
here (inverse search), and `zoomdown_jump` (Ctrl+Alt+J) shows the stop of the cursor line in
the browser (forward search).
"""
import os
import re
import subprocess
import time

import sublime
import sublime_plugin
from Default.exec import ExecCommand

_cached_path = None


def login_shell_path():
    """The PATH of an interactive login shell, falling back to the editor's own PATH."""
    global _cached_path
    if _cached_path is not None:
        return _cached_path
    path = os.environ.get('PATH', '')
    if sublime.platform() != 'windows':
        shell = os.environ.get('SHELL') or '/bin/bash'
        try:
            result = subprocess.run(
                [shell, '-l', '-i', '-c', 'printf "__ZOOMDOWN__%s__ZOOMDOWN__" "$PATH"'],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20,
            )
            match = re.search(r'__ZOOMDOWN__(.*?)__ZOOMDOWN__', result.stdout.decode('utf-8', 'replace'), re.S)
            if match and match.group(1).strip():
                path = match.group(1).strip()
            else:
                print('ZoomDown: the login shell did not report a PATH; using the editor PATH')
        except Exception as error:  # noqa: BLE001 - any failure falls back to the editor's PATH
            print('ZoomDown: could not read the login shell PATH:', error)
    _cached_path = path
    return path


def zoomdown_command():
    """The command line prefix that runs zoomdown, as a list."""
    command = sublime.load_settings('ZoomDown.sublime-settings').get('command') or 'zoomdown'
    return command.split()


def subl_path():
    """The `subl` launcher of this Sublime Text, which hands `file:line` to the running instance.

    The `sublime_text` binary itself must not be used on macOS: run directly, it starts a second
    instance (in safe mode) and treats `file:line` as a file name. `subl` lives next to the binary
    on Linux and Windows and under Contents/SharedSupport/bin in the macOS application bundle.
    """
    executable = sublime.executable_path()
    folder = os.path.dirname(executable)
    candidates = {
        'osx': [os.path.join(os.path.dirname(folder), 'SharedSupport', 'bin', 'subl')],
        'windows': [os.path.join(folder, 'subl.exe')],
        'linux': [os.path.join(folder, 'subl'), executable],
    }[sublime.platform()]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    return 'subl'


def editor_template():
    """The `--editor` command that opens `{file}` at `{line}` in this Sublime Text."""
    return '"%s" {file}:{line}' % subl_path()


class ZoomdownExecCommand(ExecCommand):
    """`exec` with the login shell's PATH and the configurable zoomdown command."""

    def run(self, cmd=None, **kwargs):
        if cmd:
            if cmd[0] == 'zoomdown':
                cmd = zoomdown_command() + list(cmd[1:])
            # The preview opens source lines here when the player asks (E, Alt+click).
            if 'serve' in cmd and '--editor' not in cmd:
                cmd = cmd + ['--editor', editor_template()]
        kwargs.setdefault('path', login_shell_path())
        super().run(cmd=cmd, **kwargs)


def log(message):
    """Append a line to ZoomDown.log in the cache folder and echo it on the console."""
    print('ZoomDown:', message)
    try:
        with open(os.path.join(sublime.cache_path(), 'ZoomDown.log'), 'a', encoding='utf-8') as handle:
            handle.write('%s %s\n' % (time.strftime('%H:%M:%S'), message))
    except Exception:  # noqa: BLE001
        pass


class ZoomdownJumpCommand(sublime_plugin.TextCommand):
    """Forward search: save, then show the stop of the cursor line in the running preview.

    Everything slow (reading the login shell's PATH, running the command) happens off the UI
    thread; the outcome goes to the status bar, the console and ZoomDown.log in the cache folder,
    and a failure also to a dialog.
    """

    def run(self, edit):
        view = self.view
        path = view.file_name()
        if not path:
            sublime.status_message('ZoomDown: save the deck to a file first')
            return
        if view.is_dirty():
            view.run_command('save')
        line = view.rowcol(view.sel()[0].begin())[0] + 1
        log('jump requested for %s:%d' % (path, line))
        sublime.set_timeout_async(lambda: self._send(path, line), 0)

    def _send(self, path, line):
        command = zoomdown_command() + ['jump', path, str(line)]
        shown = ' '.join(command)
        try:
            env = dict(os.environ, PATH=login_shell_path())
            result = subprocess.run(command, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
            output = result.stdout.decode('utf-8', 'replace').strip()
            if result.returncode == 0:
                log('jump sent: %s' % output)
                sublime.status_message('ZoomDown: line %d sent to the preview' % line)
                return
            problem = output or 'the command failed with status %d' % result.returncode
        except Exception as error:  # noqa: BLE001
            problem = 'cannot run the command: %s' % error
        log('jump failed: %s -- %s' % (shown, problem))
        # A jump that fails means a missing preview or command, which deserves more than a status flash.
        sublime.set_timeout(lambda: sublime.error_message('ZoomDown: the jump to line %d failed.\n\n%s\n\nCommand: %s' % (line, problem, shown)), 0)

    def is_enabled(self):
        return bool(self.view.file_name())


class ZoomdownForgetPathCommand(sublime_plugin.WindowCommand):
    """Re-read the login shell's PATH on the next build (after installing the command, for example)."""

    def run(self):
        global _cached_path
        _cached_path = None
        sublime.status_message('ZoomDown: the PATH will be read again on the next build')
