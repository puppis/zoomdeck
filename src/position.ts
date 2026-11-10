/** Stable slide identities for preview reloads, independent of traversal indexes. */
import type { Slide } from './slides';

/** Prefer markup IDs; code-authored slides use ancestry and same-name occurrence. */
export function slideKeys(root: Slide): Map<Slide, string> {
  const keys = new Map<Slide, string>();
  const pending: Array<[Slide, Array<[string, number]>]> = [[root, []]];
  while (pending.length) {
    const [slide, path] = pending.pop() as [Slide, Array<[string, number]>];
    const identifier = (slide as Slide & { spec?: { id?: string } }).spec?.id;
    keys.set(slide, identifier != null ? 'markup:' + identifier : 'code:' + JSON.stringify(path));
    const counts = new Map<string, number>();
    const children: Array<[Slide, Array<[string, number]>]> = [];
    for (const child of slide.children) {
      const ordinal = counts.get(child.name) ?? 0;
      counts.set(child.name, ordinal + 1);
      children.push([child, [...path, [child.name, ordinal]]]);
    }
    pending.push(...children.reverse());
  }
  return keys;
}

export interface Bookmark {
  key: string;
  ancestors: string[];
  step: number;
  atEnd?: boolean;
}

export function bookmark(slide: Slide, keys: Map<Slide, string>, step: number): Bookmark {
  const ancestors: string[] = [];
  for (let parent = slide.parent; parent !== null; parent = parent.parent) ancestors.push(keys.get(parent) as string);
  return { key: keys.get(slide) as string, ancestors, step };
}
