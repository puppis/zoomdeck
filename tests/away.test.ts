import { describe, expect, it } from 'vitest';
import { awayFromDeck } from '../src/player/away';

/** A document whose focus and visibility the test sets. */
function fakeDocument(options: { hidden?: boolean; focused?: boolean; active?: Element | null }): Document {
  return {
    hidden: options.hidden ?? false,
    hasFocus: () => options.focused ?? true,
    activeElement: options.active ?? null,
  } as unknown as Document;
}

describe('leaving the deck', () => {
  it('is being hidden, losing the focus, or giving it to a live page inside the deck', () => {
    const host = document.createElement('div');
    const page = document.createElement('iframe');
    host.append(page);
    const elsewhere = document.createElement('iframe');
    document.body.append(host, elsewhere);
    try {
      expect(awayFromDeck(host, fakeDocument({}))).toBe(false);
      expect(awayFromDeck(host, fakeDocument({ hidden: true }))).toBe(true);
      expect(awayFromDeck(host, fakeDocument({ focused: false }))).toBe(true);
      // A live page of the deck has the focus: the document still has it as a whole, its active element is the frame.
      expect(awayFromDeck(host, fakeDocument({ active: page }))).toBe(true);
      // A frame elsewhere in the page (a dialog's, a host page's) is not the deck's business; nor is a button of the deck.
      expect(awayFromDeck(host, fakeDocument({ active: elsewhere }))).toBe(false);
      expect(awayFromDeck(host, fakeDocument({ active: document.body }))).toBe(false);
    } finally {
      host.remove();
      elsewhere.remove();
    }
  });
});
