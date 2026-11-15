import { describe, expect, it } from 'vitest';
import { cameraIntervals, displayWidth, installVirtualClock, renderPlan } from '../src/player/render';
import type { Timeline } from '../src/player/timeline';
import { concatList, ffmpegArguments, splitInterval } from '../bin/render.mjs';

describe('the virtual clock', () => {
  it('stands still, fires timers in order at their own times and frames at the target, then goes away', async () => {
    const realNow = performance.now;
    const clock = installVirtualClock();
    try {
      expect(performance.now()).toBe(0);
      const log: string[] = [];
      setTimeout(() => log.push(`a@${performance.now()}`), 50);
      setTimeout(() => {
        log.push(`b@${performance.now()}`);
        // A timer set by a timer lands after it, at its own time, within the same advance.
        setTimeout(() => log.push(`c@${performance.now()}`), 5);
      }, 20);
      const interval = setInterval(() => log.push(`i@${performance.now()}`), 30);
      requestAnimationFrame((t) => log.push(`f@${t}`));
      const cancelled = setTimeout(() => log.push('never'), 10);
      clearTimeout(cancelled);
      await clock.advanceTo(60);
      expect(log).toEqual(['b@20', 'c@25', 'i@30', 'a@50', 'i@60', 'f@60']);
      expect(performance.now()).toBe(60);
      clearInterval(interval);
      let resolved = false;
      void Promise.resolve().then(() => { resolved = true; });
      await clock.advanceTo(100);
      // Promise chains settle during an advance; the interval is gone.
      expect(resolved).toBe(true);
      expect(log.length).toBe(6);
      expect(Date.now()).toBeGreaterThan(0);
    } finally {
      clock.uninstall();
    }
    // The real clock is back: it reads real time again and moves on its own.
    expect(performance.now()).toBeGreaterThan(100);
    const before = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(performance.now()).toBeGreaterThan(before);
    expect(typeof realNow).toBe('function');
  });
});

describe('render plans', () => {
  const timeline: Timeline = {
    version: 1, deck: { title: 'T', hash: 'h' }, recorded: '2026-11-15T09:00:00.000Z', duration: 10_000,
    media: [
      { file: 'a.webm', type: 'audio/webm', video: false, start: 0, duration: 2000 },
      { file: 'a.part2.webm', type: 'video/webm', video: true, start: 2000, duration: 5000 },
      { file: 'a.part3.webm', type: 'video/webm', video: true, source: 'screen', start: 7000, duration: 3000 },
    ],
    pip: { corner: 'top-left', size: 0.25 },
    events: [{ t: 0, type: 'go', stop: { key: 'markup:root', step: 0 }, autoplay: false }, { t: 3000, type: 'camera', on: true }, { t: 4000, type: 'camera', on: false }, { t: 6500, type: 'camera', on: true }],
  };

  it('takes the display\'s width as the default, even and within bounds', () => {
    const width = displayWidth();
    expect(width % 2).toBe(0);
    expect(width).toBeGreaterThanOrEqual(1280);
    expect(width).toBeLessThanOrEqual(3840);
  });

  it('lists when the camera fills the frame', () => {
    expect(cameraIntervals(timeline.events, 10_000)).toEqual([[3000, 4000], [6500, 10_000]]);
    expect(cameraIntervals([], 10_000)).toEqual([]);
    expect(cameraIntervals([{ t: 100, type: 'camera', on: false }, { t: 200, type: 'camera', on: true }, { t: 200, type: 'camera', on: false }], 500)).toEqual([]);
  });

  it('describes the frames and the media for the server', () => {
    const plan = renderPlan(timeline, 16 / 9, 1920, 30);
    expect(plan).toEqual({
      fps: 30, width: 1920, height: 1080, duration: 10_000, pip: { corner: 'top-left', size: 0.25 },
      media: [
        { file: 'a.webm', start: 0, duration: 2000, video: false, source: 'camera' },
        { file: 'a.part2.webm', start: 2000, duration: 5000, video: true, source: 'camera' },
        { file: 'a.part3.webm', start: 7000, duration: 3000, video: true, source: 'screen' },
      ],
      full: [[3000, 4000], [6500, 10_000]],
    });
    // The height is even, as the encoder wants, whatever the proportions.
    expect(renderPlan(timeline, 4 / 3, 1000, 30).height).toBe(750);
    expect(renderPlan(timeline, 16 / 10, 1000, 30).height % 2).toBe(0);
  });

  it('splits a media file\'s stretch into the parts inside and outside the full-frame intervals', () => {
    expect(splitInterval(2000, 7000, [[3000, 4000], [6500, 10_000]])).toEqual({ inside: [[3000, 4000], [6500, 7000]], outside: [[2000, 3000], [4000, 6500]] });
    expect(splitInterval(0, 2000, [[3000, 4000]])).toEqual({ inside: [], outside: [[0, 2000]] });
    expect(splitInterval(3000, 4000, [[2000, 5000]])).toEqual({ inside: [[3000, 4000]], outside: [] });
  });

  it('writes the concat list with each frame shown until the next, and the ffmpeg command that composes the video', () => {
    const list = concatList([{ n: 1, t: 33, file: '/f/000001-33.png' }, { n: 0, t: 0, file: "/f/0'0.png" }, { n: 2, t: 2000, file: '/f/000002-2000.png' }], 10_000, 30);
    expect(list).toBe("ffconcat version 1.0\nfile '/f/0'\\''0.png'\nduration 0.033\nfile '/f/000001-33.png'\nduration 1.967\nfile '/f/000002-2000.png'\nduration 8.000\nfile '/f/000002-2000.png'\n");
    const plan = renderPlan(timeline, 16 / 9, 1920, 30);
    const args = ffmpegArguments(plan, '/w/frames.txt', plan.media.map((part, index) => ({ ...part, path: `/w/${part.file}`, audio: index !== 1 })), '/w/video.mp4');
    expect(args.slice(0, 15)).toEqual(['-y', '-v', 'error', '-stats', '-f', 'concat', '-safe', '0', '-i', '/w/frames.txt', '-i', '/w/a.webm', '-i', '/w/a.part2.webm', '-i', '/w/a.part3.webm'].slice(0, 15));
    const graph = args[args.indexOf('-filter_complex') + 1];
    const filters = graph.split(';');
    expect(filters[0]).toBe('[0:v]fps=30,format=rgba[deck]');
    // The camera part, split between its corner and the full frame by the camera intervals, at the top-left corner, a quarter wide.
    expect(graph).toContain('[2:v]setpts=PTS-STARTPTS+2.000/TB,fps=30[v0]');
    expect(graph).toContain('scale=480:-2');
    expect(graph).toContain("overlay=29:29:eof_action=pass:enable='between(t,2.000,3.000)+between(t,4.000,6.500)'");
    expect(graph).toContain("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080");
    expect(graph).toContain("overlay=0:0:eof_action=pass:enable='between(t,3.000,4.000)+between(t,6.500,7.000)'");
    // The screen part, fitted whole on black for its own stretch.
    expect(graph).toContain('[3:v]setpts=PTS-STARTPTS+7.000/TB,fps=30');
    expect(graph).toContain('scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black');
    expect(graph).toContain("enable='between(t,7.000,10.000)'");
    // The sound: the parts with a sound track, each delayed to its start, mixed; the silent one left out.
    expect(graph).toContain('[1:a]aresample=48000,adelay=0:all=1[a0]');
    expect(graph).toContain('[3:a]aresample=48000,adelay=7000:all=1[a1]');
    expect(graph).toContain('[a0][a1]amix=inputs=2:duration=longest:normalize=0[aout]');
    expect(graph.endsWith('[vout]') || graph.includes('format=yuv420p[vout]')).toBe(true);
    expect(args).toEqual(expect.arrayContaining(['-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-c:a', 'aac', '-t', '10.000', '/w/video.mp4']));
    // One sound track is mapped as it is; none means no sound at all.
    const one = ffmpegArguments(plan, '/w/frames.txt', plan.media.map((part, index) => ({ ...part, path: `/w/${part.file}`, audio: index === 0 })), '/w/v.mp4');
    expect(one).toEqual(expect.arrayContaining(['-map', '[a0]']));
    expect(one.join(' ')).not.toContain('amix');
    const silent = ffmpegArguments(plan, '/w/frames.txt', plan.media.map((part) => ({ ...part, path: `/w/${part.file}`, audio: false })), '/w/v.mp4');
    expect(silent.join(' ')).not.toContain('-c:a');
    expect(silent.filter((arg) => arg === '-map')).toHaveLength(1);
  });
});
