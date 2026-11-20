/**
 * Where the links of a Slajdomat slide are. Figma exports a text with a hyperlink as outlined
 * paths, followed by one `<a><rect/></a>` per line of the link; the rectangles are relative to the
 * box of the text in Figma, which is not exported. This places them from the ink of the text
 * alone: vertically as tall as the font's line box around the line they belong to, horizontally
 * on the link's underline when there is one (Figma underlines links by default, as wide as the
 * link), otherwise around the words they cover.
 *
 * Adapted from the link geometry of Slajdomat's viewer (MIT license).
 */

/** A box in the units of the text's paths. */
export interface LinkBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The bounding box of a subpath; `rect` tells whether the subpath is an axis-parallel rectangle. */
interface Ink {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  rect: boolean;
}

/** Where the tallest letters start below the top of the font's line box, as a share of its height. */
const ASCENDER_GAP = 0.19;
/** Where an underline starts below the tallest letters, as a share of the line box's height. */
const UNDERLINE_DROP = 0.68;

const PARAMETERS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * The bounding boxes of the subpaths of an SVG path. Control points count as part of a subpath,
 * which is exact for outlined text, since fonts have points at the extremes of their curves.
 */
export function subpathBoxes(d: string): Ink[] {
  const boxes: Ink[] = [];
  let current: Ink | null = null;
  // The subpath is made of lines only so far, between these points.
  let corners = true;
  let vertices: number[][] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const close = () => {
    if (current && current.x0 <= current.x1) {
      const c = current;
      c.rect = corners && c.x1 > c.x0 && c.y1 > c.y0 && vertices.length >= 4
        && vertices.every(([vx, vy]) => (vx === c.x0 || vx === c.x1) && (vy === c.y0 || vy === c.y1));
      boxes.push(c);
    }
    current = null;
  };
  const point = (px: number, py: number, onCurve: boolean) => {
    if (!current) {
      current = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, rect: false };
      corners = true;
      vertices = [];
      // A subpath that goes on after being closed starts where the previous one started.
      if (px !== x || py !== y) point(x, y, true);
    }
    const c = current as Ink;
    c.x0 = Math.min(c.x0, px);
    c.y0 = Math.min(c.y0, py);
    c.x1 = Math.max(c.x1, px);
    c.y1 = Math.max(c.y1, py);
    if (!onCurve) corners = false;
    if (corners && vertices.length < 16) vertices.push([px, py]);
    else corners = false;
  };
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  let command = '';
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) {
      command = tokens[i];
      i += 1;
    }
    const type = command.toUpperCase();
    const count = PARAMETERS[type];
    if (count === undefined || i + count > tokens.length) break;
    const relative = command !== type;
    const p = tokens.slice(i, i + count).map(Number);
    i += count;
    switch (type) {
      case 'M':
        close();
        x = startX = relative ? x + p[0] : p[0];
        y = startY = relative ? y + p[1] : p[1];
        point(x, y, true);
        // Further pairs of coordinates are lines.
        command = relative ? 'l' : 'L';
        break;
      case 'Z':
        close();
        x = startX;
        y = startY;
        break;
      case 'H':
        x = relative ? x + p[0] : p[0];
        point(x, y, true);
        break;
      case 'V':
        y = relative ? y + p[0] : p[0];
        point(x, y, true);
        break;
      case 'A':
        x = relative ? x + p[5] : p[5];
        y = relative ? y + p[6] : p[6];
        point(x, y, false);
        break;
      default: {
        // L, T, C, S, Q: pairs of coordinates, the last one the new position.
        for (let k = 0; k < count; k += 2) {
          point(relative ? x + p[k] : p[k], relative ? y + p[k + 1] : p[k + 1], k === count - 2 && (type === 'L' || type === 'T'));
        }
        x = relative ? x + p[count - 2] : p[count - 2];
        y = relative ? y + p[count - 1] : p[count - 1];
        if (type !== 'L') corners = false;
      }
    }
    if (type === 'Z' && i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) break;
  }
  close();
  return boxes;
}

/** A horizontal stretch of ink. */
interface Span {
  x0: number;
  x1: number;
}

/** A line of the text: its ink, and the top of its tallest letters. */
interface Line {
  top: number;
  ink: Ink[];
}

/** The ink of a text grouped into lines; the line pitch is about the height of the line box, the links' height. */
function textLines(ink: Ink[], height: number): Line[] {
  const lines: Line[] = [];
  for (const item of [...ink].sort((a, b) => a.y0 - b.y0)) {
    const line = lines[lines.length - 1];
    // The middle of anything on a line (even a comma) is higher than this, of anything on the next (even a quote) lower.
    if (line && (item.y0 + item.y1) / 2 < line.top + 0.85 * height) line.ink.push(item);
    else lines.push({ top: item.y0, ink: [item] });
  }
  return lines;
}

/** The words of a line: stretches of ink without a gap as wide as a space. */
function words(line: Line, height: number): Span[] {
  const spans: Span[] = [];
  for (const item of [...line.ink].sort((a, b) => a.x0 - b.x0)) {
    const last = spans[spans.length - 1];
    if (last && item.x0 - last.x1 < 0.125 * height) last.x1 = Math.max(last.x1, item.x1);
    else spans.push({ x0: item.x0, x1: item.x1 });
  }
  return spans;
}

/** Candidate underlines: thin rectangles, possibly interrupted where they would cross a letter's descender. */
function underlines(ink: Ink[], height: number): Array<Span & { y: number; parts: Ink[] }> {
  const thin = ink.filter((b) => b.rect && b.y1 - b.y0 <= 0.12 * height && b.x1 - b.x0 >= 3 * (b.y1 - b.y0));
  thin.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const found: Array<Span & { y: number; parts: Ink[] }> = [];
  for (let i = 0; i < thin.length; i++) {
    for (let j = i; j < thin.length; j++) {
      const sameRow = Math.abs(thin[j].y0 - thin[i].y0) < 0.1 && Math.abs(thin[j].y1 - thin[i].y1) < 0.1;
      if (!sameRow || (j > i && thin[j].x0 - thin[j - 1].x1 > 0.6 * height)) break;
      found.push({ x0: thin[i].x0, x1: thin[j].x1, y: thin[i].y0, parts: thin.slice(i, j + 1) });
    }
  }
  return found;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * The link rectangles that follow a text, in the coordinates of its paths: `paths` is the path
 * data of the outlined text, `rects` the rectangles as exported (relative to the text's box).
 * Null when the text has no ink to place them by.
 */
export function placeLinks(paths: string[], rects: LinkBox[]): LinkBox[] | null {
  const height = Math.max(...rects.map((r) => r.height));
  const all = paths.flatMap(subpathBoxes);
  if (rects.length === 0 || !(height > 0) || all.length === 0) return null;
  // Underlines as wide as a link.
  const candidates = underlines(all, height);
  const matching = rects.map((r) => candidates.filter((u) => Math.abs(u.x1 - u.x0 - r.width) <= 0.75));
  // The letters: everything but underlines (long thin rectangles underline something else).
  const used = new Set(matching.flat().flatMap((u) => u.parts));
  const letters = all.filter((b) => !used.has(b) && !(b.rect && b.y1 - b.y0 <= 0.12 * height && b.x1 - b.x0 > 1.2 * height));
  if (letters.length === 0) return null;
  const lines = textLines(letters, height);
  // The distance between lines: known when the link spans several, otherwise read from the ink.
  const offsets = [...new Set(rects.map((r) => r.y))].sort((a, b) => a - b);
  let pitch = Infinity;
  for (let i = 1; i < offsets.length; i++) pitch = Math.min(pitch, offsets[i] - offsets[i - 1]);
  for (let i = 1; i < lines.length && offsets.length === 1; i++) pitch = Math.min(pitch, lines[i].top - lines[i - 1].top);
  if (!(pitch >= 0.6 * height && pitch <= 4 * height)) pitch = height;
  // The line of each rectangle, and its underline.
  const placed = rects.map((r, i) => {
    // A rectangle is centered in its line box: this is its line's number in a text that starts at the top of its box.
    const index = Math.round((r.y - (pitch - height) / 2) / pitch);
    const expected = lines[0].top + Math.max(0, index) * pitch;
    let line = lines[0];
    for (const l of lines) if (Math.abs(l.top - expected) < Math.abs(line.top - expected)) line = l;
    // The underline closest to where it should be.
    let underline: (Span & { y: number }) | undefined;
    const distance = (u: { y: number }, l: Line) => Math.abs(u.y - l.top - UNDERLINE_DROP * height);
    for (const u of matching[i]) if (!underline || distance(u, line) < distance(underline, line)) underline = u;
    // An underline elsewhere is more reliable than the guessed line (a text that does not start at the top of its box).
    if (underline && distance(underline, line) > 0.35 * height) {
      for (const l of lines) if (distance(underline, l) < distance(underline, line)) line = l;
    }
    const y = underline && distance(underline, line) > 0.35 * height
      ? underline.y - (UNDERLINE_DROP + ASCENDER_GAP) * height
      : line.top - ASCENDER_GAP * height;
    return { rect: r, line, y, x: underline?.x0 };
  });
  // Without an underline, the text's box is guessed from the other rectangles, or from a text
  // aligned left; the guess is trusted when an underline or several lines starting together confirm it.
  const exact = placed.filter((p) => p.x !== undefined).map((p) => (p.x as number) - p.rect.x);
  const starts = lines.map((l) => Math.min(...l.ink.map((b) => b.x0)));
  const left = Math.min(...starts);
  const origin = exact.length > 0 ? median(exact) : left;
  const trusted = exact.length > 0 || (lines.length > 1 && starts.every((s) => s - left < 0.1 * height));
  return placed.map((p) => {
    const r = p.rect;
    let x = p.x;
    if (x === undefined) {
      // Fit the rectangle around a run of words.
      const guess = origin + r.x;
      x = guess;
      let best = 0.35 * height;
      const w = words(p.line, height);
      for (let i = 0; i < w.length; i++) {
        for (let j = i; j < w.length; j++) {
          // How much wider than the words the rectangle is: side bearings, or a space at either end of the link.
          const slack = r.width - (w[j].x1 - w[i].x0);
          if (slack < -0.06 * height) continue;
          // The part of the slack on the left: half of it, unless there is a reason to do otherwise.
          let before = slack / 2;
          if (slack > 0) {
            // The rectangle must not cover the neighbouring words.
            const low = Math.max(0, slack - (j === w.length - 1 ? Infinity : w[j + 1].x0 - w[j].x1));
            const high = Math.min(slack, i === 0 ? Infinity : w[i].x0 - w[i - 1].x1);
            if (low > high + 1e-6) continue;
            const wholeLine = i === 0 && j === w.length - 1;
            if (slack > 0.12 * height && !wholeLine) before = w[i].x0 - guess;
            before = Math.min(Math.max(before, low), high);
          }
          const candidate = w[i].x0 - before;
          const cost = Math.abs(slack) * (slack < 0 ? 2 : 1) + (trusted ? 0.1 : 0.01) * Math.abs(candidate - guess);
          if (cost < best) {
            best = cost;
            x = candidate;
          }
        }
      }
    }
    return { x, y: p.y, width: r.width, height: r.height };
  });
}
