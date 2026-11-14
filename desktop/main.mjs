/**
 * The desktop app: the same player and preview server as `zoomdeck serve`, in a window of its
 * own. It starts the server in this process (so pairing, recordings, the editor sync and the
 * command's flags all work as in the browser), opens the deck in a Chromium window, and adds
 * what a desktop program is expected to have: menus, Open and Open Recent, the system's
 * permission prompts for the camera and the microphone, and a screen picker for filming.
 * Started with a deck (from the command line, or from the system by double-click or drop) it
 * opens that deck; started bare it asks for one in the folder used last, and the first time it
 * offers to copy the guide deck to a folder of the user's, out of the app.
 *
 *   Zoomdeck [deck.json | slides.md | paper.pdf] [--local] [--port N] [--editor NAME] [--watch PATH] [--scene Name]
 */
import { app, BrowserWindow, Menu, dialog, shell, session, desktopCapturer, screen, systemPreferences } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { startPreview, parseArgs, resolveDeckPath, deckKind } from '../bin/zoomdeck.mjs';
import { copyGuide, GUIDE_FOLDER } from './guide.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
/** The guide deck inside the app: the source of the copies, never opened in place. */
const GUIDE_SOURCE = join(packageRoot, 'examples', 'guide');
const DOCS = 'https://puppis.github.io/zoomdeck/';
const REPOSITORY = 'https://github.com/puppis/zoomdeck';
const FLAGS = new Set(['--host', '--local', '--port', '--editor', '--watch', '--scene']);
const WITH_VALUE = new Set(['--port', '--editor', '--watch', '--scene']);
/**
 * The port the app prefers, so that a tablet trusted once finds the deck again at the same
 * address; when it is busy the next free port is taken. Away from the 8000 of a preview started
 * from a terminal, so the two never collide.
 */
const DESKTOP_PORT = 8765;

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
// The app listens on the network, so a tablet can pair with it without a flag that a Finder-opened app cannot pass; --local keeps it to this computer.
const localOnly = argv.includes('--local');
const options = parseArgs(argv.filter((arg) => arg !== '--local'));
options.host = options.host || !localOnly;
const smokeShot = process.env.ZOOMDECK_SMOKE || null;

let win = null;
let preview = null;
let current = null;


/** The decks opened lately, and the folder of the last one, where the next Open dialog starts. */
const recentFile = () => join(app.getPath('userData'), 'recent.json');
function readStore() {
  try {
    const saved = JSON.parse(readFileSync(recentFile(), 'utf8'));
    // Earlier versions kept the list alone.
    const decks = Array.isArray(saved) ? saved : Array.isArray(saved?.decks) ? saved.decks : [];
    const folder = !Array.isArray(saved) && typeof saved?.folder === 'string' ? saved.folder : null;
    return {
      // Decks that are gone drop out; so does the guide inside the app, which earlier versions opened in place.
      decks: decks.filter((item) => typeof item === 'string' && existsSync(item) && !(app.isPackaged && item.startsWith(packageRoot))),
      folder: folder && existsSync(folder) ? folder : null,
    };
  } catch {
    return { decks: [], folder: null };
  }
}
function readRecent() {
  return readStore().decks;
}
function remember(deckPath) {
  const decks = [deckPath, ...readRecent().filter((item) => item !== deckPath)].slice(0, 10);
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(recentFile(), JSON.stringify({ decks, folder: dirname(deckPath) }));
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
    dialog.showErrorBox('Zoomdeck', `Not a deck: ${deckPath}\nOpen a deck.json, a Markdown file, a PDF or a slide module.`);
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
      // The app's own port when free, the next free one otherwise; --port insists on one.
      port: options.port ?? DESKTOP_PORT,
      strictPort: options.port !== null,
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

/** Ask for a deck, starting in `folder` (the last one used, by default); whether one was opened. */
async function chooseDeck(folder = readStore().folder) {
  const result = await dialog.showOpenDialog(win ?? undefined, {
    title: 'Open a deck',
    ...(folder ? { defaultPath: folder } : {}),
    properties: ['openFile'],
    filters: [
      { name: 'Decks', extensions: ['json', 'md', 'markdown', 'pdf', 'ts', 'js', 'mjs', 'tsx'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return false;
  await openDeck(result.filePaths[0]);
  return Boolean(current);
}

/**
 * Copy the guide deck, with its examples, into a folder the user chooses, and open the copy;
 * whether one was opened. A copy already there is opened as it is, or its deck files written
 * afresh (talks recorded in it stay).
 */
async function offerGuide() {
  const chosen = await dialog.showOpenDialog(win ?? undefined, {
    title: 'Choose a folder for the guide deck',
    message: `The guide and its examples are copied to a "${GUIDE_FOLDER}" folder inside the one you choose, where you can read and edit them and record talks.`,
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Copy Here',
  });
  if (chosen.canceled || !chosen.filePaths[0]) return false;
  let deck;
  try {
    deck = copyGuide(GUIDE_SOURCE, chosen.filePaths[0]);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      dialog.showErrorBox('Zoomdeck', `The guide could not be copied:\n${error.message}`);
      return false;
    }
    const { response } = await dialog.showMessageBox(win ?? undefined, {
      type: 'question',
      message: 'A copy of the guide is there already',
      detail: `${error.target}\n\nOpen it as it is, or write the deck's files afresh over it? Talks recorded in it stay either way.`,
      buttons: ['Open It', 'Write Afresh', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 2) return false;
    deck = response === 1 ? copyGuide(GUIDE_SOURCE, chosen.filePaths[0], { replace: true }) : join(error.target, 'deck.json');
  }
  await openDeck(deck);
  return Boolean(current);
}

/**
 * Started without a deck: ask for one, in the folder used last. The first time, with no deck
 * ever opened, offer the guide as a starting point instead. Giving up with no window open ends the app.
 */
async function start() {
  const store = readStore();
  if (!store.decks.length && !store.folder) {
    const { response } = await dialog.showMessageBox({
      type: 'none',
      message: 'Welcome to Zoomdeck',
      detail: 'Open a deck of yours (a deck.json, a Markdown file, a PDF or a slide module), or copy the guide deck with its examples to a folder of yours and start from there.',
      buttons: ['Open a Deck…', 'Copy the Guide…', 'Quit'],
      defaultId: 1,
      cancelId: 2,
    });
    if (response === 2) return app.quit();
    const opened = response === 0 ? await chooseDeck(app.getPath('documents')) : await offerGuide();
    if (!opened && !win) return start();
    return;
  }
  const opened = await chooseDeck(store.folder);
  if (!opened && !win) app.quit();
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
        { type: 'separator' },
        { label: 'Copy the Guide Deck…', click: () => void offerGuide() },
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
    const deck = pendingFile ?? options.positional[0];
    if (deck) await openDeck(deck);
    if (!current) await start();
    app.on('activate', () => {
      if (win) return;
      if (current) void openDeck(current);
      else void start();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => {
    if (preview) void preview.server.close().catch(() => undefined);
  });
}
