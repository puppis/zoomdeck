import { describe, expect, it } from 'vitest';
import { LatexError, compileMacros, expandMacros, latexErrorOf, plainMacros } from '../src/markup/latex';

const macros = compileMacros({
  N: '\\mathbb{N}',
  R: '\\mathbb{R}',
  pair: ['\\langle #1, #2 \\rangle', 2],
  norm: ['\\lVert #2 \\rVert_{#1}', 2, '2'],
  set: ['\\{ #1 \\mid #2 \\}', 2],
  Rp: '\\pair{\\R}{\\R}',
  bold: ['\\mathbf#1', 1],
  hash: ['\\##1', 1],
  loop: '\\loop',
});
const expand = (source: string) => expandMacros(source, macros);

describe('LaTeX macros of the deck', () => {
  it('expands macros without arguments, and leaves other commands alone', () => {
    expect(expand('\\N \\subset \\R')).toBe('\\mathbb{N} \\subset \\mathbb{R}');
    expect(expand('\\Nat + \\alpha')).toBe('\\Nat + \\alpha');
    expect(expand('x + y')).toBe('x + y');
    // A backslash pair is a line break, not the start of \N.
    expect(expand('a \\\\N')).toBe('a \\\\N');
  });

  it('takes arguments in braces, as a command or as one character', () => {
    expect(expand('\\pair{a}{b}')).toBe('\\langle a, b \\rangle');
    expect(expand('\\pair {a + 1} {b}')).toBe('\\langle a + 1, b \\rangle');
    expect(expand('\\pair x\\alpha')).toBe('\\langle x, \\alpha \\rangle');
    expect(expand('\\pair{\\{a\\}}{\\frac{1}{2}}')).toBe('\\langle \\{a\\}, \\frac{1}{2} \\rangle');
  });

  it('gives an optional first argument its default unless brackets give one', () => {
    expect(expand('\\norm{x}')).toBe('\\lVert x \\rVert_{2}');
    expect(expand('\\norm[\\infty]{x}')).toBe('\\lVert x \\rVert_{\\infty}');
    expect(expand('\\norm [{[0,1]}] {f}')).toBe('\\lVert f \\rVert_{[0,1]}');
  });

  it('expands macros inside expansions and arguments, and plain macros that use ones with arguments', () => {
    expect(expand('\\set{\\pair{n}{m}}{n \\in \\N}')).toBe('\\{ \\langle n, m \\rangle \\mid n \\in \\mathbb{N} \\}');
    expect(expand('\\Rp')).toBe('\\langle \\mathbb{R}, \\mathbb{R} \\rangle');
  });

  it('keeps a command apart from a letter that follows it, as MathJax does', () => {
    expect(expand('\\bold x')).toBe('\\mathbf x');
    expect(expand('\\pair{a}{b}c')).toBe('\\langle a, b \\rangle c');
    expect(expand('\\hash{1}')).toBe('\\#1');
  });

  it('leaves alone the names a formula defines for itself', () => {
    expect(expand('\\renewcommand{\\N}{\\mathcal{N}} \\N')).toBe('\\renewcommand{\\N}{\\mathcal{N}} \\N');
    expect(expand('\\def\\N{M} \\N')).toBe('\\def\\N{M} \\N');
    expect(expand('\\let\\foo\\N \\foo + \\R')).toBe('\\let\\foo\\N \\foo + \\mathbb{R}');
    expect(expand('\\newcommand{\\sq}[1]{#1^2} \\sq{\\N}')).toBe('\\newcommand{\\sq}[1]{#1^2} \\sq{\\mathbb{N}}');
  });

  it('names a missing argument, an unclosed one and a macro that uses itself', () => {
    expect(() => expand('\\pair{a}')).toThrow(LatexError);
    expect(() => expand('\\pair{a}')).toThrow('\\pair takes 2 arguments: argument 2 is missing');
    expect(() => expand('{\\pair{a}}')).toThrow('argument 2 is missing');
    expect(() => expand('\\norm[x')).toThrow('the optional argument opened with [ is never closed');
    expect(() => expand('\\pair{a')).toThrow('an argument opened with { is never closed');
    expect(() => expand('\\loop')).toThrow('\\loop expands without end');
  });

  it('checks the macros of deck.json', () => {
    expect(compileMacros(undefined).size).toBe(0);
    expect(() => compileMacros({ 'my-set': 'x' })).toThrow('letters only');
    expect(() => compileMacros({ f: ['#1', 10] })).toThrow('from 1 to 9');
    expect(() => compileMacros({ f: [1, 1] })).toThrow('write an expansion');
    expect(() => compileMacros({ f: ['#1', 0, 'x'] })).toThrow('write an expansion');
    expect(() => compileMacros({ f: ['#2', 1] })).toThrow('#2 in its expansion, but it takes one argument');
    expect(() => compileMacros({ f: '#1' })).toThrow('it takes no arguments');
    expect(compileMacros({ f: ['##1 #1', 1] }).get('f')).toEqual({ expansion: '##1 #1', args: 1 });
    expect(plainMacros(macros)).toEqual({ N: '\\mathbb{N}', R: '\\mathbb{R}', Rp: '\\pair{\\R}{\\R}', loop: '\\loop' });
    expect(plainMacros(compileMacros({ f: ['#1', 1] }))).toBeUndefined();
  });

  it('reads the message of a MathJax error', () => {
    expect(latexErrorOf('<g data-mml-node="merror" data-mjx-error="Undefined control sequence \\sq" title="x">')).toBe('Undefined control sequence \\sq');
    expect(latexErrorOf('<g data-mjx-error="Missing &quot;}&quot; &amp; more">')).toBe('Missing "}" & more');
    expect(latexErrorOf('<svg><g data-mml-node="mi"></g></svg>')).toBeNull();
  });
});
