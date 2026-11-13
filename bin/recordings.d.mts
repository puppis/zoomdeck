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
}

/** The media and timeline files a recording consists of, among a folder's entries. */
export function recordingFiles(name: string, entries: string[]): string[];
/** Build the index of a recordings folder from the timelines it holds. */
export function buildIndex(folder: string): Promise<{ recordings: RecordingIndexEntry[] }>;
/** Write `index.json` in a recordings folder. */
export function writeIndex(folder: string): Promise<{ recordings: RecordingIndexEntry[] }>;
/** The deck folder a request names, when it lies inside one of the served roots; null otherwise. */
export function deckFolderFor(deck: string, roots: string[], root: string): string | null;
/** Rewrite a browser-recorded media file's container with ffmpeg, when installed, so it carries its duration and seek index. */
export function finishMediaFile(file: string): Promise<boolean>;
/** Whether a changed file belongs to a recordings folder. */
export function isRecordingFile(file: string): boolean;
/** Serves the recordings endpoints. */
export function recordingStore(options?: { roots?: string[]; limit?: number }): Plugin;
