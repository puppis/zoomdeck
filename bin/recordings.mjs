/**
 * Recordings of talks, kept in a `recordings/` folder next to the deck. The player saves a
 * recording through `PUT /__zoomdeck/recordings` (the media file, then the timeline) and
 * removes one through `DELETE`; the folder's `recordings/index.json`, rewritten after every
 * change, is what players read, served here like any file of the deck and copied by the
 * folder export.
 */
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { documentPath, findExecutable, slashes } from './sync.mjs';

export const FOLDER = 'recordings';

/** Names a recording may have: letters, digits, dots, dashes and underscores, starting with a letter or digit. */
export const NAME = /^[A-Za-z0-9][\w.-]*$/;

/** The media and timeline files a recording consists of, by its name. */
export function recordingFiles(name, entries) {
  return entries.filter((file) => file === `${name}.json` || file.startsWith(`${name}.`) && file !== 'index.json');
}

/** Build the index of a recordings folder from the timelines it holds. */
export async function buildIndex(folder) {
  const recordings = [];
  let entries = [];
  try {
    entries = await fs.readdir(folder);
  } catch {
    return { recordings };
  }
  for (const file of entries.sort()) {
    if (extname(file) !== '.json' || file === 'index.json') continue;
    try {
      const timeline = JSON.parse(await fs.readFile(join(folder, file), 'utf8'));
      if (timeline?.version !== 1 || !Array.isArray(timeline.events)) continue;
      recordings.push({
        name: basename(file, '.json'),
        title: timeline.deck?.title ?? '',
        recorded: timeline.recorded ?? '',
        duration: Number(timeline.duration) || 0,
        media: Array.isArray(timeline.media) && timeline.media.length ? timeline.media[0].file : null,
        video: Array.isArray(timeline.media) && timeline.media.some((part) => part?.video),
        parts: Array.isArray(timeline.media) ? timeline.media.length : 0,
      });
    } catch {
      /* not a timeline */
    }
  }
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
        fail(new Error('The recording is too large'));
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

/**
 * A file written by the browser's recorder lacks its duration and seek index, so players show
 * no length and cannot seek. When ffmpeg is installed, rewriting the container (no re-encoding,
 * a second's work) puts them in; without it the file is kept as it is.
 */
export function finishMediaFile(file) {
  const ffmpeg = findExecutable(['ffmpeg']);
  if (!ffmpeg || !/\.(webm|mp4|m4a)$/.test(file)) return Promise.resolve(false);
  const temp = `${file}.tmp${extname(file)}`;
  return new Promise((done) => {
    execFile(ffmpeg, ['-y', '-v', 'error', '-i', file, '-c', 'copy', temp], { timeout: 120_000 }, async (error) => {
      if (error) {
        await fs.rm(temp, { force: true });
        done(false);
        return;
      }
      try {
        await fs.rename(temp, file);
        done(true);
      } catch {
        await fs.rm(temp, { force: true });
        done(false);
      }
    });
  });
}

/** Whether a changed file belongs to a recordings folder, which must not reload the preview. */
export function isRecordingFile(file) {
  return slashes(file).includes(`/${FOLDER}/`);
}

/**
 * Serve the recordings endpoints. `roots` are the folders whose decks may receive
 * recordings (the deck folder and the watched paths, or the examples folder).
 */
export function recordingStore({ roots = [], limit = 4 * 1024 * 1024 * 1024 } = {}) {
  return {
    name: 'zoomdeck-recordings',
    configureServer(server) {
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
          if (request.method === 'PUT') {
            const kind = url.searchParams.get('kind') ?? 'timeline';
            const part = Number(url.searchParams.get('part') ?? '0');
            const type = (request.headers['content-type'] ?? '').split(';')[0].trim();
            let file;
            if (kind === 'timeline') file = `${name}.json`;
            else if (kind === 'media') file = `${name}.${part > 1 ? `part${part}.` : ''}${MEDIA_EXTENSIONS[type] ?? 'webm'}`;
            else if (/^[a-z0-9]{1,5}$/.test(kind)) file = `${name}.${kind}`;
            else {
              reply(response, 400, { ok: false, error: 'Unknown kind' });
              return;
            }
            const body = await readBody(request, limit);
            if (kind === 'timeline') {
              const timeline = JSON.parse(body.toString('utf8'));
              if (timeline?.version !== 1 || !Array.isArray(timeline.events)) throw new Error('Not a timeline');
            }
            await fs.mkdir(target, { recursive: true });
            await fs.writeFile(join(target, file), body);
            const finished = kind === 'timeline' ? false : await finishMediaFile(join(target, file));
            const index = kind === 'timeline' ? await writeIndex(target) : null;
            console.log(`[zoomdeck] Saved ${join(FOLDER, file)} (${(body.length / 1e6).toFixed(1)} MB${finished ? ', duration and seek index written' : ''})`);
            reply(response, 200, { ok: true, file, index, finished });
            return;
          }
          if (request.method === 'DELETE') {
            if (existsSync(target)) {
              for (const file of recordingFiles(name, await fs.readdir(target))) await fs.rm(join(target, file), { force: true });
              await writeIndex(target);
            }
            reply(response, 200, { ok: true });
            return;
          }
          if (request.method === 'GET') {
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
