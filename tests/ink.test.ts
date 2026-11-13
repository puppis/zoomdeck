import { describe, expect, it } from 'vitest';
import { DEFAULT_PEN_STYLE, InkSurface, PEN_PRESETS, newStrokeId, outlinePath, resample, sanitizePenStyle, strokeOutline, type InkStroke } from '../src/player/ink';
import { padUrl } from '../src/player/pad';
import { lanAddresses, listensOnLan } from '../bin/relay.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

function stroke(id: string, points: Array<[number, number, number?]>, tool: InkStroke['tool'] = 'pen'): InkStroke {
  return { id, tool, color: '#000', size: 6, pressure: points.some((p) => p[2] !== undefined), samples: points.map(([x, y, p]) => ({ x, y, p: p ?? 0.5 })) };
}

describe('stroke outlines', () => {
  it('turns an outline into a closed path and a stroke into a filled shape', () => {
    expect(outlinePath([])).toBe('');
    expect(outlinePath([[1, 2]])).toBe('M 1 2 Z');
    const d = strokeOutline(stroke('a', [[0, 0], [10, 0], [20, 5], [30, 5]]), DEFAULT_PEN_STYLE);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.split(' ').length).toBeGreaterThan(20);
  });

  it('widens a pen stroke under pressure but keeps a highlighter constant', () => {
    const extent = (d: string) => {
      const numbers = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      const ys = numbers.filter((_, i) => i % 2 === 1);
      return Math.max(...ys) - Math.min(...ys);
    };
    const light = strokeOutline(stroke('l', [[0, 0, 0.2], [20, 0, 0.2], [40, 0, 0.2], [60, 0, 0.2]]), { ...DEFAULT_PEN_STYLE, ...PEN_PRESETS.fountain, taper: false });
    const hard = strokeOutline(stroke('h', [[0, 0, 0.9], [20, 0, 0.9], [40, 0, 0.9], [60, 0, 0.9]]), { ...DEFAULT_PEN_STYLE, ...PEN_PRESETS.fountain, taper: false });
    expect(extent(hard)).toBeGreaterThan(extent(light) * 1.5);
    const marker = (p: number) => strokeOutline(stroke('m', [[0, 0, p], [20, 0, p], [40, 0, p], [60, 0, p]], 'highlighter'), DEFAULT_PEN_STYLE);
    expect(Math.abs(extent(marker(0.2)) - extent(marker(0.9)))).toBeLessThan(0.01);
    // A lower pencil pressure factor draws a real-pressure stroke lighter; it leaves mouse strokes alone.
    const pencil = (factor: number) => strokeOutline(stroke('p', [[0, 0, 0.8], [20, 0, 0.8], [40, 0, 0.8], [60, 0, 0.8]]), { ...DEFAULT_PEN_STYLE, ...PEN_PRESETS.fountain, taper: false, pencilPressure: factor });
    expect(extent(pencil(0.5))).toBeLessThan(extent(pencil(1)));
    const mouse = (factor: number) => strokeOutline(stroke('m', [[0, 0], [20, 0], [40, 0], [60, 0]]), { ...DEFAULT_PEN_STYLE, pencilPressure: factor, pencilWidth: factor, simulatePressure: false });
    expect(extent(mouse(0.5))).toBe(extent(mouse(1)));
    const width = (factor: number) => strokeOutline(stroke('w', [[0, 0, 0.5], [20, 0, 0.5], [40, 0, 0.5], [60, 0, 0.5]]), { ...DEFAULT_PEN_STYLE, pencilWidth: factor, taper: false });
    expect(extent(width(0.5)) / extent(width(1))).toBeCloseTo(0.5, 1);
  });

  it('fills the gaps of a fast stroke with points on a smooth curve', () => {
    const sparse = [{ x: 0, y: 0, p: 0.2 }, { x: 30, y: 0, p: 0.4 }, { x: 60, y: 30, p: 0.6 }, { x: 60, y: 60, p: 0.8 }];
    const dense = resample(sparse, 3);
    expect(dense.length).toBeGreaterThan(sparse.length * 5);
    expect(dense[0]).toEqual(sparse[0]);
    expect(dense[dense.length - 1]).toEqual(sparse[sparse.length - 1]);
    const between = dense.filter((s) => s.x > 1 && s.x < 29);
    expect(between.every((s) => s.p > 0.2 && s.p < 0.4)).toBe(true);
    expect(resample([{ x: 0, y: 0, p: 0.5 }, { x: 1, y: 1, p: 0.5 }, { x: 2, y: 2, p: 0.5 }], 3).length).toBe(3);
  });

  it('sanitizes a saved pen style field by field', () => {
    expect(sanitizePenStyle(null)).toEqual(DEFAULT_PEN_STYLE);
    const fixed = sanitizePenStyle({ preset: 'brush', thinning: 7, smoothing: 'x', taper: true });
    expect(fixed.preset).toBe('brush');
    expect(fixed.thinning).toBe(1);
    expect(fixed.smoothing).toBe(DEFAULT_PEN_STYLE.smoothing);
    expect(fixed.taper).toBe(true);
    expect(newStrokeId('pad')).toMatch(/^pad-/);
  });
});

describe('ink surfaces', () => {
  const style = () => DEFAULT_PEN_STYLE;
  const svg = () => document.createElementNS(SVG_NS, 'svg');

  it('keeps its own copy of a stroke, so that a replayed timeline is not changed by extending it', () => {
    // A recording hands the same stroke object to the surface at every seek; the samples pushed
    // while it is extended must not pile up on it, or the path doubles back on itself.
    const recorded = stroke('r', [[0, 0]]);
    const extension = [{ x: 10, y: 0, p: 0.5 }, { x: 20, y: 5, p: 0.5 }];
    for (let replay = 0; replay < 3; replay++) {
      const surface = new InkSurface(svg(), style);
      surface.begin(recorded);
      surface.extend('r', extension);
      surface.end('r');
      expect(surface.strokes[0].samples).toHaveLength(3);
    }
    expect(recorded.samples).toHaveLength(1);
  });

  it('keeps separate histories for the slide and the whiteboard', () => {
    const slide = new InkSurface(svg(), style);
    const board = new InkSurface(svg(), style);
    slide.begin(stroke('s1', [[0, 0], [5, 5]]));
    slide.end('s1');
    board.begin(stroke('b1', [[0, 0], [5, 5]]));
    board.end('b1');
    board.begin(stroke('b2', [[1, 1], [6, 6]]));
    board.end('b2');
    expect(board.undo()?.id).toBe('b2');
    expect(slide.strokes.map((s) => s.id)).toEqual(['s1']);
    expect(board.strokes.map((s) => s.id)).toEqual(['b1']);
    expect(board.redo()?.id).toBe('b2');
    // Clearing erases newest first; undo brings the strokes back one by one, oldest erasure last.
    expect(board.clear().map((s) => s.id)).toEqual(['b2', 'b1']);
    expect(board.redo()).toBeNull();
    expect(board.undo()?.id).toBe('b1');
    expect(board.undo()?.id).toBe('b2');
    expect(board.strokes.map((s) => s.id)).toEqual(['b1', 'b2']);
    expect(slide.group.querySelectorAll('path').length).toBe(1);
  });

  it('extends a live stroke, drops double-click dots and pans the whiteboard', () => {
    const surface = new InkSurface(svg(), style, 'board-ink');
    surface.begin(stroke('live', [[0, 0]]));
    surface.extend('live', [{ x: 3, y: 0, p: 0.5 }, { x: 6, y: 0, p: 0.5 }]);
    surface.end('live');
    surface.extend('live', [{ x: 9, y: 0, p: 0.5 }]);
    expect(surface.strokes[0].samples.length).toBe(3);
    surface.flush();
    expect(surface.group.querySelector('path')?.getAttribute('d')?.startsWith('M ')).toBe(true);
    surface.begin(stroke('tap1', [[0, 0]]));
    surface.end('tap1');
    surface.begin(stroke('tap2', [[0, 0]]));
    surface.end('tap2');
    expect(surface.dropRecentTaps(2, 1500)).toBe(2);
    expect(surface.strokes.map((s) => s.id)).toEqual(['live']);
    expect(surface.redo()).toBeNull();
    surface.setPan(120, -40);
    expect(surface.group.getAttribute('transform')).toBe('translate(-120 40)');
    expect(surface.pan).toEqual({ x: 120, y: -40 });
    surface.replace([stroke('r1', [[0, 0], [1, 1]])]);
    expect(surface.strokes.map((s) => s.id)).toEqual(['r1']);
    surface.setPressure('r1', true);
    expect(surface.strokes[0].pressure).toBe(true);
    surface.begin(stroke('live2', [[0, 0]]));
    surface.drawLive('live2', [{ x: 30, y: 0, p: 0.5 }, { x: 60, y: 0, p: 0.5 }]);
    const path = surface.group.querySelector('path:last-of-type') as SVGPathElement;
    expect(path.getAttribute('d')?.length).toBeGreaterThan(20);
    expect(surface.strokes[1].samples.length).toBe(1);
  });

  it('erases the stroke under a fingertip and undoes the erasure in place', () => {
    const surface = new InkSurface(svg(), style);
    for (const [id, y] of [['a', 0], ['b', 50], ['c', 100]] as const) {
      surface.begin(stroke(id, [[0, y], [100, y]]));
      surface.end(id);
    }
    expect(surface.strokeAt(50, 53, 5)).toBe('b');
    expect(surface.strokeAt(50, 70, 5)).toBeNull();
    expect(surface.erase('b')?.id).toBe('b');
    expect(surface.strokes.map((s) => s.id)).toEqual(['a', 'c']);
    expect(surface.undo()?.id).toBe('b');
    expect(surface.strokes.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect([...surface.group.querySelectorAll('path')].length).toBe(3);
    expect(surface.redo()?.id).toBe('b');
    expect(surface.strokes.map((s) => s.id)).toEqual(['a', 'c']);
    expect(surface.undo()?.id).toBe('b');
    expect(surface.undo()?.id).toBe('c');
    expect(surface.strokes.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('pairing', () => {
  it('builds the tablet URL on a network address and knows when the server is reachable', () => {
    history.replaceState(null, '', '/?deck=examples/guide/deck.json&resume=x#step=3');
    const url = new URL(padUrl('192.168.1.20', 8000, 'abc123'));
    expect(url.hostname).toBe('192.168.1.20');
    expect(url.port).toBe('8000');
    expect(url.pathname).toBe('/pad.html');
    expect(url.searchParams.get('room')).toBe('abc123');
    expect(url.searchParams.has('deck')).toBe(false);
    expect(url.hash).toBe('');
    expect(listensOnLan('127.0.0.1')).toBe(false);
    expect(listensOnLan(true)).toBe(true);
    expect(listensOnLan('0.0.0.0')).toBe(true);
    expect(Array.isArray(lanAddresses())).toBe(true);
  });
});
