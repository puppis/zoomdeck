/**
 * The deck as a web page, from the player: the preview server builds it as `zoomdown build` does
 * (bin/export.mjs), and this page takes the result into a folder the viewer chose, or the
 * browser's downloads, or has the server copy it into the `build/` folder next to the deck.
 */
import type { DeckFile } from '../deck';

const ENDPOINT = '/__zoomdown/export';

/** One self-contained HTML file, or a folder of files for a web server. */
export type WebPageForm = 'file' | 'folder';

export interface WebPageOptions {
  form: WebPageForm;
  /** Keep the presenter's `::: notes` in the export. */
  notes: boolean;
  /** Open the slide outline when the exported deck starts. */
  outline: boolean;
}

export interface WebExportFile {
  path: string;
  size: number;
}

export interface WebExportStatus {
  status: 'queued' | 'building' | 'done' | 'failed';
  error: string | null;
  files: WebExportFile[];
}

export interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

/** Whether the deck can be exported as a web page here: a preview server serves it and the page knows its file. */
export function webExportAvailable(file: DeckFile | null | undefined): boolean {
  return Boolean(file?.url && import.meta.hot);
}

/** A name for the exported file or folder: letters, digits, dots, dashes and underscores (the server applies the same rule). */
export function webExportName(value: string, fallback = 'deck'): string {
  return value.trim().replace(/[^\w.-]+/g, '-').replace(/^[^A-Za-z0-9]+|-+$/g, '') || fallback;
}

/** The name an export of the deck gets by default: a PDF's own name, otherwise the folder the deck's file lies in. */
export function defaultWebExportName(file: DeckFile | null | undefined, title: string): string {
  if (!file?.url) return webExportName(title);
  const parts = decodeURIComponent(new URL(file.url).pathname).split('/').filter(Boolean);
  const own = parts.at(-1) ?? '';
  if (/\.pdf$/i.test(own)) return webExportName(own.replace(/\.pdf$/i, ''), webExportName(title));
  return webExportName(parts.at(-2) || title);
}

async function call(method: string, query: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(`${ENDPOINT}?${new URLSearchParams(query)}`, { method, cache: 'no-store' });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.ok === false) throw new Error(String(payload.error ?? `the server answered ${response.status}`));
  return payload;
}

/** Have the server build the deck; resolves with the export's id once the build is queued. */
export async function startWebExport(file: DeckFile, options: WebPageOptions): Promise<string> {
  const query: Record<string, string> = { op: 'start', deck: file.url, form: options.form, notes: options.notes ? '1' : '0', outline: options.outline ? '1' : '0' };
  if (file.scene) query.scene = file.scene;
  return String((await call('POST', query)).id);
}

export async function webExportStatus(id: string): Promise<WebExportStatus> {
  const payload = await call('GET', { id });
  return { status: payload.status as WebExportStatus['status'], error: (payload.error as string | null) ?? null, files: (payload.files as WebExportFile[]) ?? [] };
}

/** Wait for the build, calling `onWait` meanwhile; null when `cancelled` says so first. */
export async function waitForWebExport(id: string, onWait: () => void, cancelled: () => boolean): Promise<WebExportStatus | null> {
  for (;;) {
    if (cancelled()) return null;
    const status = await webExportStatus(id);
    if (status.status === 'done' || status.status === 'failed') return status;
    onWait();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** A file of the result; `as` makes it a download of that name. */
export function webExportFileUrl(id: string, path: string, as?: string): string {
  return `${ENDPOINT}?${new URLSearchParams({ id, file: path, ...(as ? { as } : {}) })}`;
}

/** The whole result as a zip download, its files in a folder named `name`. */
export function webExportZipUrl(id: string, name: string): string {
  return `${ENDPOINT}?${new URLSearchParams({ id, zip: name })}`;
}

/** Throws, saying why, when the deck's build/ folder cannot receive an export of this name and form (something else is there). */
export async function checkWebExportPlace(file: DeckFile, name: string, form: WebPageForm): Promise<void> {
  await call('GET', { op: 'check', deck: file.url, name, form });
}

/** Have the server copy the result into the deck's build/ folder; resolves with where it went. */
export async function placeWebExport(id: string, name: string): Promise<string> {
  return String((await call('POST', { id, op: 'place', name })).path);
}

/** Let the server remove the result. */
export async function forgetWebExport(id: string): Promise<void> {
  await call('DELETE', { id }).catch(() => undefined);
}

/** Tell the server the page is writing files now, so that a deck whose folder receives them does not reload meanwhile. */
function announceWriting(): Promise<unknown> {
  return call('POST', { op: 'writing' }).catch(() => undefined);
}

/** Whether a folder handle holds `name`, and what: nothing, an earlier export (with an index.html), or something else. */
async function existing(parent: FileSystemDirectoryHandle, name: string): Promise<'none' | 'export' | 'other'> {
  let folder: FileSystemDirectoryHandle;
  try {
    folder = await parent.getDirectoryHandle(name);
  } catch (error) {
    return (error as DOMException).name === 'NotFoundError' ? 'none' : 'other';
  }
  try {
    await folder.getFileHandle('index.html');
    return 'export';
  } catch {
    const entries = (folder as unknown as { keys?: () => AsyncIterableIterator<string> }).keys?.();
    if (!entries) return 'other';
    return (await entries.next()).done ? 'none' : 'other';
  }
}

/** Why `name` cannot be written inside the chosen folder, or null when it can (absent, empty, or an earlier export, which is replaced). */
export async function folderProblem(parent: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  return (await existing(parent, name)) === 'other' ? `${parent.name}/${name} exists and is not an earlier export; choose another name or folder` : null;
}

/** Copy one file of the result into a file handle. */
async function copyInto(id: string, path: string, handle: FileSystemFileHandle): Promise<void> {
  const response = await fetch(webExportFileUrl(id, path), { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: the server answered ${response.status}`);
  const writable = await handle.createWritable();
  if (response.body) await response.body.pipeTo(writable);
  else {
    await writable.write(await response.blob());
    await writable.close();
  }
}

/** Write the one-file result into the file the viewer chose. */
export async function writeWebExportFile(id: string, handle: FileSystemFileHandle): Promise<void> {
  await copyInto(id, 'offline.html', handle);
}

/**
 * Write the folder result into a folder `name` inside the one the viewer chose, replacing an
 * earlier export there; `onProgress` follows the files, and `cancelled` stops between two.
 */
export async function writeWebExportFolder(id: string, files: WebExportFile[], parent: FileSystemDirectoryHandle, name: string, onProgress: (done: number, total: number) => void, cancelled: () => boolean): Promise<boolean> {
  await announceWriting();
  if ((await existing(parent, name)) === 'export') await parent.removeEntry(name, { recursive: true });
  const root = await parent.getDirectoryHandle(name, { create: true });
  let last = Date.now();
  for (const [index, file] of files.entries()) {
    if (cancelled()) return false;
    const parts = file.path.split('/');
    let folder = root;
    for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create: true });
    await copyInto(id, file.path, await folder.getFileHandle(parts[parts.length - 1], { create: true }));
    onProgress(index + 1, files.length);
    if (Date.now() - last > 5000) {
      last = Date.now();
      await announceWriting();
    }
  }
  return true;
}

/** Start a download of a URL of this server under `name`. */
export function downloadUrl(url: string, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
