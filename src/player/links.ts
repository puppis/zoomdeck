/**
 * DOM hit areas for links: Markdown links inside rendered prose and elements
 * with an `href`. The canvas draws the content; this layer keeps one
 * transparent `<a>` per link over the stage, positioned after every render
 * from the objects' world matrices.
 */
import * as THREE from 'three';
import { LINKED_LINES, type StyledLine } from '../markup/text';
import { LINKED_OBJECTS, SOURCE_OBJECTS } from '../links';
import { DISPLAY_GROUP_FLAG, DISPLAY_SLIDE_KEY } from '../patches';
import type { Presenter } from '../runtime';
import type { Slide, SourceLocation } from '../slides';
import type { Stage } from './stage';

let nextLineId = 1;
const lineIds = new WeakMap<StyledLine, number>();

/** The display group carrying the slide transform above an object, if any. */
function displayGroup(object: THREE.Object3D): THREE.Object3D | null {
  for (let node = object.parent; node; node = node.parent) if (node.userData[DISPLAY_GROUP_FLAG]) return node;
  return null;
}

/**
 * Whether an object belongs to the focused slide. Only that slide's links are live: an
 * ancestor's element may overlap the child's viewport (a tile linking to that very child,
 * say) and would otherwise catch every click on it, and a descendant's links are tiny and
 * unexpected until the camera reaches it.
 */
function inFocus(object: THREE.Object3D, focused: Slide | null): boolean {
  if (!focused) return true;
  const slide = displayGroup(object)?.userData[DISPLAY_SLIDE_KEY] as Slide | undefined;
  return !slide || slide === focused;
}

const partBox = new THREE.Box3();

/**
 * World bounds of an object's visible geometry, from each part's own bounding box (strokes
 * are instanced lines whose template vertices mean nothing; their geometry box is exact),
 * with the world matrices refreshed first. False when nothing visible has geometry.
 */
function worldBounds(object: THREE.Object3D, box: THREE.Box3): boolean {
  box.makeEmpty();
  object.updateWorldMatrix(true, false);
  object.traverseVisible((node) => {
    if (node !== object) node.updateWorldMatrix(false, false);
    const geometry = (node as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!geometry?.attributes.position) return;
    geometry.computeBoundingBox();
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;
    box.union(partBox.copy(geometry.boundingBox).applyMatrix4(node.matrixWorld));
  });
  return !box.isEmpty();
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
  /** Handles a `#…` target inside the deck (a slide or step); returns false to let the browser follow it. */
  navigate: ((hash: string) => boolean) | null = null;
  private readonly _anchors = new Map<string, HTMLAnchorElement>();
  private readonly _vector = new THREE.Vector3();
  private readonly _box = new THREE.Box3();

  constructor(private readonly host: HTMLElement, private readonly stage: Stage, private readonly presenter: Presenter) {
    this.element = document.createElement('div');
    this.element.className = 'links';
    this.element.setAttribute('aria-label', 'Links on the current slides');
    host.append(this.element);
  }

  /** Reposition the hit areas; call after the stage has rendered. */
  update(): void {
    const root = this.stage.scene.threeScene;
    const focused = this.presenter.focused?.slide ?? null;
    const seen = new Set<string>();
    for (const line of LINKED_LINES) {
      const object = line.getThreeObject();
      if (!attached(object, root) || line.opacity <= 0.02 || !inFocus(object, focused)) continue;
      let id = lineIds.get(line);
      if (id === undefined) {
        id = nextLineId++;
        lineIds.set(line, id);
      }
      object.updateWorldMatrix(true, false);
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
      if (!attached(object, root) || !inFocus(object, focused)) continue;
      if (!worldBounds(object, this._box)) continue;
      const { min, max } = this._box;
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const [x, y] of [[min.x, min.y], [max.x, min.y], [max.x, max.y], [min.x, max.y]]) {
        const pixel = this.stage.worldToPixel(x, y);
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
      anchor.rel = 'noopener noreferrer';
      anchor.addEventListener('click', (event) => {
        const target = anchor?.getAttribute('href') ?? '';
        if (target.startsWith('#') && this.navigate?.(target)) event.preventDefault();
      });
      this._anchors.set(key, anchor);
      this.element.append(anchor);
    }
    if (anchor.getAttribute('href') !== href) {
      anchor.href = href;
      anchor.title = href;
      // Targets inside the deck stay on this page and, often covering whole tiles, take no
      // clicks (the pen keeps them); `deckLinkAt` follows them on a double-click. Everything
      // else opens a new tab on a click.
      const deck = href.startsWith('#');
      anchor.target = deck ? '_self' : '_blank';
      anchor.classList.toggle('deck', deck);
    }
    anchor.style.left = `${left}px`;
    anchor.style.top = `${top}px`;
    anchor.style.width = `${Math.max(1, right - left)}px`;
    anchor.style.height = `${Math.max(1, bottom - top)}px`;
  }

  /**
   * The source of the element a point of the page aims at, for the editor's inverse search.
   * Each element on screen scores by its distance from the point (zero inside it) plus a small
   * share of its size, so a text clicked a few pixels off wins over the tile or slide around it,
   * while a click well inside a tile names the tile. Elements farther than `reach` pixels do
   * not count. Every slide on screen takes part, so a click inside a child's preview names the
   * child's content.
   */
  sourceAt(clientX: number, clientY: number, reach = 48): SourceLocation | null {
    const root = this.stage.scene.threeScene;
    const bounds = this.host.getBoundingClientRect();
    const px = clientX - bounds.left;
    const py = clientY - bounds.top;
    let best: { source: SourceLocation; score: number } | null = null;
    for (const [mobject, source] of SOURCE_OBJECTS) {
      if (!source) continue;
      const object = mobject.getThreeObject();
      if (!attached(object, root) || !worldBounds(object, this._box)) continue;
      const { min, max } = this._box;
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const [x, y] of [[min.x, min.y], [max.x, min.y], [max.x, max.y], [min.x, max.y]]) {
        const pixel = this.stage.worldToPixel(x, y);
        left = Math.min(left, pixel.x);
        right = Math.max(right, pixel.x);
        top = Math.min(top, pixel.y);
        bottom = Math.max(bottom, pixel.y);
      }
      const distance = Math.hypot(Math.max(left - px, 0, px - right), Math.max(top - py, 0, py - bottom));
      if (distance > reach) continue;
      const score = distance + 0.02 * Math.sqrt((right - left) * (bottom - top));
      if (!best || score < best.score) best = { source, score };
    }
    return best?.source ?? null;
  }

  /** The in-deck target (`#…`) of the topmost link area under a point of the page, if any. */
  deckLinkAt(clientX: number, clientY: number): string | null {
    let found: string | null = null;
    for (const anchor of this._anchors.values()) {
      const href = anchor.getAttribute('href') ?? '';
      if (!href.startsWith('#')) continue;
      const r = anchor.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) found = href;
    }
    return found;
  }

  dispose(): void {
    this.element.remove();
    this._anchors.clear();
  }
}
