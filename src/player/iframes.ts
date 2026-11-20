/**
 * Live `<iframe>` elements over the stage. Each markup iframe has a canvas
 * placeholder; while its slide is focused and the placeholder is visible,
 * the real page is laid over it and follows the camera.
 */
import * as THREE from 'three';
import { IFRAME_HOSTS, type IframeHost } from '../markup/iframe';
import type { Presenter } from '../runtime';
import type { Stage } from './stage';

function attached(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === root) return true;
  }
  return false;
}

/** The HTML layer of live pages, moved and scaled with the camera over their hosts. */
export class IframeLayer {
  readonly element: HTMLElement;
  /**
   * Called with every key pressed or released inside a live page the player can listen to (one
   * of the same origin): true takes it from the page, which then never sees it.
   */
  onPageKey: ((event: KeyboardEvent) => boolean) | null = null;
  private readonly _elements = new Map<IframeHost, HTMLIFrameElement>();
  private readonly _box = new THREE.Box3();

  constructor(host: HTMLElement, private readonly stage: Stage, private readonly presenter: Presenter) {
    this.element = document.createElement('div');
    this.element.className = 'iframes';
    host.append(this.element);
  }

  /** Show, place or hide the live slides; call after the stage has rendered. */
  update(): void {
    const root = this.stage.scene.threeScene;
    const focusedCtx = this.presenter.focused;
    const focused = focusedCtx?.slide ?? null;
    // The page is live only once the camera has settled on its slide; it hides during zooms.
    let atRest = false;
    if (focusedCtx) {
      const target = this.presenter.cameraTarget(focusedCtx);
      const camera = this.presenter.camera;
      atRest = Math.abs(camera.width - target.width) < 1e-3
        && Math.abs(camera.center[0] - target.center[0]) < 1e-3 && Math.abs(camera.center[1] - target.center[1]) < 1e-3;
    }
    for (const host of IFRAME_HOSTS) {
      const object = host.box.getThreeObject();
      const live = atRest && focused !== null && host.slide === focused && attached(object, root);
      let element = this._elements.get(host);
      if (!live) {
        if (element) element.style.display = 'none';
        continue;
      }
      if (!element) {
        element = document.createElement('iframe');
        element.src = host.url;
        element.title = host.title;
        element.setAttribute('allow', 'fullscreen');
        element.setAttribute('loading', 'lazy');
        this._watchKeys(element);
        this._elements.set(host, element);
        this.element.append(element);
      }
      this._box.setFromObject(object);
      const a = this.stage.worldToPixel(this._box.min.x, this._box.max.y);
      const b = this.stage.worldToPixel(this._box.max.x, this._box.min.y);
      element.style.display = 'block';
      element.style.left = `${a.x}px`;
      element.style.top = `${a.y}px`;
      element.style.width = `${Math.max(1, b.x - a.x)}px`;
      element.style.height = `${Math.max(1, b.y - a.y)}px`;
    }
  }

  /**
   * Keep the deck's keys working while a live page has the focus. A page of the same origin is
   * listened to before its own handlers (the player decides which keys are its own); one of another
   * origin cannot be, so the focus goes back to the deck when the pointer leaves it, and the page
   * has the keys only while the pointer is over it.
   */
  private _watchKeys(element: HTMLIFrameElement): void {
    let reachable = false;
    element.addEventListener('load', () => {
      reachable = false;
      try {
        const view = element.contentWindow;
        if (!view) return;
        const handle = (event: KeyboardEvent) => {
          if (!this.onPageKey?.(event)) return;
          event.preventDefault();
          event.stopImmediatePropagation();
        };
        view.addEventListener('keydown', handle, true);
        view.addEventListener('keyup', handle, true);
        reachable = true;
      } catch {
        // A page of another origin keeps its keys to itself.
      }
    });
    element.addEventListener('pointerleave', () => {
      if (!reachable && document.activeElement === element) element.blur();
    });
  }

  dispose(): void {
    this.element.remove();
    this._elements.clear();
  }
}
