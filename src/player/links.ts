/**
 * DOM hit areas for links: Markdown links inside rendered prose and elements
 * with an `href`. The canvas draws the content; this layer keeps one
 * transparent `<a>` per link over the stage, positioned after every render
 * from the objects' world matrices.
 */
import * as THREE from 'three';
import { LINKED_LINES, type StyledLine } from '../markup/text';
import { LINKED_OBJECTS } from '../links';
import { DISPLAY_GROUP_FLAG } from '../patches';
import type { Stage } from './stage';

let nextLineId = 1;
const lineIds = new WeakMap<StyledLine, number>();

/** The display group carrying the slide transform above an object, if any. */
function displayGroup(object: THREE.Object3D): THREE.Object3D | null {
  for (let node = object.parent; node; node = node.parent) if (node.userData[DISPLAY_GROUP_FLAG]) return node;
  return null;
}

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
        this._place(key, link.href, left, top, right, bottom);
      });
    }
    for (const [mobject, href] of LINKED_OBJECTS) {
      const object = mobject.getThreeObject();
      if (!attached(object, root)) continue;
      // Point bounds are slide-local (stroke meshes would be too generous); the display group maps them to the world.
      const { min, max } = mobject.getBounds();
      if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) continue;
      const frame = displayGroup(object);
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const [x, y] of [[min.x, min.y], [max.x, min.y], [max.x, max.y], [min.x, max.y]]) {
        this._vector.set(x, y, 0);
        if (frame) this._vector.applyMatrix4(frame.matrixWorld);
        const pixel = this.stage.worldToPixel(this._vector.x, this._vector.y);
        left = Math.min(left, pixel.x);
        right = Math.max(right, pixel.x);
        top = Math.min(top, pixel.y);
        bottom = Math.max(bottom, pixel.y);
      }
      const key = `object:${object.id}`;
      seen.add(key);
      this._place(key, href, left, top, right, bottom);
    }
    for (const [key, anchor] of this._anchors) {
      if (!seen.has(key)) {
        anchor.remove();
        this._anchors.delete(key);
      }
    }
  }

  private _place(key: string, href: string, left: number, top: number, right: number, bottom: number): void {
    let anchor = this._anchors.get(key);
    if (!anchor) {
      anchor = document.createElement('a');
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      this._anchors.set(key, anchor);
      this.element.append(anchor);
    }
    if (anchor.getAttribute('href') !== href) {
      anchor.href = href;
      anchor.title = href;
    }
    anchor.style.left = `${left}px`;
    anchor.style.top = `${top}px`;
    anchor.style.width = `${Math.max(1, right - left)}px`;
    anchor.style.height = `${Math.max(1, bottom - top)}px`;
  }

  dispose(): void {
    this.element.remove();
    this._anchors.clear();
  }
}
