"""Run the zoomdeck command from Sublime Text with the PATH of the user's login shell.

Sublime Text started from the Dock, a launcher or a menu inherits the bare system PATH, not
the one your shell profile builds (where nvm, Homebrew or npm's global bin directory live),
so a plain build system fails with "zoomdeck: command not found" even though a terminal finds
the command. This plugin provides the `zoomdeck_exec` build target: it asks your login shell
once for its PATH, caches it, and runs the build system's command with it. The command itself
can be changed in Zoomdeck.sublime-settings ("command": a name or an absolute path, or
"node /path/to/Zoomdeck/bin/zoomdeck.mjs").
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


class ZoomdeckExecCommand(ExecCommand):
    """`exec` with the login shell's PATH and the configurable zoomdeck command."""

    def run(self, cmd=None, **kwargs):
        if cmd:
            command = sublime.load_settings('Zoomdeck.sublime-settings').get('command') or 'zoomdeck'
            if cmd[0] == 'zoomdeck':
                cmd = command.split() + list(cmd[1:])
        kwargs.setdefault('path', login_shell_path())
        super().run(cmd=cmd, **kwargs)


class ZoomdeckForgetPathCommand(sublime_plugin.WindowCommand):
    """Re-read the login shell's PATH on the next build (after installing the command, for example)."""

    def run(self):
        global _cached_path
        _cached_path = None
        sublime.status_message('Zoomdeck: the PATH will be read again on the next build')
