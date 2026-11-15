import { describe, expect, it } from 'vitest';
import { Rectangle } from 'manim-web';
import { MarkupParser, ASTTransformer } from '../src/markup/parser';
import { Display, LocalScene, isEarly, markEarly } from '../src/display';
import { Transform } from '../src/geometry';

const parse = (body: string) => new MarkupParser().parse(`::: slide {#s}\n${body}\n:::`);
const plan = (body: string) => new ASTTransformer().plan(parse(body).slides[0]);

describe('members shown before the first visit (step=-1)', () => {
  it('are part of the initial state and never a show change; -1 is for elements only', () => {
    const steps = plan('[Caption]{#cap x=0 y=1 step=-1}\n\n[Later]{#later x=0 y=0 step=1}');
    expect(steps.find((step) => step.number === 1)?.changes.map((change) => change.target)).toEqual(['later']);
    expect(steps.some((step) => step.changes.some((change) => change.target === 'cap'))).toBe(false);
    // Hiding one later works as for any initial member.
    const hidden = plan('[Caption]{#cap x=0 y=1 step=-1 hide=2}');
    expect(hidden.find((step) => step.number === 2)?.changes.map((change) => [change.action, change.target])).toEqual([['hide', 'cap']]);
    // Nothing animates before the visit: an entrance style there is an error, as is -1 where only a click number makes sense.
    expect(() => plan('[Caption]{#cap x=0 y=1 step=-1 enter=grow}')).toThrow(/step=-1/);
    expect(() => parse('[[show: #a step=-1]]')).toThrow(/nonnegative/);
    expect(() => new MarkupParser().parse('::: slide {#p}\n[[include: #c step=-1]]\n:::\n\n::: slide {#c}\n:::')).toThrow(/nonnegative/);
  });

  it('sit in a group of the display with an opacity of its own, apart from the content', () => {
    const early = new Rectangle({ width: 1, height: 1 });
    const later = new Rectangle({ width: 1, height: 1 });
    markEarly(early);
    expect(isEarly(early)).toBe(true);
    expect(isEarly(later)).toBe(false);
    const local = new LocalScene();
    local.mobjects = [early, later];
    // A child not yet visited: its content is invisible, and so is the early member until the parent's stop reveals it.
    const display = new Display(local, { contentOpacity: 0, earlyOpacity: 0, gridOpacity: 0 });
    display.sync(new Transform());
    expect(display.contentGroup.children).toHaveLength(1);
    expect(display.earlyGroup.children).toHaveLength(1);
    expect(display.contentGroup.visible).toBe(false);
    expect(display.earlyGroup.visible).toBe(false);
    // Half way through the reveal the early member shows, the content still waits.
    display.earlyOpacity = 0.5;
    display.sync(new Transform());
    expect(display.earlyGroup.visible).toBe(true);
    expect(display.contentGroup.visible).toBe(false);
    expect(display.group.visible).toBe(true);
    display.earlyOpacity = 1;
    display.sync(new Transform());
    // Every member counts for the slide, whichever group it is drawn in.
    expect(display.members()).toEqual([early, later]);
    // After the visit both groups show; a member removed from the slide leaves its group.
    display.contentOpacity = 1;
    local.mobjects = [later];
    display.sync(new Transform());
    expect(display.contentGroup.visible).toBe(true);
    expect(display.earlyGroup.children).toHaveLength(0);
    expect(display.earlyGroup.visible).toBe(false);
  });
});
