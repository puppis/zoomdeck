/**
 * The tour deck as a starting point: copied out of the app into a folder of the user's, where
 * it can be read, edited and record talks. The copy inside the app is only the source of it.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, sep } from 'node:path';

/** The folder the copy gets inside the one chosen. */
export const TOUR_FOLDER = 'zoomdeck-tour';

/**
 * Copy the tour folder `source` into `parent`, and return the deck's path. A copy that exists
 * already is left alone (an error with code EEXIST and the `target` path) unless `replace`, which
 * writes the deck's files over it again and keeps anything else there, such as recorded talks.
 */
export function copyTour(source, parent, { replace = false } = {}) {
  const target = join(parent, TOUR_FOLDER);
  if (existsSync(target) && !replace) throw Object.assign(new Error(`${target} exists already`), { code: 'EEXIST', target });
  mkdirSync(target, { recursive: true });
  // The deck's own files; a static build of it, if one was made in place, is not part of the deck.
  cpSync(source, target, { recursive: true, force: true, filter: (path) => !path.slice(source.length).split(sep).includes('build') });
  return join(target, 'deck.json');
}
