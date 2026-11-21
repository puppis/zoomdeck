// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appImageTarget,
  compareVersions,
  download,
  findUpdate,
  installKind,
  isDownloaded,
  macSidePaths,
  pickAsset,
  swapMacApp,
  tidyBesideMacApp,
  Updater,
  type Install,
} from '../desktop/update.mjs';

/** The assets of a release, as electron-builder names them (those of v0.7.0). */
const NAMES = [
  'ZoomDown-0.7.1-arm64-mac.zip',
  'ZoomDown-0.7.1-arm64.dmg',
  'ZoomDown-0.7.1-mac.zip',
  'ZoomDown-0.7.1.AppImage',
  'ZoomDown-0.7.1.dmg',
  'ZoomDown.0.7.1.exe',
  'ZoomDown.Setup.0.7.1.exe',
  'zoomdown_0.7.1_amd64.deb',
];
const assets = NAMES.map((name) => ({ name, size: 10, browser_download_url: `https://example.org/${name}` }));
const release = (tag: string, extra: Record<string, unknown> = {}) => ({ tag_name: tag, html_url: `https://example.org/${tag}`, assets, ...extra });

const temporary = () => mkdtempSync(join(tmpdir(), 'zoomdown-update-'));
const install = (kind: Install['kind'], self: boolean, target = '/x'): Install => ({ kind, self, target });

describe('a version', () => {
  it('is compared number by number', () => {
    expect(compareVersions('v0.7.1', '0.7.0')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v0.7.0', '0.7.0')).toBe(0);
    expect(compareVersions('0.6.13', '0.7.0')).toBeLessThan(0);
    expect(compareVersions('nightly', '0.7.0')).toBe(0);
  });
});

describe('an installed copy', () => {
  const none = () => false;
  it('is told apart by where it runs from', () => {
    expect(installKind({ platform: 'darwin', execPath: '/Applications/ZoomDown.app/Contents/MacOS/ZoomDown', env: {}, writable: () => true, exists: none }))
      .toEqual({ kind: 'mac', self: true, target: '/Applications/ZoomDown.app' });
    // Run from the disk image: it cannot replace itself.
    expect(installKind({ platform: 'darwin', execPath: '/Volumes/ZoomDown 0.7.0/ZoomDown.app/Contents/MacOS/ZoomDown', env: {}, writable: none, exists: none })?.self).toBe(false);
    // Electron run from a checkout is not an app of ours.
    expect(installKind({ platform: 'darwin', execPath: '/repo/node_modules/electron/dist/Electron', env: {}, writable: () => true, exists: none })).toBeNull();
    const windows = 'C:\\Users\\me\\AppData\\Local\\Programs\\zoomdown\\ZoomDown.exe';
    expect(installKind({ platform: 'win32', execPath: windows, env: {}, writable: none, exists: (path) => path.endsWith('\\Uninstall ZoomDown.exe') })?.kind).toBe('nsis');
    expect(installKind({ platform: 'win32', execPath: windows, env: { PORTABLE_EXECUTABLE_FILE: 'D:\\ZoomDown.0.7.0.exe' }, writable: none, exists: none }))
      .toEqual({ kind: 'portable', self: false, target: 'D:\\ZoomDown.0.7.0.exe' });
    expect(installKind({ platform: 'linux', execPath: '/tmp/.mount_x/zoomdown', env: { APPIMAGE: '/home/me/Apps/ZoomDown-0.7.0.AppImage' }, writable: (path) => path === '/home/me/Apps', exists: none }))
      .toEqual({ kind: 'appimage', self: true, target: '/home/me/Apps/ZoomDown-0.7.0.AppImage' });
    expect(installKind({ platform: 'linux', execPath: '/opt/ZoomDown/zoomdown', env: {}, writable: none, exists: none })?.kind).toBe('deb');
  });

  it('gets the asset made for it', () => {
    const name = (kind: Install['kind'], self: boolean, arch = 'x64') => pickAsset(assets, install(kind, self), arch)?.name;
    expect(name('mac', true, 'arm64')).toBe('ZoomDown-0.7.1-arm64-mac.zip');
    expect(name('mac', true)).toBe('ZoomDown-0.7.1-mac.zip');
    expect(name('mac', false, 'arm64')).toBe('ZoomDown-0.7.1-arm64.dmg');
    expect(name('mac', false)).toBe('ZoomDown-0.7.1.dmg');
    expect(name('nsis', true)).toBe('ZoomDown.Setup.0.7.1.exe');
    expect(name('portable', false)).toBe('ZoomDown.0.7.1.exe');
    expect(name('appimage', true)).toBe('ZoomDown-0.7.1.AppImage');
    expect(name('appimage', true, 'arm64')).toBeUndefined();
    expect(name('deb', false)).toBe('zoomdown_0.7.1_amd64.deb');
  });
});

describe('a release', () => {
  it('is an update when it is newer and published', () => {
    const options = { version: '0.7.0', install: install('mac', true), arch: 'x64' };
    expect(findUpdate(release('v0.7.1'), options)).toEqual({
      version: '0.7.1',
      page: 'https://example.org/v0.7.1',
      asset: { name: 'ZoomDown-0.7.1-mac.zip', size: 10, url: 'https://example.org/ZoomDown-0.7.1-mac.zip', digest: null },
    });
    expect(findUpdate(release('v0.7.0'), options)).toBeNull();
    expect(findUpdate(release('v0.6.13'), options)).toBeNull();
    expect(findUpdate(release('v0.8.0', { prerelease: true }), options)).toBeNull();
    // A copy that does not update itself is pointed to the release's page.
    expect(findUpdate(release('v0.7.1'), { ...options, install: null })?.asset).toBeNull();
  });

  it('keeps an AppImage\'s name in step with its version', () => {
    expect(appImageTarget('/a/ZoomDown-0.7.0.AppImage', '0.7.0', '0.7.1')).toBe('/a/ZoomDown-0.7.1.AppImage');
    expect(appImageTarget('/a/ZoomDown.AppImage', '0.7.0', '0.7.1')).toBe('/a/ZoomDown.AppImage');
  });
});

/** A fetch that answers `url` with `body`, counting the requests. */
function serving(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  const fetch = async (url: string) => {
    asked.push(url);
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    return route();
  };
  return { fetch, asked };
}

describe('a download', () => {
  const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const asset = { name: 'ZoomDown-0.7.1.AppImage', size: bytes.length, url: 'https://example.org/file', digest };

  it('is checked against its digest, and kept once whole', async () => {
    const folder = temporary();
    const file = join(folder, asset.name);
    const mark = `${file}.checked`;
    const { fetch, asked } = serving({ 'https://example.org/file': () => new Response(bytes) });
    const progress: number[] = [];
    await download(asset, file, mark, { fetch, onProgress: (fraction) => progress.push(fraction) });
    expect(readFileSync(file)).toEqual(Buffer.from(bytes));
    expect(progress[progress.length - 1]).toBe(1);
    expect(await isDownloaded(asset, file, mark)).toBe(true);
    // Asked again, it is not fetched again.
    await download(asset, file, mark, { fetch });
    expect(asked.length).toBe(1);
  });

  it('is thrown away when damaged', async () => {
    const folder = temporary();
    const file = join(folder, asset.name);
    const damaged = bytes.slice();
    damaged[5] ^= 1;
    const { fetch } = serving({ 'https://example.org/file': () => new Response(damaged) });
    await expect(download(asset, file, `${file}.checked`, { fetch })).rejects.toThrow(/damaged/);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(`${file}.part`)).toBe(false);
  });
});

describe('a macOS app updated in place', () => {
  /** An old app in a folder with spaces and parentheses, and a new one unpacked elsewhere. */
  function apps() {
    const folder = temporary();
    const target = join(folder, 'Apps (test)', 'Zoom Down.app');
    const staged = join(folder, 'updates', 'staged-0.8.1', 'Zoom Down.app');
    for (const [app, text] of [[target, 'old'], [staged, 'new']]) {
      mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
      writeFileSync(join(app, 'Contents', 'version'), text);
    }
    const version = (app: string) => readFileSync(join(app, 'Contents', 'version'), 'utf8');
    return { target, staged, version };
  }

  it('takes the old one\'s place, with the relauncher set up while the old one still runs from there', async () => {
    const { target, staged, version } = apps();
    const relaunched: Array<{ execPath: string; args: string[]; found: string }> = [];
    await swapMacApp({
      target,
      staged,
      executable: 'ZoomDown',
      deck: '/talks/my deck.zd',
      relaunch: (options) => relaunched.push({ ...options, found: version(target) }),
    });
    expect(relaunched).toEqual([{ execPath: join(target, 'Contents', 'MacOS', 'ZoomDown'), args: ['/talks/my deck.zd'], found: 'old' }]);
    expect(version(target)).toBe('new');
    expect(existsSync(staged)).toBe(false);
    const { incoming, outgoing } = macSidePaths(target);
    expect(existsSync(incoming)).toBe(false);
    // The old one waits aside, for the new one to remove it.
    expect(version(outgoing)).toBe('old');
    await tidyBesideMacApp(target);
    expect(existsSync(outgoing)).toBe(false);
    expect(version(target)).toBe('new');
  });

  it('leaves the old one in place, with no restart set up, when the new one cannot be moved', async () => {
    const { target, version } = apps();
    const relaunched: unknown[] = [];
    await expect(swapMacApp({ target, staged: join(target, '..', 'missing.app'), executable: 'ZoomDown', relaunch: (options) => relaunched.push(options) })).rejects.toThrow();
    expect(relaunched).toEqual([]);
    expect(version(target)).toBe('old');
  });
});

describe('the update cycle', () => {
  const bytes = new TextEncoder().encode('the new AppImage');
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const FEED = 'https://api.example.org/latest';

  /** An updater of an AppImage at 0.7.0, answering the prompts with `answers` in turn. */
  function cycle(answers: number[], tag = 'v0.7.1') {
    const folder = temporary();
    const apps = join(folder, 'Apps');
    mkdirSync(apps);
    const old = join(apps, 'ZoomDown-0.7.0.AppImage');
    writeFileSync(old, 'the old AppImage');
    const asset = { name: 'ZoomDown-0.7.1.AppImage', size: bytes.length, browser_download_url: 'https://example.org/new', digest };
    const { fetch, asked } = serving({
      [FEED]: () => Response.json({ tag_name: tag, html_url: 'https://example.org/notes', assets: [asset] }),
      'https://example.org/new': () => new Response(bytes),
    });
    const prompts: string[] = [];
    const events: string[] = [];
    const relaunched: Array<{ execPath: string; args: string[] }> = [];
    const updater = new Updater({
      version: '0.7.0',
      arch: 'x64',
      install: { kind: 'appimage', self: true, target: old },
      feed: FEED,
      folder: join(folder, 'updates'),
      downloads: join(folder, 'Downloads'),
      store: join(folder, 'update.json'),
      fetch,
      dialog: {
        showMessageBox: async (...args: unknown[]) => {
          const box = args[args.length - 1] as { message: string };
          prompts.push(box.message);
          return { response: answers.shift() ?? 0 };
        },
      },
      shell: { openExternal: (url: string) => events.push(`open ${url}`), openPath: () => undefined, showItemInFolder: () => undefined },
      deck: () => '/talks/slides.zd',
      quit: () => events.push('quit'),
      relaunch: (options) => relaunched.push(options),
    });
    return { updater, prompts, events, relaunched, asked, old, apps, folder };
  }

  it('downloads in the background when asked, then installs and starts the new version', async () => {
    const { updater, prompts, events, relaunched, old, apps } = cycle([0, 0]);
    await updater.check();
    expect(prompts).toEqual(['ZoomDown 0.7.1 is available', 'ZoomDown 0.7.1 is ready to install']);
    const target = join(apps, 'ZoomDown-0.7.1.AppImage');
    expect(readFileSync(target, 'utf8')).toBe('the new AppImage');
    expect(existsSync(old)).toBe(false);
    expect(relaunched).toEqual([{ execPath: target, args: ['/talks/slides.zd'] }]);
    expect(events).toEqual(['quit']);
  });

  it('keeps a download left for later, and offers to install it at the next start', async () => {
    const first = cycle([0, 1]);
    await first.updater.check();
    expect(first.updater.state).toBe('ready');
    expect(first.updater.label).toBe('Install ZoomDown 0.7.1…');
    expect(first.events).toEqual([]);
    // The next start: the same folders, nothing downloaded again.
    const again = new Updater({ ...(first.updater as unknown as { options: ConstructorParameters<typeof Updater>[0] }).options });
    const before = first.asked.length;
    await again.check();
    expect(first.asked.length).toBe(before + 1);
    expect(first.prompts.slice(-1)).toEqual(['ZoomDown 0.7.1 is ready to install']);
  });

  it('shows the release notes, and does not offer a version skipped', async () => {
    const { updater, prompts, events } = cycle([1, 3, 2]);
    await updater.check();
    expect(events).toEqual(['open https://example.org/notes']);
    expect(prompts.length).toBe(2);
    await updater.check();
    expect(prompts.length).toBe(2);
    // Asked for from the menu, it is offered all the same.
    await updater.check({ manual: true });
    expect(prompts.length).toBe(3);
  });

  it('removes, on a macOS app\'s next start, the version the update replaced', async () => {
    const folder = temporary();
    const target = join(folder, 'Apps', 'ZoomDown.app');
    const { outgoing } = macSidePaths(target);
    mkdirSync(join(target, 'Contents'), { recursive: true });
    mkdirSync(join(outgoing, 'Contents'), { recursive: true });
    const { fetch } = serving({ [FEED]: () => Response.json({ tag_name: 'v0.8.1', assets: [] }) });
    const updater = new Updater({
      version: '0.8.1', arch: 'x64', install: { kind: 'mac', self: true, target }, feed: FEED,
      folder: join(folder, 'updates'), downloads: folder, store: join(folder, 'update.json'), fetch,
      dialog: { showMessageBox: async () => ({ response: 0 }) },
      shell: { openExternal: () => undefined, openPath: () => undefined, showItemInFolder: () => undefined },
      deck: () => null, quit: () => undefined, relaunch: () => undefined,
    });
    await updater.check();
    for (let i = 0; i < 20 && existsSync(outgoing); i++) await new Promise((resolve) => setTimeout(resolve, 25));
    expect(existsSync(outgoing)).toBe(false);
    expect(existsSync(target)).toBe(true);
  });

  it('says so when the latest version is the one running', async () => {
    const { updater, prompts } = cycle([], 'v0.7.0');
    await updater.check();
    expect(prompts).toEqual([]);
    await updater.check({ manual: true });
    expect(prompts).toEqual(['ZoomDown is up to date']);
  });
});
