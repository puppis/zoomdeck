import { describe, expect, it } from 'vitest';
import { cameraIntervals, cornerHiddenIntervals, ClipLog, displayWidth, frameAspect, frameSize, installVirtualClock, renderPlan, subtractIntervals, videoWidthFor } from '../src/player/render';
import { aspectName, presentedAspect } from '../src/player/timeline';
import type { Timeline } from '../src/player/timeline';
import { clipsToMix, concatList, ffmpegArguments, splitInterval } from '../bin/render.mjs';

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

  it('sizes a frame by its height in the deck\'s proportions, and knows the display\'s own width', () => {
    expect(videoWidthFor(1080, 16 / 9)).toBe(1920);
    expect(videoWidthFor(1080, 4 / 3)).toBe(1440);
    expect(videoWidthFor(1440, 16 / 10)).toBe(2304);
    expect(videoWidthFor(2160, 16 / 9)).toBe(3840);
    const width = displayWidth();
    expect(width % 2).toBe(0);
    expect(width).toBeGreaterThanOrEqual(1280);
    expect(width).toBeLessThanOrEqual(3840);
  });

  it('takes the proportions the deck was presented in, the deck\'s own or 16:9, and names them', () => {
    const presented: Timeline = { ...timeline, events: [{ t: 0, type: 'stage', aspect: 1.6 }, { t: 2000, type: 'stage', aspect: 4 / 3 }, { t: 9000, type: 'stage', aspect: 1.6 }] };
    // The window was 4:3 for seven of the ten seconds.
    expect(presentedAspect(presented.events, 10_000)).toBe(1.333);
    expect(presentedAspect(timeline.events, 10_000)).toBeNull();
    expect(frameAspect('presented', presented, 16 / 9)).toBe(1.333);
    expect(frameAspect('presented', timeline, 16 / 9)).toBe(16 / 9);
    expect(frameAspect('deck', presented, 4 / 3)).toBe(4 / 3);
    expect(frameAspect('wide', presented, 4 / 3)).toBe(16 / 9);
    expect(frameSize(1080, 16 / 9)).toEqual({ width: 1920, height: 1080 });
    expect(frameSize(1080, 1.333)).toEqual({ width: 1440, height: 1080 });
    expect(frameSize('display', 16 / 9).width).toBe(displayWidth());
    expect([aspectName(16 / 9), aspectName(1.6), aspectName(1.333), aspectName(2)]).toEqual(['16:9', '16:10', '4:3', '2.00:1']);
  });

  it('keeps the camera out of the frame while the screen is filmed, and lays the screen under it', () => {
    expect(subtractIntervals([[0, 10], [20, 30]], [[5, 25]])).toEqual([[0, 5], [25, 30]]);
    expect(subtractIntervals([[0, 10]], [[2, 3], [4, 5]])).toEqual([[0, 2], [3, 4], [5, 10]]);
    expect(subtractIntervals([[0, 10]], [])).toEqual([[0, 10]]);
    const lanes: Timeline = {
      ...timeline,
      media: [
        { file: 'a.webm', type: 'video/webm', video: true, start: 0, duration: 10_000 },
        { file: 'a.part2.webm', type: 'video/webm', video: true, source: 'screen', lane: 'screen', start: 3500, duration: 3000 },
      ],
    };
    const plan = renderPlan(lanes, 16 / 9, 1920, 30);
    // The camera filled the frame from 3000 to 4000 and from 6500 on; the screen had the frame from 3500 to 6500.
    expect(plan.full).toEqual([[3000, 3500], [6500, 10_000]]);
    const args = ffmpegArguments(plan, '/w/f.txt', plan.media.map((part) => ({ ...part, path: `/w/${part.file}`, audio: !part.source })), '/w/v.mp4');
    const graph = args[args.indexOf('-filter_complex') + 1];
    // The screen part, second in the plan, is laid first; the camera's corner and full frame come after, over it.
    expect(graph.indexOf('[2:v]setpts')).toBeLessThan(graph.indexOf('[1:v]setpts'));
    expect(graph).toContain("enable='between(t,3.500,6.500)'");
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
      // The camera filled the frame from 3000 to 4000 and from 6500 on, but the screen had the frame from 7000.
      full: [[3000, 4000], [6500, 7000]],
      cornerHidden: [],
      clips: [],
    });
    // The height is even, as the encoder wants, whatever the proportions.
    expect(renderPlan(timeline, 4 / 3, 1000, 30).height).toBe(750);
    expect(renderPlan(timeline, 16 / 10, 1000, 30).height % 2).toBe(0);
  });

  it('logs the stretches the slides\' videos played with sound, loops and all, and closes them at the end', () => {
    const log = new ClipLog();
    const loud = {};
    const quiet = {};
    log.played(loud, { src: 'http://h/deck/clip.mp4', start: 1000, muted: false });
    log.played(quiet, { src: 'http://h/deck/silent.mp4', start: 1200, muted: true });
    log.stopped(loud, 3000);
    log.stopped(quiet, 3000);
    // A loop: the same clip again and again, each cycle a stretch of its own; a stretch too short to hear is dropped.
    log.played(loud, { src: 'http://h/deck/clip.mp4', start: 3000, muted: false });
    log.stopped(loud, 5000);
    log.played(loud, { src: 'http://h/deck/clip.mp4', start: 5000, muted: false });
    log.stopped(loud, 5020);
    log.played(loud, { src: 'http://h/deck/clip.mp4', start: 6000, muted: false });
    expect(log.finish(8000)).toEqual([
      { src: 'http://h/deck/clip.mp4', start: 1000, duration: 2000 },
      { src: 'http://h/deck/clip.mp4', start: 3000, duration: 2000 },
      { src: 'http://h/deck/clip.mp4', start: 6000, duration: 2000 },
    ]);
    const plan = renderPlan(timeline, 16 / 9, 1920, 30, log.clips);
    expect(plan.clips).toHaveLength(3);
    const args = ffmpegArguments(plan, '/w/frames.txt', plan.media.map((part) => ({ ...part, path: `/w/${part.file}`, audio: true })), '/w/v.mp4', [{ path: '/d/clip.mp4', start: 1000, duration: 2000 }]);
    expect(args.slice(10, 22)).toEqual(['-reinit_filter', '0', '-i', '/w/a.webm', '-reinit_filter', '0', '-i', '/w/a.part2.webm', '-reinit_filter', '0', '-i', '/w/a.part3.webm', '-reinit_filter', '0', '-i', '/d/clip.mp4'].slice(0, 12));
    expect(args.filter((arg, index) => args[index - 1] === '-i')).toEqual(['/w/frames.txt', '/w/a.webm', '/w/a.part2.webm', '/w/a.part3.webm', '/d/clip.mp4']);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('[4:a]atrim=0:2.000,asetpts=PTS-STARTPTS,aresample=48000,adelay=1000:all=1[a3]');
    expect(graph).toContain('[a0][a1][a2][a3]amix=inputs=4');
  });

  it('leaves out of the mix the slide videos whose sound the system lane recorded already', () => {
    const clips = [{ path: '/d/a.mp4', start: 1000, duration: 2000 }, { path: '/d/b.mp4', start: 5000, duration: 1000 }, { path: '/d/c.mp4', start: 8000, duration: 500 }];
    const media = [
      { file: 'a.webm', start: 0, duration: 9000, video: false, source: 'camera' as const },
      { file: 'a.part2.webm', start: 4000, duration: 3000, video: false, source: 'camera' as const, lane: 'system' as const },
    ];
    expect(clipsToMix({ media }, clips).map((clip) => clip.path)).toEqual(['/d/a.mp4', '/d/c.mp4']);
    expect(clipsToMix({ media: media.slice(0, 1) }, clips)).toHaveLength(3);
    // A system-lane part is an ordinary sound input of the graph, delayed to its place.
    const plan = renderPlan({ ...timeline, media: [{ file: 'a.webm', type: 'audio/webm', video: false, start: 0, duration: 9000 }, { file: 'a.part2.webm', type: 'audio/webm', video: false, lane: 'system', start: 4000, duration: 3000 }] }, 16 / 9, 1920, 30);
    expect(plan.media[1].lane).toBe('system');
    const args = ffmpegArguments(plan, '/w/frames.txt', plan.media.map((part) => ({ ...part, path: `/w/${part.file}`, audio: true })), '/w/v.mp4');
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('[2:a]aresample=48000,adelay=4000:all=1[a1]');
    expect(graph).toContain('[a0][a1]amix=inputs=2');
  });

  it('leaves the corner picture out while the presenter\'s pointer set it aside, and never leaves a split output unused', () => {
    const events: Timeline['events'] = [{ t: 2500, type: 'corner', hidden: true }, { t: 2800, type: 'corner', hidden: false }, { t: 5000, type: 'corner', hidden: true }];
    expect(cornerHiddenIntervals(events, 10_000)).toEqual([[2500, 2800], [5000, 10_000]]);
    expect(cornerHiddenIntervals([], 10_000)).toEqual([]);
    // The filmed screen showing the camera's floating window leaves the corner picture out too, joined with the pointer's stretches.
    const inScreen: Timeline['events'] = [{ t: 1000, type: 'camera-in-screen', on: true }, { t: 1500, type: 'corner', hidden: true }, { t: 3000, type: 'camera-in-screen', on: false }, { t: 3200, type: 'corner', hidden: false }, { t: 8000, type: 'camera-in-screen', on: true }];
    expect(cornerHiddenIntervals(inScreen, 10_000)).toEqual([[1000, 3200], [8000, 10_000]]);
    const plan = renderPlan({ ...timeline, events: [...timeline.events, ...events].sort((a, b) => a.t - b.t) }, 16 / 9, 1920, 30);
    expect(plan.cornerHidden).toEqual([[2500, 2800], [5000, 10_000]]);
    const graph = (p: typeof plan) => {
      const args = ffmpegArguments(p, '/w/frames.txt', p.media.map((part) => ({ ...part, path: `/w/${part.file}`, audio: false })), '/w/v.mp4');
      return args[args.indexOf('-filter_complex') + 1];
    };
    // The camera's corner stretches were 2.0 to 3.0 and 4.0 to 6.5 seconds; the pointer took 2.5 to 2.8 and everything from 5.0.
    expect(graph(plan)).toContain("overlay=29:29:eof_action=repeat:enable='between(t,2.000,2.500)+between(t,2.800,3.000)+between(t,4.000,5.000)'");
    // All of a part's corner time set aside: no corner overlay for it, and no split left with an output nobody takes.
    const hiddenAll = { ...plan, cornerHidden: [[0, 10_000]] as Array<[number, number]> };
    const all = graph(hiddenAll);
    expect(all).not.toContain('split');
    expect(all).not.toContain('scale=480:-2');
    expect(all).toContain("overlay=0:0:eof_action=repeat:enable='between(t,3.000,4.000)+between(t,6.500,7.000)'");
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
    // The deck frames first; every recorded file keeps the graph as it is when its pictures change midway (no rebuild, which would lose the deck frames read already).
    expect(args.slice(0, 14)).toEqual(['-y', '-v', 'error', '-stats', '-f', 'concat', '-safe', '0', '-i', '/w/frames.txt', '-reinit_filter', '0', '-i', '/w/a.webm']);
    const graph = args[args.indexOf('-filter_complex') + 1];
    const filters = graph.split(';');
    expect(filters[0]).toBe('[0:v]fps=30,format=rgba[deck]');
    // The camera part, split between its corner and the full frame by the camera intervals, at the top-left corner, a quarter wide.
    expect(graph).toContain('[2:v]setpts=PTS-STARTPTS+2.000/TB,fps=30');
    expect(graph).toContain('scale=480:-2');
    expect(graph).toContain("overlay=29:29:eof_action=repeat:enable='between(t,2.000,3.000)+between(t,4.000,6.500)'");
    expect(graph).toContain("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080");
    expect(graph).toContain("overlay=0:0:eof_action=repeat:enable='between(t,3.000,4.000)+between(t,6.500,7.000)'");
    // The screen part, fitted whole on black for its own stretch, laid before the camera whatever its place in the plan.
    expect(graph).toContain('[3:v]setpts=PTS-STARTPTS+7.000/TB,fps=30');
    expect(graph.indexOf('[3:v]setpts')).toBeLessThan(graph.indexOf('[2:v]setpts'));
    // Fitted and centered on black frame by frame, so that a window resized while shared stays so.
    expect(graph).toContain('scale=1920:1080:force_original_aspect_ratio=decrease:eval=frame');
    expect(graph).toContain('color=c=black:s=1920x1080:r=30');
    expect(graph).toContain('overlay=x=(W-w)/2:y=(H-h)/2:eval=frame:eof_action=repeat');
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
