/**
 * File imports: `[[import: path.md]]` splices another Markdown file into the
 * document before parsing. Between slides the file contributes slides and
 * style blocks; inside a slide it contributes elements and directives. Every
 * line of the expanded text remembers the file and line it came from, so
 * errors can name them.
 */
import { MarkupError } from './ast';

/** A `[[import: path]]` line; the path may be quoted. */
export const IMPORT_DIRECTIVE = /^\s*\[\[import:\s*(.*?)\s*\]\]\s*$/;

/** Where a line of the expanded document comes from; `file` is '' for the main document. */
export interface LineOrigin {
  file: string;
  line: number;
}

export interface ExpandedSource {
  source: string;
  origins: LineOrigin[];
}

export interface ExpandOptions {
  /** Load an imported file by its path relative to the main document. */
  load: (path: string) => Promise<string>;
  /** Most deeply nested import allowed; 8 by default. */
  maxDepth?: number;
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
  const expand = async (text: string, file: string, stack: string[]): Promise<void> => {
    let fence: string | null = null;
    const rows = text.split(/\r?\n/);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const where = file ? `${file}, line ${index + 1}` : `Line ${index + 1}`;
      const code = /^\s*(`{3,}|~{3,})/.exec(row);
      if (code) {
        if (fence === null) fence = code[1];
        else if (code[1][0] === fence[0] && code[1].length >= fence.length) fence = null;
      }
      const match = fence === null ? IMPORT_DIRECTIVE.exec(row) : null;
      if (!match) {
        lines.push(row);
        origins.push({ file, line: index + 1 });
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
