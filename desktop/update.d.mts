/** Types of the desktop app's updates, for the tests. */
export const LATEST_RELEASE: string;
export const RELEASES_PAGE: string;
export const NSIS_ARGUMENTS: string[];

export interface Install {
  kind: 'mac' | 'nsis' | 'portable' | 'appimage' | 'deb';
  self: boolean;
  target: string;
}

export interface Asset {
  name: string;
  size: number;
  url: string;
  digest: string | null;
}

export interface Update {
  version: string;
  page: string;
  asset: Asset | null;
}

export function parseVersion(text: unknown): number[] | null;
export function compareVersions(a: string, b: string): number;
export function installKind(probe: { platform: string; execPath: string; env: Record<string, string | undefined>; writable: (path: string) => boolean; exists: (path: string) => boolean }): Install | null;
export function probeInstall(probe?: { platform?: string; execPath?: string; env?: Record<string, string | undefined> }): Install | null;
export function pickAsset(assets: Array<{ name: string; size: number; browser_download_url: string; digest?: string }>, install: Install | null, arch: string): Asset | null;
export function findUpdate(release: unknown, options: { version: string; install: Install | null; arch: string }): Update | null;
export function isDownloaded(asset: Asset, file: string, mark: string): Promise<boolean>;
export function download(asset: Asset, file: string, mark: string, options: { fetch: (url: string, init?: RequestInit) => Promise<Response>; onProgress?: (fraction: number) => void; signal?: AbortSignal }): Promise<string>;
export function stageMacApp(zip: string, folder: string): Promise<string>;
export function macSidePaths(target: string): { incoming: string; outgoing: string };
export function swapMacApp(options: { target: string; staged: string; executable: string; deck?: string | null; relaunch: (options: { execPath: string; args: string[] }) => void }): Promise<void>;
export function tidyBesideMacApp(target: string): Promise<void>;
export function appImageTarget(current: string, oldVersion: string, newVersion: string): string;

export interface UpdaterOptions {
  version: string;
  arch: string;
  install: Install | null;
  feed: string;
  folder: string;
  downloads: string;
  store: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  dialog: { showMessageBox(...args: unknown[]): Promise<{ response: number }> };
  shell: { openExternal(url: string): unknown; openPath(path: string): unknown; showItemInFolder(path: string): void };
  window?: () => unknown;
  deck: () => string | null;
  whenFree?: () => Promise<void>;
  progress?: (fraction: number) => void;
  quit: () => void;
  relaunch: (options: { execPath: string; args: string[] }) => void;
  spawn?: unknown;
  onChange?: () => void;
}

export class Updater {
  constructor(options: UpdaterOptions);
  state: 'idle' | 'checking' | 'downloading' | 'ready';
  update: Update | null;
  fraction: number;
  readonly label: string;
  readonly enabled: boolean;
  abort(): void;
  check(options?: { manual?: boolean }): Promise<void>;
}
