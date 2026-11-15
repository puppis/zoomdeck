/**
 * Whether the presenter has left the deck, as far as filming the screen is concerned: the page
 * is hidden, another window has the focus, or a live page inside the deck has it. A live page
 * (an iframe) keeps `document.hasFocus()` true for the deck's own document, since the focused
 * frame is one of its descendants, but the document's active element is then the frame itself.
 */
export function awayFromDeck(stageHost: HTMLElement, doc: Document = document, ownWindows: Window[] = []): boolean {
  if (doc.hidden) return true;
  // The focus in a window of the deck's own (the camera's floating window) is not a leave.
  if (!doc.hasFocus()) return !ownWindows.some((own) => !own.closed && own.document.hasFocus());
  const active = doc.activeElement;
  return active instanceof HTMLIFrameElement && stageHost.contains(active);
}
