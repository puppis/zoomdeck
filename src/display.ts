/**
 * Local scene membership and the Three.js display group of one slide.
 *
 * Logical mobjects keep the engine's own world coordinates as the slide's
 * local coordinates. The display group carries the slide's similarity
 * transform, visibility and opacity multipliers, so content never has to be
 * copied or retargeted. Backgrounds (grids, focus-only decorations) render
 * before content and overlays (design borders) after it; both stay outside
 * local membership, so `clear()` preserves authoring guides.
 */
import * as THREE from 'three';
import {
  Mobject,
  VMobject,
  restructureListToExcludeCertainFamilyMembers,
} from 'manim-web';
import { Transform } from './geometry';
import { DISPLAY_GROUP_FLAG } from './patches';

/** Scene membership protocol used by engine animation setup and cleanup. */
export class LocalScene {
  mobjects: Mobject[] = [];

  /** Every local top-level mobject and descendant. */
  getMobjectFamilyMembers(): Mobject[] {
    const result: Mobject[] = [];
    for (const mob of this.mobjects) result.push(...mob.getFamily());
    return result;
  }

  /** Add mobjects using the engine's family-membership semantics. */
  add(...mobjects: Mobject[]): this {
    for (const mob of mobjects) {
      if (!(mob instanceof Mobject)) throw new TypeError('Only engine Mobjects can be added to a slide');
    }
    const families = mobjects.flatMap((mob) => mob.getFamily());
    this.mobjects = restructureListToExcludeCertainFamilyMembers(this.mobjects, families);
    for (const mob of mobjects) if (!this.mobjects.includes(mob)) this.mobjects.push(mob);
    return this;
  }

  /** Remove mobjects and their descendants from local membership. */
  remove(...mobjects: Mobject[]): this {
    this.mobjects = restructureListToExcludeCertainFamilyMembers(this.mobjects, mobjects);
    return this;
  }

  clear(): this {
    this.mobjects = [];
    return this;
  }

  /** Preserve draw order for replacement transforms, including grouped children. */
  replace(oldMobject: Mobject, newMobject: Mobject): this {
    const index = this.mobjects.indexOf(oldMobject);
    if (index >= 0) {
      this.mobjects[index] = newMobject;
      return this;
    }
    for (const mob of this.getMobjectFamilyMembers()) {
      const childIndex = mob.children.indexOf(oldMobject);
      if (childIndex >= 0) {
        mob.remove(oldMobject);
        mob.add(newMobject);
        return this;
      }
    }
    throw new Error('Cannot replace an object absent from the local scene');
  }

  /** Advance updaters for the locally active mobjects by `dt` seconds. */
  updateMobjects(dt: number): void {
    for (const mob of this.mobjects) mob.update(dt);
  }
}

function applyFlatDepth(object: THREE.Object3D): void {
  const meshLike = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
  if (!meshLike.material) return;
  const materials = Array.isArray(meshLike.material) ? meshLike.material : [meshLike.material];
  for (const material of materials) {
    if (material.depthTest || material.depthWrite) {
      material.depthTest = false;
      material.depthWrite = false;
    }
  }
}

function scaleOpacity(object: THREE.Object3D, factor: number): void {
  object.traverse((node) => {
    const meshLike = node as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
    if (!meshLike.material) return;
    const materials = Array.isArray(meshLike.material) ? meshLike.material : [meshLike.material];
    for (const material of materials) {
      material.opacity *= factor;
      material.transparent = true;
    }
  });
}

function markFamilyDirty(mob: Mobject): void {
  for (const member of mob.getFamily()) member._dirty = true;
}

export interface DisplayOptions {
  contentOpacity: number;
  gridOpacity: number;
  backgrounds?: Mobject[];
  overlays?: Mobject[];
}

/** One persistent Three.js group per slide, synchronized from local membership. */
export class Display {
  readonly local: LocalScene;
  readonly group = new THREE.Group();
  readonly gridGroup = new THREE.Group();
  readonly contentGroup = new THREE.Group();
  readonly overlayGroup = new THREE.Group();
  contentOpacity: number;
  gridOpacity: number;
  backgrounds: Mobject[];
  overlays: Mobject[];
  transform = new Transform();
  /** True until the next render assigns draw order to new Three.js objects. */
  orderDirty = true;
  private _attached = { grid: [] as Mobject[], content: [] as Mobject[], overlay: [] as Mobject[] };
  private _strokeContext: { width: number; height: number; slide: number } | null = null;
  private _needsOpacityReset = false;
  private _baseVisible = true;
  private _culled = false;

  constructor(local: LocalScene, options: DisplayOptions) {
    this.local = local;
    for (const [name, value] of [['contentOpacity', options.contentOpacity], ['gridOpacity', options.gridOpacity]] as const) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between zero and one`);
    }
    this.contentOpacity = options.contentOpacity;
    this.gridOpacity = options.gridOpacity;
    this.backgrounds = [...(options.backgrounds ?? [])];
    this.overlays = [...(options.overlays ?? [])];
    this.group.userData[DISPLAY_GROUP_FLAG] = true;
    this.group.matrixAutoUpdate = false;
    this.group.add(this.gridGroup, this.contentGroup, this.overlayGroup);
  }

  /** Point the display at a transform and reconcile Three.js children with membership. */
  sync(transform: Transform): void {
    if (!transform.equals(this.transform)) {
      this.transform = transform;
      this.group.matrix.copy(transform.toMatrix4());
      this.group.matrixWorldNeedsUpdate = true;
      this._strokeContext = null;
    }
    this._reconcile(this.gridGroup, this.backgrounds, 'grid');
    this._reconcile(this.contentGroup, this.local.mobjects, 'content');
    this._reconcile(this.overlayGroup, this.overlays, 'overlay');
    this.gridGroup.visible = this.gridOpacity > 0 && this.backgrounds.length > 0;
    this.contentGroup.visible = this.contentOpacity > 0;
    this._baseVisible = this.gridGroup.visible || this.contentGroup.visible || this.overlays.length > 0;
    this.group.visible = this._baseVisible && !this._culled;
  }

  /** Hide the whole display while it lies outside the camera view. */
  setCulled(culled: boolean): void {
    if (culled === this._culled) return;
    this._culled = culled;
    this.group.visible = this._baseVisible && !culled;
  }

  private _reconcile(group: THREE.Group, members: Mobject[], key: keyof Display['_attached']): void {
    const previous = this._attached[key];
    const same = previous.length === members.length && previous.every((mob, i) => mob === members[i]);
    if (same) return;
    for (const child of [...group.children]) group.remove(child);
    for (const mob of members) group.add(mob.getThreeObject());
    this._attached[key] = [...members];
    this.orderDirty = true;
  }

  /** All mobjects whose Three.js objects this display shows. */
  members(): Mobject[] {
    return [...this.backgrounds, ...this.local.mobjects, ...this.overlays];
  }

  /**
   * Prepare for one render: sync dirty mobjects, rescale strokes for the
   * camera, apply opacity multipliers and assign draw order.
   */
  prepareRender(rendererWidth: number, rendererHeight: number, cameraWidth: number, nextOrder: () => number): void {
    if (!this.group.visible) return;
    const effectiveFrame = cameraWidth / this.transform.scale;
    const context = this._strokeContext;
    const contextChanged =
      !context || context.width !== rendererWidth || context.height !== rendererHeight ||
      Math.abs(context.slide - effectiveFrame) > 1e-9 * Math.max(1, effectiveFrame);
    if (contextChanged) this._strokeContext = { width: rendererWidth, height: rendererHeight, slide: effectiveFrame };
    const partial = {
      grid: this.gridGroup.visible && this.gridOpacity < 1,
      content: this.contentGroup.visible && this.contentOpacity < 1,
    };
    const visit = (members: Mobject[], visible: boolean, forceDirty: boolean) => {
      for (const mob of members) {
        if (contextChanged || forceDirty) {
          for (const member of mob.getFamily()) {
            if (contextChanged && member instanceof VMobject) {
              member._setSceneContext(rendererWidth, rendererHeight, effectiveFrame);
            }
            member._dirty = true;
          }
        }
        if (!visible) continue;
        if (mob._dirty) {
          mob._syncToThree();
          this.orderDirty = true;
        }
      }
    };
    // Members multiplied last render must be resynchronized from their logical styles.
    const reset = this._needsOpacityReset;
    visit(this.backgrounds, this.gridGroup.visible, reset);
    visit(this.local.mobjects, this.contentGroup.visible, reset);
    visit(this.overlays, true, false);
    this._needsOpacityReset = false;
    if (this.orderDirty) {
      for (const group of [this.gridGroup, this.contentGroup, this.overlayGroup]) {
        for (const child of group.children) {
          const order = nextOrder();
          child.traverse((node) => {
            node.renderOrder = order;
            applyFlatDepth(node);
          });
        }
      }
      this.orderDirty = false;
    }
    if (partial.grid) {
      scaleOpacity(this.gridGroup, this.gridOpacity);
      this._needsOpacityReset = true;
    }
    if (partial.content) {
      scaleOpacity(this.contentGroup, this.contentOpacity);
      this._needsOpacityReset = true;
    }
    if (partial.grid || partial.content) {
      for (const mob of partial.grid ? this.backgrounds : []) markFamilyDirty(mob);
      for (const mob of partial.content ? this.local.mobjects : []) markFamilyDirty(mob);
    }
  }

  /** Force stroke widths to be recomputed at the next render. */
  invalidateStrokes(): void {
    this._strokeContext = null;
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
  }
}
