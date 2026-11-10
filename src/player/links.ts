/**
 * DOM hit areas for links inside rendered prose. The canvas draws the
 * underlined text; this layer keeps one transparent `<a>` per link over the
 * stage, positioned after every render from the line's world matrix.
 */
import * as THREE from 'three';
import { LINKED_LINES, type StyledLine } from '../markup/text';
import type { Stage } from './stage';

let nextLineId = 1;
const lineIds = new WeakMap<StyledLine, number>();

function attached(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === root) return true;
  }
  return false;
}

export class LinkLayer {
  readonly element: HTMLElement;
  private readonly _anchors = new Map<string, HTMLAnchorElement>();
  private readonly _vector = new THREE.Vector3();

  constructor(host: HTMLElement, private readonly stage: Stage) {
    this.element = document.createElement('div');
    this.element.className = 'links';
    this.element.setAttribute('aria-label', 'Links on the current slides');
    host.append(this.element);
  }

  /** Reposition the hit areas; call after the stage has rendered. */
  update(): void {
    const root = this.stage.scene.threeScene;
    const seen = new Set<string>();
    for (const line of LINKED_LINES) {
      const object = line.getThreeObject();
      if (!attached(object, root) || line.opacity <= 0.02) continue;
      let id = lineIds.get(line);
      if (id === undefined) {
        id = nextLineId++;
        lineIds.set(line, id);
      }
      line.links.forEach((link, index) => {
        const key = `${id}:${index}`;
        seen.add(key);
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const [x, y] of [[link.left, link.top], [link.right, link.top], [link.right, link.bottom], [link.left, link.bottom]]) {
          this._vector.set(x, y, 0).applyMatrix4(object.matrixWorld);
          const pixel = this.stage.worldToPixel(this._vector.x, this._vector.y);
          left = Math.min(left, pixel.x);
          right = Math.max(right, pixel.x);
          top = Math.min(top, pixel.y);
          bottom = Math.max(bottom, pixel.y);
        }
        let anchor = this._anchors.get(key);
        if (!anchor) {
          anchor = document.createElement('a');
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          this._anchors.set(key, anchor);
          this.element.append(anchor);
        }
        if (anchor.getAttribute('href') !== link.href) {
          anchor.href = link.href;
          anchor.title = link.href;
        }
        anchor.style.left = `${left}px`;
        anchor.style.top = `${top}px`;
        anchor.style.width = `${Math.max(1, right - left)}px`;
        anchor.style.height = `${Math.max(1, bottom - top)}px`;
      });
    }
    for (const [key, anchor] of this._anchors) {
      if (!seen.has(key)) {
        anchor.remove();
        this._anchors.delete(key);
      }
    }
  }

  dispose(): void {
    this.element.remove();
    this._anchors.clear();
  }
}
