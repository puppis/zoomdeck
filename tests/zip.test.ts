import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, zipFiles } from '../src/player/zip';

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
    const dir = mkdtempSync(join(tmpdir(), 'zoomdeck-zip-'));
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

  it('refuses what the format cannot address', async () => {
    const huge = { size: 0x1_0000_0000, slice: () => huge, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) } as unknown as Blob;
    await expect(zipFiles([{ name: 'huge.webm', blob: huge }])).rejects.toThrow(/too large/);
  });
});
