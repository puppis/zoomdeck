/**
 * File imports: `[[import: path.md]]` splices another Markdown file into the
 * document before parsing. Between slides the file contributes slides and
 * style blocks; inside a slide it contributes elements and directives. Every
 * line of the expanded text remembers the file and line it came from, so
 * errors can name them.
 */
import { CONTAINER, MarkupError, parseAttributes } from './ast';

/** A `[[import: path]]` line; the path may be quoted. */
export const IMPORT_DIRECTIVE = /^\s*\[\[import:\s*(.*?)\s*\]\]\s*$/;
/** A `[[snippet: name key=value …]]` line: the snippet's lines, with its placeholders filled. */
export const SNIPPET_DIRECTIVE = /^\s*\[\[snippet:\s*([A-Za-z_][\w-]*)\s*(.*?)\]\]\s*$/;
/** A `::: snippet name` block defines a snippet in place; its lines run to the matching `:::`. */
const SNIPPET_BLOCK = /^snippet\s+([A-Za-z_][\w-]*)\s*$/;
/** `{{key}}` or `{{key|default}}` inside a snippet. */
const PLACEHOLDER = /\{\{\s*([A-Za-z_][\w-]*)\s*(?:\|([^}]*))?\}\}/g;

/** Where a line of the expanded document comes from; `file` is '' for the main document. */
export interface LineOrigin {
  file: string;
  line: number;
}

/** The expanded document with the origin (file and line) of every line. */
export interface ExpandedSource {
  source: string;
  origins: LineOrigin[];
}

/** How imports and snippets are resolved: the loaders and the nesting limit. */
export interface ExpandOptions {
  /** Load an imported file by its path relative to the main document. */
  load: (path: string) => Promise<string>;
  /** Load the snippet `name.md` from the deck's snippets folders; null when no folder has it. */
  snippet?: (name: string) => Promise<string | null>;
  /** Most deeply nested import allowed; 8 by default. */
  maxDepth?: number;
}

/** Fill the placeholders of a snippet's text from the attributes of its use; a key without a value or default is an error. */
export function fillSnippet(name: string, text: string, attributes: Record<string, string>, where: string): string {
  return text.replace(PLACEHOLDER, (_match, key: string, fallback: string | undefined) => {
    if (key in attributes) return attributes[key];
    if (fallback !== undefined) return fallback.trim();
    throw new MarkupError(`${where}: snippet ${name} needs ${key}=`);
  });
}

/**
 * Take the `::: snippet name` blocks out of a file's rows: their bodies by name, and the rows
 * that remain. A body may hold containers of its own; the block ends at the `:::` that
 * closes it.
 */
function takeSnippetBlocks(rows: string[], file: string): { rows: string[]; snippets: Map<string, { body: string; line: number }> } {
  const snippets = new Map<string, { body: string; line: number }>();
  const kept: string[] = [];
  let fence: string | null = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const code = /^\s*(`{3,}|~{3,})/.exec(row);
    if (code) {
      if (fence === null) fence = code[1];
      else if (code[1][0] === fence[0] && code[1].length >= fence.length) fence = null;
    }
    const opening = fence === null ? CONTAINER.exec(row) : null;
    const block = opening ? SNIPPET_BLOCK.exec(opening[1]) : null;
    if (!block) {
      kept.push(row);
      continue;
    }
    const where = file ? `${file}, line ${index + 1}` : `Line ${index + 1}`;
    let depth = 1;
    let end = index + 1;
    for (; end < rows.length; end += 1) {
      const inner = CONTAINER.exec(rows[end]);
      if (!inner) continue;
      depth += inner[1] ? 1 : -1;
      if (depth === 0) break;
    }
    if (end >= rows.length) throw new MarkupError(`${where}: the snippet ${block[1]} is not closed by :::`);
    snippets.set(block[1], { body: rows.slice(index + 1, end).join('\n'), line: index + 2 });
    // The block's rows stay as blank lines, so the lines after it keep their numbers.
    for (let blank = index; blank <= end; blank += 1) kept.push('');
    index = end;
  }
  return { rows: kept, snippets };
}

/** Parse the path of an import line, rejecting attributes and empty paths. */
export function importPath(value: string): string | null {
  const trimmed = value.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  const path = quoted ? quoted[2] : trimmed;
  if (!path || (!quoted && (/\s/.test(path) || path.includes('=')))) return null;
  return path;
}

/** Normalize `path` against the directory of `from` (both relative to the main document). */
function resolvePath(path: string, from: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('/')) return path;
  const base = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
  const parts: string[] = [];
  for (const part of (base + path).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else parts.push('..');
    } else parts.push(part);
  }
  return parts.join('/');
}

/** Describe a line of the main document ('' file) or of an imported file. */
export function describeOrigin(origin: LineOrigin | undefined, line: number): string {
  if (!origin) return `Line ${line}`;
  return origin.file ? `${origin.file}, line ${origin.line}` : `Line ${origin.line}`;
}

/**
 * Replace every `[[import: path]]` line outside fenced code blocks by the
 * imported file's lines, recursively. Paths are relative to the importing
 * file; the main document is file ''.
 */
export async function expandImports(source: string, options: ExpandOptions): Promise<ExpandedSource> {
  const maxDepth = options.maxDepth ?? 8;
  const lines: string[] = [];
  const origins: LineOrigin[] = [];
  // Snippets defined in place, by any file seen so far; a snippets folder answers for the others.
  const defined = new Map<string, { body: string; file: string; line: number }>();
  const expand = async (text: string, file: string, stack: string[], origin?: (line: number) => LineOrigin): Promise<void> => {
    let fence: string | null = null;
    const taken = takeSnippetBlocks(text.split(/\r?\n/), file);
    for (const [name, block] of taken.snippets) defined.set(name, { ...block, file });
    const rows = taken.rows;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const where = file ? `${file}, line ${index + 1}` : `Line ${index + 1}`;
      const code = /^\s*(`{3,}|~{3,})/.exec(row);
      if (code) {
        if (fence === null) fence = code[1];
        else if (code[1][0] === fence[0] && code[1].length >= fence.length) fence = null;
      }
      const use = fence === null ? SNIPPET_DIRECTIVE.exec(row) : null;
      if (use) {
        const [, name, rest] = use;
        if (stack.includes(`snippet:${name}`)) throw new MarkupError(`${where}: the snippet ${name} uses itself`);
        if (stack.length >= maxDepth) throw new MarkupError(`${where}: snippets and imports nested deeper than ${maxDepth}`);
        const attributes = parseAttributes(rest, index + 1, { commas: true });
        const inPlace = defined.get(name);
        const fromFolder = inPlace ? null : await options.snippet?.(name);
        if (!inPlace && fromFolder == null) {
          throw new MarkupError(`${where}: unknown snippet ${name}: no ::: snippet ${name} block and no ${name}.md in the deck's snippets folders`);
        }
        const body = fillSnippet(name, inPlace ? inPlace.body : (fromFolder as string), attributes, where);
        const snippetFile = inPlace ? inPlace.file : `snippets/${name}.md`;
        const first = inPlace ? inPlace.line : 1;
        await expand(body, snippetFile, [...stack, `snippet:${name}`], (line) => ({ file: snippetFile, line: first + line - 1 }));
        continue;
      }
      const match = fence === null ? IMPORT_DIRECTIVE.exec(row) : null;
      if (!match) {
        lines.push(row);
        origins.push(origin ? origin(index + 1) : { file, line: index + 1 });
        continue;
      }
      const path = importPath(match[1]);
      if (!path) throw new MarkupError(`${where}: import takes one file path, as in [[import: parts/intro.md]]`);
      const resolved = resolvePath(path, file);
      if (stack.includes(resolved) || resolved === '') throw new MarkupError(`${where}: ${resolved || path} imports itself`);
      if (stack.length >= maxDepth) throw new MarkupError(`${where}: imports nested deeper than ${maxDepth} files`);
      let imported: string;
      try {
        imported = await options.load(resolved);
      } catch (error) {
        throw new MarkupError(`${where}: cannot import ${resolved} (${(error as Error).message})`);
      }
      await expand(imported, resolved, [...stack, resolved]);
    }
  };
  await expand(source, '', []);
  return { source: lines.join('\n'), origins };
}
