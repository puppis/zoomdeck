import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deckKind, MARKUP_EXTENSIONS } from '../bin/zoomdown.mjs';
import { tourDeck } from '../desktop/tour.mjs';
import { defaultTitle, loadMarkupDeck } from '../src/markup/deck';
import { resolveSettings } from '../src/markup/frontmatter.mjs';
import { tokenizeCode } from '../src/markup/tokens';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A fetch that serves `files` by URL, and answers anything else as a missing page. */
function serve(files: Record<string, string>): typeof fetch {
  return (async (url: string) => {
    const text = files[url];
    return {
      ok: text !== undefined,
      status: text !== undefined ? 200 : 404,
      headers: new Headers({ 'content-type': text !== undefined ? 'text/plain' : 'text/html' }),
      text: async () => text ?? '<!doctype html>',
    } as Response;
  }) as typeof fetch;
}

describe('the .zd extension', () => {
  it('marks a deck, as .md and .markdown still do', () => {
    expect(MARKUP_EXTENSIONS[0]).toBe('.zd');
    for (const file of ['talk/slides.zd', 'talk/slides.ZD', 'talk/slides.md', 'talk/notes.markdown']) expect(deckKind(file)).toBe('markdown');
    expect(deckKind('talk/paper.pdf')).toBe('pdf');
    expect(deckKind('talk/slides.txt')).toBeNull();
  });

  it('titles a deck after its folder, as before', () => {
    expect(defaultTitle('https://x.org/talks/graphs/slides.zd')).toBe('graphs');
    expect(defaultTitle('/slides.zd')).toBe('slides');
  });

  it('may be extended, and a fence may show it', async () => {
    const files: Record<string, string> = { 'https://x.org/shared.zd': '---\ntitle: Shared\n---\n' };
    const io = { read: async (url: string) => files[url], join: (base: string, path: string) => new URL(path, base).href };
    const { settings } = await resolveSettings('---\nextends: ../shared.zd\n---\nx', 'https://x.org/talk/slides.zd', io);
    expect(settings.title).toBe('Shared');
    expect(tokenizeCode('::: slide {#a}', 'zd')).toEqual(tokenizeCode('::: slide {#a}', 'md'));
  });

  it('names themes, which an older deck may still keep as .md', async () => {
    const deck = '::: slide {#a}\nx\n:::';
    globalThis.fetch = serve({
      'https://x.org/talk/slides.zd': deck,
      'https://x.org/talk/themes/lecture.zd': 'deck: background=#111111',
      'https://x.org/talk/themes/lecture.md': 'deck: background=#222222',
      'https://x.org/talk/themes/older.md': 'deck: background=#333333',
    });
    expect((await loadMarkupDeck({ url: 'https://x.org/talk/slides.zd', theme: 'lecture' })).background).toBe('#111111');
    expect((await loadMarkupDeck({ url: 'https://x.org/talk/slides.zd', theme: 'older' })).background).toBe('#333333');
    await expect(loadMarkupDeck({ url: 'https://x.org/talk/slides.zd', theme: 'missing' })).rejects.toThrow(/No theme missing\.zd \(or missing\.md\)/);
  });
});

describe('the desktop tour copy', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('opens slides.zd, or the slides.md of a copy made before .zd', () => {
    dir = mkdtempSync(join(tmpdir(), 'zoomdown-tour-'));
    expect(tourDeck(dir)).toBe(join(dir, 'slides.zd'));
    writeFileSync(join(dir, 'slides.md'), '');
    expect(tourDeck(dir)).toBe(join(dir, 'slides.md'));
    writeFileSync(join(dir, 'slides.zd'), '');
    expect(tourDeck(dir)).toBe(join(dir, 'slides.zd'));
  });
});
