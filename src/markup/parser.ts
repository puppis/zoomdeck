/**
 * Parse explicit slide containers and CommonMark blocks into a document AST,
 * then validate references and compile fragment state into animation steps.
 */
import MarkdownIt from 'markdown-it';
import { LINK_TARGET } from '../links';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import type Token from 'markdown-it/lib/token.mjs';
import {
  ALIGNMENTS, ANIMATE_PROPS, ATTACHMENTS, BASELINE_ANCHORS, BRACE_SIDES, CONNECTIONS, CONTAINER, DIRECTIVE, EFFECT_NAMES, ELEMENT_ATTRS,
  ENCLOSURES, ENTER_STYLES, EXIT_STYLES, FILL_ATTRS, GEOMETRY, GROUP_ANCHORS, GROUP_ATTRS, HORIZONTAL_POSITION, ICON_KINDS, IDENTIFIER,
  LABEL_SIDES, LAYOUT, NEIGHBORS, POSITION_REFERENCES, RATE_NAMES, SHAPES, SKETCH_ATTRS, STROKE_ATTRS, TEXT_LIKE, TIMING_ATTRS, TREMBLE_ATTRS,
  VECTOR_KINDS, VERTICAL_POSITION, VIDEO_EXTENSIONS, FILL_STYLE_NAMES, CHART_ATTRS, CHART_TYPE_NAMES, TABLE_ATTRS, TABLE_RULE_NAMES,
  ActionSpec, AnimationStep, ElementSpec, EventSpec, GroupSpec, CodeSlideSpec, IncludeSpec, InlineSpan, MarkupDocument, MarkupError, TableSpec,
  type CellAlignment,
  type ListItem,
  NextSpec, SkipNextSpec, SlideItem, SlideSpec, StepChange, StyleSheet, Attributes, applyStyles, attachmentTargets, checkClassName, childKey, endpoint,
  numberValue, parseAt, parseAttributes, parseColor, parseTremble, polylinePoints, positionOrder, span, stepValue,
} from './ast';

type Env = { line?: number };

/** Markers of unordered list items by nesting depth (cycling when deeper). */
const BULLETS = ['•', '–', '◦'];

/** A line that opens a bullet or numbered list item. */
const LIST_START = /^\s*(?:[-*+]|\d+[.)])\s+\S/;

function bracketEnd(source: string, start = 0): number | null {
  let depth = 0;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    if (escaped) {
      escaped = false;
      continue;
    }
    const char = source[index];
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function dollarMath(state: StateInline, silent: boolean): boolean {
  if (state.src[state.pos] !== '$' || state.src.startsWith('$$', state.pos)) return false;
  let end = state.pos + 1;
  while (end < state.posMax) {
    if (state.src[end] === '\\') {
      end += 2;
      continue;
    }
    if (state.src[end] === '$') {
      if (end === state.pos + 1) return false;
      if (!silent) {
        const token = state.push('math_inline', 'math', 0);
        token.content = state.src.slice(state.pos + 1, end);
      }
      state.pos = end + 1;
      return true;
    }
    end += 1;
  }
  throw new MarkupError('Unclosed inline math delimiter', (state.env as Env).line ?? null);
}

/** Treat a double backslash outside code/math as one explicit prose break. */
function hardLineBreak(state: StateInline, silent: boolean): boolean {
  if (!state.src.startsWith('\\\\', state.pos)) return false;
  if (!silent) state.push('hardbreak', 'br', 0);
  state.pos += 2;
  if (state.pos < state.posMax && state.src[state.pos] === '\n') state.pos += 1;
  return true;
}

function coloredSpan(state: StateInline, silent: boolean): boolean {
  if (state.src[state.pos] !== '[') return false;
  const end = bracketEnd(state.src, state.pos);
  if (end === null || !state.src.startsWith('{', end + 1)) return false;
  const close = state.src.indexOf('}', end + 2);
  const line = (state.env as Env).line ?? 1;
  if (close < 0) throw new MarkupError('Unclosed span attributes', line);
  const attrs = parseAttributes(state.src.slice(end + 1, close + 1), line);
  if (Object.keys(attrs).some((key) => key !== 'color')) {
    throw new MarkupError('Positioned/fragment elements must occupy a whole block', line);
  }
  if (!silent) {
    const token = state.push('styled_span', 'span', 0);
    token.meta = attrs;
    token.children = [];
    state.md.inline.parse(state.src.slice(state.pos + 1, end), state.md, state.env, token.children);
  }
  state.pos = close + 1;
  return true;
}

function spans(tokens: Token[], bold = false, italic = false, color: string | null = null, href: string | null = null): InlineSpan[] {
  const result: InlineSpan[] = [];
  let strong = bold ? 1 : 0;
  let emphasis = italic ? 1 : 0;
  const links: Array<string | null> = [];
  const currentHref = () => (links.length ? links[links.length - 1] : href);
  for (const token of tokens) {
    switch (token.type) {
      case 'strong_open': strong += 1; break;
      case 'strong_close': strong -= 1; break;
      case 'em_open': emphasis += 1; break;
      case 'em_close': emphasis -= 1; break;
      case 'styled_span':
        result.push(...spans(token.children ?? [], strong > 0, emphasis > 0, (token.meta as Attributes).color ?? color, currentHref()));
        break;
      case 'text':
      case 'text_special':
      case 'code_inline':
      case 'math_inline':
      case 'softbreak':
      case 'hardbreak': {
        const kind = token.type === 'math_inline' ? 'math' : token.type === 'code_inline' ? 'code' : 'text';
        const content = token.type === 'softbreak' ? ' ' : token.type === 'hardbreak' ? '\n' : token.content;
        result.push(span(content, kind, strong > 0, emphasis > 0, color, currentHref()));
        break;
      }
      case 'link_open': {
        const target = token.attrGet('href');
        if (target && !LINK_TARGET.test(target)) {
          throw new MarkupError(`Unsupported link target ${JSON.stringify(target)}`);
        }
        links.push(target || null);
        break;
      }
      case 'link_close':
        links.pop();
        break;
      default:
        throw new MarkupError(`Unsupported inline Markdown token: ${token.type}`);
    }
  }
  return result;
}

/** Parse component slides, directives and CommonMark blocks into a document AST. */
export class MarkupParser {
  readonly blockMarkdown: MarkdownIt;
  readonly markdown: MarkdownIt;

  constructor() {
    this.blockMarkdown = new MarkdownIt('commonmark', { html: false });
    this.blockMarkdown.enable('table');
    this.markdown = new MarkdownIt('commonmark', { html: false });
    this.markdown.inline.ruler.before('escape', 'dollar_math', dollarMath);
    this.markdown.inline.ruler.before('escape', 'hard_line_break', hardLineBreak);
    this.markdown.inline.ruler.before('link', 'colored_span', coloredSpan);
  }

  /** Parse inline markup (used for connection labels). */
  parseInlineSpans(source: string, line: number): InlineSpan[] {
    const tokens = this.markdown.parseInline(source, { line });
    return spans(tokens[0]?.children ?? []);
  }

  /** Parse a string; infer the unique unreferenced root unless specified. */
  parse(source: string, options: { root?: string | null; basePath?: string; styles?: StyleSheet } = {}): MarkupDocument {
    // Keep source line numbers intact when discarding author comments.
    source = source.replace(/<!--[\s\S]*?-->/g, (match) => '\n'.repeat((match.match(/\n/g) ?? []).length));
    const lines = source.split(/\r?\n/);
    const slides: SlideSpec[] = [];
    const styles: StyleSheet = { ...(options.styles ?? {}) };
    let index = 0;
    while (index < lines.length) {
      if (!lines[index].trim()) {
        index += 1;
        continue;
      }
      const opening = CONTAINER.exec(lines[index]);
      if (opening && /^styles\s*$/.test(opening[1])) {
        const end = MarkupParser._containerEnd(lines, index);
        Object.assign(styles, MarkupParser._styles(lines.slice(index + 1, end), index + 2));
        index = end + 1;
        continue;
      }
      if (/^\s*\[\[import:/.test(lines[index])) {
        throw new MarkupError('File imports are resolved before parsing: load the document through markupDeck or expandImports', index + 1);
      }
      if (!opening || !opening[1].startsWith('slide ')) throw new MarkupError('Expected ::: slide {#slide-id} or ::: styles', index + 1);
      const attrs = parseAttributes(opening[1].slice(6), index + 1);
      if (!('id' in attrs)) throw new MarkupError('Every slide requires an explicit #id', index + 1);
      const end = MarkupParser._containerEnd(lines, index);
      const items = this._body(lines.slice(index + 1, end), index + 2);
      slides.push(new SlideSpec(attrs.id, items, attrs, index + 1));
      index = end + 1;
    }
    if (!slides.length) throw new MarkupError('The document contains no slides');
    const document = new MarkupDocument(slides, (options.root ?? '').replace(/^#/, ''), options.basePath ?? '', styles);
    return new ASTTransformer().validate(document);
  }

  /** Parse `name: attributes` lines of a `::: styles` block. */
  private static _styles(lines: string[], firstLine: number): StyleSheet {
    const result: StyleSheet = {};
    lines.forEach((text, offset) => {
      const line = firstLine + offset;
      if (!text.trim()) return;
      const match = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(text);
      if (!match) throw new MarkupError('Expected a style line such as footnote: font_size=18 color=GRAY', line);
      result[match[1]] = parseAttributes(match[2], line);
    });
    return result;
  }

  private static _containerEnd(lines: string[], start: number): number {
    let depth = 1;
    let fence: string | null = null;
    for (let index = start + 1; index < lines.length; index++) {
      const stripped = lines[index].replace(/^\s+/, '');
      const code = /^(`{3,}|~{3,})/.exec(stripped);
      if (code) {
        const marker = code[1];
        if (fence === null) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        continue;
      }
      if (fence !== null) continue;
      const match = CONTAINER.exec(lines[index]);
      if (match) {
        if (match[1].startsWith('slide ')) throw new MarkupError('Define slides separately; nest them using [[include: #id]]', index + 1);
        depth += match[1] ? 1 : -1;
        if (depth === 0) return index;
      }
    }
    throw new MarkupError('Unclosed ::: container', start + 1);
  }

  private _body(lines: string[], firstLine: number, prefix = ''): SlideItem[] {
    const items: SlideItem[] = [];
    let index = 0;
    while (index < lines.length) {
      if (!lines[index].trim()) {
        index += 1;
        continue;
      }
      const line = firstLine + index;
      const directive = DIRECTIVE.exec(lines[index]);
      if (directive) {
        const [, kind, value] = directive;
        if (kind === 'next' || kind === 'skip_next') {
          const attrs = parseAttributes(value, line, { commas: true });
          const keys = Object.keys(attrs);
          if (keys.length !== 1 || keys[0] !== 'step') throw new MarkupError(`${kind} directives require only step=N`, line);
          const step = stepValue(attrs, 'step', line);
          items.push(kind === 'next' ? new NextSpec(step, line) : new SkipNextSpec(step, line));
        } else if (ATTACHMENTS.has(kind)) {
          // Attachments list the elements they decorate before the first comma: [[blob: #a #b #c, #id, buff=0.4]].
          const trimmed = value.trim();
          const comma = trimmed.indexOf(',');
          const head = comma < 0 ? trimmed : trimmed.slice(0, comma);
          const tokens = head.split(/\s+/).filter(Boolean);
          const count = tokens.findIndex((token) => !token.startsWith('#'));
          const targets = count < 0 ? tokens : tokens.slice(0, count);
          if (!targets.length || targets.some((token) => !/^#[\w.-]+$/.test(token))) {
            throw new MarkupError(`Expected [[${kind}: #id #id ..., #name, attributes]]`, line);
          }
          const rest = (count < 0 ? '' : tokens.slice(count).join(' ')) + (comma < 0 ? '' : trimmed.slice(comma));
          const attrs = parseAttributes(rest, line, { commas: true });
          if ('target' in attrs) throw new MarkupError(`Name the ${kind} targets first: [[${kind}: #id #id ...]]`, line);
          attrs.target = targets.map((token) => token.slice(1)).join(' ');
          items.push(new ElementSpec(attrs.id ?? `${prefix}element-${items.length + 1}`, kind, [], attrs, '', line));
        } else if (kind === 'icon') {
          const match = /^([a-z-]+)\s+(.*)$/s.exec(value.trim());
          if (!match) throw new MarkupError('Expected [[icon: name #id ...]]', line);
          const attrs = parseAttributes(match[2], line, { commas: true });
          if (!('id' in attrs)) throw new MarkupError('Icons require an explicit #id', line);
          items.push(new ElementSpec(attrs.id, 'icon', [], attrs, match[1], line));
        } else if (kind === 'import') {
          throw new MarkupError('File imports are resolved before parsing: load the document through markupDeck or expandImports', line);
        } else if (kind === 'subslide' && !value.trim().startsWith('#')) {
          // A child slide written in code: [[subslide: ClassName ...]].
          const match = /^([^\s,]+)(.*)$/s.exec(value.trim());
          if (!match) throw new MarkupError('Expected [[subslide: #id ...]] or [[subslide: ClassName ...]]', line);
          items.push(new CodeSlideSpec(match[1], parseAttributes(match[2], line, { commas: true }), line));
        } else if (['include', 'subslide', 'show', 'hide'].includes(kind)) {
          const match = /^#?([\w.-]+)(.*)$/s.exec(value);
          if (!match) throw new MarkupError('Expected a referenced #id', line);
          const attrs = parseAttributes(match[2], line, { commas: true });
          if (kind === 'include' || kind === 'subslide') items.push(new IncludeSpec(match[1], attrs, line));
          else {
            const keys = Object.keys(attrs);
            const extra = kind === 'show' ? 'enter' : 'exit';
            if (!keys.includes('step') || keys.some((key) => key !== 'step' && key !== extra && !TIMING_ATTRS.has(key))) {
              throw new MarkupError(`${kind} directives take step=N and optionally run_time, lag and ${extra}`, line);
            }
            items.push(new EventSpec(kind as 'show' | 'hide', match[1], stepValue(attrs, 'step', line), line, attrs));
          }
        } else if (kind === 'iframe') {
          const match = /^(\S+?),?(\s.*)?$/s.exec(value.trim());
          if (!match) throw new MarkupError('Expected [[iframe: https://... #id width=W height=H ...]]', line);
          const attrs = parseAttributes(match[2] ?? '', line, { commas: true });
          attrs.url = match[1];
          items.push(new ElementSpec(attrs.id ?? `${prefix}element-${items.length + 1}`, 'iframe', [], attrs, match[1], line));
        } else if (kind === 'animate' || kind === 'move_along') {
          const match = /^#?([\w.-]+)(.*)$/s.exec(value);
          if (!match) throw new MarkupError('Expected a referenced #id', line);
          const attrs = parseAttributes(match[2], line, { commas: true });
          if (!('step' in attrs)) throw new MarkupError(`${kind} requires step=N`, line);
          items.push(new ActionSpec(kind, match[1], stepValue(attrs, 'step', line), attrs, line));
        } else if (kind === 'effect') {
          const match = /^([a-z_]+)\s+#?([\w.-]+)(.*)$/s.exec(value);
          if (!match) throw new MarkupError('Expected [[effect: name #id, step=N ...]]', line);
          const attrs = parseAttributes(match[3], line, { commas: true });
          if (!('step' in attrs)) throw new MarkupError('effect requires step=N', line);
          attrs.name = match[1];
          items.push(new ActionSpec('effect', match[2], stepValue(attrs, 'step', line), attrs, line));
        } else if (kind === 'transform') {
          const match = /^#?([\w.-]+)\s*->\s*#?([\w.-]+)(.*)$/s.exec(value);
          if (!match) throw new MarkupError('Expected [[transform: #from -> #to, step=N ...]]', line);
          const attrs = parseAttributes(match[3].replace(/^[ ,]+/, ''), line, { commas: true });
          if (!('step' in attrs)) throw new MarkupError('transform requires step=N', line);
          attrs.to = match[2];
          items.push(new ActionSpec('transform', match[1], stepValue(attrs, 'step', line), attrs, line));
        } else if (SHAPES.has(kind)) {
          const attrs = parseAttributes(value, line, { commas: true });
          if (!('id' in attrs)) throw new MarkupError('Shapes require an explicit #id', line);
          items.push(new ElementSpec(attrs.id, kind, [], attrs, '', line));
        } else {
          const end = '(?:#[\\w.-]+|\\([^()]+\\))';
          const match = new RegExp(`^(${end})\\s*->\\s*(${end})(.*)$`, 's').exec(value);
          if (!match) throw new MarkupError('Expected #source -> #target or (x,y) -> (x,y)', line);
          const attrs = parseAttributes(match[3].replace(/^[ ,]+/, ''), line, { commas: true });
          if ('from' in attrs || 'to' in attrs) throw new MarkupError(`Specify ${kind} endpoints before the attributes`, line);
          attrs.from = match[1];
          attrs.to = match[2];
          items.push(new ElementSpec(attrs.id ?? `${prefix}element-${items.length + 1}`, kind, [], attrs, '', line));
        }
        index += 1;
        continue;
      }
      const container = CONTAINER.exec(lines[index]);
      if (container) {
        const kind = /^\{\s*\.(element|group)(?:\s|\})/.exec(container[1])?.[1];
        if (!kind) throw new MarkupError('Only ::: {.element ...} and ::: {.group ...} containers are supported inside slides', line);
        const attrs = parseAttributes(container[1], line);
        const end = MarkupParser._containerEnd(lines, index);
        if (kind === 'group') {
          const identifier = attrs.id ?? `${prefix}element-${items.length + 1}`;
          const nested = this._body(lines.slice(index + 1, end), line + 1, `${identifier}.`);
          if (nested.some((item) => !(item instanceof ElementSpec))) {
            throw new MarkupError('A group contains elements, shapes, connections and nested groups only', line);
          }
          items.push(new GroupSpec(identifier, nested as ElementSpec[], attrs, line));
          index = end + 1;
          continue;
        }
        const nested = this._body(lines.slice(index + 1, end), line + 1, prefix);
        if (nested.length !== 1 || !(nested[0] instanceof ElementSpec)) {
          throw new MarkupError('An .element container must contain exactly one text/image/math/code block', line);
        }
        const element = nested[0];
        const merged = { ...element.attributes, ...attrs };
        const identifier = merged.id ?? `${prefix}element-${items.length + 1}`;
        items.push(element instanceof TableSpec
          ? new TableSpec(identifier, element.rows, element.aligns, merged, line)
          : new ElementSpec(identifier, element.kind, element.spans, merged, element.source, line, element.level, element.list));
        index = end + 1;
        continue;
      }
      if (lines[index].trim().startsWith('$$')) {
        const openingMath = lines[index].trim().slice(2);
        let latex: string;
        if (openingMath.endsWith('$$')) {
          latex = openingMath.slice(0, -2);
          index += 1;
        } else {
          const parts = [openingMath];
          index += 1;
          while (index < lines.length && lines[index].trim() !== '$$') {
            parts.push(lines[index]);
            index += 1;
          }
          if (index === lines.length) throw new MarkupError('Unclosed display math delimiter', line);
          latex = parts.join('\n').trim();
          index += 1;
        }
        if (!latex.trim()) throw new MarkupError('Display math must not be empty', line);
        items.push(new ElementSpec(`${prefix}element-${items.length + 1}`, 'math', [], {}, latex, line));
        continue;
      }
      const start = index;
      let fence: string | null = null;
      while (index < lines.length) {
        const text = lines[index].trim();
        const code = /^(`{3,}|~{3,})/.exec(text);
        if (code) {
          if (fence === null) fence = code[1];
          else if (code[1][0] === fence[0] && code[1].length >= fence.length) fence = null;
          index += 1;
          continue;
        }
        if (fence === null && (CONTAINER.test(text) || text.startsWith('[[') || text.startsWith('$$'))) break;
        if (fence === null && !text) {
          // Blank lines end a block, except inside a list: further items and indented continuation
          // lines belong to the same list, so its nesting survives (each item is still one element).
          if (!LIST_START.test(lines[start])) break;
          let next = index + 1;
          while (next < lines.length && !lines[next].trim()) next += 1;
          if (next >= lines.length || !(LIST_START.test(lines[next]) || /^\s+\S/.test(lines[next]))) break;
          index = next;
          continue;
        }
        index += 1;
      }
      if (index === start) throw new MarkupError('Unknown or malformed directive', line);
      items.push(...this._blocks(lines.slice(start, index).join('\n'), line, items.length, prefix));
    }
    return items;
  }

  private _blocks(source: string, line: number, offset: number, prefix = ''): ElementSpec[] {
    const result: ElementSpec[] = [];
    const tokens = this.blockMarkdown.parse(source, {});
    let level = 0;
    // Open lists, innermost last; the marker of the current item is given to its first block only.
    const lists: Array<{ ordered: boolean; delimiter: string }> = [];
    let marker = '';
    const listItem = (): ListItem | null => {
      if (!lists.length) return null;
      const item = { depth: lists.length - 1, marker };
      marker = '';
      return item;
    };
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const tokenLine = line + (token.map ? token.map[0] : 0);
      if (token.type === 'table_open') {
        // A pipe table: header row first, alignments from the delimiter row.
        const rows: InlineSpan[][][] = [];
        const aligns: CellAlignment[] = [];
        let row: InlineSpan[][] | null = null;
        let cellLine = tokenLine;
        while (index + 1 < tokens.length && tokens[index + 1].type !== 'table_close') {
          index += 1;
          const inner = tokens[index];
          if (inner.type === 'tr_open') row = [];
          else if (inner.type === 'tr_close' && row) rows.push(row);
          else if (inner.type === 'th_open' || inner.type === 'td_open') {
            cellLine = line + (inner.map ? inner.map[0] : 0);
            if (inner.type === 'th_open') {
              const style = inner.attrGet('style') ?? '';
              aligns.push(style.includes('center') ? 'center' : style.includes('right') ? 'right' : 'left');
            }
          } else if (inner.type === 'inline' && row) {
            const children = this.markdown.parseInline(inner.content, { line: cellLine })[0]?.children ?? [];
            try {
              row.push(spans(children).filter((s) => s.content !== ''));
            } catch (error) {
              throw new MarkupError(String((error as Error).message).replace(/^Line \d+: /, ''), cellLine);
            }
          }
        }
        index += 1;
        result.push(new TableSpec(`${prefix}element-${offset + result.length + 1}`, rows, aligns, {}, tokenLine));
        continue;
      }
      if (token.type === 'heading_open') level = Number(token.tag.slice(1));
      else if (token.type === 'heading_close') level = 0;
      else if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
        lists.push({ ordered: token.type === 'ordered_list_open', delimiter: token.markup });
      } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') lists.pop();
      else if (token.type === 'list_item_open') {
        const list = lists[lists.length - 1];
        marker = list.ordered ? `${token.info}${list.delimiter}` : BULLETS[(lists.length - 1) % BULLETS.length];
      } else if (token.type === 'fence' || token.type === 'code_block') {
        const info = (token.info ?? '').trim();
        const match = /^([^\s{}]*)\s*(\{.*\})?\s*$/s.exec(info);
        if (!match) throw new MarkupError('A code fence takes a language name followed by optional {attributes}', tokenLine);
        const attrs = match[2] ? parseAttributes(match[2], tokenLine) : {};
        if (match[1]) {
          if ('lang' in attrs) throw new MarkupError('Name the language once, before the attributes', tokenLine);
          attrs.lang = match[1];
        }
        const identifier = attrs.id ?? `${prefix}element-${offset + result.length + 1}`;
        if (attrs.lang === 'chart') {
          // A chart fence holds the data; its info string holds the options.
          delete attrs.lang;
          result.push(new ElementSpec(identifier, 'chart', [], attrs, token.content.replace(/\s+$/, ''), tokenLine, 0, listItem()));
        } else result.push(new ElementSpec(identifier, 'code', [], attrs, token.content.replace(/\s+$/, ''), tokenLine, 0, listItem()));
      } else if (token.type === 'inline') {
        const [content, attrs] = MarkupParser._blockAttributes(token.content, tokenLine);
        const inline = this.markdown.parseInline(content, { line: tokenLine })[0]?.children ?? [];
        const identifier = attrs.id ?? `${prefix}element-${offset + result.length + 1}`;
        if (inline.length === 1 && inline[0].type === 'image') {
          result.push(new ElementSpec(identifier, 'image', [], attrs, inline[0].attrGet('src') ?? '', tokenLine, 0, listItem()));
        } else {
          let items: InlineSpan[];
          try {
            items = spans(inline);
          } catch (error) {
            throw new MarkupError(String((error as Error).message).replace(/^Line \d+: /, ''), tokenLine);
          }
          result.push(new ElementSpec(identifier, 'text', items, attrs, '', tokenLine, level, listItem()));
        }
      }
    }
    return result;
  }

  private static _blockAttributes(content: string, line: number): [string, Attributes] {
    const match = /\{([^{}\n]*)\}\s*$/.exec(content);
    const references = [...POSITION_REFERENCES];
    if (!match || !(/(?:#|\.|[\w_]+=)/.test(match[1]) || references.some((key) => new RegExp(`(?:^|\\s)${key}:`).test(match[1])))) {
      return [content, {}];
    }
    const attrs = parseAttributes(match[0], line);
    let body = content.slice(0, match.index).replace(/\s+$/, '');
    // A color-only span remains an inline span. Layout/ID/fragment attributes
    // on the complete block instead describe an independently placed object.
    const keys = Object.keys(attrs);
    if (keys.every((key) => key === 'color') && body.endsWith(']')) return [content, {}];
    if (body.startsWith('[') && bracketEnd(body) === body.length - 1) body = body.slice(1, -1);
    return [body, attrs];
  }
}

/** Validate a component tree and compile fragment state into animation steps. */
export class ASTTransformer {
  validate(document: MarkupDocument): MarkupDocument {
    const slides = new Map<string, SlideSpec>();
    const parents = new Map<string, string>();
    for (const slide of document.slides) {
      if (!IDENTIFIER.test(slide.id) || slides.has(slide.id)) throw new MarkupError(`Invalid or duplicate slide ID ${JSON.stringify(slide.id)}`, slide.line);
      slides.set(slide.id, slide);
      this._checkAttrs(slide.attributes, new Set(['id', 'title', 'width', 'height', 'only_this', 'start_here', 'skip_return', 'transition', 'preview']), slide.line);
      for (const flag of ['start_here', 'only_this', 'skip_return', 'preview']) {
        if (!['true', 'false'].includes(slide.attributes[flag] ?? 'false')) throw new MarkupError(`${flag} must be true or false`, slide.line);
      }
      ASTTransformer._checkTransition(slide.attributes, slide.line);
    }
    const styles = document.styles;
    for (const slide of document.slides) {
      const elements = new Map<string, ElementSpec>();
      const scopeOf = new Map<string, string>();
      const visit = (items: SlideItem[], scope: string): void => {
        for (const item of items) {
          if (item instanceof ElementSpec) {
            applyStyles(item, styles);
            if (!IDENTIFIER.test(item.id) || elements.has(item.id)) {
              throw new MarkupError(`Invalid or duplicate element ID ${JSON.stringify(item.id)} in ${slide.id}`, item.line);
            }
            this._checkElement(item, scope);
            elements.set(item.id, item);
            scopeOf.set(item.id, scope);
            if (item instanceof GroupSpec) visit(item.items, item.id);
          } else if (item instanceof IncludeSpec || item instanceof CodeSlideSpec) {
            if (scope) throw new MarkupError('Groups cannot contain includes or subslides', item.line);
            applyStyles(item, styles);
            this._checkChild(item, slide, slides, parents);
          } else if (scope) throw new MarkupError('Groups cannot contain directives', item.line);
        }
      };
      visit(slide.items, '');
      const scopeCheck = (ownerScope: string, target: ElementSpec, what: string, line: number): void => {
        if (scopeOf.get(target.id) !== ownerScope) {
          throw new MarkupError(`${what} #${target.id} belongs to a different group`, line);
        }
      };
      for (const item of elements.values()) {
        const scope = scopeOf.get(item.id) as string;
        if (ATTACHMENTS.has(item.kind)) {
          const targets = attachmentTargets(item);
          if (!targets.length) throw new MarkupError(`A ${item.kind} needs at least one target`, item.line);
          if (!ENCLOSURES.has(item.kind) && targets.length > 1) throw new MarkupError(`A ${item.kind} attaches to one element`, item.line);
          for (const id of targets) {
            const target = elements.get(id);
            if (!target) throw new MarkupError(`Unknown ${item.kind} target #${id} in ${slide.id}`, item.line);
            if (CONNECTIONS.has(target.kind) || ATTACHMENTS.has(target.kind)) {
              throw new MarkupError(`A ${item.kind} must attach to text, image, math, code, a shape, an icon or a group`, item.line);
            }
            scopeCheck(scope, target, `The ${item.kind} target`, item.line);
          }
          if ('label' in item.attributes) {
            for (const s of new MarkupParser().parseInlineSpans(item.attributes.label, item.line)) {
              if (s.color) ASTTransformer._checkColor(s.color, item.line);
            }
          }
          continue;
        }
        if (!CONNECTIONS.has(item.kind)) continue;
        if (!('from' in item.attributes) || !('to' in item.attributes)) throw new MarkupError(`${item.kind} requires both endpoints`, item.line);
        for (const key of ['from', 'to']) {
          const end = endpoint(item.attributes[key], item.line);
          if (typeof end !== 'string') continue;
          const target = elements.get(end);
          if (!target) throw new MarkupError(`Unknown ${item.kind} endpoint #${end} in ${slide.id}`, item.line);
          if (CONNECTIONS.has(target.kind) || ATTACHMENTS.has(target.kind)) {
            throw new MarkupError('Arrow/line endpoints must reference text, image, math, code, shapes, icons or groups', item.line);
          }
          scopeCheck(scope, target, 'The endpoint', item.line);
        }
        if ('label' in item.attributes) {
          for (const s of new MarkupParser().parseInlineSpans(item.attributes.label, item.line)) {
            if (s.color) ASTTransformer._checkColor(s.color, item.line);
          }
        }
      }
      const includes = new Set(slide.items.filter((item): item is IncludeSpec => item instanceof IncludeSpec).map((item) => item.target));
      for (const item of slide.items) {
        if (item instanceof EventSpec && elements.has(item.target)) {
          const target = elements.get(item.target) as ElementSpec;
          if (target.attributes.focus_only === 'true') throw new MarkupError('focus_only elements cannot have visibility events', item.line);
          if (scopeOf.get(item.target)) throw new MarkupError(`#${item.target} is a group member; show or hide its group instead`, item.line);
          const style = item.attributes.enter ?? item.attributes.exit;
          if (style !== undefined && !(item.action === 'show' ? ENTER_STYLES : EXIT_STYLES).has(style)) {
            throw new MarkupError(`Unknown ${item.action === 'show' ? 'enter' : 'exit'} style ${JSON.stringify(style)}`, item.line);
          }
        }
        if (item instanceof ActionSpec) this._checkAction(item, elements, scopeOf, includes);
      }
      for (const item of elements.values()) {
        for (const [key, styles] of [['enter', ENTER_STYLES], ['exit', EXIT_STYLES]] as const) {
          if (key in item.attributes && !styles.has(item.attributes[key])) {
            throw new MarkupError(`Unknown ${key} style ${JSON.stringify(item.attributes[key])}`, item.line);
          }
        }
      }
      const positionable = (item: ElementSpec) => !CONNECTIONS.has(item.kind) && !ATTACHMENTS.has(item.kind);
      for (const item of elements.values()) {
        if (positionable(item)) ASTTransformer._checkPositioning(item, elements, scopeOf, scopeOf.get(item.id) as string);
      }
      for (const item of slide.items) {
        if (item instanceof IncludeSpec || item instanceof CodeSlideSpec) ASTTransformer._checkPositioning(item, elements, scopeOf, '');
      }
      const scopes = new Set(scopeOf.values());
      for (const scope of scopes) {
        positionOrder(new Map([...elements].filter(([id, item]) => positionable(item) && scopeOf.get(id) === scope)));
      }
      this.plan(slide);
    }
    const complete = new Set<string>();
    for (const identifier of slides.keys()) {
      let current = identifier;
      const path = new Set<string>();
      while (!complete.has(current) && parents.has(current)) {
        if (path.has(current)) throw new MarkupError(`Slide reference cycle involving #${current}`);
        path.add(current);
        current = parents.get(current) as string;
      }
      for (const id of path) complete.add(id);
      complete.add(current);
    }
    const roots = [...slides.keys()].filter((id) => !parents.has(id));
    if (roots.length !== 1) throw new MarkupError('Slides must form one tree with exactly one unreferenced root');
    const root = roots[0];
    if (document.root && document.root !== root) throw new MarkupError(`Requested root #${document.root} is not the tree root #${root}`);
    const starts = new Map([...slides].map(([id, slide]) => [id, (slide.attributes.start_here ?? 'false') === 'true']));
    let importedStarts = 0;
    for (const slide of document.slides) {
      for (const item of slide.items) {
        if (item instanceof IncludeSpec && 'start_here' in item.attributes) starts.set(item.target, item.attributes.start_here === 'true');
        else if (item instanceof CodeSlideSpec && item.attributes.start_here === 'true') importedStarts += 1;
      }
    }
    if ([...starts.values()].filter(Boolean).length + importedStarts > 1) throw new MarkupError('start_here may be true on at most one slide');
    return new MarkupDocument([...slides.values()], root, document.basePath);
  }

  /** Validate one element's kind-specific attributes; `scope` is the enclosing group ID or ''. */
  private _checkElement(item: ElementSpec, scope: string): void {
    const decoration = CONNECTIONS.has(item.kind) || ATTACHMENTS.has(item.kind);
    if (!['text', 'image', 'math', 'code', 'group', 'iframe', 'icon', 'table', 'chart'].includes(item.kind) && !SHAPES.has(item.kind) && !decoration) {
      throw new MarkupError(`Unknown element kind ${JSON.stringify(item.kind)}`, item.line);
    }
    let allowed: Set<string>;
    if (item.kind === 'group') allowed = new Set(GROUP_ATTRS);
    else if (CONNECTIONS.has(item.kind)) {
      allowed = new Set(['id', 'step', 'hide', 'color', 'from', 'to', 'label', 'font', 'font_size', 'opacity', 'href', ...STROKE_ATTRS, ...TIMING_ATTRS, ...SKETCH_ATTRS]);
    }
    else if (ATTACHMENTS.has(item.kind)) {
      allowed = new Set(['id', 'target', 'step', 'hide', 'color', 'buff', 'opacity', 'href', ...STROKE_ATTRS, ...TIMING_ATTRS, ...SKETCH_ATTRS]);
      if (item.kind === 'brace') for (const key of ['side', 'label', 'font_size', 'font']) allowed.add(key);
      else if (item.kind === 'blob') for (const key of ['smoothness', ...FILL_ATTRS]) allowed.add(key);
      else for (const key of ['corner_radius', ...FILL_ATTRS]) allowed.add(key);
    } else if (item.kind === 'table') {
      allowed = new Set([...ELEMENT_ATTRS].filter((key) => key !== 'height'));
      for (const key of [...TABLE_ATTRS, ...SKETCH_ATTRS]) allowed.add(key);
    } else if (item.kind === 'chart') {
      allowed = new Set([...ELEMENT_ATTRS, ...CHART_ATTRS, ...SKETCH_ATTRS]);
    } else if (item.kind === 'icon') {
      allowed = new Set([...ELEMENT_ATTRS].filter((key) => !['width', 'height'].includes(key)));
      for (const key of ['size', 'label', 'label_side', ...STROKE_ATTRS, ...FILL_ATTRS, ...SKETCH_ATTRS]) allowed.add(key);
    } else if (SHAPES.has(item.kind)) {
      allowed = new Set([...ELEMENT_ATTRS].filter((key) => !['font_size', 'width', 'height'].includes(key)));
      for (const key of [...STROKE_ATTRS, ...SKETCH_ATTRS]) allowed.add(key);
      if (item.kind === 'polyline') allowed.add('points');
      else {
        for (const key of FILL_ATTRS) allowed.add(key);
        if (item.kind === 'polygon') allowed.add('points');
        else if (item.kind === 'circle' || item.kind === 'dot') allowed.add('radius');
        else if (item.kind === 'arc') for (const key of ['radius', 'start_angle', 'angle']) allowed.add(key);
        else if (item.kind === 'ellipse') for (const key of ['width', 'height']) allowed.add(key);
        else for (const key of ['width', 'height', 'corner_radius']) allowed.add(key);
      }
    } else if (item.kind === 'iframe') {
      allowed = new Set(['id', 'url', 'x', 'y', 'width', 'height', 'anchor', 'at', 'dx', 'dy', 'class', 'title', 'poster', 'step', 'hide', 'color', 'href',
        ...POSITION_REFERENCES, 'buff', ...TIMING_ATTRS]);
    } else {
      allowed = new Set(ELEMENT_ATTRS);
      if (item.kind !== 'text') allowed.delete('font');
      if (item.kind === 'image') {
        allowed.add('play');
        if (VIDEO_EXTENSIONS.test(item.source)) allowed.add('muted');
      } else if (item.kind === 'code') allowed.add('lang');
    }
    if (VECTOR_KINDS.has(item.kind)) for (const key of TREMBLE_ATTRS) allowed.add(key);
    this._checkAttrs(item.attributes, allowed, item.line);
    if ('href' in item.attributes && !LINK_TARGET.test(item.attributes.href)) {
      throw new MarkupError(`Unsupported link target ${JSON.stringify(item.attributes.href)}; use https://, mailto:, #, / or a relative path`, item.line);
    }
    if (item.kind === 'icon') {
      if (!ICON_KINDS.has(item.source)) throw new MarkupError(`Unknown icon ${JSON.stringify(item.source)}; use one of ${[...ICON_KINDS].join(', ')}`, item.line);
      if ('label_side' in item.attributes && !LABEL_SIDES.has(item.attributes.label_side)) {
        throw new MarkupError('label_side must be below, above, left or right', item.line);
      }
      if ('label_side' in item.attributes && !('label' in item.attributes)) throw new MarkupError('label_side requires a label', item.line);
      if ('label' in item.attributes) {
        for (const s of new MarkupParser().parseInlineSpans(item.attributes.label, item.line)) {
          if (s.color) ASTTransformer._checkColor(s.color, item.line);
        }
      }
    }
    if (item.kind === 'table') {
      if ('rules' in item.attributes && !TABLE_RULE_NAMES.has(item.attributes.rules)) {
        throw new MarkupError(`rules must be one of ${[...TABLE_RULE_NAMES].join(', ')}`, item.line);
      }
      if ('header' in item.attributes && !['true', 'false'].includes(item.attributes.header)) throw new MarkupError('header must be true or false', item.line);
      for (const row of (item as TableSpec).rows) for (const cell of row) for (const s of cell) if (s.color) ASTTransformer._checkColor(s.color, item.line);
    }
    if (item.kind === 'chart') {
      if ('type' in item.attributes && !CHART_TYPE_NAMES.has(item.attributes.type)) {
        throw new MarkupError(`Chart type must be one of ${[...CHART_TYPE_NAMES].join(', ')}`, item.line);
      }
      for (const key of ['grid', 'legend', 'values', 'header']) {
        if (key in item.attributes && !['true', 'false'].includes(item.attributes[key])) throw new MarkupError(`${key} must be true or false`, item.line);
      }
      if ('colors' in item.attributes) {
        const names = item.attributes.colors.split(/[\s,]+/).filter(Boolean);
        if (!names.length) throw new MarkupError('colors needs at least one color', item.line);
        for (const name of names) ASTTransformer._checkColor(name, item.line);
      }
      if ('min' in item.attributes && 'max' in item.attributes && Number(item.attributes.max) <= Number(item.attributes.min)) {
        throw new MarkupError('max must exceed min', item.line);
      }
      if (!item.source.trim()) throw new MarkupError('A chart fence needs rows of data', item.line);
    }
    if ('tremble' in item.attributes) {
      const range = parseTremble(item.attributes.tremble, stepValue(item.attributes, 'step', item.line), item.line);
      if (range && 'hide' in item.attributes && range.start >= stepValue(item.attributes, 'hide', item.line)) {
        throw new MarkupError('tremble must start before the element is hidden', item.line);
      }
    }
    for (const key of ['tremble_amplitude', 'tremble_rate']) {
      if (key in item.attributes && !('tremble' in item.attributes)) throw new MarkupError(`${key} requires tremble=`, item.line);
    }
    if (item.kind === 'iframe') {
      if (!('width' in item.attributes) || !('height' in item.attributes)) throw new MarkupError('iframe requires width and height', item.line);
      if (!/^(https?:\/\/|\/|\.\.?\/|[\w.-]+(?:\/|\.html?(?:$|[?#])))/i.test(item.attributes.url)) {
        throw new MarkupError(`iframe URLs must be http(s) or relative: ${item.attributes.url}`, item.line);
      }
    }
    if ('muted' in item.attributes && !['true', 'false'].includes(item.attributes.muted)) throw new MarkupError('muted must be true or false', item.line);
    if (scope) {
      for (const key of ['step', 'hide', 'focus_only', 'play']) {
        if (key in item.attributes) throw new MarkupError(`Group members cannot use ${key}; apply it to the group`, item.line);
      }
    }
    if ('anchor' in item.attributes) ASTTransformer._checkAnchorFor(item, item.attributes.anchor, item.line);
    if (item.kind === 'brace' && 'side' in item.attributes && !(item.attributes.side in BRACE_SIDES)) {
      throw new MarkupError('Brace side must be left, right, top or bottom', item.line);
    }
    const focusOnly = item.attributes.focus_only ?? 'false';
    if (!['true', 'false'].includes(focusOnly)) throw new MarkupError('focus_only must be true or false', item.line);
    if (focusOnly === 'true' && (Number(item.attributes.step ?? '0') !== 0 || 'hide' in item.attributes || 'play' in item.attributes)) {
      throw new MarkupError('focus_only elements are static; omit step, hide and play', item.line);
    }
    if (SHAPES.has(item.kind)) ASTTransformer._checkShape(item);
    if ('play' in item.attributes && !['once', 'loop'].includes(item.attributes.play)) {
      throw new MarkupError('Image play must be once or loop', item.line);
    }
    for (const s of item.spans) if (s.color) ASTTransformer._checkColor(s.color, item.line);
  }

  private static _checkTransition(attrs: Attributes, line: number): void {
    if ('transition' in attrs && !['zoom', 'cut'].includes(attrs.transition)) throw new MarkupError('transition must be zoom or cut', line);
  }

  /** Validate an include or import and register its parent link. */
  private _checkChild(item: IncludeSpec | CodeSlideSpec, slide: SlideSpec, slides: Map<string, SlideSpec>, parents: Map<string, string>): void {
    this._checkAttrs(item.attributes, new Set([...LAYOUT, 'step', 'only_this', 'start_here', 'skip_return', 'transition', 'preview']), item.line);
    for (const flag of ['start_here', 'only_this', 'skip_return', 'preview']) {
      if (!['true', 'false'].includes(item.attributes[flag] ?? 'false')) throw new MarkupError(`${flag} must be true or false`, item.line);
    }
    ASTTransformer._checkTransition(item.attributes, item.line);
    if ('anchor' in item.attributes) ASTTransformer._checkAnchorFor(item, item.attributes.anchor, item.line);
    if ('step' in item.attributes && stepValue(item.attributes, 'step', item.line) === 0) {
      throw new MarkupError('A child visit step must be at least one', item.line);
    }
    if (item instanceof CodeSlideSpec) {
      checkClassName(item.className, item.line);
      return;
    }
    if (!slides.has(item.target)) {
      if (!IDENTIFIER.test(item.target)) throw new MarkupError(`Invalid slide reference #${item.target}`, item.line);
      slides.set(item.target, new SlideSpec(item.target, [], { id: item.target }, item.line, true));
    }
    if (parents.has(item.target)) {
      throw new MarkupError(`Slide #${item.target} is included more than once; use a fresh slide ID`, item.line);
    }
    parents.set(item.target, slide.id);
  }

  /** Validate an animation directive against the slide's elements and included viewports. */
  private _checkAction(item: ActionSpec, elements: Map<string, ElementSpec>, scopeOf: Map<string, string>, includes: Set<string>): void {
    const attrs = item.attributes;
    const resolve = (id: string, what: string): ElementSpec | null => {
      const element = elements.get(id);
      if (element) {
        if (scopeOf.get(id)) throw new MarkupError(`#${id} is a group member; animate its group instead`, item.line);
        return element;
      }
      if (item.action === 'animate' && includes.has(id)) return null;
      throw new MarkupError(`Unknown ${what} #${id}`, item.line);
    };
    const target = resolve(item.target, `${item.action} target`);
    let allowed: Set<string>;
    if (item.action === 'animate') allowed = new Set(['step', ...ANIMATE_PROPS, ...TIMING_ATTRS, 'rate']);
    else if (item.action === 'effect') allowed = new Set(['step', 'name', 'color', 'scale', ...TIMING_ATTRS, 'rate']);
    else if (item.action === 'transform') allowed = new Set(['step', 'to', ...TIMING_ATTRS, 'rate']);
    else allowed = new Set(['step', 'path', 'rotate', ...TIMING_ATTRS, 'rate']);
    this._checkAttrs(attrs, allowed, item.line);
    if (item.step === 0) throw new MarkupError(`${item.action} steps must be at least one`, item.line);
    if ('rate' in attrs && !RATE_NAMES.has(attrs.rate)) throw new MarkupError(`Unknown rate ${JSON.stringify(attrs.rate)}`, item.line);
    if ('scale' in attrs && Number(attrs.scale) <= 0) throw new MarkupError('scale must be positive', item.line);
    if (item.action === 'animate') {
      if (![...ANIMATE_PROPS].some((key) => key in attrs)) throw new MarkupError('animate needs a target property such as x, y, at, angle, scale, opacity or color', item.line);
      if ('at' in attrs && ('x' in attrs || 'y' in attrs)) throw new MarkupError('at= replaces x and y', item.line);
      if ('anchor' in attrs) {
        if (target) ASTTransformer._checkAnchorFor(target, attrs.anchor, item.line);
        else if (!GROUP_ANCHORS.has(attrs.anchor) || attrs.anchor === 'origin' || BASELINE_ANCHORS.has(attrs.anchor)) {
          throw new MarkupError('Child viewports take a box anchor such as center, top-left or right', item.line);
        }
      }
      if ('at' in attrs) {
        const at = parseAt(attrs.at, item.line);
        if (at.anchor && target) ASTTransformer._checkAnchorFor(target, at.anchor, item.line);
        if ('id' in at.target) {
          const reference = resolve(at.target.id, 'at= reference');
          if (reference && (CONNECTIONS.has(reference.kind) || ATTACHMENTS.has(reference.kind))) {
            throw new MarkupError('at= cannot reference an arrow, line, brace, box or blob', item.line);
          }
          if (at.target.anchor && reference) ASTTransformer._checkAnchorFor(reference, at.target.anchor, item.line);
        }
      }
    } else if (item.action === 'effect') {
      if (!EFFECT_NAMES.has(attrs.name)) throw new MarkupError(`Unknown effect ${JSON.stringify(attrs.name)}`, item.line);
    } else if (item.action === 'transform') {
      const to = resolve(attrs.to, 'transform target') as ElementSpec;
      if (to === target) throw new MarkupError('transform needs two different elements', item.line);
      if ((target as ElementSpec).attributes.focus_only === 'true' || to.attributes.focus_only === 'true') {
        throw new MarkupError('focus_only elements cannot be transformed', item.line);
      }
    } else {
      if (!('path' in attrs) || !attrs.path.startsWith('#')) throw new MarkupError('move_along requires path=#shape', item.line);
      const path = resolve(attrs.path.slice(1), 'move_along path') as ElementSpec;
      if (!SHAPES.has(path.kind)) throw new MarkupError('move_along paths must be shapes (circle, arc, polyline, ...)', item.line);
      if ('rotate' in attrs && !['true', 'false'].includes(attrs.rotate)) throw new MarkupError('rotate must be true or false', item.line);
    }
  }

  /** Reject anchors that do not exist for an item: baselines need text, `origin` needs a group. */
  private static _checkAnchorFor(item: ElementSpec | IncludeSpec | CodeSlideSpec, anchor: string, line: number): void {
    if (!GROUP_ANCHORS.has(anchor)) throw new MarkupError(`Unknown anchor ${JSON.stringify(anchor)}`, line);
    if (anchor === 'origin' && !(item instanceof GroupSpec)) throw new MarkupError('origin is an anchor of groups only', line);
    if (BASELINE_ANCHORS.has(anchor) && !(item instanceof ElementSpec && TEXT_LIKE.has(item.kind))) {
      throw new MarkupError('Baseline anchors apply to text, math and code only', line);
    }
  }

  private static _checkColor(value: string, line: number): void {
    try {
      parseColor(value);
    } catch {
      throw new MarkupError(`Invalid color ${JSON.stringify(value)}`, line);
    }
  }

  private static _checkShape(item: ElementSpec): void {
    const attrs = item.attributes;
    const required: Record<string, string[]> = {
      rectangle: ['width', 'height'], circle: ['radius'], polyline: ['points'], dot: [], ellipse: ['width', 'height'], polygon: ['points'], arc: ['radius', 'angle'],
    };
    const needed = required[item.kind];
    if (!needed.every((key) => key in attrs)) throw new MarkupError(`${item.kind} requires ${needed.join(', ')}`, item.line);
    if (item.kind === 'polyline') polylinePoints(attrs.points, item.line);
    if (item.kind === 'polygon') polylinePoints(attrs.points, item.line, 3);
    if (item.kind === 'arc' && Number(attrs.angle) === 0) throw new MarkupError('arc angle must be nonzero', item.line);
    if (item.kind === 'rectangle' && Number(attrs.corner_radius ?? 0) > Math.min(Number(attrs.width), Number(attrs.height)) / 2) {
      throw new MarkupError('corner_radius must not exceed half the smaller dimension', item.line);
    }
  }

  private _checkAttrs(attrs: Attributes, allowed: Set<string>, line: number): void {
    const unknown = Object.keys(attrs).filter((key) => !allowed.has(key)).sort();
    if (unknown.length) throw new MarkupError(`Unknown attributes: ${unknown.join(', ')}`, line);
    for (const key of [...GEOMETRY, 'font_size', 'size', 'buff', 'radius', 'corner_radius', 'stroke_width', 'fill_opacity', 'opacity', 'dx', 'dy', 'run_time', 'lag',
      'start_angle', 'scale', 'roughness', 'bowing', 'hachure_angle', 'hachure_gap', 'fill_weight', 'seed', 'smoothness', 'tremble_amplitude', 'tremble_rate',
      'padding', 'header_opacity', 'stripe_opacity', 'min', 'max']) {
      if (!(key in attrs)) continue;
      const number = numberValue(attrs, key, line) as number;
      if (['buff', 'corner_radius', 'stroke_width', 'lag', 'roughness', 'bowing', 'fill_weight', 'seed', 'tremble_amplitude', 'padding'].includes(key) && number < 0) {
        throw new MarkupError(`${key} must be nonnegative`, line);
      }
      if (['radius', 'run_time', 'hachure_gap', 'tremble_rate'].includes(key) && number <= 0) throw new MarkupError(`${key} must be positive`, line);
      if (['fill_opacity', 'opacity', 'smoothness', 'header_opacity', 'stripe_opacity'].includes(key) && (number < 0 || number > 1)) {
        throw new MarkupError(`${key} must be between zero and one`, line);
      }
    }
    for (const key of ['step', 'hide']) if (key in attrs) stepValue(attrs, key, line);
    for (const key of ['color', 'fill_color', 'border_color', 'header_color', 'axis_color']) if (key in attrs) ASTTransformer._checkColor(attrs[key], line);
    if ('seed' in attrs && !Number.isInteger(Number(attrs.seed))) throw new MarkupError('seed must be an integer', line);
    if ('sketch' in attrs && !['true', 'false'].includes(attrs.sketch)) throw new MarkupError('sketch must be true or false', line);
    if ('fill_style' in attrs && !FILL_STYLE_NAMES.has(attrs.fill_style)) {
      throw new MarkupError(`fill_style must be one of ${[...FILL_STYLE_NAMES].join(', ')}`, line);
    }
  }

  private static _checkPositioning(
    item: ElementSpec | IncludeSpec | CodeSlideSpec, elements: Map<string, ElementSpec>, scopeOf: Map<string, string>, scope: string,
  ): void {
    const attrs = item.attributes;
    const keys = Object.keys(attrs);
    if (('dx' in attrs || 'dy' in attrs) && !keys.some((key) => POSITION_REFERENCES.has(key) || ['x', 'y', 'at'].includes(key))) {
      throw new MarkupError('dx and dy require coordinates, at= or a relative constraint', item.line);
    }
    if ('at' in attrs) {
      if (keys.some((key) => POSITION_REFERENCES.has(key) || ['x', 'y', 'buff'].includes(key))) {
        throw new MarkupError('at= replaces x, y and relative constraints', item.line);
      }
      const at = parseAt(attrs.at, item.line);
      if (at.anchor) ASTTransformer._checkAnchorFor(item, at.anchor, item.line);
      if ('id' in at.target) {
        const target = elements.get(at.target.id);
        if (!target) throw new MarkupError(`Unknown at= reference #${at.target.id}`, item.line);
        if (CONNECTIONS.has(target.kind) || ATTACHMENTS.has(target.kind)) throw new MarkupError('at= cannot reference an arrow, line, brace, box or blob', item.line);
        if (scopeOf.get(target.id) !== scope) throw new MarkupError(`#${target.id} belongs to a different group`, item.line);
        if (at.target.anchor) ASTTransformer._checkAnchorFor(target, at.target.anchor, item.line);
      }
      return;
    }
    if ('baseline-aligned' in attrs && (!(item instanceof ElementSpec) || !TEXT_LIKE.has(item.kind))) {
      throw new MarkupError('baseline-aligned is only supported on text, math and code', item.line);
    }
    if (keys.filter((key) => key in NEIGHBORS).length > 1) throw new MarkupError('Specify only one relative direction', item.line);
    for (const [coordinate, constraints] of [['x', HORIZONTAL_POSITION], ['y', VERTICAL_POSITION]] as const) {
      const specified = keys.filter((key) => constraints.has(key));
      if (specified.length > 1 || (specified.length && coordinate in attrs)) {
        throw new MarkupError(`Conflicting ${coordinate} positioning constraints`, item.line);
      }
    }
    if ('buff' in attrs && !keys.some((key) => key in NEIGHBORS)) throw new MarkupError('buff requires a relative direction', item.line);
    for (const key of keys.filter((key) => POSITION_REFERENCES.has(key))) {
      const reference = attrs[key];
      if (!reference.startsWith('#') || !IDENTIFIER.test(reference.slice(1))) {
        throw new MarkupError(`${key} requires a slide-local #element ID`, item.line);
      }
      const target = elements.get(reference.slice(1));
      if (!target) throw new MarkupError(`Unknown positioning reference ${reference}`, item.line);
      if (CONNECTIONS.has(target.kind) || ATTACHMENTS.has(target.kind)) throw new MarkupError('Positioning references cannot target an arrow, line, brace, box or blob', item.line);
      if (scopeOf.get(target.id) !== scope) throw new MarkupError(`${reference} belongs to a different group`, item.line);
      if (key === 'baseline-aligned' && !TEXT_LIKE.has(target.kind)) {
        throw new MarkupError('baseline-aligned must reference text, math or code', item.line);
      }
    }
  }

  private static _change(action: StepChange['action'], target: string, attrs: Attributes): StepChange {
    const change: StepChange = { action, target };
    if (attrs.run_time !== undefined) change.runTime = Number(attrs.run_time);
    if (attrs.lag !== undefined) change.lag = Number(attrs.lag);
    if (attrs.rate !== undefined) change.rate = attrs.rate;
    if (action === 'show' && attrs.enter !== undefined) change.style = attrs.enter;
    if (action === 'hide' && attrs.exit !== undefined) change.style = attrs.exit;
    if (action === 'animate') {
      change.props = Object.fromEntries(Object.entries(attrs).filter(([key]) => ANIMATE_PROPS.has(key)));
    } else if (action === 'effect') {
      change.name = attrs.name;
      change.options = Object.fromEntries(Object.entries(attrs).filter(([key]) => key === 'color' || key === 'scale'));
    } else if (action === 'transform') change.to = attrs.to;
    else if (action === 'move_along') {
      change.path = attrs.path.slice(1);
      change.rotate = attrs.rotate === 'true';
    }
    return change;
  }

  /** Compile and validate visibility transitions and ordered child calls. */
  plan(slide: SlideSpec): AnimationStep[] {
    const states = new Map<string, boolean>();
    const changes = new Map<number, Array<[StepChange['action'], string, number, Attributes]>>();
    const visits = new Map<number, string[]>();
    const nextSteps = new Set<number>();
    const skipSteps = new Set<number>();
    const push = <T>(map: Map<number, T[]>, key: number, value: T) => {
      if (!map.has(key)) map.set(key, []);
      (map.get(key) as T[]).push(value);
    };
    for (const item of slide.items) {
      if (item instanceof ElementSpec) {
        const appear = stepValue(item.attributes, 'step', item.line);
        states.set(item.id, appear === 0);
        if (appear) push(changes, appear, ['show', item.id, item.line, item.attributes]);
        if ('hide' in item.attributes) {
          const hide = stepValue(item.attributes, 'hide', item.line);
          if (hide <= appear) throw new MarkupError("hide must be later than the element's appearance step", item.line);
          push(changes, hide, ['hide', item.id, item.line, item.attributes]);
        }
      } else if (item instanceof EventSpec) {
        if (item.step === 0) throw new MarkupError('Visibility event steps must be at least one', item.line);
        // A directive's own timing and style win over the element's defaults.
        const element = slide.items.find((candidate): candidate is ElementSpec => candidate instanceof ElementSpec && candidate.id === item.target);
        const timing: Attributes = {};
        for (const key of [...TIMING_ATTRS, item.action === 'show' ? 'enter' : 'exit']) {
          const value = item.attributes[key] ?? element?.attributes[key];
          if (value !== undefined) timing[key] = value;
        }
        push(changes, item.step, [item.action, item.target, item.line, timing]);
      } else if (item instanceof ActionSpec) {
        push(changes, item.step, [item.action, item.target, item.line, item.attributes]);
      } else if (item instanceof NextSpec || item instanceof SkipNextSpec) {
        const command = item instanceof NextSpec ? 'next' : 'skip_next';
        const commandSteps = item instanceof NextSpec ? nextSteps : skipSteps;
        if (!Number.isInteger(item.step) || item.step < 0) throw new MarkupError(`${command} steps must be nonnegative integers`, item.line);
        if (commandSteps.has(item.step)) throw new MarkupError(`Duplicate ${command} directive at step ${item.step}`, item.line);
        commandSteps.add(item.step);
      }
    }
    // A transform reveals its target: a `step=N` on that element at the same step is consumed.
    for (const list of changes.values()) {
      for (const entry of [...list]) {
        if (entry[0] !== 'transform') continue;
        const index = list.findIndex((candidate) => candidate[0] === 'show' && candidate[1] === entry[3].to);
        if (index >= 0) list.splice(index, 1);
      }
    }
    let last = Math.max(0, ...changes.keys(), ...nextSteps, ...skipSteps);
    const explicitVisits = slide.items
      .filter((item): item is IncludeSpec | CodeSlideSpec => (item instanceof IncludeSpec || item instanceof CodeSlideSpec) && 'step' in item.attributes)
      .map((item) => stepValue(item.attributes, 'step', item.line));
    last = Math.max(last, ...explicitVisits);
    slide.items.forEach((item, index) => {
      if (item instanceof IncludeSpec || item instanceof CodeSlideSpec) {
        let number: number;
        if ('step' in item.attributes) number = stepValue(item.attributes, 'step', item.line);
        else {
          last += 1;
          number = last;
        }
        push(visits, number, childKey(index, item));
      }
    });
    const result: AnimationStep[] = [];
    const numbers = new Set<number>([...changes.keys(), ...visits.keys(), ...nextSteps, ...skipSteps, ...[...nextSteps].map((n) => n + 1)]);
    for (const number of [...numbers].sort((a, b) => a - b)) {
      const seen = new Set<string>();
      const touch = (target: string, line: number, action: string) => {
        if (seen.has(target)) throw new MarkupError(`#${target} is changed twice at step ${number} (${action})`, line);
        seen.add(target);
      };
      for (const [action, target, line, attrs] of changes.get(number) ?? []) {
        if (action === 'show' || action === 'hide') {
          if (!states.has(target)) throw new MarkupError(`Unknown fragment target #${target}`, line);
          if (seen.has(target) || states.get(target) === (action === 'show')) {
            throw new MarkupError(`Inconsistent ${action} of #${target} at step ${number}`, line);
          }
          states.set(target, action === 'show');
          seen.add(target);
        } else if (action === 'transform') {
          if (states.get(target) !== true) throw new MarkupError(`#${target} must be visible to be transformed at step ${number}`, line);
          if (states.get(attrs.to) !== false) throw new MarkupError(`#${attrs.to} must be hidden before the transform at step ${number}`, line);
          touch(target, line, action);
          touch(attrs.to, line, action);
          states.set(target, false);
          states.set(attrs.to, true);
        } else {
          // Elements must be visible to be animated; included viewports always are.
          if (states.has(target) && states.get(target) !== true) {
            throw new MarkupError(`#${target} is hidden at step ${number}; show it before the ${action}`, line);
          }
          touch(target, line, action);
        }
      }
      result.push({
        number,
        changes: (changes.get(number) ?? []).map(([action, target, , attrs]) => ASTTransformer._change(action, target, attrs)),
        visits: visits.get(number) ?? [],
        autoNext: nextSteps.has(number),
        skipNext: skipSteps.has(number),
      });
    }
    return result;
  }
}

export { ALIGNMENTS, NEIGHBORS };
