import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSettings, resolveSettings, splitFrontMatter } from '../src/markup/frontmatter.mjs';
import { defaultTitle, loadMarkupDeck, markupDeck } from '../src/markup/deck';
import { deckFolders, deckSettings, resolveDeckPath } from '../bin/zoomdeck.mjs';

/** Files in memory, by URL, read and joined as a browser would. */
function memory(files: Record<string, string>) {
  return {
    read: async (location: string) => {
      if (!(location in files)) throw new Error('HTTP 404');
      return files[location];
    },
    join: (base: string, path: string) => new URL(path, base).href,
  };
}

describe('front matter', () => {
  it('is split from the Markdown, its lines left blank so that every line keeps its number', () => {
    const { yaml, body, lines } = splitFrontMatter('---\ntitle: A\n...\n::: slide {#a}\n:::');
    expect(yaml).toBe('title: A');
    expect(lines).toBe(3);
    expect(body.split('\n')).toEqual(['', '', '', '::: slide {#a}', ':::']);
    expect(splitFrontMatter('::: slide {#a}\n:::').yaml).toBeNull();
    expect(() => splitFrontMatter('---\ntitle: A\n::: slide {#a}')).toThrow(/never closed/);
  });

  it('holds known settings of the right kinds', () => {
    expect(parseSettings('title: A\nviewport: 16x12\nlayout: { fontSize: 24 }', 'x')).toEqual({ title: 'A', viewport: { width: 16, height: 12 }, layout: { fontSize: 24 } });
    expect(parseSettings("macros:\n  N: '\\mathbb{N}'\n  pair: ['\\langle #1, #2 \\rangle', 2]", 'x').macros).toEqual({ N: '\\mathbb{N}', pair: ['\\langle #1, #2 \\rangle', 2] });
    expect(parseSettings('', 'x')).toEqual({});
    expect(() => parseSettings('markup: slides.md', 'deck.md')).toThrow(/deck.md: unknown setting "markup"/);
    expect(() => parseSettings('layout: big', 'x')).toThrow(/layout maps names to values/);
    expect(() => parseSettings('viewport: wide', 'x')).toThrow(/16x9/);
    expect(() => parseSettings('showOutline: yes please', 'x')).toThrow(/true or false/);
    expect(() => parseSettings('title: [unclosed', 'x')).toThrow(/not valid YAML/);
  });

  it('builds on the files it extends: maps merge, folders add up, the rest is replaced, paths resolve where they are written', async () => {
    const files = {
      'https://x.org/course/shared.yaml': "title: Course\nlayout: { fontSize: 24, headingSize: 40 }\nmacros: { N: '\\mathbb{N}' }\nartworks: art\nclasses: classes.ts\n",
      'https://x.org/course/talk/base.md': '---\nextends: ../shared.yaml\nlayout: { fontSize: 26 }\n---\n',
    };
    const deck = '---\nextends: base.md\ntitle: Talk one\nmacros: { R: \'\\mathbb{R}\' }\nartworks: [mine]\n---\n::: slide {#a}\n:::';
    const { settings, body, extended } = await resolveSettings(deck, 'https://x.org/course/talk/slides.md', memory(files));
    expect(settings.title).toBe('Talk one');
    expect(settings.layout).toEqual({ fontSize: 26, headingSize: 40 });
    expect(settings.macros).toEqual({ N: '\\mathbb{N}', R: '\\mathbb{R}' });
    expect(settings.artworks).toEqual(['https://x.org/course/talk/mine', 'https://x.org/course/art']);
    expect(settings.classes).toBe('https://x.org/course/classes.ts');
    expect(extended).toEqual(['https://x.org/course/talk/base.md', 'https://x.org/course/shared.yaml']);
    expect(body.startsWith('\n'.repeat(6))).toBe(true);
    const loop = { 'https://x.org/a.md': '---\nextends: b.md\n---\n', 'https://x.org/b.md': '---\nextends: a.md\n---\n' };
    await expect(resolveSettings(loop['https://x.org/a.md'], 'https://x.org/a.md', memory(loop))).rejects.toThrow(/extends itself/);
    await expect(resolveSettings('---\nextends: gone.yaml\n---\n', 'https://x.org/a.md', memory({}))).rejects.toThrow(/cannot read/);
    await expect(resolveSettings('---\nextends: shared.json\n---\n', 'https://x.org/a.md', memory({}))).rejects.toThrow(/Markdown or YAML/);
  });
});

describe('a deck and its front matter', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('applies to a deck written as text, under the options given in code', () => {
    const source = '---\ntitle: From the front matter\nviewport: 4x3\npresenter: { transitionTime: 1.5 }\n---\n::: slide {#a}\nx\n:::';
    const deck = markupDeck({ source });
    expect(deck.title).toBe('From the front matter');
    expect(deck.viewport).toEqual({ width: 4, height: 3 });
    expect(deck.presenter.transitionTime).toBe(1.5);
    expect(markupDeck({ source, title: 'Given in code' }).title).toBe('Given in code');
    expect(() => markupDeck({ source: '---\nextends: shared.yaml\n---\nx' })).toThrow(/loadMarkupDeck/);
  });

  it('is read with the files it extends when the deck is opened by its URL', async () => {
    const files: Record<string, string> = {
      'https://x.org/talk/slides.md': '---\nextends: ../shared.yaml\ntitle: Talk\n---\n::: slide {#a}\nx\n:::',
      'https://x.org/shared.yaml': 'viewport: 16x12\nbackground: "#102030"',
    };
    globalThis.fetch = (async (url: string) => {
      const found = url in files;
      return { ok: found, status: found ? 200 : 404, headers: new Headers({ 'content-type': 'text/plain' }), text: async () => files[url] ?? '' } as Response;
    }) as typeof fetch;
    const deck = await loadMarkupDeck({ url: 'https://x.org/talk/slides.md' });
    expect(deck.title).toBe('Talk');
    expect(deck.viewport).toEqual({ width: 16, height: 12 });
    expect(deck.background).toBe('#102030');
  });

  it('is titled after its folder when the front matter gives no title', () => {
    expect(defaultTitle('https://x.org/talks/graphs/slides.md')).toBe('graphs');
    expect(defaultTitle('/slides.md')).toBe('slides');
    expect(defaultTitle(undefined)).toBe('Zoomdeck');
  });
});

describe('the command and front matter', () => {
  it('reads a deck\'s settings and folders from its front matter and the files it extends, and refuses a JSON file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoomdeck-front-'));
    try {
      mkdirSync(join(dir, 'course', 'fonts'), { recursive: true });
      mkdirSync(join(dir, 'course', 'talk'), { recursive: true });
      writeFileSync(join(dir, 'course', 'shared.yaml'), 'fonts: fonts\nlayout: { fontSize: 22 }\n');
      writeFileSync(join(dir, 'course', 'talk', 'slides.md'), '---\nextends: ../shared.yaml\ntitle: Talk\n---\n::: slide {#a}\nx\n:::\n');
      const deck = join(dir, 'course', 'talk', 'slides.md');
      const { settings } = await deckSettings(deck);
      expect(settings.title).toBe('Talk');
      expect(settings.layout).toEqual({ fontSize: 22 });
      const folders = await deckFolders(deck);
      expect(folders.fonts).toEqual([join(dir, 'course', 'fonts')]);
      expect(folders.extended).toEqual([join(dir, 'course')]);
      expect(() => resolveDeckPath(join(dir, 'deck.json'))).toThrow(/front matter/);
      expect(resolveDeckPath(deck)).toBe(deck);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
