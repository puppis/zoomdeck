/**
 * Raster images and animated raster playback (APNG, GIF, still images).
 *
 * Frames are decoded on demand and composited sequentially, so a long APNG
 * never has to be held in memory as a complete frame stack. `RasterMovie`
 * changes only the displayed frame of a `RasterImage`, preserving its
 * logical position, size, rotation and updaters.
 */
import * as THREE from 'three';
import { Animation, Mobject, linear, type AnimationOptions } from 'manim-web';
import { parseGIF, decompressFrames } from 'gifuct-js';
import type { SnapshotExtra } from './snapshot';

type FrameSource = CanvasImageSource;

interface ApngFrame {
  width: number;
  height: number;
  x: number;
  y: number;
  delay: number;
  dispose: number;
  blend: number;
  data: Uint8Array[];
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(parts: Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const part of parts) for (let i = 0; i < part.length; i++) crc = CRC_TABLE[(crc ^ part[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32([typeBytes, data]));
  return out;
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, i) => bytes[i] === value);
}

function isGif(bytes: Uint8Array): boolean {
  return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
}

async function decodeBlob(parts: BlobPart[], type: string): Promise<ImageBitmap> {
  return createImageBitmap(new Blob(parts, { type }));
}

/** A decoded raster file: one still frame or an animation decoded sequentially. */
export class RasterSource {
  readonly width: number;
  readonly height: number;
  readonly durations: number[];
  /** Declared play count; zero means the source loops indefinitely. */
  readonly plays: number;
  private readonly _still: ImageBitmap | null;
  private readonly _apng: { header: Uint8Array[]; frames: ApngFrame[] } | null;
  private readonly _gif: ReturnType<typeof decompressFrames> | null;
  private _canvas: HTMLCanvasElement | null = null;
  private _context: CanvasRenderingContext2D | null = null;
  private _cursor = -1;
  private _previous: ImageData | null = null;
  private _previousRect: { x: number; y: number; width: number; height: number } | null = null;
  private readonly _cache = new Map<number, ImageBitmap>();
  private _queue: Promise<unknown> = Promise.resolve();

  private constructor(options: {
    width: number;
    height: number;
    durations: number[];
    plays: number;
    still: ImageBitmap | null;
    apng: { header: Uint8Array[]; frames: ApngFrame[] } | null;
    gif: ReturnType<typeof decompressFrames> | null;
  }) {
    this.width = options.width;
    this.height = options.height;
    this.durations = options.durations;
    this.plays = options.plays;
    this._still = options.still;
    this._apng = options.apng;
    this._gif = options.gif;
  }

  get frameCount(): number {
    return this.durations.length;
  }

  get animated(): boolean {
    return this.durations.length > 1;
  }

  get cycleTime(): number {
    return this.durations.reduce((sum, d) => sum + d, 0);
  }

  /** Fetch and decode a raster file. */
  static async load(url: string): Promise<RasterSource> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Image not found: ${url} (${response.status})`);
    return RasterSource.fromBytes(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type') ?? '');
  }

  static async fromBytes(bytes: Uint8Array, mime = ''): Promise<RasterSource> {
    if (isPng(bytes)) {
      const parsed = RasterSource._parseApng(bytes);
      if (parsed && parsed.frames.length > 1) {
        return new RasterSource({
          width: parsed.width,
          height: parsed.height,
          durations: parsed.frames.map((frame) => frame.delay),
          plays: parsed.plays,
          still: null,
          apng: { header: parsed.header, frames: parsed.frames },
          gif: null,
        });
      }
    } else if (isGif(bytes)) {
      const gif = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      const frames = decompressFrames(gif, true);
      if (frames.length > 1) {
        return new RasterSource({
          width: gif.lsd.width,
          height: gif.lsd.height,
          durations: frames.map((frame) => Math.max(1, frame.delay || 100) / 1000),
          plays: 0,
          still: null,
          apng: null,
          gif: frames,
        });
      }
    }
    const type = mime || (isPng(bytes) ? 'image/png' : isGif(bytes) ? 'image/gif' : 'image/jpeg');
    const still = await decodeBlob([bytes as BlobPart], type);
    return new RasterSource({ width: still.width, height: still.height, durations: [0.1], plays: 1, still, apng: null, gif: null });
  }

  private static _parseApng(bytes: Uint8Array): { width: number; height: number; plays: number; header: Uint8Array[]; frames: ApngFrame[] } | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    let width = 0;
    let height = 0;
    let animated = false;
    let plays = 1;
    const header: Uint8Array[] = [];
    const frames: ApngFrame[] = [];
    let current: ApngFrame | null = null;
    let defaultImageIsFrame = false;
    const defaultData: Uint8Array[] = [];
    while (offset + 8 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      if (type === 'IHDR') {
        width = view.getUint32(offset + 8);
        height = view.getUint32(offset + 12);
        header.push(data.slice());
      } else if (type === 'acTL') {
        animated = true;
        plays = view.getUint32(offset + 12);
      } else if (type === 'fcTL') {
        const frame: ApngFrame = {
          width: view.getUint32(offset + 12),
          height: view.getUint32(offset + 16),
          x: view.getUint32(offset + 20),
          y: view.getUint32(offset + 24),
          delay: 0,
          dispose: bytes[offset + 32],
          blend: bytes[offset + 33],
          data: [],
        };
        const num = view.getUint16(offset + 28);
        const den = view.getUint16(offset + 30) || 100;
        frame.delay = num === 0 ? 0.01 : num / den;
        current = frame;
        frames.push(frame);
        if (frames.length === 1 && defaultData.length === 0) defaultImageIsFrame = true;
      } else if (type === 'IDAT') {
        if (current && defaultImageIsFrame && frames.length === 1) current.data.push(data.slice());
        else defaultData.push(data.slice());
      } else if (type === 'fdAT') {
        if (current) current.data.push(data.slice(4));
      } else if (type === 'IEND') {
        break;
      } else if (['PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'bKGD'].includes(type)) {
        header.push(chunk(type, data));
      }
      offset += 12 + length;
    }
    if (!animated || frames.length === 0) return null;
    // The IHDR is rewritten per frame; keep the raw IHDR data first.
    return { width, height, plays, header, frames: frames.filter((frame) => frame.data.length > 0) };
  }

  private _ensureCanvas(): CanvasRenderingContext2D {
    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
      this._canvas.width = this.width;
      this._canvas.height = this.height;
      this._context = this._canvas.getContext('2d', { willReadFrequently: true });
      if (!this._context) throw new Error('Canvas 2D is required for raster playback');
    }
    return this._context as CanvasRenderingContext2D;
  }

  private async _decodeApngFrame(frame: ApngFrame): Promise<ImageBitmap> {
    const apng = this._apng as { header: Uint8Array[]; frames: ApngFrame[] };
    const ihdr = apng.header[0].slice();
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, frame.width);
    view.setUint32(4, frame.height);
    const parts: Uint8Array[] = [new Uint8Array(PNG_SIGNATURE), chunk('IHDR', ihdr), ...apng.header.slice(1)];
    for (const data of frame.data) parts.push(chunk('IDAT', data));
    parts.push(chunk('IEND', new Uint8Array(0)));
    return decodeBlob(parts as BlobPart[], 'image/png');
  }

  private async _advance(): Promise<void> {
    const ctx = this._ensureCanvas();
    const next = this._cursor + 1;
    if (this._apng) {
      const frames = this._apng.frames;
      if (next === 0) {
        ctx.clearRect(0, 0, this.width, this.height);
      } else {
        const previous = frames[next - 1];
        if (previous.dispose === 1) ctx.clearRect(previous.x, previous.y, previous.width, previous.height);
        else if (previous.dispose === 2 && this._previous && this._previousRect) {
          ctx.putImageData(this._previous, this._previousRect.x, this._previousRect.y);
        }
      }
      const frame = frames[next];
      if (frame.dispose === 2) {
        this._previous = ctx.getImageData(frame.x, frame.y, frame.width, frame.height);
        this._previousRect = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
      } else this._previous = null;
      const bitmap = await this._decodeApngFrame(frame);
      if (frame.blend === 0) ctx.clearRect(frame.x, frame.y, frame.width, frame.height);
      ctx.drawImage(bitmap, frame.x, frame.y);
      bitmap.close();
    } else if (this._gif) {
      const frames = this._gif;
      if (next === 0) ctx.clearRect(0, 0, this.width, this.height);
      else {
        const previous = frames[next - 1];
        if (previous.disposalType === 2) ctx.clearRect(previous.dims.left, previous.dims.top, previous.dims.width, previous.dims.height);
        else if (previous.disposalType === 3 && this._previous && this._previousRect) {
          ctx.putImageData(this._previous, this._previousRect.x, this._previousRect.y);
        }
      }
      const frame = frames[next];
      if (frame.disposalType === 3) {
        this._previous = ctx.getImageData(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
        this._previousRect = { x: frame.dims.left, y: frame.dims.top, width: frame.dims.width, height: frame.dims.height };
      }
      const patch = new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height);
      const bitmap = await createImageBitmap(patch);
      ctx.drawImage(bitmap, frame.dims.left, frame.dims.top);
      bitmap.close();
    }
    this._cursor = next;
  }

  /**
   * Return the composited frame `index`. Frames decode sequentially from the
   * current cursor; stepping backwards restarts from the first frame.
   */
  frameAt(index: number): Promise<FrameSource> {
    const run = async (): Promise<FrameSource> => {
      if (this._still) return this._still;
      const clamped = Math.max(0, Math.min(index, this.frameCount - 1));
      const cached = this._cache.get(clamped);
      if (cached) return cached;
      if (clamped < this._cursor) this._cursor = -1;
      while (this._cursor < clamped) await this._advance();
      const canvas = this._canvas as HTMLCanvasElement;
      if (clamped === 0 || clamped === this.frameCount - 1) {
        const bitmap = await createImageBitmap(canvas);
        this._cache.set(clamped, bitmap);
        return bitmap;
      }
      return canvas;
    };
    const result = this._queue.then(run, run);
    this._queue = result.catch(() => undefined);
    return result;
  }
}

export interface RasterImageOptions {
  width?: number;
  height?: number;
}

/** A plane showing one frame of a raster source, updated through a canvas texture. */
export class RasterImage extends Mobject implements SnapshotExtra {
  /** Called whenever a frame finishes decoding after the fact, so the host can redraw. */
  static onUpdate: (() => void) | null = null;
  /** The decodes under way, for whoever must wait until every picture shows its frame. */
  private static readonly _pending = new Set<Promise<void>>();

  /** Resolve once no picture is still decoding towards its frame. */
  static async settle(): Promise<void> {
    while (RasterImage._pending.size) await Promise.all([...RasterImage._pending]);
  }
  readonly source: RasterSource;
  private _worldWidth: number;
  private _worldHeight: number;
  private readonly _canvas: HTMLCanvasElement;
  private readonly _context: CanvasRenderingContext2D;
  private _texture: THREE.CanvasTexture | null = null;
  private _mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private _target = 0;
  private _shown = -1;
  private _pumping: Promise<void> | null = null;

  constructor(source: RasterSource, options: RasterImageOptions = {}) {
    super();
    this.source = source;
    const aspect = source.width / source.height;
    if (options.width !== undefined && options.height !== undefined) {
      const boxAspect = options.width / options.height;
      this._worldWidth = aspect > boxAspect ? options.width : options.height * aspect;
      this._worldHeight = aspect > boxAspect ? options.width / aspect : options.height;
    } else if (options.width !== undefined) {
      this._worldWidth = options.width;
      this._worldHeight = options.width / aspect;
    } else if (options.height !== undefined) {
      this._worldHeight = options.height;
      this._worldWidth = options.height * aspect;
    } else {
      this._worldWidth = source.width / 100;
      this._worldHeight = source.height / 100;
    }
    this._canvas = document.createElement('canvas');
    this._canvas.width = source.width;
    this._canvas.height = source.height;
    const context = this._canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is required for raster images');
    this._context = context;
    this.fillOpacity = 1;
    this.showFrame(0);
  }

  get frameIndex(): number {
    return this._target;
  }

  /** Display frame `index`, decoding it in the background when necessary. */
  showFrame(index: number): void {
    this._target = Math.max(0, Math.min(Math.round(index), this.source.frameCount - 1));
    this._startPump();
  }

  /** Resolve once the requested frame is visible. */
  async waitForLoad(): Promise<void> {
    while (this._shown !== this._target) await this._startPump();
  }

  /**
   * Start decoding towards the target frame unless a pump is already running.
   * The pump promise is cleared from a continuation, never from inside the
   * pump itself: a pump that finds nothing to do would otherwise clear the
   * field before the assignment stored it, and no later frame would decode.
   */
  private _startPump(): Promise<void> {
    if (this._pumping) return this._pumping;
    if (this._shown === this._target) return Promise.resolve();
    const pump = this._pump().finally(() => {
      if (this._pumping === pump) this._pumping = null;
      RasterImage._pending.delete(pump);
    });
    RasterImage._pending.add(pump);
    this._pumping = pump;
    return pump;
  }

  private async _pump(): Promise<void> {
    try {
      while (this._shown !== this._target) {
        const wanted = this._target;
        const frame = await this.source.frameAt(wanted);
        // Show whatever has been decoded, even when the target moved on meanwhile: it is closer than the current frame.
        if (wanted === this._shown) continue;
        this._context.clearRect(0, 0, this._canvas.width, this._canvas.height);
        this._context.drawImage(frame, 0, 0);
        this._shown = wanted;
        if (this._texture) this._texture.needsUpdate = true;
        this._markDirty();
        RasterImage.onUpdate?.();
      }
    } catch (error) {
      console.error('[zoomdeck] raster frame failed', error);
      this._shown = this._target;
    }
  }

  captureExtra(): unknown {
    return this._target;
  }

  restoreExtra(value: unknown): void {
    if (typeof value === 'number') this.showFrame(value);
  }

  override normalizeTransform(worldMatrix: THREE.Matrix4 = this._ownMatrix()): this {
    return this._flattenAsMesh(worldMatrix);
  }

  protected _createThreeObject(): THREE.Object3D {
    const group = new THREE.Group();
    this._texture = new THREE.CanvasTexture(this._canvas);
    this._texture.colorSpace = THREE.SRGBColorSpace;
    this._texture.minFilter = THREE.LinearMipmapLinearFilter;
    this._texture.magFilter = THREE.LinearFilter;
    this._texture.generateMipmaps = true;
    this._texture.anisotropy = 8;
    const material = new THREE.MeshBasicMaterial({
      map: this._texture,
      transparent: true,
      opacity: this._opacity,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      depthWrite: false,
      depthTest: false,
    });
    this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(this._worldWidth, this._worldHeight), material);
    this._mesh.frustumCulled = false;
    group.add(this._mesh);
    return group;
  }

  protected override _syncMaterialToThree(): void {
    if (this._mesh) this._mesh.material.opacity = this._opacity;
  }

  override getDisplayMeshLength(): number {
    return 1;
  }

  override getDisplayMeshes(): THREE.Mesh[] {
    this.getThreeObject();
    return this._mesh ? [this._mesh] : [];
  }

  override getWidth(): number {
    return this._worldWidth * Math.abs(this.scaleVector.x);
  }

  override getHeight(): number {
    return this._worldHeight * Math.abs(this.scaleVector.y);
  }

  override copy(): RasterImage {
    const clone = new RasterImage(this.source, { width: this._worldWidth, height: this._worldHeight });
    this._copyBaseAttributesInto(clone, { copyChildren: false });
    clone.showFrame(this._target);
    return clone;
  }

  override dispose(): void {
    super.dispose();
    this._texture?.dispose();
  }
}

export interface RasterMovieOptions extends AnimationOptions {
  /** Duration of every source frame in seconds; defaults to the file's timing. */
  durations?: number[];
  /** Number of cycles; zero denotes an indefinitely looping source. Defaults to the file's loop metadata. */
  plays?: number;
  /** Playback duration in seconds; defaults to the complete declared play count, or one cycle when looping. */
  runTime?: number;
}

/** Animate a multi-frame raster file on an existing `RasterImage`. */
export class RasterMovie extends Animation {
  readonly durations: number[];
  readonly plays: number;
  readonly cycleTime: number;
  private readonly _frameEnds: number[];

  constructor(image: RasterImage, options: RasterMovieOptions = {}) {
    const source = image.source;
    if (source.frameCount < 2) throw new Error('RasterMovie requires a multi-frame raster file');
    const durations = options.durations ?? source.durations;
    if (durations.length !== source.frameCount) throw new Error('RasterMovie needs one duration for each source frame');
    if (durations.some((d) => !Number.isFinite(d) || d <= 0)) throw new Error('RasterMovie frame durations must be finite and positive');
    const plays = options.plays ?? source.plays;
    if (!Number.isInteger(plays) || plays < 0) throw new Error('RasterMovie plays must be a nonnegative integer');
    const cycleTime = durations.reduce((sum, d) => sum + d, 0);
    const runTime = options.runTime ?? cycleTime * Math.max(1, plays);
    if (!Number.isFinite(runTime) || runTime <= 0) throw new Error('RasterMovie runTime must be finite and positive');
    super(image, { duration: runTime, rateFunc: options.rateFunc ?? linear });
    this.durations = [...durations];
    this.plays = plays;
    this.cycleTime = cycleTime;
    let total = 0;
    this._frameEnds = durations.map((d) => (total += d));
  }

  get image(): RasterImage {
    return this.mobject as RasterImage;
  }

  override begin(): void {
    super.begin();
    this.image.showFrame(0);
  }

  interpolate(alpha: number): void {
    const elapsed = alpha >= 1 && this.plays > 0 ? this.cycleTime : (alpha * this.duration) % this.cycleTime;
    let index = this._frameEnds.findIndex((end) => end > elapsed);
    if (index < 0) index = this._frameEnds.length - 1;
    this.image.showFrame(index);
  }

  override finish(): void {
    this.interpolate(1);
    super.finish();
  }
}
