#!/usr/bin/env node
/**
 * zoomdeck command line: preview a deck while editing, or build a
 * static HTML bundle (optionally a single self-contained file).
 *
 *   zoomdeck serve <deck> [--port N] [--no-open] [--watch PATH]...
 *   zoomdeck build <deck> -o <folder> [--one-file] [--show-outline]
 *
 * `<deck>` is a `deck.json`, a Markdown file, or a JS/TS module exporting a
 * deck definition (optionally `--scene Name` for a named export).
 */
import { createServer, build as viteBuild } from 'vite';
import { promises as fs } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, relative, basename, extname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exec } from 'node:child_process';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const require = createRequire(import.meta.url);

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error(`usage:
  zoomdeck serve <deck> [--port N] [--no-open] [--scene Name] [--watch PATH]...
  zoomdeck build <deck> -o <folder> [--one-file] [--show-outline] [--scene Name]`);
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const options = { watch: [], open: true, oneFile: false, showOutline: false, port: 8000, output: null, scene: null, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--watch') options.watch.push(resolve(argv[++i]));
    else if (arg === '-o' || arg === '--output') options.output = resolve(argv[++i]);
    else if (arg === '--one-file') options.oneFile = true;
    else if (arg === '--show-outline') options.showOutline = true;
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
  name: 'zoomdeck-drop-unused-engine-chunks',
  enforce: 'pre',
  resolveId(id, importer) {
    if (UNUSED_ENGINE_CHUNKS.test(id) && importer && /manim-web/.test(importer)) return optionalStubs.pptxgenjs;
    return null;
  },
};

function deckKind(deckPath) {
  const ext = extname(deckPath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (['.ts', '.js', '.mjs', '.tsx'].includes(ext)) return 'module';
  usage(`unsupported deck file ${deckPath}`);
  return 'json';
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(command, (error) => {
    if (error) console.log(`Open ${url} in your browser.`);
  });
}

async function serve(options) {
  const deckPath = resolve(options.positional[0] ?? usage('serve needs a deck path'));
  if (!existsSync(deckPath)) usage(`deck not found: ${deckPath}`);
  const kind = deckKind(deckPath);
  const deckDir = dirname(deckPath);
  const watchRoots = [deckDir, ...options.watch];
  const reloadPlugin = {
    name: 'zoomdeck-reload',
    configureServer(server) {
      for (const root of watchRoots) server.watcher.add(root);
      const onChange = (file) => {
        const inside = watchRoots.some((root) => file === root || file.startsWith(root + sep));
        if (!inside || /node_modules|\.git\b|\bbuild\b|\bdist\b/.test(file)) return;
        console.log(`[${new Date().toLocaleTimeString()}] ${relative(deckDir, file) || file} changed; reloading`);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
  const server = await createServer({
    configFile: false,
    root: packageRoot,
    resolve: { alias: optionalStubs },
    optimizeDeps: { entries: ['index.html'] },
    plugins: [dropEngineMuxers, reloadPlugin],
    server: { port: options.port, strictPort: options.port !== 0, fs: { allow: [packageRoot, ...watchRoots] } },
    logLevel: 'warn',
  });
  await server.listen();
  const port = server.config.server.port;
  const deckParam = `/@fs${deckPath.split(sep).join('/')}`;
  const query = new URLSearchParams({ deck: deckParam });
  if (options.scene) query.set('scene', options.scene);
  const url = `http://127.0.0.1:${port}/?${query.toString()}`;
  console.log(`Zoomdeck preview (${kind}) at ${url}`);
  console.log(`Watching ${watchRoots.map((root) => relative(process.cwd(), root) || '.').join(', ')} — press Ctrl+C to stop`);
  if (options.open) openBrowser(url);
}

async function collectAssets(deckDir) {
  const files = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'build', 'dist'].includes(entry.name) || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  }
  await walk(deckDir);
  return files;
}

const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.apng': 'image/apng', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime', '.html': 'text/html' };

async function build(options) {
  const deckPath = resolve(options.positional[0] ?? usage('build needs a deck path'));
  if (!existsSync(deckPath)) usage(`deck not found: ${deckPath}`);
  if (!options.output) usage('build needs -o <folder>');
  const kind = deckKind(deckPath);
  const deckDir = dirname(deckPath);
  const outDir = options.output;
  await fs.mkdir(outDir, { recursive: true });
  const stageDir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'zoomdeck-')));

  let entrySource;
  const sourceIndex = resolve(packageRoot, 'src/index.ts').split(sep).join('/');
  if (kind === 'module') {
    const modulePath = deckPath.split(sep).join('/');
    entrySource = `import { runDeck } from ${JSON.stringify(sourceIndex)};
import * as module from ${JSON.stringify(modulePath)};
const definition = ${options.scene ? `module[${JSON.stringify(options.scene)}]` : 'module.default'};
if (!definition) throw new Error('Deck module has no export ${options.scene ?? 'default'}');
runDeck({ ...definition, showOutline: definition.showOutline || ${options.showOutline} });`;
  } else {
    const config = kind === 'json' ? JSON.parse(await fs.readFile(deckPath, 'utf8')) : { markup: basename(deckPath) };
    const markupPath = resolve(deckDir, config.markup);
    const markdown = await fs.readFile(markupPath, 'utf8');
    const assets = {};
    if (options.oneFile) {
      for (const file of await collectAssets(deckDir)) {
        const mime = MIME[extname(file).toLowerCase()];
        if (!mime) continue;
        const rel = relative(dirname(markupPath), file).split(sep).join('/');
        assets[rel] = `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;
      }
    } else {
      for (const file of await collectAssets(deckDir)) {
        const rel = relative(deckDir, file);
        if (['.json', '.ts', '.js', '.mjs', '.md', '.markdown'].includes(extname(file).toLowerCase())) continue;
        const target = join(outDir, 'deck', rel);
        await fs.mkdir(dirname(target), { recursive: true });
        await fs.copyFile(file, target);
      }
    }
    const importsLine = config.imports
      ? `import * as slides from ${JSON.stringify(resolve(deckDir, config.imports).split(sep).join('/'))};`
      : 'const slides = undefined;';
    const markupBase = options.oneFile ? '' : `deck/${relative(deckDir, markupPath).split(sep).join('/')}`;
    entrySource = `import { runDeck, markupDeck } from ${JSON.stringify(sourceIndex)};
${importsLine}
const config = ${JSON.stringify({ ...config, imports: undefined })};
const source = ${JSON.stringify(markdown)};
const assets = ${JSON.stringify(assets)};
runDeck(markupDeck({
  source,
  basePath: ${JSON.stringify(markupBase)} ? new URL(${JSON.stringify(markupBase)}, location.href).href : location.href,
  assets: Object.keys(assets).length ? assets : undefined,
  title: config.title ?? ${JSON.stringify(basename(deckDir))},
  root: config.root,
  layout: config.layout,
  presenter: config.presenter,
  background: config.background,
  viewport: config.viewport,
  macros: config.macros,
  styles: config.styles,
  showOutline: Boolean(config.showOutline) || ${options.showOutline},
  imports: slides,
}));`;
  }
  const entryFile = join(stageDir, 'entry.ts');
  await fs.writeFile(entryFile, entrySource);
  const htmlFile = join(stageDir, 'index.html');
  await fs.writeFile(htmlFile, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zoomdeck</title></head>
<body><script type="module" src="./entry.ts"></script></body></html>
`);
  const buildOut = options.oneFile ? join(stageDir, 'out') : outDir;
  await viteBuild({
    configFile: false,
    root: stageDir,
    base: './',
    logLevel: 'warn',
    resolve: { alias: optionalStubs },
    plugins: [dropEngineMuxers],
    // Slide names default to class names, which minification would otherwise mangle.
    esbuild: { keepNames: true },
    server: { fs: { allow: [packageRoot, deckDir] } },
    build: {
      outDir: buildOut,
      emptyOutDir: false,
      assetsInlineLimit: options.oneFile ? Number.MAX_SAFE_INTEGER : 4096,
      cssCodeSplit: false,
      rollupOptions: {
        input: htmlFile,
        output: options.oneFile ? { inlineDynamicImports: true } : {},
      },
    },
  });
  if (options.oneFile) {
    const html = await fs.readFile(join(buildOut, 'index.html'), 'utf8');
    const inlined = await inlineHtml(html, buildOut);
    const target = join(outDir, 'offline.html');
    await fs.writeFile(target, inlined);
    console.log(`Wrote ${target}`);
  } else {
    console.log(`Wrote ${join(outDir, 'index.html')}`);
  }
  await fs.rm(stageDir, { recursive: true, force: true });
}

async function inlineHtml(html, outDir) {
  let result = html;
  for (const match of [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {
    const code = await fs.readFile(join(outDir, match[1]), 'utf8');
    // A replacer function keeps `$&`-style sequences inside the code literal.
    const inline = `<script type="module">${code.replace(/<\/script/g, '<\\/script')}</script>`;
    result = result.replace(match[0], () => inline);
  }
  for (const match of [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]) {
    const css = await fs.readFile(join(outDir, match[1]), 'utf8');
    result = result.replace(match[0], () => `<style>${css}</style>`);
  }
  result = result.replace(/<link rel="modulepreload"[^>]*>/g, '');
  return result;
}

const [command, ...rest] = process.argv.slice(2);
const options = parseArgs(rest);
if (command === 'serve') serve(options).catch((error) => { console.error(error); process.exit(1); });
else if (command === 'build') build(options).catch((error) => { console.error(error); process.exit(1); });
else usage(command ? `unknown command ${command}` : undefined);
