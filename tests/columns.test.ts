import { describe, expect, it } from 'vitest';
import { MarkupParser } from '../src/markup/parser';
import { hasColumns, inlineRows, inlineWords } from '../src/markup/text';
import type { InlineSpan } from '../src/markup/ast';

/** The rows' cells as plain text; a word carries the space before it, which the layout drops at a cell's start. */
const text = (rows: ReturnType<typeof inlineRows>) => rows.map((row) => row.map((cell) => cell.map((word) => word.map((atom) => atom.content).join('').trim()).join(' ')));

describe('aligned columns', () => {
  const parser = new MarkupParser();

  it('splits a block with && into rows of cells, a line end of the source ending a row too', () => {
    const spans = parser.parseInlineSpans('This is a && test && (be careful) \\\\\n&& second column && and then the third\nand the third again', 1);
    expect(hasColumns(spans)).toBe(true);
    expect(text(inlineRows(spans))).toEqual([
      ['This is a', 'test', '(be careful)'],
      ['', 'second column', 'and then the third'],
      ['and the third again'],
    ]);
    // Without the separator the same source is one paragraph of words, the line end a space.
    const plain = parser.parseInlineSpans('This is a test\nand the second line', 1);
    expect(hasColumns(plain)).toBe(false);
    expect(text(inlineRows(plain))).toEqual([['This is a test and the second line']]);
    expect(inlineWords(plain)).toHaveLength(1);
  });

  it('keeps styles, formulas and code inside cells, and a single or escaped ampersand as text', () => {
    const spans = parser.parseInlineSpans('**Name** && *Value* && $x^2$ \\\\\n`a && b` && Tom & Jerry && a \\&& literal', 1);
    const rows = inlineRows(spans);
    expect(text(rows)).toEqual([['Name', 'Value', 'x^2'], ['a && b', 'Tom & Jerry', 'a && literal']]);
    // The first atom of a cell that is not the first carries the space before it; the styled atom follows.
    const first = (row: number, cell: number) => rows[row][cell][0].find((atom) => atom.content.trim());
    expect(first(0, 0)?.bold).toBe(true);
    expect(first(0, 1)?.italic).toBe(true);
    expect(first(0, 2)?.kind).toBe('math');
    expect(first(1, 0)?.kind).toBe('code');
  });

  it('treats && glued to words as a separator too, and a trailing or leading one as an empty cell', () => {
    const spans: InlineSpan[] = [{ content: 'a&&b&&', kind: 'text', bold: false, italic: false, color: null }];
    expect(text(inlineRows(spans))).toEqual([['a', 'b', '']]);
  });
});
