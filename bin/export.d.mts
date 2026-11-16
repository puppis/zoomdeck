import type { Plugin } from 'vite';

export const ENDPOINT: string;
/** Whether the page is writing an export into a folder of its choice right now (the deck's reload watchers wait). */
export function exportWriting(): boolean;
/** A name for a file or a folder: letters, digits, dots, dashes and underscores, not starting with a dot. */
export function exportName(value: unknown, fallback?: string): string;
/** The deck file a page names, when it lies inside one of the served roots; null otherwise. */
export function deckFileFor(deck: string, roots: string[], root: string): string | null;
/** The files under `dir`, relative to it with forward slashes, and their sizes. */
export function listFiles(dir: string): Promise<Array<{ path: string; size: number }>>;
/** Where a result goes in the deck's build/ folder; throws when something there that is not an earlier export would be replaced. */
export function placeTarget(deckDir: string, name: string, form: 'folder' | 'file'): Promise<string>;
/** Serve the export endpoint; `build` is buildDeck of bin/zoomdeck.mjs. */
export function exportStore(options: { roots?: string[]; build: (options: Record<string, unknown>) => Promise<{ target: string }> }): Plugin;
