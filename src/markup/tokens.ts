/**
 * Token classification for code listings: comments, strings, numbers,
 * keywords, types, directives and attributes for a handful of common
 * languages and for this project's own slide dialect. Pure functions, used by
 * the renderer and by the documentation build.
 */
export type TokenClass = 'plain' | 'keyword' | 'type' | 'string' | 'comment' | 'number' | 'directive' | 'attribute';

export interface CodeToken {
  text: string;
  cls: TokenClass;
  bold?: boolean;
}

interface Language {
  keywords?: string[];
  types?: string[];
  lineComment?: string[];
  blockComment?: Array<[string, string]>;
  strings?: string[];
  tripleStrings?: boolean;
  /** `\command` sequences are keywords (TeX). */
  commands?: boolean;
  /** `$name` is an attribute (shells). */
  variables?: boolean;
  /** `--flag` after whitespace is an attribute (shells). */
  flags?: boolean;
  /** A string followed by a colon is a key (JSON). */
  keys?: boolean;
  /** Special line-oriented tokenizers. */
  mode?: 'markup' | 'tags';
}

const C_LIKE_KEYWORDS = [
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'defer', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'extern', 'final', 'finally', 'fn', 'for', 'from', 'func', 'function', 'go',
  'goto', 'if', 'impl', 'implements', 'import', 'in', 'inline', 'instanceof', 'interface', 'internal', 'let', 'loop',
  'match', 'mod', 'module', 'mut', 'namespace', 'new', 'of', 'operator', 'override', 'package', 'private', 'protected',
  'pub', 'public', 'readonly', 'ref', 'return', 'sealed', 'select', 'static', 'struct', 'super', 'switch', 'template',
  'this', 'throw', 'throws', 'trait', 'try', 'type', 'typedef', 'typename', 'typeof', 'union', 'unsafe', 'use', 'using',
  'var', 'virtual', 'volatile', 'where', 'while', 'with', 'yield', 'true', 'false', 'null', 'nullptr', 'undefined',
  'None', 'Some', 'Ok', 'Err', 'self', 'Self', 'declare', 'keyof', 'satisfies', 'infer', 'is', 'out', 'get', 'set',
];
const C_LIKE_TYPES = [
  'any', 'bool', 'boolean', 'byte', 'char', 'double', 'float', 'int', 'long', 'never', 'number', 'object', 'short',
  'signed', 'size_t', 'string', 'String', 'unknown', 'unsigned', 'void', 'u8', 'u16', 'u32', 'u64', 'i8', 'i16', 'i32',
  'i64', 'f32', 'f64', 'usize', 'isize', 'str', 'Vec', 'Option', 'Result', 'Box', 'Promise', 'Array', 'Map', 'Set',
  'Record', 'Partial', 'Readonly', 'List', 'Dict', 'Integer', 'Boolean', 'Object', 'auto', 'uint', 'wchar_t',
];

const LANGUAGES: Record<string, Language> = {
  python: {
    keywords: [
      'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
      'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'match', 'nonlocal',
      'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'case',
    ],
    types: ['self', 'cls', 'int', 'str', 'float', 'list', 'dict', 'set', 'tuple', 'bool', 'bytes', 'object', 'print', 'len', 'range', 'super', 'isinstance', 'Exception'],
    lineComment: ['#'],
    strings: ['"', "'"],
    tripleStrings: true,
  },
  clike: {
    keywords: C_LIKE_KEYWORDS,
    types: C_LIKE_TYPES,
    lineComment: ['//'],
    blockComment: [['/*', '*/']],
    strings: ['"', "'", '`'],
  },
  shell: {
    keywords: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'in', 'function', 'return', 'exit', 'export', 'local', 'cd', 'echo', 'source', 'set', 'unset', 'alias', 'npm', 'npx', 'node', 'git', 'python3', 'pip', 'make'],
    lineComment: ['#'],
    strings: ['"', "'"],
    variables: true,
    flags: true,
  },
  latex: {
    commands: true,
    lineComment: ['%'],
    strings: ['$'],
  },
  json: {
    keywords: ['true', 'false', 'null'],
    strings: ['"'],
    keys: true,
  },
  markup: { mode: 'markup' },
  tags: { mode: 'tags' },
  text: {},
};

const ALIASES: Record<string, string> = {
  py: 'python', python3: 'python',
  js: 'clike', javascript: 'clike', ts: 'clike', typescript: 'clike', tsx: 'clike', jsx: 'clike', java: 'clike', c: 'clike',
  cpp: 'clike', 'c++': 'clike', cc: 'clike', h: 'clike', hpp: 'clike', cs: 'clike', csharp: 'clike', rust: 'clike',
  rs: 'clike', go: 'clike', kotlin: 'clike', kt: 'clike', swift: 'clike', scala: 'clike', dart: 'clike', php: 'clike',
  sh: 'shell', bash: 'shell', zsh: 'shell', shell: 'shell', console: 'shell', fish: 'shell',
  tex: 'latex', latex: 'latex',
  json: 'json', json5: 'json', jsonc: 'json',
  md: 'markup', markdown: 'markup', slides: 'markup', zs: 'markup',
  html: 'tags', xml: 'tags', svg: 'tags', xhtml: 'tags',
  txt: 'text', text: 'text', plain: 'text', '': 'text',
};

/** Resolve a fence language name to one of the supported profiles. */
export function languageFor(name: string): string {
  const key = name.trim().toLowerCase();
  return ALIASES[key] ?? (key in LANGUAGES ? key : 'text');
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

function pushToken(out: CodeToken[], text: string, cls: TokenClass, bold = false): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.cls === cls && Boolean(last.bold) === bold && !text.includes('\n') && !last.text.includes('\n')) last.text += text;
  else out.push({ text, cls, ...(bold ? { bold } : {}) });
}

function scanGeneric(source: string, lang: Language): CodeToken[] {
  const out: CodeToken[] = [];
  const keywords = new Set(lang.keywords ?? []);
  const types = new Set(lang.types ?? []);
  const n = source.length;
  let i = 0;
  scan: while (i < n) {
    const ch = source[i];
    for (const [open, close] of lang.blockComment ?? []) {
      if (source.startsWith(open, i)) {
        const j = source.indexOf(close, i + open.length);
        const end = j < 0 ? n : j + close.length;
        pushToken(out, source.slice(i, end), 'comment');
        i = end;
        continue scan;
      }
    }
    for (const marker of lang.lineComment ?? []) {
      if (source.startsWith(marker, i)) {
        let end = source.indexOf('\n', i);
        if (end < 0) end = n;
        pushToken(out, source.slice(i, end), 'comment');
        i = end;
        continue scan;
      }
    }
    if (lang.tripleStrings && (source.startsWith('"""', i) || source.startsWith("'''", i))) {
      const quote = source.slice(i, i + 3);
      const j = source.indexOf(quote, i + 3);
      const end = j < 0 ? n : j + 3;
      pushToken(out, source.slice(i, end), 'string');
      i = end;
      continue;
    }
    if ((lang.strings ?? []).includes(ch)) {
      let j = i + 1;
      while (j < n && source[j] !== ch && (source[j] !== '\n' || ch === '`')) {
        if (source[j] === '\\') j += 1;
        j += 1;
      }
      const end = Math.min(n, j + 1);
      const text = source.slice(i, end);
      let cls: TokenClass = 'string';
      if (lang.keys) {
        const rest = source.slice(end);
        if (/^\s*:/.test(rest)) cls = 'attribute';
      }
      pushToken(out, text, cls);
      i = end;
      continue;
    }
    if (lang.commands && ch === '\\') {
      const match = /^\\(?:[A-Za-z@]+\*?|.)/s.exec(source.slice(i));
      const text = match ? match[0] : ch;
      pushToken(out, text, 'keyword');
      i += text.length;
      continue;
    }
    if (lang.variables && ch === '$') {
      const match = /^\$(?:\{[^}]*\}|[\w@#?*!-]+)/.exec(source.slice(i));
      if (match) {
        pushToken(out, match[0], 'attribute');
        i += match[0].length;
        continue;
      }
    }
    if (lang.flags && ch === '-' && (i === 0 || /\s/.test(source[i - 1]))) {
      const match = /^--?[\w-]+/.exec(source.slice(i));
      if (match) {
        pushToken(out, match[0], 'attribute');
        i += match[0].length;
        continue;
      }
    }
    if (/\d/.test(ch) && (i === 0 || !IDENT_PART.test(source[i - 1]))) {
      const match = /^(?:0[xXbBoO][\w]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[A-Za-z]*/.exec(source.slice(i));
      const text = match ? match[0] : ch;
      pushToken(out, text, 'number');
      i += text.length;
      continue;
    }
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < n && IDENT_PART.test(source[j])) j += 1;
      const word = source.slice(i, j);
      pushToken(out, word, keywords.has(word) ? 'keyword' : types.has(word) ? 'type' : 'plain');
      i = j;
      continue;
    }
    pushToken(out, ch, 'plain');
    i += 1;
  }
  return out;
}

function attributeTokens(source: string): CodeToken[] {
  const out: CodeToken[] = [];
  for (const match of source.matchAll(/"[^"]*"|'[^']*'|#[\w.-]+|[\w-]+(?:=|:(?=#))|-?\d+(?:\.\d+)?(?![\w-])|\s+|\S/g)) {
    const text = match[0];
    const cls: TokenClass = /^["']/.test(text) ? 'string'
      : text.startsWith('#') ? 'attribute'
      : /^[\w-]+[=:]$/.test(text) ? 'attribute'
      : /^-?\d/.test(text) ? 'number'
      : 'plain';
    pushToken(out, text, cls);
  }
  return out;
}

function inlineMarkupTokens(source: string, bold = false): CodeToken[] {
  const out: CodeToken[] = [];
  const pattern = /<!--.*?-->|\$\$[^$]*\$\$|\$[^$\n]+\$|`[^`\n]+`|\*\*[^*\n]+\*\*|!\[[^\]\n]*\]\([^)\n]*\)|\{[^{}\n]*\}|[^<$`*!{\n]+|./gs;
  for (const match of source.matchAll(pattern)) {
    const text = match[0];
    if (text.startsWith('<!--')) pushToken(out, text, 'comment', bold);
    else if (text.startsWith('$')) pushToken(out, text, 'string', bold);
    else if (text.startsWith('`')) pushToken(out, text, 'type', bold);
    else if (text.startsWith('**')) pushToken(out, text, 'plain', true);
    else if (text.startsWith('![')) {
      const paren = text.indexOf('](');
      pushToken(out, text.slice(0, paren + 2), 'plain', bold);
      pushToken(out, text.slice(paren + 2, -1), 'string', bold);
      pushToken(out, ')', 'plain', bold);
    } else if (text.startsWith('{')) {
      pushToken(out, '{', 'attribute', bold);
      for (const token of attributeTokens(text.slice(1, -1))) pushToken(out, token.text, token.cls === 'plain' ? 'attribute' : token.cls, bold);
      pushToken(out, '}', 'attribute', bold);
    } else pushToken(out, text, 'plain', bold);
  }
  return out;
}

function scanMarkup(source: string): CodeToken[][] {
  const lines: CodeToken[][] = [];
  let fence: string | null = null;
  for (const line of source.split('\n')) {
    const out: CodeToken[] = [];
    const fenceMatch = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[2];
      else if (fenceMatch[2][0] === fence[0] && fenceMatch[2].length >= fence.length) fence = null;
      pushToken(out, fenceMatch[1] + fenceMatch[2], 'directive');
      const brace = fenceMatch[3].indexOf('{');
      if (brace < 0) pushToken(out, fenceMatch[3], 'type');
      else {
        pushToken(out, fenceMatch[3].slice(0, brace), 'type');
        out.push(...inlineMarkupTokens(fenceMatch[3].slice(brace)));
      }
      lines.push(out);
      continue;
    }
    if (fence !== null) {
      pushToken(out, line, 'plain');
      lines.push(out);
      continue;
    }
    let match: RegExpExecArray | null;
    if (/^\s*:::/.test(line)) {
      const brace = line.indexOf('{');
      if (brace < 0) pushToken(out, line, 'directive');
      else {
        pushToken(out, line.slice(0, brace), 'directive');
        out.push(...inlineMarkupTokens(line.slice(brace)));
      }
    } else if ((match = /^(\s*\[\[[\w_]+:)(.*?)(\]\]\s*)$/.exec(line))) {
      pushToken(out, match[1], 'directive');
      out.push(...attributeTokens(match[2]));
      pushToken(out, match[3], 'directive');
    } else if ((match = /^(\s*#{1,6}\s+)(.*)$/.exec(line))) {
      pushToken(out, match[1], 'type', true);
      out.push(...inlineMarkupTokens(match[2], true));
    } else out.push(...inlineMarkupTokens(line));
    lines.push(out);
  }
  return lines;
}

function scanTags(source: string): CodeToken[] {
  const out: CodeToken[] = [];
  const pattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z][\w:.-]*|\/?>|"[^"]*"|'[^']*'|[A-Za-z_:][\w:.-]*(?=\s*=)|\s+|[^<>"'\s]+|./g;
  for (const match of source.matchAll(pattern)) {
    const text = match[0];
    const cls: TokenClass = text.startsWith('<!') ? 'comment'
      : text.startsWith('<') || text === '>' || text === '/>' ? 'keyword'
      : /^["']/.test(text) ? 'string'
      : /^[A-Za-z_:][\w:.-]*$/.test(text) ? 'attribute'
      : 'plain';
    pushToken(out, text, cls);
  }
  return out;
}

function splitLines(tokens: CodeToken[]): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ ...token, text: part });
    });
  }
  return lines;
}

/** Classify `source` line by line. Unknown languages yield plain tokens. */
export function tokenizeCode(source: string, language = ''): CodeToken[][] {
  const text = source.replace(/\t/g, '    ');
  const lang = LANGUAGES[languageFor(language)];
  if (lang.mode === 'markup') return scanMarkup(text);
  if (lang.mode === 'tags') return splitLines(scanTags(text));
  return splitLines(scanGeneric(text, lang));
}
