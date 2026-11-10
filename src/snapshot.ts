/**
 * Compact, identity-preserving state capture for mobjects.
 *
 * A snapshot records numeric transform, style, geometry, children and
 * updater references of one family member. Restoring writes them back onto
 * the same object, so animations, updaters and scene membership keep their
 * identities across restores.
 */
import { Mobject, VMobject, type UpdaterFunction } from 'manim-web';

/** Optional hook for mobjects with state outside the engine's numeric fields. */
export interface SnapshotExtra {
  captureExtra(): unknown;
  restoreExtra(value: unknown): void;
}

function hasExtra(mob: Mobject): mob is Mobject & SnapshotExtra {
  const candidate = mob as Partial<SnapshotExtra>;
  return typeof candidate.captureExtra === 'function' && typeof candidate.restoreExtra === 'function';
}

interface VMobjectInternals {
  _points3D: number[][];
  _visiblePointCount: number | null;
  _geometryDirty: boolean;
}

interface TextLike {
  getText(): string;
  setText(text: string): unknown;
  getFontSize(): number;
  setFontSize(size: number): unknown;
}

interface TrackerLike {
  getValue(): number;
  setValue(value: number): unknown;
}

function isTextLike(mob: Mobject): mob is Mobject & TextLike {
  const t = mob as Partial<TextLike>;
  return typeof t.getText === 'function' && typeof t.setText === 'function' && typeof t.getFontSize === 'function';
}

function isTrackerLike(mob: Mobject): mob is Mobject & TrackerLike {
  const t = mob as Partial<TrackerLike>;
  return typeof t.getValue === 'function' && typeof t.setValue === 'function' && !(mob instanceof VMobject);
}

export interface MemberState {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  opacity: number;
  fillOpacity: number;
  strokeWidth: number;
  color: string;
  strokeColor: string | undefined;
  fillColor: string | undefined;
  /** Copy of the own control points, or null for non-vector mobjects. */
  points: number[][] | null;
  /** Reference to the live points array when captured, for cheap change checks. */
  pointsRef: number[][] | null;
  visiblePointCount: number | null;
  children: Mobject[];
  updaters: UpdaterFunction[];
  text: string | null;
  fontSize: number | null;
  value: number | null;
  extra: unknown;
}

/** Capture one family member (not its descendants). */
export function captureMember(mob: Mobject): MemberState {
  const colors = mob._getColorState();
  const vm = mob instanceof VMobject ? (mob as unknown as VMobjectInternals) : null;
  return {
    position: [mob.position.x, mob.position.y, mob.position.z],
    rotation: [mob.rotation.x, mob.rotation.y, mob.rotation.z],
    scale: [mob.scaleVector.x, mob.scaleVector.y, mob.scaleVector.z],
    opacity: mob.opacity,
    fillOpacity: mob.fillOpacity,
    strokeWidth: mob.strokeWidth,
    color: colors.color,
    strokeColor: colors.strokeColor,
    fillColor: colors.fillColor,
    points: vm ? vm._points3D.map((p) => [...p]) : null,
    pointsRef: vm ? vm._points3D : null,
    visiblePointCount: vm ? vm._visiblePointCount : null,
    children: [...mob.children],
    updaters: mob.getUpdaters(),
    text: isTextLike(mob) ? mob.getText() : null,
    fontSize: isTextLike(mob) ? mob.getFontSize() : null,
    value: isTrackerLike(mob) ? mob.getValue() : null,
    extra: hasExtra(mob) ? mob.captureExtra() : undefined,
  };
}

/** Cheap test used to decide whether a member needs a fresh capture. */
export function memberChanged(mob: Mobject, previous: MemberState): boolean {
  if (mob.position.x !== previous.position[0] || mob.position.y !== previous.position[1] || mob.position.z !== previous.position[2]) return true;
  if (mob.rotation.x !== previous.rotation[0] || mob.rotation.y !== previous.rotation[1] || mob.rotation.z !== previous.rotation[2]) return true;
  if (mob.scaleVector.x !== previous.scale[0] || mob.scaleVector.y !== previous.scale[1] || mob.scaleVector.z !== previous.scale[2]) return true;
  if (mob.opacity !== previous.opacity || mob.fillOpacity !== previous.fillOpacity || mob.strokeWidth !== previous.strokeWidth) return true;
  const colors = mob._getColorState();
  if (colors.color !== previous.color || colors.strokeColor !== previous.strokeColor || colors.fillColor !== previous.fillColor) return true;
  if (mob instanceof VMobject) {
    const vm = mob as unknown as VMobjectInternals;
    if (vm._points3D !== previous.pointsRef || vm._points3D.length !== (previous.points?.length ?? 0)) return true;
    if (vm._visiblePointCount !== previous.visiblePointCount) return true;
  }
  if (mob.children.length !== previous.children.length || mob.children.some((child, i) => child !== previous.children[i])) return true;
  const updaters = mob.getUpdaters();
  if (updaters.length !== previous.updaters.length || updaters.some((fn, i) => fn !== previous.updaters[i])) return true;
  if (isTextLike(mob) && (mob.getText() !== previous.text || mob.getFontSize() !== previous.fontSize)) return true;
  if (isTrackerLike(mob) && mob.getValue() !== previous.value) return true;
  return false;
}

/** Write a captured state back onto the same member. */
export function restoreMember(mob: Mobject, state: MemberState): void {
  mob.position.set(state.position[0], state.position[1], state.position[2]);
  mob.rotation.set(state.rotation[0], state.rotation[1], state.rotation[2]);
  mob.scaleVector.set(state.scale[0], state.scale[1], state.scale[2]);
  if (isTextLike(mob)) {
    if (mob.getFontSize() !== state.fontSize && state.fontSize !== null) mob.setFontSize(state.fontSize);
    if (mob.getText() !== state.text && state.text !== null) mob.setText(state.text);
  }
  mob._setColorState({ color: state.color, strokeColor: state.strokeColor, fillColor: state.fillColor });
  mob.opacity = state.opacity;
  mob.setFillOpacity(state.fillOpacity);
  mob.setStrokeWidth(state.strokeWidth);
  if (mob instanceof VMobject && state.points) {
    const vm = mob as unknown as VMobjectInternals;
    vm._points3D = state.points.map((p) => [...p]);
    vm._visiblePointCount = state.visiblePointCount;
    vm._geometryDirty = true;
    mob._markDirtyUpward();
  }
  const sameChildren =
    mob.children.length === state.children.length && mob.children.every((child, i) => child === state.children[i]);
  if (!sameChildren) {
    for (const child of [...mob.children]) mob.remove(child);
    for (const child of state.children) mob.add(child);
  }
  const updaters = mob.getUpdaters();
  const sameUpdaters = updaters.length === state.updaters.length && updaters.every((fn, i) => fn === state.updaters[i]);
  if (!sameUpdaters) {
    mob.clearUpdaters();
    for (const fn of state.updaters) mob.addUpdater(fn);
  }
  if (isTrackerLike(mob) && state.value !== null && mob.getValue() !== state.value) mob.setValue(state.value);
  if (hasExtra(mob) && state.extra !== undefined) mob.restoreExtra(state.extra);
  mob._markDirty();
}
