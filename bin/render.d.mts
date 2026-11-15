import type { Plugin } from 'vite';

/** A render job as the server reports it. */
export interface RenderJobRecord {
  talk: string;
  output: string;
  status: 'queued' | 'rendering' | 'composing' | 'done' | 'failed' | 'interrupted';
  progress: number;
  error?: string;
  file?: string;
}

/** The page's plan for composing a talk's video (src/player/render.ts). */
export interface RenderPlan {
  fps: number;
  width: number;
  height: number;
  duration: number;
  pip: { corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; size: number };
  media: Array<{ file: string; start: number; duration: number; video: boolean; source: 'camera' | 'screen' }>;
  full: Array<[number, number]>;
  /** The slides' own videos that played with sound: their URLs and stretches. */
  clips?: Array<{ src: string; start: number; duration: number }>;
}

/** The ffmpeg executable, or null when there is none. */
export function findFfmpeg(): string | null;
/** The parts of `[from, to]` inside the intervals, and the parts outside them. */
export function splitInterval(from: number, to: number, intervals: Array<[number, number]>): { inside: Array<[number, number]>; outside: Array<[number, number]> };
/** The concat list for the deck frames. */
export function concatList(frames: Array<{ n: number; t: number; file: string }>, duration: number, fps: number): string;
/** The ffmpeg arguments that compose the video. */
/** The slide videos whose sound comes from their files: those not covered by a system-lane part of the plan. */
export function clipsToMix<T extends { start: number }>(plan: { media?: Array<{ start: number; duration: number; lane?: string }> }, clips: T[]): T[];
export function ffmpegArguments(plan: RenderPlan, frames: string, parts: Array<RenderPlan['media'][number] & { path: string; audio: boolean }>, output: string, clips?: Array<{ path: string; start: number; duration: number }>): string[];
/** The jobs of a recordings folder, live and recorded. */
export function listJobs(folder: string): Promise<RenderJobRecord[]>;
/** Take up interrupted renders; resolves with the pages to open again. */
export function resumeRenders(folder: string): Promise<Array<{ talk: string; output: string; url: string }>>;
/** Serves the render endpoints. */
export function renderStore(options?: { roots?: string[]; openPage?: ((url: string, job: { folder: string; talk: string; output: string }) => Promise<void>) | null }): Plugin;
