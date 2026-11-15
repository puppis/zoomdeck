/**
 * Recordings of talks, kept in a `recordings/` folder next to the deck, one bundle
 * `<name>.zip` each (see bundle.mjs): the media files and the timeline. The player writes a
 * bundle through `POST /__zoomdeck/recordings` while the talk runs (open, begin a media file,
 * its chunks, end it, drafts of the timeline, finish), so that stopping leaves nothing to copy;
 * `GET` with a file name streams one entry of a bundle, with ranges, for playback; `PUT` keeps a
 * file the player produced (an exported video) beside the bundle; `DELETE` removes a talk. The
 * folder's `recordings/index.json`, rewritten after every change, is what players read, served
 * here like any file of the deck and copied by the folder export, which also unpacks the
 * bundles for viewers' browsers. Talks saved as plain files by earlier versions are still read.
 */
import { promises as fs } from 'node:fs';
import { createReadStream, existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { documentPath, slashes } from './sync.mjs';
import { BundleWriter, isJournal, readDirectory, readEntry, recoverBundle } from './bundle.mjs';

export const FOLDER = 'recordings';

/** Names a recording may have: letters, digits, dots, dashes and underscores, starting with a letter or digit. */
export const NAME = /^[A-Za-z0-9][\w.-]*$/;

/** The files a recording consists of, by its name: its bundle and journal, exported videos, and the plain files of an older talk. */
export function recordingFiles(name, entries) {
  return entries.filter((file) => file === `${name}.json` || file.startsWith(`${name}.`) && file !== 'index.json');
}

/** The entry in the index for a timeline, read from a bundle (`file` names it) or from a plain file. */
function indexEntry(name, timeline, file) {
  if (timeline?.version !== 1 || !Array.isArray(timeline.events)) return null;
  const media = Array.isArray(timeline.media) ? timeline.media : [];
  return {
    name,
    title: timeline.deck?.title ?? '',
    recorded: timeline.recorded ?? '',
    duration: Number(timeline.duration) || 0,
    media: media.length ? media[0].file : null,
    video: media.some((part) => part?.video),
    parts: media.length,
    ...(file ? { file } : {}),
  };
}

/** The timeline inside a bundle, or null when the file is not a complete bundle holding one. */
async function bundleTimeline(path, name) {
  const listing = await readDirectory(path);
  const entry = listing?.entries.find((candidate) => candidate.name === `${name}.json`);
  if (!entry) return null;
  try {
    return JSON.parse((await readEntry(path, entry)).toString('utf8'));
  } catch {
    return null;
  }
}

/** Build the index of a recordings folder from the bundles and timelines it holds; a bundle cut short is closed first. */
export async function buildIndex(folder) {
  const recordings = [];
  let entries = [];
  try {
    entries = await fs.readdir(folder);
  } catch {
    return { recordings };
  }
  const bundled = new Set();
  for (const file of entries.sort()) {
    if (extname(file) !== '.zip') continue;
    const name = basename(file, '.zip');
    const path = join(folder, file);
    // A talk being recorded right now has no directory yet and is not to be closed by the index.
    if (sessions.has(path)) continue;
    if (!(await readDirectory(path))) await recoverBundle(path).catch(() => false);
    const entry = indexEntry(name, await bundleTimeline(path, name), file);
    if (!entry) continue;
    recordings.push(entry);
    bundled.add(name);
  }
  for (const file of entries) {
    if (extname(file) !== '.json' || file === 'index.json' || bundled.has(basename(file, '.json'))) continue;
    try {
      const entry = indexEntry(basename(file, '.json'), JSON.parse(await fs.readFile(join(folder, file), 'utf8')), null);
      if (entry) recordings.push(entry);
    } catch {
      /* not a timeline */
    }
  }
  recordings.sort((a, b) => a.name.localeCompare(b.name));
  return { recordings };
}

export async function writeIndex(folder) {
  const index = await buildIndex(folder);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(join(folder, 'index.json'), JSON.stringify(index, null, 2));
  return index;
}

/** The deck folder a request names, when it lies inside one of the served roots; null otherwise. */
export function deckFolderFor(deck, roots, root) {
  const path = documentPath(deck, root);
  if (!path) return null;
  // A folder is named with a trailing slash (the deck's base URL); a file by its document.
  const folder = /[\/\\]$/.test(deck) ? path.replace(/\/$/, '') : slashes(dirname(path));
  const allowed = roots.map((candidate) => slashes(resolve(candidate)));
  if (!allowed.some((candidate) => folder === candidate || folder.startsWith(`${candidate}/`))) return null;
  return folder.split('/').join(sep);
}

function reply(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request, limit) {
  return new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(new Error('The request is too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => done(Buffer.concat(chunks)));
    request.on('error', fail);
  });
}

const MEDIA_EXTENSIONS = { 'video/webm': 'webm', 'audio/webm': 'webm', 'video/mp4': 'mp4', 'audio/mp4': 'm4a' };
const CONTENT_TYPES = { webm: 'video/webm', mp4: 'video/mp4', m4a: 'audio/mp4', json: 'application/json' };

/** The name of a talk's media file inside its bundle: `name.webm` for the first part, `name.part2.webm` from the second on. */
export function mediaFileName(name, type, part) {
  return `${name}.${part > 1 ? `part${part}.` : ''}${MEDIA_EXTENSIONS[type] ?? 'webm'}`;
}

/** Whether a changed file belongs to a recordings folder, which must not reload the preview. */
export function isRecordingFile(file) {
  return slashes(file).includes(`/${FOLDER}/`);
}

/** Stream one entry of a bundle, honoring a byte range, as the player's media element asks for it. */
async function serveEntry(response, path, file, range, headOnly = false) {
  const listing = await readDirectory(path);
  const entry = listing?.entries.find((candidate) => candidate.name === file);
  if (!entry || !entry.stored) {
    reply(response, 404, { ok: false, error: `${file} is not in the bundle` });
    return;
  }
  let from = 0;
  let to = entry.size - 1;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? '');
  const partial = Boolean(match) && entry.size > 0;
  if (partial) {
    if (match[1]) from = Math.min(Number(match[1]), entry.size);
    if (match[2]) to = Math.min(Number(match[2]), entry.size - 1);
    else if (!match[1]) from = 0;
    if (from > to) {
      response.statusCode = 416;
      response.setHeader('Content-Range', `bytes */${entry.size}`);
      response.end();
      return;
    }
  }
  response.statusCode = partial ? 206 : 200;
  response.setHeader('Content-Type', CONTENT_TYPES[extname(file).slice(1)] ?? 'application/octet-stream');
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', String(entry.size ? to - from + 1 : 0));
  if (partial) response.setHeader('Content-Range', `bytes ${from}-${to}/${entry.size}`);
  if (!entry.size || headOnly) {
    response.end();
    return;
  }
  const stream = createReadStream(path, { start: entry.dataOffset + from, end: entry.dataOffset + to });
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

/** The bundles being written, by path: a talk is written by one page at a time. */
const sessions = new Map();

/** Let go of every bundle being written (the server stops); their journals keep them recoverable. */
export async function releaseBundles() {
  for (const [path, writer] of sessions) {
    sessions.delete(path);
    await writer.release().catch(() => undefined);
  }
}

/**
 * Serve the recordings endpoints. `roots` are the folders whose decks may receive
 * recordings (the deck folder and the watched paths, or the examples folder).
 */
export function recordingStore({ roots = [], limit = 4 * 1024 * 1024 * 1024 } = {}) {
  return {
    name: 'zoomdeck-recordings',
    configureServer(server) {
      server.httpServer?.on('close', () => void releaseBundles());
      server.middlewares.use('/__zoomdeck/recordings', async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const name = url.searchParams.get('name') ?? '';
        const folder = deckFolderFor(url.searchParams.get('deck') ?? '', roots.length ? roots : [server.config.root], server.config.root);
        try {
          if (!folder) {
            reply(response, 400, { ok: false, error: 'The deck is not served from here' });
            return;
          }
          if (!NAME.test(name)) {
            reply(response, 400, { ok: false, error: 'Invalid recording name' });
            return;
          }
          const target = join(folder, FOLDER);
          const bundle = join(target, `${name}.zip`);
          if (request.method === 'POST') {
            const op = url.searchParams.get('op') ?? '';
            if (op === 'open') {
              // Starting a talk, or continuing one: the bundle is created, or cut back to its media.
              const previous = sessions.get(bundle);
              if (previous) {
                sessions.delete(bundle);
                await previous.release();
              }
              const writer = await BundleWriter.open(bundle, `${name}.json`);
              sessions.set(bundle, writer);
              console.log(`[zoomdeck] ${writer.names.length ? 'Continuing' : 'Recording'} ${join(FOLDER, `${name}.zip`)}`);
              reply(response, 200, { ok: true, file: `${name}.zip`, parts: writer.names.length });
              return;
            }
            const writer = sessions.get(bundle);
            if (!writer) {
              reply(response, 409, { ok: false, error: 'This talk is not being recorded here (the server may have restarted)' });
              return;
            }
            if (op === 'begin') {
              const part = Number(url.searchParams.get('part') ?? '1');
              const file = mediaFileName(name, (request.headers['content-type'] ?? '').split(';')[0].trim(), part);
              await writer.begin(file);
              reply(response, 200, { ok: true, file });
              return;
            }
            if (op === 'chunk') {
              await writer.write(await readBody(request, 256 * 1024 * 1024));
              reply(response, 200, { ok: true });
              return;
            }
            if (op === 'end') {
              const entry = await writer.end();
              reply(response, 200, { ok: true, file: entry?.name ?? null, size: entry?.size ?? 0 });
              return;
            }
            if (op === 'draft' || op === 'finish') {
              const timeline = JSON.parse((await readBody(request, 256 * 1024 * 1024)).toString('utf8'));
              if (timeline?.version !== 1 || !Array.isArray(timeline.events)) throw new Error('Not a timeline');
              if (op === 'draft') {
                await writer.draft(timeline);
                reply(response, 200, { ok: true });
                return;
              }
              sessions.delete(bundle);
              await writer.putFile(`${name}.json`, Buffer.from(JSON.stringify(timeline), 'utf8'));
              await writer.finish();
              const index = await writeIndex(target);
              const { size } = await fs.stat(bundle);
              console.log(`[zoomdeck] Saved ${join(FOLDER, `${name}.zip`)} (${(size / 1e6).toFixed(1)} MB, ${writer.names.length - 1} media file${writer.names.length === 2 ? '' : 's'})`);
              reply(response, 200, { ok: true, file: `${name}.zip`, index });
              return;
            }
            reply(response, 400, { ok: false, error: 'Unknown operation' });
            return;
          }
          if (request.method === 'PUT') {
            // A file the player produced (an exported video), kept beside the talk's bundle.
            const kind = url.searchParams.get('kind') ?? '';
            if (!/^[a-z0-9]{1,5}$/.test(kind) || kind === 'zip' || kind === 'json') {
              reply(response, 400, { ok: false, error: 'Unknown kind' });
              return;
            }
            const file = `${name}.${kind}`;
            const body = await readBody(request, limit);
            await fs.mkdir(target, { recursive: true });
            await fs.writeFile(join(target, file), body);
            console.log(`[zoomdeck] Saved ${join(FOLDER, file)} (${(body.length / 1e6).toFixed(1)} MB)`);
            reply(response, 200, { ok: true, file });
            return;
          }
          if (request.method === 'DELETE') {
            const writer = sessions.get(bundle);
            if (writer) {
              sessions.delete(bundle);
              await writer.release();
            }
            if (existsSync(target)) {
              for (const file of recordingFiles(name, await fs.readdir(target))) await fs.rm(join(target, file), { force: true });
              await writeIndex(target);
            }
            reply(response, 200, { ok: true });
            return;
          }
          if (request.method === 'GET' || request.method === 'HEAD') {
            const file = url.searchParams.get('file');
            if (file) {
              if (!/^[\w.-]+$/.test(file) || isJournal(file)) {
                reply(response, 400, { ok: false, error: 'Invalid file name' });
                return;
              }
              await serveEntry(response, bundle, file, request.headers.range, request.method === 'HEAD');
              return;
            }
            reply(response, 200, { ok: true, ...(await buildIndex(target)) });
            return;
          }
          reply(response, 405, { ok: false, error: 'Method not allowed' });
        } catch (error) {
          reply(response, 400, { ok: false, error: error.message });
        }
      });
    },
  };
}
