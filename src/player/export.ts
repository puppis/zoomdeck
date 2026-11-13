/**
 * Exporting a recorded talk as a video: the recording plays in the page while every frame of
 * what a viewer sees (slides or whiteboard with their ink, the camera picture in a corner or
 * full frame, the spotlight or laser) is drawn on a canvas and captured, with the recorded
 * sound, into a WebM file. This runs in real time, as long as the talk; the timeline would
 * also allow rendering frame by frame off the clock, which a later version can add.
 */
import { strokeOutline, type InkStroke, type PenStyle } from './ink';
import type { Playback } from './playback';
import type { InkSurfaceName } from './pad';
import type { Corner } from './timeline';

/** What the export draws from, supplied by the player interface. */
export interface ExportSource {
  /** Deck viewport proportions, width over height. */
  aspect: number;
  background: string;
  foreground: string;
  penStyle: () => PenStyle;
  strokes: (surface: InkSurfaceName) => InkStroke[];
  /** The WebGL canvas and the device-pixel rectangle of the deck viewport inside it, freshly rendered. */
  stage: () => { canvas: HTMLCanvasElement; sx: number; sy: number; sw: number; sh: number } | null;
  /** The recording's picture, when it has one. */
  camera: HTMLVideoElement | null;
  mirror: boolean;
  pip: { corner: Corner; size: number };
}

export interface ExportOptions {
  /** Frame width in pixels; the height follows the deck's proportions. */
  width?: number;
  fps?: number;
  /** Called with the share of the talk rendered so far. */
  onProgress?: (fraction: number) => void;
}

/** The media type the export writes, or null when the browser cannot record video. */
export function exportMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

const audioNodes = new WeakMap<HTMLMediaElement, { context: AudioContext; destination: MediaStreamAudioDestinationNode }>();

/** The sound of a media element as a stream, keeping it audible; an element can be tapped only once, so the tap is kept. */
function audioTrackOf(media: HTMLMediaElement): MediaStreamTrack | null {
  let nodes = audioNodes.get(media);
  if (!nodes) {
    const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    const context = new AudioContextClass();
    const source = context.createMediaElementSource(media);
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    source.connect(context.destination);
    nodes = { context, destination };
    audioNodes.set(media, nodes);
  }
  void nodes.context.resume();
  return nodes.destination.stream.getAudioTracks()[0] ?? null;
}

/** Draw one frame of the talk as a viewer sees it. */
export function drawFrame(context: CanvasRenderingContext2D, width: number, height: number, source: ExportSource, state: Playback['state']): void {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = source.background;
  context.fillRect(0, 0, width, height);
  const camera = source.camera;
  const cameraReady = camera !== null && camera.videoWidth > 0;
  if (state.camera && cameraReady) {
    drawVideo(context, camera as HTMLVideoElement, 0, 0, width, height, source.mirror);
    return;
  }
  // Surface units: the deck viewport is 1000 units tall, centered.
  const k = height / 1000;
  if (state.board) {
    drawBoard(context, width, height, k, state.pan, source.foreground);
    drawStrokes(context, source.strokes('board'), source.penStyle(), k, width, height, state.pan);
  } else {
    const stage = source.stage();
    if (stage && stage.sw > 0 && stage.sh > 0) {
      try {
        context.drawImage(stage.canvas, stage.sx, stage.sy, stage.sw, stage.sh, 0, 0, width, height);
      } catch {
        /* a lost context: the frame stays blank */
      }
    }
    drawStrokes(context, source.strokes('slide'), source.penStyle(), k, width, height, { x: 0, y: 0 });
  }
  if (state.pointer) drawPointer(context, width, height, k, state.pointer);
  if (cameraReady) {
    const w = Math.round(width * source.pip.size);
    const h = Math.round((w * (camera as HTMLVideoElement).videoHeight) / (camera as HTMLVideoElement).videoWidth);
    const margin = Math.round(width * 0.015);
    const x = source.pip.corner.endsWith('right') ? width - w - margin : margin;
    const y = source.pip.corner.startsWith('bottom') ? height - h - margin : margin;
    drawVideo(context, camera as HTMLVideoElement, x, y, w, h, source.mirror);
  }
}

function drawVideo(context: CanvasRenderingContext2D, video: HTMLVideoElement, x: number, y: number, w: number, h: number, mirror: boolean): void {
  // Cover the box, cropping the picture rather than letterboxing it.
  const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (video.videoWidth - sw) / 2;
  const sy = (video.videoHeight - sh) / 2;
  context.save();
  if (mirror) {
    context.translate(x + w, y);
    context.scale(-1, 1);
    context.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
  } else {
    context.drawImage(video, sx, sy, sw, sh, x, y, w, h);
  }
  context.restore();
}

function drawBoard(context: CanvasRenderingContext2D, width: number, height: number, k: number, pan: { x: number; y: number }, foreground: string): void {
  const cell = 50 * k;
  context.save();
  context.globalAlpha = 0.22;
  context.fillStyle = foreground;
  const offsetX = ((width / 2 - pan.x * k) % cell + cell) % cell;
  const offsetY = ((height / 2 - pan.y * k) % cell + cell) % cell;
  for (let y = offsetY; y < height; y += cell) {
    for (let x = offsetX; x < width; x += cell) {
      context.beginPath();
      context.arc(x, y, 1.2, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}

function drawStrokes(context: CanvasRenderingContext2D, strokes: InkStroke[], style: PenStyle, k: number, width: number, height: number, pan: { x: number; y: number }): void {
  context.save();
  context.setTransform(k, 0, 0, k, width / 2 - pan.x * k, height / 2 - pan.y * k);
  for (const stroke of strokes) {
    const d = strokeOutline(stroke, style);
    if (!d) continue;
    context.globalAlpha = stroke.tool === 'highlighter' ? 0.4 : 1;
    context.fillStyle = stroke.color;
    context.fill(new Path2D(d));
  }
  context.restore();
}

function drawPointer(context: CanvasRenderingContext2D, width: number, height: number, k: number, pointer: { mode: 'spotlight' | 'laser'; x: number; y: number; r: number }): void {
  const x = width / 2 + pointer.x * k;
  const y = height / 2 + pointer.y * k;
  const r = pointer.r * k;
  context.save();
  if (pointer.mode === 'spotlight') {
    const gradient = context.createRadialGradient(x, y, Math.max(0, r - 12 * k), x, y, r);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.68)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = 'rgba(0,0,0,0.68)';
    context.beginPath();
    context.rect(0, 0, width, height);
    context.arc(x, y, r, 0, Math.PI * 2, true);
    context.fill('evenodd');
  } else {
    const dot = r / 6;
    const gradient = context.createRadialGradient(x, y, 0, x, y, dot);
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(0.12, '#ffb5b5');
    gradient.addColorStop(0.3, '#ff2020');
    gradient.addColorStop(0.52, 'rgba(255,32,32,.55)');
    gradient.addColorStop(0.65, 'rgba(255,32,32,.2)');
    gradient.addColorStop(0.75, 'rgba(255,32,32,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, dot, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

/**
 * Play the recording from the start while capturing it, and resolve with the video file.
 * The page must stay visible: a background tab gets no animation frames.
 */
export function exportVideo(playback: Playback, source: ExportSource, options: ExportOptions = {}): Promise<Blob> {
  const type = exportMimeType();
  if (!type) return Promise.reject(new Error('This browser cannot record video'));
  const width = options.width ?? 1920;
  const height = Math.round(width / source.aspect / 2) * 2;
  const fps = options.fps ?? 30;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('No drawing context'));
  const stream = canvas.captureStream(fps);
  const media = source.camera;
  if (media && media.src) {
    const track = audioTrackOf(media);
    if (track) stream.addTrack(track);
  }
  return new Promise<Blob>((resolve, reject) => {
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener('error', () => reject(new Error('The video could not be written')));
    let timer: number | null = null;
    const finish = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      playback.pause();
      if (recorder.state === 'inactive') return;
      recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type })), { once: true });
      // A last frame with the final state, then stop.
      drawFrame(context, width, height, source, playback.state);
      setTimeout(() => recorder.stop(), 200);
    };
    const draw = () => {
      drawFrame(context, width, height, source, playback.state);
      options.onProgress?.(playback.duration ? playback.time / playback.duration : 1);
      if (!playback.playing && (playback.ended || playback.time >= playback.duration)) finish();
    };
    playback.seek(0);
    recorder.start(1000);
    void playback.play().then(() => {
      if (!playback.playing) {
        reject(new Error('The recording could not be played'));
        recorder.stop();
        return;
      }
      // A timer rather than animation frames: it keeps drawing at the chosen rate wherever the tab is painted.
      timer = window.setInterval(draw, Math.round(1000 / fps));
    });
  });
}
