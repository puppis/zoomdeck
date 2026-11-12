/**
 * Small runtime adjustments to engine so logical mobjects can live under
 * a transformed Three.js display group while keeping local coordinates.
 *
 * Logical mobjects are never parented to another Mobject by the presenter,
 * so every engine world-space method already works in slide-local
 * coordinates. The only place the display transform leaks back is
 * Three.js-based bounds for textured mobjects (Text, images), which read
 * `matrixWorld`. Those measurements neutralize the display groups first.
 */
import * as THREE from 'three';
import { Mobject } from 'manim-web';

/** Marker stored in `userData` of every display group created by this library. */
export const DISPLAY_GROUP_FLAG = 'zoomdeckDisplay';
/** `userData` key under which a display group names the slide it draws. */
export const DISPLAY_SLIDE_KEY = 'zoomdeckSlide';

let installed = false;

function withNeutralDisplay<T>(mobject: Mobject, measure: () => T): T {
  const object = mobject._threeObject;
  const groups: THREE.Object3D[] = [];
  for (let node = object?.parent ?? null; node; node = node.parent) {
    if (node.userData[DISPLAY_GROUP_FLAG]) groups.push(node);
  }
  if (groups.length === 0) return measure();
  const saved = groups.map((group) => group.matrix.clone());
  for (const group of groups) group.matrix.identity();
  try {
    return measure();
  } finally {
    groups.forEach((group, index) => {
      group.matrix.copy(saved[index]);
      // The measurement may have pushed the neutral matrix into the world matrices; restore the
      // group's own at once (callers read it) and let the next render refresh the subtree.
      group.updateWorldMatrix(true, false);
      group.matrixWorldNeedsUpdate = true;
    });
  }
}

/** Install the patches once. Safe to call repeatedly. */
export function installPatches(): void {
  if (installed) return;
  installed = true;
  const proto = Mobject.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const originalBounds = proto.getBounds;
  const originalBox = proto.getBoundingBox;
  proto.getBounds = function (this: Mobject, ...args: unknown[]) {
    return withNeutralDisplay(this, () => originalBounds.apply(this, args));
  };
  proto.getBoundingBox = function (this: Mobject, ...args: unknown[]) {
    return withNeutralDisplay(this, () => originalBox.apply(this, args));
  };
}
