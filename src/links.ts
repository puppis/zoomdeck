/**
 * Elements that carry an `href`: the player's link layer keeps a clickable
 * area over each one while it is on screen.
 */
import type { Mobject } from 'manim-web';

/** Linked objects of every prepared slide, with their targets. */
export const LINKED_OBJECTS = new Map<Mobject, string>();

/** Link targets accepted on elements and in Markdown links. */
export const LINK_TARGET = /^(https?:|mailto:|#|\/|\.)/i;
