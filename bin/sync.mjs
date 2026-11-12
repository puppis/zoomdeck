/**
 * Editor synchronization for the preview server, in both directions:
 *
 * - forward search, editor → browser: `zoomdeck jump <file> <line>` (or a request to
 *   `/__zoomdeck/sync/jump`) tells every player page served here to show the stop of that
 *   line. Running previews register themselves in a small directory under the OS temporary
 *   folder, so the command finds the server that serves a file without being told its port.
 * - inverse search, browser → editor: the player posts the source of its current stop to
 *   `/__zoomdeck/sync/edit`, and the server opens it with the editor named by `--editor`
 *   (a preset such as `emacs`, `sublime`, `code`, or a command template with `{file}` and
 *   `{line}`).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVENT = 'zoomdeck:jump';

/** Where running previews register: one JSON file per server, named after its port. */
export const REGISTRY_DIR = join(tmpdir(), 'zoomdeck-previews');

/** A path with forward slashes, as the player and the registry compare them. */
export function slashes(path) {
  return path.split(sep).join('/');
}

// ---------------------------------------------------------------------------
// Editor commands
// ---------------------------------------------------------------------------

const JETBRAINS = ['idea', 'webstorm', 'pycharm', 'phpstorm', 'goland', 'clion', 'rubymine', 'rider', 'rustrover', 'datagrip'];

/** Named editors: the command that opens `{file}` at `{line}`. */
export const EDITOR_PRESETS = {
  emacs: ['emacsclient', '--no-wait', '+{line}', '{file}'],
  emacsclient: ['emacsclient', '--no-wait', '+{line}', '{file}'],
  sublime: ['subl', '{file}:{line}'],
  subl: ['subl', '{file}:{line}'],
  code: ['code', '--goto', '{file}:{line}'],
  vscode: ['code', '--goto', '{file}:{line}'],
  codium: ['codium', '--goto', '{file}:{line}'],
  cursor: ['cursor', '--goto', '{file}:{line}'],
  vim: ['vim', '--servername', 'VIM', '--remote-silent', '+{line}', '{file}'],
  gvim: ['gvim', '--remote-silent', '+{line}', '{file}'],
  mvim: ['mvim', '--remote-silent', '+{line}', '{file}'],
  textmate: ['mate', '--line', '{line}', '{file}'],
  mate: ['mate', '--line', '{line}', '{file}'],
  zed: ['zed', '{file}:{line}'],
  jetbrains: [JETBRAINS, '--line', '{line}', '{file}'],
  ...Object.fromEntries(JETBRAINS.map((name) => [name, [name, '--line', '{line}', '{file}']])),
};

/** Split a command line into arguments: whitespace separates, single or double quotes group. */
export function splitCommand(text) {
  const args = [];
  let current = null;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && text[i + 1] === '"') current += text[++i];
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current ??= '';
    } else if (/\s/.test(char)) {
      if (current !== null) args.push(current);
      current = null;
    } else {
      current = (current ?? '') + char;
    }
  }
  if (quote) throw new Error(`Unbalanced quotes in editor command: ${text}`);
  if (current !== null) args.push(current);
  return args;
}

/** The first of `names` found on PATH, or null. */
export function findExecutable(names) {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const name of names) {
    if (isAbsolute(name)) {
      if (existsSync(name)) return name;
      continue;
    }
    for (const dir of dirs) {
      for (const ext of extensions) if (existsSync(join(dir, name + ext))) return name;
    }
  }
  return null;
}

/**
 * The argument list that opens `file` at `line` with the editor `spec`: a preset name, or a
 * command template whose `{file}` and `{line}` are replaced inside each argument (so a path
 * with spaces stays one argument). Returns null for an empty spec.
 */
export function editorCommand(spec, file, line) {
  if (!spec || !String(spec).trim()) return null;
  const text = String(spec).trim();
  let template = EDITOR_PRESETS[text.toLowerCase()];
  if (!template) {
    if (!text.includes('{file}')) throw new Error(`Unknown editor "${text}": name one of ${Object.keys(EDITOR_PRESETS).join(', ')}, or give a command with {file} and {line}`);
    template = splitCommand(text);
  }
  const [program, ...rest] = template;
  const executable = Array.isArray(program) ? findExecutable(program) : program;
  if (!executable) throw new Error(`No ${text} launcher found on PATH (tried ${program.join(', ')})`);
  const fill = (arg) => arg.replace(/\{file\}/g, file).replace(/\{line\}/g, String(line));
  return [executable, ...rest.map(fill)];
}

/** Open `file` at `line` in the editor named by `spec`; resolves once the program has started. */
export function openInEditor(spec, file, line) {
  return new Promise((done, fail) => {
    let command;
    try {
      command = editorCommand(spec, file, line);
    } catch (error) {
      fail(error);
      return;
    }
    if (!command) {
      fail(new Error('No editor configured: start the preview with --editor <name or command>'));
      return;
    }
    const child = spawn(command[0], command.slice(1), { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (error) => fail(new Error(`Cannot run ${command[0]}: ${error.message}`)));
    child.on('spawn', () => {
      child.unref();
      done(command);
    });
  });
}

// ---------------------------------------------------------------------------
// Registry of running previews
// ---------------------------------------------------------------------------

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** Register a running preview; returns the function that removes the entry. */
export function registerPreview({ port, roots, deck = null, editor = null }) {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  const file = join(REGISTRY_DIR, `${port}.json`);
  const entry = { port, pid: process.pid, roots: roots.map((root) => slashes(resolve(root))), deck: deck && slashes(resolve(deck)), editor, started: Date.now() };
  writeFileSync(file, JSON.stringify(entry));
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    try {
      if (JSON.parse(readFileSync(file, 'utf8')).pid === process.pid) unlinkSync(file);
    } catch {
      /* already gone */
    }
  };
  process.on('exit', remove);
  return remove;
}

/** Registered previews whose process is still running, newest first; stale entries are removed. */
export function previews() {
  if (!existsSync(REGISTRY_DIR)) return [];
  const entries = [];
  for (const name of readdirSync(REGISTRY_DIR)) {
    if (!name.endsWith('.json')) continue;
    const file = join(REGISTRY_DIR, name);
    try {
      const entry = JSON.parse(readFileSync(file, 'utf8'));
      if (alive(entry.pid)) entries.push(entry);
      else unlinkSync(file);
    } catch {
      /* unreadable entry */
    }
  }
  return entries.sort((a, b) => b.started - a.started);
}

/** The previews that watch `file`'s folder; when none does, every running preview, as the file may be imported from elsewhere. */
export function previewsFor(file, entries = previews()) {
  const path = slashes(resolve(file));
  const watching = entries.filter((entry) => entry.roots.some((root) => path === root || path.startsWith(`${root}/`)));
  return watching.length ? watching : entries;
}

/** Ask a running preview to show the stop of `line` in `file`. */
export async function requestJump(entry, file, line) {
  const response = await fetch(`http://127.0.0.1:${entry.port}/__zoomdeck/sync/jump`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: slashes(resolve(file)), line }),
  });
  if (!response.ok) throw new Error(`The preview on port ${entry.port} answered ${response.status}`);
  return response.json();
}

// ---------------------------------------------------------------------------
// The Vite plugin
// ---------------------------------------------------------------------------

function readBody(request) {
  return new Promise((done, fail) => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      text += chunk;
      if (text.length > 65536) fail(new Error('Request too large'));
    });
    request.on('end', () => done(text));
    request.on('error', fail);
  });
}

function reply(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

/** The file-system path of a document the player names: a URL under this server, or a path. */
export function documentPath(file, root) {
  if (typeof file !== 'string' || !file) return null;
  if (file.startsWith('file:')) return slashes(fileURLToPath(file));
  if (!/^https?:/i.test(file)) return slashes(resolve(file));
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(file).pathname);
  } catch {
    return null;
  }
  const path = pathname.startsWith('/@fs/') ? pathname.slice(4) : `${slashes(root).replace(/\/$/, '')}${pathname}`;
  return path.replace(/^\/([A-Za-z]:)/, '$1');
}

/**
 * Serve the synchronization endpoints and register the preview. `roots` are the folders whose
 * files this server shows (the deck folder and the watched paths); `editor` is the `--editor`
 * value, null when inverse search is off.
 */
export function editorSync({ editor = null, roots = [], deck = null } = {}) {
  return {
    name: 'zoomdeck-editor-sync',
    configureServer(server) {
      const root = slashes(server.config.root);
      /** The most recent jump, for a page that was reloading when it was sent. */
      let pending = null;
      const register = () => {
        const address = server.httpServer?.address();
        if (!address || typeof address !== 'object') return;
        const remove = registerPreview({ port: address.port, roots: roots.length ? roots : [server.config.root], deck, editor });
        server.httpServer?.once('close', remove);
      };
      if (server.httpServer?.listening) register();
      else server.httpServer?.once('listening', register);

      server.middlewares.use('/__zoomdeck/sync', async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        try {
          if (url.pathname === '/' || url.pathname === '') {
            reply(response, 200, { editor, jump: pending && Date.now() - pending.at < 5000 ? pending : null, root });
            return;
          }
          const body = request.method === 'POST' ? JSON.parse((await readBody(request)) || '{}') : Object.fromEntries(url.searchParams);
          if (url.pathname === '/jump') {
            const file = typeof body.file === 'string' ? slashes(resolve(body.file)) : null;
            const line = Number(body.line);
            if (!file || !Number.isInteger(line) || line < 1) {
              reply(response, 400, { ok: false, error: 'jump needs a file and a positive line' });
              return;
            }
            pending = { file, line, root, at: Date.now() };
            server.ws.send(EVENT, pending);
            reply(response, 200, { ok: true, file, line });
            return;
          }
          if (url.pathname === '/edit') {
            const file = documentPath(body.file, server.config.root);
            const line = Math.max(1, Number(body.line) || 1);
            if (!file) {
              reply(response, 400, { ok: false, error: 'edit needs the document to open' });
              return;
            }
            try {
              const command = await openInEditor(editor, file, line);
              console.log(`[zoomdeck] Opened ${file}:${line} with ${command[0]}`);
              reply(response, 200, { ok: true, command });
            } catch (error) {
              console.warn(`[zoomdeck] ${error.message}`);
              reply(response, 200, { ok: false, error: error.message });
            }
            return;
          }
          reply(response, 404, { ok: false, error: `Unknown endpoint ${url.pathname}` });
        } catch (error) {
          reply(response, 400, { ok: false, error: error.message });
        }
      });
    },
  };
}
