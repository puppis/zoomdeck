import type { Plugin } from 'vite';

export const FOLDER: string;
export const NAME: RegExp;

export interface RecordingIndexEntry {
  name: string;
  title: string;
  recorded: string;
  duration: number;
  media: string | null;
  video: boolean;
  parts: number;
  /** The bundle holding the talk (`name.zip`); absent for a talk kept in plain files. */
  file?: string;
}

/** The files a recording consists of, among a folder's entries: bundle, journal, exported videos, plain files. */
export function recordingFiles(name: string, entries: string[]): string[];
/** The name of a talk's media file inside its bundle, by part number. */
export function mediaFileName(name: string, type: string, part: number): string;
/** Build the index of a recordings folder from the bundles and timelines it holds. */
export function buildIndex(folder: string): Promise<{ recordings: RecordingIndexEntry[] }>;
/** Write `index.json` in a recordings folder. */
export function writeIndex(folder: string): Promise<{ recordings: RecordingIndexEntry[] }>;
/** The deck folder a request names, when it lies inside one of the served roots; null otherwise. */
export function deckFolderFor(deck: string, roots: string[], root: string): string | null;
/** Whether a changed file belongs to a recordings folder. */
export function isRecordingFile(file: string): boolean;
/** Let go of every bundle being written (the server stops). */
export function releaseBundles(): Promise<void>;
/** Serves the recordings endpoints. */
export function recordingStore(options?: { roots?: string[]; limit?: number }): Plugin;
