import { describe, expect, it } from 'vitest';
import { expandImports, importPath, describeOrigin } from '../src/markup/imports';
import { MarkupParser } from '../src/markup/parser';
import { CodeSlideSpec, IncludeSpec, MarkupError } from '../src/markup/ast';

const files: Record<string, string> = {
  'parts/footer.md': '[Footer]{#footer x=0 y=-4}',
  'parts/appendix.md': '::: slide {#appendix}\n## Appendix\n[[import: deep/note.md]]\n:::',
  'parts/deep/note.md': '[A note]{#note x=0 y=0}',
  'parts/loop.md': '[[import: loop.md]]',
  'parts/outer.md': '[[import: ../parts/outer.md]]',
};
const load = async (path: string) => {
  if (!(path in files)) throw new Error('missing');
  return files[path];
};

describe('file imports', () => {
  it('splices files in place, resolving paths relative to the importing file', async () => {
    const main = '::: slide {#main}\n## Main\n[[import: parts/footer.md]]\n[[include: #appendix x=0 y=0]]\n:::\n\n[[import: parts/appendix.md]]\n';
    const { source, origins } = await expandImports(main, { load });
    expect(source).toContain('[Footer]{#footer x=0 y=-4}');
    expect(source).toContain('[A note]{#note x=0 y=0}');
    expect(source).not.toContain('[[import:');
    expect(origins[2]).toEqual({ file: 'parts/footer.md', line: 1 });
    expect(origins[3]).toEqual({ file: '', line: 4 });
    const noteLine = source.split('\n').findIndex((line) => line.startsWith('[A note]'));
    expect(origins[noteLine]).toEqual({ file: 'parts/deep/note.md', line: 1 });
    const document = new MarkupParser().parse(source);
    expect(document.slides.map((slide) => slide.id)).toEqual(['main', 'appendix']);
    expect(describeOrigin(origins[noteLine], noteLine + 1)).toBe('parts/deep/note.md, line 1');
    expect(describeOrigin(origins[3], 4)).toBe('Line 4');
  });

  it('leaves import lines inside fenced code alone', async () => {
    const main = '::: slide {#a}\n```markdown\n[[import: parts/footer.md]]\n```\n:::\n';
    const { source } = await expandImports(main, { load });
    expect(source).toBe(main);
  });

  it('rejects cycles, attributes and missing files with the importing location', async () => {
    await expect(expandImports('[[import: parts/loop.md]]', { load })).rejects.toThrow(/parts\/loop\.md, line 1: parts\/loop\.md imports itself/);
    await expect(expandImports('[[import: parts/outer.md]]', { load })).rejects.toThrow(/imports itself/);
    await expect(expandImports('[[import: parts/footer.md x=1]]', { load })).rejects.toThrow(/Line 1: import takes one file path/);
    await expect(expandImports('::: slide {#a}\n[[import: nowhere.md]]\n:::', { load })).rejects.toThrow(/Line 2: cannot import nowhere\.md \(missing\)/);
    expect(importPath('"with space.md"')).toBe('with space.md');
    expect(importPath('a.md b.md')).toBeNull();
  });

  it('is required before parsing, and names imported lines in later errors', async () => {
    expect(() => new MarkupParser().parse('[[import: parts/footer.md]]')).toThrow(/resolved before parsing/);
    expect(() => new MarkupParser().parse('::: slide {#a}\n[[import: parts/footer.md]]\n:::')).toThrow(/Line 2: File imports are resolved/);
    const { origins } = await expandImports('::: slide {#a}\n[[import: parts/footer.md]]\n:::', { load });
    const previous = MarkupError.describe;
    MarkupError.describe = (line) => describeOrigin(origins[line - 1], line);
    try {
      expect(new MarkupError('bad', 2).message).toBe('parts/footer.md, line 1: bad');
    } finally {
      MarkupError.describe = previous;
    }
  });
});

describe('subslide keyword', () => {
  it('places markup children by #id and code-authored children by class name', () => {
    const document = new MarkupParser().parse('::: slide {#a}\n[[subslide: #b x=1]]\n[[subslide: Orbit x=2 step=1]]\n[[include: #c]]\n:::');
    const [markup, code, included] = document.slides[0].items;
    expect(markup).toBeInstanceOf(IncludeSpec);
    expect((markup as IncludeSpec).target).toBe('b');
    expect(code).toBeInstanceOf(CodeSlideSpec);
    expect((code as CodeSlideSpec).className).toBe('Orbit');
    expect(included).toBeInstanceOf(IncludeSpec);
  });
});
