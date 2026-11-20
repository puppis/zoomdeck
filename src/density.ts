/**
 * Pictures drawn at the density they are shown at: a PDF page, a part of a Slajdomat slide.
 * Each is a plane whose picture is drawn in the background, at the density of the screen while
 * it is in view (the stage asks once the camera rests) and as a small picture otherwise, so that
 * its text is as sharp as the deck's own at rest while a long document never holds every picture
 * at full resolution. At most two pictures draw at a time, the ones in view first, then the nearest.
 */
import * as THREE from 'three';
import { Mobject } from 'manim-web';

/** Pixels along the long side of a page out of view: a small picture, enough for an overview or a thumbnail. */
export const BASE_PAGE_PIXELS = 320;
/** Pixels along the long side of a page at most, whatever the zoom: beyond, the texture would exhaust memory on tablets. */
export const MAX_PAGE_PIXELS = 4096;

/** Pixels along the long side of a picture `longSide` world units long drawn at `pxPerWorld`, within the bounds. */
export function pagePixels(longSide: number, pxPerWorld: number, base = BASE_PAGE_PIXELS): number {
  const wanted = longSide * pxPerWorld;
  if (!Number.isFinite(wanted)) return base;
  return Math.round(Math.min(MAX_PAGE_PIXELS, Math.max(base, wanted)));
}

/** The pictures on every stage, for the sharpening pass of the stage they are shown on. */
export const PAGE_IMAGES = new Set<DensityImage>();

let onUpdate: (() => void) | null = null;

/** How a picture is sized: its world size (one dimension keeps its proportions) and its look before it is drawn. */
export interface DensityImageOptions {
  width?: number;
  height?: number;
  /** Pixels along the long side out of view; `BASE_PAGE_PIXELS` by default. */
  base?: number;
  /** The color shown until the first picture arrives; transparent when null. */
  blank?: string | null;
}

/**
 * A plane showing a picture drawn at the density asked of it: `_draw` makes the picture, the
 * rest (the queue, the texture, the mesh) is shared. A subclass calls `_start()` at the end of
 * its constructor, once it can draw.
 */
export abstract class DensityImage extends Mobject {
  /** Called whenever a picture finished drawing after the fact, so the host can redraw. */
  static get onUpdate(): (() => void) | null {
    return onUpdate;
  }

  static set onUpdate(callback: (() => void) | null) {
    onUpdate = callback;
  }

  private static readonly _queue = new Set<DensityImage>();
  private static _running = 0;
  private static _waiters: Array<() => void> = [];
  static readonly CONCURRENCY = 2;

  /** Resolve once every picture in view shows the density asked of it. */
  static async settle(): Promise<void> {
    while ([...PAGE_IMAGES].some((image) => image._inView && image._shown !== image._wanted)) {
      await new Promise<void>((resolve) => DensityImage._waiters.push(resolve));
    }
  }

  private static _notify(): void {
    const waiters = DensityImage._waiters;
    DensityImage._waiters = [];
    for (const resolve of waiters) resolve();
  }

  private static _pump(): void {
    while (DensityImage._running < DensityImage.CONCURRENCY && DensityImage._queue.size) {
      let next: DensityImage | null = null;
      for (const image of DensityImage._queue) if (!next || image._priority < next._priority) next = image;
      const image = next as DensityImage;
      DensityImage._queue.delete(image);
      if (image._shown === image._wanted || image._rendering) continue;
      DensityImage._running += 1;
      image._rendering = image._render(image._wanted).finally(() => {
        image._rendering = null;
        DensityImage._running -= 1;
        // The wish may have changed while it drew.
        if (image._shown !== image._wanted && PAGE_IMAGES.has(image)) DensityImage._queue.add(image);
        DensityImage._notify();
        DensityImage._pump();
      });
    }
  }

  /** Pixels along the long side of the picture out of view. */
  readonly basePixels: number;
  /** The picture's own proportions, as width and height in any unit. */
  protected readonly _natural: [number, number];
  private _worldWidth: number;
  private _worldHeight: number;
  private _canvas: HTMLCanvasElement;
  private _texture: THREE.CanvasTexture | null = null;
  private _mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  /** Pixels along the long side of the picture shown (0: none yet) and of the one asked for. */
  private _shown = 0;
  private _wanted: number;
  private _priority = Infinity;
  private _inView = false;
  private _rendering: Promise<void> | null = null;

  constructor(natural: [number, number], options: DensityImageOptions = {}) {
    super();
    this._natural = natural;
    this.basePixels = Math.max(1, Math.round(options.base ?? BASE_PAGE_PIXELS));
    this._wanted = this.basePixels;
    const aspect = natural[0] / natural[1];
    if (options.width !== undefined && options.height !== undefined) {
      const boxAspect = options.width / options.height;
      this._worldWidth = aspect > boxAspect ? options.width : options.height * aspect;
      this._worldHeight = aspect > boxAspect ? options.width / aspect : options.height;
    } else if (options.height !== undefined) {
      this._worldHeight = options.height;
      this._worldWidth = options.height * aspect;
    } else {
      this._worldWidth = options.width ?? 16;
      this._worldHeight = this._worldWidth / aspect;
    }
    this._canvas = document.createElement('canvas');
    this._canvas.width = 2;
    this._canvas.height = 2;
    const blank = options.blank === undefined ? '#FFFFFF' : options.blank;
    const context = this._canvas.getContext('2d');
    if (context && blank) {
      context.fillStyle = blank;
      context.fillRect(0, 0, 2, 2);
    }
    this.fillOpacity = 1;
  }

  /** Join the pictures of the stage and ask for the small picture; the subclass can draw by now. */
  protected _start(): void {
    PAGE_IMAGES.add(this);
    this.request(this.basePixels, Infinity, false);
  }

  /**
   * Draw the picture `pixels` wide along its long side: the canvas, or null when the drawing was
   * called off (it is asked again later). An error gives up on this density.
   */
  protected abstract _draw(pixels: number): Promise<HTMLCanvasElement | null>;

  /** Call off a drawing under way, if the subclass can. */
  protected _cancel(): void {}

  /** Pixels along the long side of the picture shown now. */
  get shownPixels(): number {
    return this._shown;
  }

  /** Pixels along the long side of the picture asked for. */
  get wantedPixels(): number {
    return this._wanted;
  }

  /**
   * Ask for a picture `pixels` wide along the long side; `priority` orders the pictures waiting
   * (lower first) and `inView` marks the pictures a capture must wait for.
   */
  request(pixels: number, priority: number, inView: boolean): void {
    this._wanted = Math.round(pixels);
    this._priority = priority;
    this._inView = inView;
    if (this._shown === this._wanted) {
      DensityImage._queue.delete(this);
      return;
    }
    DensityImage._queue.add(this);
    DensityImage._pump();
  }

  private async _render(pixels: number): Promise<void> {
    let canvas: HTMLCanvasElement | null;
    try {
      canvas = await this._draw(pixels);
    } catch (error) {
      console.error('[zoomdown] A picture failed to draw', error);
      // Give up on this density rather than asking again and again.
      this._shown = pixels;
      return;
    }
    if (!canvas || !PAGE_IMAGES.has(this)) return;
    this._canvas = canvas;
    this._shown = pixels;
    if (this._mesh) {
      // A texture of another size is a new texture: storage once allocated cannot grow.
      this._texture?.dispose();
      this._texture = DensityImage._texture(canvas);
      this._mesh.material.map = this._texture;
      this._mesh.material.needsUpdate = true;
    }
    this._markDirty();
    onUpdate?.();
  }

  private static _texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    return texture;
  }

  override normalizeTransform(worldMatrix: THREE.Matrix4 = this._ownMatrix()): this {
    return this._flattenAsMesh(worldMatrix);
  }

  protected _createThreeObject(): THREE.Object3D {
    const group = new THREE.Group();
    this._texture = DensityImage._texture(this._canvas);
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

  /** The world size the picture was made with, before any scaling. */
  protected get worldSize(): [number, number] {
    return [this._worldWidth, this._worldHeight];
  }

  override dispose(): void {
    PAGE_IMAGES.delete(this);
    DensityImage._queue.delete(this);
    this._cancel();
    super.dispose();
    this._texture?.dispose();
  }
}
