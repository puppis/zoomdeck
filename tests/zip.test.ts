import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, openRemoteZip, parseZipDirectory, zipFiles } from '../src/player/zip';

describe('zip archives', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    // In slices, continued, the same as in one go.
    const bytes = new TextEncoder().encode('The quick brown fox jumps over the lazy dog');
    expect(crc32(bytes.subarray(10), crc32(bytes.subarray(0, 10)))).toBe(crc32(bytes));
  });

  it('stores the files with their names and contents, as a zip tool reads them', async () => {
    const timeline = JSON.stringify({ version: 1, events: [] });
    const media = new Uint8Array(70_000).map((_, index) => (index * 31) % 256);
    const zip = await zipFiles([
      { name: 'talk.webm', blob: new Blob([media], { type: 'video/webm' }) },
      { name: 'talk.json', blob: new Blob([timeline], { type: 'application/json' }) },
    ], new Date(2026, 10, 15, 10, 30, 0));
    expect(zip.type).toBe('application/zip');
    const bytes = new Uint8Array(await zip.arrayBuffer());
    // The local header of the first file, the central directory and its end, where the standard puts them.
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Array.from(bytes.subarray(bytes.length - 22, bytes.length - 18))).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(new DataView(bytes.buffer).getUint16(bytes.length - 12, true)).toBe(2);
    expect(bytes.length).toBe(30 + 9 + media.length + 30 + 9 + timeline.length + 2 * (46 + 9) + 22);
    // A zip tool, when the machine has one, reads the files back unchanged.
    const dir = mkdtempSync(join(tmpdir(), 'zoomdown-zip-'));
    try {
      const file = join(dir, 'talk.zip');
      writeFileSync(file, bytes);
      let listing: string;
      try {
        listing = execFileSync('python3', ['-I', '-c', 'import sys, zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n  assert z.testzip() is None\n  for i in z.infolist(): print(i.filename, i.file_size, i.compress_type, i.date_time)\n  sys.stdout.write(z.read("talk.json").decode())', file], { encoding: 'utf8' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      expect(listing).toContain(`talk.webm ${media.length} 0 (2026, 11, 15, 10, 30, 0)`);
      expect(listing).toContain(`talk.json ${timeline.length} 0`);
      expect(listing.endsWith(timeline)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('describes a file past 4 GiB in zip64 fields', async () => {
    // A stand-in for the blob: its size is what matters to the headers, its bytes are never read whole.
    const huge = { size: 0x1_0000_0000, slice: () => huge, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) } as unknown as Blob;
    const zip = await zipFiles([{ name: 'huge.webm', blob: huge }]);
    const header = new DataView(await zip.slice(0, 30 + 9 + 20).arrayBuffer());
    expect(header.getUint16(4, true)).toBe(45);
    expect(header.getUint32(18, true)).toBe(0xffff_ffff);
    expect(header.getUint16(28, true)).toBe(20);
    expect(header.getUint16(39, true)).toBe(0x0001);
    expect(Number(header.getBigUint64(43, true))).toBe(0x1_0000_0000);
  });

  it('reads an archive served by ranges: the directory from its tail, each entry by its bytes', async () => {
    const timeline = JSON.stringify({ version: 1, events: [] });
    const media = new Uint8Array(5000).map((_, index) => (index * 7) % 256);
    const zip = await zipFiles([{ name: 'talk.webm', blob: new Blob([media], { type: 'video/webm' }) }, { name: 'talk.json', blob: new Blob([timeline]) }]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const entries = parseZipDirectory(bytes.subarray(bytes.length - 200), bytes.length, bytes.length - 200);
    expect(entries?.map((entry) => [entry.name, entry.size, entry.offset, entry.stored])).toEqual([['talk.webm', 5000, 0, true], ['talk.json', timeline.length, 30 + 9 + 5000, true]]);
    // A server that honors ranges, and one that sends the whole file whatever is asked.
    const ranges: string[] = [];
    const serve = (honor: boolean) => async (_url: string, init?: RequestInit) => {
      const range = /bytes=(\d*)-(\d*)/.exec(String((init?.headers as Record<string, string>)?.Range ?? ''));
      ranges.push(range?.[0] ?? 'whole');
      if (!honor || !range) return new Response(bytes, { status: 200 });
      const from = range[1] ? Number(range[1]) : bytes.length - Number(range[2]);
      const to = range[1] && range[2] ? Number(range[2]) : bytes.length - 1;
      return new Response(bytes.subarray(from, to + 1), { status: 206, headers: { 'Content-Range': `bytes ${from}-${to}/${bytes.length}` } });
    };
    const original = globalThis.fetch;
    try {
      globalThis.fetch = serve(true) as typeof fetch;
      const remote = await openRemoteZip('http://host/recordings/talk.zip', 200);
      expect(remote.entries.map((entry) => entry.name)).toEqual(['talk.webm', 'talk.json']);
      expect(await (await remote.read('talk.json')).text()).toBe(timeline);
      const part = await remote.read('talk.webm');
      expect(part.type).toBe('video/webm');
      expect(Array.from(new Uint8Array(await part.arrayBuffer()))).toEqual(Array.from(media));
      expect(ranges).toEqual(['bytes=-200', 'bytes=5039-5068', `bytes=5078-${5078 + timeline.length - 1}`, 'bytes=0-29', 'bytes=39-5038']);
      await expect(remote.read('other.webm')).rejects.toThrow(/not in the archive/);
      globalThis.fetch = serve(false) as typeof fetch;
      const whole = await openRemoteZip('http://host/recordings/talk.zip', 200);
      expect(await (await whole.read('talk.json')).text()).toBe(timeline);
      globalThis.fetch = (async () => new Response('<html>', { status: 200 })) as typeof fetch;
      await expect(openRemoteZip('http://host/recordings/missing.zip')).rejects.toThrow(/not a zip archive/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
