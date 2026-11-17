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

/**
 * A slide is flat: nothing tests depth, and everything is drawn in one pass, the transparent one,
 * in draw order. Three.js draws opaque materials before transparent ones whatever their order, and
 * the engine marks a stroke at full opacity opaque but a fill transparent, so a fill would cover
 * every stroke, even one that follows it. Blending a fully opaque color changes nothing.
 */
function applyFlatDepth(object: THREE.Object3D): void {
  const meshLike = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
  if (!meshLike.material) return;
  const materials = Array.isArray(meshLike.material) ? meshLike.material : [meshLike.material];
  for (const material of materials) {
    if (material.depthTest || material.depthWrite) {
      material.depthTest = false;
      material.depthWrite = false;
    }
    if (!material.transparent) material.transparent = true;
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

/**
 * Members shown before their slide is first visited (`step=-1`): they sit in a group of the
 * display that the content opacity never scales, so a child's caption shows in the parent's
 * view while the rest of the child waits for the entry fade.
 */
const EARLY_MEMBERS = new WeakSet<Mobject>();

/**
 * Where a member stands in its slide's source: members draw in that order, whenever each one
 * entered the slide, so an element revealed at a later click still lies under what follows it in
 * the source. Members without a rank (an effect's flash, a code-authored slide's objects) keep
 * the order they entered in, after the ranked ones.
 */
const SOURCE_RANKS = new WeakMap<Mobject, number>();

export function setSourceRank(mob: Mobject, rank: number): void {
  SOURCE_RANKS.set(mob, rank);
}

/** A member's place in its slide's source, if it has one. */
export function sourceRank(mob: Mobject): number | undefined {
  return SOURCE_RANKS.get(mob);
}

/** `members` in source order, a stable sort that leaves members without a rank last, in their order. */
export function inSourceOrder(members: Mobject[]): Mobject[] {
  if (!members.some((mob) => SOURCE_RANKS.has(mob))) return members;
  return members
    .map((mob, index) => ({ mob, index, rank: SOURCE_RANKS.get(mob) ?? Infinity }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ mob }) => mob);
}

export function markEarly(mob: Mobject): void {
  EARLY_MEMBERS.add(mob);
}

export function isEarly(mob: Mobject): boolean {
  return EARLY_MEMBERS.has(mob);
}

export interface DisplayOptions {
  contentOpacity: number;
  /** The early members' opacity (default 1): zero until the parent's stop before the visit reveals them. */
  earlyOpacity?: number;
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
  /** The members shown before the first visit, outside the entry fade. */
  readonly earlyGroup = new THREE.Group();
  readonly overlayGroup = new THREE.Group();
  contentOpacity: number;
  /** The opacity of the members shown before the first visit, faded in by the stop that precedes it. */
  earlyOpacity: number;
  gridOpacity: number;
  backgrounds: Mobject[];
  overlays: Mobject[];
  transform = new Transform();
  /** True until the next render assigns draw order to new Three.js objects. */
  orderDirty = true;
  private _attached = { grid: [] as Mobject[], content: [] as Mobject[], early: [] as Mobject[], overlay: [] as Mobject[] };
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
    this.earlyOpacity = options.earlyOpacity ?? 1;
    this.gridOpacity = options.gridOpacity;
    this.backgrounds = [...(options.backgrounds ?? [])];
    this.overlays = [...(options.overlays ?? [])];
    this.group.userData[DISPLAY_GROUP_FLAG] = true;
    this.group.matrixAutoUpdate = false;
    this.group.add(this.gridGroup, this.contentGroup, this.earlyGroup, this.overlayGroup);
  }

  /** The members that fade in with the slide, and those shown before its first visit. */
  private _split(): { content: Mobject[]; early: Mobject[] } {
    const content: Mobject[] = [];
    const early: Mobject[] = [];
    for (const mob of inSourceOrder(this.local.mobjects)) (isEarly(mob) ? early : content).push(mob);
    return { content, early };
  }

  /** Point the display at a transform and reconcile Three.js children with membership. */
  sync(transform: Transform): void {
    if (!transform.equals(this.transform)) {
      this.transform = transform;
      this.group.matrix.copy(transform.toMatrix4());
      this.group.matrixWorldNeedsUpdate = true;
      this._strokeContext = null;
    }
    const { content, early } = this._split();
    this._reconcile(this.gridGroup, this.backgrounds, 'grid');
    this._reconcile(this.contentGroup, content, 'content');
    this._reconcile(this.earlyGroup, early, 'early');
    this._reconcile(this.overlayGroup, this.overlays, 'overlay');
    this.gridGroup.visible = this.gridOpacity > 0 && this.backgrounds.length > 0;
    this.contentGroup.visible = this.contentOpacity > 0;
    this.earlyGroup.visible = early.length > 0 && this.earlyOpacity > 0;
    this._baseVisible = this.gridGroup.visible || this.contentGroup.visible || this.earlyGroup.visible || this.overlays.length > 0;
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
      early: this.earlyGroup.visible && this.earlyOpacity < 1,
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
    const { content, early } = this._split();
    visit(this.backgrounds, this.gridGroup.visible, reset);
    visit(content, this.contentGroup.visible, reset);
    visit(early, this.earlyGroup.visible, reset);
    visit(this.overlays, true, false);
    this._needsOpacityReset = false;
    if (this.orderDirty) {
      // Each member draws after the ones before it, and inside it every shape after the shapes
      // before it in the family (an SVG's paths in document order): a fill never covers a stroke
      // that follows it. The family is listed parents first, so each Three.js node ends with the
      // order of the innermost mobject it belongs to.
      const attached = this._attached;
      for (const members of [attached.grid, attached.content, attached.early, attached.overlay]) {
        for (const mob of members) {
          const order = nextOrder();
          const family = mob.getFamily();
          family.forEach((member, index) => {
            const own = order + index / (family.length + 1);
            member.getThreeObject().traverse((node) => {
              node.renderOrder = own;
              applyFlatDepth(node);
            });
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
    if (partial.early) {
      scaleOpacity(this.earlyGroup, this.earlyOpacity);
      this._needsOpacityReset = true;
    }
    if (partial.grid || partial.content || partial.early) {
      for (const mob of partial.grid ? this.backgrounds : []) markFamilyDirty(mob);
      for (const mob of partial.content ? content : []) markFamilyDirty(mob);
      for (const mob of partial.early ? early : []) markFamilyDirty(mob);
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
