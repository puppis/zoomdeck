"""Show Zoomdeck decks in a Jupyter notebook.

    from zoomdeck_nb import deck
    deck('''
    ::: slide {#hello}
    # Hello
    :::
    ''')

`deck()` returns an HTML display object: the output cell loads the Zoomdeck player once (from
the documentation site, or from the URL in the ZOOMDECK_BUNDLE environment variable) and shows
the Markdown in it, with the player's own controls. Edit the string and run the cell again to see
the deck change. `deck(src="paper.pdf")` shows a PDF, a Markdown file or a deck.json instead.
It works in JupyterLab, the classic notebook, JupyterLite and any viewer that keeps the HTML
output of a cell, including the documentation site built from these notebooks.
"""
from __future__ import annotations

import html
import os
import textwrap
from typing import Iterable

__all__ = ["deck", "BUNDLE"]

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
