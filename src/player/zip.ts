/**
 * A zip archive written in the browser, for a recording offered as a download: its media files
 * and timeline go into one file instead of several. The entries are stored, not deflated (the
 * media is compressed already, the timeline is small), so the archive is the files with their
 * headers and nothing is copied: the blob that comes out shares the blobs that went in.
 */

/** A file to put in the archive: its name inside the archive and its content. */
export interface ZipEntry {
  name: string;
  blob: Blob;
}

/** The largest file, and archive, the classic zip format describes (zip64 is not written). */
export const ZIP_LIMIT = 0xffff_ffff;

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

/**
 * Write `entries` into a zip archive. Names are UTF-8 (the archive says so), stored as given,
 * so a name with `/` makes folders. Throws when a file or the archive would exceed what the
 * format addresses (4 GiB); the caller then offers the files one by one.
 */
export async function zipFiles(entries: ZipEntry[], date = new Date()): Promise<Blob> {
  const encoder = new TextEncoder();
  const [time, day] = dosDateTime(date);
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (entry.blob.size > ZIP_LIMIT) throw new Error(`${entry.name} is too large for a zip archive`);
    const name = encoder.encode(entry.name);
    const crc = await blobCrc32(entry.blob);
    const size = entry.blob.size;
    // The local header, then the data as it is.
    const local = new DataView(new ArrayBuffer(30 + name.length));
    local.setUint32(0, 0x0403_4b50, true);
    local.setUint16(4, 20, true); // the version needed: 2.0
    local.setUint16(6, 0x0800, true); // the names are UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    new Uint8Array(local.buffer).set(name, 30);
    parts.push(local.buffer, entry.blob);
    // The matching entry of the central directory, written after all the files.
    const record = new DataView(new ArrayBuffer(46 + name.length));
    record.setUint32(0, 0x0201_4b50, true);
    record.setUint16(4, 20, true); // made by: version 2.0, MS-DOS attributes
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint16(10, 0, true);
    record.setUint16(12, time, true);
    record.setUint16(14, day, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, size, true);
    record.setUint32(24, size, true);
    record.setUint16(28, name.length, true);
    record.setUint16(30, 0, true); // no extra field
    record.setUint16(32, 0, true); // no comment
    record.setUint16(34, 0, true); // the first disk
    record.setUint16(36, 0, true); // internal attributes
    record.setUint32(38, 0, true); // external attributes
    record.setUint32(42, offset, true);
    new Uint8Array(record.buffer).set(name, 46);
    central.push(new Uint8Array(record.buffer));
    offset += local.byteLength + size;
    if (offset > ZIP_LIMIT) throw new Error('The files are too large for one zip archive');
  }
  const directorySize = central.reduce((total, record) => total + record.length, 0);
  if (offset + directorySize + 22 > ZIP_LIMIT) throw new Error('The files are too large for one zip archive');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x0605_4b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);
  return new Blob([...parts, ...central.map((record) => record.buffer as ArrayBuffer), end.buffer], { type: 'application/zip' });
}
