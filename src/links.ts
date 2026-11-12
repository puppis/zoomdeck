/**
 * Elements that carry an `href`: the player's link layer keeps a clickable
 * area over each one while it is on screen.
 */
import type { Mobject } from 'manim-web';
import type { SourceLocation } from './slides';

/** Linked objects of every prepared slide, with their targets. */
export const LINKED_OBJECTS = new Map<Mobject, string>();

/** Where each element of a Markdown deck (and each child's viewport) was written, for the editor's inverse search. */
export const SOURCE_OBJECTS = new Map<Mobject, SourceLocation>();

/** Link targets accepted on elements and in Markdown links. */
export const LINK_TARGET = /^(https?:|mailto:|#|\/|\.)/i;
