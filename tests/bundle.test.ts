import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BundleWriter, crc32, extractBundle, headers, journalPath, readDirectory, readEntry, recoverBundle } from '../bin/bundle.mjs';

/** What a zip tool reads from the file: name, size and checksum of every entry; null when the machine has no python. */
function listedByPython(file: string, verify = true): Array<[string, number, number]> | null {
  try {
    const out = execFileSync('python3', ['-I', '-c', `import sys, json, zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n  ${verify ? 'assert z.testzip() is None' : 'pass'}\n  print(json.dumps([[i.filename, i.file_size, i.CRC] for i in z.infolist()]))`, file], { encoding: 'utf8' });
    return JSON.parse(out) as Array<[string, number, number]>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

describe('talk bundles', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is written while the talk runs, patched at each seam, and read back by any zip tool', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zoomdeck-bundle-'));
    const file = join(dir, 'recordings', 'talk.zip');
    const writer = await BundleWriter.open(file, 'talk.json');
    expect(existsSync(journalPath(file))).toBe(true);
    const media = Buffer.alloc(70_000).map((_, index) => (index * 31) % 256);
    await writer.begin('talk.webm');
    await writer.write(media.subarray(0, 40_000));
    await writer.write(media.subarray(40_000));
    const entry = await writer.end();
    expect(entry).toMatchObject({ name: 'talk.webm', size: 70_000, crc: crc32(media), offset: 0 });
    await writer.putFile('talk.part2.webm', Buffer.from('second part'));
    const timeline = JSON.stringify({ version: 1, events: [], media: [] });
    await writer.putFile('talk.json', Buffer.from(timeline));
    await writer.finish();
    expect(existsSync(journalPath(file))).toBe(false);
    const listing = await readDirectory(file);
    expect(listing?.entries.map((entry) => [entry.name, entry.size, entry.stored])).toEqual([['talk.webm', 70_000, true], ['talk.part2.webm', 11, true], ['talk.json', timeline.length, true]]);
    expect((await readEntry(file, listing!.entries[2])).toString()).toBe(timeline);
    expect(Buffer.compare(await readEntry(file, listing!.entries[0]), Buffer.from(media))).toBe(0);
    // No data descriptors: a stored entry with its sizes in the header, as the plainest zip has.
    const bytes = readFileSync(file);
    expect(bytes.readUInt16LE(6) & 0x0008).toBe(0);
    expect(bytes.readUInt32LE(18)).toBe(70_000);
    const listed = listedByPython(file);
    if (listed) expect(listed).toEqual([['talk.webm', 70_000, crc32(media)], ['talk.part2.webm', 11, crc32(Buffer.from('second part'))], ['talk.json', timeline.length, crc32(Buffer.from(timeline))]]);
    // Unpacked for a published copy, the entries are plain files again.
    const unpacked = await extractBundle(file, join(dir, 'out'));
    expect(unpacked).toEqual(['talk.webm', 'talk.part2.webm', 'talk.json']);
    expect(readFileSync(join(dir, 'out', 'talk.json'), 'utf8')).toBe(timeline);
    expect(statSync(join(dir, 'out', 'talk.webm')).size).toBe(70_000);
  });

  it('keeps a side lane in a file beside the bundle and appends it once the main lane is between entries', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zoomdeck-bundle-'));
    const file = join(dir, 'talk.zip');
    const writer = await BundleWriter.open(file, 'talk.json');
    await writer.begin('talk.webm');
    await writer.write(Buffer.from('camera one '));
    // The screen lane begins while the camera lane's file is open: its chunks wait beside the bundle.
    await writer.beginSide('talk.part2.webm');
    await writer.writeSide(Buffer.from('screen '));
    await writer.writeSide(Buffer.from('frames'));
    await writer.endSide();
    expect(existsSync(`${file}.talk.part2.webm.side`)).toBe(true);
    expect(writer.names).toEqual([]);
    await writer.write(Buffer.from('camera two'));
    // The camera lane's file ends: the screen's file joins at once.
    await writer.end();
    expect(writer.names).toEqual(['talk.webm', 'talk.part2.webm']);
    expect(existsSync(`${file}.talk.part2.webm.side`)).toBe(false);
    // A side lane still open at the end joins too.
    await writer.beginSide('talk.part3.webm');
    await writer.writeSide(Buffer.from('late screen'));
    await writer.putFile('talk.json', Buffer.from('{"version":1}'));
    await writer.finish();
    const listing = await readDirectory(file);
    expect(listing?.entries.map((entry) => [entry.name, entry.size])).toEqual([['talk.webm', 21], ['talk.part2.webm', 13], ['talk.json', 13], ['talk.part3.webm', 11]]);
    expect((await readEntry(file, listing!.entries[1])).toString()).toBe('screen frames');
    expect((await readEntry(file, listing!.entries[3])).toString()).toBe('late screen');
    const listed = listedByPython(file);
    if (listed) expect(listed.map(([name]) => name)).toEqual(['talk.webm', 'talk.part2.webm', 'talk.json', 'talk.part3.webm']);
  });

  it('keeps two side lanes at once, each in its own file, and the journal names both', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zoomdeck-bundle-'));
    const file = join(dir, 'talk.zip');
    const writer = await BundleWriter.open(file, 'talk.json');
    await writer.begin('talk.webm');
    await writer.write(Buffer.from('voice'));
    // The computer's sound runs from the start; the screen joins later, while the sound lane is still open.
    await writer.beginSide('talk.part2.webm', 'system');
    await writer.writeSide(Buffer.from('system '), 'system');
    await writer.beginSide('talk.part3.webm', 'screen');
    await writer.writeSide(Buffer.from('screen'), 'screen');
    await expect(writer.beginSide('talk.part4.webm', 'screen')).rejects.toThrow(/still being written/);
    const journal = JSON.parse(readFileSync(`${file}.journal`, 'utf8'));
    expect(journal.sides.map((side: { lane: string; name: string }) => [side.lane, side.name])).toEqual([['system', 'talk.part2.webm'], ['screen', 'talk.part3.webm']]);
    await writer.endSide('screen');
    await writer.writeSide(Buffer.from('sound'), 'system');
    await writer.endSide('system');
    await writer.end();
    expect(writer.names).toEqual(['talk.webm', 'talk.part3.webm', 'talk.part2.webm']);
    await writer.putFile('talk.json', Buffer.from('{"version":1}'));
    await writer.finish();
    const listing = await readDirectory(file);
    expect((await readEntry(file, listing!.entries[1])).toString()).toBe('screen');
    expect((await readEntry(file, listing!.entries[2])).toString()).toBe('system sound');
  });

  it('continues a talk by cutting the timeline and directory away and appending more', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zoomdeck-bundle-'));
    const file = join(dir, 'talk.zip');
    let writer = await BundleWriter.open(file, 'talk.json');
    await writer.putFile('talk.webm', Buffer.from('first'));
    await writer.putFile('talk.json', Buffer.from('{"version":1}'));
    await writer.finish();
    const sizeBefore = statSync(file).size;
    writer = await BundleWriter.open(file, 'talk.json');
    expect(writer.names).toEqual(['talk.webm']);
    // The old media bytes are untouched: the file was cut right after them.
    expect(statSync(file).size).toBeLessThan(sizeBefore);
    await writer.putFile('talk.part2.webm', Buffer.from('second'));
    await writer.putFile('talk.json', Buffer.from('{"version":1,"longer":true}'));
    await writer.finish();
    const listing = await readDirectory(file);
    expect(listing?.entries.map((entry) => entry.name)).toEqual(['talk.webm', 'talk.part2.webm', 'talk.json']);
    expect((await readEntry(file, listing!.entries[0])).toString()).toBe('first');
    expect((await readEntry(file, listing!.entries[2])).toString()).toBe('{"version":1,"longer":true}');
    const listed = listedByPython(file);
    if (listed) expect(listed.map(([name]) => name)).toEqual(['talk.webm', 'talk.part2.webm', 'talk.json']);
  });

  it('recovers a talk cut short from its journal: the open entry is closed, the draft timeline written', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zoomdeck-bundle-'));
    const file = join(dir, 'talk.zip');
    const writer = await BundleWriter.open(file, 'talk.json');
    await writer.putFile('talk.webm', Buffer.from('whole part'));
    await writer.begin('talk.part2.webm');
    await writer.write(Buffer.from('half a '));
    await writer.write(Buffer.from('part'));
    await writer.draft({ version: 1, duration: 5000, events: [{ t: 0, type: 'go' }], media: [] });
    await writer.release(); // the server stopped here: no directory, the journal remains
    expect(await readDirectory(file)).toBeNull();
    expect(await recoverBundle(file)).toBe(true);
    expect(existsSync(journalPath(file))).toBe(false);
    const listing = await readDirectory(file);
    expect(listing?.entries.map((entry) => [entry.name, entry.size])).toEqual([['talk.webm', 10], ['talk.part2.webm', 11], ['talk.json', JSON.stringify({ version: 1, duration: 5000, events: [{ t: 0, type: 'go' }], media: [] }).length]]);
    expect((await readEntry(file, listing!.entries[1])).toString()).toBe('half a part');
    expect(listing!.entries[1].crc).toBe(crc32(Buffer.from('half a part')));
    // A complete bundle is left alone; a file without journal cannot be recovered.
    expect(await recoverBundle(file)).toBe(false);
    writeFileSync(join(dir, 'other.zip'), 'not a zip');
    expect(await recoverBundle(join(dir, 'other.zip'))).toBe(false);
    const listed = listedByPython(file);
    if (listed) expect(listed.map(([name, size]) => [name, size])).toEqual([['talk.webm', 10], ['talk.part2.webm', 11], ['talk.json', 71]]);
  });

  it('describes files and offsets past 4 GiB in zip64 fields, which the reader follows', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zoomdeck-bundle-'));
    const file = join(dir, 'huge.zip');
    const date = new Date(2026, 10, 15, 10, 30);
    const size = 5_000_000_000;
    const local = headers.localHeader('big.webm', 0x1234_5678, size, date);
    expect(local.readUInt32LE(18)).toBe(0xffff_ffff);
    expect(local.readUInt16LE(4)).toBe(45);
    const small = headers.localHeader('small.json', 1, 2, date);
    const entries = [{ name: 'big.webm', size, crc: 0x1234_5678, offset: 0 }, { name: 'small.json', size: 2, crc: 1, offset: local.length + size }];
    const tail = headers.directory(entries, local.length + size + small.length + 2, date);
    // A sparse file stands in for the five gigabytes of media.
    const handle = await fs.open(file, 'w');
    await handle.write(local, 0, local.length, 0);
    await handle.write(small, 0, small.length, local.length + size);
    await handle.write(Buffer.from('{}'), 0, 2, local.length + size + small.length);
    await handle.write(tail, 0, tail.length, local.length + size + small.length + 2);
    await handle.close();
    const listing = await readDirectory(file);
    expect(listing?.entries.map((entry) => [entry.name, entry.size, entry.offset, entry.dataOffset])).toEqual([['big.webm', size, 0, local.length], ['small.json', 2, local.length + size, local.length + size + small.length]]);
    expect(listing?.directoryOffset).toBe(local.length + size + small.length + 2);
    const listed = listedByPython(file, false);
    if (listed) expect(listed.map(([name, length]) => [name, length])).toEqual([['big.webm', size], ['small.json', 2]]);
  });
});
