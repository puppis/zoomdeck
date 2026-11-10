import { describe, expect, it } from 'vitest';
import { MarkupParser } from '../src/markup/parser';
import { ElementSpec, MarkupError } from '../src/markup/ast';
import { codeThemeFor, DARK_CODE_THEME, LIGHT_CODE_THEME, languageFor, tokenizeCode } from '../src/markup/code';

const classes = (line: { text: string; cls: string }[]) => line.filter((t) => t.text.trim()).map((t) => `${t.cls}:${t.text.trim()}`);

describe('code fences in markup', () => {
  it('parses the language and attributes of a fence', () => {
    const source = '::: slide {#a}\n```python {#listing x=-7 y=3 step=2 font_size=20}\ndef f(x):\n    return x  # done\n```\n:::';
    const document = new MarkupParser().parse(source);
    const element = document.slides[0].items[0] as ElementSpec;
    expect(element.kind).toBe('code');
    expect(element.attributes).toEqual({ lang: 'python', id: 'listing', x: '-7', y: '3', step: '2', font_size: '20' });
    expect(element.source).toBe('def f(x):\n    return x  # done');
  });

  it('keeps directives and containers inside fences verbatim', () => {
    const source = '::: slide {#a}\n```markdown\n::: slide {#b}\n[[include: #c]]\n:::\n```\n\nAfter. {#after}\n:::';
    const document = new MarkupParser().parse(source);
    expect(document.slides).toHaveLength(1);
    const [code, text] = document.slides[0].items as ElementSpec[];
    expect(code.kind).toBe('code');
    expect(code.source).toBe('::: slide {#b}\n[[include: #c]]\n:::');
    expect(text.id).toBe('after');
  });

  it('accepts code inside .element containers and rejects stray fence info', () => {
    const wrapped = '::: slide {#a}\n::: {.element #w step=1}\n```json\n{"a": 1}\n```\n:::\n:::';
    const element = new MarkupParser().parse(wrapped).slides[0].items[0] as ElementSpec;
    expect(element.kind).toBe('code');
    expect(element.attributes).toEqual({ lang: 'json', id: 'w', step: '1' });
    expect(() => new MarkupParser().parse('::: slide {#a}\n```python oops\nx\n```\n:::')).toThrow(MarkupError);
    expect(() => new MarkupParser().parse('::: slide {#a}\n```python {play=loop}\nx\n```\n:::')).toThrow(/Unknown attributes/);
  });
});

describe('tokenizeCode', () => {
  it('classifies Python comments, strings, keywords and numbers', () => {
    const [line] = tokenizeCode('return "a#b"  # 3 items', 'py');
    expect(classes(line)).toEqual(['keyword:return', 'string:"a#b"', 'comment:# 3 items']);
    const [, second] = tokenizeCode('x = 1\nif x: pass', 'python');
    expect(classes(second)).toEqual(['keyword:if', 'plain:x:', 'keyword:pass']);
  });

  it('spans block comments and template strings across lines', () => {
    const lines = tokenizeCode('/* one\ntwo */ const n = 0x1F;', 'ts');
    expect(lines[0][0].cls).toBe('comment');
    expect(lines[1][0].cls).toBe('comment');
    expect(classes(lines[1])).toContain('keyword:const');
    expect(classes(lines[1])).toContain('number:0x1F');
  });

  it('highlights the slide dialect', () => {
    const lines = tokenizeCode('::: slide {#id width=20}\n[[arrow: #a -> #b, label="x", step=2]]\n# Title {y=3}\nSee $x$ and `code`.', 'markdown');
    expect(classes(lines[0])).toEqual(['directive:::: slide', 'attribute:{#id width=', 'number:20', 'attribute:}']);
    expect(lines[1][0]).toEqual({ text: '[[arrow:', cls: 'directive' });
    expect(classes(lines[1])).toContain('string:"x"');
    expect(lines[2][0].bold).toBe(true);
    expect(classes(lines[3])).toEqual(['plain:See', 'string:$x$', 'plain:and', 'type:`code`', 'plain:.']);
  });

  it('handles JSON keys, shell flags, TeX commands and tags', () => {
    expect(classes(tokenizeCode('{"markup": "slides.md", "n": 2}', 'json')[0])).toEqual(['plain:{', 'attribute:"markup"', 'plain::', 'string:"slides.md"', 'plain:,', 'attribute:"n"', 'plain::', 'number:2', 'plain:}']);
    expect(classes(tokenizeCode('node bin/x.mjs build deck.json -o out --one-file', 'bash')[0])).toContain('attribute:--one-file');
    expect(classes(tokenizeCode('\\frac{a}{b} % half', 'latex')[0])).toEqual(['keyword:\\frac', 'plain:{a}{b}', 'comment:% half']);
    expect(classes(tokenizeCode('<svg width="10"/>', 'svg')[0])).toEqual(['keyword:<svg', 'attribute:width', 'plain:=', 'string:"10"', 'keyword:/>']);
    expect(languageFor('C++')).toBe('clike');
    expect(languageFor('whatever')).toBe('text');
    expect(tokenizeCode('a b', 'text')[0].every((t) => t.cls === 'plain')).toBe(true);
  });

  it('chooses a theme from the text color', () => {
    expect(codeThemeFor('#FFFFFF')).toBe(DARK_CODE_THEME);
    expect(codeThemeFor('#000000')).toBe(LIGHT_CODE_THEME);
  });
});
