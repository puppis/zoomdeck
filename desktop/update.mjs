/**
 * Updates of the desktop app. Once a deck is open, the app asks GitHub for the latest release;
 * when it is newer than the running version, it offers to download it. The download runs in
 * the background while the deck stays in use, its progress on the Dock or taskbar icon; once it
 * is ready the app asks again, and installing quits the app, puts the new version in place of
 * the old one and starts it again. Nothing runs between two starts of the app.
 *
 * How a copy updates depends on how it was installed:
 * - macOS, an app in a folder the user can write to (Applications, as a rule): the release's
 *   .zip is unpacked and checked; installing moves the new app in place of the old one as the
 *   app quits, and Electron's relauncher starts it (see swapMacApp). The builds carry an ad-hoc
 *   signature only, which the system's update framework (and electron-updater, built on it)
 *   does not accept.
 * - macOS, an app that cannot replace itself (run from the disk image, or from Downloads without
 *   being moved): the .dmg is downloaded to the Downloads folder and opened.
 * - Windows, installed by the installer: the new installer runs silently over the old version
 *   and starts the app again, as electron-updater does.
 * - Windows, the portable program: the new one is downloaded to the Downloads folder.
 * - Linux, an AppImage in a folder the user can write to: the new AppImage takes the old one's
 *   place; otherwise it is downloaded to the Downloads folder.
 * - Linux, the .deb: the new package is downloaded to the Downloads folder and opened, which
 *   installs it with the system's software installer.
 * Anything else (a checkout, an unpacked build) is pointed to the releases page.
 *
 * Every download is checked against the SHA-256 digest GitHub publishes for the asset.
 */
import { createHash } from 'node:crypto';
import { execFile, spawn as spawnProcess } from 'node:child_process';
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { basename, dirname, join, posix, win32 } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The latest release of the app, as GitHub's API describes it. */
export const LATEST_RELEASE = 'https://api.github.com/repos/puppis/zoomdown/releases/latest';
export const RELEASES_PAGE = 'https://github.com/puppis/zoomdown/releases';
const PRODUCT = 'ZoomDown';

/** The numbers of a version such as `v1.2.3` or `1.2.3`, or null. */
export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? '').trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

/** Negative, zero or positive as version `a` is older than, the same as or newer than `b`; versions that do not read as one are the same. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * How this copy of the app is installed: its kind, whether it can replace itself, and the
 * bundle or file it would replace; null for a copy that does not update (a checkout, an
 * unpacked build). `writable` and `exists` look at the disk, so that this can be tested.
 * @param {{ platform: string, execPath: string, env: Record<string, string | undefined>, writable: (path: string) => boolean, exists: (path: string) => boolean }} probe
 */
export function installKind({ platform, execPath, env, writable, exists }) {
  const path = platform === 'win32' ? win32 : posix;
  if (platform === 'darwin') {
    const bundle = path.resolve(execPath, '..', '..', '..');
    if (!bundle.endsWith('.app')) return null;
    return { kind: 'mac', self: writable(path.dirname(bundle)) && writable(bundle), target: bundle };
  }
  if (platform === 'win32') {
    if (env.PORTABLE_EXECUTABLE_FILE) return { kind: 'portable', self: false, target: env.PORTABLE_EXECUTABLE_FILE };
    if (exists(path.join(path.dirname(execPath), `Uninstall ${PRODUCT}.exe`))) return { kind: 'nsis', self: true, target: execPath };
    return null;
  }
  if (platform === 'linux') {
    if (env.APPIMAGE) return { kind: 'appimage', self: writable(path.dirname(env.APPIMAGE)), target: env.APPIMAGE };
    if (execPath.startsWith('/opt/')) return { kind: 'deb', self: false, target: execPath };
  }
  return null;
}

/** How this running copy is installed, looking at the disk. */
export function probeInstall({ platform = process.platform, execPath = process.execPath, env = process.env } = {}) {
  return installKind({
    platform,
    execPath,
    env,
    writable: (path) => {
      try {
        accessSync(path, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
    exists: existsSync,
  });
}

/** The release asset for a copy of this kind and processor, by the names electron-builder gives them. */
export function pickAsset(assets, install, arch) {
  if (!install) return null;
  const arm = arch === 'arm64';
  const otherArch = /-(arm64|armv7l|ia32)[-.]/;
  const fits = {
    mac: install.self
      ? (name) => (arm ? name.endsWith('-arm64-mac.zip') : name.endsWith('-mac.zip') && !otherArch.test(name))
      : (name) => (arm ? name.endsWith('-arm64.dmg') : name.endsWith('.dmg') && !otherArch.test(name)),
    nsis: (name) => /setup.*\.exe$/i.test(name),
    portable: (name) => /\.exe$/i.test(name) && !/setup/i.test(name),
    appimage: (name) => (arm ? name.endsWith('-arm64.AppImage') : name.endsWith('.AppImage') && !otherArch.test(name)),
    deb: (name) => name.endsWith(arm ? '_arm64.deb' : '_amd64.deb'),
  }[install.kind];
  const asset = fits ? assets.find((candidate) => fits(String(candidate.name))) : null;
  return asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url, digest: asset.digest ?? null } : null;
}

/**
 * The update a release brings to a copy of `version`, or null when it is not newer: its
 * version, its page and the asset for this copy (null when the copy does not update itself
 * and nothing fits it).
 */
export function findUpdate(release, { version, install, arch }) {
  if (!release || release.draft || release.prerelease) return null;
  const numbers = parseVersion(release.tag_name);
  if (!numbers || compareVersions(release.tag_name, version) <= 0) return null;
  return {
    version: numbers.join('.'),
    page: release.html_url || RELEASES_PAGE,
    asset: pickAsset(Array.isArray(release.assets) ? release.assets : [], install, arch),
  };
}

/** Whether `file` holds the asset, downloaded whole and checked (the check is noted in `mark`). */
export async function isDownloaded(asset, file, mark) {
  try {
    const [info, noted] = await Promise.all([stat(file), readFile(mark, 'utf8')]);
    return info.size === asset.size && noted.trim() === (asset.digest ?? `size:${asset.size}`);
  } catch {
    return false;
  }
}

/**
 * Download `asset` to `file`, checking its size and digest; `mark` notes that it was checked, so
 * that a later start finds it ready. A file already downloaded is kept.
 */
export async function download(asset, file, mark, { fetch, onProgress = () => undefined, signal } = {}) {
  if (await isDownloaded(asset, file, mark)) return file;
  await mkdir(dirname(file), { recursive: true });
  const part = `${file}.part`;
  const response = await fetch(asset.url, { signal });
  if (!response.ok || !response.body) throw new Error(`the download failed (HTTP ${response.status})`);
  const total = asset.size || Number(response.headers.get('content-length')) || 0;
  const hash = createHash('sha256');
  const out = createWriteStream(part);
  let received = 0;
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await once(out, 'drain');
      if (total) onProgress(Math.min(1, received / total));
    }
    out.end();
    await once(out, 'finish');
  } catch (error) {
    out.destroy();
    await rm(part, { force: true });
    throw error;
  }
  const digest = `sha256:${hash.digest('hex')}`;
  if ((asset.size && received !== asset.size) || (asset.digest && asset.digest !== digest)) {
    await rm(part, { force: true });
    throw new Error('the download is incomplete or damaged');
  }
  await rename(part, file);
  await writeFile(mark, asset.digest ?? `size:${asset.size}`);
  return file;
}

/** Unpack a macOS app from the release's .zip into `folder` and check its signature; the path of the app. */
export async function stageMacApp(zip, folder) {
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  await run('ditto', ['-x', '-k', zip, folder]);
  const name = (await readdir(folder)).find((entry) => entry.endsWith('.app'));
  if (!name) throw new Error('the update holds no app');
  const app = posix.join(folder, name);
  await run('codesign', ['--verify', '--deep', '--strict', app]);
  return app;
}

/** Where, beside the app `target`, the new version waits to move in and the old one goes once moved out. */
export function macSidePaths(target) {
  const parent = dirname(target);
  const name = basename(target, '.app');
  return { incoming: join(parent, `.${name}-update.app`), outgoing: join(parent, `.${name}-previous.app`) };
}

/** Move an app, copying it when it goes to another volume. */
async function moveApp(from, to) {
  try {
    await rename(from, to);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await run('ditto', [from, to]);
    await rm(from, { recursive: true, force: true });
  }
}

/**
 * Put the new macOS app `staged` in place of the running app `target`, as the app quits. The new
 * app first moves beside the old one, onto the same volume, so that the swap itself is two
 * renames; Electron's relauncher is set up to start `executable` from the app's place with
 * `deck` once the app has quit; then the old app moves aside and the new one takes its name.
 *
 * The relauncher waits for the app to end and starts the program itself. Asking the system to
 * open the app instead (an earlier version ran `open` from a script once the app had quit) may
 * start nothing: right after an app quits, the system can still count it as running and only
 * bring it forward. The relauncher is set up before the old app moves, as it starts from the
 * running app's own program. The old app stays aside until the new one removes it
 * (tidyBesideMacApp). If the new app cannot take its place, the old one is put back and the
 * error thrown; the relauncher is set up by then, so quitting starts the app as it was.
 */
export async function swapMacApp({ target, staged, executable, deck = null, relaunch }) {
  const { incoming, outgoing } = macSidePaths(target);
  await rm(incoming, { recursive: true, force: true });
  await rm(outgoing, { recursive: true, force: true });
  await moveApp(staged, incoming);
  relaunch({ execPath: join(target, 'Contents', 'MacOS', executable), args: deck ? [deck] : [] });
  await rename(target, outgoing);
  try {
    await rename(incoming, target);
  } catch (error) {
    await rename(outgoing, target);
    throw error;
  }
}

/** Remove what an update left beside the app `target`: the old version, or a new one that did not move in. */
export async function tidyBesideMacApp(target) {
  const { incoming, outgoing } = macSidePaths(target);
  await Promise.all([incoming, outgoing].map((path) => rm(path, { recursive: true, force: true }).catch(() => undefined)));
}

/** Where a new AppImage goes: in place of the old one, renamed when the old name carries the old version. */
export function appImageTarget(current, oldVersion, newVersion) {
  const name = posix.basename(current);
  return name.includes(oldVersion) ? posix.join(posix.dirname(current), name.replace(oldVersion, newVersion)) : current;
}

/** The arguments that make electron-builder's Windows installer update in place, silently, and start the app again. */
export const NSIS_ARGUMENTS = ['--updated', '/S', '--force-run'];

const megabytes = (bytes) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;

/**
 * The update cycle of a running app: check, ask, download in the background, ask again,
 * install. Everything it touches outside comes in `options`, so that it runs without Electron in
 * the tests:
 *   version, arch, install (from `probeInstall`, or null), feed (the release's address),
 *   folder (where downloads are kept), downloads (the user's Downloads folder),
 *   store (a JSON file for the skipped version), fetch, dialog, shell, window() (the parent of
 *   the dialogs), deck() (the deck open now), whenFree(purpose) (resolves once the app is free:
 *   for a 'prompt' offered by itself, a deck is shown, not full screen, with no other dialog
 *   open; to 'quit' and install, no other dialog is open), progress(fraction, -1 to clear),
 *   quit(), relaunch(options), spawn,
 *   onChange() (the state changed: the menu shows it).
 */
export class Updater {
  constructor(options) {
    this.options = { spawn: spawnProcess, whenFree: async () => undefined, progress: () => undefined, onChange: () => undefined, ...options };
    /** 'idle', 'checking', 'downloading' or 'ready'. */
    this.state = 'idle';
    /** The update found, while one is being downloaded or is ready. */
    this.update = null;
    this.fraction = 0;
    this._file = null;
    this._controller = null;
  }

  /** The label of the menu item for updates. */
  get label() {
    switch (this.state) {
      case 'checking':
        return 'Checking for Updates…';
      case 'downloading':
        return `Downloading ${PRODUCT} ${this.update.version} (${Math.floor(this.fraction * 100)}%)…`;
      case 'ready':
        return `Install ${PRODUCT} ${this.update.version}…`;
      default:
        return 'Check for Updates…';
    }
  }

  /** Whether the menu item does something now. */
  get enabled() {
    return this.state === 'idle' || this.state === 'ready';
  }

  /** Stop a download under way (the app is quitting). */
  abort() {
    this._controller?.abort();
  }

  /**
   * Look for a newer version and offer it. At startup (`manual` false) failures stay quiet and a
   * version the user skipped is not offered again; from the menu, every outcome is told.
   */
  async check({ manual = false } = {}) {
    if (this.state === 'ready') return this._offerInstall({ manual: true });
    if (this.state !== 'idle') return undefined;
    // What the last update left beside the app: the version it replaced.
    const { install } = this.options;
    if (install?.kind === 'mac' && install.self) void tidyBesideMacApp(install.target);
    this._set('checking');
    let update;
    try {
      const response = await this.options.fetch(this.options.feed, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `${PRODUCT}/${this.options.version}` },
      });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      update = findUpdate(await response.json(), this.options);
    } catch (error) {
      this._set('idle');
      if (manual) await this._tell('warning', 'Updates could not be checked', `${error.message ?? error}. Check the network, or look at the releases page.`);
      else console.error('Checking for updates:', error);
      return undefined;
    }
    this._set('idle');
    await this._tidy(update);
    if (!update) {
      if (manual) await this._tell('info', `${PRODUCT} is up to date`, `Version ${this.options.version} is the latest.`);
      return undefined;
    }
    if (!manual && this._skipped() === update.version) return undefined;
    this.update = update;
    if (update.asset && (await isDownloaded(update.asset, this._paths().file, this._paths().mark))) {
      // Downloaded at an earlier start and left for later.
      return this._prepare({ manual });
    }
    return this._offerDownload({ manual });
  }

  /** The files of the update found. */
  _paths() {
    const { folder } = this.options;
    const name = this.update.asset.name;
    return {
      file: join(folder, name),
      mark: join(folder, `${name}.checked`),
      staged: join(folder, `staged-${this.update.version}`),
    };
  }

  async _offerDownload({ manual }) {
    const { version, install } = this.options;
    const update = this.update;
    if (!manual) await this.options.whenFree('prompt');
    if (!update.asset) {
      const response = await this._ask({
        type: 'info',
        message: `${PRODUCT} ${update.version} is available`,
        detail: `You have version ${version}. This copy of ${PRODUCT} does not update itself: the new version is on the releases page.`,
        buttons: ['Open the Releases Page', 'Later', 'Skip This Version'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) void this.options.shell.openExternal(update.page);
      if (response === 2) this._skip(update.version);
      this.update = null;
      return undefined;
    }
    const size = megabytes(update.asset.size);
    const background = 'which takes a couple of minutes: you can keep using ZoomDown meanwhile';
    const detail = {
      mac: install.self
        ? `The update (${size}) downloads in the background, ${background}, and ${PRODUCT} asks again when it is ready to install.`
        : `This copy cannot replace itself, as it does not run from a folder it can write to (it runs from the disk image, or was not moved to Applications). The disk image of the new version (${size}) downloads to your Downloads folder in the background, ${background}.`,
      nsis: `The update (${size}) downloads in the background, ${background}, and ${PRODUCT} asks again when it is ready to install.`,
      appimage: install.self
        ? `The new AppImage (${size}) downloads in the background, ${background}, and ${PRODUCT} asks again when it is ready to install.`
        : `The folder of this AppImage cannot be written to, so the new AppImage (${size}) downloads to your Downloads folder in the background, ${background}.`,
      portable: `The new portable program (${size}) downloads to your Downloads folder in the background, ${background}.`,
      deb: `The new package (${size}) downloads to your Downloads folder in the background, ${background}. Installing it then asks for your password.`,
    }[install.kind];
    for (;;) {
      const response = await this._ask({
        type: 'info',
        message: `${PRODUCT} ${update.version} is available`,
        detail: `You have version ${version}. ${detail}`,
        buttons: ['Download in the Background', 'Release Notes', 'Later', 'Skip This Version'],
        defaultId: 0,
        cancelId: 2,
      });
      if (response === 1) {
        void this.options.shell.openExternal(update.page);
        continue;
      }
      if (response === 0) return this._download();
      if (response === 3) this._skip(update.version);
      this.update = null;
      return undefined;
    }
  }

  async _download() {
    const update = this.update;
    const { file, mark } = this._paths();
    this._controller = new AbortController();
    this.fraction = 0;
    this._set('downloading');
    let lastStep = -1;
    try {
      await download(update.asset, file, mark, {
        fetch: this.options.fetch,
        signal: this._controller.signal,
        onProgress: (fraction) => {
          this.fraction = fraction;
          this.options.progress(fraction);
          // The menu shows the progress in steps of 5%.
          const step = Math.floor(fraction * 20);
          if (step !== lastStep) {
            lastStep = step;
            this.options.onChange();
          }
        },
      });
    } catch (error) {
      this.options.progress(-1);
      this._controller = null;
      this.update = null;
      this._set('idle');
      if (error?.name !== 'AbortError') {
        await this._tell('warning', 'The update could not be downloaded', `${error.message ?? error}. Try again later with Check for Updates.`);
      }
      return undefined;
    }
    this._controller = null;
    this.options.progress(-1);
    return this._prepare({ manual: false });
  }

  /** Get the downloaded update ready to install (unpacked and checked, or copied to the Downloads folder), then offer to install it. */
  async _prepare({ manual }) {
    const { install, downloads } = this.options;
    const { file, staged } = this._paths();
    try {
      if (install.kind === 'mac' && install.self) {
        this._file = await stageMacApp(file, staged);
      } else if (install.self) {
        this._file = file;
      } else {
        // The user installs it: a copy in the Downloads folder, where they look for it.
        this._file = join(downloads, this.update.asset.name);
        const there = await stat(this._file).catch(() => null);
        if (!there || there.size !== this.update.asset.size) await copyFile(file, this._file);
      }
    } catch (error) {
      this.update = null;
      this._set('idle');
      await this._tell('warning', 'The update could not be prepared', `${error.message ?? error}. Try again later with Check for Updates, or download it from the releases page.`);
      return undefined;
    }
    this._set('ready');
    return this._offerInstall({ manual });
  }

  async _offerInstall({ manual }) {
    const { install } = this.options;
    const update = this.update;
    if (!manual) await this.options.whenFree('prompt');
    const recording = ' Stop a recording first, if one is under way.';
    if (install.self) {
      const detail = {
        mac: `${PRODUCT} quits, puts the new version in place of this one and starts again with the deck open now; this takes a few seconds.`,
        nsis: `${PRODUCT} quits, and the installer puts the new version in place without a window and starts ${PRODUCT} again; this takes a minute or so.`,
        appimage: `${PRODUCT} quits, puts the new AppImage in place of this one and starts again with the deck open now; this takes a few seconds.`,
      }[install.kind];
      const response = await this._ask({
        type: 'info',
        message: `${PRODUCT} ${update.version} is ready to install`,
        detail: `${detail}${recording} Later, it stays ready for the next start.`,
        buttons: ['Install and Restart', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) await this._install();
      return undefined;
    }
    const file = this._file;
    const name = basename(file);
    const { shell } = this.options;
    if (install.kind === 'deb') {
      const response = await this._ask({
        type: 'info',
        message: `The ${PRODUCT} ${update.version} package is in your Downloads folder`,
        detail: `Open it to install it with the system's software installer, which asks for your password; then start ${PRODUCT} again.`,
        buttons: ['Open the Package', 'Show in Folder', 'Later'],
        defaultId: 0,
        cancelId: 2,
      });
      if (response === 0) void shell.openPath(file);
      if (response === 1) shell.showItemInFolder(file);
      return undefined;
    }
    if (install.kind === 'mac') {
      const response = await this._ask({
        type: 'info',
        message: `The disk image of ${PRODUCT} ${update.version} is in your Downloads folder`,
        detail: `Open it, quit ${PRODUCT}, and drag the new ${PRODUCT} to the Applications folder, replacing the old one; then start it from Applications, from where it updates itself next time.`,
        buttons: ['Open the Disk Image', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) void shell.openPath(file);
      return undefined;
    }
    const response = await this._ask({
      type: 'info',
      message: `${PRODUCT} ${update.version} is in your Downloads folder`,
      detail: install.kind === 'appimage'
        ? `Quit ${PRODUCT}, and use the new AppImage (${name}) in place of this one; make it executable first (chmod +x, or the file's properties).`
        : `Quit ${PRODUCT}, and use the new program (${name}) in place of this one.`,
      buttons: ['Show in Folder', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) shell.showItemInFolder(file);
    return undefined;
  }

  /** Quit, and put the new version in place. */
  async _install() {
    // A dialog of the app's still open would keep it from quitting.
    await this.options.whenFree('quit');
    const { install, version } = this.options;
    const update = this.update;
    const deck = this.options.deck();
    // Once the relauncher is set up, quitting starts the app again, whatever happens next.
    let relaunching = false;
    const relaunch = (options) => {
      relaunching = true;
      this.options.relaunch(options);
    };
    try {
      if (install.kind === 'mac') {
        await swapMacApp({ target: install.target, staged: this._file, executable: basename(process.execPath), deck, relaunch });
      } else if (install.kind === 'nsis') {
        await this._spawn(this._file, NSIS_ARGUMENTS);
      } else if (install.kind === 'appimage') {
        const target = appImageTarget(install.target, version, update.version);
        const part = posix.join(posix.dirname(target), `.${posix.basename(target)}.part`);
        await copyFile(this._file, part);
        await chmod(part, 0o755);
        await rename(part, target);
        if (target !== install.target) await unlink(install.target).catch(() => undefined);
        relaunch({ execPath: target, args: deck ? [deck] : [] });
      }
    } catch (error) {
      const restart = relaunching ? ` ${PRODUCT} starts again as it was;` : '';
      await this._tell('warning', 'The update could not be installed', `${error.message ?? error}.${restart} The releases page has the new version to install by hand.`);
      void this.options.shell.openExternal(update.page);
      if (relaunching) this.options.quit();
      return;
    }
    this.options.quit();
  }

  /** Start a program that outlives the app; resolves once it has started, rejects if it cannot. */
  async _spawn(command, args) {
    const child = this.options.spawn(command, args, { detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
  }

  /** Remove what earlier updates left behind, keeping the download of `update`. */
  async _tidy(update) {
    const { folder } = this.options;
    let entries;
    try {
      entries = await readdir(folder);
    } catch {
      return;
    }
    const keep = new Set(update?.asset ? [update.asset.name, `${update.asset.name}.checked`, `staged-${update.version}`] : []);
    await Promise.all(entries.filter((entry) => !keep.has(entry)).map((entry) => rm(join(folder, entry), { recursive: true, force: true }).catch(() => undefined)));
  }

  /** The version the user chose to skip, kept in the store file. */
  _skipped() {
    try {
      return JSON.parse(readFileSync(this.options.store, 'utf8')).skipped ?? null;
    } catch {
      return null;
    }
  }

  _skip(version) {
    try {
      mkdirSync(dirname(this.options.store), { recursive: true });
      writeFileSync(this.options.store, JSON.stringify({ skipped: version }));
    } catch {
      /* asked again next time */
    }
  }

  _set(state) {
    this.state = state;
    if (state === 'idle' || state === 'checking') this.fraction = 0;
    this.options.onChange();
  }

  async _ask(box) {
    const parent = this.options.window?.() ?? null;
    const { response } = parent ? await this.options.dialog.showMessageBox(parent, box) : await this.options.dialog.showMessageBox(box);
    return response;
  }

  async _tell(type, message, detail) {
    await this._ask({ type, message, detail, buttons: ['OK'] });
  }
}
