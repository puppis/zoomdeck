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

export class IframeLayer {
  readonly element: HTMLElement;
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

  dispose(): void {
    this.element.remove();
    this._elements.clear();
  }
}
