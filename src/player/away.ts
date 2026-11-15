/**
 * Whether the presenter has left the deck, as far as filming the screen is concerned: the page
 * is hidden, another window has the focus, or a live page inside the deck has it. A live page
 * (an iframe) keeps `document.hasFocus()` true for the deck's own document, since the focused
 * frame is one of its descendants, but the document's active element is then the frame itself.
 */
export function awayFromDeck(stageHost: HTMLElement, doc: Document = document): boolean {
  if (doc.hidden || !doc.hasFocus()) return true;
  const active = doc.activeElement;
  return active instanceof HTMLIFrameElement && stageHost.contains(active);
}
