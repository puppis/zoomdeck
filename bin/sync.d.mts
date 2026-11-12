import type { Plugin } from 'vite';

export const REGISTRY_DIR: string;
export const EDITOR_PRESETS: Record<string, Array<string | string[]>>;

export interface PreviewEntry {
  port: number;
  pid: number;
  roots: string[];
  deck: string | null;
  editor: string | null;
  started: number;
}

/** A path with forward slashes. */
export function slashes(path: string): string;
/** Split a command line into arguments: whitespace separates, single or double quotes group. */
export function splitCommand(text: string): string[];
/** The first of `names` found on PATH, or null. */
export function findExecutable(names: string[]): string | null;
/** The argument list that opens `file` at `line` with the editor `spec`, or null for an empty spec. */
export function editorCommand(spec: string | null | undefined, file: string, line: number): string[] | null;
/** Open `file` at `line` in the editor named by `spec`. */
export function openInEditor(spec: string | null | undefined, file: string, line: number): Promise<string[]>;
/** Register a running preview; returns the function that removes the entry. */
export function registerPreview(options: { port: number; roots: string[]; deck?: string | null; editor?: string | null }): () => void;
/** Registered previews whose process is still running, newest first. */
export function previews(): PreviewEntry[];
/** The previews watching `file`'s folder, or every running preview when none does. */
export function previewsFor(file: string, entries?: PreviewEntry[]): PreviewEntry[];
/** Ask a running preview to show the stop of `line` in `file`. */
export function requestJump(entry: PreviewEntry, file: string, line: number): Promise<{ ok: boolean; file: string; line: number }>;
/** The file-system path of a document the player names: a URL under the server, or a path. */
export function documentPath(file: string | null | undefined, root: string): string | null;
/** Serves the synchronization endpoints and registers the preview. */
export function editorSync(options?: { editor?: string | null; roots?: string[]; deck?: string | null }): Plugin;
