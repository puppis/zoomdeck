"""Run the zoomdeck command from Sublime Text with the PATH of the user's login shell.

Sublime Text started from the Dock, a launcher or a menu inherits the bare system PATH, not
the one your shell profile builds (where nvm, Homebrew or npm's global bin directory live),
so a plain build system fails with "zoomdeck: command not found" even though a terminal finds
the command. This plugin provides the `zoomdeck_exec` build target: it asks your login shell
once for its PATH, caches it, and runs the build system's command with it. The command itself
can be changed in Zoomdeck.sublime-settings ("command": a name or an absolute path, or
"node /path/to/Zoomdeck/bin/zoomdeck.mjs").

It also connects the editor and the browser in both directions: the preview is started with
`--editor` pointing at this Sublime Text, so E or Alt+click in the player opens the source line
here (inverse search), and `zoomdeck_jump` (Ctrl+Alt+J) shows the stop of the cursor line in
the browser (forward search).
"""
import os
import re
import subprocess

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
                [shell, '-l', '-i', '-c', 'printf "__ZOOMDECK__%s__ZOOMDECK__" "$PATH"'],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20,
            )
            match = re.search(r'__ZOOMDECK__(.*?)__ZOOMDECK__', result.stdout.decode('utf-8', 'replace'), re.S)
            if match and match.group(1).strip():
                path = match.group(1).strip()
            else:
                print('Zoomdeck: the login shell did not report a PATH; using the editor PATH')
        except Exception as error:  # noqa: BLE001 - any failure falls back to the editor's PATH
            print('Zoomdeck: could not read the login shell PATH:', error)
    _cached_path = path
    return path


def zoomdeck_command():
    """The command line prefix that runs zoomdeck, as a list."""
    command = sublime.load_settings('Zoomdeck.sublime-settings').get('command') or 'zoomdeck'
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


class ZoomdeckExecCommand(ExecCommand):
    """`exec` with the login shell's PATH and the configurable zoomdeck command."""

    def run(self, cmd=None, **kwargs):
        if cmd:
            if cmd[0] == 'zoomdeck':
                cmd = zoomdeck_command() + list(cmd[1:])
            # The preview opens source lines here when the player asks (E, Alt+click).
            if 'serve' in cmd and '--editor' not in cmd:
                cmd = cmd + ['--editor', editor_template()]
        kwargs.setdefault('path', login_shell_path())
        super().run(cmd=cmd, **kwargs)


class ZoomdeckJumpCommand(sublime_plugin.TextCommand):
    """Forward search: save, then show the stop of the cursor line in the running preview."""

    def run(self, edit):
        view = self.view
        path = view.file_name()
        if not path:
            sublime.status_message('Zoomdeck: save the deck to a file first')
            return
        if view.is_dirty():
            view.run_command('save')
        line = view.rowcol(view.sel()[0].begin())[0] + 1
        env = dict(os.environ, PATH=login_shell_path())
        command = zoomdeck_command() + ['jump', path, str(line)]
        sublime.set_timeout_async(lambda: self._send(command, env, line), 0)

    def _send(self, command, env, line):
        shown = ' '.join(command)
        try:
            result = subprocess.run(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
            output = result.stdout.decode('utf-8', 'replace').strip()
            if result.returncode == 0:
                sublime.status_message('Zoomdeck: line %d sent to the preview' % line)
                return
            problem = output or 'the command failed with status %d' % result.returncode
        except Exception as error:  # noqa: BLE001
            problem = 'cannot run the command: %s' % error
        # A jump that fails means a missing preview or command, which deserves more than a status flash.
        print('Zoomdeck jump failed:', shown, '\n', problem)
        sublime.error_message('Zoomdeck: the jump to line %d failed.\n\n%s\n\nCommand: %s' % (line, problem, shown))

    def is_enabled(self):
        return bool(self.view.file_name())


class ZoomdeckForgetPathCommand(sublime_plugin.WindowCommand):
    """Re-read the login shell's PATH on the next build (after installing the command, for example)."""

    def run(self):
        global _cached_path
        _cached_path = None
        sublime.status_message('Zoomdeck: the PATH will be read again on the next build')
