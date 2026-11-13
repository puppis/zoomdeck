import type { Plugin } from 'vite';

/** Whether `source` names a package rather than a file. */
export function isBareImport(source: string): boolean;
/** Whether `file` lies inside `root`. */
export function isInside(file: string, root: string): boolean;
/** Resolves `zoomdeck` to the package source and other bare imports of modules outside the package against it. */
export function resolveFromPackage(packageRoot: string): Plugin;
