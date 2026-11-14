"""Show Zoomdeck decks in a Jupyter notebook.

    import zoomdeck_nb

then, in a cell of its own, the Markdown of a deck and nothing else:

    %%deck
    ::: slide {#hello}
    # Hello, $e^{i\\pi} + 1 = 0$
    :::

The cell's output loads the Zoomdeck player once (from the documentation site, or from the URL
in the ZOOMDECK_BUNDLE environment variable) and shows the deck in it, with the player's own
controls; edit the cell and run it again to see the deck change. The line after `%%deck` may
carry options: `--without camera,record`, `--title "A name"`, `--start 2`, `--outline`,
`--height 500px`. `%deck paper.pdf` (one line) shows a PDF, a Markdown file or a deck.json by
its address. The same from code: `deck("::: slide ...")` and `deck(src="paper.pdf")` return
display objects. It all works in JupyterLab, the classic notebook, JupyterLite and any viewer
that keeps the HTML output of a cell, including the documentation site built from these notebooks.
"""
from __future__ import annotations

import html
import os
import shlex
import textwrap
from typing import Iterable

__all__ = ["deck", "BUNDLE", "load_ipython_extension"]

#: Where the player's self-contained module is served from unless ZOOMDECK_BUNDLE says otherwise.
BUNDLE = os.environ.get("ZOOMDECK_BUNDLE", "https://puppis.github.io/zoomdeck/zoomdeck/zoomdeck.js")

#: Features a notebook has no use for by default; pass without=() to keep them all.
DEFAULT_WITHOUT: tuple[str, ...] = ("camera", "record", "screen")


class _Html:
    """A minimal rich-display object, so the helper does not import IPython itself."""

    def __init__(self, markup: str):
        self.markup = markup

    def _repr_html_(self) -> str:
        return self.markup

    def __repr__(self) -> str:
        return "<Zoomdeck deck>"


def deck(
    markdown: str | None = None,
    *,
    src: str | None = None,
    title: str | None = None,
    without: Iterable[str] = DEFAULT_WITHOUT,
    start: int | str | None = None,
    outline: bool = False,
    height: str | None = None,
    bundle: str | None = None,
):
    """A deck in the output of the cell: the `markdown` given, or the file at `src`.

    `without` names the player features to leave out (outline, pen, whiteboard, camera, screen,
    record, print, fullscreen, settings); `start` is the first stop, an index from 0 or a slide
    name; `height` a CSS height when the 16:9 default is not wanted.
    """
    if (markdown is None) == (src is None):
        raise ValueError("deck() takes either markdown or src=")
    attributes = []
    if src is not None:
        attributes.append(f'src="{html.escape(src, quote=True)}"')
    if title is not None:
        attributes.append(f'title="{html.escape(title, quote=True)}"')
    left_out = " ".join(without)
    if left_out:
        attributes.append(f'without="{html.escape(left_out, quote=True)}"')
    if start is not None:
        attributes.append(f'start="{html.escape(str(start), quote=True)}"')
    if outline:
        attributes.append("outline")
    if height is not None:
        attributes.append(f'style="height: {html.escape(height, quote=True)}; aspect-ratio: auto"')
    body = ""
    if markdown is not None:
        source = textwrap.dedent(markdown).strip("\n")
        # The script's text is read verbatim by the element; only its own end tag must not appear.
        body = '<script type="text/markdown">\n' + source.replace("</script", "<\\/script") + "\n</script>"
    script = f'<script type="module" src="{html.escape(bundle or BUNDLE, quote=True)}"></script>'
    return _Html(f"{script}\n<zoom-deck {' '.join(attributes)}>{body}</zoom-deck>")


def _options(line: str) -> dict:
    """The keyword arguments of `deck()` written as options on a magic line."""
    options: dict = {}
    words = shlex.split(line)
    i = 0
    while i < len(words):
        word = words[i]
        if word == "--outline":
            options["outline"] = True
        elif word in ("--without", "--title", "--start", "--height", "--bundle"):
            if i + 1 >= len(words):
                raise ValueError(f"{word} needs a value")
            value = words[i + 1]
            i += 1
            if word == "--without":
                options["without"] = tuple(part for part in value.replace(",", " ").split() if part != "none")
            elif word == "--start":
                options["start"] = int(value) if value.isdigit() else value
            else:
                options[word[2:]] = value
        elif not word.startswith("--") and "src" not in options:
            options["src"] = word
        else:
            raise ValueError(f"Unknown option {word}")
        i += 1
    return options


def _magic(line: str, cell: str | None = None):
    """`%%deck [options]` with the Markdown below, or `%deck address [options]`."""
    options = _options(line)
    if cell is None:
        if "src" not in options:
            raise ValueError("%deck needs the address of a PDF, a Markdown file or a deck.json; %%deck takes the Markdown in the cell")
        return deck(**options)
    if "src" in options:
        raise ValueError("%%deck shows the Markdown of its cell; use %deck for a file")
    return deck(cell, **options)


def load_ipython_extension(ipython) -> None:
    """Register the `deck` magic (IPython calls this for `%load_ext zoomdeck_nb`)."""
    ipython.register_magic_function(_magic, magic_kind="line_cell", magic_name="deck")


try:  # Importing the module in IPython is enough: the magic is registered at once.
    from IPython import get_ipython

    _shell = get_ipython()
    if _shell is not None:
        load_ipython_extension(_shell)
except ImportError:  # outside IPython, deck() alone is available
    pass
