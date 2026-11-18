#!/usr/bin/env node
/**
 * zoomdown command line: preview a deck while editing, or build a
 * static HTML bundle (optionally a single self-contained file).
 *
 *   zoomdown serve <deck> [--port N] [--host] [--no-open] [--editor NAME] [--watch PATH]...   (port 8000 or the next free one)
 *   zoomdown build <deck> -o <folder> [--one-file] [--show-outline] [--without-notes]
 *   zoomdown jump <file> <line>        show, in the running preview, the stop of a source line
 *
 * `<deck>` is a Markdown file (its settings in its front matter), a PDF, or a JS/TS module
 * exporting a deck definition (optionally `--scene Name` for a named export).
 */
import { promises as fs } from 'node:fs';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, relative, basename, extname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exec } from 'node:child_process';
import { tmpdir } from 'node:os';
import { allowedHosts, lanAddresses, padRelay } from './relay.mjs';
import { EDITOR_PRESETS, editorSync, previewsFor, requestJump } from './sync.mjs';
import { FOLDER as RECORDINGS, isRecordingFile, recordingStore, writeIndex } from './recordings.mjs';
import { renderStore } from './render.mjs';
import { exportStore, exportWriting } from './export.mjs';
import { extractBundle, isJournal } from './bundle.mjs';
import { resolveFromPackage } from './resolve.mjs';
import { resolveSettings } from '../src/markup/frontmatter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const require = createRequire(import.meta.url);
/** `zoomdown` and `manim-web` resolve against this package from a deck anywhere on disk. */
const resolveDeps = resolveFromPackage(packageRoot);

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error(`usage:
  zoomdown serve <deck> [--port N] [--host] [--no-open] [--editor NAME] [--scene Name] [--watch PATH]...
      --host also listens on the network, so a tablet can pair with the player
      --editor opens the source of a stop from the player (inverse search): a name such as
               emacs, sublime, code, vim or jetbrains, or a command with {file} and {line}
  zoomdown build <deck> -o <folder> [--one-file] [--show-outline] [--without-notes] [--scene Name]
      --without-notes leaves the presenter's ::: notes out of the export, for a deck handed to the audience
  zoomdown jump <file> <line>          move the running preview to the stop that shows the line`);
  process.exit(message ? 2 : 0);
}

export function parseArgs(argv) {
  const options = { watch: [], open: true, oneFile: false, showOutline: false, withoutNotes: false, port: null, host: false, output: null, scene: null, editor: process.env.ZOOMDOWN_EDITOR || null, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--host') options.host = true;
    else if (arg === '--editor') options.editor = argv[++i] ?? usage('--editor needs an editor name or command');
    else if (arg === '--watch') options.watch.push(resolve(argv[++i]));
    else if (arg === '-o' || arg === '--output') options.output = resolve(argv[++i]);
    else if (arg === '--one-file') options.oneFile = true;
    else if (arg === '--show-outline') options.showOutline = true;
    else if (arg === '--without-notes') options.withoutNotes = true;
    else if (arg === '--scene') options.scene = argv[++i];
    else if (arg === '-h' || arg === '--help') usage();
    else if (arg.startsWith('-')) usage(`unknown option ${arg}`);
    else options.positional.push(arg);
  }
  return options;
}

const optionalStubs = Object.fromEntries(
  ['pptxgenjs', '@myriaddreamin/typst.ts', '@myriaddreamin/typst-ts-web-compiler', '@myriaddreamin/typst-ts-renderer'].map(
    (name) => [name, resolve(packageRoot, 'src/stubs/empty.ts')],
  ),
);

/** Replace the engine's lazily loaded chunks for unused features (video/PDF export, loaders, passes, Typst) with the empty stub. */
const UNUSED_ENGINE_CHUNKS = /(?:^|[\\/])(?:(?:mp4|webm)-muxer|jspdf\.es\.min|lottie|html2canvas|GLTFLoader|OBJLoader|MTLLoader|BokehPass|UnrealBloomPass|FontLoader|TextGeometry|wasm-pack-shim)-[\w-]+\.js$/;
const dropEngineMuxers = {
  name: 'zoomdown-drop-unused-engine-chunks',
  enforce: 'pre',
  resolveId(id, importer) {
    if (UNUSED_ENGINE_CHUNKS.test(id) && importer && /manim-web/.test(importer)) return optionalStubs.pptxgenjs;
    return null;
  },
};

/**
 * The deck to use for a path: the file itself. A deck's settings are the front matter of its
 * Markdown, so a Markdown file is always the whole deck, whichever way it is opened. A JSON
 * file is no deck: its settings belong at the top of the Markdown.
 */
export function resolveDeckPath(path) {
  const deckPath = resolve(path);
  if (extname(deckPath).toLowerCase() === '.json') {
    throw new Error(`${path}: a deck is its Markdown file now; move the settings of this JSON file into the front matter at the top of the Markdown (between --- lines) and open the Markdown`);
  }
  return deckPath;
}

/** How front matter reaches files on disk: their text, and paths resolved against a file. */
const DISK = {
  read: (location) => fs.readFile(location, 'utf8'),
  join: (location, path) => resolve(dirname(location), path),
};

/**
 * The settings of a Markdown deck on disk: its front matter over the files it extends, paths
 * absolute; the Markdown with its front matter left blank; the files extended.
 */
export async function deckSettings(deckPath) {
  return resolveSettings(await fs.readFile(deckPath, 'utf8'), deckPath, DISK);
}

/**
 * The Markdown without its `::: notes` blocks (the presenter's notes, for the slide or a step),
 * each left as blank lines so the other lines keep their numbers; fenced code is left alone.
 * Exports made with --without-notes carry no notes at all, so a deck handed out keeps them private.
 */
export function stripNotes(text) {
  const lines = text.split(/\r?\n/);
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const code = /^\s*(`{3,}|~{3,})/.exec(lines[index]);
    if (code) {
      if (fence === null) fence = code[1];
      else if (code[1][0] === fence[0] && code[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null || !/^\s*:::\s*notes(?:\s+\{.*\})?\s*$/.test(lines[index])) continue;
    let depth = 1;
    let end = index + 1;
    for (; end < lines.length; end += 1) {
      const inner = /^\s*:::\s*(.*?)\s*$/.exec(lines[end]);
      if (!inner) continue;
      depth += inner[1] ? 1 : -1;
      if (depth === 0) break;
    }
    for (let blank = index; blank <= Math.min(end, lines.length - 1); blank += 1) lines[blank] = '';
    index = end;
  }
  return lines.join('\n');
}

/** The kinds of library folders a deck has, with the configuration key and the standard folder name of each. */
export const LIBRARY_KINDS = [
  { key: 'paths', folder: null, modules: false },
  { key: 'artworks', folder: 'artworks', modules: true },
  { key: 'fonts', folder: 'fonts', modules: false },
  { key: 'effects', folder: 'effects', modules: true },
  { key: 'charts', folder: 'charts', modules: true },
  { key: 'languages', folder: 'languages', modules: false },
  { key: 'codeThemes', folder: 'code-themes', modules: false },
  { key: 'themes', folder: 'themes', modules: false },
  { key: 'slides', folder: 'slides', modules: true },
  { key: 'directives', folder: 'directives', modules: true },
  { key: 'snippets', folder: 'snippets', modules: false },
  { key: 'transitions', folder: 'transitions', modules: true },
];

/**
 * The folders a deck names besides its own: the `paths` searched for imports, images, videos
 * and pages, and the library folders (artworks, fonts, effects, charts, languages, code themes,
 * themes, slide classes) its front matter names, or the files it extends do, or standing next to
 * the Markdown under their standard names; existing ones only. `extended` lists the folders of
 * the files it extends, which are served and watched as well.
 */
export async function deckFolders(deckPath) {
  const markupDir = dirname(deckPath);
  const { settings, extended } = await deckSettings(deckPath);
  const result = { all: [], extended: [...new Set(extended.map((file) => dirname(file)))] };
  for (const { key, folder } of LIBRARY_KINDS) {
    const folders = (settings[key] ?? []).filter((candidate) => existsSync(candidate));
    const standard = folder ? join(markupDir, folder) : null;
    if (standard && existsSync(standard) && !folders.includes(standard)) folders.push(standard);
    result[key] = folders;
    result.all.push(...folders);
  }
  return result;
}

/** The kind of deck a file holds, by its extension; null for a file the command cannot serve. */
export function deckKind(deckPath) {
  const ext = extname(deckPath).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.pdf') return 'pdf';
  if (['.ts', '.js', '.mjs', '.tsx'].includes(ext)) return 'module';
  return null;
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(command, (error) => {
    if (error) console.log(`Open ${url} in your browser.`);
  });
}

/**
 * Start the preview server for a deck and resolve with it, its URL and the deck it serves;
 * errors are thrown, not printed. `options` are those of `parseArgs`, plus `cacheDir` for
 * Vite's dependency cache when the package folder is not writable (an installed app).
 */
export async function startPreview(options) {
  if (!options.positional[0]) throw new Error('serve needs a deck path');
  const deckPath = resolveDeckPath(options.positional[0]);
  if (!existsSync(deckPath)) throw new Error(`deck not found: ${deckPath}`);
  const kind = deckKind(deckPath);
  if (!kind) throw new Error(`unsupported deck file ${deckPath}`);
  const deckDir = dirname(deckPath);
  // The deck's search and artwork folders are served and watched like its own folder.
  const folders = kind === 'markdown' ? await deckFolders(deckPath) : { all: [], extended: [] };
  const watchRoots = [...new Set([deckDir, ...options.watch, ...folders.all, ...folders.extended])];
  const reloadPlugin = {
    name: 'zoomdown-reload',
    configureServer(server) {
      for (const root of watchRoots) server.watcher.add(root);
      const onChange = (file) => {
        const inside = watchRoots.some((root) => file === root || file.startsWith(root + sep));
        // Recordings are written by the player itself; a reload would interrupt the talk being saved,
        // as it would an export the player is writing into a folder that may lie inside the deck's.
        if (!inside || /node_modules|\.git\b|\bbuild\b|\bdist\b/.test(file) || isRecordingFile(file) || exportWriting()) return;
        console.log(`[${new Date().toLocaleTimeString()}] ${relative(deckDir, file) || file} changed; reloading`);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: packageRoot,
    ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
    resolve: { alias: optionalStubs },
    optimizeDeps: { entries: ['index.html'] },
    plugins: [resolveDeps, dropEngineMuxers, reloadPlugin, padRelay(), editorSync({ editor: options.editor, roots: watchRoots, deck: deckPath }), recordingStore({ roots: watchRoots }), renderStore({ roots: watchRoots, openPage: options.openRenderPage ?? null }), exportStore({ roots: watchRoots, build: buildDeck })],
    // Bind the IPv4 loopback explicitly: "localhost" may resolve to ::1 only, which would leave
    // the printed 127.0.0.1 address refusing connections. Without --port, a busy 8000 falls
    // through to the next free port instead of failing, so a second preview can always start.
    server: {
      host: options.host ? '0.0.0.0' : '127.0.0.1',
      // A tablet reaches the server by the computer's name as well as by its address.
      allowedHosts: allowedHosts(),
      port: options.port ?? 8000,
      strictPort: options.strictPort ?? (options.port !== null && options.port !== 0),
      fs: { allow: [packageRoot, ...watchRoots] },
    },
    logLevel: 'warn',
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = address && typeof address === 'object' ? address.port : options.port ?? 8000;
  const deckParam = `/@fs${deckPath.split(sep).join('/')}`;
  const query = new URLSearchParams({ deck: deckParam });
  if (options.scene) query.set('scene', options.scene);
  const url = `http://127.0.0.1:${port}/?${query.toString()}`;
  return { server, url, port, deckPath, kind, watchRoots };
}

async function serve(options) {
  let preview;
  try {
    preview = await startPreview(options);
  } catch (error) {
    usage(error.message);
  }
  const { server, url, port, kind, watchRoots } = preview;
  console.log(`ZoomDown preview (${kind}) at ${url}`);
  if (options.host) {
    const lan = lanAddresses();
    if (lan.length) console.log(`On the network: ${lan.map((address) => `http://${address}:${port}/`).join(', ')} (pair a tablet from the player's settings)`);
    else console.log('No network address found; a tablet cannot reach this preview');
  }
  if (options.port !== null && options.port !== 0 && port !== options.port) console.log(`(port ${options.port} was busy)`);
  if (options.editor) console.log(`Inverse search: E or Alt+click in the player opens the source with "${options.editor}"`);
  else console.log('Inverse search is off (pass --editor emacs|sublime|code|vim|jetbrains or a command with {file} and {line})');
  console.log(`Forward search: zoomdown jump <file> <line> moves this preview to the stop of a line`);
  console.log(`Watching ${watchRoots.map((root) => relative(process.cwd(), root) || '.').join(', ')} — press Ctrl+C to stop`);
  const stop = (reason) => {
    if (reason) console.log(reason);
    server.close().finally(() => process.exit(0));
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop());
  // Editors stop a preview by ending the process that started it; when only that parent dies
  // (a shell wrapper, a build panel), the server would linger and keep the port. Follow it out.
  const parent = process.ppid;
  if (parent > 1) {
    setInterval(() => {
      if (process.ppid !== parent) stop('The process that started the preview has exited; stopping the server');
    }, 1000).unref();
  }
  if (options.open) openBrowser(url);
}

/**
 * The files of a deck folder that may travel with an export, by their paths inside the folder. Links
 * are followed, to folders too (a deck may link a folder it shares, such as a course's animations);
 * a folder reached twice is walked once, and a dangling link is left behind.
 */
export async function collectAssets(deckDir) {
  const files = [];
  const walked = new Set();
  async function walk(dir) {
    const real = await fs.realpath(dir);
    if (walked.has(real)) return;
    walked.add(real);
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'build', 'dist'].includes(entry.name) || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      const target = entry.isSymbolicLink() ? await fs.stat(path).catch(() => null) : entry;
      if (target?.isDirectory()) await walk(path);
      else if (target?.isFile()) files.push(path);
    }
  }
  await walk(deckDir);
  return files;
}

/**
 * The files a web page of the deck loads by a relative path: those its `src` and `href` attributes
 * name, and the `./…` or `../…` paths written in its scripts (a page may try several places for its
 * library). An iframe page needs them in an export, although the export otherwise leaves the deck's
 * own scripts and `dist` folders behind. Only existing files inside `root` count.
 */
export async function pageReferences(page, root) {
  const html = await fs.readFile(page, 'utf8');
  const found = new Set();
  const patterns = [/\b(?:src|href)\s*=\s*["']([^"'#?]+)/gi, /["'`](\.{1,2}\/[^"'`#?\s]+)/g];
  for (const pattern of patterns) {
    for (const [, ref] of html.matchAll(pattern)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(ref)) continue;
      let path;
      try { path = decodeURI(ref); } catch { path = ref; }
      const file = resolve(dirname(page), path);
      const inside = relative(root, file);
      if (!inside || inside.startsWith('..')) continue;
      if ((await fs.stat(file).catch(() => null))?.isFile()) found.add(file);
    }
  }
  return [...found];
}

const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.apng': 'image/apng', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime', '.html': 'text/html', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.json': 'application/json', '.pdf': 'application/pdf', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.txt': 'text/plain' };

/** `zoomdown build`: the arguments checked as the command line reports them, then the build. */
async function build(options) {
  const deckPath = resolveDeckPath(options.positional[0] ?? usage('build needs a deck path'));
  if (!existsSync(deckPath)) usage(`deck not found: ${deckPath}`);
  if (!options.output) usage('build needs -o <folder>');
  if (!deckKind(deckPath)) usage(`unsupported deck file ${deckPath}`);
  const { target } = await buildDeck({ ...options, positional: [deckPath] });
  console.log(`Wrote ${target}`);
}

/**
 * Build a deck into a static folder (`index.html` with its files) or, with `oneFile`, into one
 * self-contained `offline.html` in `output`. `options` are those of `parseArgs`: the deck is
 * `positional[0]`; `showOutline`, `withoutNotes` and `scene` as on the command line. Errors are
 * thrown, not printed, so that the player's export (bin/export.mjs) reports them; resolves with
 * the page written.
 */
export async function buildDeck(options) {
  if (!options.positional?.[0]) throw new Error('build needs a deck path');
  const deckPath = resolveDeckPath(options.positional[0]);
  if (!existsSync(deckPath)) throw new Error(`deck not found: ${deckPath}`);
  if (!options.output) throw new Error('build needs an output folder');
  const kind = deckKind(deckPath);
  if (!kind) throw new Error(`unsupported deck file ${deckPath}`);
  const deckDir = dirname(deckPath);
  const outDir = options.output;
  await fs.mkdir(outDir, { recursive: true });
  const stageDir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'zoomdown-')));
  try {
    return await buildInto(options, { deckPath, kind, deckDir, outDir, stageDir });
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
}

async function buildInto(options, { deckPath, kind, deckDir, outDir, stageDir }) {

  let entrySource;
  const sourceIndex = resolve(packageRoot, 'src/index.ts').split(sep).join('/');
  if (kind === 'module') {
    const modulePath = deckPath.split(sep).join('/');
    entrySource = `import { runDeck } from ${JSON.stringify(sourceIndex)};
import * as module from ${JSON.stringify(modulePath)};
const definition = ${options.scene ? `module[${JSON.stringify(options.scene)}]` : 'module.default'};
if (!definition) throw new Error('Deck module has no export ${options.scene ?? 'default'}');
runDeck({ ...definition, showOutline: definition.showOutline || ${options.showOutline} });`;
  } else if (kind === 'pdf') {
    // The document travels with the export: as a file next to the page, or inside it as a data URL.
    let url;
    if (options.oneFile) {
      url = `data:application/pdf;base64,${(await fs.readFile(deckPath)).toString('base64')}`;
    } else {
      await fs.mkdir(join(outDir, 'deck'), { recursive: true });
      await fs.copyFile(deckPath, join(outDir, 'deck', basename(deckPath)));
      url = `deck/${basename(deckPath)}`;
    }
    entrySource = `import { runDeck, pdfDeck } from ${JSON.stringify(sourceIndex)};
const url = ${JSON.stringify(url)};
runDeck(await pdfDeck({
  url: url.startsWith('data:') ? url : new URL(url, location.href).href,
  title: ${JSON.stringify(basename(deckPath, extname(deckPath)))},
  showOutline: ${options.showOutline},
}));`;
  } else {
    // The deck's settings, its front matter over the files it extends, reach the page as they are;
    // the Markdown travels with its front matter left blank, so its lines keep their numbers.
    const { settings: config, body } = await deckSettings(deckPath);
    const markupPath = deckPath;
    const markupDir = dirname(markupPath);
    const markdown = options.withoutNotes ? stripNotes(body) : body;
    const assets = {};
    // Markdown files next to the deck are embedded as text, so [[import: path]] works without a server.
    const files = {};
    const toKey = (path) => path.split(sep).join('/');
    // The search and artwork folders travel with the export as deck/paths/<i>/ and deck/artworks/<i>/,
    // and the player is told those folders relative to the Markdown, the way it names its own files.
    // Every library folder of the deck travels as deck/<kind>/<i>/, named to the player relative to the
    // Markdown; the modules among them (artworks, effects, charts, slide classes) are bundled by name.
    const folders = await deckFolders(deckPath);
    const sources = [{ root: deckDir, key: (file) => toKey(relative(markupDir, file)), copyTo: (file) => join(outDir, 'deck', relative(deckDir, file)) }];
    const folderKeys = {};
    const moduleImports = {};
    for (const { key: kind, modules } of LIBRARY_KINDS) {
      folderKeys[kind] = [];
      moduleImports[kind] = [];
      for (const [i, folder] of (folders[kind] ?? []).entries()) {
        const placed = join(deckDir, kind, String(i));
        sources.push({ root: folder, key: (file) => toKey(relative(markupDir, join(placed, relative(folder, file)))), copyTo: (file) => join(outDir, 'deck', kind, String(i), relative(folder, file)) });
        folderKeys[kind].push(toKey(relative(markupDir, placed)) + '/');
        if (!modules) continue;
        for (const file of await collectAssets(folder)) {
          if (!['.js', '.mjs', '.ts'].includes(extname(file).toLowerCase()) || dirname(file) !== folder) continue;
          moduleImports[kind].push({ name: basename(file, extname(file)), variable: `${kind}_${i}_${moduleImports[kind].length}`, path: toKey(file) });
        }
      }
    }
    const unpackedRecordings = new Set();
    const copied = new Set();
    for (const { root, key, copyTo } of sources) {
      const pages = [];
      for (const file of await collectAssets(root)) {
        if (file === markupPath) continue;
        const ext = extname(file).toLowerCase();
        if (['.md', '.markdown'].includes(ext)) {
          const text = await fs.readFile(file, 'utf8');
          files[key(file)] = options.withoutNotes ? stripNotes(text) : text;
          continue;
        }
        if (options.oneFile) {
          const mime = MIME[ext];
          if (mime) assets[key(file)] = `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;
        } else {
          const recording = relative(root, file).split(sep).includes(RECORDINGS);
          // Modules are bundled; an editor's project files stay behind. Other JSON (data, profiles, code themes) travels.
          if (!recording && (['.ts', '.js', '.mjs'].includes(ext) || /^(tsconfig|package|jsconfig)[^/]*\.json$/.test(basename(file)))) continue;
          const target = copyTo(file);
          await fs.mkdir(dirname(target), { recursive: true });
          if (recording && (isJournal(file) || basename(file) === 'index.json')) continue;
          if (recording && ext === '.zip') {
            // A talk's bundle is unpacked for the viewers' browsers, which stream plain files best; the index is rebuilt below.
            try {
              await extractBundle(file, dirname(target));
              if (basename(dirname(file)) === RECORDINGS) unpackedRecordings.add(dirname(target));
            } catch {
              await fs.copyFile(file, target);
            }
            continue;
          }
          if (recording && basename(dirname(file)) === RECORDINGS) unpackedRecordings.add(dirname(target));
          await fs.copyFile(file, target);
          copied.add(target);
          if (['.html', '.htm'].includes(ext)) pages.push(file);
        }
      }
      // The scripts and styles the deck's web pages load travel with them, even from a dist folder.
      for (const page of pages) {
        for (const file of await pageReferences(page, root)) {
          const target = copyTo(file);
          if (copied.has(target)) continue;
          await fs.mkdir(dirname(target), { recursive: true });
          await fs.copyFile(file, target);
          copied.add(target);
        }
      }
    }
    for (const folder of unpackedRecordings) await writeIndex(folder);
    const classesModule = config.classes;
    const moduleMap = (kind) => `{ ${moduleImports[kind].map(({ name, variable }) => `${JSON.stringify(name)}: ${variable}`).join(', ')} }`;
    const importsLine = [
      classesModule ? `import * as slides from ${JSON.stringify(resolve(deckDir, classesModule).split(sep).join('/'))};` : 'const slides = undefined;',
      ...LIBRARY_KINDS.filter(({ modules }) => modules).flatMap(({ key }) => moduleImports[key].map(({ variable, path }) => `import * as ${variable} from ${JSON.stringify(path)};`)),
    ].join('\n');
    const markupBase = options.oneFile ? '' : `deck/${relative(deckDir, markupPath).split(sep).join('/')}`;
    entrySource = `import { runDeck, loadMarkupDeck } from ${JSON.stringify(sourceIndex)};
${importsLine}
const config = ${JSON.stringify({ ...config, classes: undefined, ...Object.fromEntries(LIBRARY_KINDS.map(({ key }) => [key, undefined])) })};
const source = ${JSON.stringify(markdown)};
const assets = ${JSON.stringify(assets)};
const files = ${JSON.stringify(files)};
runDeck(await loadMarkupDeck({
  source,
  basePath: ${JSON.stringify(markupBase)} ? new URL(${JSON.stringify(markupBase)}, location.href).href : location.href,
  assets: Object.keys(assets).length ? assets : undefined,
  files: Object.keys(files).length ? files : undefined,
  title: config.title,
  root: config.root,
  layout: config.layout,
  presenter: config.presenter,
  background: config.background,
  viewport: config.viewport,
  macros: config.macros,
  styles: config.styles,
  showOutline: Boolean(config.showOutline) || ${options.showOutline},
  classes: slides,
  theme: config.theme,
  paths: ${JSON.stringify(folderKeys.paths)},
  artworks: ${JSON.stringify(folderKeys.artworks)},
  fonts: ${JSON.stringify(folderKeys.fonts)},
  effects: ${JSON.stringify(folderKeys.effects)},
  charts: ${JSON.stringify(folderKeys.charts)},
  languages: ${JSON.stringify(folderKeys.languages)},
  codeThemes: ${JSON.stringify(folderKeys.codeThemes)},
  themes: ${JSON.stringify(folderKeys.themes)},
  slides: ${JSON.stringify(folderKeys.slides)},
  directives: ${JSON.stringify(folderKeys.directives)},
  snippets: ${JSON.stringify(folderKeys.snippets)},
  transitions: ${JSON.stringify(folderKeys.transitions)},
  artworkModules: ${moduleMap('artworks')},
  effectModules: ${moduleMap('effects')},
  chartModules: ${moduleMap('charts')},
  slideModules: ${moduleMap('slides')},
  directiveModules: ${moduleMap('directives')},
  transitionModules: ${moduleMap('transitions')},
}));`;
  }
  const entryFile = join(stageDir, 'entry.ts');
  await fs.writeFile(entryFile, entrySource);
  const htmlFile = join(stageDir, 'index.html');
  await fs.writeFile(htmlFile, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZoomDown</title></head>
<body><script type="module" src="./entry.ts"></script></body></html>
`);
  const buildOut = options.oneFile ? join(stageDir, 'out') : outDir;
  const { build: viteBuild } = await import('vite');
  await viteBuild({
    configFile: false,
    root: stageDir,
    base: './',
    logLevel: 'warn',
    resolve: { alias: optionalStubs },
    plugins: [resolveDeps, dropEngineMuxers],
    // Slide names default to class names, which minification would otherwise mangle.
    esbuild: { keepNames: true },
    server: { fs: { allow: [packageRoot, deckDir] } },
    build: {
      outDir: buildOut,
      emptyOutDir: false,
      assetsInlineLimit: options.oneFile ? Number.MAX_SAFE_INTEGER : 4096,
      cssCodeSplit: false,
      // An export carries the whole engine and the formula renderer, in one chunk when it is one
      // file: Vite's advice to split chunks above 500 kB does not apply, so it is not printed.
      chunkSizeWarningLimit: Number.MAX_SAFE_INTEGER,
      // Dynamic imports stay separate chunks in the one-file export too: the HTML embeds each
      // as inert text and makes it a module when it is first imported, so the formula renderer
      // (11 MB) is compiled when a formula needs it rather than before the page can start.
      modulePreload: options.oneFile ? false : undefined,
      rollupOptions: {
        input: htmlFile,
      },
    },
  });
  if (options.oneFile) {
    const html = await fs.readFile(join(buildOut, 'index.html'), 'utf8');
    const inlined = await inlineHtml(html, buildOut);
    const target = join(outDir, 'offline.html');
    await fs.writeFile(target, inlined);
    return { target };
  }
  return { target: join(outDir, 'index.html') };
}

/**
 * The page's script and every chunk it may import, embedded as inert text, with a loader that
 * turns a chunk into a module (a blob URL) the first time it is needed: static imports between
 * chunks are rewritten to the blob URLs as the chunks are made, dynamic ones look theirs up when
 * they run. The browser thus parses the text at load but compiles each chunk only on import.
 */
const CHUNK_LOADER = `(() => {
  const texts = new Map();
  for (const el of document.querySelectorAll('script[type="text/plain"][data-zd-chunk]')) texts.set(el.dataset.zdChunk, el.textContent.replace(/<\\\\\\/script/g, '</script'));
  const urls = new Map();
  const chunk = (name) => {
    let url = urls.get(name);
    if (url) return url;
    let code = texts.get(name);
    if (code === undefined) throw new Error('No such chunk: ' + name);
    for (const dep of texts.keys()) {
      if (dep === name) continue;
      code = code.split('import("./' + dep + '")').join('import(self.__zdChunk("' + dep + '"))').split("import('./" + dep + "')").join('import(self.__zdChunk("' + dep + '"))');
    }
    for (const dep of texts.keys()) {
      if (dep === name || !code.includes('./' + dep)) continue;
      const depUrl = chunk(dep);
      code = code.split('"./' + dep + '"').join('"' + depUrl + '"').split("'./" + dep + "'").join("'" + depUrl + "'");
    }
    url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    urls.set(name, url);
    return url;
  };
  self.__zdChunk = chunk;
  const entry = document.querySelector('script[type="text/plain"][data-zd-entry]').dataset.zdChunk;
  import(chunk(entry));
})();`;

async function inlineHtml(html, outDir) {
  let result = html;
  const escape = (code) => code.replace(/<\/script/g, '<\\/script');
  for (const match of [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {
    const entry = match[1].replace(/^\.?\//, '');
    const folder = dirname(join(outDir, entry));
    const names = (await fs.readdir(folder)).filter((name) => name.endsWith('.js'));
    const scripts = [];
    for (const name of names) {
      const code = await fs.readFile(join(folder, name), 'utf8');
      const isEntry = name === basename(entry);
      scripts.push(`<script type="text/plain" data-zd-chunk="${name}"${isEntry ? ' data-zd-entry' : ''}>${escape(code)}</script>`);
    }
    scripts.push(`<script type="module">${CHUNK_LOADER}</script>`);
    // A replacer function keeps `$&`-style sequences inside the code literal.
    result = result.replace(match[0], () => scripts.join('\n'));
  }
  for (const match of [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]) {
    const css = await fs.readFile(join(outDir, match[1]), 'utf8');
    result = result.replace(match[0], () => `<style>${css}</style>`);
  }
  result = result.replace(/<link rel="modulepreload"[^>]*>/g, '');
  return result;
}

/** Forward search: tell the preview serving a file to show the stop of a line. */
async function jump(options) {
  let [file, line] = options.positional;
  if (file && line === undefined) {
    // Also `file:line`, as editors often print it.
    const match = /^(.*):(\d+)$/.exec(file);
    if (match) [, file, line] = match;
  }
  line = Number(line);
  if (!file || !Number.isInteger(line) || line < 1) usage('jump needs a file and a line number');
  file = resolve(file);
  const targets = previewsFor(file);
  if (!targets.length) {
    console.error(`No preview is running; start one with: zoomdown serve ${JSON.stringify(file)}`);
    process.exit(1);
  }
  let sent = 0;
  for (const target of targets) {
    try {
      await requestJump(target, file, line);
      console.log(`Line ${line} of ${basename(file)} sent to the preview on port ${target.port}`);
      sent += 1;
    } catch (error) {
      console.error(`Port ${target.port}: ${error.message}`);
    }
  }
  if (!sent) process.exit(1);
}

export { EDITOR_PRESETS };

// The command line runs only when this file is the program (also through the `zoomdown` link
// npm makes); imported by the desktop app, it only lends its functions.
const invoked = process.argv[1] ? (() => { try { return realpathSync(process.argv[1]); } catch { return process.argv[1]; } })() : '';
if (invoked && pathToFileURL(invoked).href === import.meta.url) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined || command === '-h' || command === '--help' || command === 'help') usage();
  const options = parseArgs(rest);
  if (command === 'serve') serve(options).catch((error) => { console.error(error); process.exit(1); });
  else if (command === 'build') build(options).catch((error) => { console.error(error); process.exit(1); });
  else if (command === 'jump') jump(options).catch((error) => { console.error(error); process.exit(1); });
  else if (command === 'editors') console.log(Object.keys(EDITOR_PRESETS).join('\n'));
  else usage(`unknown command ${command}`);
}
