/**
 * Placeholder drawn on the canvas for an `[[iframe]]`: an outlined box with
 * the page's address. The player shows the live page over it while the slide
 * is focused (see `player/iframes.ts`).
 */
import { Group, Rectangle, type Mobject } from 'manim-web';
import type { Slide } from '../slides';

/** Every iframe placeholder of the deck, for the player's iframe layer. */
export const IFRAME_HOSTS = new Set<IframeHost>();

export class IframeHost extends Group {
  /** The slide whose focus shows the live page. */
  slide: Slide | null = null;

  constructor(readonly url: string, readonly box: Rectangle, label: Mobject | null, readonly title: string) {
    super(...(label ? [box, label] : [box]));
    IFRAME_HOSTS.add(this);
  }
}
