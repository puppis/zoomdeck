/**
 * A recorded talk as one zip file, `recordings/<name>.zip`: its media files as they came out of
 * the browser's recorder, then the timeline `<name>.json`, then the directory. The file is
 * written while the talk runs and only ever grows at its tail: a media file is begun as its
 * recorder starts and its chunks are appended as they arrive; when it ends, its size and
 * checksum are patched into the header already written, so the finished bundle is a plain
 * stored zip without data descriptors, read by every tool. Stopping writes the small timeline
 * and the directory, nothing else: no copy, no compression. Continuing a talk truncates the
 * timeline and the directory away, which are always last, and appends more of the same.
 *
 * A journal `<name>.zip.journal` beside the bundle lists the entries written so far and the
 * latest draft of the timeline, so that a talk cut short by a crash is closed properly the next
 * time its folder is read.
 */
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const LOCAL = 0x0403_4b50;
const CENTRAL = 0x0201_4b50;
const END = 0x0605_4b50;
const END64 = 0x0606_4b50;
const LOCATOR64 = 0x0706_4b50;
const LIMIT = 0xffff_ffff;
/** The extra field every local header reserves: room for the zip64 sizes should the file grow past 4 GiB. */
const RESERVED_ID = 0x4b44; // 'DK', unknown to every reader, so ignored
const EXTRA = 20;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Continue a CRC-32 over `bytes`; start from 0 and read the result as it is. */
export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return [time, day];
}

/** The local header of a stored entry, sizes and checksum as given (zero while the data is still coming). */
function localHeader(name, crc, size, date) {
  const encoded = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(30 + encoded.length + EXTRA);
  const [time, day] = dosDateTime(date);
  const large = size > LIMIT;
  header.writeUInt32LE(LOCAL, 0);
  header.writeUInt16LE(large ? 45 : 20, 4);
  header.writeUInt16LE(0x0800, 6); // the names are UTF-8
  header.writeUInt16LE(0, 8); // stored
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(day, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(large ? LIMIT : size, 18);
  header.writeUInt32LE(large ? LIMIT : size, 22);
  header.writeUInt16LE(encoded.length, 26);
  header.writeUInt16LE(EXTRA, 28);
  encoded.copy(header, 30);
  const extra = 30 + encoded.length;
  header.writeUInt16LE(large ? 0x0001 : RESERVED_ID, extra);
  header.writeUInt16LE(16, extra + 2);
  header.writeBigUInt64LE(BigInt(large ? size : 0), extra + 4);
  header.writeBigUInt64LE(BigInt(large ? size : 0), extra + 12);
  return header;
}

/** The central directory record of an entry whose local header stands at `offset`. */
function centralRecord(entry, date) {
  const encoded = Buffer.from(entry.name, 'utf8');
  const [time, day] = dosDateTime(date);
  const fields = [];
  if (entry.size > LIMIT) fields.push(entry.size, entry.size);
  if (entry.offset > LIMIT) fields.push(entry.offset);
  const extra = fields.length ? 4 + 8 * fields.length : 0;
  const record = Buffer.alloc(46 + encoded.length + extra);
  record.writeUInt32LE(CENTRAL, 0);
  record.writeUInt16LE(fields.length ? 45 : 20, 4); // made by: MS-DOS attributes
  record.writeUInt16LE(fields.length ? 45 : 20, 6);
  record.writeUInt16LE(0x0800, 8);
  record.writeUInt16LE(0, 10);
  record.writeUInt16LE(time, 12);
  record.writeUInt16LE(day, 14);
  record.writeUInt32LE(entry.crc, 16);
  record.writeUInt32LE(Math.min(entry.size, LIMIT), 20);
  record.writeUInt32LE(Math.min(entry.size, LIMIT), 24);
  record.writeUInt16LE(encoded.length, 28);
  record.writeUInt16LE(extra, 30);
  record.writeUInt16LE(0, 32); // no comment
  record.writeUInt16LE(0, 34); // the first disk
  record.writeUInt16LE(0, 36); // internal attributes
  record.writeUInt32LE(0, 38); // external attributes
  record.writeUInt32LE(Math.min(entry.offset, LIMIT), 42);
  encoded.copy(record, 46);
  if (fields.length) {
    let at = 46 + encoded.length;
    record.writeUInt16LE(0x0001, at);
    record.writeUInt16LE(8 * fields.length, at + 2);
    at += 4;
    for (const field of fields) {
      record.writeBigUInt64LE(BigInt(field), at);
      at += 8;
    }
  }
  return record;
}

/** The central directory and its end records for `entries`, the directory starting at `offset`. */
function directory(entries, offset, date) {
  const records = entries.map((entry) => centralRecord(entry, date));
  const size = records.reduce((total, record) => total + record.length, 0);
  const parts = [...records];
  const zip64 = entries.length > 0xfffe || offset > LIMIT || size > LIMIT;
  if (zip64) {
    const end64 = Buffer.alloc(56);
    end64.writeUInt32LE(END64, 0);
    end64.writeBigUInt64LE(BigInt(44), 4);
    end64.writeUInt16LE(45, 12);
    end64.writeUInt16LE(45, 14);
    end64.writeUInt32LE(0, 16);
    end64.writeUInt32LE(0, 20);
    end64.writeBigUInt64LE(BigInt(entries.length), 24);
    end64.writeBigUInt64LE(BigInt(entries.length), 32);
    end64.writeBigUInt64LE(BigInt(size), 40);
    end64.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(LOCATOR64, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(offset + size), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(end64, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Math.min(entries.length, 0xffff), 8);
  end.writeUInt16LE(Math.min(entries.length, 0xffff), 10);
  end.writeUInt32LE(Math.min(size, LIMIT), 12);
  end.writeUInt32LE(Math.min(offset, LIMIT), 16);
  end.writeUInt16LE(0, 20);
  parts.push(end);
  return Buffer.concat(parts);
}

/** The header builders, for tests of the format's edge cases (files past 4 GiB) that no test can write out. */
export const headers = { localHeader, centralRecord, directory };

/** Read the zip64 sizes and offset out of a central record's extra field, where the record says to look there. */
function zip64Fields(extra, size, offset) {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    if (id === 0x0001) {
      let field = at + 4;
      const read = () => {
        const value = Number(extra.readBigUInt64LE(field));
        field += 8;
        return value;
      };
      if (size === LIMIT) {
        size = read();
        read(); // the compressed size, the same for a stored entry
      }
      if (offset === LIMIT) offset = read();
      break;
    }
    at += 4 + length;
  }
  return { size, offset };
}

/**
 * The entries of a finished bundle, as its directory lists them (name, size, crc, the local
 * header's `offset` and the data's `dataOffset`), and where the directory starts; null when
 * the file has no directory (a talk cut short, or not a zip at all).
 */
export async function readDirectory(path) {
  let handle;
  try {
    handle = await fs.open(path, 'r');
  } catch {
    return null;
  }
  try {
    const { size: fileSize } = await handle.stat();
    const tailSize = Math.min(fileSize, 66_000);
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, fileSize - tailSize);
    let at = tail.length - 22;
    while (at >= 0 && tail.readUInt32LE(at) !== END) at--;
    if (at < 0) return null;
    let count = tail.readUInt16LE(at + 10);
    let dirSize = tail.readUInt32LE(at + 12);
    let dirOffset = tail.readUInt32LE(at + 16);
    const locatorAt = at - 20;
    if ((count === 0xffff || dirSize === LIMIT || dirOffset === LIMIT) && locatorAt >= 0 && tail.readUInt32LE(locatorAt) === LOCATOR64) {
      const end64At = Number(tail.readBigUInt64LE(locatorAt + 8));
      const end64 = Buffer.alloc(56);
      await handle.read(end64, 0, 56, end64At);
      if (end64.readUInt32LE(0) !== END64) return null;
      count = Number(end64.readBigUInt64LE(32));
      dirSize = Number(end64.readBigUInt64LE(40));
      dirOffset = Number(end64.readBigUInt64LE(48));
    }
    const records = Buffer.alloc(dirSize);
    await handle.read(records, 0, dirSize, dirOffset);
    const entries = [];
    let cursor = 0;
    for (let index = 0; index < count && cursor + 46 <= records.length; index++) {
      if (records.readUInt32LE(cursor) !== CENTRAL) return null;
      const method = records.readUInt16LE(cursor + 10);
      const crc = records.readUInt32LE(cursor + 16);
      const nameLength = records.readUInt16LE(cursor + 28);
      const extraLength = records.readUInt16LE(cursor + 30);
      const commentLength = records.readUInt16LE(cursor + 32);
      const name = records.toString('utf8', cursor + 46, cursor + 46 + nameLength);
      const { size, offset } = zip64Fields(records.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength), records.readUInt32LE(cursor + 24), records.readUInt32LE(cursor + 42));
      // Where the data begins follows from the local header's own name and extra lengths.
      const local = Buffer.alloc(30);
      await handle.read(local, 0, 30, offset);
      if (local.readUInt32LE(0) !== LOCAL) return null;
      const dataOffset = offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      entries.push({ name, size, crc, offset, dataOffset, stored: method === 0 });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return { entries, directoryOffset: dirOffset, fileSize };
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** The content of one entry of a bundle, read whole (for the timeline; media is streamed by range instead). */
export async function readEntry(path, entry) {
  if (!entry.stored) throw new Error(`${entry.name} is compressed; a bundle stores its files as they are`);
  const handle = await fs.open(path, 'r');
  try {
    const data = Buffer.alloc(entry.size);
    await handle.read(data, 0, entry.size, entry.dataOffset);
    return data;
  } finally {
    await handle.close();
  }
}

/** The journal file that accompanies a bundle while it is being written. */
export function journalPath(path) {
  return `${path}.journal`;
}

/** Whether a file in a recordings folder is a bundle's journal, which is private to the server. */
export function isJournal(file) {
  return file.endsWith('.journal');
}

/**
 * Close a bundle left without its directory (the browser or the server went away while the
 * talk was recorded): the entry cut short gets its size and checksum from the bytes present,
 * the journal's draft timeline is written when the bundle has none, then the directory. True
 * when the bundle was repaired, false when there was nothing to do or no journal to go by.
 */
export async function recoverBundle(path) {
  if (await readDirectory(path)) return false;
  let journal;
  try {
    journal = JSON.parse(await fs.readFile(journalPath(path), 'utf8'));
  } catch {
    return false;
  }
  const writer = new BundleWriter(path, journal.entries ?? [], journal.date ? new Date(journal.date) : new Date());
  writer._timelineName = journal.timelineName ?? null;
  await writer._reopen(journal.open ?? null);
  // Side files cut short (the filmed screen, the computer's sound) join as they are, in the order they were begun.
  for (const side of [...(journal.pending ?? []), ...(journal.sides ?? []), ...(journal.side ? [journal.side] : [])]) {
    if (!side?.path || !existsSync(side.path) || writer.entries.some((entry) => entry.name === side.name)) continue;
    writer._pending.push({ name: side.name, path: side.path, size: 0 });
  }
  await writer._appendPending();
  if (journal.draft && !writer.entries.some((entry) => entry.name === journal.timelineName)) {
    const draft = journal.draft;
    // The draft stops where the media present ends: events after the last chunk written are kept, the clock is not stretched.
    await writer.putFile(journal.timelineName, Buffer.from(JSON.stringify(draft), 'utf8'));
  }
  await writer.finish();
  return true;
}

/** Unpack a bundle's entries into `folder` as plain files (for a published copy of the deck); the entries' names are kept. */
export async function extractBundle(path, folder) {
  const listing = await readDirectory(path);
  if (!listing) throw new Error(`${basename(path)} is not a complete bundle`);
  await fs.mkdir(folder, { recursive: true });
  const written = [];
  for (const entry of listing.entries) {
    if (!entry.stored || entry.name.includes('/') || entry.name.includes('\\') || entry.name.startsWith('.')) continue;
    const target = join(folder, entry.name);
    const source = await fs.open(path, 'r');
    try {
      const out = await fs.open(target, 'w');
      try {
        const chunk = Buffer.alloc(Math.min(entry.size, 8 * 1024 * 1024));
        let done = 0;
        while (done < entry.size) {
          const { bytesRead } = await source.read(chunk, 0, Math.min(chunk.length, entry.size - done), entry.dataOffset + done);
          if (!bytesRead) break;
          await out.write(chunk, 0, bytesRead);
          done += bytesRead;
        }
      } finally {
        await out.close();
      }
    } finally {
      await source.close();
    }
    written.push(entry.name);
  }
  return written;
}

/**
 * Writes a bundle, or continues one. `open` reads an existing bundle's directory, drops its
 * timeline entry (named `timelineName`) and truncates the file to just after the last media
 * entry, so that the talk can go on; a bundle without directory is recovered first.
 */
export class BundleWriter {
  /** @param {string} path @param {Array<{name: string, size: number, crc: number, offset: number}>} entries */
  constructor(path, entries = [], date = new Date()) {
    this.path = path;
    this.entries = entries;
    this.date = date;
    this._handle = null;
    this._offset = 0;
    /** The entry being written: its header offset, data offset, running size and checksum. */
    this._open = null;
    /**
     * The side lanes (the filmed screen and the computer's sound, recorded beside the camera),
     * by name: each lane's chunks go to a file beside the bundle while the main lane's entry is
     * open, and the file is appended as an entry of its own as soon as the main lane is between
     * entries, or at the end.
     */
    this._sides = new Map();
    this._pending = [];
    this._timelineName = null;
    this._draft = null;
    this._closed = false;
  }

  /** The file a side lane's chunks go to until they can join the bundle. */
  _sidePath(name) {
    return `${this.path}.${name}.side`;
  }

  /** Begin an entry of a side lane (the screen's by default), whose chunks go to a file beside the bundle for now. */
  async beginSide(name, lane = 'screen') {
    const open = this._sides.get(lane);
    if (open) throw new Error(`${open.name} is still being written`);
    if (this.entries.some((entry) => entry.name === name) || this._pending.some((side) => side.name === name) || [...this._sides.values()].some((side) => side.name === name)) throw new Error(`${name} is already in the bundle`);
    const path = this._sidePath(name);
    const handle = await fs.open(path, 'w');
    this._sides.set(lane, { lane, name, path, handle, size: 0 });
    await this._journal();
  }

  async writeSide(chunk, lane = 'screen') {
    const side = this._sides.get(lane);
    if (!side) throw new Error(`No ${lane} entry is being written`);
    await side.handle.write(chunk, 0, chunk.length);
    side.size += chunk.length;
  }

  /** Close a side lane's file; it joins the bundle when the main lane is between entries (now, if it is). */
  async endSide(lane = 'screen') {
    const side = this._sides.get(lane);
    if (!side) return;
    this._sides.delete(lane);
    await side.handle.close();
    this._pending.push({ name: side.name, path: side.path, size: side.size });
    await this._journal();
    if (!this._open) await this._appendPending();
  }

  /** Append the side files waiting, each as an entry, and remove them. */
  async _appendPending() {
    while (this._pending.length) {
      const side = this._pending[0];
      await this.begin(side.name);
      const source = await fs.open(side.path, 'r');
      try {
        const chunk = Buffer.alloc(8 * 1024 * 1024);
        for (;;) {
          const { bytesRead } = await source.read(chunk, 0, chunk.length, null);
          if (!bytesRead) break;
          await this.write(chunk.subarray(0, bytesRead));
        }
      } finally {
        await source.close();
      }
      this._pending.shift();
      await this.end();
      await fs.rm(side.path, { force: true });
    }
  }

  /** Open `path` for writing (creating it, or continuing the talk it holds); `timelineName` is the entry the directory ends with. */
  static async open(path, timelineName) {
    await fs.mkdir(dirname(path), { recursive: true });
    const writer = new BundleWriter(path);
    writer._timelineName = timelineName;
    if (existsSync(path)) {
      if (!(await readDirectory(path))) await recoverBundle(path);
      const listing = await readDirectory(path);
      if (!listing) throw new Error(`${basename(path)} is not a bundle that can be continued`);
      const timeline = listing.entries.find((entry) => entry.name === timelineName);
      const kept = listing.entries.filter((entry) => entry !== timeline);
      // The timeline is the last entry: cutting the file there removes it and the directory in one go.
      const cut = timeline && kept.every((entry) => entry.offset < timeline.offset) ? timeline.offset : listing.directoryOffset;
      writer.entries = kept.map(({ name, size, crc, offset }) => ({ name, size, crc, offset }));
      await fs.truncate(path, cut);
      writer._offset = cut;
      writer._handle = await fs.open(path, 'r+');
    } else {
      writer._handle = await fs.open(path, 'w+');
    }
    await writer._journal();
    return writer;
  }

  /** Continue writing an existing file from its journal (recovery): the unfinished entry, if any, is closed from the bytes present. */
  async _reopen(open) {
    this._handle = await fs.open(this.path, 'r+');
    const { size } = await this._handle.stat();
    if (open && open.dataOffset <= size) {
      // Checksum the data present, then close the entry as if it had ended there.
      const chunk = Buffer.alloc(8 * 1024 * 1024);
      let crc = 0;
      let done = 0;
      const length = size - open.dataOffset;
      while (done < length) {
        const { bytesRead } = await this._handle.read(chunk, 0, Math.min(chunk.length, length - done), open.dataOffset + done);
        if (!bytesRead) break;
        crc = crc32(chunk.subarray(0, bytesRead), crc);
        done += bytesRead;
      }
      this._open = { name: open.name, offset: open.offset, dataOffset: open.dataOffset, size: length, crc };
      this._offset = size;
      await this.end();
    } else {
      // Nothing half written: the file ends with the last complete entry.
      const last = this.entries.at(-1);
      this._offset = last ? last.offset + 30 + Buffer.byteLength(last.name, 'utf8') + EXTRA + last.size : 0;
      await fs.truncate(this.path, this._offset);
    }
  }

  /** The names of the entries written so far. */
  get names() {
    return this.entries.map((entry) => entry.name);
  }

  /** Begin an entry whose size is not known yet; its chunks follow with `write`. */
  async begin(name) {
    if (this._open) throw new Error(`${this._open.name} is still being written`);
    if (this.entries.some((entry) => entry.name === name)) throw new Error(`${name} is already in the bundle`);
    const header = localHeader(name, 0, 0, this.date);
    await this._handle.write(header, 0, header.length, this._offset);
    this._open = { name, offset: this._offset, dataOffset: this._offset + header.length, size: 0, crc: 0 };
    this._offset += header.length;
    await this._journal();
  }

  /** Append a chunk of the entry being written. */
  async write(chunk) {
    if (!this._open) throw new Error('No entry is being written');
    await this._handle.write(chunk, 0, chunk.length, this._offset);
    this._open.size += chunk.length;
    this._open.crc = crc32(chunk, this._open.crc);
    this._offset += chunk.length;
  }

  /** Close the entry being written: its header, already in the file, receives the size and checksum; side files waiting then join. */
  async end() {
    const open = this._open;
    if (!open) return null;
    this._open = null;
    const header = localHeader(open.name, open.crc, open.size, this.date);
    await this._handle.write(header, 0, header.length, open.offset);
    const entry = { name: open.name, size: open.size, crc: open.crc, offset: open.offset };
    this.entries.push(entry);
    await this._journal();
    if (this._pending.length) await this._appendPending();
    return entry;
  }

  /** Add a whole file at once (the timeline). */
  async putFile(name, data) {
    await this.begin(name);
    await this.write(data);
    return this.end();
  }

  /** Keep the latest draft of the timeline in the journal, for a talk that never reaches `finish`. */
  async draft(timeline) {
    this._draft = timeline;
    await this._journal();
  }

  /** Write the directory, close the file and remove the journal: the bundle is complete. */
  async finish() {
    if (this._open) await this.end();
    for (const lane of [...this._sides.keys()]) await this.endSide(lane);
    await this._appendPending();
    const tail = directory(this.entries, this._offset, this.date);
    await this._handle.write(tail, 0, tail.length, this._offset);
    await this._handle.truncate(this._offset + tail.length);
    await this._handle.close();
    this._handle = null;
    this._closed = true;
    await fs.rm(journalPath(this.path), { force: true });
  }

  /** Let go of the file without a directory (the server stops); the journal stays for recovery. */
  async release() {
    if (this._handle) await this._handle.close();
    this._handle = null;
    if (this._sides.size) {
      for (const side of this._sides.values()) {
        await side.handle.close().catch(() => undefined);
        this._pending.push({ name: side.name, path: side.path, size: side.size });
      }
      this._sides.clear();
      await this._journal();
    }
  }

  async _journal() {
    const sides = [...this._sides.values()].map(({ lane, name, path }) => ({ lane, name, path }));
    const journal = { date: this.date.toISOString(), timelineName: this._timelineName, entries: this.entries, open: this._open, draft: this._draft, sides, pending: this._pending.map(({ name, path }) => ({ name, path })) };
    await fs.writeFile(journalPath(this.path), JSON.stringify(journal));
  }
}
