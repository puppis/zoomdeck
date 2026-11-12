/**
 * Editor synchronization under the preview server: forward search moves the player to the
 * stop that shows a line of the deck's source, inverse search opens the source of the current
 * stop in the editor. Both go through the server's `/__zoomdeck/sync` endpoints, so neither
 * exists in an exported deck.
 */
import type { NavigationData } from '../runtime';
import type { SourceLocation } from '../slides';
import type { Player } from './player';

/** What the server broadcasts for a forward search: a file path, a line and the server's root, all with forward slashes. */
export interface JumpMessage {
  file: string;
  line: number;
  root: string;
}

const EVENT = 'zoomdeck:jump';
const ENDPOINT = '/__zoomdeck/sync';

/** Whether this page can reach the server's endpoints (only under the preview or development server). */
export function editorSyncAvailable(): boolean {
  return Boolean(import.meta.hot);
}

/**
 * The file-system path of a deck document, as the server names files: a `/@fs/` URL carries
 * the path itself, any other URL under the server is relative to its root. Returns null for
 * an unknown document.
 */
export function documentPath(file: string, root: string): string | null {
  if (!file) return null;
  if (file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file)) return file.replace(/\\/g, '/');
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(file).pathname);
  } catch {
    return null;
  }
  const path = pathname.startsWith('/@fs/') ? pathname.slice(4) : `${root.replace(/\/$/, '')}${pathname}`;
  return path.replace(/^\/([A-Za-z]:)/, '$1');
}

/**
 * The stop that shows `line` of `file`: within the slide defined last before the line, the
 * stop whose source line is the last one at or before it, so the stop at which everything
 * written up to that line has appeared. A line of a file that defines no slide (an imported
 * fragment) is matched among all stops of that file. Null when the file is not part of the deck.
 */
export function clipForLine(navigation: NavigationData, file: string, line: number, root: string): number | null {
  const at = (location: SourceLocation | null | undefined): number | null =>
    location && documentPath(location.file, root) === file ? location.line : null;
  let slide: NavigationData['slides'][number] | null = null;
  for (const candidate of navigation.slides) {
    const defined = at(candidate.source);
    if (defined === null || defined > line) continue;
    if (!slide || defined > (at(slide.source) as number)) slide = candidate;
  }
  const clips = navigation.clips.map((clip, index) => ({ clip, index, line: at(clip.source) }));
  const own = slide ? clips.filter((entry) => entry.clip.slide === slide.id) : clips;
  let best: { index: number; line: number } | null = null;
  for (const entry of own) {
    if (entry.line === null || entry.line > line) continue;
    if (!best || entry.line > best.line) best = { index: entry.index, line: entry.line };
  }
  if (best) return best.index;
  if (slide) {
    const entry = navigation.clips.findIndex((clip) => clip.slide === slide.id && clip.kind === 'entry');
    return entry >= 0 ? entry : null;
  }
  // Nothing of the file has appeared yet at that line: the first stop that mentions the file.
  let first: { index: number; line: number } | null = null;
  for (const entry of clips) {
    if (entry.line === null) continue;
    if (!first || entry.line < first.line) first = { index: entry.index, line: entry.line };
  }
  return first ? first.index : null;
}

/** The source a stop shows: its own, else the last known one of the same slide, else the slide's definition or placement. */
export function sourceOfClip(navigation: NavigationData, index: number): SourceLocation | null {
  const clip = navigation.clips[index];
  if (!clip) return null;
  for (let i = index; i >= 0 && navigation.clips[i].slide === clip.slide; i--) {
    const source = navigation.clips[i].source;
    if (source) return source;
  }
  const slide = navigation.slides.find((candidate) => candidate.id === clip.slide);
  return slide?.source ?? slide?.placement ?? null;
}

/** The player's end of the synchronization. */
export class EditorSync {
  /** Whether the server has an editor to open files with; unknown until `listen` has asked. */
  editor: string | null = null;

  constructor(private readonly navigation: NavigationData, private readonly player: Player) {}

  /** Follow forward searches, including one sent while this page was loading. */
  listen(): void {
    import.meta.hot?.on(EVENT, (message: JumpMessage) => this.jump(message));
    void fetch(ENDPOINT, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((info: { editor: string | null; jump: (JumpMessage & { at: number }) | null } | null) => {
        if (!info) return;
        this.editor = info.editor;
        if (info.jump) this.jump(info.jump);
      })
      .catch(() => undefined);
  }

  /** Show the stop of a line; false when the line belongs to no document of this deck. */
  jump(message: JumpMessage): boolean {
    const index = clipForLine(this.navigation, message.file, message.line, message.root);
    if (index === null) return false;
    void this.player.goTo(index, false);
    return true;
  }

  /** Open a source location, by default the current stop's, in the editor; resolves to an error message, or null when it opened. */
  async open(location: SourceLocation | null = sourceOfClip(this.navigation, this.player.index)): Promise<string | null> {
    if (!location || !location.file) return 'This stop has no source line';
    try {
      const response = await fetch(`${ENDPOINT}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: location.file, line: location.line }),
      });
      const result = (await response.json()) as { ok: boolean; error?: string };
      return result.ok ? null : result.error ?? 'The editor could not be opened';
    } catch {
      return 'The preview server did not answer';
    }
  }
}
