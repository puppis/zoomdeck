import { describe, expect, it } from 'vitest';
import { buildPdf, encodePixels } from '../src/player/pdf';
import { printOutline, printPages } from '../src/player/print';
import type { NavigationData } from '../src/runtime';

const navigation: NavigationData = {
  version: 1,
  slides: [
    { id: 0, name: 'root', key: 'markup:root', parent: null, placeholder: false },
    { id: 1, name: 'a', key: 'markup:a', parent: 0, placeholder: false },
    { id: 2, name: 'b', key: 'markup:b', parent: 0, placeholder: false },
  ],
  clips: [
    { slide: 0, kind: 'entry', loop: false, autoNext: false, notes: '', rate: 1, duration: 0 },
    { slide: 1, kind: 'entry', loop: false, autoNext: false, notes: '', rate: 1, duration: 0 },
    { slide: 1, kind: 'program', loop: false, autoNext: true, notes: '', rate: 1, duration: 1 },
    { slide: 1, kind: 'program', loop: true, autoNext: false, notes: '', rate: 1, duration: 1 },
    { slide: 0, kind: 'return', loop: false, autoNext: false, notes: '', rate: 1, duration: 0 },
    { slide: 2, kind: 'entry', loop: false, autoNext: false, notes: '', rate: 1, duration: 0 },
    { slide: 0, kind: 'return', loop: false, autoNext: false, notes: '', rate: 1, duration: 0 },
    { slide: 2, kind: 'program', loop: false, autoNext: true, notes: '', rate: 1, duration: 1 },
  ],
  startSlide: null,
};

describe('the pages of a printout', () => {
  it('prints the stages the presentation rests on, or the last stage of each slide', () => {
    // Returns and a stop that advances by itself are left out; a final stop is kept even when it would advance.
    expect(printPages(navigation, 'stages').map((page) => page.clip)).toEqual([0, 1, 3, 5, 7]);
    expect(printPages(navigation, 'slides').map((page) => page.clip)).toEqual([0, 3, 7]);
  });

  it('bookmarks the slide tree at the first page of each slide', () => {
    const outline = printOutline(navigation, printPages(navigation, 'stages'));
    expect(outline).toEqual([{ title: 'root', page: 0, children: [{ title: 'a', page: 1, children: [] }, { title: 'b', page: 3, children: [] }] }]);
    const handout = printOutline(navigation, printPages(navigation, 'slides'));
    expect(handout[0].children.map((item) => item.page)).toEqual([1, 2]);
  });
});

describe('the PDF writer', () => {
  it('predicts rows and deflates them into an image a reader can decode', async () => {
    const width = 4;
    const height = 3;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) rgba.set([200, 100, 50, 255], i * 4);
    const image = await encodePixels(rgba, width, height);
    expect(image.filter).toBe('FlateDecode');
    // zlib header, as FlateDecode expects.
    expect(image.data[0]).toBe(0x78);
    const inflated = new Uint8Array(await new Response(new Blob([image.data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    expect(inflated.length).toBe((width * 3 + 1) * height);
    // The first row is kept as is after its filter tag; the rows below differ from it by nothing.
    expect([...inflated.slice(0, 4)]).toEqual([2, 200, 100, 50]);
    expect([...inflated.slice(width * 3 + 1, width * 3 + 5)]).toEqual([2, 0, 0, 0]);
  });

  it('writes a document whose cross-reference table points at every object', async () => {
    const image = await encodePixels(new Uint8ClampedArray(2 * 2 * 4), 2, 2);
    const bytes = buildPdf({
      title: 'Déck',
      pageWidth: 960,
      pageHeight: 540,
      pages: [image, image],
      outline: [{ title: 'root', page: 0, children: [{ title: 'a (b)', page: 1, children: [] }] }],
    }, new Date(Date.UTC(2026, 10, 13, 9, 5, 0)));
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.5\n')).toBe(true);
    expect(text).toContain('/Count 2 >>');
    expect(text).toContain('/Title <FEFF004400E90063006B>');
    expect(text).toContain('/Title (a \\(b\\))');
    expect(text).toContain('/CreationDate (D:20261113090500Z)');
    expect(text).toContain('/Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns 2');
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = text.slice(startxref).split('\n').slice(2).filter((line) => / n $/.test(line));
    // 3 fixed objects, 3 per page, the outline root and its two items.
    expect(entries.length).toBe(3 + 6 + 3);
    entries.forEach((entry, i) => {
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });
});
