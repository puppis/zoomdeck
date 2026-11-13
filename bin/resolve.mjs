/**
 * Module resolution for decks that live anywhere. A deck's own modules (its `code-slides.ts`)
 * import `zoomdeck` and `manim-web` by name; Node's lookup walks up from the deck's folder and
 * never reaches this package's `node_modules` when the deck is outside the checkout, so a build
 * stopped with "Rollup failed to resolve import". This Vite plugin resolves bare imports from
 * a module outside the package as if they were written inside it, and `zoomdeck` itself as
 * the package's source, so that the deck and the player share one copy of every module.
 */
import { resolve, sep } from 'node:path';

const posix = (path) => path.split(sep).join('/');

/** Whether `source` names a package rather than a file: not relative, absolute, a URL, a drive or a virtual id. */
export function isBareImport(source) {
  return !/^(?:[./\\]|\0|[A-Za-z]:[\\/]|[a-z][a-z0-9+.-]*:|virtual:)/i.test(source);
}

/** Whether `file` lies inside `root` (both as paths of this platform). */
export function isInside(file, root) {
  const folder = posix(root).replace(/\/+$/, '') + '/';
  return posix(file).startsWith(folder);
}

/** The plugin, for a package whose source entry is `src/index.ts` under `packageRoot`. */
export function resolveFromPackage(packageRoot) {
  const packageEntry = resolve(packageRoot, 'src/index.ts');
  return {
    name: 'zoomdeck-resolve-from-package',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source === 'zoomdeck') return packageEntry;
      if (!importer || importer.startsWith('\0') || !isBareImport(source)) return null;
      if (isInside(importer, packageRoot)) return null;
      // Ask the other resolvers the same question with the package's entry as the importer.
      const resolved = await this.resolve(source, packageEntry, { ...options, skipSelf: true });
      return resolved ?? null;
    },
  };
}
