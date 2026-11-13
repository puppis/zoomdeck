import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendPart, eventsBetween, formatTime, inkUpTo, isTimeline, mediaAt, recordingName, stateAt, stopIndex, stopRef, structureHash, type Timeline, type TimelineEvent } from '../src/player/timeline';
import { Recorder, initialEvents } from '../src/player/recorder';
import { sanitizeRecording, DEFAULT_RECORDING } from '../src/player/settings';
import { buildIndex, deckFolderFor, isRecordingFile, recordingFiles, NAME } from '../bin/recordings.mjs';
import type { NavigationData } from '../src/runtime';

const navigation: NavigationData = {
  version: 1,
  slides: [
    { id: 0, name: 'root', key: 'markup:root', parent: null, placeholder: false },
    { id: 1, name: 'a', key: 'markup:a', parent: 0, placeholder: false },
    { id: 2, name: 'b', key: 'markup:b', parent: 0, placeholder: false },
  ],
  clips: [
    { slide: 0, kind: 'entry', loop: false, autoNext: false, notes: '', rate: 1, duration: 0 },
    { slide: 1, kind: 'entry', loop: false, autoNext: false, notes: '', rate: 1, duration: 0 },
    { slide: 1, kind: 'program', loop: false, autoNext: false, notes: '', rate: 1, duration: 1 },
    { slide: 1, kind: 'program', loop: false, autoNext: false, notes: '', rate: 1, duration: 1 },
    { slide: 0, kind: 'return', loop: false, autoNext: false, notes: '', rate: 1, duration: 0 },
    { slide: 2, kind: 'entry', loop: false, autoNext: false, notes: '', rate: 1, duration: 0 },
  ],
  startSlide: null,
};

describe('stops by key', () => {
  it('names a clip by its slide and step and finds it again, clamped when the slide shrank', () => {
    expect(stopRef(navigation, 3)).toEqual({ key: 'markup:a', step: 2 });
    expect(stopRef(navigation, 4)).toEqual({ key: 'markup:root', step: 1 });
    expect(stopRef(navigation, 9)).toBeNull();
    expect(stopIndex(navigation, { key: 'markup:a', step: 2 })).toBe(3);
    expect(stopIndex(navigation, { key: 'markup:a', step: 7 })).toBe(3);
    expect(stopIndex(navigation, { key: 'markup:root', step: 1 })).toBe(4);
    expect(stopIndex(navigation, { key: 'markup:gone', step: 0 })).toBeNull();
    const hash = structureHash(navigation);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(structureHash({ ...navigation, clips: navigation.clips.slice(0, 5) })).not.toBe(hash);
  });
});

describe('timelines', () => {
  const events: TimelineEvent[] = [
    { t: 0, type: 'go', stop: { key: 'markup:root', step: 0 }, autoplay: false },
    { t: 1000, type: 'ink', surface: 'slide', op: { op: 'begin', stroke: { id: 's1', tool: 'pen', color: '#000', size: 3, pressure: false, samples: [{ x: 0, y: 0, p: 0.5 }] } } },
    { t: 1100, type: 'ink', surface: 'slide', op: { op: 'end', id: 's1' } },
    { t: 2000, type: 'go', stop: { key: 'markup:a', step: 0 }, autoplay: true },
    { t: 2500, type: 'pointer', mode: 'laser', x: 10, y: -20, r: 90 },
    { t: 3000, type: 'board', on: true },
    { t: 3200, type: 'pan', x: 400, y: 0 },
    { t: 3300, type: 'pointer-off' },
    { t: 4000, type: 'speed', value: 1.5 },
    { t: 4500, type: 'camera', on: true },
    { t: 5000, type: 'rewind', stop: { key: 'markup:root', step: 0 } },
  ];

  it('folds the events before a time into the state a seek must rebuild', () => {
    const early = stateAt(events, 2600);
    expect(early.stop).toEqual({ key: 'markup:a', step: 0 });
    expect(early.animated).toBe(true);
    expect(early.pointer).toEqual({ mode: 'laser', x: 10, y: -20, r: 90 });
    expect(early.board).toBe(false);
    const late = stateAt(events, 5000);
    expect(late.stop).toEqual({ key: 'markup:root', step: 0 });
    expect(late.animated).toBe(false);
    expect(late.board).toBe(true);
    expect(late.pan).toEqual({ x: 400, y: 0 });
    expect(late.pointer).toBeNull();
    expect(late.speed).toBe(1.5);
    expect(late.camera).toBe(true);
    expect(inkUpTo(events, 1050).map((event) => event.op.op)).toEqual(['begin']);
    expect(inkUpTo(events, 9000).length).toBe(2);
    expect(eventsBetween(events, 2000, 3200).map((event) => event.type)).toEqual(['pointer', 'board', 'pan']);
  });

  it('formats times and names recordings', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(61_400)).toBe('1:01');
    expect(recordingName(new Date(2026, 10, 13, 9, 5))).toBe('talk-2026-11-13-0905');
    expect(isTimeline({ version: 1, events: [], duration: 3, deck: { title: 't', hash: 'x' }, media: [] })).toBe(true);
    expect(isTimeline({ version: 2, events: [] })).toBe(false);
  });

  it('appends a part recorded later, shifting its events and keeping its media as a further file', () => {
    const first: Timeline = { version: 1, deck: { title: 't', hash: 'x' }, recorded: '2026-11-13T09:00:00.000Z', duration: 0, media: [], pip: { corner: 'bottom-right', size: 0.25 }, events: [] };
    const one = appendPart(first, { events: [{ t: 0, type: 'board', on: true }, { t: 900, type: 'board', on: false }], duration: 1000, media: { file: 'a.webm', type: 'video/webm', video: true, start: 0, duration: 1000 } });
    expect(one.duration).toBe(1000);
    expect(one.events.map((event) => event.t)).toEqual([0, 900]);
    const two = appendPart(one, { events: [{ t: 0, type: 'camera', on: true }, { t: 400, type: 'camera', on: false }], duration: 500, media: { file: 'a.part2.webm', type: 'video/webm', video: true, start: 0, duration: 500 } });
    expect(two.duration).toBe(1500);
    expect(two.events.map((event) => [event.t, event.type])).toEqual([[0, 'board'], [900, 'board'], [1000, 'cut'], [1000, 'camera'], [1400, 'camera']]);
    expect(two.media.map((part) => [part.file, part.start, part.duration])).toEqual([['a.webm', 0, 1000], ['a.part2.webm', 1000, 500]]);
    expect(mediaAt(two.media, 999)?.file).toBe('a.webm');
    expect(mediaAt(two.media, 1000)?.file).toBe('a.part2.webm');
    expect(mediaAt(two.media, 1500)?.file).toBe('a.part2.webm');
    expect(mediaAt([], 3)).toBeNull();
    // The original is untouched.
    expect(first.events.length).toBe(0);
  });

  it('stamps events on a clock that skips pauses, without any media', async () => {
    const recorder = new Recorder({ stream: null });
    await recorder.start();
    for (const event of initialEvents({ key: 'markup:root', step: 0 }, true, { x: 10, y: 0 }, false, 1)) recorder.mark(event);
    await new Promise((resolve) => setTimeout(resolve, 30));
    recorder.pause();
    const paused = recorder.elapsed;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(recorder.elapsed).toBe(paused);
    recorder.mark({ type: 'board', on: false });
    recorder.resume();
    recorder.mark({ type: 'camera', on: true });
    const result = await recorder.stop();
    const types = result.part.events.map((event) => event.type);
    // The board toggle during the pause is dropped; the cut marks where the gap was.
    expect(types).toEqual(['go', 'board', 'pan', 'cut', 'camera']);
    expect(result.part.duration).toBeGreaterThanOrEqual(30);
    expect(result.part.duration).toBeLessThan(80);
    expect(result.media).toBeNull();
    const camera = result.part.events[4];
    expect(camera.t).toBeGreaterThanOrEqual(result.part.events[3].t);
  });

  it('keeps valid recording settings and drops the rest', () => {
    expect(sanitizeRecording(null)).toEqual(DEFAULT_RECORDING);
    const fixed = sanitizeRecording({ camera: 'none', corner: 'top-left', size: 0.5, mirror: false, microphone: 7 });
    expect(fixed.camera).toBe('none');
    expect(fixed.corner).toBe('top-left');
    expect(fixed.size).toBe(DEFAULT_RECORDING.size);
    expect(fixed.mirror).toBe(false);
    expect(fixed.microphone).toBeNull();
  });
});

describe('the recordings folder', () => {
  let folder: string;
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('indexes the timelines it holds, checks names and keeps the preview from reloading on them', async () => {
    folder = mkdtempSync(join(tmpdir(), 'zoomdeck-rec-'));
    const recordings = join(folder, 'recordings');
    mkdirSync(recordings);
    const timeline: Timeline = { version: 1, deck: { title: 'Deck', hash: 'x' }, recorded: '2026-11-13T09:05:00.000Z', duration: 1234, media: [{ file: 'a.webm', type: 'video/webm', video: true, start: 0, duration: 1234 }], pip: { corner: 'bottom-right', size: 0.25 }, events: [] };
    writeFileSync(join(recordings, 'a.json'), JSON.stringify(timeline));
    writeFileSync(join(recordings, 'a.webm'), 'x');
    writeFileSync(join(recordings, 'notes.json'), '{"not":"a timeline"}');
    const index = await buildIndex(recordings);
    expect(index.recordings).toEqual([{ name: 'a', title: 'Deck', recorded: '2026-11-13T09:05:00.000Z', duration: 1234, media: 'a.webm', video: true, parts: 1 }]);
    expect(recordingFiles('a', ['a.json', 'a.webm', 'a.video.webm', 'ab.json', 'index.json'])).toEqual(['a.json', 'a.webm', 'a.video.webm']);
    expect(NAME.test('talk-2026-11-13-0905')).toBe(true);
    expect(NAME.test('../etc')).toBe(false);
    expect(isRecordingFile(join(folder, 'recordings', 'a.webm'))).toBe(true);
    expect(isRecordingFile(join(folder, 'slides.md'))).toBe(false);
    expect(deckFolderFor(`${folder}/slides.md`, [folder], '/x')).toBe(folder);
    expect(deckFolderFor(`${folder}/`, [folder], '/x')).toBe(folder);
    expect(deckFolderFor('/elsewhere/slides.md', [folder], '/x')).toBeNull();
  });
});
