/** An entry of a bundle as its directory lists it. */
export interface BundleEntry {
  name: string;
  size: number;
  crc: number;
  /** Where the local header stands in the file. */
  offset: number;
  /** Where the data begins in the file. */
  dataOffset: number;
  stored: boolean;
}

/** The entries written so far, as the writer and the journal keep them. */
export interface WrittenEntry {
  name: string;
  size: number;
  crc: number;
  offset: number;
}

/** Continue a CRC-32 over `bytes`; start from 0 and read the result as it is. */
export function crc32(bytes: Uint8Array, crc?: number): number;
/** The entries of a finished bundle and where its directory starts; null without a directory. */
export function readDirectory(path: string): Promise<{ entries: BundleEntry[]; directoryOffset: number; fileSize: number } | null>;
/** The content of one stored entry, read whole. */
export function readEntry(path: string, entry: BundleEntry): Promise<Buffer>;
/** The journal file that accompanies a bundle while it is being written. */
export function journalPath(path: string): string;
/** Whether a file in a recordings folder is a bundle's journal. */
export function isJournal(file: string): boolean;
/** Close a bundle left without its directory from its journal; true when it was repaired. */
export function recoverBundle(path: string): Promise<boolean>;
/** Unpack a bundle's entries into `folder` as plain files; resolves with their names. */
export function extractBundle(path: string, folder: string): Promise<string[]>;
/** The header builders, for tests of the format's edge cases. */
export const headers: {
  localHeader(name: string, crc: number, size: number, date: Date): Buffer;
  centralRecord(entry: WrittenEntry, date: Date): Buffer;
  directory(entries: WrittenEntry[], offset: number, date: Date): Buffer;
};

/** Writes a bundle while a talk is recorded, or continues one. */
export class BundleWriter {
  constructor(path: string, entries?: WrittenEntry[], date?: Date);
  readonly path: string;
  entries: WrittenEntry[];
  /** Open `path` for writing (creating it, or continuing the talk it holds); `timelineName` is the entry the directory ends with. */
  static open(path: string, timelineName: string): Promise<BundleWriter>;
  /** The names of the entries written so far. */
  readonly names: string[];
  /** Begin an entry whose size is not known yet. */
  begin(name: string): Promise<void>;
  /** Append a chunk of the entry being written. */
  write(chunk: Uint8Array): Promise<void>;
  /** Close the entry being written; null when none was. */
  end(): Promise<WrittenEntry | null>;
  /** Add a whole file at once. */
  putFile(name: string, data: Uint8Array): Promise<WrittenEntry | null>;
  /** Begin an entry of a side lane (the filmed screen by default, or the computer's sound), kept in a file beside the bundle until the main lane is between entries. */
  beginSide(name: string, lane?: 'screen' | 'system'): Promise<void>;
  writeSide(chunk: Uint8Array, lane?: 'screen' | 'system'): Promise<void>;
  /** Close a side lane's file; it joins the bundle as soon as the main lane allows, or at the end. */
  endSide(lane?: 'screen' | 'system'): Promise<void>;
  /** Keep the latest draft of the timeline in the journal. */
  draft(timeline: unknown): Promise<void>;
  /** Write the directory, close the file and remove the journal. */
  finish(): Promise<void>;
  /** Let go of the file without a directory; the journal stays for recovery. */
  release(): Promise<void>;
}
