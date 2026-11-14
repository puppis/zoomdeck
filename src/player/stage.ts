/**
 * The rendering surface: an engine Scene whose camera fits the
 * presentation viewport into the available stage, revealing the surrounding
 * canvas when the browser has extra room.
 */
import { Scene } from 'manim-web';
import { TextBatcher } from './textbatch';
import type { Presenter } from '../runtime';
import type { Vec3 } from '../geometry';
import { TEXT_LINES, textBasePxPerWorld, type StyledLine } from '../markup/text';
import { BASE_PAGE_PIXELS, PAGE_IMAGES, pagePixels } from '../pdfdeck';

export interface StageOptions {
  background: string;
  /** Width over height of the presentation viewport. */
  viewportAspect: number;
  /** Multisampled edges (default on). */
  antialias?: boolean;
  /** Device pixels per CSS pixel of the canvas (default: the screen's, up to 2). */
  pixelRatio?: number;
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
      antialias: options.antialias ?? true,
      pixelRatio: options.pixelRatio ?? (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1),
      // Captures (printing, the video export) read the canvas right after a render, in the same
      // task, so the buffer need not survive compositing: keeping it costs a copy every frame.
      preserveDrawingBuffer: false,
    });
    this.textBatcher = new TextBatcher(this.scene.threeScene);
    const canvas = this.scene.getCanvas();
    canvas.style.display = 'block';
    if (typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(() => this.fit());
      this._observer.observe(container);
    }
  }

  /** Draws runs of text lines with one call each; rebuilt whenever the text has settled. */
  readonly textBatcher: TextBatcher;

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
    if (this._printing) return;
    const width = Math.max(2, Math.round(this.container.clientWidth));
    const height = Math.max(2, Math.round(this.container.clientHeight));
    if (width === this._width && height === this._height) return;
    this._resize(width, height);
  }

  /** Give the canvas another size in CSS pixels (the engine applies the device pixel ratio) and redraw. */
  private _resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this.scene.resize(width, height);
    if (this.presenter) for (const ctx of this.presenter.contexts.values()) ctx.display.invalidateStrokes();
    this.render();
    for (const callback of this.afterResize) callback();
  }

  private _printing = false;

  /**
   * Run `body` with the canvas sized to `width × height` device pixels and the proportions of
   * the presentation viewport, so that the viewport fills it; `capture` renders the current
   * state with its text drawn at that density and returns a copy of the picture. The screen
   * size and its text come back afterwards.
   */
  async atPrintSize(width: number, height: number, body: (capture: () => HTMLCanvasElement) => Promise<void>): Promise<void> {
    const canvas = this.scene.getCanvas();
    const ratio = canvas.width && this._width ? canvas.width / this._width : 1;
    const saved = { width: this._width, height: this._height };
    this._printing = true;
    this._resize(Math.max(2, Math.round(width / ratio)), Math.max(2, Math.round(height / ratio)));
    const capture = (): HTMLCanvasElement => {
      this.refreshText(Infinity);
      this.render();
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d');
      if (!context) throw new Error('No drawing context');
      context.drawImage(canvas, 0, 0);
      return copy;
    };
    try {
      await body(capture);
    } finally {
      this._printing = false;
      this._resize(saved.width, saved.height);
      this.fit();
      this.refreshText();
    }
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

  private readonly _resting = new Set<StyledLine>();
  /** The frame scheduled to go on with a sharpening pass that ran out of its time budget. */
  private _refreshFrame: number | null = null;

  /** The camera is about to move: visible lines go back to mipmapped, unaligned sampling. */
  unrestText(): void {
    this._cancelRefresh();
    this.textBatcher.setMotion(true);
    if (this._resting.size === 0) return;
    for (const line of this._resting) line.unrest();
    this._resting.clear();
    this.render();
  }

  private _cancelRefresh(): void {
    if (this._refreshFrame === null) return;
    cancelAnimationFrame(this._refreshFrame);
    this._refreshFrame = null;
  }

  /**
   * Redraw the text lines in view at the screen's own pixel density, so that prose is sharp
   * wherever the camera has come to rest, and send the lines out of view back to the base
   * density. The result is the same whatever the budget: a pass spends at most `budgetMs`
   * rasterizing, the largest lines on screen first, renders what it has and goes on next
   * frame, so a stop that shows a great deal of text (the front page of a deck, say) appears
   * at once and sharpens within a few frames. `Infinity` does it all at once, for a capture.
   */
  refreshText(budgetMs = 6): void {
    this._cancelRefresh();
    const presenter = this.presenter;
    if (!presenter) return;
    const view = this._view();
    const center = presenter.camera.center;
    // The canvas's own ratio: the screen's, or the one the settings force.
    const canvas = this.container.querySelector('canvas');
    const deviceRatio = canvas && this._width ? canvas.width / this._width : (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    const pxPerWorld = (this._width * deviceRatio) / view.width;
    this._refreshPages(view, center, pxPerWorld);
    if (!TEXT_LINES.size) return;
    const toDevicePixel = (x: number, y: number) => {
      const pixel = this.worldToPixel(x, y);
      return { x: pixel.x * deviceRatio, y: pixel.y * deviceRatio };
    };
    const marginX = view.width * 0.25;
    const marginY = view.height * 0.25;
    const root = this.scene.threeScene;
    // What each line needs, the lines in view first and the largest of them before the rest.
    const jobs: Array<{ line: StyledLine; outside: boolean; density: number; size: number }> = [];
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
      jobs.push({ line, outside, density: outside ? textBasePxPerWorld() : pxPerWorld * scale, size: outside ? -1 : halfWidth * halfHeight });
    }
    jobs.sort((a, b) => b.size - a.size);
    const started = performance.now();
    let changed = false;
    let left = 0;
    for (const job of jobs) {
      if (performance.now() - started > budgetMs) {
        left += 1;
        continue;
      }
      if (job.line.rasterizeAt(job.density)) changed = true;
      if (job.outside) {
        if (this._resting.delete(job.line)) {
          job.line.unrest();
          changed = true;
        }
        continue;
      }
      // At rest, the texels of a visible line sit on the screen's pixels, sampled without mipmaps.
      job.line.restOnScreen(toDevicePixel);
      this._resting.add(job.line);
      changed = true;
    }
    // Settled: the lines in view are drawn in batches from now on, until the camera moves again.
    if (!left) {
      this.textBatcher.rebuild(presenter);
      changed = true;
    }
    if (changed) this.render();
    if (left) {
      this._refreshFrame = requestAnimationFrame(() => {
        this._refreshFrame = null;
        this.refreshText(budgetMs);
      });
    }
  }

  /**
   * Ask the pages of a PDF on this stage for pictures at the screen's density while they are
   * in view, the nearest first, and for the small base picture once they are out of view. The
   * pages draw in the background and the stage redraws as each arrives.
   */
  private _refreshPages(view: { width: number; height: number }, center: Vec3, pxPerWorld: number): void {
    if (!PAGE_IMAGES.size) return;
    const root = this.scene.threeScene;
    const marginX = view.width * 0.25;
    const marginY = view.height * 0.25;
    for (const page of PAGE_IMAGES) {
      const object = page.getThreeObject();
      let ancestor = object.parent;
      while (ancestor && ancestor !== root) ancestor = ancestor.parent;
      if (ancestor !== root) continue;
      const m = object.matrixWorld.elements;
      const scale = Math.hypot(m[0], m[1], m[2]);
      const x = m[12];
      const y = m[13];
      const halfWidth = (page.getWidth() * scale) / 2;
      const halfHeight = (page.getHeight() * scale) / 2;
      const outside = x + halfWidth < center[0] - view.width / 2 - marginX || x - halfWidth > center[0] + view.width / 2 + marginX
        || y + halfHeight < center[1] - view.height / 2 - marginY || y - halfHeight > center[1] + view.height / 2 + marginY;
      const distance = Math.hypot(x - center[0], y - center[1]);
      if (outside) page.request(BASE_PAGE_PIXELS, 1 + distance, false);
      else page.request(pagePixels(2 * Math.max(halfWidth, halfHeight), pxPerWorld), 0, true);
    }
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
    this.textBatcher.sync();
    this.scene.render();
    for (const callback of this.afterRender) callback();
  }

  dispose(): void {
    this._observer?.disconnect();
    this.textBatcher.clear();
    this.scene.dispose();
  }
}
