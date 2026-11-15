/**
 * Rendering a recorded talk into one flat video file, off the clock. The page renders the deck
 * frames (see src/player/render.ts) and sends them here as PNG pictures, each with the time it
 * is shown from, through `POST /__zoomdeck/render`; at the end it sends the plan, and ffmpeg
 * composes the video: the deck frames, the camera in its corner or full frame and the screen
 * whole, taken from the talk's bundle, with the sound. The result is `recordings/<name>.mp4`
 * (H.264 and AAC, which every player and phone reads). A job's state is kept in
 * `recordings/<name>.render.json` while it runs, so that a render interrupted by quitting is
 * taken up again when the deck is opened next; the desktop app opens the render page in a
 * hidden window of its own, a browser opens it in a tab.
 */
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { documentPath, findExecutable, slashes } from './sync.mjs';
import { FOLDER, NAME, deckFolderFor, writeIndex } from './recordings.mjs';
import { readDirectory, readEntry } from './bundle.mjs';

/** Where ffmpeg may be when it is not on PATH (an app started from the Finder sees a short PATH). */
const FFMPEG_PLACES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', 'C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'];

/** The ffmpeg executable: `ZOOMDECK_FFMPEG`, the one on PATH, or one of the usual places; null when there is none. */
export function findFfmpeg() {
  const named = process.env.ZOOMDECK_FFMPEG;
  if (named && existsSync(named)) return named;
  return findExecutable(['ffmpeg']) ?? FFMPEG_PLACES.find((place) => existsSync(place)) ?? null;
}

/** The ffprobe beside an ffmpeg, when there is one. */
function findFfprobe(ffmpeg) {
  if (ffmpeg === 'ffmpeg') return findExecutable(['ffprobe']);
  const candidate = join(dirname(ffmpeg), basename(ffmpeg).replace(/ffmpeg/, 'ffprobe'));
  return existsSync(candidate) ? candidate : findExecutable(['ffprobe']);
}

/** Whether a media file has a sound track, asked of ffprobe; assumed when ffprobe is missing. */
function hasAudio(ffprobe, file) {
  if (!ffprobe) return Promise.resolve(true);
  return new Promise((done) => {
    execFile(ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { timeout: 30_000 }, (error, stdout) => {
      done(error ? true : /audio/.test(stdout));
    });
  });
}

const seconds = (ms) => (ms / 1000).toFixed(3);

/** The ffmpeg `enable` expression for a list of millisecond intervals; null for none. */
function enableExpression(intervals) {
  if (!intervals.length) return null;
  return intervals.map(([from, to]) => `between(t,${seconds(from)},${seconds(to)})`).join('+');
}

/** The parts of `[from, to]` inside the intervals, and the parts outside them. */
export function splitInterval(from, to, intervals) {
  const inside = [];
  const outside = [];
  let cursor = from;
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) {
    const start = Math.max(a, cursor);
    const end = Math.min(b, to);
    if (end <= start) continue;
    if (start > cursor) outside.push([cursor, start]);
    inside.push([start, end]);
    cursor = end;
  }
  if (cursor < to) outside.push([cursor, to]);
  return { inside, outside };
}

/** The concat list for the deck frames: each shown until the next, the last until the end of the talk. */
export function concatList(frames, duration, fps) {
  const sorted = [...frames].sort((a, b) => a.n - b.n);
  const lines = ['ffconcat version 1.0'];
  const quote = (file) => `'${file.replace(/'/g, "'\\''")}'`;
  sorted.forEach((frame, index) => {
    const next = index + 1 < sorted.length ? sorted[index + 1].t : duration;
    lines.push(`file ${quote(frame.file)}`, `duration ${seconds(Math.max(1000 / fps, next - frame.t))}`);
  });
  // The concat demuxer drops the last duration unless the last file is named again.
  if (sorted.length) lines.push(`file ${quote(sorted[sorted.length - 1].file)}`);
  return `${lines.join('\n')}\n`;
}

/**
 * The ffmpeg arguments that compose the video. `plan` is the page's (src/player/render.ts),
 * `frames` the concat list's path, `parts` the media files in the plan's order with their
 * paths and whether each has sound, `clips` the slides' own videos that played with sound
 * (path, start, duration), `output` the file to write.
 */
export function ffmpegArguments(plan, frames, parts, output, clips = []) {
  const { width: W, height: H, fps } = plan;
  const args = ['-y', '-v', 'error', '-stats', '-f', 'concat', '-safe', '0', '-i', frames];
  for (const part of parts) args.push('-i', part.path);
  for (const clip of clips) args.push('-i', clip.path);
  const filters = [`[0:v]fps=${fps},format=rgba[deck]`];
  let current = 'deck';
  let label = 0;
  const next = () => `v${label++}`;
  const margin = Math.round(W * 0.015);
  const pipWidth = Math.round(W * plan.pip.size);
  const corner = plan.pip.corner;
  const pipX = corner.endsWith('right') ? `main_w-overlay_w-${margin}` : String(margin);
  const pipY = corner.startsWith('bottom') ? `main_h-overlay_h-${margin}` : String(margin);
  parts.forEach((part, index) => {
    if (!part.video) return;
    const input = index + 1;
    const from = part.start;
    const to = part.start + part.duration;
    const shifted = next();
    filters.push(`[${input}:v]setpts=PTS-STARTPTS+${seconds(from)}/TB,fps=${fps}[${shifted}]`);
    if (part.source === 'screen') {
      // Another application's window stays whole: fitted, on black.
      const fitted = next();
      filters.push(`[${shifted}]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black[${fitted}]`);
      const out = next();
      filters.push(`[${current}][${fitted}]overlay=0:0:eof_action=pass:enable='${enableExpression([[from, to]])}'[${out}]`);
      current = out;
      return;
    }
    const { inside: full, outside: pip } = splitInterval(from, to, plan.full);
    if (full.length && pip.length) {
      const a = next();
      const b = next();
      filters.push(`[${shifted}]split[${a}][${b}]`);
      current = overlayPip(filters, current, a, pip);
      current = overlayFull(filters, current, b, full);
    } else if (full.length) {
      current = overlayFull(filters, current, shifted, full);
    } else if (pip.length) {
      current = overlayPip(filters, current, shifted, pip);
    }
  });
  function overlayPip(list, base, source, intervals) {
    const scaled = next();
    list.push(`[${source}]scale=${pipWidth}:-2[${scaled}]`);
    const out = next();
    list.push(`[${base}][${scaled}]overlay=${pipX}:${pipY}:eof_action=pass:enable='${enableExpression(intervals)}'[${out}]`);
    return out;
  }
  function overlayFull(list, base, source, intervals) {
    const scaled = next();
    list.push(`[${source}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[${scaled}]`);
    const out = next();
    list.push(`[${base}][${scaled}]overlay=0:0:eof_action=pass:enable='${enableExpression(intervals)}'[${out}]`);
    return out;
  }
  filters.push(`[${current}]format=yuv420p[vout]`);
  const sounds = parts.map((part, index) => ({ part, input: index + 1 })).filter(({ part }) => part.audio);
  sounds.forEach(({ part, input }, k) => {
    filters.push(`[${input}:a]aresample=48000,adelay=${Math.round(part.start)}:all=1[a${k}]`);
  });
  // A slide's video that played with its sound on: its sound from the start, for as long as it ran, at its place in the talk.
  clips.forEach((clip, index) => {
    const k = sounds.length + index;
    filters.push(`[${parts.length + 1 + index}:a]atrim=0:${seconds(clip.duration)},asetpts=PTS-STARTPTS,aresample=48000,adelay=${Math.round(clip.start)}:all=1[a${k}]`);
    sounds.push({ clip, input: parts.length + 1 + index });
  });
  if (sounds.length > 1) filters.push(`${sounds.map((_, k) => `[a${k}]`).join('')}amix=inputs=${sounds.length}:duration=longest:normalize=0[aout]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  if (sounds.length === 1) args.push('-map', '[a0]');
  else if (sounds.length > 1) args.push('-map', '[aout]');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-r', String(fps), '-pix_fmt', 'yuv420p');
  if (sounds.length) args.push('-c:a', 'aac', '-b:a', '160k');
  args.push('-t', seconds(plan.duration), '-movflags', '+faststart', output);
  return args;
}

/** The jobs, by the path of the video they produce. */
const jobs = new Map();

function jobFile(folder, output) {
  return join(folder, `${output}.render.json`);
}

async function persist(job) {
  const { talk, output, status, progress, error, url, fps, width } = job;
  const record = { talk, output, status, progress, error: error ?? null, url: url ?? null, fps: fps ?? null, width: width ?? null, updated: new Date().toISOString() };
  try {
    if (status === 'done') await fs.rm(jobFile(job.folder, output), { force: true });
    else await fs.writeFile(jobFile(job.folder, output), JSON.stringify(record));
  } catch {
    /* the record is a convenience */
  }
}

/** What a page or the list of talks learns about a job. */
function describe(job) {
  return { talk: job.talk, output: job.output, status: job.status, progress: job.progress, ...(job.error ? { error: job.error } : {}), ...(job.status === 'done' ? { file: `${job.output}.mp4` } : {}) };
}

/** The jobs of a folder: the live ones, and those left in records by an earlier run. */
export async function listJobs(folder) {
  const found = new Map();
  for (const job of jobs.values()) if (job.folder === folder) found.set(job.output, describe(job));
  let entries = [];
  try {
    entries = await fs.readdir(folder);
  } catch {
    return [...found.values()];
  }
  for (const file of entries) {
    if (!file.endsWith('.render.json')) continue;
    const output = file.slice(0, -'.render.json'.length);
    if (found.has(output)) continue;
    try {
      const record = JSON.parse(await fs.readFile(join(folder, file), 'utf8'));
      found.set(output, { talk: record.talk, output, status: record.status === 'done' ? 'done' : record.status === 'failed' ? 'failed' : 'interrupted', progress: Number(record.progress) || 0, ...(record.error ? { error: record.error } : {}) });
    } catch {
      /* not a record */
    }
  }
  return [...found.values()];
}

/** Open a job's working folder, where the frames go. */
async function openJob(folder, talk, output, { url = null, fps = null, width = null } = {}) {
  const key = join(folder, output);
  const previous = jobs.get(key);
  if (previous?.process) previous.process.kill();
  const dir = join(folder, `.render-${output}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(join(dir, 'frames'), { recursive: true });
  const job = { folder, talk, output, status: 'rendering', progress: 0, error: null, dir, frames: [], process: null, url, fps, width };
  jobs.set(key, job);
  await persist(job);
  return job;
}

/** The media files of a talk as files on disk: unpacked from the bundle into the job's folder, or the plain files of an older talk. */
async function mediaFiles(job, plan) {
  const bundle = join(job.folder, `${job.talk}.zip`);
  const listing = existsSync(bundle) ? await readDirectory(bundle) : null;
  const parts = [];
  for (const part of plan.media) {
    if (!/^[\w.-]+$/.test(part.file)) throw new Error(`Strange media file name ${part.file}`);
    let path;
    if (listing) {
      const entry = listing.entries.find((candidate) => candidate.name === part.file);
      if (!entry) throw new Error(`${part.file} is not in the bundle`);
      path = join(job.dir, part.file);
      await fs.writeFile(path, await readEntry(bundle, entry));
    } else {
      path = join(job.folder, part.file);
      if (!existsSync(path)) throw new Error(`${part.file} is missing`);
    }
    parts.push({ ...part, path });
  }
  return parts;
}

/** Compose the video of a job whose frames are all in; the job's status follows the work, and the result lands in the recordings folder. */
async function compose(job, plan) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg is not installed');
  job.status = 'composing';
  job.progress = 0;
  job.plan = plan;
  await persist(job);
  try {
    if (!job.frames.length) throw new Error('No frame was rendered');
    const list = join(job.dir, 'frames.txt');
    await fs.writeFile(list, concatList(job.frames, plan.duration, plan.fps));
    await fs.writeFile(join(job.dir, 'plan.json'), JSON.stringify(plan));
    const ffprobe = findFfprobe(ffmpeg);
    const parts = [];
    for (const part of await mediaFiles(job, plan)) parts.push({ ...part, audio: await hasAudio(ffprobe, part.path) });
    // The slides' own videos, by the files the page loaded them from; one that cannot be found or has no sound is left out.
    const clips = [];
    for (const clip of Array.isArray(plan.clips) ? plan.clips : []) {
      const path = job.resolve ? job.resolve(clip.src) : null;
      if (!path || !existsSync(path) || !(clip.duration > 0)) continue;
      if (await hasAudio(ffprobe, path)) clips.push({ path, start: clip.start, duration: clip.duration });
    }
    const temp = join(job.dir, 'video.mp4');
    const args = ffmpegArguments(plan, list, parts, temp, clips);
    await fs.writeFile(join(job.dir, 'ffmpeg.txt'), args.join('\n'));
    await new Promise((done, fail) => {
      const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      job.process = child;
      let tail = '';
      child.stderr.on('data', (chunk) => {
        const text = String(chunk);
        tail = (tail + text).slice(-4000);
        const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
        if (match) {
          const ms = (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000;
          job.progress = Math.min(1, ms / Math.max(1, plan.duration));
        }
      });
      child.on('error', fail);
      child.on('close', (code, signal) => {
        job.process = null;
        if (code === 0) done();
        else fail(new Error(signal ? `ffmpeg was stopped (${signal})` : `ffmpeg failed (${code}): ${tail.trim().split('\n').slice(-3).join(' ')}`));
      });
    });
    const final = join(job.folder, `${job.output}.mp4`);
    await fs.rename(temp, final);
    await fs.rm(job.dir, { recursive: true, force: true });
    job.status = 'done';
    job.progress = 1;
    await persist(job);
    await writeIndex(job.folder);
    console.log(`[zoomdeck] Rendered ${join(FOLDER, `${job.output}.mp4`)}`);
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    await persist(job);
    console.error(`[zoomdeck] Rendering ${job.output} failed: ${error.message}`);
  }
}

/**
 * Take up the renders a recordings folder was left with: a job interrupted while composing,
 * whose frames are still there, is composed again here; one interrupted while the page was
 * rendering is returned, for the caller to open its page again (the desktop app does).
 */
export async function resumeRenders(folder) {
  const pages = [];
  for (const record of await listJobs(folder)) {
    if (record.status !== 'interrupted') continue;
    const key = join(folder, record.output);
    if (jobs.has(key)) continue;
    const dir = join(folder, `.render-${record.output}`);
    let saved = null;
    try {
      saved = JSON.parse(await fs.readFile(jobFile(folder, record.output), 'utf8'));
    } catch {
      continue;
    }
    if (saved.status === 'composing' && existsSync(join(dir, 'plan.json')) && existsSync(join(dir, 'frames'))) {
      const plan = JSON.parse(await fs.readFile(join(dir, 'plan.json'), 'utf8'));
      const names = (await fs.readdir(join(dir, 'frames'))).filter((file) => file.endsWith('.png')).sort();
      const job = { folder, talk: saved.talk, output: record.output, status: 'composing', progress: 0, error: null, dir, frames: names.map((file) => ({ n: Number(file.slice(0, 6)), t: Number(file.slice(7, -4)), file: join(dir, 'frames', file) })), process: null, url: saved.url, fps: saved.fps, width: saved.width };
      jobs.set(key, job);
      void compose(job, plan);
      continue;
    }
    if (saved.url) pages.push({ talk: saved.talk, output: record.output, url: saved.url });
    else await fs.rm(jobFile(folder, record.output), { force: true });
  }
  return pages;
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

/**
 * Serve the render endpoints. `roots` are the folders whose decks may be rendered; `openPage`,
 * when given (the desktop app), opens a render page's URL in a window of its own and resolves
 * once it is closed, so that the page need not be opened by the browser.
 */
export function renderStore({ roots = [], openPage = null } = {}) {
  return {
    name: 'zoomdeck-render',
    configureServer(server) {
      server.middlewares.use('/__zoomdeck/render', async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const folder = deckFolderFor(url.searchParams.get('deck') ?? '', roots.length ? roots : [server.config.root], server.config.root);
        try {
          if (!folder) {
            reply(response, 400, { ok: false, error: 'The deck is not served from here' });
            return;
          }
          const target = join(folder, FOLDER);
          const talk = url.searchParams.get('name') ?? '';
          const output = url.searchParams.get('as') ?? '';
          if (request.method === 'GET') {
            const all = await listJobs(target);
            reply(response, 200, { ok: true, ffmpeg: Boolean(findFfmpeg()), desktop: Boolean(openPage), jobs: talk ? all.filter((job) => job.talk === talk) : all });
            return;
          }
          if (request.method !== 'POST') {
            reply(response, 405, { ok: false, error: 'Method not allowed' });
            return;
          }
          const op = url.searchParams.get('op') ?? '';
          if (!NAME.test(output)) {
            reply(response, 400, { ok: false, error: 'Invalid video name' });
            return;
          }
          if (op === 'start') {
            if (!NAME.test(talk)) throw new Error('Invalid recording name');
            const page = url.searchParams.get('url') ?? '';
            if (!openPage) {
              reply(response, 200, { ok: true, started: false });
              return;
            }
            const job = await openJob(target, talk, output, { url: page });
            job.status = 'queued';
            await persist(job);
            void openPage(page, { folder: target, talk, output }).catch((error) => {
              job.status = 'failed';
              job.error = error.message;
              void persist(job);
            });
            reply(response, 200, { ok: true, started: true });
            return;
          }
          if (op === 'open') {
            if (!NAME.test(talk)) throw new Error('Invalid recording name');
            const key = join(target, output);
            const queued = jobs.get(key);
            // The desktop app queued the job when it opened the page; the page now takes it over.
            const job = queued && queued.status === 'queued' ? queued : await openJob(target, talk, output, { url: url.searchParams.get('url') ?? queued?.url ?? null });
            job.status = 'rendering';
            job.progress = 0;
            await persist(job);
            reply(response, 200, { ok: true });
            return;
          }
          const job = jobs.get(join(target, output));
          if (!job) {
            reply(response, 409, { ok: false, error: 'This video is not being rendered here (the server may have restarted)' });
            return;
          }
          if (op === 'frame') {
            const n = Number(url.searchParams.get('n'));
            const t = Number(url.searchParams.get('t'));
            if (!Number.isInteger(n) || n < 0 || !Number.isFinite(t)) throw new Error('A frame needs its number and time');
            const file = join(job.dir, 'frames', `${String(n).padStart(6, '0')}-${Math.round(t)}.png`);
            await fs.writeFile(file, await readBody(request, 64 * 1024 * 1024));
            job.frames.push({ n, t, file });
            reply(response, 200, { ok: true });
            return;
          }
          if (op === 'progress') {
            job.progress = Math.max(0, Math.min(1, Number(url.searchParams.get('value')) || 0));
            await persist(job);
            reply(response, 200, { ok: true });
            return;
          }
          if (op === 'finish') {
            const plan = JSON.parse((await readBody(request, 16 * 1024 * 1024)).toString('utf8'));
            if (!plan || !Array.isArray(plan.media) || !(plan.fps > 0) || !(plan.width > 0) || !(plan.height > 0)) throw new Error('Not a render plan');
            // A slide's video is a file this server shows: its URL leads to a path inside the served roots, or nowhere.
            const allowed = (roots.length ? roots : [server.config.root]).map((candidate) => slashes(resolve(candidate)));
            job.resolve = (src) => {
              const path = documentPath(src, server.config.root);
              if (!path) return null;
              const normal = slashes(path);
              return allowed.some((candidate) => normal === candidate || normal.startsWith(`${candidate}/`)) ? normal.split('/').join(sep) : null;
            };
            void compose(job, plan);
            reply(response, 200, { ok: true });
            return;
          }
          if (op === 'cancel') {
            if (job.process) job.process.kill();
            jobs.delete(join(target, output));
            await fs.rm(job.dir, { recursive: true, force: true });
            await fs.rm(jobFile(target, output), { force: true });
            reply(response, 200, { ok: true });
            return;
          }
          reply(response, 400, { ok: false, error: 'Unknown operation' });
        } catch (error) {
          reply(response, 400, { ok: false, error: error.message });
        }
      });
    },
  };
}
