import { describe, expect, it } from 'vitest';
import { MarkupParser, ASTTransformer } from '../src/markup/parser';
import { ActionSpec, ElementSpec, GroupSpec, CodeSlideSpec, IncludeSpec, MarkupError, normalizeStyles, parseAt, parseAttributes, parseColor, positionTargets } from '../src/markup/ast';
import { preprocessLatex } from '../src/markup/latex';
import { Transform } from '../src/geometry';
import { Slide, walk, startingSlide } from '../src/slides';

const AUTOMATA = `
::: slide {#overview}
# Finite automata

A **DFA** has states and transitions. Its transition function is $\\delta$.

[[include: #diagram x=0 y=-1 width=8]]
:::

::: slide {#diagram}
## A transition {x=0 y=3}

[State $q_0$]{#q0 x=-3 y=0 step=1}

[State $q_1$]{#q1 x=3 y=0 step=2}

[[arrow: #q0 -> #q1, #edge, label="$a$", step=3]]
[[hide: #q0 step=4]]
[[next: step=2]]
[[skip_next: step=4]]
:::
`;

describe('MarkupParser', () => {
  it('parses slides, includes, spans and directives', () => {
    const document = new MarkupParser().parse(AUTOMATA);
    expect(document.root).toBe('overview');
    const overview = document.slides.find((slide) => slide.id === 'overview');
    expect(overview).toBeDefined();
    const include = overview?.items.find((item) => item instanceof IncludeSpec) as IncludeSpec;
    expect(include.target).toBe('diagram');
    expect(include.attributes).toEqual({ x: '0', y: '-1', width: '8' });
    const heading = overview?.items[0] as ElementSpec;
    expect(heading.level).toBe(1);
    const prose = overview?.items[1] as ElementSpec;
    expect(prose.spans.map((s) => s.kind)).toContain('math');
    expect(prose.spans.find((s) => s.bold)?.content).toBe('DFA');
  });

  it('compiles fragment steps with visits, next and skip_next', () => {
    const document = new MarkupParser().parse(AUTOMATA);
    const diagram = document.slides.find((slide) => slide.id === 'diagram');
    const steps = new ASTTransformer().plan(diagram!);
    expect(steps.map((step) => step.number)).toEqual([1, 2, 3, 4]);
    expect(steps[1].autoNext).toBe(true);
    expect(steps[3].skipNext).toBe(true);
    expect(steps[3].changes).toEqual([{ action: 'hide', target: 'q0' }]);
  });

  it('keeps the nesting, markers and numbers of lists', () => {
    const source = '::: slide {#a}\n- one\n  - two\n    1. three\n    2. four\n  - five\n- six\n\n3) seven\n\n- eight {#e width=4}\n\n  more of eight\n:::';
    const items = new MarkupParser().parse(source).slides[0].items as ElementSpec[];
    expect(items.map((item) => item.list)).toEqual([
      { depth: 0, marker: '•' }, { depth: 1, marker: '–' }, { depth: 2, marker: '1.' }, { depth: 2, marker: '2.' },
      { depth: 1, marker: '–' }, { depth: 0, marker: '•' }, { depth: 0, marker: '3)' },
      { depth: 0, marker: '•' }, { depth: 0, marker: '' },
    ]);
    expect(items[0].spans.map((s) => s.content).join('')).toBe('one');
    expect(items[7].id).toBe('e');
    expect(items[7].attributes.width).toBe('4');
    const plain = new MarkupParser().parse('::: slide {#a}\nNo list here.\n:::').slides[0].items[0] as ElementSpec;
    expect(plain.list).toBeNull();
  });

  it('accepts preview=true|false on slides and children', () => {
    const document = new MarkupParser().parse('::: slide {#a}\n[[include: #b preview=true]]\n:::\n::: slide {#b preview=false}\nx\n:::');
    const include = document.slides[0].items.find((item): item is IncludeSpec => item instanceof IncludeSpec);
    expect(include?.attributes.preview).toBe('true');
    expect(document.slides[1].attributes.preview).toBe('false');
    expect(() => new MarkupParser().parse('::: slide {#a}\n[[include: #b preview=maybe]]\n:::\n::: slide {#b}\nx\n:::')).toThrow(/preview must be true or false/);
  });

  it('accepts transition=zoom|cut on slides and children only', () => {
    const document = new MarkupParser().parse('::: slide {#a transition=cut}\n[[include: #b transition=zoom]]\n:::\n::: slide {#b}\nx\n:::');
    expect(document.slides[0].attributes.transition).toBe('cut');
    expect((document.slides[0].items[0] as IncludeSpec).attributes.transition).toBe('zoom');
    expect(() => new MarkupParser().parse('::: slide {#a transition=fade}\nx\n:::')).toThrow(/zoom or cut/);
    expect(() => new MarkupParser().parse('::: slide {#a}\n[[include: #b transition=none]]\n:::\n::: slide {#b}\nx\n:::')).toThrow(/zoom or cut/);
  });

  it('accepts href on elements, shapes, groups, connections and attachments', () => {
    const source = [
      '::: slide {#a}',
      'A paragraph {#p href=https://example.org}',
      '[[circle: #c x=0 y=0 radius=1 href=mailto:someone@example.org]]',
      '[[arrow: #p -> #c, #e, href=#slide=a]]',
      '[[box: #c, #b, href=./notes.pdf]]',
      '::: {.group #g href=/docs/}',
      'inside',
      ':::',
      ':::',
    ].join('\n');
    const items = new MarkupParser().parse(source).slides[0].items as ElementSpec[];
    expect(items.map((item) => item.attributes.href)).toEqual(['https://example.org', 'mailto:someone@example.org', '#slide=a', './notes.pdf', '/docs/']);
    expect(() => new MarkupParser().parse('::: slide {#a}\nx {href=javascript:alert(1)}\n:::')).toThrow(/Unsupported link target/);
  });

  it('rejects unknown references and inconsistent visibility', () => {
    expect(() => new MarkupParser().parse('::: slide {#a}\n[[include: #b]]\n[[include: #b]]\n:::')).toThrow(MarkupError);
    expect(() => new MarkupParser().parse('::: slide {#a}\n[x]{#x step=1}\n[[show: #x step=2]]\n:::')).toThrow(/Inconsistent/);
    expect(() => new MarkupParser().parse('::: slide {#a}\n[x]{#x below:#y}\n:::')).toThrow(/Unknown positioning/);
  });

  it('parses code-authored subslides and CSS color spans', () => {
    const document = new MarkupParser().parse('::: slide {#a}\n[[subslide: Run x=1 step=2]]\n\n[red]{style="color:red"} words\n:::');
    const item = document.slides[0].items[0] as CodeSlideSpec;
    expect(item.className).toBe('Run');
    const prose = document.slides[0].items[1] as ElementSpec;
    expect(prose.spans[0].color).toBe('#FF0000');
  });
});

describe('attributes and colors', () => {
  it('tokenizes quoted attribute values and shorthands', () => {
    expect(parseAttributes('{#id x=1 label="a, b" below:#h}', 1)).toEqual({ id: 'id', x: '1', label: 'a, b', below: '#h' });
    expect(parseAttributes('#edge, color=blue, step=3', 1, { commas: true })).toEqual({ id: 'edge', color: 'blue', step: '3' });
    expect(() => parseAttributes('oops', 1)).toThrow(MarkupError);
  });

  it('normalizes engine palette names and CSS colors', () => {
    expect(parseColor('BLUE')).toBe('#58C4DD');
    expect(parseColor('red')).toBe('#FC6255');
    expect(parseColor('#abc')).toBe('#AABBCC');
    expect(parseColor('rgb(255, 0, 128)')).toBe('#FF0080');
  });
});

describe('preprocessLatex', () => {
  it('rewrites colors into class groups and escapes angle brackets', () => {
    expect(preprocessLatex('\\textcolor{red}{x} < y')).toBe('\\class{zdc-FF0000}{x} \\lt  y');
    expect(preprocessLatex('{\\color{OliveGreen}A}(o)')).toBe('{\\class{zdc-3C8031}{A}}(o)');
    expect(preprocessLatex('a \\leq b')).toBe('a \\leq b');
  });
});

describe('Transform', () => {
  it('fits a canvas into a rectangle with letterboxing', () => {
    const corners = [[-4, 1, 0], [4, 1, 0], [4, -1, 0], [-4, -1, 0]];
    const fit = Transform.fit(corners, 16, 9);
    expect(fit.scale).toBeCloseTo(2 / 9);
    expect(fit.apply([0, 0, 0])).toEqual([0, 0, 0]);
    expect(fit.apply([8, 0, 0])[0]).toBeCloseTo(16 / 9);
    const inverse = fit.inverse(fit.apply([3, 2, 0]));
    expect(inverse[0]).toBeCloseTo(3);
    expect(inverse[1]).toBeCloseTo(2);
  });

  it('rejects shear and reflections', () => {
    expect(() => new Transform([1, 0.5, 0, 0, 1, 0, 0, 0, 1])).toThrow();
    expect(() => new Transform([-1, 0, 0, 0, 1, 0, 0, 0, 1])).toThrow();
  });
});

describe('slides', () => {
  it('walks deep trees without recursion and infers sizes', () => {
    const root = new Slide('root');
    let node = root;
    for (let i = 0; i < 5000; i++) node = node.addChild(new Slide(`f${i}`), { width: 8 });
    expect([...walk(root)].length).toBe(5001);
    const child = new Slide('c', { width: 8 });
    expect(child.height).toBe(4.5);
    expect(startingSlide(root)).toBeNull();
    expect(() => new Slide('x').addChild(root.children[0])).toThrow();
    expect(() => root.children[0].addChild(root)).toThrow(/cycles/);
  });
});

describe('phase 1 markup features', () => {
  const parse = (body: string) => new MarkupParser().parse(`::: slide {#a}\n${body}\n:::`);

  it('parses the new shapes and attachments', () => {
    const document = parse([
      '[[dot: #p x=1 y=2]]',
      '[[ellipse: #e x=0 y=0 width=3 height=1 fill_color=TEAL fill_opacity=0.2]]',
      '[[polygon: #tri points="(0,0) (1,0) (0,1)"]]',
      '[[arc: #arc x=2 y=2 radius=1 angle=1.5]]',
      '[[brace: #e, #b, side=bottom, label="an *ellipse*"]]',
      '[[box: #tri, #box, buff=0.2, corner_radius=0.1]]',
    ].join('\n'));
    const kinds = document.slides[0].items.map((item) => (item as ElementSpec).kind);
    expect(kinds).toEqual(['dot', 'ellipse', 'polygon', 'arc', 'brace', 'box']);
    const brace = document.slides[0].items[4] as ElementSpec;
    expect(brace.attributes).toEqual({ target: 'e', id: 'b', side: 'bottom', label: 'an *ellipse*' });
    expect(() => parse('[[arc: #arc radius=1]]')).toThrow(/arc requires/);
    expect(() => parse('[[polygon: #t points="(0,0) (1,1)"]]')).toThrow(/three/);
    expect(() => parse('[[arrow: (0,0) -> (1,1), #ar]]\n[[brace: #ar, #b]]')).toThrow(/must attach/);
    expect(() => parse('[[brace: #nope, #b]]')).toThrow(/Unknown brace target/);
    expect(() => parse('[[dot: #p]]\n[[brace: #p, #b, side=diagonal]]')).toThrow(/Brace side/);
  });

  it('validates anchors, offsets, opacity and skip_return', () => {
    expect(parse('![i](x.png){#i x=0 y=0 anchor=top-left opacity=0.5 dx=0.2}').slides).toHaveLength(1);
    expect(() => parse('![i](x.png){#i x=0 y=0 anchor=left-baseline}')).toThrow(/Baseline anchors/);
    expect(() => parse('[t]{#t x=0 anchor=middle}')).toThrow(/Unknown anchor/);
    expect(() => parse('[t]{#t dx=1}')).toThrow(/dx and dy require/);
    expect(() => parse('[t]{#t x=0 opacity=1.5}')).toThrow(/opacity must be/);
    const tree = new MarkupParser().parse('::: slide {#r skip_return=true}\n[[include: #c anchor=right x=1 skip_return=true]]\n:::\n::: slide {#c}\nx\n:::');
    expect(tree.slides[0].attributes.skip_return).toBe('true');
    expect(() => new MarkupParser().parse('::: slide {#r skip_return=maybe}\nx\n:::')).toThrow(/skip_return must be/);
    expect(() => parse('[[include: #c anchor=left-baseline]]')).toThrow(/Baseline anchors/);
  });

  it('compiles fade timing from elements and directives', () => {
    const document = parse('[slow]{#s step=1 run_time=2 lag=0.5}\n[[hide: #s step=2 run_time=1]]\n[[show: #s step=3]]');
    const steps = new ASTTransformer().plan(document.slides[0]);
    expect(steps[0].changes).toEqual([{ action: 'show', target: 's', runTime: 2, lag: 0.5 }]);
    expect(steps[1].changes).toEqual([{ action: 'hide', target: 's', runTime: 1, lag: 0.5 }]);
    expect(steps[2].changes).toEqual([{ action: 'show', target: 's', runTime: 2, lag: 0.5 }]);
    expect(() => parse('[x]{#x step=1 run_time=0}')).toThrow(/run_time must be positive/);
    expect(() => parse('[x]{#x step=1}\n[[show: #x step=2 color=red]]')).toThrow(/take step=N/);
  });

  it('keeps link targets on spans', () => {
    const document = parse('See [the docs](https://example.org/x) and **[bold link](mailto:a@b.c)**.');
    const spans = (document.slides[0].items[0] as ElementSpec).spans;
    expect(spans.find((s) => s.content === 'the docs')?.href).toBe('https://example.org/x');
    expect(spans.find((s) => s.content === 'bold link')).toMatchObject({ bold: true, href: 'mailto:a@b.c' });
    expect(spans.find((s) => s.content === 'See ')?.href).toBeUndefined();
    // markdown-it drops unsafe schemes: the text stays, without a link.
    const unsafe = (parse('[x](javascript:alert(1))').slides[0].items[0] as ElementSpec).spans;
    expect(unsafe.every((s) => !s.href)).toBe(true);
  });
});

describe('phase 2 markup features', () => {
  const parse = (body: string) => new MarkupParser().parse(`::: slide {#a}\n${body}\n:::`);

  it('parses at= expressions and validates their references', () => {
    expect(parseAt('#ref.bottom-right', 1)).toEqual({ anchor: null, target: { id: 'ref', anchor: 'bottom-right' } });
    expect(parseAt('top-left:#fig.1', 1)).toEqual({ anchor: 'top-left', target: { id: 'fig.1', anchor: null } });
    expect(parseAt('center:(2,-1)', 1)).toEqual({ anchor: 'center', target: { point: [2, -1, 0] } });
    expect(() => parseAt('middle:#a', 1)).toThrow(/Unknown anchor/);
    const document = parse('[[dot: #ref x=0 y=0]]\n[t]{#t at=top-left:#ref.bottom-right dx=0.2}');
    expect(positionTargets(document.slides[0].items[1] as ElementSpec)).toEqual(new Set(['ref']));
    expect(() => parse('[[dot: #ref x=0 y=0]]\n[t]{#t at=#ref x=1}')).toThrow(/at= replaces/);
    expect(() => parse('[t]{#t at=#nope}')).toThrow(/Unknown at= reference/);
    expect(() => parse('[[dot: #ref x=0 y=0]]\n[t]{#t at=origin:#ref}')).toThrow(/origin is an anchor of groups/);
    expect(() => parse('[[dot: #ref x=0 y=0]]\n[t]{#t at=#ref.left-baseline}')).toThrow(/Baseline anchors/);
    expect(() => parse('[a]{#a1 at=#a2}\n\n[b]{#a2 at=#a1}')).toThrow(/cycle/);
  });

  it('applies role and class styles below element attributes', () => {
    const source = '::: styles\nfootnote: font_size=18 color=GRAY\nheading: color=TEAL\n:::\n::: slide {#a}\n# Title {#h}\n[note]{#n .footnote color=RED}\n:::';
    const document = new MarkupParser().parse(source, { styles: normalizeStyles({ footnote: 'font_size=40', body: { opacity: 0.5 } }) });
    const [heading, note] = document.slides[0].items as ElementSpec[];
    expect(heading.attributes.color).toBe('TEAL');
    expect(note.attributes).toEqual({ id: 'n', color: 'RED', font_size: '18', opacity: '0.5' });
    expect(() => parse('[x]{#x .missing}')).toThrow(/Unknown style class/);
    expect(() => new MarkupParser().parse('::: styles\nbad line\n:::\n::: slide {#a}\nx\n:::')).toThrow(/style line/);
    expect(() => normalizeStyles({ 'bad name': 'x=1' })).toThrow(/Invalid style name/);
  });

  it('parses groups with scoped references and group-level visibility', () => {
    const document = parse('::: {.group #g x=1 y=-2 step=1}\n[[circle: #c x=0 y=0 radius=0.5]]\n[label]{at=#c.center anchor=center}\n[[arrow: #c -> (2,0), #ar]]\n:::\n[[box: #g, #gb]]');
    const group = document.slides[0].items[0] as GroupSpec;
    expect(group.kind).toBe('group');
    expect(group.items.map((item) => item.id)).toEqual(['c', 'g.element-2', 'ar']);
    expect(new ASTTransformer().plan(document.slides[0])[0].changes).toEqual([{ action: 'show', target: 'g' }]);
    expect(() => parse('::: {.group #g}\n[[circle: #c x=0 y=0 radius=0.5 step=1]]\n:::')).toThrow(/Group members cannot use step/);
    expect(() => parse('::: {.group #g}\n[[circle: #c x=0 y=0 radius=0.5]]\n:::\n[t]{#t below:#c}')).toThrow(/different group/);
    expect(() => parse('::: {.group #g}\n[[circle: #c x=0 y=0 radius=0.5]]\n:::\n[[hide: #c step=1]]')).toThrow(/group member/);
    expect(() => parse('::: {.group #g}\n[[include: #x]]\n:::')).toThrow(/nested groups only/);
    expect(() => parse('[t]{#t x=0 anchor=origin}')).toThrow(/origin is an anchor of groups/);
    expect(parse('::: {.group #g at=top-left:(0,0)}\n::: {.group #inner}\n[[dot: #d x=0 y=0]]\n:::\n:::').slides).toHaveLength(1);
  });
});

describe('phase 3 animation directives', () => {
  const parse = (body: string) => new MarkupParser().parse(`::: slide {#a}\n${body}\n:::`);
  const plan = (body: string) => new ASTTransformer().plan(parse(body).slides[0]);

  it('parses animate, effect, transform and move_along into step changes', () => {
    const steps = plan([
      '[[dot: #d x=0 y=0]]',
      '[[arc: #path x=0 y=0 radius=2 angle=3]]',
      '[A]{#a1 x=0 y=1}',
      '',
      '[B]{#b1 x=0 y=2 step=3}',
      '[[animate: #d, step=1, x=3, angle=1.57, scale=2, opacity=0.5, color=RED, run_time=2, rate=linear, lag=0.5]]',
      '[[effect: indicate #a1, step=1, color=YELLOW, scale=1.3]]',
      '[[move_along: #d, step=2, path=#path, rotate=true]]',
      '[[transform: #a1 -> #b1, step=3]]',
    ].join('\n'));
    expect(steps.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(steps[0].changes).toEqual([
      { action: 'animate', target: 'd', runTime: 2, lag: 0.5, rate: 'linear', props: { x: '3', angle: '1.57', scale: '2', opacity: '0.5', color: 'RED' } },
      { action: 'effect', target: 'a1', name: 'indicate', options: { color: 'YELLOW', scale: '1.3' } },
    ]);
    expect(steps[1].changes).toEqual([{ action: 'move_along', target: 'd', path: 'path', rotate: true }]);
    expect(steps[2].changes).toEqual([{ action: 'transform', target: 'a1', to: 'b1' }]);
    const document = parse('[[dot: #d x=0 y=0]]\n[[animate: #d, step=1, dx=1]]');
    expect(document.slides[0].items[1]).toBeInstanceOf(ActionSpec);
  });

  it('rejects animations of hidden, unknown or grouped targets', () => {
    expect(() => parse('[x]{#x step=2}\n[[animate: #x, step=1, dx=1]]')).toThrow(/hidden at step 1/);
    expect(() => parse('[[animate: #nope, step=1, dx=1]]')).toThrow(/Unknown animate target/);
    expect(() => parse('[[dot: #d x=0 y=0]]\n[[animate: #d, step=1]]')).toThrow(/needs a target property/);
    expect(() => parse('[[dot: #d x=0 y=0]]\n[[animate: #d, step=1, x=1, at=(0,0)]]')).toThrow(/at= replaces/);
    expect(() => parse('[[dot: #d x=0 y=0]]\n[[effect: sparkle #d, step=1]]')).toThrow(/Unknown effect/);
    expect(() => parse('[[dot: #d x=0 y=0]]\n[[animate: #d, step=1, dx=1, rate=bouncy]]')).toThrow(/Unknown rate/);
    expect(() => parse('::: {.group #g}\n[[dot: #d x=0 y=0]]\n:::\n[[animate: #d, step=1, dx=1]]')).toThrow(/group member/);
    expect(() => parse('[a]{#a1 x=0}\n\n[b]{#b1 x=0}\n[[transform: #a1 -> #b1, step=1]]')).toThrow(/must be hidden before/);
    expect(() => parse('[a]{#a1 x=0 step=5}\n\n[b]{#b1 x=0 step=6}\n[[transform: #a1 -> #b1, step=3]]')).toThrow(/must be visible/);
    expect(() => parse('[[dot: #d x=0 y=0]]\n[t]{#t x=0}\n[[move_along: #d, step=1, path=#t]]')).toThrow(/paths must be shapes/);
    expect(() => parse('[[dot: #d x=0 y=0]]\n[[animate: #d, step=1, dx=1]]\n[[effect: flash #d, step=1]]')).toThrow(/changed twice/);
  });

  it('animates included viewports and tracks transform visibility', () => {
    const document = new MarkupParser().parse('::: slide {#r}\n[[include: #c x=0 y=0 width=4]]\n[[animate: #c, step=1, x=3, angle=0.2]]\n:::\n::: slide {#c}\nx\n:::');
    const steps = new ASTTransformer().plan(document.slides[0]);
    expect(steps[0].changes[0]).toMatchObject({ action: 'animate', target: 'c' });
    const morph = plan('[a]{#a1 x=0}\n\n[b]{#b1 x=0 step=1}\n[[hide: #b1 step=2]]\n[[transform: #a1 -> #b1, step=3]]\n[[hide: #b1 step=4]]');
    expect(morph.map((s) => s.changes.map((c) => c.action))).toEqual([['show'], ['hide'], ['transform'], ['hide']]);
    expect(() => plan('[a]{#a1 x=0}\n\n[b]{#b1 x=0 step=1}\n[[hide: #b1 step=2]]\n[[transform: #a1 -> #b1, step=3]]\n[[hide: #a1 step=4]]')).toThrow(/Inconsistent hide/);
    expect(plan('[[dot: #d x=0 y=0]]\n[[animate: #d, step=1, at=(2,-1)]]')[0].changes[0].props).toEqual({ at: '(2,-1)' });
  });

  it('accepts enter and exit styles on elements and directives', () => {
    const steps = plan('[a]{#a1 x=0 step=1 enter=grow exit=shrink}\n[[hide: #a1 step=2]]\n[[show: #a1 step=3 enter=write]]');
    expect(steps.map((s) => s.changes[0].style)).toEqual(['grow', 'shrink', 'write']);
    expect(() => parse('[a]{#a1 x=0 step=1 enter=teleport}')).toThrow(/Unknown enter style/);
    expect(() => parse('[a]{#a1 x=0 step=1}\n[[hide: #a1 step=2 enter=grow]]')).toThrow(/hide directives take/);
  });
});

describe('phase 4 markup features', () => {
  const parse = (body: string) => new MarkupParser().parse(`::: slide {#a}\n${body}\n:::`);

  it('parses iframes with a URL, size and placement', () => {
    const element = parse('[[iframe: https://example.org/page, #site, x=2 y=-1 width=8 height=4.5 step=1 title="Example"]]').slides[0].items[0] as ElementSpec;
    expect(element.kind).toBe('iframe');
    expect(element.source).toBe('https://example.org/page');
    expect(element.attributes).toMatchObject({ id: 'site', width: '8', height: '4.5', step: '1', title: 'Example' });
    expect(parse('[[iframe: assets/page.html #p width=4 height=3]]').slides[0].items[0]).toBeInstanceOf(ElementSpec);
    expect(() => parse('[[iframe: https://example.org, #p, width=4]]')).toThrow(/requires width and height/);
    expect(() => parse('[[iframe: javascript:alert(1), #p, width=4 height=3]]')).toThrow(/must be http/);
    expect(() => parse('[[iframe: https://example.org, #p, width=4 height=3 opacity=0.5]]')).toThrow(/Unknown attributes/);
  });

  it('accepts video attributes only on video sources', () => {
    expect(parse('![clip](assets/clip.mp4){#v width=6 play=once muted=false}').slides).toHaveLength(1);
    expect(() => parse('![still](assets/tiles.png){#v width=6 muted=false}')).toThrow(/Unknown attributes/);
    expect(() => parse('![clip](assets/clip.webm){#v muted=maybe}')).toThrow(/muted must be/);
  });
});
