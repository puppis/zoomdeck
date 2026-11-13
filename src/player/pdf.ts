/**
 * A small PDF writer for the printout: one full-page image per page, lossless (deflated RGB
 * with PNG row prediction, as PDF readers decode natively) or JPEG where the browser cannot
 * deflate, an outline of the slides, and a title. Nothing else is needed, so no library is.
 */

export interface PdfImage {
  width: number;
  height: number;
  data: Uint8Array;
  filter: 'FlateDecode' | 'DCTDecode';
}

export interface PdfOutlineItem {
  title: string;
  /** Zero-based page index. */
  page: number;
  children: PdfOutlineItem[];
}

export interface PdfDocument {
  title?: string;
  author?: string;
  /** Page size in points. */
  pageWidth: number;
  pageHeight: number;
  pages: PdfImage[];
  outline?: PdfOutlineItem[];
}

/** Whether lossless pages can be written here (the browser deflates); otherwise pages are JPEG. */
export function losslessPagesAvailable(): boolean {
  return typeof CompressionStream !== 'undefined';
}

/**
 * Prepare RGBA pixels as a lossless PDF image: alpha dropped, each row predicted from the one
 * above (the PNG "Up" filter, tag 2), then deflated. The predictor makes flat backgrounds and
 * anti-aliased text compress several times better than raw rows.
 */
export async function encodePixels(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Promise<PdfImage> {
  const stride = width * 3;
  const filtered = new Uint8Array((stride + 1) * height);
  let out = 0;
  for (let y = 0; y < height; y++) {
    filtered[out++] = 2;
    const row = y * width * 4;
    const above = row - width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      if (y === 0) {
        filtered[out++] = rgba[i];
        filtered[out++] = rgba[i + 1];
        filtered[out++] = rgba[i + 2];
      } else {
        const j = above + x * 4;
        filtered[out++] = (rgba[i] - rgba[j]) & 255;
        filtered[out++] = (rgba[i + 1] - rgba[j + 1]) & 255;
        filtered[out++] = (rgba[i + 2] - rgba[j + 2]) & 255;
      }
    }
  }
  const data = await deflate(filtered);
  return { width, height, data, filter: 'FlateDecode' };
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encode a drawn canvas as a page image: lossless when possible, a fine JPEG otherwise. */
export async function encodeCanvas(canvas: HTMLCanvasElement): Promise<PdfImage> {
  if (losslessPagesAvailable()) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('No drawing context');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return encodePixels(pixels.data, canvas.width, canvas.height);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  if (!blob) throw new Error('The page could not be encoded');
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(await blob.arrayBuffer()), filter: 'DCTDecode' };
}

const encoder = new TextEncoder();

/** A PDF text string: plain when ASCII, UTF-16 with a byte order mark otherwise. */
function pdfString(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(text)) return `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return `<${hex}>`;
}

function pdfDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `(D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z)`;
}

/** Assemble the document; the bytes are ready to download. */
export function buildPdf(document: PdfDocument, now = new Date()): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  // Object numbers are assigned up front: 1 catalog, 2 pages, 3 info, then three per page, then the outline.
  const pageCount = document.pages.length;
  const pageObject = (index: number) => 4 + index * 3;
  const flatOutline: Array<{ item: PdfOutlineItem; id: number; parent: number; prev: number | null; next: number | null; count: number }> = [];
  const outlineRoot = 4 + pageCount * 3;
  let nextId = outlineRoot + 1;
  const countOf = (item: PdfOutlineItem): number => item.children.reduce((sum, child) => sum + 1 + countOf(child), 0);
  const flatten = (items: PdfOutlineItem[], parent: number) => {
    const ids = items.map(() => nextId++);
    items.forEach((item, i) => {
      flatOutline.push({ item, id: ids[i], parent, prev: i > 0 ? ids[i - 1] : null, next: i < ids.length - 1 ? ids[i + 1] : null, count: countOf(item) });
      flatten(item.children, ids[i]);
    });
  };
  const outline = document.outline ?? [];
  flatten(outline, outlineRoot);
  const total = nextId - 1;

  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };

  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const kids = document.pages.map((_, i) => `${pageObject(i)} 0 R`).join(' ');
  object(1, `<< /Type /Catalog /Pages 2 0 R${outline.length ? ` /Outlines ${outlineRoot} 0 R /PageMode /UseOutlines` : ''} >>`);
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  object(3, `<< /Producer (Zoomdeck)${document.title ? ` /Title ${pdfString(document.title)}` : ''}${document.author ? ` /Author ${pdfString(document.author)}` : ''} /CreationDate ${pdfDate(now)} >>`);
  const { pageWidth, pageHeight } = document;
  document.pages.forEach((image, i) => {
    const page = pageObject(i);
    const xobject = page + 1;
    const content = page + 2;
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pageWidth)} ${fmt(pageHeight)}] /Resources << /XObject << /Im ${xobject} 0 R >> >> /Contents ${content} 0 R >>`);
    const parms = image.filter === 'FlateDecode' ? ` /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${image.width} >>` : '';
    object(xobject, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter}${parms} /Interpolate true /Length ${image.data.length} >>`, image.data);
    const drawing = encoder.encode(`q ${fmt(pageWidth)} 0 0 ${fmt(pageHeight)} 0 0 cm /Im Do Q`);
    object(content, `<< /Length ${drawing.length} >>`, drawing);
  });
  if (outline.length) {
    const top = flatOutline.filter((entry) => entry.parent === outlineRoot);
    object(outlineRoot, `<< /Type /Outlines /First ${top[0].id} 0 R /Last ${top[top.length - 1].id} 0 R /Count ${flatOutline.length} >>`);
    for (const entry of flatOutline) {
      const children = flatOutline.filter((other) => other.parent === entry.id);
      const links = [
        `/Parent ${entry.parent} 0 R`,
        entry.prev !== null ? `/Prev ${entry.prev} 0 R` : '',
        entry.next !== null ? `/Next ${entry.next} 0 R` : '',
        children.length ? `/First ${children[0].id} 0 R /Last ${children[children.length - 1].id} 0 R /Count ${entry.count}` : '',
      ].filter(Boolean).join(' ');
      object(entry.id, `<< /Title ${pdfString(entry.item.title)} ${links} /Dest [${pageObject(Math.min(pageCount - 1, Math.max(0, entry.item.page)))} 0 R /Fit] >>`);
    }
  }
  const xref = length;
  let table = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= total; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const result = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
