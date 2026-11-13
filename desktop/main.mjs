/**
 * The desktop app: the same player and preview server as `zoomdeck serve`, in a window of its
 * own. It starts the server in this process (so pairing, recordings, the editor sync and the
 * command's flags all work as in the browser), opens the deck in a Chromium window, and adds
 * what a desktop program is expected to have: menus, Open and Open Recent, the system's
 * permission prompts for the camera and the microphone, and a screen picker for filming.
 *
 *   Zoomdeck [deck.json | slides.md] [--host] [--port N] [--editor NAME] [--watch PATH] [--scene Name]
 */
import { app, BrowserWindow, Menu, dialog, shell, session, desktopCapturer, screen, systemPreferences } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { startPreview, parseArgs, resolveDeckPath, deckKind } from '../bin/zoomdeck.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const GUIDE = join(packageRoot, 'examples', 'guide', 'deck.json');
const DOCS = 'https://puppis.github.io/zoomdeck/';
const REPOSITORY = 'https://github.com/puppis/zoomdeck';
const FLAGS = new Set(['--host', '--port', '--editor', '--watch', '--scene']);
const WITH_VALUE = new Set(['--port', '--editor', '--watch', '--scene']);

/** The command's own flags among the arguments; Electron's and Chromium's are left out. */
function ownArguments(argv) {
  const kept = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-')) {
      kept.push(arg);
    } else if (FLAGS.has(arg)) {
      kept.push(arg);
      if (WITH_VALUE.has(arg) && i + 1 < argv.length) kept.push(argv[++i]);
    }
  }
  return kept;
}

const argv = ownArguments(process.argv.slice(app.isPackaged ? 1 : 2));
const options = parseArgs(argv);
const smokeShot = process.env.ZOOMDECK_SMOKE || null;

let win = null;
let preview = null;
let current = null;

/** A port nobody listens on right now (Vite would take 5173 for a port of 0). */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

const recentFile = () => join(app.getPath('userData'), 'recent.json');
function readRecent() {
  try {
    const list = JSON.parse(readFileSync(recentFile(), 'utf8'));
    return Array.isArray(list) ? list.filter((item) => typeof item === 'string' && existsSync(item)) : [];
  } catch {
    return [];
  }
}
function remember(deckPath) {
  const list = [deckPath, ...readRecent().filter((item) => item !== deckPath)].slice(0, 10);
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(recentFile(), JSON.stringify(list));
  } catch {
    /* the list is a convenience */
  }
  app.addRecentDocument(deckPath);
  buildMenu();
}

/** Serve `deckPath` (replacing the deck served so far) and show it in the window. */
async function openDeck(deckPath) {
  const target = resolveDeckPath(deckPath);
  if (!existsSync(target) || !deckKind(target)) {
    dialog.showErrorBox('Zoomdeck', `Not a deck: ${deckPath}\nOpen a deck.json, a Markdown file or a slide module.`);
    return;
  }
  const previous = preview;
  preview = null;
  if (previous) await previous.server.close().catch(() => undefined);
  try {
    preview = await startPreview({
      ...options,
      positional: [target],
      open: false,
      // A free port, so the app never collides with a preview started from a terminal; --port insists on one.
      port: options.port ?? (await freePort()),
      cacheDir: join(app.getPath('userData'), 'vite-cache'),
    });
  } catch (error) {
    dialog.showErrorBox('Zoomdeck', `The deck could not be served:\n${error.message}`);
    return;
  }
  current = target;
  console.log(`Zoomdeck preview at ${preview.url}`);
  remember(target);
  if (!win) createWindow();
  await win.loadURL(preview.url);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    title: 'Zoomdeck',
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.on('closed', () => {
    win = null;
  });
  // Links to other pages open in the browser, not in the deck's window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // ZOOMDECK_SMOKE=<file.png>: wait for the deck to be ready, capture the window to the file and quit.
  if (smokeShot) {
    win.webContents.once('did-finish-load', async () => {
      const started = Date.now();
      try {
        for (;;) {
          const ready = await win.webContents.executeJavaScript('document.querySelector(".counter")?.textContent || ""');
          if (ready) break;
          if (Date.now() - started > 90_000) throw new Error('the deck did not become ready in 90 s');
          await new Promise((wait) => setTimeout(wait, 500));
        }
        await new Promise((wait) => setTimeout(wait, 1500));
        const image = await win.webContents.capturePage();
        writeFileSync(smokeShot, image.toPNG());
        console.log(`Smoke test: ready after ${((Date.now() - started) / 1000).toFixed(1)} s, wrote ${smokeShot}`);
      } catch (error) {
        console.error('Smoke test failed:', error);
        try {
          const state = await win.webContents.executeJavaScript('({ title: document.title, error: document.querySelector(".zd-stage .error")?.textContent ?? null, text: document.body.innerText.slice(0, 400) })');
          console.error('Page state:', JSON.stringify(state));
          const image = await win.webContents.capturePage();
          writeFileSync(smokeShot, image.toPNG());
        } catch {
          /* nothing more to report */
        }
        process.exitCode = 1;
      }
      app.quit();
    });
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') console.error(`[page] ${event.message}`);
    });
  }
}

async function chooseDeck() {
  const result = await dialog.showOpenDialog(win ?? undefined, {
    title: 'Open a deck',
    properties: ['openFile'],
    filters: [
      { name: 'Decks', extensions: ['json', 'md', 'markdown', 'ts', 'js', 'mjs', 'tsx'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (!result.canceled && result.filePaths[0]) await openDeck(result.filePaths[0]);
}

function buildMenu() {
  const recent = readRecent();
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Deck…', accelerator: 'CmdOrCtrl+O', click: () => void chooseDeck() },
        {
          label: 'Open Recent',
          submenu: recent.length
            ? recent.map((item) => ({ label: `${basename(dirname(item))}/${basename(item)}`, toolTip: item, click: () => void openDeck(item) }))
            : [{ label: 'No recent decks', enabled: false }],
        },
        { label: 'Open the Guide', click: () => void openDeck(GUIDE) },
        { type: 'separator' },
        { label: 'Reload Deck', accelerator: 'CmdOrCtrl+Shift+R', click: () => win?.webContents.reload() },
        { label: 'Reveal Deck Folder', enabled: Boolean(current), click: () => { if (current) shell.showItemInFolder(current); } },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal(DOCS) },
        { label: 'Source on GitHub', click: () => shell.openExternal(REPOSITORY) },
        { label: 'Report an Issue', click: () => shell.openExternal(`${REPOSITORY}/issues`) },
        { type: 'separator' },
        { label: `Preview: ${preview ? preview.url : 'not running'}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** The camera, the microphone and the screen: granted to the deck's page, through the system's prompts where there are any. */
function allowMedia() {
  const defaultSession = session.defaultSession;
  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'media') {
      const wanted = details.mediaTypes ?? ['audio', 'video'];
      void (async () => {
        let granted = true;
        if (process.platform === 'darwin') {
          if (wanted.includes('audio')) granted = (await systemPreferences.askForMediaAccess('microphone')) && granted;
          if (wanted.includes('video')) granted = (await systemPreferences.askForMediaAccess('camera')) && granted;
        }
        callback(granted);
      })();
      return;
    }
    callback(['display-capture', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission));
  });
  // Filming the screen: the system's own picker where there is one (macOS 15 and later),
  // else the screen the window is on, whole, which is what a talk that leaves the deck needs.
  defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
      const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0];
      if (!source) throw new Error('No screen to capture');
      callback({ video: source, audio: 'loopback' in request ? undefined : undefined });
    } catch (error) {
      console.error('Screen capture:', error);
      callback({});
    }
  }, { useSystemPicker: true });
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const args = ownArguments(commandLine.slice(1)).filter((arg) => !arg.startsWith('-'));
    const deck = args[args.length - 1];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    if (deck) void openDeck(deck);
  });
  let pendingFile = null;
  app.on('open-file', (event, path) => {
    event.preventDefault();
    if (app.isReady()) void openDeck(path);
    else pendingFile = path;
  });
  app.whenReady().then(async () => {
    allowMedia();
    buildMenu();
    const deck = pendingFile ?? options.positional[0] ?? (readRecent()[0] ?? GUIDE);
    await openDeck(deck);
    app.on('activate', () => {
      if (!win && current) void openDeck(current);
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => {
    if (preview) void preview.server.close().catch(() => undefined);
  });
}
