/**
 * Text batches: one draw call for a run of text lines instead of one per line.
 *
 * A slide shown small, or a front page previewing a whole deck, puts hundreds of text lines on
 * screen, each its own mesh and texture, and the renderer's time goes into issuing them. At rest
 * the batcher walks each visible slide's members in draw order, takes every run of consecutive
 * members that draw nothing but text lines, copies the lines' rasters into one atlas canvas and
 * draws them as one mesh with the run's draw order. The pixels are the lines' own rasters,
 * sampled with the same mapping and the same resting alignment, so nothing changes on screen.
 *
 * The lines stay what they are: each keeps its mesh (moved to an unrendered layer) and its
 * place in the tree, so layout, links, animations and snapshots work as before. Every frame the
 * batch reads each line's world matrix, visibility and opacity and writes its quad; a line whose
 * raster changes or that an effect masks between two rests leaves the batch and is drawn on its
 * own until the next rest, when the batches are rebuilt.
 */
import * as THREE from 'three';
import type { StyledLine } from '../markup/text';
import type { Presenter } from '../runtime';
import type { Display } from '../display';

type LineMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

/** The largest atlas page, and the largest raster that goes into one; a bigger raster is drawn on its own. */
const MAX_PAGE = 4096;
const MAX_RASTER = 2048;
/** Transparent pixels between rasters, so that filtering never reads a neighbour. */
const PADDING = 4;

interface Slot {
  line: StyledLine;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The raster version copied into the page. */
  version: number;
  /** Left the batch: drawn on its own until the next rest. */
  dropped: boolean;
}

interface Batch {
  display: Display;
  /** The first member of the run, whose draw order the batch takes. */
  anchor: THREE.Object3D;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Holds the mesh: the renderer sorts by the nearest group's order first, as it does for a line's own group. */
  holder: THREE.Group;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  slots: Slot[];
  positions: THREE.BufferAttribute;
  uvs: THREE.BufferAttribute;
  colors: THREE.BufferAttribute;
}

const corner = new THREE.Vector3();

export class TextBatcher {
  private _batches: Batch[] = [];
  private _moving = false;

  constructor(private readonly scene: THREE.Scene) {}

  get batchCount(): number {
    return this._batches.length;
  }

  get batchedLines(): number {
    return this._batches.reduce((sum, batch) => sum + batch.slots.filter((slot) => !slot.dropped).length, 0);
  }

  /** Rebuild every batch from the rasters as they are now (called when a sharpening pass has finished). */
  rebuild(presenter: Presenter): void {
    this.clear();
    this._moving = false;
    for (const ctx of presenter.contexts.values()) {
      const display = ctx.display;
      if (!display.group.visible) continue;
      let run: { anchor: THREE.Object3D; lines: StyledLine[] } | null = null;
      const flush = () => {
        if (run && run.lines.length >= 2) this._makeBatches(display, run.anchor, run.lines);
        run = null;
      };
      for (const member of display.contentGroup.children) {
        const lines: StyledLine[] = [];
        let other = false;
        member.traverse((node) => {
          const line = node.userData?.styledLine as StyledLine | undefined;
          if (line) lines.push(line);
          else if ((node as THREE.Mesh).isMesh || (node as THREE.Line).isLine || (node as THREE.Points).isPoints || (node as THREE.Sprite).isSprite) other = true;
        });
        // A member that draws anything but text keeps its place in the order: the run ends here.
        if (other) {
          flush();
          continue;
        }
        if (!lines.length) continue;
        if (!run) run = { anchor: member, lines: [] };
        run.lines.push(...lines.filter(batchable));
      }
      flush();
    }
  }

  /** Pack a run's rasters into pages of at most MAX_PAGE and make a mesh for each. */
  private _makeBatches(display: Display, anchor: THREE.Object3D, lines: StyledLine[]): void {
    const widths = lines.map((line) => (line.canvasElement as HTMLCanvasElement).width);
    const pageWidth = Math.min(MAX_PAGE, Math.max(...widths) + 2 * PADDING);
    let slots: Slot[] = [];
    let x = PADDING;
    let y = PADDING;
    let rowHeight = 0;
    const close = () => {
      if (slots.length) this._makeBatch(display, anchor, slots, pageWidth, y + rowHeight + PADDING);
      slots = [];
      x = PADDING;
      y = PADDING;
      rowHeight = 0;
    };
    for (const line of lines) {
      const canvas = line.canvasElement as HTMLCanvasElement;
      const { width, height } = canvas;
      if (x + width + PADDING > pageWidth && slots.length) {
        x = PADDING;
        y += rowHeight + 2 * PADDING;
        rowHeight = 0;
      }
      if (y + height + PADDING > MAX_PAGE) close();
      slots.push({ line, x, y, width, height, version: line.rasterVersion, dropped: false });
      x += width + 2 * PADDING;
      rowHeight = Math.max(rowHeight, height);
    }
    close();
  }

  private _makeBatch(display: Display, anchor: THREE.Object3D, slots: Slot[], width: number, height: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    for (const slot of slots) {
      const source = slot.line.canvasElement as HTMLCanvasElement;
      const { x, y, width: w, height: h } = slot;
      context.drawImage(source, x, y);
      // A line's own texture clamps to its edge texels; the padding around its copy repeats them, so
      // that the samples reaching past the edge (the resting shift, the filter's reach) find the same.
      context.drawImage(source, 0, 0, 1, h, x - PADDING, y, PADDING, h);
      context.drawImage(source, w - 1, 0, 1, h, x + w, y, PADDING, h);
      context.drawImage(source, 0, 0, w, 1, x, y - PADDING, w, PADDING);
      context.drawImage(source, 0, h - 1, w, 1, x, y + h, w, PADDING);
      context.drawImage(source, 0, 0, 1, 1, x - PADDING, y - PADDING, PADDING, PADDING);
      context.drawImage(source, w - 1, 0, 1, 1, x + w, y - PADDING, PADDING, PADDING);
      context.drawImage(source, 0, h - 1, 1, 1, x - PADDING, y + h, PADDING, PADDING);
      context.drawImage(source, w - 1, h - 1, 1, 1, x + w, y + h, PADDING, PADDING);
    }
    const texture = new THREE.CanvasTexture(canvas);
    const sample = slots[0].line.lineTexture;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = sample?.anisotropy ?? 1;
    // Built at rest: the texels sit on the screen's pixels, sampled without mipmaps, as the lines' own would be.
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    const count = slots.length;
    const positions = new THREE.BufferAttribute(new Float32Array(count * 12), 3);
    const uvs = new THREE.BufferAttribute(new Float32Array(count * 8), 2);
    const colors = new THREE.BufferAttribute(new Float32Array(count * 16).fill(1), 4);
    const indices = new (count * 4 > 65535 ? Uint32Array : Uint16Array)(count * 6);
    for (let i = 0; i < count; i++) {
      const v = i * 4;
      indices.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', positions);
    geometry.setAttribute('uv', uvs);
    geometry.setAttribute('color', colors);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    positions.setUsage(THREE.DynamicDrawUsage);
    uvs.setUsage(THREE.DynamicDrawUsage);
    colors.setUsage(THREE.DynamicDrawUsage);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      depthWrite: false,
      depthTest: false,
      vertexColors: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = anchor.renderOrder;
    mesh.userData.textBatch = true;
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.renderOrder = anchor.renderOrder;
    holder.add(mesh);
    this.scene.add(holder);
    for (const slot of slots) slot.line.batched = true;
    this._batches.push({ display, anchor, mesh, holder, texture, canvas, slots, positions, uvs, colors });
  }

  /** The camera moves: sample the pages with mipmaps, as the lines' own textures would be. */
  setMotion(moving: boolean): void {
    if (moving === this._moving) return;
    this._moving = moving;
    for (const batch of this._batches) {
      batch.texture.minFilter = moving ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      batch.texture.generateMipmaps = moving;
      batch.texture.needsUpdate = true;
    }
  }

  /** Write every batched line's quad from its current matrix, visibility and opacity; called before each render. */
  sync(): void {
    for (const batch of this._batches) {
      // A run whose first member left the slide's tree (a restored snapshot rebuilt it) is drawn line by line again.
      if (batch.anchor.parent !== batch.display.contentGroup) {
        this._drop(batch);
        continue;
      }
      const visible = batch.display.group.visible;
      batch.holder.visible = visible;
      if (!visible) continue;
      batch.holder.renderOrder = batch.anchor.renderOrder;
      batch.mesh.renderOrder = batch.anchor.renderOrder;
      const positions = batch.positions.array as Float32Array;
      const uvs = batch.uvs.array as Float32Array;
      const colors = batch.colors.array as Float32Array;
      const pageWidth = batch.canvas.width;
      const pageHeight = batch.canvas.height;
      batch.slots.forEach((slot, i) => {
        const base = i * 12;
        const line = slot.line;
        const mesh = line.getTextureMesh() as LineMesh | null;
        let shown = !slot.dropped && mesh !== null;
        if (shown && mesh) {
          // A raster redrawn since the copy, or masked by an effect: back to its own draw call until the next rest.
          if (line.rasterVersion !== slot.version || mesh.material.alphaMap) {
            slot.dropped = true;
            line.batched = false;
            shown = false;
          }
        }
        if (shown && mesh) {
          for (let node: THREE.Object3D | null = mesh; node && node !== batch.display.group; node = node.parent) {
            if (!node.visible) {
              shown = false;
              break;
            }
          }
        }
        if (!shown || !mesh) {
          positions.fill(0, base, base + 12);
          for (let k = 0; k < 4; k++) colors[i * 16 + k * 4 + 3] = 0;
          return;
        }
        mesh.updateWorldMatrix(true, false);
        const m = mesh.matrixWorld;
        const { width, height } = mesh.geometry.parameters;
        const w = width / 2;
        const h = height / 2;
        const put = (k: number, x: number, y: number) => {
          corner.set(x, y, 0).applyMatrix4(m);
          positions[base + k * 3] = corner.x;
          positions[base + k * 3 + 1] = corner.y;
          positions[base + k * 3 + 2] = corner.z;
        };
        put(0, -w, h);
        put(1, w, h);
        put(2, -w, -h);
        put(3, w, -h);
        const opacity = mesh.material.opacity;
        for (let k = 0; k < 4; k++) colors[i * 16 + k * 4 + 3] = opacity;
        // The quad samples the line's texture as the line's own mesh would (its mapping and resting shift), inside the page.
        const { ox, oy, rx, ry } = line.textureMapping;
        const uvAt = (k: number, u0: number, v0: number) => {
          const u = ox + u0 * rx;
          const v = oy + v0 * ry;
          uvs[i * 8 + k * 2] = (slot.x + u * slot.width) / pageWidth;
          uvs[i * 8 + k * 2 + 1] = 1 - (slot.y + (1 - v) * slot.height) / pageHeight;
        };
        uvAt(0, 0, 1);
        uvAt(1, 1, 1);
        uvAt(2, 0, 0);
        uvAt(3, 1, 0);
      });
      batch.positions.needsUpdate = true;
      batch.uvs.needsUpdate = true;
      batch.colors.needsUpdate = true;
    }
  }

  /** Drop every batch; the lines draw themselves again. */
  clear(): void {
    for (const batch of this._batches) this._drop(batch);
    this._batches = [];
  }

  private _drop(batch: Batch): void {
    for (const slot of batch.slots) slot.line.batched = false;
    batch.slots = [];
    batch.holder.visible = false;
    this.scene.remove(batch.holder);
    batch.mesh.geometry.dispose();
    batch.mesh.material.dispose();
    batch.texture.dispose();
  }
}

/** Whether a line can go into a page: a raster that fits, and no effect mask on its material. */
function batchable(line: StyledLine): boolean {
  const mesh = line.getTextureMesh() as LineMesh | null;
  const canvas = line.canvasElement;
  if (!mesh || !canvas) return false;
  if (canvas.width > MAX_RASTER || canvas.height > MAX_RASTER) return false;
  return !mesh.material.alphaMap;
}
