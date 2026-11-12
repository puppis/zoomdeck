/**
 * The rendering surface: an engine Scene whose camera fits the
 * presentation viewport into the available stage, revealing the surrounding
 * canvas when the browser has extra room.
 */
import { Scene } from 'manim-web';
import type { Presenter } from '../runtime';
import type { Vec3 } from '../geometry';
import { TEXT_LINES, textBasePxPerWorld, type StyledLine } from '../markup/text';

export interface StageOptions {
  background: string;
  /** Width over height of the presentation viewport. */
  viewportAspect: number;
}

export class Stage {
  readonly scene: Scene;
  readonly container: HTMLElement;
  readonly viewportAspect: number;
  presenter: Presenter | null = null;
  /** Callbacks run after every render, e.g. DOM layers that follow the camera. */
  readonly afterRender: Array<() => void> = [];
  /** Callbacks run after the canvas changed size. */
  readonly afterResize: Array<() => void> = [];
  private _observer: ResizeObserver | null = null;
  private _width: number;
  private _height: number;

  constructor(container: HTMLElement, options: StageOptions) {
    this.container = container;
    this.viewportAspect = options.viewportAspect;
    this._width = Math.max(2, Math.round(container.clientWidth || 800));
    this._height = Math.max(2, Math.round(container.clientHeight || 450));
    this.scene = new Scene(container, {
      width: this._width,
      height: this._height,
      backgroundColor: options.background,
      autoRender: false,
      autoResize: false,
      frustumCulling: false,
      pauseRenderingWhenHidden: false,
    });
    const canvas = this.scene.getCanvas();
    canvas.style.display = 'block';
    if (typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(() => this.fit());
      this._observer.observe(container);
    }
  }

  attach(presenter: Presenter): void {
    this.presenter = presenter;
    this.scene.threeScene.add(presenter.root3D);
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  /** Match the canvas to the container size. */
  fit(): void {
    const width = Math.max(2, Math.round(this.container.clientWidth));
    const height = Math.max(2, Math.round(this.container.clientHeight));
    if (width === this._width && height === this._height) return;
    this._width = width;
    this._height = height;
    this.scene.resize(width, height);
    if (this.presenter) for (const ctx of this.presenter.contexts.values()) ctx.display.invalidateStrokes();
    this.render();
    for (const callback of this.afterResize) callback();
  }

  /** The camera view (world units) that contains the presentation viewport. */
  private _view(): { width: number; height: number } {
    const camera = this.presenter?.camera ?? { center: [0, 0, 0] as Vec3, width: 16 };
    const stageAspect = this._width / this._height;
    const viewportHeight = camera.width / this.viewportAspect;
    if (stageAspect >= this.viewportAspect) {
      return { width: viewportHeight * stageAspect, height: viewportHeight };
    }
    return { width: camera.width, height: camera.width / stageAspect };
  }

  /** Map a world point to canvas pixels (origin at the top-left corner of the stage). */
  worldToPixel(x: number, y: number): { x: number; y: number } {
    const view = this._view();
    const center = this.presenter?.camera.center ?? ([0, 0, 0] as Vec3);
    return {
      x: ((x - center[0]) / view.width + 0.5) * this._width,
      y: (0.5 - (y - center[1]) / view.height) * this._height,
    };
  }

  /** Pixel rectangle of the central presentation viewport inside the canvas. */
  viewportRect(): { left: number; top: number; width: number; height: number } {
    const view = this._view();
    const camera = this.presenter?.camera ?? { center: [0, 0, 0] as Vec3, width: 16 };
    const scale = this._width / view.width;
    const width = camera.width * scale;
    const height = (camera.width / this.viewportAspect) * scale;
    return { left: (this._width - width) / 2, top: (this._height - height) / 2, width, height };
  }

  /**
   * Redraw the text lines in view at the screen's own pixel density, so that
   * prose is sharp wherever the camera has come to rest. Lines outside the
   * view keep their current bitmaps. Renders again when anything changed.
   */
  private readonly _resting = new Set<StyledLine>();

  /** The camera is about to move: visible lines go back to mipmapped, unaligned sampling. */
  unrestText(): void {
    if (this._resting.size === 0) return;
    for (const line of this._resting) line.unrest();
    this._resting.clear();
    this.render();
  }

  refreshText(): void {
    const presenter = this.presenter;
    if (!presenter || !TEXT_LINES.size) return;
    const view = this._view();
    const center = presenter.camera.center;
    const pixelRatio = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const pxPerWorld = (this._width * pixelRatio) / view.width;
    const canvas = this.container.querySelector('canvas');
    const deviceRatio = canvas && this._width ? canvas.width / this._width : pixelRatio;
    const toDevicePixel = (x: number, y: number) => {
      const pixel = this.worldToPixel(x, y);
      return { x: pixel.x * deviceRatio, y: pixel.y * deviceRatio };
    };
    const marginX = view.width * 0.25;
    const marginY = view.height * 0.25;
    const root = this.scene.threeScene;
    let changed = false;
    for (const line of TEXT_LINES) {
      const object = line.getThreeObject();
      let ancestor = object.parent;
      while (ancestor && ancestor !== root) ancestor = ancestor.parent;
      if (ancestor !== root) continue;
      const m = object.matrixWorld.elements;
      const scale = Math.hypot(m[0], m[1], m[2]);
      const x = m[12];
      const y = m[13];
      const halfWidth = (line.getWidth() * scale) / 2;
      const halfHeight = (line.getHeight() * scale) / 2;
      const outside = x + halfWidth < center[0] - view.width / 2 - marginX || x - halfWidth > center[0] + view.width / 2 + marginX
        || y + halfHeight < center[1] - view.height / 2 - marginY || y - halfHeight > center[1] + view.height / 2 + marginY;
      // Lines out of view go back to the base density, so zooming around never accumulates large canvases.
      if (line.rasterizeAt(outside ? textBasePxPerWorld() : pxPerWorld * scale)) changed = true;
      if (outside) {
        if (this._resting.delete(line)) {
          line.unrest();
          changed = true;
        }
        continue;
      }
      // At rest, the texels of a visible line sit on the screen's pixels, sampled without mipmaps.
      line.restOnScreen(toDevicePixel);
      this._resting.add(line);
      changed = true;
    }
    if (changed) this.render();
  }

  /** Draw the current presenter state. */
  render(): void {
    const presenter = this.presenter;
    if (!presenter) return;
    const view = this._view();
    const camera = presenter.camera;
    const threeCamera = this.scene.camera;
    threeCamera.frameWidth = view.width;
    threeCamera.frameHeight = view.height;
    threeCamera.moveTo([camera.center[0], camera.center[1], threeCamera.position.z]);
    const bounds = {
      min: [camera.center[0] - view.width / 2, camera.center[1] - view.height / 2, 0] as Vec3,
      max: [camera.center[0] + view.width / 2, camera.center[1] + view.height / 2, 0] as Vec3,
    };
    presenter.prepareRender(this._width, this._height, bounds, view.width);
    this.scene.render();
    for (const callback of this.afterRender) callback();
  }

  dispose(): void {
    this._observer?.disconnect();
    this.scene.dispose();
  }
}
