import { describe, expect, it } from 'vitest';
import { clipForLine, documentPath, sourceOfClip } from '../src/player/sync';
import { documentPath as serverDocumentPath, editorCommand, previewsFor, splitCommand } from '../bin/sync.mjs';
import { MarkupParser, ASTTransformer } from '../src/markup/parser';
import type { NavigationData } from '../src/runtime';

const ROOT = '/home/me/Zoomdeck';
const MAIN = 'http://127.0.0.1:8000/@fs/home/me/decks/talk/slides.md';
const PART = 'http://127.0.0.1:8000/@fs/home/me/decks/talk/parts/end.md';
const at = (file: string, line: number) => ({ file, line });

/** A root with two children; the second is written in an imported file. */
const navigation: NavigationData = {
  version: 1,
  slides: [
    { id: 0, name: 'root', key: 'markup:root', parent: null, placeholder: false, source: at(MAIN, 1), placement: null },
    { id: 1, name: 'a', key: 'markup:a', parent: 0, placeholder: false, source: at(MAIN, 20), placement: at(MAIN, 4) },
    { id: 2, name: 'end', key: 'markup:end', parent: 0, placeholder: false, source: at(PART, 1), placement: at(MAIN, 6) },
    { id: 3, name: 'Code', key: 'code:x', parent: 0, placeholder: false, source: at(MAIN, 8), placement: at(MAIN, 8) },
  ],
  clips: [
    { slide: 0, kind: 'entry', loop: false, autoNext: false, notes: '', rate: 1, duration: 0, source: at(MAIN, 1) },
    { slide: 0, kind: 'program', loop: false, autoNext: false, notes: '', rate: 1, duration: 0, source: at(MAIN, 3) },
    { slide: 1, kind: 'entry', loop: false, autoNext: false, notes: '', rate: 1, duration: 0, source: at(MAIN, 20) },
    { slide: 1, kind: 'program', loop: false, autoNext: false, notes: '', rate: 1, duration: 0, source: at(MAIN, 24) },
    { slide: 1, kind: 'program', loop: false, autoNext: false, notes: '', rate: 1, duration: 0, source: null },
    { slide: 1, kind: 'program', loop: false, autoNext: false, notes: '', rate: 1, duration: 0, source: at(MAIN, 22) },
    { slide: 0, kind: 'return', loop: false, autoNext: false, notes: '', rate: 1, duration: 0, source: at(MAIN, 4) },
    { slide: 2, kind: 'entry', loop: false, autoNext: false, notes: '', rate: 1, duration: 0, source: at(PART, 1) },
    { slide: 2, kind: 'program', loop: false, autoNext: false, notes: '', rate: 1, duration: 0, source: at(PART, 5) },
    { slide: 0, kind: 'return', loop: false, autoNext: false, notes: '', rate: 1, duration: 0, source: at(MAIN, 6) },
    { slide: 3, kind: 'entry', loop: false, autoNext: false, notes: '', rate: 1, duration: 0, source: null },
  ],
  startSlide: null,
};

describe('document paths', () => {
  it('turns the server URLs of a deck into file paths', () => {
    expect(documentPath(MAIN, ROOT)).toBe('/home/me/decks/talk/slides.md');
    expect(documentPath('http://localhost:5173/examples/guide/slides.md', ROOT)).toBe('/home/me/Zoomdeck/examples/guide/slides.md');
    expect(documentPath('http://localhost:5173/@fs/C:/Users/me/a%20b/slides.md', 'C:/Zoomdeck')).toBe('C:/Users/me/a b/slides.md');
    expect(documentPath('/already/a/path.md', ROOT)).toBe('/already/a/path.md');
    expect(documentPath('', ROOT)).toBeNull();
    expect(serverDocumentPath(MAIN, ROOT)).toBe('/home/me/decks/talk/slides.md');
    expect(serverDocumentPath('http://localhost:5173/examples/guide/slides.md', ROOT)).toBe('/home/me/Zoomdeck/examples/guide/slides.md');
    expect(serverDocumentPath(null, ROOT)).toBeNull();
  });
});

describe('forward search', () => {
  const main = '/home/me/decks/talk/slides.md';
  const part = '/home/me/decks/talk/parts/end.md';

  it('finds the stop at which everything written up to a line has appeared', () => {
    expect(clipForLine(navigation, main, 1, ROOT)).toBe(0);
    expect(clipForLine(navigation, main, 2, ROOT)).toBe(0);
    expect(clipForLine(navigation, main, 3, ROOT)).toBe(1);
    // After the include of #a the root is shown again, returning from the child.
    expect(clipForLine(navigation, main, 5, ROOT)).toBe(6);
    // Inside the child: its definition, its steps (the step named on line 22 appears last), and the lines after them.
    expect(clipForLine(navigation, main, 20, ROOT)).toBe(2);
    expect(clipForLine(navigation, main, 21, ROOT)).toBe(2);
    expect(clipForLine(navigation, main, 22, ROOT)).toBe(5);
    expect(clipForLine(navigation, main, 23, ROOT)).toBe(5);
    expect(clipForLine(navigation, main, 30, ROOT)).toBe(3);
  });

  it('handles imported files, lines before the first slide and unknown files', () => {
    expect(clipForLine(navigation, part, 1, ROOT)).toBe(7);
    expect(clipForLine(navigation, part, 9, ROOT)).toBe(8);
    // A fragment imported inside a slide defines no slide of its own; the earliest stop of the file is chosen before its first line.
    expect(clipForLine({ ...navigation, slides: navigation.slides.filter((slide) => slide.id !== 2) }, part, 1, ROOT)).toBe(7);
    expect(clipForLine(navigation, '/home/me/decks/other.md', 3, ROOT)).toBeNull();
  });
});

describe('inverse search', () => {
  it('names the source of a stop, falling back along the slide and to its placement', () => {
    expect(sourceOfClip(navigation, 3)).toEqual(at(MAIN, 24));
    // A stop without a source of its own (a loop after an animation) shows the previous one.
    expect(sourceOfClip(navigation, 4)).toEqual(at(MAIN, 24));
    expect(sourceOfClip(navigation, 6)).toEqual(at(MAIN, 4));
    expect(sourceOfClip(navigation, 10)).toEqual(at(MAIN, 8));
    expect(sourceOfClip(navigation, 99)).toBeNull();
  });

  it('builds editor commands from presets and templates without splitting paths', () => {
    const file = '/Users/me/My Decks/slides.md';
    expect(editorCommand('emacs', file, 12)).toEqual(['emacsclient', '--no-wait', '+12', file]);
    expect(editorCommand('Sublime', file, 12)).toEqual(['subl', `${file}:12`]);
    expect(editorCommand('code', file, 12)).toEqual(['code', '--goto', `${file}:12`]);
    expect(editorCommand('webstorm', file, 12)).toEqual(['webstorm', '--line', '12', file]);
    expect(editorCommand('"/Applications/My Editor.app/bin/edit" --line {line} {file}', file, 3)).toEqual(['/Applications/My Editor.app/bin/edit', '--line', '3', file]);
    expect(editorCommand("nvim --server /tmp/nvim.sock --remote-send \"<C-\\><C-N>:call zoomdeck#Open({line}, '{file}')<CR>\"", file, 3))
      .toEqual(['nvim', '--server', '/tmp/nvim.sock', '--remote-send', `<C-\\><C-N>:call zoomdeck#Open(3, '${file}')<CR>`]);
    expect(editorCommand('', file, 1)).toBeNull();
    expect(editorCommand(null, file, 1)).toBeNull();
    expect(() => editorCommand('notepad', file, 1)).toThrow(/Unknown editor/);
    expect(splitCommand(`a "b c" d'e f' g\\h`)).toEqual(['a', 'b c', 'de f', 'g\\h']);
    expect(() => splitCommand('a "b')).toThrow(/quotes/);
  });

  it('sends a jump to the previews watching the file, else to every running one', () => {
    const entries = [
      { port: 8001, pid: 1, roots: ['/home/me/decks/talk'], deck: null, editor: null, started: 2 },
      { port: 8000, pid: 1, roots: ['/home/me/decks/other', '/home/me/shared'], deck: null, editor: null, started: 1 },
    ];
    expect(previewsFor('/home/me/decks/talk/slides.md', entries).map((entry) => entry.port)).toEqual([8001]);
    expect(previewsFor('/home/me/shared/footer.md', entries).map((entry) => entry.port)).toEqual([8000]);
    expect(previewsFor('/home/me/decks/talkative/x.md', entries).map((entry) => entry.port)).toEqual([8001, 8000]);
  });
});

describe('step lines', () => {
  it('gives every planned step the first line that names it', () => {
    const source = ['::: slide {#s}', '## Title', '', '[one]{#one step=1}', '', '[two]{#two step=2}', '[[hide: #one step=2]]', '[[include: #c]]', '[[next: step=4]]', ':::', '::: slide {#c}', 'child', ':::'].join('\n');
    const document = new MarkupParser().parse(source);
    const steps = new ASTTransformer().plan(document.slides[0]);
    // The include without a step comes after the last numbered one (the `next` at step 4), on its own line.
    expect(steps.map((step) => [step.number, step.line])).toEqual([[1, 4], [2, 6], [4, 9], [5, 8]]);
  });
});
