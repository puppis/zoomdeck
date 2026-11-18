/**
 * The player's export of a deck as a web page. The page names its deck and the form; the server
 * builds it as `zoomdown build` does, into a folder of its own outside the deck, and the page
 * takes the result from there: file by file into a folder the viewer chose, as one file or a zip
 * for the browser's downloads, or the server copies it into the `build/` folder next to the deck.
 *
 *   GET    /__zoomdown/export                       { ok: true }: the endpoint is here
 *   POST   /__zoomdown/export?op=start&deck=<url>&form=folder|file[&notes=0][&outline=1][&scene=]
 *                                                   { id }: the build is queued
 *   GET    /__zoomdown/export?id=                   { status, error, files: [{ path, size }] }
 *   GET    /__zoomdown/export?id=&file=<path>       one file of the result (`&as=<name>`: a download)
 *   GET    /__zoomdown/export?id=&zip=<name>        the whole result as `<name>.zip`, a download
 *   POST   /__zoomdown/export?id=&op=place&name=    copied to `build/<name>/` (`build/<name>.html` for one file)
 *   GET    /__zoomdown/export?op=check&deck=&form=&name=   whether build/<name> may receive an export, before one is built
 *   POST   /__zoomdown/export?op=writing            the page is writing files: the deck does not reload meanwhile
 *   DELETE /__zoomdown/export?id=                   the result is forgotten
 *
 * One build runs at a time; a result nobody asks for is removed after an hour, and all of them
 * when the server stops.
 */
import { promises as fs, createReadStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BundleWriter } from './bundle.mjs';
import { documentPath, slashes } from './sync.mjs';

export const ENDPOINT = '/__zoomdown/export';

/** How long a write announced by the page keeps the deck from reloading, in milliseconds. */
const WRITING_LEASE = 15_000;
/** How long a finished result waits for the page, in milliseconds. */
const KEEP = 3600_000;

let writingUntil = 0;

/**
 * Whether the page is writing an export into a folder of its own choice right now. The deck's
 * reload watchers ask, since that folder may lie inside the deck's, where a reload would cut the
 * writing short.
 */
export function exportWriting() {
  return Date.now() < writingUntil;
}

/** A name for a file or a folder: letters, digits, dots, dashes and underscores, not starting with a dot. */
export function exportName(value, fallback = 'deck') {
  const name = String(value ?? '').trim().replace(/[^\w.-]+/g, '-').replace(/^[^A-Za-z0-9]+|-+$/g, '');
  return name || fallback;
}

/** The deck file a page names, when it lies inside one of the served roots; null otherwise. */
export function deckFileFor(deck, roots, root) {
  const path = documentPath(deck, root);
  if (!path) return null;
  const allowed = roots.map((candidate) => slashes(resolve(candidate)));
  if (!allowed.some((candidate) => path.startsWith(`${candidate}/`))) return null;
  return path.split('/').join(sep);
}

/** The files under `dir`, as paths relative to it with forward slashes, and their sizes. */
export async function listFiles(dir) {
  const files = [];
  async function walk(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push({ path: relative(dir, path).split(sep).join('/'), size: (await fs.stat(path)).size });
    }
  }
  await walk(dir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Where a result goes in the deck's `build/` folder, and whether something there may be
 * replaced: an earlier export only (a folder with an `index.html`, or an HTML file), never
 * anything else of the presenter's.
 */
export async function placeTarget(deckDir, name, form) {
  const target = join(deckDir, 'build', form === 'file' ? `${name}.html` : name);
  if (!existsSync(target)) return target;
  const stat = await fs.stat(target);
  const earlier = form === 'file' ? stat.isFile() && extname(target) === '.html' : stat.isDirectory() && existsSync(join(target, 'index.html'));
  if (!earlier) throw new Error(`build/${basename(target)} exists and is not an earlier export; choose another name`);
  return target;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.zip': 'application/zip' };

function reply(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function sendFile(response, path, download) {
  response.statusCode = 200;
  response.setHeader('Content-Type', TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream');
  response.setHeader('Cache-Control', 'no-store');
  if (download) response.setHeader('Content-Disposition', `attachment; filename="${download.replace(/["\\]/g, '')}"`);
  createReadStream(path).on('error', () => response.destroy()).pipe(response);
}

/** The result as a stored zip, its files under a folder named `name`, written once beside it. */
async function zipOf(job, name) {
  const path = join(job.dir, `${name}.zip`);
  if (job.zips.has(path)) return path;
  const writer = await BundleWriter.open(path, null);
  const chunk = Buffer.alloc(8 * 1024 * 1024);
  for (const file of job.files) {
    await writer.begin(`${name}/${file.path}`);
    const handle = await fs.open(join(job.out, ...file.path.split('/')), 'r');
    try {
      for (;;) {
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        await writer.write(chunk.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
    await writer.end();
  }
  await writer.finish();
  job.zips.add(path);
  return path;
}

/**
 * Serve the export endpoint. `roots` are the folders whose decks this server shows; `build` is
 * `buildDeck` of bin/zoomdown.mjs (passed in, since that module serves this one).
 */
export function exportStore({ roots = [], build }) {
  return {
    name: 'zoomdown-export',
    configureServer(server) {
      const jobs = new Map();
      let queue = Promise.resolve();
      const forget = async (job) => {
        jobs.delete(job.id);
        await fs.rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
      };
      const sweep = setInterval(() => {
        for (const job of jobs.values()) if (job.status !== 'building' && job.status !== 'queued' && Date.now() - job.touched > KEEP) void forget(job);
      }, 600_000);
      sweep.unref?.();
      server.httpServer?.on('close', () => {
        clearInterval(sweep);
        for (const job of [...jobs.values()]) void forget(job);
      });

      const run = async (job) => {
        // An export the page gave up on before its turn is not built at all.
        if (job.abandoned) return;
        job.status = 'building';
        try {
          await build({ positional: [job.deck], output: job.out, oneFile: job.form === 'file', showOutline: job.outline, withoutNotes: !job.notes, scene: job.scene, watch: [] });
          job.files = await listFiles(job.out);
          job.status = 'done';
          console.log(`[zoomdown] Exported ${basename(job.deck)} as ${job.form === 'file' ? 'one HTML file' : `a folder of ${job.files.length} files`}`);
        } catch (error) {
          job.status = 'failed';
          job.error = error instanceof Error ? error.message : String(error);
          if (!job.abandoned) console.error(`[zoomdown] Export failed: ${job.error}`);
        }
        job.touched = Date.now();
        // Given up on while it was built: its folder goes now that nothing writes into it.
        if (job.abandoned) await fs.rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
      };

      server.middlewares.use(ENDPOINT, (request, response) => {
        void (async () => {
          try {
            const url = new URL(request.url ?? '/', 'http://localhost');
            const op = url.searchParams.get('op');
            const id = url.searchParams.get('id');
            if (request.method === 'POST' && op === 'writing') {
              writingUntil = Date.now() + WRITING_LEASE;
              reply(response, 200, { ok: true });
              return;
            }
            if (request.method === 'GET' && op === 'check') {
              const deck = deckFileFor(url.searchParams.get('deck') ?? '', roots, server.config.root);
              if (!deck || !existsSync(deck)) {
                reply(response, 404, { ok: false, error: 'This deck is not served here' });
                return;
              }
              try {
                await placeTarget(join(deck, '..'), exportName(url.searchParams.get('name')), url.searchParams.get('form') === 'file' ? 'file' : 'folder');
                reply(response, 200, { ok: true });
              } catch (error) {
                reply(response, 409, { ok: false, error: error.message });
              }
              return;
            }
            if (request.method === 'POST' && op === 'start') {
              const deck = deckFileFor(url.searchParams.get('deck') ?? '', roots, server.config.root);
              if (!deck || !existsSync(deck)) {
                reply(response, 404, { ok: false, error: 'This deck is not served here' });
                return;
              }
              const dir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'zoomdown-export-')));
              const job = {
                id: randomUUID(),
                deck,
                form: url.searchParams.get('form') === 'file' ? 'file' : 'folder',
                notes: url.searchParams.get('notes') !== '0',
                outline: url.searchParams.get('outline') === '1',
                scene: url.searchParams.get('scene') || null,
                status: 'queued',
                abandoned: false,
                error: null,
                dir,
                out: join(dir, 'out'),
                files: [],
                zips: new Set(),
                touched: Date.now(),
              };
              jobs.set(job.id, job);
              queue = queue.then(() => run(job), () => run(job));
              reply(response, 200, { ok: true, id: job.id });
              return;
            }
            if (!id) {
              if (request.method === 'GET') reply(response, 200, { ok: true });
              else reply(response, 400, { ok: false, error: 'No export named' });
              return;
            }
            const job = jobs.get(id);
            if (!job) {
              reply(response, 404, { ok: false, error: 'This export is gone (the server may have restarted)' });
              return;
            }
            job.touched = Date.now();
            if (request.method === 'DELETE') {
              // A build under way finishes into its own folder, which goes when it ends.
              if (job.status === 'queued' || job.status === 'building') {
                job.abandoned = true;
                jobs.delete(job.id);
                if (job.status === 'queued') await fs.rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
              } else await forget(job);
              reply(response, 200, { ok: true });
              return;
            }
            if (request.method === 'GET' && !url.searchParams.has('file') && !url.searchParams.has('zip')) {
              reply(response, 200, { ok: true, status: job.status, error: job.error, form: job.form, files: job.files });
              return;
            }
            if (job.status !== 'done') {
              reply(response, 409, { ok: false, error: 'The export is not ready' });
              return;
            }
            if (request.method === 'GET' && url.searchParams.has('file')) {
              // Only a file of the result, by its listed path: nothing else on disk is reachable.
              const file = job.files.find((candidate) => candidate.path === url.searchParams.get('file'));
              if (!file) {
                reply(response, 404, { ok: false, error: 'No such file in the export' });
                return;
              }
              sendFile(response, join(job.out, ...file.path.split('/')), url.searchParams.get('as'));
              return;
            }
            if (request.method === 'GET') {
              const name = exportName(url.searchParams.get('zip'));
              sendFile(response, await zipOf(job, name), `${name}.zip`);
              return;
            }
            if (request.method === 'POST' && op === 'place') {
              const name = exportName(url.searchParams.get('name'));
              const target = await placeTarget(join(job.deck, '..'), name, job.form);
              writingUntil = Date.now() + WRITING_LEASE;
              await fs.rm(target, { recursive: true, force: true });
              await fs.mkdir(join(target, '..'), { recursive: true });
              if (job.form === 'file') await fs.copyFile(join(job.out, 'offline.html'), target);
              else await fs.cp(job.out, target, { recursive: true });
              reply(response, 200, { ok: true, path: `build/${basename(target)}` });
              return;
            }
            reply(response, 400, { ok: false, error: 'Unknown operation' });
          } catch (error) {
            if (!response.headersSent) reply(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            else response.destroy();
          }
        })();
      });
    },
  };
}
