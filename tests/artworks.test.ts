import { afterEach, describe, expect, it, vi } from 'vitest';
import { Circle, VGroup } from 'manim-web';
import { artworkFromModule, makeIconFromParts } from '../src/icons';
import { resolveFolders } from '../src/markup/deck';
import { MarkupRenderer } from '../src/markup/renderer';
import { MarkupParser } from '../src/markup/parser';
import { ElementSpec } from '../src/markup/ast';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deckFolders } from '../bin/zoomdeck.mjs';
import { svgToMobject } from '../src/svg';

const options = { size: 2, color: '#112233', strokeWidth: 2, fillColor: '#112233', fillOpacity: 0, sketch: null, attributes: {}, foreground: '#000000' };

describe('artworks of a deck', () => {
  it('draws a module that exports parts, a function returning parts, or a function returning mobjects', async () => {
    const parts = [{ d: 'M-0.5,-0.5 H0.5 V0.5 H-0.5 Z', fill: true }];
    expect((await artworkFromModule({ parts }, options)).getHeight()).toBeCloseTo(2);
    expect((await artworkFromModule({ default: parts }, options)).getHeight()).toBeCloseTo(2);
    expect((await artworkFromModule({ default: () => parts }, options)).getHeight()).toBeCloseTo(2);
    const circle = await artworkFromModule({ artwork: ({ size = 1 }) => new Circle({ radius: size / 2 }) }, options);
    expect(circle).toBeInstanceOf(Circle);
    const several = await artworkFromModule({ default: () => [new Circle({ radius: 1 }), new Circle({ radius: 1 })] }, options);
    expect(several).toBeInstanceOf(VGroup);
    expect((several as VGroup).children.length).toBe(2);
    await expect(artworkFromModule({}, options)).rejects.toThrow(/drawing function/);
    expect(makeIconFromParts(parts, { size: 3 }).getWidth()).toBeCloseTo(3);
  });

  it('names its folders relative to the configuration, or keeps them relative to the document', () => {
    expect(resolveFolders(['shared', 'art/'], 'https://x.org/talk/deck.json')).toEqual(['https://x.org/talk/shared/', 'https://x.org/talk/art/']);
    expect(resolveFolders(['../common'], 'https://x.org/talk/deck.json')).toEqual(['https://x.org/common/']);
    expect(resolveFolders(['https://cdn.org/a', '/root/b'], 'https://x.org/talk/deck.json')).toEqual(['https://cdn.org/a/', '/root/b/']);
    expect(resolveFolders(['paths/0'])).toEqual(['paths/0/']);
    expect(resolveFolders(undefined)).toEqual([]);
  });

  it('is written as [[artwork: name]] or as an icon name that is not built in', () => {
    const document = new MarkupParser().parse('::: slide {#s}\n[[artwork: rocket #r x=1 y=2 size=1.5 lit=red]]\n[[icon: user #u x=0 y=0]]\n:::');
    const [artwork, icon] = document.slides[0].items as ElementSpec[];
    expect(artwork.kind).toBe('icon');
    expect(artwork.source).toBe('rocket');
    expect(artwork.attributes.lit).toBe('red');
    expect(icon.source).toBe('user');
  });
});

describe('the search folders of a deck', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('find a file in the document folder first, then in each folder, by asking the server', async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      asked.push(`${init?.method ?? 'GET'} ${url}`);
      return { ok: url.endsWith('/shared/pic.png'), headers: new Headers({ 'content-type': 'image/png' }) } as Response;
    }) as typeof fetch;
    const renderer = new MarkupRenderer({ basePath: 'https://x.org/talk/slides.md', paths: ['https://x.org/shared/', 'extra/'] });
    expect(await renderer.locate('pic.png')).toBe('https://x.org/shared/pic.png');
    expect(asked).toEqual(['HEAD https://x.org/talk/pic.png', 'HEAD https://x.org/shared/pic.png']);
    // Nothing answers: the document's own URL, so the error names it.
    expect(await renderer.locate('missing.png')).toBe('https://x.org/talk/missing.png');
    expect(asked.filter((line) => line.includes('missing'))).toEqual(['HEAD https://x.org/talk/missing.png', 'HEAD https://x.org/shared/missing.png', 'HEAD https://x.org/talk/extra/missing.png']);
    // Absolute addresses, data URIs and preloaded assets are never searched for.
    expect(await renderer.locate('https://cdn.org/a.png')).toBe('https://cdn.org/a.png');
    expect(await renderer.locate('data:image/png;base64,AA==')).toBe('data:image/png;base64,AA==');
    const bundled = new MarkupRenderer({ basePath: 'x', assets: { 'paths/0/pic.png': 'data:a', 'own.png': 'data:b' }, paths: ['paths/0/'] });
    expect(await bundled.locate('own.png')).toBe('data:b');
    expect(await bundled.locate('pic.png')).toBe('data:a');
  });

  it('take a development server\'s page for no file and no module', async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (url: string) => {
      asked.push(url);
      const page = !url.endsWith('.svg');
      return { ok: true, headers: new Headers({ 'content-type': page ? 'text/html' : 'image/svg+xml' }) } as Response;
    }) as typeof fetch;
    const renderer = new MarkupRenderer({ basePath: 'https://x.org/talk/slides.md', paths: ['https://x.org/shared/'] });
    // Every candidate answers with the page: nothing is found, the document's own URL comes back.
    expect(await renderer.locate('pic.png')).toBe('https://x.org/talk/pic.png');
    // A page is what an embedded page should be.
    expect(await renderer.locate('live.html')).toBe('https://x.org/talk/live.html');
    expect(asked.filter((url) => url.includes('live.html'))).toEqual(['https://x.org/talk/live.html']);
    expect(await renderer.locate('figure.svg')).toBe('https://x.org/talk/figure.svg');
  });

  it('without search folders, resolve as before and never ask', async () => {
    globalThis.fetch = (async () => { throw new Error('should not be called'); }) as typeof fetch;
    const renderer = new MarkupRenderer({ basePath: 'https://x.org/talk/slides.md' });
    expect(await renderer.locate('pic.png')).toBe('https://x.org/talk/pic.png');
  });

  it('are read from the configuration by the command, existing ones only, with artworks/ next to the Markdown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoomdeck-folders-'));
    try {
      mkdirSync(join(dir, 'shared'));
      mkdirSync(join(dir, 'src', 'artworks'), { recursive: true });
      writeFileSync(join(dir, 'src', 'slides.md'), '::: slide {#a}\nx\n:::\n');
      writeFileSync(join(dir, 'deck.json'), JSON.stringify({ markup: 'src/slides.md', paths: ['shared', 'absent'], artworks: ['shared'] }));
      const folders = deckFolders(join(dir, 'deck.json'));
      expect(folders.paths).toEqual([join(dir, 'shared')]);
      expect(folders.artworks).toEqual([join(dir, 'shared'), join(dir, 'src', 'artworks')]);
      expect(folders.all.length).toBe(3);
      expect(deckFolders(join(dir, 'nope.json')).all).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the SVG importer', () => {
  it('inherits the attributes of the svg element and keeps a stroke-less shape visible', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="5">'
      + '<path d="M50 8 C66 24 70 48 62 70 H38 C30 48 34 24 50 8 Z" fill="#93C5FD"/>'
      + '<path d="M38 56 L24 70 L36 70 Z" fill="#FC6255" stroke="#FC6255"/>'
      + '<circle cx="50" cy="40" r="8" fill="#FFFFFF" stroke="none"/></svg>';
    const group = svgToMobject(svg, { height: 1.4, defaultColor: '#1C758A' });
    const [body, fin, window] = group.children as unknown as Array<{ opacity: number; strokeColor: string; strokeWidth: number; fillColor: string; fillOpacity: number }>;
    expect(body.strokeColor.toUpperCase()).toBe('#1C758A');
    expect(body.strokeWidth).toBeGreaterThan(0);
    expect(body.opacity).toBe(1);
    expect(body.fillOpacity).toBe(1);
    expect(fin.strokeColor.toUpperCase()).toBe('#FC6255');
    expect(window.strokeWidth).toBe(0);
    expect(window.opacity).toBe(1);
    expect(window.fillColor.toUpperCase()).toBe('#FFFFFF');
  });
});
