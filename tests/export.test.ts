import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { deckFileFor, exportName, exportStore, exportWriting, placeTarget } from '../bin/export.mjs';
import { readDirectory, readEntry } from '../bin/bundle.mjs';
import { buildDeck } from '../bin/zoomdown.mjs';
import { defaultWebExportName, webExportName } from '../src/player/webpage';

/** A response the handler writes into, JSON or a streamed file alike. */
class FakeResponse extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  headersSent = false;
  private readonly _chunks: Buffer[] = [];
  readonly done: Promise<void>;
  constructor() {
    super();
    this.done = new Promise((resolve) => this.on('finish', () => resolve()));
  }
  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }
  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.headersSent = true;
    this._chunks.push(Buffer.from(chunk));
    callback();
  }
  body(): Buffer {
    return Buffer.concat(this._chunks);
  }
  json(): Record<string, unknown> {
    return JSON.parse(this.body().toString('utf8'));
  }
}

type Handler = (request: { method: string; url: string }, response: FakeResponse) => void;

let dirs: string[] = [];
let closers: EventEmitter[] = [];
afterEach(() => {
  for (const emitter of closers) emitter.emit('close');
  closers = [];
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

/** The endpoint over a deck folder, with a build that writes a small result and remembers its options. */
function setUp(fail = false) {
  const root = mkdtempSync(join(tmpdir(), 'zoomdown-export-test-'));
  dirs.push(root);
  const deckDir = join(root, 'talk');
  mkdirSync(deckDir);
  writeFileSync(join(deckDir, 'slides.md'), '::: slide {#a}\nx\n:::\n');
  const builds: Array<Record<string, unknown>> = [];
  const build = async (options: Record<string, unknown>) => {
    builds.push(options);
    if (fail) throw new Error('the deck has a syntax error');
    const out = options.output as string;
    await fs.mkdir(join(out, 'assets'), { recursive: true });
    if (options.oneFile) {
      await fs.writeFile(join(out, 'offline.html'), '<html>one</html>');
      return { target: join(out, 'offline.html') };
    }
    await fs.writeFile(join(out, 'index.html'), '<html>folder</html>');
    await fs.writeFile(join(out, 'assets', 'player.js'), 'console.log(1)');
    return { target: join(out, 'index.html') };
  };
  let handler: Handler | null = null;
  const httpServer = new EventEmitter();
  closers.push(httpServer);
  const plugin = exportStore({ roots: [root], build }) as unknown as { configureServer: (server: unknown) => void };
  plugin.configureServer({
    middlewares: { use: (_path: string, h: Handler) => { handler = h; } },
    config: { root },
    httpServer,
  });
  const call = async (method: string, query: Record<string, string>) => {
    const response = new FakeResponse();
    (handler as unknown as Handler)({ method, url: `/?${new URLSearchParams(query)}` }, response);
    await response.done;
    return response;
  };
  const finished = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const status = (await call('GET', { id })).json();
      if (status.status === 'done' || status.status === 'failed') return status;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('the export never ended');
  };
  return { root, deckDir, builds, call, finished, deckUrl: `file://${join(deckDir, 'slides.md')}` };
}

describe('the export of a deck as a web page, from the player', () => {
  it('builds the deck the page names, with its options, and serves the files it lists only', async () => {
    const { builds, call, finished, deckUrl } = setUp();
    const start = await call('POST', { op: 'start', deck: deckUrl, form: 'folder', notes: '0', outline: '1', scene: 'Main' });
    expect(start.statusCode).toBe(200);
    const id = String(start.json().id);
    const status = await finished(id);
    expect(status.status).toBe('done');
    expect(status.files).toEqual([{ path: 'assets/player.js', size: 14 }, { path: 'index.html', size: 19 }]);
    expect(builds[0]).toMatchObject({ oneFile: false, withoutNotes: true, showOutline: true, scene: 'Main' });
    expect(String(builds[0].positional)).toMatch(/talk[\\/]slides\.md$/);
    const file = await call('GET', { id, file: 'assets/player.js' });
    expect(file.body().toString()).toBe('console.log(1)');
    expect(file.headers['content-type']).toBe('text/javascript');
    const download = await call('GET', { id, file: 'index.html', as: 'talk.html' });
    expect(download.headers['content-disposition']).toBe('attachment; filename="talk.html"');
    // Nothing but the listed files: no way out of the result's folder.
    expect((await call('GET', { id, file: '../out/index.html' })).statusCode).toBe(404);
  });

  it('refuses a deck outside the served folders, and reports a build that fails', async () => {
    const { call, finished, deckUrl } = setUp(true);
    const outside = await call('POST', { op: 'start', deck: 'file:///etc/hosts', form: 'file' });
    expect(outside.statusCode).toBe(404);
    const id = String((await call('POST', { op: 'start', deck: deckUrl, form: 'file' })).json().id);
    const status = await finished(id);
    expect(status).toMatchObject({ status: 'failed', error: 'the deck has a syntax error' });
    expect((await call('GET', { id, file: 'offline.html' })).statusCode).toBe(409);
  });

  it('zips a folder result under a folder of the chosen name', async () => {
    const { root, call, finished, deckUrl } = setUp();
    const id = String((await call('POST', { op: 'start', deck: deckUrl, form: 'folder' })).json().id);
    await finished(id);
    const zip = await call('GET', { id, zip: 'my talk' });
    expect(zip.headers['content-disposition']).toBe('attachment; filename="my-talk.zip"');
    const path = join(root, 'copy.zip');
    writeFileSync(path, zip.body());
    const listing = await readDirectory(path);
    expect(listing?.entries.map((entry) => entry.name)).toEqual(['my-talk/assets/player.js', 'my-talk/index.html']);
    expect((await readEntry(path, listing!.entries[1])).toString()).toBe('<html>folder</html>');
  });

  it('places a result in the build folder next to the deck, replacing an earlier export but nothing else', async () => {
    const { deckDir, call, finished, deckUrl } = setUp();
    const folder = String((await call('POST', { op: 'start', deck: deckUrl, form: 'folder' })).json().id);
    await finished(folder);
    const placed = await call('POST', { id: folder, op: 'place', name: 'web' });
    expect(placed.json()).toEqual({ ok: true, path: 'build/web' });
    expect(readFileSync(join(deckDir, 'build', 'web', 'index.html'), 'utf8')).toBe('<html>folder</html>');
    // An earlier export of that name is replaced, files left over from it included.
    writeFileSync(join(deckDir, 'build', 'web', 'assets', 'stale.js'), '');
    expect((await call('POST', { id: folder, op: 'place', name: 'web' })).statusCode).toBe(200);
    expect(existsSync(join(deckDir, 'build', 'web', 'assets', 'stale.js'))).toBe(false);
    // A folder of the presenter's is never replaced.
    mkdirSync(join(deckDir, 'build', 'notes'), { recursive: true });
    writeFileSync(join(deckDir, 'build', 'notes', 'todo.txt'), 'mine');
    const checked = await call('GET', { op: 'check', deck: deckUrl, form: 'folder', name: 'notes' });
    expect(checked.statusCode).toBe(409);
    expect(checked.json().error).toMatch(/build\/notes exists/);
    expect((await call('GET', { op: 'check', deck: deckUrl, form: 'folder', name: 'web' })).statusCode).toBe(200);
    const refused = await call('POST', { id: folder, op: 'place', name: 'notes' });
    expect(refused.statusCode).toBe(500);
    expect(refused.json().error).toMatch(/not an earlier export/);
    expect(readFileSync(join(deckDir, 'build', 'notes', 'todo.txt'), 'utf8')).toBe('mine');
    // One file goes to build/<name>.html.
    const file = String((await call('POST', { op: 'start', deck: deckUrl, form: 'file' })).json().id);
    await finished(file);
    expect((await call('POST', { id: file, op: 'place', name: 'web' })).json()).toEqual({ ok: true, path: 'build/web.html' });
    expect(readFileSync(join(deckDir, 'build', 'web.html'), 'utf8')).toBe('<html>one</html>');
  });

  it('forgets a result, and keeps the deck from reloading while the page writes one', async () => {
    const { call, finished, deckUrl } = setUp();
    const id = String((await call('POST', { op: 'start', deck: deckUrl, form: 'file' })).json().id);
    await finished(id);
    expect((await call('DELETE', { id })).statusCode).toBe(200);
    expect((await call('GET', { id })).statusCode).toBe(404);
    await call('POST', { op: 'writing' });
    expect(exportWriting()).toBe(true);
  });

  it('names files and folders safely, and finds decks inside the served folders only', async () => {
    expect(exportName('My talk!')).toBe('My-talk');
    expect(exportName('../../etc')).toBe('etc');
    expect(exportName('')).toBe('deck');
    expect(webExportName('  .hidden name ')).toBe('hidden-name');
    expect(defaultWebExportName({ url: 'http://127.0.0.1:8000/@fs/Users/me/My%20Talk/slides.md' }, 'Title')).toBe('My-Talk');
    expect(defaultWebExportName(null, 'A title')).toBe('A-title');
    // A PDF's export is named after the PDF, wherever it lies.
    expect(defaultWebExportName({ url: 'http://127.0.0.1:8000/@fs/Users/me/Downloads/Lecture%203.PDF' }, 'Title')).toBe('Lecture-3');
    expect(deckFileFor('http://localhost:5178/examples/tour/slides.md', ['/repo/examples'], '/repo')).toBe(join('/repo/examples/tour/slides.md'));
    expect(deckFileFor('http://localhost:5178/src/index.ts', ['/repo/examples'], '/repo')).toBeNull();
    const dir = mkdtempSync(join(tmpdir(), 'zoomdown-place-'));
    dirs.push(dir);
    expect(await placeTarget(dir, 'web', 'file')).toBe(join(dir, 'build', 'web.html'));
  });

  it('reports a build that cannot start by an error, never by ending the process', async () => {
    await expect(buildDeck({ positional: [] })).rejects.toThrow(/deck path/);
    await expect(buildDeck({ positional: ['/nowhere/slides.md'], output: '/tmp/x' })).rejects.toThrow(/deck not found/);
    // A deck.json is no deck: its settings belong in the Markdown's front matter.
    await expect(buildDeck({ positional: ['/nowhere/deck.json'], output: '/tmp/x' })).rejects.toThrow(/front matter/);
  });
});
