/**
 * Similarity transforms between a slide's logical canvas and world space.
 *
 * `world = M · local + offset`, where `M` holds only a uniform scale and a
 * proper rotation. Shear, non-uniform scale, reflections and singular
 * matrices are rejected so nested slides keep their local geometry at every
 * zoom level. Independent of the engine's animation lifecycle.
 */
import * as THREE from 'three';

export type Vec3 = [number, number, number];

/** Return `value` as a finite positive number or throw. */
export function positive(value: number, name: string): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) {
    throw new Error(`${name} must be finite and positive`);
  }
  return result;
}

/** Normalize a finite two- or three-dimensional point to a 3-vector. */
export function point(value: ArrayLike<number>): Vec3 {
  if (value.length === 2) {
    const [x, y] = [Number(value[0]), Number(value[1])];
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('A point must contain finite coordinates');
    return [x, y, 0];
  }
  if (value.length !== 3) throw new Error('A point must contain two or three finite coordinates');
  const result: Vec3 = [Number(value[0]), Number(value[1]), Number(value[2])];
  if (!result.every(Number.isFinite)) throw new Error('A point must contain two or three finite coordinates');
  return result;
}

const IDENTITY: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** An immutable similarity transform; `matrix` is a row-major 3 × 3 array. */
export class Transform {
  readonly matrix: readonly number[];
  readonly offset: Readonly<Vec3>;

  constructor(matrix: ArrayLike<number> = IDENTITY, offset: ArrayLike<number> = [0, 0, 0]) {
    const m = Array.from(matrix, Number);
    if (m.length !== 9 || !m.every(Number.isFinite)) throw new Error('matrix must be a finite 3 by 3 array');
    // gram = Mᵀ M must equal s² I.
    const gram = (i: number, j: number) => m[i] * m[j] + m[i + 3] * m[j + 3] + m[i + 6] * m[j + 6];
    const s2 = gram(0, 0);
    const tolerance = 1e-7 * Math.max(1, s2);
    const uniform =
      s2 > 0 &&
      Math.abs(gram(1, 1) - s2) <= tolerance &&
      Math.abs(gram(2, 2) - s2) <= tolerance &&
      Math.abs(gram(0, 1)) <= tolerance &&
      Math.abs(gram(0, 2)) <= tolerance &&
      Math.abs(gram(1, 2)) <= tolerance;
    if (!uniform) throw new Error('Only uniform scale and rotation are supported');
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    if (det <= 0) throw new Error('Reflections are not supported');
    this.matrix = Object.freeze(m);
    this.offset = Object.freeze(point(offset)) as Readonly<Vec3>;
  }

  /** Uniform scale factor carried by the transform. */
  get scale(): number {
    const m = this.matrix;
    return Math.hypot(m[0], m[3], m[6]);
  }

  /** Rotation angle about the z axis, in radians. */
  get angle(): number {
    return Math.atan2(this.matrix[3], this.matrix[0]);
  }

  /** Map one point from local to world coordinates. */
  apply(p: ArrayLike<number>): Vec3 {
    const [x, y, z] = point(p);
    const m = this.matrix;
    return [
      m[0] * x + m[1] * y + m[2] * z + this.offset[0],
      m[3] * x + m[4] * y + m[5] * z + this.offset[1],
      m[6] * x + m[7] * y + m[8] * z + this.offset[2],
    ];
  }

  /** Map several points from local to world coordinates. */
  applyAll(points: ArrayLike<number>[]): Vec3[] {
    return points.map((p) => this.apply(p));
  }

  /** Map one point from world back into local coordinates. */
  inverse(p: ArrayLike<number>): Vec3 {
    const [x, y, z] = point(p);
    const dx = x - this.offset[0];
    const dy = y - this.offset[1];
    const dz = z - this.offset[2];
    // The inverse of a similarity is Mᵀ / s².
    const m = this.matrix;
    const s2 = this.scale ** 2;
    return [
      (m[0] * dx + m[3] * dy + m[6] * dz) / s2,
      (m[1] * dx + m[4] * dy + m[7] * dz) / s2,
      (m[2] * dx + m[5] * dy + m[8] * dz) / s2,
    ];
  }

  /** Return the world transform obtained by placing `child` inside this transform. */
  compose(child: Transform): Transform {
    const a = this.matrix;
    const b = child.matrix;
    const product = new Array<number>(9);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        product[row * 3 + col] =
          a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
      }
    }
    return new Transform(product, this.apply(child.offset));
  }

  /**
   * Fit a logical canvas into the four corners of a rectangle with uniform
   * letterboxing. Corners follow the engine's Rectangle path order: top-left,
   * top-right, bottom-right, bottom-left.
   */
  static fit(corners: ArrayLike<number>[], width: number, height: number): Transform {
    if (corners.length !== 4) throw new Error('Slide viewport must remain a finite Rectangle');
    const [tl, tr, br, bl] = corners.map((c) => point(c));
    const horizontal: Vec3 = [tr[0] - tl[0], tr[1] - tl[1], tr[2] - tl[2]];
    const vertical: Vec3 = [tl[0] - bl[0], tl[1] - bl[1], tl[2] - bl[2]];
    const w = positive(Math.hypot(...horizontal), 'viewport width');
    const h = positive(Math.hypot(...vertical), 'viewport height');
    const x = horizontal.map((v) => v / w) as Vec3;
    const y = vertical.map((v) => v / h) as Vec3;
    if (Math.abs(x[0] * y[0] + x[1] * y[1] + x[2] * y[2]) > 1e-6) {
      throw new Error('Sheared slide viewports are not supported');
    }
    const z: Vec3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    const scale = Math.min(w / positive(width, 'logical width'), h / positive(height, 'logical height'));
    const center: Vec3 = [
      (tl[0] + tr[0] + br[0] + bl[0]) / 4,
      (tl[1] + tr[1] + br[1] + bl[1]) / 4,
      (tl[2] + tr[2] + br[2] + bl[2]) / 4,
    ];
    // Columns are the local axes expressed in world space.
    return new Transform(
      [x[0] * scale, y[0] * scale, z[0] * scale, x[1] * scale, y[1] * scale, z[1] * scale, x[2] * scale, y[2] * scale, z[2] * scale],
      center,
    );
  }

  /** The equivalent Three.js matrix, for display groups. */
  toMatrix4(): THREE.Matrix4 {
    const m = this.matrix;
    const o = this.offset;
    return new THREE.Matrix4().set(m[0], m[1], m[2], o[0], m[3], m[4], m[5], o[1], m[6], m[7], m[8], o[2], 0, 0, 0, 1);
  }

  /** Axis-aligned world bounds of a local axis-aligned rectangle centered at the origin. */
  boundsOfCanvas(width: number, height: number): { min: Vec3; max: Vec3 } {
    const w = width / 2;
    const h = height / 2;
    const corners = this.applyAll([
      [-w, -h, 0],
      [w, -h, 0],
      [w, h, 0],
      [-w, h, 0],
    ]);
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const c of corners) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], c[i]);
        max[i] = Math.max(max[i], c[i]);
      }
    }
    return { min, max };
  }

  equals(other: Transform): boolean {
    return this.matrix.every((v, i) => v === other.matrix[i]) && this.offset.every((v, i) => v === other.offset[i]);
  }
}
