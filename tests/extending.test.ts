import { afterEach, describe, expect, it } from 'vitest';
import { Circle, Group, Rectangle, VGroup } from 'manim-web';
import { expandImports, fillSnippet } from '../src/markup/imports';
import { ASTTransformer, MarkupParser } from '../src/markup/parser';
import { ElementSpec, IncludeSpec, MarkupError } from '../src/markup/ast';
import { chartDataFromJson } from '../src/charts';
import { applyTheme, loadMarkupDeck, markupDeck, parseTheme } from '../src/markup/deck';
import { directiveFromModule, type DirectiveOptions } from '../src/directives';
import { Presenter, PresenterConfig, transitionFromModule, type CameraTransition } from '../src/runtime';
import { Slide, pageSequence } from '../src/slides';
import { LayoutConfig, boundaryPoint } from '../src/markup/renderer';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deckFolders } from '../bin/zoomdown.mjs';

describe('snippets', () => {
  const load = async () => {
    throw new Error('no imports here');
  };

  it('expand a block defined in place, filling placeholders from the use, with origins in the block', async () => {
    const main = [
      '::: snippet card',
      '::: slide {#{{id}} width=20}',
      '## {{title}}',
      '[{{note|A note}}]{#{{id}}-note x=0 y=-2}',
      ':::',
      ':::',
      '',
      '[[snippet: card id=one title="First card"]]',
      '[[snippet: card id=two title="Second card" note="Another note"]]',
    ].join('\n');
    const { source, origins } = await expandImports(main, { load });
    const document = new MarkupParser().parse(source);
    expect(document.slides.map((slide) => slide.id)).toEqual(['one', 'two']);
    const lines = source.split('\n');
    expect(lines.slice(0, 6).every((line) => line === '')).toBe(true);
    const first = lines.findIndex((line) => line.startsWith('## First card'));
    expect(origins[first]).toEqual({ file: '', line: 3 });
    expect(source).toContain('[A note]{#one-note x=0 y=-2}');
    expect(source).toContain('[Another note]{#two-note x=0 y=-2}');
  });

  it('take any argument name as written, style and color included', async () => {
    const main = [
      '::: snippet edge',
      '[[line: (0,0) -> (1,0), #{{id}}, .{{style|thin}} color={{color|BLUE}}]]',
      ':::',
      '',
      '::: slide {#a}',
      '[[snippet: edge id=e style=heavy-edge color=RED]]',
      ':::',
    ].join('\n');
    const { source } = await expandImports(main, { load });
    expect(source).toContain('[[line: (0,0) -> (1,0), #e, .heavy-edge color=RED]]');
    // Outside a snippet's arguments, style= is still CSS.
    expect(() => new MarkupParser().parse('::: slide {#a}\n[t]{#t style=heavy-edge}\n:::')).toThrow(/CSS declaration/);
  });

  it('come from the snippets folders otherwise, and name what is missing', async () => {
    const snippet = async (name: string) => (name === 'frame' ? '[[rectangle: #{{id}} x={{x}} y=0 width=4 height=2]]' : null);
    const { source, origins } = await expandImports('::: slide {#a}\n[[snippet: frame id=f x=3]]\n:::', { load, snippet });
    expect(source).toContain('[[rectangle: #f x=3 y=0 width=4 height=2]]');
    expect(origins[1]).toEqual({ file: 'snippets/frame.zd', line: 1 });
    // A loader that says which file it read, such as an older deck's frame.md, is named by it.
    const named = async (name: string) => (name === 'frame' ? { text: '[[dot: #{{id}} x=0 y=0]]', file: 'snippets/frame.md' } : null);
    expect((await expandImports('::: slide {#a}\n[[snippet: frame id=f]]\n:::', { load, snippet: named })).origins[1]).toEqual({ file: 'snippets/frame.md', line: 1 });
    await expect(expandImports('[[snippet: frame id=f]]', { load, snippet })).rejects.toThrow(/snippet frame needs x=/);
    await expect(expandImports('[[snippet: nope id=f]]', { load, snippet })).rejects.toThrow(/unknown snippet nope/);
    await expect(expandImports('::: snippet loop\n[[snippet: loop]]\n:::\n[[snippet: loop]]', { load })).rejects.toThrow(/uses itself/);
    expect(fillSnippet('s', 'a {{ x | 1 }} b', {}, 'Line 1')).toBe('a 1 b');
  });
});

describe('directives of the deck\'s own', () => {
  it('are any [[name: …]] the dialect does not know, with free attributes', () => {
    const document = new MarkupParser().parse('::: slide {#a}\n[[gauge: #g x=1 y=2 level=0.7 label="load"]]\n:::');
    const item = document.slides[0].items.find((entry): entry is ElementSpec => entry instanceof ElementSpec && entry.kind === 'custom');
    expect(item?.source).toBe('gauge');
    expect(item?.attributes).toMatchObject({ id: 'g', x: '1', y: '2', level: '0.7', label: 'load' });
    expect(() => new MarkupParser().parse('::: slide {#a}\n[[snippet: card id=x]]\n:::')).toThrow(/Unknown snippet/);
  });

  it('draw what their module returns, several parts grouped', async () => {
    const options = { name: 'gauge', attributes: { level: '0.5' }, color: '#000', fontSize: 28, width: 10, foreground: '#000', layout: new LayoutConfig({}), sketch: null } as unknown as DirectiveOptions;
    expect(await directiveFromModule({ default: () => new Circle() }, options)).toBeInstanceOf(Circle);
    expect(await directiveFromModule({ directive: () => [new Circle(), new VGroup()] }, options)).toBeInstanceOf(Group);
    await expect(directiveFromModule({}, options)).rejects.toThrow(/exports a function/);
    await expect(directiveFromModule({ default: () => [] }, options)).rejects.toThrow(/drew nothing/);
  });
});

describe('a PDF inside a slide', () => {
  it('is an include of a placeholder that carries the file', () => {
    const document = new MarkupParser().parse('::: slide {#a}\n[[pdf: assets/paper.pdf #pages x=0 y=-1 width=18 preview]]\n:::');
    const include = document.slides[0].items.find((item) => item instanceof IncludeSpec) as IncludeSpec;
    expect(include.target).toBe('pages');
    expect(include.attributes).toMatchObject({ src: 'assets/paper.pdf', width: '18', preview: 'true' });
    const pages = document.slides.find((slide) => slide.id === 'pages');
    expect(pages?.placeholder).toBe(true);
    expect(pages?.attributes.src).toBe('assets/paper.pdf');
    // A document validated once validates again (the slide builder does so).
    expect(() => new ASTTransformer().validate(document)).not.toThrow();
    expect(() => new MarkupParser().parse('::: slide {#a}\n[[pdf: assets/paper.pdf x=0]]\n:::')).toThrow(/explicit #id/);
    expect(() => new MarkupParser().parse('::: slide {#a}\n[[pdf: assets/paper.pdf #a x=0]]\n:::')).toThrow(/id of its own/);
  });
});

describe('a stacked page sequence', () => {
  it('has the size of a page, every page at its center, the first one shown ahead', () => {
    const a = new Slide('a', { width: 16, height: 9 });
    const b = new Slide('b', { width: 16, height: 9 });
    const stack = pageSequence([a, b], { name: 'doc', stack: true });
    expect(stack.hidden).toBe(true);
    expect([stack.width, stack.height]).toEqual([16, 9]);
    expect(a.preview).toBe(true);
    expect(b.preview).toBe(false);
    const row = pageSequence([new Slide('c', { width: 16, height: 9 }), new Slide('d', { width: 16, height: 9 })], { spacing: 1.15 });
    expect(row.width).toBeCloseTo(2 * 1.15 * 16);
  });
});

describe('connection ends', () => {
  it('leave an element where the line between the centers crosses its box, a side for a nearly level line', () => {
    const box = new Rectangle({ width: 4, height: 2 });
    box.moveTo([10, -0.9, 0]);
    expect(boundaryPoint(box, [3, 1e-12, 0]).map((v) => +v.toFixed(3))).toEqual([12, -0.9, 0]);
    expect(boundaryPoint(box, [-3, 0, 0]).map((v) => +v.toFixed(3))).toEqual([8, -0.9, 0]);
    expect(boundaryPoint(box, [0, 5, 0]).map((v) => +v.toFixed(3))).toEqual([10, 0.1, 0]);
    // A steep diagonal leaves through the top, on the line itself.
    const [x, y] = boundaryPoint(box, [1, 2, 0]);
    expect(y).toBeCloseTo(0.1);
    expect(x).toBeCloseTo(10.5);
  });
});

describe('camera transitions of the deck\'s own', () => {
  it('are kept by name in the presenter configuration, which accepts any name as the default', () => {
    const config = new PresenterConfig({ transition: 'swoop', transitions: { swoop: (start) => start } });
    expect(config.transition).toBe('swoop');
    expect(Object.keys(config.transitions)).toEqual(['swoop']);
    expect(() => new PresenterConfig({ transition: 'no way' })).toThrow(/zoom, cut, or the name/);
    expect(transitionFromModule({ default: (_start, target) => target }, 'swoop')({ center: [0, 0, 0], width: 1 }, { center: [1, 1, 0], width: 2 }, 0.5)).toEqual({ center: [1, 1, 0], width: 2 });
    expect(() => transitionFromModule({}, 'swoop')).toThrow(/exports a function/);
  });

  it('belong to the destination of a move: the slide being left has no say', () => {
    const parent = new Slide('parent');
    const a = new Slide('a', { transition: 'cut' });
    const b = new Slide('b');
    parent.addChild(a, { center: [-3, 0, 0], width: 4 });
    parent.addChild(b, { center: [3, 0, 0], width: 4 });
    const swoop: CameraTransition = (start) => start;
    const presenter = new Presenter({ config: new PresenterConfig({ transition: 'swoop', transitions: { swoop } }) });
    expect(presenter.transitionMode(parent, a)).toBe('cut');
    expect(presenter.transitionTime(parent, a)).toBe(0);
    expect(presenter.transitionMode(a, parent)).toBe('swoop');
    expect(presenter.transitionPath(a, parent)).toBe(swoop);
    expect(presenter.transitionMode(a, b)).toBe('swoop');
    expect(presenter.transitionTime(a, b)).toBe(presenter.config.transitionTime);
    // The pages of a flat document cut, unless the page arrived at says otherwise.
    const root = new Slide('root', { hidden: true });
    const one = new Slide('one');
    const two = new Slide('two', { transition: 'zoom' });
    const three = new Slide('three');
    const leaf = new Slide('leaf');
    root.addChild(one, { center: [0, 0, 0], width: 4 });
    root.addChild(two, { center: [5, 0, 0], width: 4 });
    root.addChild(three, { center: [10, 0, 0], width: 4 });
    three.addChild(leaf, { center: [0, 0, 0], width: 2 });
    expect(presenter.transitionMode(one, two)).toBe('zoom');
    expect(presenter.transitionPath(one, two)).toBeNull();
    expect(presenter.transitionMode(two, one)).toBe('cut');
    expect(presenter.transitionMode(two, three)).toBe('cut');
    // Inside a tree every move is smooth, the way back out to the root included; so is a jump into the middle of another tree.
    expect(presenter.transitionMode(three, leaf)).toBe('swoop');
    expect(presenter.transitionMode(leaf, three)).toBe('swoop');
    expect(presenter.transitionMode(leaf, one)).toBe('cut');
    expect(presenter.transitionMode(one, leaf)).toBe('swoop');
    // A document inside a slide: a zoom into its first page, cuts between its pages, a zoom back out.
    const holder = new Slide('holder');
    const pages = new Slide('pages', { hidden: true });
    const p1 = new Slide('p1');
    const p2 = new Slide('p2');
    pages.addChild(p1, { center: [0, 0, 0], width: 4 });
    pages.addChild(p2, { center: [5, 0, 0], width: 4 });
    holder.addChild(pages, { center: [0, 0, 0], width: 8 });
    expect(presenter.transitionMode(holder, p1)).toBe('swoop');
    expect(presenter.transitionMode(p1, p2)).toBe('cut');
    expect(presenter.transitionMode(p2, holder)).toBe('swoop');
  });
});

describe('chart data from files', () => {
  it('is JSON in three shapes, or CSV rows', () => {
    expect(chartDataFromJson({ categories: ['A', 'B'], series: [{ name: 's', values: [1, 2] }] })).toEqual({ categories: ['A', 'B'], series: [{ name: 's', values: [1, 2] }] });
    expect(chartDataFromJson({ labels: ['A'], datasets: [{ label: 'd', data: ['3'] }] })).toEqual({ categories: ['A'], series: [{ name: 'd', values: [3] }] });
    expect(chartDataFromJson([['Region', '2023'], ['North', 3], ['South', 4]])).toEqual({ categories: ['North', 'South'], series: [{ name: '2023', values: [3, 4] }] });
    expect(() => chartDataFromJson({ nope: 1 })).toThrow(/JSON chart data/);
    expect(() => chartDataFromJson({ categories: ['A'], series: [{ values: ['x'] }] })).toThrow(/not a number/);
  });

  it('is asked for with src= on a fence that has no rows', () => {
    const parse = (text: string) => new MarkupParser().parse(`::: slide {#a}\n${text}\n:::`);
    expect(() => parse('```chart {#c src=data.csv}\n```')).not.toThrow();
    expect(() => parse('```chart {#c}\n```')).toThrow(/src= naming/);
    expect(() => parse('```chart {#c src=data.csv}\nA, 1\n```')).toThrow(/not both/);
  });
});

describe('themes', () => {
  it('carry styles and, under reserved names, the layout, presenter settings, background and viewport', () => {
    const theme = parseTheme('::: styles\nheading: color=BLUE_E\nlayout: fontSize=30 headingSize=44\npresenter: transitionTime=1.2 pauseOnReturn=false\ndeck: background=#0F172A viewport=4x3\n:::');
    expect(theme.styles).toMatchObject({ heading: { color: 'BLUE_E' } });
    expect(theme.layout).toEqual({ fontSize: 30, headingSize: 44 });
    expect(theme.presenter).toEqual({ transitionTime: 1.2, pauseOnReturn: false });
    expect(theme.background).toBe('#0F172A');
    expect(theme.viewport).toEqual({ width: 4, height: 3 });
    expect(() => parseTheme('deck: viewport=wide')).toThrow(/16x9/);
  });

  it('sit under the deck\'s own settings', () => {
    const merged = applyTheme({ source: 'x', styles: { heading: 'color=RED' }, layout: { fontSize: 26 }, background: '#fff' }, {
      styles: { heading: 'color=BLUE', body: 'font_size=30' }, layout: { fontSize: 30, headingSize: 44 }, presenter: { transitionTime: 1 }, background: '#000', viewport: { width: 4, height: 3 },
    });
    expect(merged.styles).toEqual({ heading: 'color=RED', body: 'font_size=30' });
    expect(merged.layout).toEqual({ fontSize: 26, headingSize: 44 });
    expect(merged.presenter).toEqual({ transitionTime: 1 });
    expect(merged.background).toBe('#fff');
    expect(merged.viewport).toEqual({ width: 4, height: 3 });
    expect(merged.theme).toBeUndefined();
  });

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('are loaded before the player starts, from the bundle or the themes folders', async () => {
    const bundled = await loadMarkupDeck({
      source: '::: slide {#a}\nx\n:::', basePath: 'x', theme: ['lecture', 'dark'], themes: ['themes/0/'],
      files: { 'themes/0/lecture.md': 'layout: fontSize=30\npresenter: transitionTime=1.5' },
      assets: { 'themes/0/dark.md': `data:text/markdown;base64,${Buffer.from('deck: background=#000\npresenter: transitionTime=2').toString('base64')}` },
    });
    expect(bundled.background).toBe('#000');
    expect(bundled.presenter.transitionTime).toBe(2);
    globalThis.fetch = (async (url: string) => {
      const deck = url === 'https://x.org/talk/slides.md';
      const found = deck || url === 'https://x.org/talk/themes/lecture.md';
      return { ok: found, status: found ? 200 : 404, headers: new Headers({ 'content-type': found ? 'text/markdown' : 'text/html' }), text: async () => (deck ? '::: slide {#a}\nx\n:::' : 'deck: background=#123456') } as Response;
    }) as typeof fetch;
    const fetched = await loadMarkupDeck({ url: 'https://x.org/talk/slides.md', theme: 'lecture' });
    expect(fetched.background).toBe('#123456');
    await expect(loadMarkupDeck({ url: 'https://x.org/talk/slides.md', theme: 'missing' })).rejects.toThrow(/No theme missing/);
    expect(() => markupDeck({ source: 'x', theme: 'lecture' })).toThrow(/loadMarkupDeck/);
  });
});

describe('the command', () => {
  it('finds the directives, snippets and transitions folders next to the Markdown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoomdown-extending-'));
    try {
      for (const folder of ['directives', 'snippets', 'transitions']) mkdirSync(join(dir, folder));
      writeFileSync(join(dir, 'slides.zd'), '::: slide {#a}\nx\n:::\n');
      const folders = await deckFolders(join(dir, 'slides.zd'));
      expect(folders.directives).toEqual([join(dir, 'directives')]);
      expect(folders.snippets).toEqual([join(dir, 'snippets')]);
      expect(folders.transitions).toEqual([join(dir, 'transitions')]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
