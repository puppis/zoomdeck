import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deckKind, resolveDeckPath, slajdomatManifestPath } from '../bin/zoomdown.mjs';
import {
  SlajdomatSlide, isSlajdomatManifest, partBounds, partMarkup, placeholderBox, slajdomatDeck, slajdomatManifestUrl,
  type SlajdomatEvent, type SlajdomatManifest,
} from '../src/slajdomat';
import { svgDrawing } from '../src/svg';
import type { Slide } from '../src/slides';

/** A 1024 × 768 slide in Figma's shape: a frame group with a background, then its objects. */
function drawing(objects: string, defs = ''): string {
  return `<svg width="1024" height="768" viewBox="0 0 1024 768" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="Slide" clip-path="url(#clip0)"><rect width="1024" height="768" fill="white"/>${objects}</g><defs><clipPath id="clip0"><rect width="1024" height="768"/></clipPath>${defs}</defs></svg>`;
}

const show = (id: string, merged = false): SlajdomatEvent => ({ type: 'show', id, name: id, merged });
const child = (id: string, children: SlajdomatEvent[], merged = false): SlajdomatEvent => ({ type: 'child', id, name: id, merged, children });

/** The frames of Slajdomat's own viewer in tree mode: a slide's start, then one after each event not followed by a merged one. */
function slajdomatFrames(slide: SlajdomatEvent): string[] {
  const frames = [slide.name];
  const events = slide.children ?? [];
  events.forEach((event, index) => {
    if (event.type === 'child') frames.push(...slajdomatFrames(event));
    if (!events[index + 1]?.merged) frames.push(slide.name);
  });
  return frames;
}

/**
 * The stops of a slide's program, as the runtime would record them: each stop names the slide it
 * shows, a visit runs the child's program and comes back (unless the child skips the return).
 */
async function programStops(slide: Slide, config = { pauseOnEntry: false, pauseOnReturn: false }): Promise<string[]> {
  const stops: string[] = [];
  const contexts = new Map<Slide, { returnSkipped: boolean }>();
  const run = async (current: Slide): Promise<void> => {
    let showing = current;
    const ctx = {
      presenter: { config, contexts },
      mobjects: [],
      stop: () => stops.push(showing.name),
      play: async () => undefined,
      visit: (target: Slide) => ({ target }),
    };
    const program = (current as SlajdomatSlide).construct(ctx as never) as AsyncGenerator<{ target: Slide }>;
    for (let step = await program.next(); !step.done; step = await program.next()) {
      const target = step.value.target;
      await run(target);
      contexts.set(target, { returnSkipped: target.returnToParent === false });
      showing = target.returnToParent === false ? target : current;
      // Back in the parent once its program goes on.
      if (target.returnToParent !== false) showing = current;
    }
  };
  await run(slide);
  return stops;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A fetch serving a presentation at https://x.org/talk/: its manifest and one drawing per slide. */
function servePresentation(manifest: SlajdomatManifest, drawings: Record<string, string>): void {
  globalThis.fetch = (async (url: string) => {
    const path = new URL(url).pathname.replace('/talk/', '');
    const text = path === 'manifest.json' ? JSON.stringify(manifest) : drawings[decodeURI(path).replace(/\/image\.svg$/, '')];
    return {
      ok: text !== undefined,
      status: text !== undefined ? 200 : 404,
      json: async () => JSON.parse(text as string),
      text: async () => text as string,
    } as Response;
  }) as typeof fetch;
}

describe('a Slajdomat presentation', () => {
  it('is found by its manifest, its viewer page or its folder', () => {
    expect(slajdomatManifestUrl('https://x.org/talk/manifest.json')).toBe('https://x.org/talk/manifest.json');
    expect(slajdomatManifestUrl('https://x.org/talk/index.html?step=3#x')).toBe('https://x.org/talk/manifest.json');
    expect(slajdomatManifestUrl('https://x.org/talk/')).toBe('https://x.org/talk/manifest.json');
    expect(slajdomatManifestUrl('https://x.org/talk')).toBe('https://x.org/talk/manifest.json');
    expect(isSlajdomatManifest({ tree: { type: 'child', id: 'root', name: 'Root' } })).toBe(true);
    expect(isSlajdomatManifest({ title: 'A deck' })).toBe(false);
  });

  it('places a child where its placeholder is, and draws a part alone with what it uses', () => {
    const svg = drawing(
      '<rect id="kid" x="512" y="384" width="256" height="192" fill="#ccc"/><path id="part" d="M0 0 L100 0 L100 100 Z" fill="url(#shade)"/>',
      '<linearGradient id="shade"><stop stop-color="red"/></linearGradient><linearGradient id="unused"/>',
    );
    const frame = svgDrawing(svg, { width: 16, skip: () => true });
    expect(placeholderBox(frame, 'kid')).toEqual({ center: [2, -1.5, 0], width: 4, height: 3 });
    expect(placeholderBox(frame, 'nothing')).toBeNull();
    const parts = svgDrawing(svg, { width: 16 }).parts;
    const part = parts.find((candidate) => candidate.id === 'part');
    expect(part).toBeDefined();
    const markup = partMarkup(part!, frame.container);
    // The gradient it fills with and the frame's clip come along, nothing else; the root's fill="none" still applies.
    expect(markup).toContain('id="shade"');
    expect(markup).toContain('id="clip0"');
    expect(markup).not.toContain('unused');
    expect(markup).toMatch(/^<defs>.*<\/defs><g fill="none"[^>]*><g clip-path="url\(#clip0\)"><path/);
    const bounds = partBounds(part!);
    expect(bounds?.minX).toBeCloseTo(-8, 9);
    expect(bounds?.maxX).toBeCloseTo(-8 + 100 / 64, 9);
    expect(bounds?.maxY).toBeCloseTo(6, 9);
    expect(bounds?.minY).toBeCloseTo(6 - 100 / 64, 9);
  });

  it('stops where Slajdomat does: on entry, after each event and its merged ones, from one merged child straight to the next', async () => {
    const tree = child('root', [
      show('title'),
      show('a'),
      show('b', true),
      child('first', [show('x'), show('y', true)]),
      child('second', [show('z')], true),
      child('third', []),
      show('c'),
    ]);
    tree.name = 'Root';
    const drawings: Record<string, string> = {
      root: drawing(['first', 'second', 'third'].map((id, i) => `<rect id="${id}" x="${100 + 300 * i}" y="400" width="200" height="150" fill="#ccc"/>`).join('')),
      first: drawing(''),
      second: drawing(''),
      third: drawing(''),
    };
    servePresentation({ presentation: 'A talk', tree }, drawings);
    const deck = await slajdomatDeck({ url: 'https://x.org/talk/index.html' });
    expect(deck.title).toBe('A talk');
    expect(deck.viewport).toEqual({ width: 1024, height: 768 });
    const root = (await deck.deck()) as SlajdomatSlide;
    expect(root.children.map((slide) => [slide.name, slide.returnToParent])).toEqual([['first', false], ['second', true], ['third', true]]);
    expect(await programStops(root)).toEqual(slajdomatFrames(tree));
  });
});

describe('the command and a Slajdomat presentation', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('serves it by its folder, its index.html or its manifest, and builds no export of it', () => {
    dir = mkdtempSync(join(tmpdir(), 'zoomdown-slajdomat-'));
    const talk = join(dir, 'talk');
    mkdirSync(talk);
    writeFileSync(join(talk, 'manifest.json'), JSON.stringify({ presentation: 'Talk', tree: { type: 'child', id: 'root', name: 'Root', children: [] } }));
    writeFileSync(join(talk, 'index.html'), '<!doctype html>');
    const manifest = join(talk, 'manifest.json');
    for (const path of [talk, join(talk, 'index.html'), manifest]) expect(resolveDeckPath(path)).toBe(manifest);
    expect(deckKind(manifest)).toBe('slajdomat');
    // Any other JSON file is still no deck, and a page without a manifest is none either.
    writeFileSync(join(dir, 'deck.json'), '{}');
    expect(() => resolveDeckPath(join(dir, 'deck.json'))).toThrow(/front matter/);
    writeFileSync(join(dir, 'page.html'), '<!doctype html>');
    expect(slajdomatManifestPath(join(dir, 'page.html'))).toBeNull();
  });
});
