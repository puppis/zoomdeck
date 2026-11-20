import { describe, expect, it } from 'vitest';
import { placeLinks, subpathBoxes } from '../src/slajdomat-links';
import { drawingLinks, partMarkup } from '../src/slajdomat';
import { svgDrawing } from '../src/svg';
import { PlayerUI } from '../src/player/ui';
import { defineDeck } from '../src/deck';
import { Slide } from '../src/slides';

// A fake text: every word a block as tall as the letters, with the proportions of a 36px font
// (line box 43.2, tallest letters 8.2 below its top, 27 high).
const HEIGHT = 43.2;
const block = (x0: number, top: number, x1: number, bottom: number) => `M${x0} ${top}H${x1}V${bottom}H${x0}V${top}Z`;
const line = (boxTop: number, words: Array<[number, number]>) => words.map(([x0, x1]) => block(x0, boxTop + 8.2, x1, boxTop + 35)).join('');
const link = (x: number, y: number, width: number) => ({ x, y, width, height: HEIGHT });

describe('the links of a Slajdomat slide', () => {
  it('read the ink of outlined text subpath by subpath', () => {
    const boxes = subpathBoxes('M10 20H30V25H10V20ZM40 0C50 -5 60 5 70 0L70 10L40 10Zm5 2h2v2h-2z');
    expect(boxes.map((box) => ({ ...box }))).toEqual([
      { x0: 10, y0: 20, x1: 30, y1: 25, rect: true },
      { x0: 40, y0: -5, x1: 70, y1: 10, rect: false },
      { x0: 45, y0: 2, x1: 47, y1: 4, rect: true },
    ]);
    expect(subpathBoxes('M0 0L10 0L5 8Z')[0].rect).toBe(false);
  });

  it('are placed line by line around the words they cover, and centered on a whole line', () => {
    const text = [line(100, [[50, 90], [100, 180], [190, 260], [270, 400]]), line(143, [[50, 120], [130, 300], [310, 380]])];
    const placed = placeLinks(text, [link(139, -0.1, 212), link(0, 42.9, 251)]) ?? [];
    expect(placed[0].x).toBeCloseTo(189, 2);
    expect(placed[1].x).toBeCloseTo(49.5, 2);
    expect(placed[0].y).toBeCloseTo(100, 1);
    expect(placed[1].y).toBeCloseTo(143, 1);
    const [centered] = placeLinks([line(0, [[300, 380], [390, 500]])], [link(250, 20, 204)]) ?? [];
    expect(centered.x).toBeCloseTo(298, 2);
    expect(placeLinks([], [link(0, 0, 10)])).toBeNull();
  });

  it('become clickable boxes in world units, in the part that holds them', () => {
    // A slide 1024 wide shown 16 units wide: 64 drawing units per world unit.
    const svg = `<svg width="1024" height="768" viewBox="0 0 1024 768" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="Slide"><rect width="1024" height="768" fill="white"/><g id="credits"><path d="${line(100, [[300, 380], [390, 500]])}" fill="black"/><a href="https://example.org/"><rect fill="black" fill-opacity="0" x="250" y="20" width="204" height="${HEIGHT}"/></a></g></g></svg>`;
    const drawing = svgDrawing(svg, { width: 16, skip: () => true });
    const links = drawingLinks(drawing, 'https://x.org/talk/');
    const [[part, [found]]] = [...links.entries()];
    expect(part.id).toBe('credits');
    expect(found.href).toBe('https://example.org/');
    // Around the words at 298 .. 502 of the line whose box starts at 100.
    expect(found.center[0]).toBeCloseTo((298 + 204 / 2 - 512) / 64, 3);
    expect(found.center[1]).toBeCloseTo(-(100 + HEIGHT / 2 - 384) / 64, 1);
    expect(found.width).toBeCloseTo(204 / 64, 6);
    expect(found.height).toBeCloseTo(HEIGHT / 64, 6);
  });
});

describe('a Slajdomat picture', () => {
  it('leaves its pattern for the image itself, clipped to its rectangle, keeping its opacity', () => {
    const svg = `<svg width="1024" height="768" viewBox="0 0 1024 768" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><g id="Slide"><rect width="1024" height="768" fill="white"/><rect id="photo" opacity="0.5" x="34" y="468" width="368" height="276" fill="url(#pattern0)"/></g><defs><pattern id="pattern0" patternContentUnits="objectBoundingBox" width="1" height="1"><use xlink:href="#image0" transform="scale(0.0025 0.0033)"/></pattern><image id="image0" width="400" height="300" preserveAspectRatio="none" xlink:href="data:image/png;base64,AAAA"/></defs></svg>`;
    const drawing = svgDrawing(svg, { width: 16 });
    const part = drawing.parts.find((candidate) => candidate.id === 'photo');
    const markup = partMarkup(part!, drawing.container);
    expect(markup).not.toContain('pattern');
    expect(markup).toMatch(/<g [^>]*id="photo" opacity="0.5"><svg [^>]*x="34" y="468" width="368" height="276" viewBox="0 0 1 1" preserveAspectRatio="none" overflow="hidden"><image [^>]*transform="scale\(0.0025 0.0033\) translate\(0 0\)"/);
    // The drawing itself is left as it was.
    expect(drawing.container.querySelector('#photo')?.tagName.toLowerCase()).toBe('rect');
  });
});

describe('a key pressed in a live page', () => {
  const deck = defineDeck({ title: 'Pages', deck: () => new Slide('root') });

  it('is the deck\'s alone when the deck has a use for it, and the page\'s otherwise', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const ui = new PlayerUI(host, deck, { embedded: true, useLocation: false, features: { camera: false, screen: false, record: false } });
    const received: string[] = [];
    ui.root.addEventListener('keydown', (event) => received.push((event as KeyboardEvent).key));
    const key = (type: string, key: string, code: string, init: KeyboardEventInit = {}) => new KeyboardEvent(type, { key, code, ...init });
    expect(ui.pageKey(key('keydown', 'ArrowRight', 'ArrowRight'))).toBe(true);
    expect(ui.pageKey(key('keyup', 'ArrowRight', 'ArrowRight'))).toBe(true);
    expect(ui.pageKey(key('keydown', 'q', 'KeyQ'))).toBe(false);
    expect(ui.pageKey(key('keyup', 'q', 'KeyQ'))).toBe(false);
    // A modifier is shared: the deck learns of it, the page keeps it too.
    expect(ui.pageKey(key('keydown', 'Shift', 'ShiftLeft', { shiftKey: true }))).toBe(false);
    expect(received).toEqual(['ArrowRight', 'Shift']);
    // Typing into a field of the page stays the page's.
    const field = document.createElement('input');
    document.body.append(field);
    const typed = key('keydown', 'ArrowRight', 'ArrowRight', { bubbles: true });
    field.addEventListener('keydown', () => expect(ui.pageKey(typed)).toBe(false), { once: true });
    field.dispatchEvent(typed);
  });
});
