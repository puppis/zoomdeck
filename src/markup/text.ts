/**
 * Prose typography for markup slides.
 *
 * A `StyledLine` draws one line of styled runs (bold, italic, color, code)
 * onto a canvas texture and records its typographic baseline and advance, so
 * mixed prose/math lines share a baseline and wrapped paragraphs keep
 * consistent line pitch. `layoutParagraph` wraps spans within a logical
 * width and assembles the resulting lines into one group whose
 * `markupBaselineFraction` exposes the first baseline for layout anchors.
 */
import * as THREE from 'three';
import { Group, Text, type Mobject } from 'manim-web';
import type { InlineSpan } from './ast';

/** Canvas pixels per world unit at resolution scale one: an em is `fontSize / 72` units. */
export const PX_PER_WORLD_BASE = 96;
const PADDING_PX = 2;

/** Supersampling scale for text canvases, as in the engine's Text. */
export function textResolutionScale(): number {
  const dpr = typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1;
  return 2 * Math.min(Math.max(dpr, 1), 2);
}

export interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  color: string;
  mono: boolean;
  /** Link target; linked runs are underlined and get a DOM hit area in the player. */
  href?: string | null;
}

/** A link's horizontal extent on a rendered line, in the line's local world coordinates. */
export interface LinkBox {
  href: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Every live line that carries links, for the player's link layer. */
export const LINKED_LINES = new Set<StyledLine>();

export interface StyledLineOptions {
  runs: TextRun[];
  fontSize: number;
  fontFamily: string;
  /** Color used when engine recolors the whole mobject (e.g. Indicate). */
  baseColor: string;
}

export const MONOSPACE = '"Latin Modern Mono", ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';

function fontString(run: Pick<TextRun, 'bold' | 'italic' | 'mono'>, px: number, family: string): string {
  return `${run.italic ? 'italic' : 'normal'} ${run.bold ? 'bold' : 'normal'} ${px}px ${run.mono ? MONOSPACE : family}`;
}

let measureContext: CanvasRenderingContext2D | null = null;

function measurer(): CanvasRenderingContext2D {
  if (!measureContext) {
    const canvas = document.createElement('canvas');
    measureContext = canvas.getContext('2d');
    if (!measureContext) throw new Error('Canvas 2D is required for text layout');
  }
  return measureContext;
}

export interface RunMetrics {
  advance: number;
  inkLeft: number;
  inkRight: number;
  ascent: number;
  descent: number;
  fontAscent: number;
  fontDescent: number;
}

/** Measure one run at `px` canvas pixels, in canvas pixels. */
export function measureRun(run: TextRun, px: number, family: string): RunMetrics {
  const ctx = measurer();
  ctx.font = fontString(run, px, family);
  const m = ctx.measureText(run.text);
  const fontAscent = m.fontBoundingBoxAscent ?? px * 0.8;
  const fontDescent = m.fontBoundingBoxDescent ?? px * 0.2;
  const blank = !run.text.trim();
  return {
    advance: m.width,
    inkLeft: blank ? 0 : -(m.actualBoundingBoxLeft ?? 0),
    inkRight: blank ? 0 : m.actualBoundingBoxRight ?? m.width,
    ascent: blank ? 0 : m.actualBoundingBoxAscent ?? fontAscent,
    descent: blank ? 0 : m.actualBoundingBoxDescent ?? fontDescent,
    fontAscent,
    fontDescent,
  };
}

/** One rendered line of styled prose with baseline metadata. */
export class StyledLine extends Text {
  private _runs: TextRun[] | null = null;
  private _family = '';
  private _baseColor = '#FFFFFF';
  /** Logical advance of the pen across the whole line, in world units. */
  advance = 0;
  /** World distance from the plane's left edge to the pen origin. */
  originInset = 0;
  /** Baseline height relative to the center, as a fraction of the plane height. */
  markupBaselineFraction = 0;
  /** Ink extents above and below the baseline, in world units. */
  inkAscent = 0;
  inkDescent = 0;
  /** Font line box above and below the baseline, in world units. */
  fontAscent = 0;
  fontDescent = 0;
  /** Link hit boxes in local coordinates (origin at the plane center). */
  links: LinkBox[] = [];

  constructor(options: StyledLineOptions) {
    super({
      text: options.runs.map((run) => run.text).join(''),
      fontSize: options.fontSize,
      fontFamily: options.fontFamily,
      color: options.baseColor,
      textAlign: 'left',
    });
    this._runs = options.runs;
    this._family = options.fontFamily;
    this._baseColor = options.baseColor;
    this._canvasDirty = true;
    this._renderToCanvas();
  }

  get runs(): TextRun[] {
    return this._runs ?? [];
  }

  /** Pixel size of the base font on the supersampled canvas. */
  private _px(): number {
    return (this.getFontSize() * 4) / 3 * textResolutionScale();
  }

  protected override _renderToCanvas(): void {
    if (!this._canvas || !this._ctx) return;
    const runs = this._runs;
    if (!runs) {
      // Called from the base constructor before runs exist.
      this._canvas.width = 1;
      this._canvas.height = 1;
      this._worldWidth = 0.01;
      this._worldHeight = 0.01;
      return;
    }
    const scale = textResolutionScale();
    const pxPerWorld = PX_PER_WORLD_BASE * scale;
    const px = this._px();
    const tint = this.color !== this._baseColor ? this.color : null;
    const metrics = runs.map((run) => measureRun(run, px, this._family));
    let cursor = 0;
    let inkLeft = Infinity;
    let inkRight = -Infinity;
    let ascent = 0;
    let descent = 0;
    let fontAscent = 0;
    let fontDescent = 0;
    metrics.forEach((m, i) => {
      if (runs[i].text.trim()) {
        inkLeft = Math.min(inkLeft, cursor + m.inkLeft);
        inkRight = Math.max(inkRight, cursor + m.inkRight);
      }
      ascent = Math.max(ascent, m.ascent);
      descent = Math.max(descent, m.descent);
      fontAscent = Math.max(fontAscent, m.fontAscent);
      fontDescent = Math.max(fontDescent, m.fontDescent);
      cursor += m.advance;
    });
    const empty = !Number.isFinite(inkLeft);
    if (empty) {
      inkLeft = 0;
      inkRight = 0;
    }
    const width = Math.max(1, Math.ceil(inkRight - inkLeft + 2 * PADDING_PX));
    // Underlines of links sit below the ink; keep room for them on the canvas.
    const underlineDepth = runs.some((run) => run.href) ? px * 0.1 + Math.max(1, px * 0.05) : 0;
    const height = Math.max(1, Math.ceil(ascent + Math.max(descent, underlineDepth) + 2 * PADDING_PX));
    this._canvas.width = width;
    this._canvas.height = height;
    const ctx = this._ctx;
    ctx.clearRect(0, 0, width, height);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const originX = PADDING_PX - inkLeft;
    const baselineY = PADDING_PX + ascent;
    let x = originX;
    const linkRuns: Array<{ href: string; from: number; to: number }> = [];
    runs.forEach((run, i) => {
      ctx.font = fontString(run, px, this._family);
      ctx.fillStyle = tint ?? run.color;
      ctx.globalAlpha = this.fillOpacity;
      if (run.text.trim()) ctx.fillText(run.text, x, baselineY);
      if (run.href) {
        const thickness = Math.max(1, px * 0.05);
        ctx.fillRect(x, baselineY + px * 0.1, metrics[i].advance, thickness);
        const last = linkRuns[linkRuns.length - 1];
        if (last && last.href === run.href && Math.abs(last.to - x) < 0.5) last.to = x + metrics[i].advance;
        else linkRuns.push({ href: run.href, from: x, to: x + metrics[i].advance });
      }
      x += metrics[i].advance;
    });
    this._worldWidth = width / pxPerWorld;
    this._worldHeight = height / pxPerWorld;
    this.links = linkRuns.map((run) => ({
      href: run.href,
      left: run.from / pxPerWorld - this._worldWidth / 2,
      right: run.to / pxPerWorld - this._worldWidth / 2,
      top: this._worldHeight / 2,
      bottom: -this._worldHeight / 2,
    }));
    if (this.links.length) LINKED_LINES.add(this);
    this.advance = cursor / pxPerWorld;
    this.originInset = originX / pxPerWorld;
    this.inkAscent = ascent / pxPerWorld;
    this.inkDescent = descent / pxPerWorld;
    this.fontAscent = fontAscent / pxPerWorld;
    this.fontDescent = fontDescent / pxPerWorld;
    const baselineWorld = this._worldHeight / 2 - baselineY / pxPerWorld;
    this.markupBaselineFraction = this._worldHeight > 0 ? baselineWorld / this._worldHeight : 0;
    this._canvasDirty = false;
    if (this._texture) this._texture.needsUpdate = true;
  }

  override copy(): StyledLine {
    const clone = new StyledLine({ runs: this.runs.map((run) => ({ ...run })), fontSize: this.getFontSize(), fontFamily: this._family, baseColor: this._baseColor });
    this._copyBaseAttributesInto(clone, { copyChildren: false });
    if (clone.color !== this.color) clone.setColor(this.color);
    return clone;
  }

  /** Place the pen origin at `x` with the baseline at `y`, in local coordinates. */
  placeOrigin(x: number, y: number): this {
    const centerX = x - this.originInset + this.getWidth() / 2;
    const centerY = y - this.markupBaselineFraction * this.getHeight();
    this.moveTo([centerX, centerY, 0]);
    return this;
  }
}

/** A math object laid out so that its left edge is at x = 0 and its baseline at y = 0. */
export interface MathPiece {
  mobject: Mobject;
  advance: number;
  ascent: number;
  descent: number;
}

export type MathFactory = (latex: string, color: string) => Promise<MathPiece>;

export interface ParagraphOptions {
  fontSize: number;
  maxWidth: number;
  defaultColor: string;
  fontFamily: string;
  lineGap: number;
}

type Atom = InlineSpan;
type Word = Atom[];

/** Split spans into paragraphs of words. */
export function inlineWords(spans: InlineSpan[]): Word[][] {
  const paragraphs: Word[][] = [];
  let words: Word[] = [];
  let current: Atom[] = [];
  let gap: Atom[] = [];
  for (const s of spans) {
    const atoms = s.kind === 'math' ? [s.content] : s.content.match(/\n|[^\S\n]+|[^\s]+/g) ?? [];
    for (const atom of atoms) {
      const part: Atom = { ...s, content: atom };
      if (s.kind !== 'math' && !atom.trim()) {
        if (current.length) {
          words.push(current);
          current = [];
        }
        if (atom === '\n') {
          paragraphs.push(words);
          words = [];
          gap = [];
        } else if (s.kind === 'code') gap.push(part);
        else gap = [{ content: ' ', kind: 'text', bold: false, italic: false, color: null, href: s.href ?? null }];
      } else {
        current.push(...gap);
        gap = [];
        current.push(part);
      }
    }
  }
  if (current.length) words.push(current);
  paragraphs.push(words);
  return paragraphs;
}

function runsOf(atoms: Atom[], defaultColor: string): TextRun[] {
  const runs: TextRun[] = [];
  for (const atom of atoms) {
    const run: TextRun = {
      text: atom.content, bold: atom.bold, italic: atom.italic, color: atom.color ?? defaultColor, mono: atom.kind === 'code', href: atom.href ?? null,
    };
    const last = runs[runs.length - 1];
    if (last && last.bold === run.bold && last.italic === run.italic && last.color === run.color && last.mono === run.mono && (last.href ?? null) === run.href) {
      last.text += run.text;
    } else runs.push(run);
  }
  return runs;
}

/** Group a word sequence into prose segments and math atoms. */
function segments(words: Word[]): Array<{ math: Atom } | { prose: Atom[] }> {
  const result: Array<{ math: Atom } | { prose: Atom[] }> = [];
  let prose: Atom[] = [];
  const atoms = words.flat();
  // Leading prose whitespace is discarded at a wrapped line start.
  let start = 0;
  while (start < atoms.length && atoms[start].kind === 'text' && !atoms[start].content.trim()) start += 1;
  for (const atom of atoms.slice(start)) {
    if (atom.kind === 'math') {
      if (prose.length) result.push({ prose });
      prose = [];
      result.push({ math: atom });
    } else prose.push(atom);
  }
  if (prose.length) result.push({ prose });
  return result;
}

interface ShapedLine {
  parts: Array<{ kind: 'text'; line: StyledLine } | { kind: 'math'; piece: MathPiece }>;
  advance: number;
  keepIndent: boolean;
}

/** Wrap spans to `maxWidth` logical units and assemble a left-aligned block. */
export async function layoutParagraph(spans: InlineSpan[], options: ParagraphOptions, mathFactory: MathFactory): Promise<Mobject> {
  const { fontSize, maxWidth, defaultColor, fontFamily, lineGap } = options;
  const scale = textResolutionScale();
  const pxPerWorld = PX_PER_WORLD_BASE * scale;
  const px = (fontSize * 4) / 3 * scale;
  const mathCache = new Map<string, Promise<MathPiece>>();
  const mathFor = (atom: Atom) => {
    const key = `${atom.color ?? defaultColor}\u0000${atom.content}`;
    if (!mathCache.has(key)) mathCache.set(key, mathFactory(atom.content, atom.color ?? defaultColor));
    return mathCache.get(key) as Promise<MathPiece>;
  };
  const advanceOf = async (words: Word[]): Promise<number> => {
    let total = 0;
    for (const segment of segments(words)) {
      if ('math' in segment) total += (await mathFor(segment.math)).advance;
      else for (const run of runsOf(segment.prose, defaultColor)) total += measureRun(run, px, fontFamily).advance / pxPerWorld;
    }
    return total;
  };
  const shape = async (words: Word[]): Promise<ShapedLine> => {
    const parts: ShapedLine['parts'] = [];
    let advance = 0;
    for (const segment of segments(words)) {
      if ('math' in segment) {
        const template = await mathFor(segment.math);
        const piece: MathPiece = { ...template, mobject: template.mobject.copy() };
        parts.push({ kind: 'math', piece });
        advance += piece.advance;
      } else {
        const line = new StyledLine({ runs: runsOf(segment.prose, defaultColor), fontSize, fontFamily, baseColor: defaultColor });
        parts.push({ kind: 'text', line });
        advance += line.advance;
      }
    }
    const first = words[0]?.[0];
    return { parts, advance, keepIndent: Boolean(first && first.kind === 'code' && !first.content.trim()) };
  };
  const lines: Array<ShapedLine | null> = [];
  for (const words of inlineWords(spans)) {
    if (!words.length) {
      lines.push(null);
      continue;
    }
    let start = 0;
    while (start < words.length) {
      let end = words.length;
      if (start === 0 && (await advanceOf(words)) <= maxWidth) end = words.length;
      else {
        // Exponential probing bounds one line, then binary search chooses its last whole word.
        let low = start + 1;
        let count = 2;
        let high = Math.min(start + count, words.length);
        while (high < words.length) {
          if ((await advanceOf(words.slice(start, high))) > maxWidth) break;
          low = high;
          count *= 2;
          high = Math.min(start + count, words.length);
        }
        while (low < high) {
          const middle = (low + high + 1) >> 1;
          if ((await advanceOf(words.slice(start, middle))) <= maxWidth) low = middle;
          else high = middle - 1;
        }
        end = low;
      }
      lines.push(await shape(words.slice(start, end)));
      start = end;
    }
  }
  const visible = lines.filter((line): line is ShapedLine => line !== null);
  if (!visible.length) return new Group();
  // Place parts along each line's baseline at y = 0, then measure extents.
  const lineGroups: Array<Group | null> = [];
  let ascent = 0;
  let descent = 0;
  for (const line of lines) {
    if (!line) {
      lineGroups.push(null);
      continue;
    }
    let cursor = 0;
    const members: Mobject[] = [];
    for (const part of line.parts) {
      if (part.kind === 'text') {
        part.line.placeOrigin(cursor, 0);
        cursor += part.line.advance;
        ascent = Math.max(ascent, part.line.inkAscent, part.line.fontAscent);
        descent = Math.max(descent, part.line.inkDescent, part.line.fontDescent);
        members.push(part.line);
      } else {
        part.piece.mobject.shift([cursor, 0, 0]);
        cursor += part.piece.advance;
        ascent = Math.max(ascent, part.piece.ascent);
        descent = Math.max(descent, part.piece.descent);
        members.push(part.piece.mobject);
      }
    }
    const group = new Group(...members);
    if (line.advance > maxWidth + 1e-6) {
      // A single unbreakable word can exceed the requested width.
      group.scale(maxWidth / line.advance, { aboutPoint: [0, 0, 0] });
    }
    lineGroups.push(group);
  }
  const spacing = ascent + descent + lineGap;
  const preserveIndent = visible.some((line) => line.keepIndent);
  const present = lineGroups.filter((g): g is Group => g !== null);
  const commonLeft = Math.min(...present.map((group) => group.getLeft()[0]));
  lineGroups.forEach((group, number) => {
    if (!group) return;
    const left = preserveIndent ? commonLeft : group.getLeft()[0];
    group.shift([-left, -number * spacing, 0]);
  });
  const block = new Group(...present) as Group & { markupBaselineFraction: number };
  const height = block.getHeight();
  block.markupBaselineFraction = height > 0 ? -block.getCenter()[1] / height : 0;
  block.center();
  return block;
}

/** Read a typographic baseline from current measured geometry. */
export function baselineY(obj: Mobject): number {
  const fraction = (obj as Mobject & { markupBaselineFraction?: number }).markupBaselineFraction ?? 0;
  return obj.getCenter()[1] + fraction * obj.getHeight();
}

export { THREE };
