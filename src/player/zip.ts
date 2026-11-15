/**
 * Zip archives in the browser. A recording offered as a download is written here as the same
 * bundle the server keeps: its media files and timeline, stored, not deflated (the media is
 * compressed already, the timeline is small), so the archive is the files with their headers
 * and nothing is copied: the blob that comes out shares the blobs that went in. Files and
 * archives past 4 GiB are described in zip64 fields. The reader opens a bundle served as it is
 * by a static host, through range requests, for the timeline and the media inside it.
 */

/** A file to put in the archive: its name inside the archive and its content. */
export interface ZipEntry {
  name: string;
  blob: Blob;
}

/** The largest value the classic zip fields hold; beyond it the zip64 fields take over. */
export const ZIP_LIMIT = 0xffff_ffff;

const LOCAL = 0x0403_4b50;
const CENTRAL = 0x0201_4b50;
const END = 0x0605_4b50;
const END64 = 0x0606_4b50;
const LOCATOR64 = 0x0706_4b50;

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
export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** The CRC-32 of a blob, read in slices so that a large media file is never held twice. */
async function blobCrc32(blob: Blob, slice = 8 * 1024 * 1024): Promise<number> {
  let crc = 0;
  for (let offset = 0; offset < blob.size; offset += slice) {
    crc = crc32(new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + slice)).arrayBuffer()), crc);
  }
  return crc;
}

/** A date and time as the zip format stores them (MS-DOS fields, two-second resolution, 1980 at the earliest). */
function dosDateTime(date: Date): [number, number] {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return [time, day];
}

function setUint64(view: DataView, at: number, value: number): void {
  view.setBigUint64(at, BigInt(value), true);
}

/**
 * Write `entries` into a zip archive. Names are UTF-8 (the archive says so), stored as given,
 * so a name with `/` makes folders.
 */
export async function zipFiles(entries: ZipEntry[], date = new Date()): Promise<Blob> {
  const encoder = new TextEncoder();
  const [time, day] = dosDateTime(date);
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = await blobCrc32(entry.blob);
    const size = entry.blob.size;
    const large = size > ZIP_LIMIT;
    // The local header, then the data as it is; a large file carries its sizes in a zip64 extra field.
    const local = new DataView(new ArrayBuffer(30 + name.length + (large ? 20 : 0)));
    local.setUint32(0, LOCAL, true);
    local.setUint16(4, large ? 45 : 20, true); // the version needed: 2.0, or 4.5 for zip64
    local.setUint16(6, 0x0800, true); // the names are UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, large ? ZIP_LIMIT : size, true);
    local.setUint32(22, large ? ZIP_LIMIT : size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, large ? 20 : 0, true);
    new Uint8Array(local.buffer).set(name, 30);
    if (large) {
      local.setUint16(30 + name.length, 0x0001, true);
      local.setUint16(32 + name.length, 16, true);
      setUint64(local, 34 + name.length, size);
      setUint64(local, 42 + name.length, size);
    }
    parts.push(local.buffer, entry.blob);
    // The matching entry of the central directory, written after all the files.
    const fields: number[] = [];
    if (large) fields.push(size, size);
    if (offset > ZIP_LIMIT) fields.push(offset);
    const extra = fields.length ? 4 + 8 * fields.length : 0;
    const record = new DataView(new ArrayBuffer(46 + name.length + extra));
    record.setUint32(0, CENTRAL, true);
    record.setUint16(4, fields.length ? 45 : 20, true); // made by: MS-DOS attributes
    record.setUint16(6, fields.length ? 45 : 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint16(10, 0, true);
    record.setUint16(12, time, true);
    record.setUint16(14, day, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, Math.min(size, ZIP_LIMIT), true);
    record.setUint32(24, Math.min(size, ZIP_LIMIT), true);
    record.setUint16(28, name.length, true);
    record.setUint16(30, extra, true);
    record.setUint16(32, 0, true); // no comment
    record.setUint16(34, 0, true); // the first disk
    record.setUint16(36, 0, true); // internal attributes
    record.setUint32(38, 0, true); // external attributes
    record.setUint32(42, Math.min(offset, ZIP_LIMIT), true);
    new Uint8Array(record.buffer).set(name, 46);
    if (fields.length) {
      let at = 46 + name.length;
      record.setUint16(at, 0x0001, true);
      record.setUint16(at + 2, 8 * fields.length, true);
      at += 4;
      for (const field of fields) {
        setUint64(record, at, field);
        at += 8;
      }
    }
    central.push(new Uint8Array(record.buffer));
    offset += local.byteLength + size;
  }
  const directorySize = central.reduce((total, record) => total + record.length, 0);
  const tail: ArrayBuffer[] = [];
  if (entries.length > 0xfffe || offset > ZIP_LIMIT || directorySize > ZIP_LIMIT) {
    const end64 = new DataView(new ArrayBuffer(56));
    end64.setUint32(0, END64, true);
    setUint64(end64, 4, 44);
    end64.setUint16(12, 45, true);
    end64.setUint16(14, 45, true);
    end64.setUint32(16, 0, true);
    end64.setUint32(20, 0, true);
    setUint64(end64, 24, entries.length);
    setUint64(end64, 32, entries.length);
    setUint64(end64, 40, directorySize);
    setUint64(end64, 48, offset);
    const locator = new DataView(new ArrayBuffer(20));
    locator.setUint32(0, LOCATOR64, true);
    locator.setUint32(4, 0, true);
    setUint64(locator, 8, offset + directorySize);
    locator.setUint32(16, 1, true);
    tail.push(end64.buffer, locator.buffer);
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, Math.min(entries.length, 0xffff), true);
  end.setUint16(10, Math.min(entries.length, 0xffff), true);
  end.setUint32(12, Math.min(directorySize, ZIP_LIMIT), true);
  end.setUint32(16, Math.min(offset, ZIP_LIMIT), true);
  end.setUint16(20, 0, true);
  tail.push(end.buffer);
  return new Blob([...parts, ...central.map((record) => record.buffer as ArrayBuffer), ...tail], { type: 'application/zip' });
}

/** An entry of an archive as its directory lists it. */
export interface ZipDirectoryEntry {
  name: string;
  size: number;
  crc: number;
  /** Where the local header stands in the archive. */
  offset: number;
  stored: boolean;
}

/** Read the zip64 sizes and offset out of a central record's extra field, where the record says to look there. */
function zip64Fields(extra: DataView, size: number, offset: number): { size: number; offset: number } {
  let at = 0;
  while (at + 4 <= extra.byteLength) {
    const id = extra.getUint16(at, true);
    const length = extra.getUint16(at + 2, true);
    if (id === 0x0001) {
      let field = at + 4;
      const read = () => {
        const value = Number(extra.getBigUint64(field, true));
        field += 8;
        return value;
      };
      if (size === ZIP_LIMIT) {
        size = read();
        read(); // the compressed size, the same for a stored entry
      }
      if (offset === ZIP_LIMIT) offset = read();
      break;
    }
    at += 4 + length;
  }
  return { size, offset };
}

/**
 * Parse an archive's directory out of its last bytes (`tail`, which must hold the end records
 * and the directory; `fileSize` is the archive's whole length, `tailStart` where the tail
 * begins in it). Null when the bytes hold no zip directory.
 */
export function parseZipDirectory(tail: Uint8Array, fileSize: number, tailStart: number): ZipDirectoryEntry[] | null {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let at = tail.length - 22;
  while (at >= 0 && view.getUint32(at, true) !== END) at--;
  if (at < 0) return null;
  let count = view.getUint16(at + 10, true);
  let dirSize = view.getUint32(at + 12, true);
  let dirOffset = view.getUint32(at + 16, true);
  const locatorAt = at - 20;
  if ((count === 0xffff || dirSize === ZIP_LIMIT || dirOffset === ZIP_LIMIT) && locatorAt >= 0 && view.getUint32(locatorAt, true) === LOCATOR64) {
    const end64At = Number(view.getBigUint64(locatorAt + 8, true)) - tailStart;
    if (end64At < 0 || view.getUint32(end64At, true) !== END64) return null;
    count = Number(view.getBigUint64(end64At + 32, true));
    dirSize = Number(view.getBigUint64(end64At + 40, true));
    dirOffset = Number(view.getBigUint64(end64At + 48, true));
  }
  const start = dirOffset - tailStart;
  if (start < 0 || start + dirSize > tail.length) return null;
  const entries: ZipDirectoryEntry[] = [];
  const decoder = new TextDecoder();
  let cursor = start;
  for (let index = 0; index < count && cursor + 46 <= tail.length; index++) {
    if (view.getUint32(cursor, true) !== CENTRAL) return null;
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const name = decoder.decode(tail.subarray(cursor + 46, cursor + 46 + nameLength));
    const extra = new DataView(tail.buffer, tail.byteOffset + cursor + 46 + nameLength, extraLength);
    const { size, offset } = zip64Fields(extra, view.getUint32(cursor + 24, true), view.getUint32(cursor + 42, true));
    entries.push({ name, size, crc, offset, stored: method === 0 });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** An archive served over HTTP, read by ranges: its directory, and its stored entries one at a time. */
export interface RemoteZip {
  entries: ZipDirectoryEntry[];
  /** The content of a stored entry, with a media type from its extension. */
  read(name: string): Promise<Blob>;
}

const TYPES: Record<string, string> = { webm: 'video/webm', mp4: 'video/mp4', m4a: 'audio/mp4', json: 'application/json' };

/**
 * Open an archive at `url` by range requests: its tail for the directory, then each entry's
 * bytes as asked. A host that ignores ranges answers with the whole file, which is then kept
 * and sliced. Throws when the file is not a zip archive or cannot be reached.
 */
export async function openRemoteZip(url: string, tailSize = 66_000): Promise<RemoteZip> {
  let whole: Blob | null = null;
  let fileSize: number;
  let tail: Uint8Array;
  let tailStart: number;
  const first = await fetch(url, { headers: { Range: `bytes=-${tailSize}` }, cache: 'no-store' });
  if (!first.ok) throw new Error(`Cannot load ${url}: the server answered ${first.status}`);
  if (first.status === 206) {
    const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(first.headers.get('Content-Range') ?? '');
    if (!range) throw new Error(`Cannot load ${url}: the range answer names no size`);
    fileSize = Number(range[3]);
    tailStart = Number(range[1]);
    tail = new Uint8Array(await first.arrayBuffer());
  } else {
    whole = await first.blob();
    fileSize = whole.size;
    tailStart = Math.max(0, fileSize - tailSize);
    tail = new Uint8Array(await whole.slice(tailStart).arrayBuffer());
  }
  let entries = parseZipDirectory(tail, fileSize, tailStart);
  if (!entries && !whole && fileSize > tail.length) {
    // A directory longer than the tail read: fetch from where the end record says it starts.
    whole = null;
    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let at = tail.length - 22;
    while (at >= 0 && view.getUint32(at, true) !== END) at--;
    if (at >= 0) {
      let dirOffset = view.getUint32(at + 16, true);
      if (dirOffset === ZIP_LIMIT && at >= 20 && view.getUint32(at - 20, true) === LOCATOR64) {
        const end64At = Number(view.getBigUint64(at - 12, true));
        const end64 = await fetch(url, { headers: { Range: `bytes=${end64At}-${end64At + 55}` }, cache: 'no-store' });
        dirOffset = Number(new DataView(await end64.arrayBuffer()).getBigUint64(48, true));
      }
      const rest = await fetch(url, { headers: { Range: `bytes=${dirOffset}-${fileSize - 1}` }, cache: 'no-store' });
      tail = new Uint8Array(await rest.arrayBuffer());
      tailStart = dirOffset;
      entries = parseZipDirectory(tail, fileSize, tailStart);
    }
  }
  if (!entries) throw new Error(`${url} is not a zip archive`);
  const bytes = async (from: number, to: number): Promise<Blob> => {
    if (whole) return whole.slice(from, to + 1);
    const response = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, cache: 'no-store' });
    if (response.status === 206) return response.blob();
    if (!response.ok) throw new Error(`Cannot read ${url}: the server answered ${response.status}`);
    whole = await response.blob();
    return whole.slice(from, to + 1);
  };
  const found = entries;
  return {
    entries: found,
    async read(name) {
      const entry = found.find((candidate) => candidate.name === name);
      if (!entry) throw new Error(`${name} is not in the archive`);
      if (!entry.stored) throw new Error(`${name} is compressed; a bundle stores its files as they are`);
      // The data follows the local header, whose own name and extra lengths say where.
      const header = new DataView(await (await bytes(entry.offset, entry.offset + 29)).arrayBuffer());
      if (header.getUint32(0, true) !== LOCAL) throw new Error(`${name}: the archive is damaged`);
      const dataOffset = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
      const type = TYPES[name.split('.').pop() ?? ''] ?? 'application/octet-stream';
      if (!entry.size) return new Blob([], { type });
      return new Blob([await bytes(dataOffset, dataOffset + entry.size - 1)], { type });
    },
  };
}
