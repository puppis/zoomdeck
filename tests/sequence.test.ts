import { describe, expect, it } from 'vitest';
import { MarkupParser } from '../src/markup/parser';
import { SlideBuilder } from '../src/markup/slide';
import { parseAttributes } from '../src/markup/ast';
import { Slide, pageSequence, walk } from '../src/slides';
import { Presenter, PresenterConfig, commonAncestor } from '../src/runtime';
import { BASE_PAGE_PIXELS, MAX_PAGE_PIXELS, pagePixels } from '../src/pdfdeck';

describe('the return choice', () => {
  it('is unset by default, and either side of it decides it', () => {
    expect(new Slide('a').returnToParent).toBeNull();
    expect(new Slide('a').skipReturn).toBe(false);
    expect(new Slide('a', { skipReturn: true }).returnToParent).toBe(false);
    expect(new Slide('a', { skipReturn: false }).returnToParent).toBe(true);
    expect(new Slide('a', { returnToParent: true }).skipReturn).toBe(false);
    expect(new Slide('a', { returnToParent: false }).skipReturn).toBe(true);
    expect(new Slide('a', { returnToParent: false, skipReturn: true }).returnToParent).toBe(false);
    expect(() => new Slide('a', { returnToParent: true, skipReturn: true })).toThrow(/contradict/);
    const slide = new Slide('a');
    slide.skipReturn = true;
    expect(slide.returnToParent).toBe(false);
    slide.skipReturn = false;
    expect(slide.returnToParent).toBe(true);
    const parent = new Slide('p', { width: 16 });
    const child = parent.addChild(new Slide('c'), { returnToParent: null });
    expect(child.returnToParent).toBeNull();
    parent.addChild(new Slide('d'), { skipReturn: true });
    expect(parent.children[1].returnToParent).toBe(false);
  });

  it('is written as skip_return or return_to_parent, bare or with a value, but not both', () => {
    expect(parseAttributes('skip_return', 1)).toEqual({ skip_return: 'true' });
    expect(parseAttributes('return_to_parent preview', 1)).toEqual({ return_to_parent: 'true', preview: 'true' });
    expect(() => parseAttributes('sideways', 1)).toThrow(/Expected an attribute/);
    const source = (attrs: string) => `::: slide {#r}\n[[include: #a ${attrs}]]\n[[include: #b]]\n:::\n::: slide {#a}\nx\n:::\n::: slide {#b}\ny\n:::`;
    const build = (attrs: string) => new SlideBuilder().build(new MarkupParser().parse(source(attrs)));
    expect(build('').children[0].returnToParent).toBeNull();
    expect(build('skip_return').children[0].returnToParent).toBe(false);
    expect(build('skip_return=false').children[0].returnToParent).toBe(true);
    expect(build('return_to_parent').children[0].returnToParent).toBe(true);
    expect(build('return_to_parent=false').children[0].returnToParent).toBe(false);
    expect(() => build('skip_return return_to_parent')).toThrow(/not both/);
    expect(() => build('return_to_parent=maybe')).toThrow(/must be true or false/);
    const own = new MarkupParser().parse('::: slide {#r}\n[[include: #a]]\n:::\n::: slide {#a return_to_parent}\nx\n:::');
    expect(new SlideBuilder().build(own).children[0].returnToParent).toBe(true);
  });
});

describe('a flat sequence of pages', () => {
  const PAGES = '::: slide {#one}\n# One\n:::\n\n::: slide {#two}\n# Two\n[[include: #child]]\n:::\n\n::: slide {#child}\nc\n:::\n\n::: slide {#three transition=zoom}\n# Three\n:::';

  it('is what several top-level slides parse to, in document order', () => {
    const document = new MarkupParser().parse(PAGES);
    expect(document.sequence).toBe(true);
    expect(document.roots).toEqual(['one', 'two', 'three']);
    expect(document.root).toBe('one');
    const tree = new MarkupParser().parse('::: slide {#r}\n[[include: #a]]\n:::\n::: slide {#a}\nx\n:::');
    expect(tree.sequence).toBe(false);
    expect(tree.roots).toEqual(['r']);
    expect(() => new MarkupParser().parse(PAGES, { root: 'two' })).toThrow(/sequence of 3 top-level slides/);
  });

  it('hangs the pages from a hidden root that cuts between them and shows them at once', () => {
    const root = new SlideBuilder().build(new MarkupParser().parse(PAGES));
    expect(root.hidden).toBe(true);
    expect(root.children.map((page) => page.name)).toEqual(['One', 'Two', 'Three']);
    expect([...walk(root)].length).toBe(5);
    const [one, two, three] = root.children;
    expect(one.transition).toBeNull();
    expect(three.transition).toBe('zoom');
    // Moves between pages cut (their common ancestor is the hidden root); moves inside a page zoom.
    const presenter = new PresenterConfig();
    const times = (a: Slide, b: Slide) => Presenter.prototype.transitionTime.call({ config: presenter }, a, b);
    expect(times(one, two)).toBe(0);
    expect(times(two.children[0], one)).toBe(0);
    expect(times(two, two.children[0])).toBe(presenter.transitionTime);
    expect(times(two.children[0], two)).toBe(presenter.transitionTime);
    // A page that asks for a zoom pans to its neighbours instead.
    expect(times(two, three)).toBe(presenter.transitionTime);
    expect(times(two.children[0], three)).toBe(presenter.transitionTime);
    expect(commonAncestor(one, two)).toBe(root);
    expect(commonAncestor(two.children[0], two)).toBe(two);
    expect(commonAncestor(one, new Slide('elsewhere'))).toBeNull();
    expect(one.preview).toBe(true);
    expect(two.children[0].preview).toBe(false);
    expect(two.children[0].transition).toBeNull();
    // Pages sit on one row, far enough apart that a padded view of one never reaches the next.
    const centers = root.children.map((page) => (page.viewport as { getCenter(): number[] }).getCenter()[0]);
    expect(centers[1] - centers[0]).toBeCloseTo(centers[2] - centers[1]);
    expect(centers[1] - centers[0]).toBeGreaterThanOrEqual(3 * Math.max(one.width, one.height) - 1e-9);
    expect(centers[0] + centers[2]).toBeCloseTo(0);
  });

  it('is built from slides by pageSequence', () => {
    const tall = new Slide('tall', { width: 8, height: 12 });
    const wide = new Slide('wide', { width: 16, height: 9 });
    const root = pageSequence([tall, wide], { name: 'Pages' });
    expect(root.name).toBe('Pages');
    expect(root.hidden).toBe(true);
    expect(root.height).toBe(12);
    expect(root.width).toBe(2 * 3 * 16);
    expect(tall.parent).toBe(root);
    expect(() => pageSequence([])).toThrow(/at least one/);
    expect(() => pageSequence([wide])).toThrow(/parent already/);
  });
});

describe('the pictures of PDF pages', () => {
  it('are drawn at the density of the screen, within the base and the cap', () => {
    expect(pagePixels(16, 100)).toBe(1600);
    expect(pagePixels(16, 1)).toBe(BASE_PAGE_PIXELS);
    expect(pagePixels(16, 1e6)).toBe(MAX_PAGE_PIXELS);
    expect(pagePixels(16, Infinity)).toBe(BASE_PAGE_PIXELS);
  });
});
