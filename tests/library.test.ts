import { afterEach, describe, expect, it } from 'vitest';
import { Circle, FadeIn, VGroup, type Mobject } from 'manim-web';
import { effectFromModule, type EffectOptions } from '../src/animations';
import { chartFromModule, parseChartData } from '../src/charts';
import { knownLanguage, registerLanguage, tokenizeCode } from '../src/markup/tokens';
import { MarkupParser } from '../src/markup/parser';
import { LayoutConfig, MarkupRenderer } from '../src/markup/renderer';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deckFolders, LIBRARY_KINDS } from '../bin/zoomdown.mjs';

const FONT_VARIANT_COUNT = 4; // regular, bold, italic, bold italic
const FONT_EXTENSION_COUNT = 4; // woff2, woff, ttf, otf

describe('modules of a deck\'s library', () => {
  it('make an effect from a default export or a named one, and refuse a module without', () => {
    const target = new Circle();
    const named = { effect: (object: Mobject, options: EffectOptions) => new FadeIn(object, { duration: options.duration }) };
    expect(effectFromModule(named, target, { color: '#ff0000' })).toBeInstanceOf(FadeIn);
    expect(effectFromModule({ default: named.effect }, target)).toBeInstanceOf(FadeIn);
    expect(() => effectFromModule({}, target)).toThrow(/exports a function/);
  });

  it('make a chart from a module that returns a mobject', async () => {
    const data = parseChartData('A, 1\nB, 2');
    const module = { default: () => new VGroup() };
    expect(await chartFromModule(module, data, {}, async () => new VGroup())).toBeInstanceOf(VGroup);
    await expect(chartFromModule({}, data, {}, async () => new VGroup())).rejects.toThrow(/exports a function/);
  });

  it('register a language profile, with aliases, for the code tokenizer', () => {
    expect(knownLanguage('zig')).toBe(false);
    expect(knownLanguage('python')).toBe(true);
    registerLanguage('zig', { keywords: ['fn', 'pub', 'const'], types: ['u8', 'void'], lineComment: ['//'], strings: ['"'], aliases: ['ziglang'] });
    expect(knownLanguage('zig')).toBe(true);
    expect(knownLanguage('ZigLang')).toBe(true);
    const [line] = tokenizeCode('pub fn main() void {} // hi', 'zig');
    const kinds = Object.fromEntries(line.map((token) => [token.text, token.cls]));
    expect(kinds.pub).toBe('keyword');
    expect(kinds.void).toBe('type');
    expect(kinds['// hi']).toBe('comment');
  });
});

describe('themes', () => {
  it('are the ::: styles blocks of a theme file, or every line of a file without blocks', () => {
    const blocks = MarkupParser.parseStyles('<!-- a theme -->\n\n::: styles\nheading: color=BLUE_E\n:::\n\nProse between blocks is ignored.\n\n::: styles\nbody: font_size=30\n:::\n');
    expect(Object.keys(blocks).sort()).toEqual(['body', 'heading']);
    expect(blocks.heading).toMatchObject({ color: 'BLUE_E' });
    const bare = MarkupParser.parseStyles('heading: color=RED\n');
    expect(bare.heading).toMatchObject({ color: 'RED' });
  });
});

describe('the fonts, languages and code themes of a deck', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('read a language profile and a code theme from their folders, by asking the server once', async () => {
    const asked: string[] = [];
    const files: Record<string, unknown> = {
      'https://x.org/talk/languages/pony.json': { keywords: ['actor', 'be'], lineComment: ['//'] },
      'https://x.org/talk/code-themes/sepia.json': { keyword: '#884400' },
    };
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      asked.push(`${init?.method ?? 'GET'} ${url}`);
      const body = files[url];
      return {
        ok: body !== undefined,
        headers: new Headers({ 'content-type': body !== undefined ? 'application/json' : 'text/html' }),
        json: async () => body,
      } as unknown as Response;
    }) as typeof fetch;
    const renderer = new MarkupRenderer({
      basePath: 'https://x.org/talk/slides.zd', languages: ['languages/'], codeThemes: ['code-themes/'], paths: ['https://x.org/shared/'],
      layout: new LayoutConfig({ codeTheme: 'sepia' }),
    });
    expect(await renderer.prepareCode('pony')).toEqual({ keyword: '#884400' });
    expect(knownLanguage('pony')).toBe(true);
    expect(tokenizeCode('actor Main', 'pony')[0][0]).toMatchObject({ text: 'actor', cls: 'keyword' });
    // A second listing asks nothing more: both are loaded once.
    await renderer.prepareCode('pony');
    expect(asked.filter((line) => line.startsWith('GET'))).toEqual(['GET https://x.org/talk/languages/pony.json', 'GET https://x.org/talk/code-themes/sepia.json']);
    // A language the player knows is never looked up.
    await renderer.language('python');
    expect(asked.some((line) => line.includes('python'))).toBe(false);
  });

  it('load a font family and its variants from the fonts folders when the browser can', async () => {
    if (typeof document === 'undefined') return;
    const asked: string[] = [];
    const present = new Set(['https://x.org/talk/fonts/Inter.woff2', 'https://x.org/talk/fonts/Inter-Bold.woff2']);
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      asked.push(`${init?.method ?? 'GET'} ${url}`);
      return { ok: present.has(url), headers: new Headers({ 'content-type': present.has(url) ? 'font/woff2' : 'text/html' }) } as Response;
    }) as typeof fetch;
    const loaded: Array<[string, string, string | undefined]> = [];
    const original = globalThis.FontFace;
    const added: string[] = [];
    const fonts = document.fonts ?? Object.defineProperty(document, 'fonts', { value: { add: () => undefined }, configurable: true }).fonts;
    const originalAdd = fonts.add;
    fonts.add = ((face: FontFace) => { added.push(face.family); return fonts; }) as typeof fonts.add;
    globalThis.FontFace = class {
      constructor(public family: string, public source: string, public descriptors?: { weight?: string; style?: string }) {}
      async load() {
        loaded.push([this.family, this.source, `${this.descriptors?.weight} ${this.descriptors?.style}`]);
        return this;
      }
    } as unknown as typeof FontFace;
    try {
      const renderer = new MarkupRenderer({ basePath: 'https://x.org/talk/slides.zd', fonts: ['fonts/'] });
      await renderer.ensureFont('Inter');
      await renderer.ensureFont('Inter');
      expect(loaded.map(([, , variant]) => variant)).toEqual(['400 normal', '700 normal']);
      expect(loaded[0][1]).toBe('url("https://x.org/talk/fonts/Inter.woff2")');
      // Bundled faces are never searched for; a family no folder has is left to the browser.
      expect(added).toEqual(['Inter', 'Inter']);
      await renderer.ensureFont('Latin Modern Roman');
      expect(asked.some((line) => line.includes('Latin'))).toBe(false);
      await renderer.ensureFont('Georgia');
      expect(asked.filter((line) => line.includes('Georgia')).length).toBe(FONT_VARIANT_COUNT * FONT_EXTENSION_COUNT);
    } finally {
      globalThis.FontFace = original;
      fonts.add = originalAdd;
    }
  });
});

describe('the library folders of a deck, by the command', () => {
  it('are named in the front matter or stand next to the Markdown under their standard names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoomdown-library-'));
    try {
      mkdirSync(join(dir, 'shared'));
      for (const { folder } of LIBRARY_KINDS) if (folder) mkdirSync(join(dir, 'src', folder), { recursive: true });
      writeFileSync(join(dir, 'src', 'slides.zd'), '---\nfonts: ../shared\nthemes: [../absent]\n---\n::: slide {#a}\nx\n:::\n');
      writeFileSync(join(dir, 'src', 'bare.md'), '::: slide {#a}\nx\n:::\n');
      const folders = await deckFolders(join(dir, 'src', 'slides.zd'));
      expect(folders.fonts).toEqual([join(dir, 'shared'), join(dir, 'src', 'fonts')]);
      expect(folders.codeThemes).toEqual([join(dir, 'src', 'code-themes')]);
      expect(folders.themes).toEqual([join(dir, 'src', 'themes')]);
      expect(folders.slides).toEqual([join(dir, 'src', 'slides')]);
      expect(folders.paths).toEqual([]);
      expect(folders.all.length).toBe(LIBRARY_KINDS.length);
      // A Markdown file without front matter has its standard folders only.
      const bare = await deckFolders(join(dir, 'src', 'bare.md'));
      expect(bare.effects).toEqual([join(dir, 'src', 'effects')]);
      expect(bare.fonts).toEqual([join(dir, 'src', 'fonts')]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
